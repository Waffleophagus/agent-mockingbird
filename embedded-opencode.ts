import { Server as OpenCodeServer } from "./vendor/opencode/packages/opencode/src/server/server.ts";

export function createEmbeddedOpenCodeApp() {
  return OpenCodeServer.createApp({});
}
