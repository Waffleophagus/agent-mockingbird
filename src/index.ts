import { serve } from "bun";

import {
  createHeartbeatUpdatedEvent,
  createUsageUpdatedEvent,
  type RuntimeEvent,
} from "./backend/contracts/events";
import {
  createSession,
  ensureSeedData,
  getConfig,
  getDashboardBootstrap,
  getHeartbeatSnapshot,
  getSessionById,
  getUsageSnapshot,
  listMessagesForSession,
  listSessions,
  recordHeartbeat,
  setSessionModel,
  setMcpsConfig,
  setSkillsConfig,
} from "./backend/db/repository";
import { env } from "./backend/env";
import {
  getMemoryPolicy,
  getMemoryStatus,
  initializeMemory,
  listMemoryWriteEvents,
  readMemoryFileSlice,
  rememberMemory,
  searchMemory,
  syncMemoryIndex,
  validateMemoryRememberInput,
} from "./backend/memory/service";
import type { MemoryRecordSource, MemoryRecordType } from "./backend/memory/types";
import { listOpencodeModelOptions } from "./backend/opencode/models";
import { createRuntime, getRuntimeStartupInfo, RuntimeSessionNotFoundError } from "./backend/runtime";
import index from "./index.html";

const streamControllers = new Set<ReadableStreamDefaultController<string>>();

function toSseEventName(event: RuntimeEvent): string {
  switch (event.type) {
    case "heartbeat.updated":
      return "heartbeat";
    case "usage.updated":
      return "usage";
    case "session.state.updated":
      return "session-updated";
    case "session.message.created":
      return "session-message";
    default:
      return "runtime-event";
  }
}

