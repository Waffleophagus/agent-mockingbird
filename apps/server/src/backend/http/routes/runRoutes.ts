import { getConfigSnapshot } from "../../config/service";
import type { RuntimeInputPart } from "../../contracts/runtime";
import { getSessionById } from "../../db/repository";
import { createLogger } from "../../logging/logger";
import type { RunService } from "../../run/service";
import type { AgentRunEvent } from "../../run/types";
import { createBoundedQueue, type BoundedQueue } from "../boundedQueue";

const RUN_STREAM_MAX_QUEUED_FRAMES = 256;
const RUN_STREAM_DRAIN_DELAY_MS = 25;
const logger = createLogger("run-event-stream");

function runStreamConfig() {
  return getConfigSnapshot().config.runtime.runStream;
}

function parseAfterSeq(req: Request) {
  const url = new URL(req.url);
  const queryRaw = url.searchParams.get("afterSeq") ?? url.searchParams.get("after");
  const headerRaw = req.headers.get("last-event-id");
  const queryAfter = Number(queryRaw);
  const headerAfter = Number(headerRaw);
  const normalizedQuery = Number.isFinite(queryAfter) ? Math.max(0, Math.floor(queryAfter)) : 0;
  const normalizedHeader = Number.isFinite(headerAfter) ? Math.max(0, Math.floor(headerAfter)) : 0;
  return Math.max(normalizedQuery, normalizedHeader);
}

function toRunEventFrame(event: AgentRunEvent) {
  return `id: ${event.seq}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`;
}

function toRunHeartbeatFrame(runId: string) {
  return `event: run-heartbeat\ndata: ${JSON.stringify({ runId, at: new Date().toISOString() })}\n\n`;
}

function normalizeRuntimeInputParts(value: unknown): RuntimeInputPart[] {
  if (!Array.isArray(value)) return [];
  const parts: RuntimeInputPart[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (record.type === "text") {
      const text = typeof record.text === "string" ? record.text : "";
      if (!text.trim()) continue;
      parts.push({
        type: "text",
        text,
      });
      continue;
    }
    if (record.type === "file") {
      const mime = typeof record.mime === "string" ? record.mime.trim() : "";
      const url = typeof record.url === "string" ? record.url.trim() : "";
      const filename = typeof record.filename === "string" ? record.filename.trim() || undefined : undefined;
      if (!mime || !url) continue;
      parts.push({
        type: "file",
        mime,
        url,
        filename,
      });
    }
  }
  return parts;
}

