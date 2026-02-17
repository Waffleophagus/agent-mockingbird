export class RuntimeSessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "RuntimeSessionNotFoundError";
  }
}
