import { expect, test } from "bun:test";

import { applyMessageCodeHighlight } from "./chat-helpers";

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