function toSseFrame(event: RuntimeEvent): string {
  return `event: ${toSseEventName(event)}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}

function publishRuntimeEvent(event: RuntimeEvent) {
  const frame = toSseFrame(event);
  for (const controller of streamControllers) {
    try {
      controller.enqueue(frame);
    } catch {
      streamControllers.delete(controller);
    }
  }
}

function parseStringListBody(body: unknown, field: string): string[] | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[field];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    return null;
  }
  return value;
}

function parseMemoryRememberBody(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const type = typeof value.type === "string" ? value.type.trim() : "";
  const source = typeof value.source === "string" ? value.source.trim() : "user";
  const content = typeof value.content === "string" ? value.content.trim() : "";
  const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : undefined;
  const topic = typeof value.topic === "string" ? value.topic.trim() : undefined;
  const ttl = typeof value.ttl === "number" ? value.ttl : undefined;
  const entities = Array.isArray(value.entities)
    ? value.entities.filter((item): item is string => typeof item === "string")
    : [];
  const supersedes = Array.isArray(value.supersedes)
    ? value.supersedes.filter((item): item is string => typeof item === "string")
    : [];
  const confidence = typeof value.confidence === "number" ? value.confidence : undefined;
  if (!type || !content) return null;
  const allowedTypes = ["decision", "preference", "fact", "todo", "observation"] as const;
  const allowedSources = ["user", "assistant", "system"] as const;
  if (!allowedTypes.includes(type as MemoryRecordType)) return null;
  if (!allowedSources.includes(source as MemoryRecordSource)) return null;
  return {
    type: type as MemoryRecordType,
    source: source as MemoryRecordSource,
    content,
    entities,
    supersedes,
    confidence,
    sessionId: sessionId || undefined,
    topic: topic || undefined,
    ttl,
  };
}

ensureSeedData();
const runtime = createRuntime();
const runtimeInfo = getRuntimeStartupInfo();
void initializeMemory().catch(() => {
  // Memory startup should not block server boot.
});
runtime.subscribe(event => {
  publishRuntimeEvent(event);
});

setInterval(() => {
  const heartbeat = recordHeartbeat("scheduler");
  publishRuntimeEvent(createHeartbeatUpdatedEvent(heartbeat, "scheduler"));
  publishRuntimeEvent(createUsageUpdatedEvent(getUsageSnapshot(), "scheduler"));
}, 12_000);

const server = serve({
  idleTimeout: 120,
  routes: {
    "/*": index,

    "/api/health": () =>
      Response.json({
        status: "ok",
        now: new Date().toISOString(),
      }),

    "/api/dashboard/bootstrap": () => Response.json(getDashboardBootstrap()),
    "/api/sessions": {
      GET: () => Response.json({ sessions: listSessions() }),
      POST: async req => {
        const body = (await req.json()) as { title?: string; model?: string } | null;
        const session = createSession({
          title: body?.title,
          model: body?.model,
        });
        return Response.json({ session }, { status: 201 });
      },
    },
    "/api/sessions/:id/messages": req => {
      const sessionId = req.params.id;
      const session = getSessionById(sessionId);
      if (!session) {
        return Response.json({ error: "Unknown session" }, { status: 404 });
      }
      return Response.json({
        sessionId,
        messages: listMessagesForSession(sessionId),
      });
    },
    "/api/sessions/:id/model": {
      PUT: async req => {
        const sessionId = req.params.id;
        const body = (await req.json()) as { model?: string };
        const model = body.model?.trim();
        if (!model) {
          return Response.json({ error: "model is required" }, { status: 400 });
        }
        const session = setSessionModel(sessionId, model);
        if (!session) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }
        return Response.json({ session });
      },
    },

    "/api/chat": {
      POST: async req => {
        const body = (await req.json()) as { sessionId?: string; content?: string };
        const content = body.content?.trim();
        if (!body.sessionId || !content) {
          return Response.json({ error: "sessionId and content are required" }, { status: 400 });
        }

        let ack;
        try {
          ack = await runtime.sendUserMessage({
            sessionId: body.sessionId,
            content,
          });
        } catch (error) {
          if (error instanceof RuntimeSessionNotFoundError) {
            return Response.json({ error: "Unknown session" }, { status: 404 });
          }
          const message = error instanceof Error ? error.message : "Runtime request failed";
          return Response.json({ error: message }, { status: 502 });
        }

        const session = getSessionById(ack.sessionId);
        if (!session) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }

        return Response.json({
          messages: ack.messages,
          session,
        });
      },
    },

    "/api/config/skills": {
      GET: () => {
        const config = getConfig();
        return Response.json({ skills: config.skills });
      },
      PUT: async req => {
        const body = (await req.json()) as unknown;
        const skills = parseStringListBody(body, "skills");
        if (!skills) {
          return Response.json({ error: "skills must be a string array" }, { status: 400 });
        }
        return Response.json({ skills: setSkillsConfig(skills) });
      },
    },

    "/api/config/mcps": {
      GET: () => {
        const config = getConfig();
        return Response.json({ mcps: config.mcps });
      },
      PUT: async req => {
        const body = (await req.json()) as unknown;
        const mcps = parseStringListBody(body, "mcps");
        if (!mcps) {
          return Response.json({ error: "mcps must be a string array" }, { status: 400 });
        }
        return Response.json({ mcps: setMcpsConfig(mcps) });
      },
    },

    "/api/opencode/models": {
      GET: async () => {
        try {
          const models = await listOpencodeModelOptions();
          return Response.json({ models });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load models";
          return Response.json({ models: [], error: message }, { status: 502 });
        }
      },
    },

    "/api/memory/status": {
      GET: async () => {
        try {
          return Response.json({ status: await getMemoryStatus() });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load memory status";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/memory/policy": {
      GET: () => {
        try {
          return Response.json({ policy: getMemoryPolicy() });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load memory policy";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/memory/activity": {
      GET: async req => {
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

    "/api/memory/sync": {
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

    "/api/memory/reindex": {
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

    "/api/memory/retrieve": {
      POST: async req => {
        const body = (await req.json()) as { query?: string; maxResults?: number; minScore?: number };
        const query = body.query?.trim();
        if (!query) {
          return Response.json({ error: "query is required" }, { status: 400 });
        }
        try {
          const results = await searchMemory(query, {
            maxResults: typeof body.maxResults === "number" ? body.maxResults : undefined,
            minScore: typeof body.minScore === "number" ? body.minScore : undefined,
          });
          return Response.json({ results });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Memory retrieve failed";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/memory/read": {
      POST: async req => {
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

    "/api/memory/remember": {
      POST: async req => {
        const body = parseMemoryRememberBody(await req.json());
        if (!body) {
          return Response.json(
            {
              error:
                "Invalid payload. Expected { type, source, content, entities?, confidence?, supersedes?, sessionId?, topic?, ttl? }",
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

    "/api/memory/remember/validate": {
      POST: async req => {
        const body = parseMemoryRememberBody(await req.json());
        if (!body) {
          return Response.json(
            {
              error:
                "Invalid payload. Expected { type, source, content, entities?, confidence?, supersedes?, sessionId?, topic?, ttl? }",
            },
            { status: 400 },
          );
        }
        try {
          const validation = await validateMemoryRememberInput(body);
          return Response.json({
            validation,
            policy: getMemoryPolicy(),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Memory validation failed";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/events": {
      GET: () => {
        let streamController: ReadableStreamDefaultController<string> | null = null;

        const stream = new ReadableStream<string>({
          start(controller) {
            streamController = controller;
            streamControllers.add(controller);
            controller.enqueue(toSseFrame(createHeartbeatUpdatedEvent(getHeartbeatSnapshot(), "system")));
            controller.enqueue(toSseFrame(createUsageUpdatedEvent(getUsageSnapshot(), "system")));
          },
          cancel() {
            if (streamController) {
              streamControllers.delete(streamController);
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
  development: env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log("[startup] wafflebot runtime", {
  nodeEnv: env.NODE_ENV,
  opencode: runtimeInfo.opencode,
});
console.log(`Wafflebot dashboard running at ${server.url}`);
