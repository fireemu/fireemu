import { createSignal, type Accessor } from "solid-js";

// Uploads one job at a time. A job added while another runs waits its turn instead of being
// dropped, so files dropped or picked during an upload are not lost. `onStart` runs once when
// the queue goes from idle to busy (for example to clear the previous run's messages).

export type UploadQueue<T> = {
  /** `started` when the queue was idle, `queued` when the job waits behind others. */
  add: (job: T) => "started" | "queued";
  pending: Accessor<boolean>;
  /** Jobs waiting behind the one that runs. */
  queued: Accessor<number>;
  /** Resolves when no job runs or waits. */
  idle: () => Promise<void>;
};

export const createUploadQueue = <T>(options: {
  run: (job: T) => Promise<void>;
  onStart?: () => void;
}): UploadQueue<T> => {
  const waiting: T[] = [];
  const [pending, setPending] = createSignal(false);
  const [queued, setQueued] = createSignal(0);
  let running: Promise<void> | null = null;
  const drain = async () => {
    try {
      for (let job = waiting.shift(); job !== undefined; job = waiting.shift()) {
        setQueued(waiting.length);
        try {
          await options.run(job);
        } catch {
          // A job reports its own failure; the jobs behind it still run.
        }
      }
    } finally {
      running = null;
      setPending(false);
    }
  };
  return {
    add: (job) => {
      waiting.push(job);
      if (running !== null) {
        setQueued(waiting.length);
        return "queued";
      }
      setPending(true);
      options.onStart?.();
      running = drain();
      return "started";
    },
    pending,
    queued,
    idle: () => running ?? Promise.resolve(),
  };
};
