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
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "invalid request body" }, { status: 400 });
        }
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return Response.json({ error: "invalid request body" }, { status: 400 });
        }
        const parsedBody = body as {
          id?: string;
          content?: string;
          enable?: boolean;
          expectedHash?: string;
        };
        if (!parsedBody.id?.trim() || !parsedBody.content?.trim()) {
          return Response.json({ error: "id and content are required" }, { status: 400 });
        }
        try {
          const result = await importManagedSkillWithConfigUpdate({
            rawId: parsedBody.id,
            content: parsedBody.content,
            enable: parsedBody.enable !== false,
            expectedHash: parsedBody.expectedHash,
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
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "invalid request body" }, { status: 400 });
        }
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return Response.json({ error: "invalid request body" }, { status: 400 });
        }
        const parsedBody = body as { skills?: unknown; expectedHash?: string };
        if (!Array.isArray(parsedBody.skills)) {
          return Response.json({ error: "skills must be an array" }, { status: 400 });
        }
        try {
          const result = await setEnabledSkillsFromCatalog({
            skills: parsedBody.skills.filter((value): value is string => typeof value === "string"),
            expectedHash: parsedBody.expectedHash,
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
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "invalid request body" }, { status: 400 });
        }
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return Response.json({ error: "invalid request body" }, { status: 400 });
        }
        const parsedBody = body as { enabled?: unknown };
        if (typeof parsedBody.enabled !== "boolean") {
          return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
        }
        const snapshot = getConfigSnapshot();
        setManagedSkillEnabled(req.params.id, parsedBody.enabled, snapshot.config.workspace.pinnedDirectory);
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
