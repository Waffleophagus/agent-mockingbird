type LogLevel = "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
}

interface LogPayload {
  level: LogLevel;
  scope: string;
  message: string;
  at: string;
  data?: LogFields;
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    message: String(error),
  };
}

function escapeString(value: string) {
  return JSON.stringify(value);
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function") {
    return "[Function]";
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (depth >= 5) {
    return "[DepthLimit]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, depth + 1));
  }

  const output: Record<string, unknown> = {};
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch (error) {
    return {
      error: normalizeError(error),
      value: "[UnserializableObject]",
    };
  }

  for (const key of keys) {
    try {
      output[key] = sanitizeValue((value as Record<string, unknown>)[key], seen, depth + 1);
    } catch (error) {
      output[key] = {
        error: normalizeError(error),
      };
    }
  }

  return output;
}

function serializePayloadSafely(payload: LogPayload) {
  try {
    return JSON.stringify(payload);
  } catch (serializationError) {
    const fallbackPayload = {
      level: payload.level,
      scope: payload.scope,
      message: payload.message,
      at: payload.at,
      data: payload.data ? sanitizeValue(payload.data, new WeakSet<object>(), 0) : undefined,
      serializationError: normalizeError(serializationError),
    };

    try {
      return JSON.stringify(fallbackPayload);
    } catch {
      return [
        "{",
        `"level":${escapeString(payload.level)},`,
        `"scope":${escapeString(payload.scope)},`,
        `"message":${escapeString(payload.message)},`,
        `"at":${escapeString(payload.at)},`,
        `"serializationError":${escapeString("log serialization failed")}`,
        "}",
      ].join("");
    }
  }
}

function writeLog(level: LogLevel, scope: string, message: string, fields?: LogFields) {
  const payload: LogPayload = {
    level,
    scope,
    message,
    at: new Date().toISOString(),
  };
  if (fields) {
    payload.data = fields;
  }
  const line = serializePayloadSafely(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function createLogger(scope: string) {
  return {
    info(message: string, fields?: LogFields) {
      writeLog("info", scope, message, fields);
    },
    warn(message: string, fields?: LogFields) {
      writeLog("warn", scope, message, fields);
    },
    error(message: string, fields?: LogFields) {
      writeLog("error", scope, message, fields);
    },
    errorWithCause(message: string, error: unknown, fields?: LogFields) {
      writeLog("error", scope, message, {
        ...(fields ?? {}),
        error: normalizeError(error),
      });
    },
    warnWithCause(message: string, error: unknown, fields?: LogFields) {
      writeLog("warn", scope, message, {
        ...(fields ?? {}),
        error: normalizeError(error),
      });
    },
  };
}
