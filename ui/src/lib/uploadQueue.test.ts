import { expect, test } from "vitest";
import { createRoot } from "solid-js";
import { createUploadQueue } from "./uploadQueue";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

test("a job added while one runs is queued, then runs after it, in order", async () => {
  await createRoot(async (dispose) => {
    const seen: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const starts: number[] = [];
    const queue = createUploadQueue<string>({
      onStart: () => starts.push(seen.length),
      run: async (job) => {
        seen.push(job);
        const gate = deferred();
        gates.set(job, gate);
        await gate.promise;
      },
    });
    expect(queue.add("a")).toBe("started");
    expect(queue.pending()).toBe(true);
    expect(queue.add("b")).toBe("queued");
    expect(queue.add("c")).toBe("queued");
    expect(queue.queued()).toBe(2);
    await tick();
    expect(seen).toEqual(["a"]);
    gates.get("a")!.resolve();
    await tick();
    expect(seen).toEqual(["a", "b"]);
    expect(queue.queued()).toBe(1);
    gates.get("b")!.resolve();
    await tick();
    gates.get("c")!.resolve();
    await queue.idle();
    expect(seen).toEqual(["a", "b", "c"]);
    expect(queue.pending()).toBe(false);
    expect(queue.queued()).toBe(0);
    // onStart runs once per busy period, not per job.
    expect(starts).toEqual([0]);
    expect(queue.add("d")).toBe("started");
    gates.get("d")?.resolve();
    await tick();
    gates.get("d")!.resolve();
    await queue.idle();
    expect(starts).toEqual([0, 3]);
    dispose();
  });
});

test("a failing job does not lose the jobs queued behind it", async () => {
  await createRoot(async (dispose) => {
    const seen: string[] = [];
    const queue = createUploadQueue<string>({
      run: async (job) => {
        seen.push(job);
        await tick();
        if (job === "a") throw new Error("boom");
      },
    });
    queue.add("a");
    queue.add("b");
    await queue.idle();
    expect(seen).toEqual(["a", "b"]);
    expect(queue.pending()).toBe(false);
    dispose();
  });
});

test("idle resolves at once when nothing runs", async () => {
  await createRoot(async (dispose) => {
    const queue = createUploadQueue<string>({ run: async () => undefined });
    await queue.idle();
    expect(queue.pending()).toBe(false);
    dispose();
  });
});
