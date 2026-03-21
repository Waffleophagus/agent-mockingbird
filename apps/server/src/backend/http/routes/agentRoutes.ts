import {
  getOpencodeAgentStorageInfo,
  listOpencodeAgentTypes,
  patchOpencodeAgentTypes,
  validateOpencodeAgentPatch,
} from "../../agents/opencodeConfig";

type AgentPatchBody = {
  upserts?: unknown;
  deletes?: unknown;
  expectedHash?: unknown;
};

async function parseAgentPatchBody(req: Request): Promise<
  { ok: true; body: AgentPatchBody } | { ok: false; response: Response }
> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Request body must be valid JSON" }, { status: 400 }),
    };
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false,
      response: Response.json({ error: "Request body must be a JSON object" }, { status: 400 }),
    };
  }

  return { ok: true, body };
}

export function createAgentRoutes() {
  return {
    "/api/mockingbird/agents": {
      GET: async () => {
        try {
          const payload = await listOpencodeAgentTypes();
          return Response.json(payload);
        } catch (error) {
          const storage = getOpencodeAgentStorageInfo();
          const message = error instanceof Error ? error.message : "Failed to load OpenCode agents";
          return Response.json(
            {
              agentTypes: [],
              hash: "",
              storage,
              error: message,
            },
            { status: 502 },
          );
        }
      },
      PATCH: async (req: Request) => {
        const parsed = await parseAgentPatchBody(req);
        if (!parsed.ok) {
          return parsed.response;
        }

        const { body } = parsed;
        if (typeof body.expectedHash !== "string" || !body.expectedHash.trim()) {
          return Response.json({ error: "expectedHash is required" }, { status: 400 });
        }

        const validation = await validateOpencodeAgentPatch({
          upserts: body.upserts ?? [],
          deletes: body.deletes ?? [],
        });
        if (!validation.ok) {
          return Response.json(validation, { status: 422 });
        }

        const result = await patchOpencodeAgentTypes({
          upserts: validation.normalized.upserts,
          deletes: validation.normalized.deletes,
          expectedHash: body.expectedHash,
        });
        return Response.json(result, { status: result.ok ? 200 : result.status });
      },
    },

    "/api/mockingbird/agents/validate": {
      POST: async (req: Request) => {
        const parsed = await parseAgentPatchBody(req);
        if (!parsed.ok) {
          return parsed.response;
        }

        const { body } = parsed;
        const result = await validateOpencodeAgentPatch({
          upserts: body.upserts ?? [],
          deletes: body.deletes ?? [],
        });
        return Response.json(result, { status: result.ok ? 200 : 422 });
      },
    },
  };
}
