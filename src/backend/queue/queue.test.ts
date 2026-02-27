import { beforeEach, describe, expect, test } from "bun:test";

import { LaneQueue } from "./service";
import type { QueueConfig } from "./types";

const defaultConfig: QueueConfig = {
  enabled: true,
  defaultMode: "collect",
  maxDepth: 10,
  coalesceDebounceMs: 500,
};

describe("LaneQueue", () => {
  let queue: LaneQueue;

  beforeEach(() => {
    queue = new LaneQueue(defaultConfig);
  });

  describe("enqueue", () => {
    test("queues message when enabled", () => {
      const result = queue.enqueue("session-1", "Hello");
      expect(result.queued).toBe(true);
      expect(result.depth).toBe(1);
    });

    test("returns depth after multiple enqueues", () => {
      queue.enqueue("session-1", "Message 1");
      queue.enqueue("session-1", "Message 2");
      const result = queue.enqueue("session-1", "Message 3");
      expect(result.depth).toBe(3);
    });

    test("respects maxDepth", () => {
      const smallQueue = new LaneQueue({ ...defaultConfig, maxDepth: 2 });
      smallQueue.enqueue("session-1", "Message 1");
      smallQueue.enqueue("session-1", "Message 2");
      const result = smallQueue.enqueue("session-1", "Message 3");
      expect(result.depth).toBe(2);
    });

    test("does not queue when disabled", () => {
      const disabledQueue = new LaneQueue({ ...defaultConfig, enabled: false });
      const result = disabledQueue.enqueue("session-1", "Hello");
      expect(result.queued).toBe(false);
      expect(result.depth).toBe(0);
    });
  });

  describe("modes", () => {
    test("replace mode keeps only latest", () => {
      queue.setMode("session-1", "replace");
      queue.enqueue("session-1", "Message 1");
      queue.enqueue("session-1", "Message 2");
      queue.enqueue("session-1", "Message 3");

      const drained = queue.drain("session-1");
      expect(drained).toHaveLength(1);
      expect(drained?.[0]?.content).toBe("Message 3");
    });

    test("collect mode keeps all messages", () => {
      queue.setMode("session-1", "collect");
      queue.enqueue("session-1", "Message 1");
      queue.enqueue("session-1", "Message 2");

      const drained = queue.drain("session-1");
      expect(drained).toHaveLength(2);
    });

    test("followup mode queues for sequential processing", () => {
      queue.setMode("session-1", "followup");
      queue.enqueue("session-1", "Message 1");
      queue.enqueue("session-1", "Message 2");
      queue.enqueue("session-1", "Message 3");

      const drained = queue.drain("session-1");
      expect(drained).toHaveLength(3);
    });
  });

  describe("drain", () => {
    test("returns null for empty queue", () => {
      const drained = queue.drain("session-1");
      expect(drained).toBeNull();
    });

    test("removes messages from queue", () => {
      queue.enqueue("session-1", "Hello");
      queue.drain("session-1");
      expect(queue.depth("session-1")).toBe(0);
    });
  });

  describe("stats", () => {
    test("returns stats for all lanes", () => {
      queue.enqueue("session-1", "Message 1");
      queue.enqueue("session-2", "Message 2");

      const stats = queue.stats();
      expect(stats).toHaveLength(2);
    });

    test("includes depth and mode", () => {
      queue.setMode("session-1", "replace");
      queue.enqueue("session-1", "Message 1");

      const stats = queue.stats();
      expect(stats[0]?.depth).toBe(1);
      expect(stats[0]?.mode).toBe("replace");
    });
  });

  describe("clear", () => {
    test("clears queue and returns depth", () => {
      queue.enqueue("session-1", "Message 1");
      queue.enqueue("session-1", "Message 2");
      const cleared = queue.clear("session-1");
      expect(cleared).toBe(2);
      expect(queue.depth("session-1")).toBe(0);
    });
  });

  describe("getMode/setMode", () => {
    test("returns default mode when not set", () => {
      expect(queue.getMode("session-1")).toBe("collect");
    });

    test("returns set mode", () => {
      queue.setMode("session-1", "replace");
      expect(queue.getMode("session-1")).toBe("replace");
    });
  });

  describe("drainAndExecute", () => {
    test("coalesces multiple messages in collect mode", async () => {
      queue.enqueue("session-1", "Message 1");
      queue.enqueue("session-1", "Message 2");
      queue.enqueue("session-1", "Message 3");

      let receivedContent = "";
      queue.setDrainHandler(async (_sessionId, messages) => {
        receivedContent = messages[0]?.content ?? "";
      });

      const result = await queue.drainAndExecute("session-1");
      expect(result?.coalesced).toBe(true);
      expect(result?.messagesProcessed).toBe(1);
      expect(receivedContent).toContain("Message 1");
      expect(receivedContent).toContain("Message 2");
      expect(receivedContent).toContain("Message 3");
    });

    test("processes all messages in replace mode", async () => {
      queue.setMode("session-1", "replace");
      queue.enqueue("session-1", "Message 1");
      queue.enqueue("session-1", "Message 2");

      const received: string[] = [];
      queue.setDrainHandler(async (_sessionId, messages) => {
        for (const msg of messages) {
          received.push(msg.content);
        }
      });

      await queue.drainAndExecute("session-1");
      expect(received).toEqual(["Message 2"]);
    });

    test("processes first message only in followup mode", async () => {
      queue.setMode("session-1", "followup");
      queue.enqueue("session-1", "Message 1");
      queue.enqueue("session-1", "Message 2");
      queue.enqueue("session-1", "Message 3");

      const received: string[] = [];
      queue.setDrainHandler(async (_sessionId, messages) => {
        for (const msg of messages) {
          received.push(msg.content);
        }
      });

      const result = await queue.drainAndExecute("session-1");
      expect(result?.messagesProcessed).toBe(1);
      expect(received).toEqual(["Message 1"]);
      expect(queue.depth("session-1")).toBe(2);
    });
  });
});
