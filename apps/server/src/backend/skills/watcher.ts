import { listManagedSkillCatalog } from "./service";
import { getConfigSnapshot } from "../config/service";
import { createSkillsCatalogUpdatedEvent } from "../contracts/events";
import type { RuntimeEventStream } from "../http/sse";

const DEFAULT_POLL_MS = 2_000;

export function startSkillsCatalogWatcher(input: { eventStream: RuntimeEventStream; pollMs?: number }) {
  const pollMs = Number.isFinite(input.pollMs) ? Math.max(500, Math.trunc(input.pollMs ?? DEFAULT_POLL_MS)) : DEFAULT_POLL_MS;
  let lastRevision = "";

  const poll = () => {
    try {
      const snapshot = getConfigSnapshot();
      const catalog = listManagedSkillCatalog(snapshot.config.runtime.opencode.directory);
      if (!lastRevision) {
        lastRevision = catalog.revision;
        return;
      }
      if (catalog.revision === lastRevision) return;
      lastRevision = catalog.revision;
      input.eventStream.publish(createSkillsCatalogUpdatedEvent({ revision: catalog.revision }, "system"));
    } catch (error) {
      console.error("[skills] Catalog watcher failed:", error instanceof Error ? error.message : error);
    }
  };

  const timer = setInterval(poll, pollMs);
  return () => {
    clearInterval(timer);
  };
}
