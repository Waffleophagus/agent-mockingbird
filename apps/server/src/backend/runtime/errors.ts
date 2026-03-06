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

export class RuntimeSessionQueuedError extends Error {
  constructor(
    public sessionId: string,
    public depth: number,
  ) {
    super(`Session is busy; message queued (${depth} pending): ${sessionId}`);
    this.name = "RuntimeSessionQueuedError";
  }
}

export class RuntimeContinuationDetachedError extends Error {
  constructor(
    public sessionId: string,
    public childRunCount: number,
  ) {
    super(`Session is still running via ${childRunCount} child run(s): ${sessionId}`);
    this.name = "RuntimeContinuationDetachedError";
  }
}

export class RuntimeProviderQuotaError extends Error {
  constructor(message = "Provider quota exceeded. Add credits or switch provider/model.") {
    super(message);
    this.name = "RuntimeProviderQuotaError";
  }
}

export class RuntimeProviderAuthError extends Error {
  constructor(message = "Provider authentication failed. Check API key or provider credentials.") {
    super(message);
    this.name = "RuntimeProviderAuthError";
  }
}

export class RuntimeProviderRateLimitError extends Error {
  constructor(message = "Provider rate limited this request. Please retry in a moment.") {
    super(message);
    this.name = "RuntimeProviderRateLimitError";
  }
}

export class RuntimeTurnTimeoutError extends Error {
  constructor(sessionId: string, timeoutMs: number) {
    super(`Session response timed out after ${timeoutMs}ms: ${sessionId}`);
    this.name = "RuntimeTurnTimeoutError";
  }
}
