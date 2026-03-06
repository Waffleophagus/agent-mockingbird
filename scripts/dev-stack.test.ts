import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("dev-stack preserves runtime bindings by default", () => {
  const scriptPath = path.join(process.cwd(), "scripts", "dev-stack.sh");
  const script = readFileSync(scriptPath, "utf8");

  expect(script).toContain('DEV_RESET_RUNTIME_BINDINGS="${AGENT_MOCKINGBIRD_DEV_RESET_BINDINGS:-0}"');
  expect(script).toContain('if [[ "${DEV_RESET_RUNTIME_BINDINGS}" == "1" ]]; then');
});

