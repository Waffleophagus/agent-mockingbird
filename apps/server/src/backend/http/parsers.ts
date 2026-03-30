import type { infer as Infer, ZodType } from "zod";

import type { MemoryRecordSource } from "../memory/types";

interface ParsedJsonBody<T> {
  ok: true;
  body: T;
}

interface FailedJsonBody {
  ok: false;
  response: Response;
}

function invalidJsonResponse(message: string): FailedJsonBody {
  return {
    ok: false,
    response: Response.json({ error: message }, { status: 400 }),
  };
}

export async function parseJsonBody(
  req: Request,
  message = "Request body must be valid JSON",
): Promise<ParsedJsonBody<unknown> | FailedJsonBody> {
  try {
    return {
      ok: true,
      body: await req.json(),
    };
  } catch {
    return invalidJsonResponse(message);
  }
}

export async function parseJsonObjectBody(
  req: Request,
  invalidJsonMessage = "Request body must be valid JSON",
  invalidObjectMessage = "Request body must be a JSON object",
): Promise<ParsedJsonBody<Record<string, unknown>> | FailedJsonBody> {
  const parsed = await parseJsonBody(req, invalidJsonMessage);
  if (!parsed.ok) {
    return parsed;
  }

  if (typeof parsed.body !== "object" || parsed.body === null || Array.isArray(parsed.body)) {
    return invalidJsonResponse(invalidObjectMessage);
  }

  return {
    ok: true,
    body: parsed.body as Record<string, unknown>,
  };
}

export async function parseJsonWithSchema<TSchema extends ZodType>(
  req: Request,
  schema: TSchema,
  options?: {
    invalidJsonMessage?: string;
    invalidBodyMessage?: string;
  },
): Promise<ParsedJsonBody<Infer<TSchema>> | FailedJsonBody> {
  const parsedBody = await parseJsonBody(req, options?.invalidJsonMessage);
  if (!parsedBody.ok) {
    return parsedBody;
  }

  const parsed = schema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return invalidJsonResponse(
      parsed.error.issues[0]?.message ?? options?.invalidBodyMessage ?? "Invalid request body",
    );
  }

  return {
    ok: true,
    body: parsed.data,
  };
}

export function parseStringListBody(body: unknown, field: string): string[] | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>)[field];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    return null;
  }
  return value;
}

export function parseMemoryRememberBody(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
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
  if (!content) return null;
  const allowedSources = ["user", "assistant", "system", "compaction"] as const;
  if (!allowedSources.includes(source as MemoryRecordSource)) return null;
  return {
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
