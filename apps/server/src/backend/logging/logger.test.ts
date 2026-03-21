import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { createLogger } from "./logger";

const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  consoleLogSpy.mockClear();
  consoleWarnSpy.mockClear();
  consoleErrorSpy.mockClear();
});

describe("createLogger", () => {
  test("keeps reserved fields at the top level and nests user metadata under data", () => {
    const logger = createLogger("test-scope");

    logger.info("real message", {
      level: "fake-level",
      scope: "fake-scope",
      message: "fake-message",
      at: "fake-at",
      requestId: "req-123",
    });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [line] = consoleLogSpy.mock.calls[0] as [string];
    const payload = JSON.parse(line) as {
      level: string;
      scope: string;
      message: string;
      at: string;
      data?: Record<string, unknown>;
    };

    expect(payload.level).toBe("info");
    expect(payload.scope).toBe("test-scope");
    expect(payload.message).toBe("real message");
    expect(payload.at).toBeString();
    expect(payload.data).toEqual({
      level: "fake-level",
      scope: "fake-scope",
      message: "fake-message",
      at: "fake-at",
      requestId: "req-123",
    });
  });

  test("adds normalized error data alongside user metadata", () => {
    const logger = createLogger("test-scope");
    const error = new Error("boom");

    logger.errorWithCause("failed", error, { requestId: "req-456" });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [line] = consoleErrorSpy.mock.calls[0] as [string];
    const payload = JSON.parse(line) as {
      message: string;
      data?: {
        requestId?: string;
        error?: {
          name?: string;
          message?: string;
          stack?: string;
        };
      };
    };

    expect(payload.message).toBe("failed");
    expect(payload.data?.requestId).toBe("req-456");
    expect(payload.data?.error?.name).toBe("Error");
    expect(payload.data?.error?.message).toBe("boom");
  });

  test("does not throw when fields are circular and emits a safe fallback payload", () => {
    const logger = createLogger("test-scope");
    const fields: Record<string, unknown> = { requestId: "req-789" };
    fields.self = fields;

    expect(() => {
      logger.info("circular payload", fields);
    }).not.toThrow();

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [line] = consoleLogSpy.mock.calls[0] as [string];
    const payload = JSON.parse(line) as {
      message: string;
      data?: {
        requestId?: string;
        self?: string;
      };
      serializationError?: {
        message?: string;
      };
    };

    expect(payload.message).toBe("circular payload");
    expect(payload.data?.requestId).toBe("req-789");
    expect(payload.data?.self).toBe("[Circular]");
    expect(payload.serializationError?.message).toContain("circular structure");
  });
});
