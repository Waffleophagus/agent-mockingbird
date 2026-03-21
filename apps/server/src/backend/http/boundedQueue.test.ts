import { describe, expect, test } from "bun:test";

import { createBoundedQueue } from "./boundedQueue";

describe("createBoundedQueue", () => {
  test("overflows when the writer stays blocked", async () => {
    let overflowed = false;
    const queue = createBoundedQueue<string>({
      maxSize: 2,
      drainDelayMs: 5,
      tryWrite: () => false,
      onOverflow: () => {
        overflowed = true;
      },
    });

    expect(queue.enqueue("a")).toBe(true);
    expect(queue.enqueue("b")).toBe(true);
    expect(queue.enqueue("c")).toBe(false);
    expect(overflowed).toBe(true);
  });

  test("drains queued frames once the writer becomes writable", async () => {
    const written: string[] = [];
    let writable = false;
    const queue = createBoundedQueue<string>({
      maxSize: 4,
      drainDelayMs: 5,
      tryWrite: (value) => {
        if (!writable) return false;
        written.push(value);
        return true;
      },
      onOverflow: () => {
        throw new Error("queue should not overflow");
      },
    });

    queue.enqueue("first");
    queue.enqueue("second");
    expect(queue.size()).toBe(2);

    writable = true;
    await Bun.sleep(20);

    expect(written).toEqual(["first", "second"]);
    expect(queue.size()).toBe(0);
  });

  test("retries after a re-entrant enqueue during a blocked drain", async () => {
    const written: string[] = [];
    let writable = false;
    let queuedExtra = false;
    const queue = createBoundedQueue<string>({
      maxSize: 4,
      drainDelayMs: 5,
      tryWrite: (value) => {
        if (!queuedExtra) {
          queuedExtra = true;
          expect(queue.enqueue("second")).toBe(true);
        }
        if (!writable) return false;
        written.push(value);
        return true;
      },
      onOverflow: () => {
        throw new Error("queue should not overflow");
      },
    });

    expect(queue.enqueue("first")).toBe(true);
    expect(queue.size()).toBe(2);

    writable = true;
    await Bun.sleep(20);

    expect(written).toEqual(["first", "second"]);
    expect(queue.size()).toBe(0);
  });
});