export function createRunRoutes(runService: RunService) {
  return {
    "/api/runs": {
      POST: async (req: Request) => {
        const body = (await req.json()) as {
          sessionId?: string;
          content?: string;
          parts?: RuntimeInputPart[];
          agent?: string;
          metadata?: Record<string, unknown>;
          idempotencyKey?: string;
        };

        const sessionId = body.sessionId?.trim();
        const content = body.content?.trim();
        const parts = normalizeRuntimeInputParts(body.parts);
        if (!sessionId || (!content && parts.length === 0)) {
          return Response.json({ error: "sessionId and content or parts are required" }, { status: 400 });
        }
        if (!getSessionById(sessionId)) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }

        const metadata =
          body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
            ? body.metadata
            : undefined;
        const agent = typeof body.agent === "string" ? body.agent.trim() || undefined : undefined;
        const idempotencyKey = body.idempotencyKey?.trim() || undefined;

        try {
          const result = runService.createRun({
            sessionId,
            content: content ?? "",
            parts,
            agent,
            metadata,
            idempotencyKey,
          });
          return Response.json(
            {
              accepted: true,
              deduplicated: result.deduplicated,
              runId: result.run.id,
              run: result.run,
            },
            { status: result.deduplicated ? 200 : 202 },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to queue run";
          if (message.startsWith("Unknown session:")) {
            return Response.json({ error: "Unknown session" }, { status: 404 });
          }
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },

    "/api/runs/:id": {
      GET: async (req: Request & { params: { id: string } }) => {
        const run = runService.getRunById(req.params.id);
        if (!run) {
          return Response.json({ error: "Unknown run" }, { status: 404 });
        }
        return Response.json({ run });
      },
    },

    "/api/runs/:id/events": {
      GET: async (req: Request & { params: { id: string } }) => {
        const run = runService.getRunById(req.params.id);
        if (!run) {
          return Response.json({ error: "Unknown run" }, { status: 404 });
        }

        const url = new URL(req.url);
        const afterRaw = url.searchParams.get("afterSeq") ?? url.searchParams.get("after") ?? "0";
        const limitRaw = url.searchParams.get("limit") ?? "100";
        const afterSeq = Number(afterRaw);
        const limit = Number(limitRaw);

        const replay = runService.listRunEvents({
          runId: run.id,
          afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
          limit: Number.isFinite(limit) ? limit : 100,
        });

        return Response.json({
          runId: run.id,
          afterSeq: Number.isFinite(afterSeq) ? Math.max(0, Math.floor(afterSeq)) : 0,
          events: replay.events,
          nextAfterSeq: replay.nextAfterSeq,
          hasMore: replay.hasMore,
        });
      },
    },

    "/api/runs/:id/events/stream": {
      GET: (req: Request & { params: { id: string } }) => {
        const run = runService.getRunById(req.params.id);
        if (!run) {
          return Response.json({ error: "Unknown run" }, { status: 404 });
        }

        const runId = run.id;
        const initialAfterSeq = parseAfterSeq(req);

        let streamController: ReadableStreamDefaultController<string> | null = null;
        let unsubscribe: (() => void) | null = null;
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        let outboundQueue: BoundedQueue<string> | null = null;
        let closed = false;
        let cursor = initialAfterSeq;
        let closeAfterDrainPromise: Promise<void> | null = null;

        const close = () => {
          if (closed) return;
          closed = true;
          outboundQueue?.close();
          outboundQueue = null;
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          if (streamController) {
            try {
              streamController.close();
            } catch {
              // stream already closed
            }
            streamController = null;
          }
        };

        const closeAfterDrain = () => {
          if (closeAfterDrainPromise) {
            return closeAfterDrainPromise;
          }
          closeAfterDrainPromise = (async () => {
            const deadlineAt = Date.now() + RUN_STREAM_DRAIN_DELAY_MS;
            while (!closed) {
              if (!outboundQueue || outboundQueue.size() === 0) {
                break;
              }
              if (Date.now() >= deadlineAt) {
                break;
              }
              await new Promise(resolve => setTimeout(resolve, Math.max(1, RUN_STREAM_DRAIN_DELAY_MS / 5)));
            }
            close();
          })();
          return closeAfterDrainPromise;
        };

        const emit = (event: AgentRunEvent) => {
          if (closed || !outboundQueue) return;
          if (event.seq <= cursor) return;
          cursor = event.seq;
          outboundQueue.enqueue(toRunEventFrame(event));
          if (event.type === "run.completed" || event.type === "run.failed") {
            if (outboundQueue.size() === 0) {
              close();
              return;
            }
            void closeAfterDrain();
          }
        };

        const stream = new ReadableStream<string>({
          async start(controller) {
            streamController = controller;
            outboundQueue = createBoundedQueue<string>({
              maxSize: RUN_STREAM_MAX_QUEUED_FRAMES,
              drainDelayMs: RUN_STREAM_DRAIN_DELAY_MS,
              tryWrite: (value) => {
                if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                  return false;
                }
                controller.enqueue(value);
                return true;
              },
              onOverflow: () => {
                logger.warn("Closing run SSE consumer", {
                  runId,
                  reason: "outbound queue overflow",
                });
                close();
              },
              onWriteError: (error) => {
                logger.warnWithCause("Closing run SSE consumer", error, {
                  runId,
                  reason: "write failure",
                });
                close();
              },
            });
            unsubscribe = runService.subscribe(event => {
              if (event.runId !== runId) return;
              emit(event);
            });

            while (!closed) {
              const replay = runService.listRunEvents({
                runId,
                afterSeq: cursor,
                limit: runStreamConfig().replayPageSize,
              });
              if (!replay.events.length) break;
              for (const event of replay.events) {
                emit(event);
                if (closed) return;
              }
              if (!replay.hasMore) break;
            }

            if (closed) return;
            const latestRun = runService.getRunById(runId);
            if (latestRun?.state === "completed" || latestRun?.state === "failed") {
              const deadlineAt = Date.now() + RUN_STREAM_DRAIN_DELAY_MS;
              while (!closed) {
                if (Date.now() >= deadlineAt) {
                  break;
                }
                const finalReplay = runService.listRunEvents({
                  runId,
                  afterSeq: cursor,
                  limit: runStreamConfig().replayPageSize,
                });
                for (const event of finalReplay.events) {
                  emit(event);
                  if (closed) return;
                }
                if (finalReplay.events.length > 0) {
                  cursor = finalReplay.events[finalReplay.events.length - 1]?.seq ?? cursor;
                  if (finalReplay.hasMore) {
                    continue;
                  }
                  break;
                }
                await new Promise(resolve => setTimeout(resolve, RUN_STREAM_DRAIN_DELAY_MS));
              }
              await closeAfterDrain();
              return;
            }

            heartbeatTimer = setInterval(() => {
              if (closed || !outboundQueue) return;
              outboundQueue.enqueue(toRunHeartbeatFrame(runId));
            }, runStreamConfig().heartbeatMs);
          },
          cancel() {
            close();
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
  };
}
