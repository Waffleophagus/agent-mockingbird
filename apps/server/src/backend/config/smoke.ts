import type { Part, Session } from "@opencode-ai/sdk/client";

import type { AgentMockingbirdConfig } from "./schema";
import { ConfigApplyError, type ConfigSmokeTestSummary } from "./types";
import {
  createOpencodeClientFromConnection,
  resolveOpencodeConnection,
  unwrapSdkData,
} from "../opencode/client";

function extractAssistantText(parts: Array<Part>) {
  return parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map(part => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export async function runSmokeTest(config: AgentMockingbirdConfig): Promise<ConfigSmokeTestSummary> {
  const connection = resolveOpencodeConnection(config);
  const client = createOpencodeClientFromConnection(connection);

  let expectedPattern: RegExp;
  try {
    expectedPattern = new RegExp(config.runtime.smokeTest.expectedResponsePattern, "i");
  } catch {
    throw new ConfigApplyError("schema", "runtime.smokeTest.expectedResponsePattern is not a valid regex");
  }

  try {
    const session = unwrapSdkData<Session>(
      await client.session.create({
        body: { title: "agent-mockingbird-config-smoke" },
        responseStyle: "data",
        throwOnError: true,
        signal: AbortSignal.timeout(connection.timeoutMs),
      }),
    );

    const response = unwrapSdkData<{ info: { role: string }; parts: Array<Part> }>(
      await client.session.prompt({
        path: { id: session.id },
        body: {
          model: {
            providerID: config.runtime.opencode.providerId,
            modelID: config.runtime.opencode.modelId,
          },
          parts: [{ type: "text", text: config.runtime.smokeTest.prompt }],
        },
        responseStyle: "data",
        throwOnError: true,
        signal: AbortSignal.timeout(config.runtime.opencode.promptTimeoutMs),
      }),
    );

    const text = extractAssistantText(response.parts);
    if (!text) {
      throw new ConfigApplyError("smoke", "Smoke test returned no assistant text response");
    }
    if (!expectedPattern.test(text)) {
      throw new ConfigApplyError(
        "smoke",
        `Smoke test response did not match expected pattern: ${config.runtime.smokeTest.expectedResponsePattern}`,
        { responseText: text },
      );
    }

    return {
      sessionId: session.id,
      responseText: text,
    };
  } catch (error) {
    if (error instanceof ConfigApplyError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Smoke test failed";
    throw new ConfigApplyError("smoke", message);
  }
}
