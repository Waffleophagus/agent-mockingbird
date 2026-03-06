import { describe, expect, test } from "bun:test";

import {
  extractBackgroundAnnouncements,
  mergeMessages,
  shouldHideMirroredAssistantContent,
  type LocalChatMessage,
} from "@/frontend/app/chatHelpers";
import type { ChatMessage } from "@agent-mockingbird/contracts/dashboard";

function assistantMessage(input?: Partial<ChatMessage>): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "Thinking text",
    at: new Date().toISOString(),
    ...input,
  };
}

describe("shouldHideMirroredAssistantContent", () => {
  test("returns true when assistant content mirrors a visible thinking part", () => {
    const message = assistantMessage({
      content: "Think this through carefully",
      parts: [
        {
          id: "thinking-1",
          type: "thinking",
          text: "Think this through carefully",
        },
      ],
    });
    expect(shouldHideMirroredAssistantContent(message, true)).toBe(true);
  });

  test("returns false when thinking details are hidden", () => {
    const message = assistantMessage({
      content: "Think this through carefully",
      parts: [
        {
          id: "thinking-1",
          type: "thinking",
          text: "Think this through carefully",
        },
      ],
    });
    expect(shouldHideMirroredAssistantContent(message, false)).toBe(false);
  });

  test("returns false when content does not mirror thinking text", () => {
    const message = assistantMessage({
      content: "Final answer for the user",
      parts: [
        {
          id: "thinking-1",
          type: "thinking",
          text: "Internal chain of thought",
        },
      ],
    });
    expect(shouldHideMirroredAssistantContent(message, true)).toBe(false);
  });
});

describe("mergeMessages", () => {
  test("sorts merged messages chronologically with deterministic user-first tie breaks", () => {
    const base = new Date("2026-02-27T12:00:00.000Z");
    const current: LocalChatMessage[] = [
      {
        id: "assistant-late",
        role: "assistant",
        content: "later",
        at: new Date(base.getTime() + 1_000).toISOString(),
      },
    ];
    const incoming = [
      {
        id: "assistant-early",
        role: "assistant",
        content: "earlier",
        at: base.toISOString(),
      },
      {
        id: "user-early",
        role: "user",
        content: "prompt",
        at: base.toISOString(),
      },
    ] as ChatMessage[];

    const merged = mergeMessages(current, incoming);
    expect(merged.map(message => message.id)).toEqual(["user-early", "assistant-early", "assistant-late"]);
  });

  test("preserves existing uiMeta while updating incoming message fields", () => {
    const existing: LocalChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        at: new Date("2026-02-27T12:00:00.000Z").toISOString(),
        uiMeta: {
          type: "assistant-pending" as const,
          requestId: "req-1",
          status: "pending" as const,
          retryContent: "hello",
        },
      },
    ];

    const merged = mergeMessages(existing, [
      {
        id: "assistant-1",
        role: "assistant",
        content: "updated",
        at: new Date("2026-02-27T12:00:01.000Z").toISOString(),
      },
    ]);

    expect(merged[0]?.content).toBe("updated");
    expect(merged[0]?.uiMeta).toEqual(existing[0]?.uiMeta);
  });
});

describe("extractBackgroundAnnouncements", () => {
  test("extracts a background announcement and leaves non-announcement copy behind", () => {
    const content = [
      "[Background bg-123] Story finished successfully.",
      "Child session: session-child-1",
      "",
      "Here are the merged results.",
    ].join("\n");

    const parsed = extractBackgroundAnnouncements(content);
    expect(parsed.announcements).toEqual([
      {
        runId: "bg-123",
        summary: "Story finished successfully.",
        childSessionId: "session-child-1",
        raw: "[Background bg-123] Story finished successfully.\nChild session: session-child-1",
      },
    ]);
    expect(parsed.remainingContent).toBe("Here are the merged results.");
  });

  test("returns original content when no background announcement exists", () => {
    const parsed = extractBackgroundAnnouncements("Normal assistant reply");
    expect(parsed.announcements).toEqual([]);
    expect(parsed.remainingContent).toBe("Normal assistant reply");
  });
});
