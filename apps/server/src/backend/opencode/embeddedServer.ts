const OPENCODE_SERVER_PREFIXES = [
  "/agent",
  "/auth",
  "/command",
  "/config",
  "/doc",
  "/event",
  "/experimental",
  "/file",
  "/find",
  "/formatter",
  "/global",
  "/instance",
  "/log",
  "/lsp",
  "/mcp",
  "/path",
  "/permission",
  "/project",
  "/provider",
  "/pty",
  "/question",
  "/session",
  "/skill",
  "/tui",
  "/vcs",
] as const;
type EmbeddedOpenCodeApp = {
  fetch(req: Request, server: Bun.Server<unknown>): Response | Promise<Response>;
};

const embeddedOpenCodeServerModuleUrl = new URL(
  "../../../../../vendor/opencode/packages/opencode/src/server/server.ts",
  import.meta.url,
).href;

let embeddedOpenCodeAppPromise: Promise<EmbeddedOpenCodeApp> | null = null;

async function getEmbeddedOpenCodeApp() {
  if (!embeddedOpenCodeAppPromise) {
    embeddedOpenCodeAppPromise = import(embeddedOpenCodeServerModuleUrl).then(
      (module: { Server: { createApp: (opts: { cors?: string[] }) => EmbeddedOpenCodeApp } }) =>
        module.Server.createApp({}),
    );
  }
  return embeddedOpenCodeAppPromise;
}

export function isOpenCodeServerPath(pathname: string) {
  return OPENCODE_SERVER_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function handleEmbeddedOpenCodeRequest(
  req: Request,
  server: Bun.Server<unknown>,
) {
  return (await getEmbeddedOpenCodeApp()).fetch(req, server);
}
