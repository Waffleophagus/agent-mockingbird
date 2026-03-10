import {
  getMemoryStatus,
  listMemoryWriteEvents,
  readMemoryFileSlice,
  rememberMemory,
  searchMemoryDetailed,
  searchMemory,
  syncMemoryIndex,
  validateMemoryRememberInput,
} from "../../memory/service";
import { parseMemoryRememberBody } from "../parsers";

export function createMemoryRoutes() {
  return {
    "/api/waffle/memory/status": {
      GET: async () => {
        try {
          return Response.json({ status: await getMemoryStatus() });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load memory status";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/waffle/memory/activity": {
      GET: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
          const events = await listMemoryWriteEvents(requestedLimit);
          return Response.json({ events });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load memory activity";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/waffle/memory/sync": {
      POST: async () => {
        try {
          await syncMemoryIndex();
          return Response.json({ status: await getMemoryStatus() });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Memory sync failed";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/waffle/memory/reindex": {
      POST: async () => {
        try {
          await syncMemoryIndex({ force: true });
          return Response.json({ status: await getMemoryStatus() });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Memory reindex failed";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/waffle/memory/retrieve": {
      POST: async (req: Request) => {
        const body = (await req.json()) as { query?: string; maxResults?: number; minScore?: number; debug?: boolean };
        const query = body.query?.trim();
        if (!query) {
          return Response.json({ error: "query is required" }, { status: 400 });
        }
        try {
          const options = {
            maxResults: typeof body.maxResults === "number" ? body.maxResults : undefined,
            minScore: typeof body.minScore === "number" ? body.minScore : undefined,
          };
          if (body.debug) {
            const detailed = await searchMemoryDetailed(query, options);
            return Response.json({ results: detailed.results, debug: detailed.debug });
          }
          const results = await searchMemory(query, options);
          return Response.json({ results, debug: undefined });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Memory retrieve failed";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/waffle/memory/read": {
      POST: async (req: Request) => {
        const body = (await req.json()) as { path?: string; from?: number; lines?: number };
        const relPath = body.path?.trim();
        if (!relPath) {
          return Response.json({ error: "path is required" }, { status: 400 });
        }
        try {
          const result = await readMemoryFileSlice({
            relPath,
            from: typeof body.from === "number" ? body.from : undefined,
            lines: typeof body.lines === "number" ? body.lines : undefined,
          });
          return Response.json(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Memory read failed";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },

    "/api/waffle/memory/remember": {
      POST: async (req: Request) => {
        const body = parseMemoryRememberBody(await req.json());
        if (!body) {
          return Response.json(
            {
              error:
                "Invalid payload. Expected { source?, content, entities?, confidence?, supersedes?, sessionId?, topic?, ttl? }",
            },
            { status: 400 },
          );
        }
        try {
          const result = await rememberMemory(body);
          return Response.json(result, { status: result.accepted ? 201 : 422 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Memory write failed";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/waffle/memory/remember/validate": {
      POST: async (req: Request) => {
        const body = parseMemoryRememberBody(await req.json());
        if (!body) {
          return Response.json(
            {
              error:
                "Invalid payload. Expected { source?, content, entities?, confidence?, supersedes?, sessionId?, topic?, ttl? }",
            },
            { status: 400 },
          );
        }
        try {
          const validation = await validateMemoryRememberInput(body);
          return Response.json({ validation });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Memory validation failed";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  };
}
