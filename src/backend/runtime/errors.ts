export class RuntimeSessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "RuntimeSessionNotFoundError";
  }
}

export class RuntimeSessionBusyError extends Error {
  constructor(sessionId: string) {
    super(`Session is already processing: ${sessionId}`);
    this.name = "RuntimeSessionBusyError";
  }
}

export class RuntimeTurnTimeoutError extends Error {
  constructor(sessionId: string, timeoutMs: number) {
    super(`Session response timed out after ${timeoutMs}ms: ${sessionId}`);
    this.name = "RuntimeTurnTimeoutError";
  }
}
