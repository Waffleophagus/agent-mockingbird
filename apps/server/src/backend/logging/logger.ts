type LogLevel = "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
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

function writeLog(level: LogLevel, scope: string, message: string, fields?: LogFields) {
  const payload = {
    level,
    scope,
    message,
    at: new Date().toISOString(),
    ...(fields ?? {}),
  };
  const line = JSON.stringify(payload);
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
