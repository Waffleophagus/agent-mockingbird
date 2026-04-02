const DEFAULT_APP_PORT = "3001";

function resolveConfiguredAppPort() {
  const rawPort =
    process.env.PORT?.trim() ||
    process.env.AGENT_MOCKINGBIRD_PORT?.trim() ||
    DEFAULT_APP_PORT;
  const parsedPort = Number(rawPort);
  if (!Number.isFinite(parsedPort) || parsedPort <= 0) {
    return DEFAULT_APP_PORT;
  }
  return String(parsedPort);
}

export function resolveDefaultAppBaseUrl() {
  return `http://127.0.0.1:${resolveConfiguredAppPort()}`;
}
