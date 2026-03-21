interface BoundedQueueOptions<T> {
  maxSize: number;
  drainDelayMs?: number;
  tryWrite: (value: T) => boolean;
  onOverflow: () => void;
  onWriteError?: (error: unknown) => void;
}

export interface BoundedQueue<T> {
  enqueue: (value: T) => boolean;
  close: () => void;
  size: () => number;
}

export function createBoundedQueue<T>(options: BoundedQueueOptions<T>): BoundedQueue<T> {
  const drainDelayMs = Math.max(1, options.drainDelayMs ?? 25);
  const queue: T[] = [];
  let closed = false;
  let draining = false;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;

  const clearDrainTimer = () => {
    if (!drainTimer) return;
    clearTimeout(drainTimer);
    drainTimer = null;
  };

  const scheduleDrain = () => {
    if (closed || drainTimer) return;
    drainTimer = setTimeout(() => {
      drainTimer = null;
      drain();
    }, drainDelayMs);
  };

  const handleWriteError = (error: unknown) => {
    if (closed) return;
    closed = true;
    queue.length = 0;
    clearDrainTimer();
    options.onWriteError?.(error);
  };

  const drain = () => {
    if (closed || draining) return;
    draining = true;
    try {
      while (!closed && queue.length > 0) {
        const next = queue[0] as T;
        let wrote = false;
        try {
          wrote = options.tryWrite(next);
        } catch (error) {
          handleWriteError(error);
          return;
        }
        if (!wrote) {
          scheduleDrain();
          return;
        }
        queue.shift();
      }
    } finally {
      draining = false;
    }
  };

  return {
    enqueue(value: T) {
      if (closed) return false;
      if (queue.length >= options.maxSize) {
        closed = true;
        queue.length = 0;
        clearDrainTimer();
        options.onOverflow();
        return false;
      }
      queue.push(value);
      drain();
      scheduleDrain();
      return true;
    },
    close() {
      closed = true;
      queue.length = 0;
      clearDrainTimer();
    },
    size() {
      return queue.length;
    },
  };
}
