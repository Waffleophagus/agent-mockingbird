import {
  importManagedSkillWithConfigUpdate,
  loadRuntimeSkillCatalog,
  setEnabledSkillsFromCatalog,
} from "../../config/orchestration";
import { getConfigSnapshot } from "../../config/service";
import {
  disposeOpencodeSkillInstance,
  getDisabledSkillsRootPath,
  getManagedSkillsRootPath,
  listManagedSkillCatalog,
  removeManagedSkill,
  setManagedSkillEnabled,
} from "../../skills/service";

export function createSkillRoutes() {
  return {
    "/api/mockingbird/skills": {
      GET: async () => {
        const result = await loadRuntimeSkillCatalog();
        return Response.json(result.payload, { status: result.status });
      },
    },

    "/api/mockingbird/skills/import": {
      POST: async (req: Request) => {
        const body = (await req.json()) as {
          id?: string;
          content?: string;
          enable?: boolean;
          expectedHash?: string;
        };
        if (!body.id?.trim() || !body.content?.trim()) {
          return Response.json({ error: "id and content are required" }, { status: 400 });
        }
        try {
          const result = await importManagedSkillWithConfigUpdate({
            rawId: body.id,
            content: body.content,
            enable: body.enable !== false,
            expectedHash: body.expectedHash,
          });
          return Response.json(result, { status: 201 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to import skill";
          const status = message.includes("refresh and retry") ? 409 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },

    "/api/mockingbird/skills/enabled": {
      PUT: async (req: Request) => {
        const body = (await req.json()) as { skills?: unknown; expectedHash?: string };
        if (!Array.isArray(body.skills)) {
          return Response.json({ error: "skills must be an array" }, { status: 400 });
        }
        try {
          const result = await setEnabledSkillsFromCatalog({
            skills: body.skills.filter((value): value is string => typeof value === "string"),
            expectedHash: body.expectedHash,
          });
          return Response.json(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to update skills";
          const status = message.includes("refresh and retry") ? 409 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },

    "/api/mockingbird/skills/:id": {
      PATCH: async (req: Request & { params: { id: string } }) => {
        const body = (await req.json()) as { enabled?: unknown };
        if (typeof body.enabled !== "boolean") {
          return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
        }
        const snapshot = getConfigSnapshot();
        setManagedSkillEnabled(req.params.id, body.enabled, snapshot.config.workspace.pinnedDirectory);
        await disposeOpencodeSkillInstance(snapshot.config);
        const catalog = listManagedSkillCatalog(snapshot.config.workspace.pinnedDirectory);
        return Response.json({
          skills: catalog.skills,
          enabled: catalog.enabled,
          disabled: catalog.disabled,
          invalid: catalog.invalid,
          hash: catalog.revision,
          revision: catalog.revision,
          managedPath: getManagedSkillsRootPath(snapshot.config.workspace.pinnedDirectory),
          disabledPath: getDisabledSkillsRootPath(snapshot.config.workspace.pinnedDirectory),
        });
      },
      DELETE: async (req: Request & { params: { id: string } }) => {
        const snapshot = getConfigSnapshot();
        removeManagedSkill(req.params.id, snapshot.config.workspace.pinnedDirectory);
        await disposeOpencodeSkillInstance(snapshot.config);
        const catalog = listManagedSkillCatalog(snapshot.config.workspace.pinnedDirectory);
        return Response.json({
          removed: true,
          skills: catalog.skills,
          enabled: catalog.enabled,
          disabled: catalog.disabled,
          invalid: catalog.invalid,
          hash: catalog.revision,
          revision: catalog.revision,
          managedPath: getManagedSkillsRootPath(snapshot.config.workspace.pinnedDirectory),
          disabledPath: getDisabledSkillsRootPath(snapshot.config.workspace.pinnedDirectory),
        });
      },
    },
  };
}
