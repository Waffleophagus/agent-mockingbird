import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

let embeddedOpenCodeAppPromise: Promise<EmbeddedOpenCodeApp> | null = null;

function cacheEmbeddedOpenCodeApp(promise: Promise<EmbeddedOpenCodeApp>) {
  embeddedOpenCodeAppPromise = promise.catch((error) => {
    embeddedOpenCodeAppPromise = null;
    throw error;
  });
  return embeddedOpenCodeAppPromise;
}

function resolveEmbeddedOpenCodeBundlePath() {
  const executableDir = path.dirname(process.execPath);
  const candidates = [
    path.resolve(process.cwd(), "dist", "packages", "opencode", "src", "server", "embedded-opencode.js"),
    path.resolve(
      import.meta.dir,
      "../../../../../dist/packages/opencode/src/server/embedded-opencode.js",
    ),
    path.resolve(executableDir, "packages", "opencode", "src", "server", "embedded-opencode.js"),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

async function getEmbeddedOpenCodeApp() {
  if (!embeddedOpenCodeAppPromise) {
    const bundledModulePath = resolveEmbeddedOpenCodeBundlePath();
    if (bundledModulePath) {
      embeddedOpenCodeAppPromise = cacheEmbeddedOpenCodeApp(
        import(pathToFileURL(bundledModulePath).href).then(
          (module: { createEmbeddedOpenCodeApp: () => EmbeddedOpenCodeApp }) =>
            module.createEmbeddedOpenCodeApp(),
        ),
      );
    } else {
      embeddedOpenCodeAppPromise = cacheEmbeddedOpenCodeApp(
        import(
          new URL(
            "../../../../../vendor/opencode/packages/opencode/src/server/server.ts",
            import.meta.url,
          ).href
        ).then(
          (module: { Server: { createApp: (opts: { cors?: string[] }) => EmbeddedOpenCodeApp } }) =>
            module.Server.createApp({}),
        ),
      );
    }
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
