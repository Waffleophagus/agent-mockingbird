const DEFAULT_APP_HOST = "127.0.0.1";
const DEFAULT_APP_PORT = "3001";

function resolveConfiguredAppHost() {
  return process.env.AGENT_MOCKINGBIRD_HOST?.trim() || DEFAULT_APP_HOST;
}

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

function resolveConnectHost() {
  const host = resolveConfiguredAppHost();
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (host === "::") {
    return "::1";
  }
  return host;
}

function formatHostForUrl(host: string) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function resolveDefaultAppBindHost() {
  return resolveConfiguredAppHost();
}

export function resolveDefaultAppBaseUrl() {
  return `http://${formatHostForUrl(resolveConnectHost())}:${resolveConfiguredAppPort()}`;
}
