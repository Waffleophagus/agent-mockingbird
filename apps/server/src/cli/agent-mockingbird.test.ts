import { describe, expect, test } from "bun:test";

import { testing } from "./agent-mockingbird.mjs";

describe("agent-mockingbird CLI onboarding diagnostics", () => {
  test("builds actionable diagnostics when runtime model discovery is empty", () => {
    const diagnostics = testing.buildEmptyModelDiscoveryDiagnostics({
      workspaceDir: "/var/home/agent-mockingbird/.agent-mockingbird/workspace",
      currentModel: "opencode/big-pickle",
      authAttempts: 1,
      authSuccess: true,
      authRefresh: {
        ok: true,
        message: "opencode.service restarted to refresh provider credentials.",
      },
    });

    expect(diagnostics[0]).toBe("No runtime models were discovered after provider setup.");
    expect(diagnostics).toContain("Current runtime default: opencode/big-pickle");
    expect(diagnostics).toContain("Provider auth attempts: 1 (at least one succeeded)");
    expect(diagnostics).toContain("OpenCode auth refresh: opencode.service restarted to refresh provider credentials.");
    expect(diagnostics).toContain(
      "- curl -sS http://127.0.0.1:3001/api/opencode/models",
    );
  });
});
