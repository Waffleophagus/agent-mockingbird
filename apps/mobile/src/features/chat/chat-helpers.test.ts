import { expect, test } from "bun:test";

import { applyMessageCodeHighlight, buildTurns, mergeMessages } from "./chat-helpers";

test("applyMessageCodeHighlight upserts line highlights by block and line index", () => {
  const messages = [
    {
      id: "msg-1",
      role: "assistant" as const,
      content: "```ts\nconst a = 1;\n```",
      at: "2026-03-09T00:00:00.000Z",
      liveCodeHighlights: [
        {
          blockIndex: 0,
          codeHash: "hash-0",
          isClosed: false,
          lineIndex: 0,
          lineText: "const a = 1;",
          language: "ts",
          tokens: [{ content: "const", color: "#fff" }],
        },
      ],
    },
  ];

  const updated = applyMessageCodeHighlight(messages, "msg-1", {
    blockIndex: 0,
    codeHash: "hash-0",
    isClosed: false,
    lineIndex: 0,
    lineText: "const a = 1;",
    language: "ts",
    tokens: [{ content: "const", color: "#0af" }],
  });

  expect(updated[0]?.liveCodeHighlights).toEqual([
    {
      blockIndex: 0,
      codeHash: "hash-0",
      isClosed: false,
      lineIndex: 0,
      lineText: "const a = 1;",
      language: "ts",
      tokens: [{ content: "const", color: "#0af" }],
    },
  ]);

  const appended = applyMessageCodeHighlight(updated, "msg-1", {
    blockIndex: 0,
    codeHash: "hash-1",
    isClosed: true,
    lineIndex: 1,
    lineText: "return a;",
    language: "ts",
    tokens: [{ content: "return", color: "#f0a" }],
  });

  expect(appended[0]?.liveCodeHighlights).toEqual([
    {
      blockIndex: 0,
      codeHash: "hash-0",
      isClosed: false,
      lineIndex: 0,
      lineText: "const a = 1;",
      language: "ts",
      tokens: [{ content: "const", color: "#0af" }],
    },
    {
      blockIndex: 0,
      codeHash: "hash-1",
      isClosed: true,
      lineIndex: 1,
      lineText: "return a;",
      language: "ts",
      tokens: [{ content: "return", color: "#f0a" }],
    },
  ]);
});

test("buildTurns preserves grouping when older history is prepended", () => {
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      content: "oldest user",
      at: "2026-03-09T00:00:00.000Z",
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      content: "oldest assistant",
      at: "2026-03-09T00:00:01.000Z",
    },
    {
      id: "user-2",
      role: "user" as const,
      content: "newer user",
      at: "2026-03-09T00:00:02.000Z",
    },
    {
      id: "assistant-2",
      role: "assistant" as const,
      content: "newer assistant",
      at: "2026-03-09T00:00:03.000Z",
    },
  ];

  const turns = buildTurns(messages);

  expect(turns).toHaveLength(2);
  expect(turns[0]).toMatchObject({
    id: "user-1",
    user: { id: "user-1" },
    assistantMessages: [{ id: "assistant-1" }],
  });
  expect(turns[1]).toMatchObject({
    id: "user-2",
    user: { id: "user-2" },
    assistantMessages: [{ id: "assistant-2" }],
  });
});

test("mergeMessages keeps stable ordering when older history overlaps current messages", () => {
  const current = [
    {
      id: "user-2",
      role: "user" as const,
      content: "newer user",
      at: "2026-03-09T00:00:02.000Z",
    },
    {
      id: "assistant-2",
      role: "assistant" as const,
      content: "newer assistant",
      at: "2026-03-09T00:00:03.000Z",
    },
  ];
  const incoming = [
    {
      id: "user-1",
      role: "user" as const,
      content: "older user",
      at: "2026-03-09T00:00:00.000Z",
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      content: "older assistant",
      at: "2026-03-09T00:00:01.000Z",
    },
    {
      id: "user-2",
      role: "user" as const,
      content: "newer user updated",
      at: "2026-03-09T00:00:02.000Z",
    },
  ];

  const merged = mergeMessages(current, incoming);

  expect(merged.map(message => message.id)).toEqual(["user-1", "assistant-1", "user-2", "assistant-2"]);
  expect(merged.find(message => message.id === "user-2")?.content).toBe("newer user updated");
});
