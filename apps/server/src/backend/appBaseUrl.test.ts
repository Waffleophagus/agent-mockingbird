import { afterEach, expect, test } from "bun:test";

import { resolveDefaultAppBaseUrl, resolveDefaultAppBindHost } from "./appBaseUrl";
import { restoreEnv } from "./testEnv";

afterEach(() => {
  delete process.env.AGENT_MOCKINGBIRD_HOST;
  delete process.env.PORT;
  delete process.env.AGENT_MOCKINGBIRD_PORT;
});

test("default app base URL uses loopback host and default port", () => {
  expect(resolveDefaultAppBindHost()).toBe("127.0.0.1");
  expect(resolveDefaultAppBaseUrl()).toBe("http://127.0.0.1:3001");
});

test("default app base URL uses explicit bind host when it is directly reachable", () => {
  const previousHost = process.env.AGENT_MOCKINGBIRD_HOST;
  const previousPort = process.env.PORT;
  process.env.AGENT_MOCKINGBIRD_HOST = "localhost";
  process.env.PORT = "4011";

  try {
    expect(resolveDefaultAppBindHost()).toBe("localhost");
    expect(resolveDefaultAppBaseUrl()).toBe("http://localhost:4011");
  } finally {
    restoreEnv("AGENT_MOCKINGBIRD_HOST", previousHost);
    restoreEnv("PORT", previousPort);
  }
});

test("default app base URL keeps loopback for wildcard bind hosts", () => {
  const previousHost = process.env.AGENT_MOCKINGBIRD_HOST;
  const previousPort = process.env.AGENT_MOCKINGBIRD_PORT;
  process.env.AGENT_MOCKINGBIRD_HOST = "0.0.0.0";
  process.env.AGENT_MOCKINGBIRD_PORT = "4555";

  try {
    expect(resolveDefaultAppBindHost()).toBe("0.0.0.0");
    expect(resolveDefaultAppBaseUrl()).toBe("http://127.0.0.1:4555");
  } finally {
    restoreEnv("AGENT_MOCKINGBIRD_HOST", previousHost);
    restoreEnv("AGENT_MOCKINGBIRD_PORT", previousPort);
  }
});

test("default app base URL maps IPv6 wildcard bind hosts to IPv6 loopback", () => {
  const previousHost = process.env.AGENT_MOCKINGBIRD_HOST;
  delete process.env.AGENT_MOCKINGBIRD_PORT;
  process.env.AGENT_MOCKINGBIRD_HOST = "::";

  try {
    expect(resolveDefaultAppBindHost()).toBe("::");
    expect(resolveDefaultAppBaseUrl()).toBe("http://[::1]:3001");
  } finally {
    restoreEnv("AGENT_MOCKINGBIRD_HOST", previousHost);
  }
});
