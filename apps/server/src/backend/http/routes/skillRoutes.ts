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
        try {
          setManagedSkillEnabled(req.params.id, parsedBody.enabled, snapshot.config.runtime.opencode.directory);
          await disposeOpencodeSkillInstance(snapshot.config);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to update skill";
          const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
          if (code === "ENOENT") {
            return Response.json({ error: `managed skill "${req.params.id}" was not found` }, { status: 404 });
          }
          if (
            message === "skill id is required" ||
            message === "skill id may only include letters, numbers, dot, underscore, or dash"
          ) {
            return Response.json({ error: message }, { status: 400 });
          }
          return Response.json({ error: message }, { status: 400 });
        }
        const catalog = listManagedSkillCatalog(snapshot.config.runtime.opencode.directory);
        const skillExists = catalog.skills.some(skill => skill.id === req.params.id);
        if (!skillExists) {
          return Response.json({ error: `managed skill "${req.params.id}" was not found` }, { status: 404 });
        }
        return Response.json({
          skills: catalog.skills,
          enabled: catalog.enabled,
          disabled: catalog.disabled,
          invalid: catalog.invalid,
          hash: catalog.revision,
          revision: catalog.revision,
          managedPath: getManagedSkillsRootPath(snapshot.config.runtime.opencode.directory),
          disabledPath: getDisabledSkillsRootPath(snapshot.config.runtime.opencode.directory),
        });
      },
      DELETE: async (req: Request & { params: { id: string } }) => {
        const snapshot = getConfigSnapshot();
        try {
          removeManagedSkill(req.params.id, snapshot.config.runtime.opencode.directory);
          await disposeOpencodeSkillInstance(snapshot.config);
          const catalog = listManagedSkillCatalog(snapshot.config.runtime.opencode.directory);
          return Response.json({
            removed: true,
            skills: catalog.skills,
            enabled: catalog.enabled,
            disabled: catalog.disabled,
            invalid: catalog.invalid,
            hash: catalog.revision,
            revision: catalog.revision,
            managedPath: getManagedSkillsRootPath(snapshot.config.runtime.opencode.directory),
            disabledPath: getDisabledSkillsRootPath(snapshot.config.runtime.opencode.directory),
          });
        } catch (error) {
          console.error("Failed to delete managed skill", {
            skillId: req.params.id,
            error,
          });
          const message = error instanceof Error ? error.message : "Failed to delete skill";
          return Response.json(
            {
              removed: false,
              error: message,
            },
            { status: 500 },
          );
        }
      },
    },
  };
}
