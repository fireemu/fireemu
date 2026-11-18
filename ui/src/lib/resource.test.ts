import { describe, expect, it } from "vitest";
import { createRoot, createSignal, flush } from "solid-js";
import { createResource } from "./resource";

/** A promise the test settles by hand. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const settled = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    flush();
  }
};

describe("createResource", () => {
  it("fetches once a source is present and holds the value", async () => {
    const calls: string[] = [];
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal<string | null>(null);
      const [data] = createResource(source, (s) => {
        calls.push(s);
        return `v:${s}`;
      });
      await settled();
      expect(calls).toEqual([]);
      expect(data()).toBeUndefined();
      setSource("a");
      await settled();
      expect(calls).toEqual(["a"]);
      expect(data()).toBe("v:a");
      expect(data.latest).toBe("v:a");
      expect(data.loading).toBe(false);
      dispose();
    });
  });

  it("keeps the previous value while a refetch runs and reports loading", async () => {
    await createRoot(async (dispose) => {
      let next = deferred<number>();
      const [data, { refetch }] = createResource(() => next.promise);
      await settled();
      expect(data.loading).toBe(true);
      next.resolve(1);
      await settled();
      expect(data()).toBe(1);
      next = deferred<number>();
      const pending = refetch();
      await settled();
      expect(data.loading).toBe(true);
      expect(data()).toBe(1);
      next.resolve(2);
      expect(await pending).toBe(2);
      await settled();
      expect(data()).toBe(2);
      expect(data.loading).toBe(false);
      dispose();
    });
  });

  it("records a failure and keeps the last good value", async () => {
    await createRoot(async (dispose) => {
      let next = deferred<number>();
      const [data, { refetch }] = createResource(() => next.promise);
      next.resolve(1);
      await settled();
      next = deferred<number>();
      void refetch();
      next.reject(new Error("boom"));
      await settled();
      expect((data.error as Error).message).toBe("boom");
      expect(data()).toBe(1);
      expect(data.loading).toBe(false);
      dispose();
    });
  });

  it("lets mutate replace the value", async () => {
    await createRoot(async (dispose) => {
      const [data, { mutate }] = createResource(() => 1);
      await settled();
      mutate(5);
      await settled();
      expect(data()).toBe(5);
      dispose();
    });
  });

  it("settles only the newest fetch whatever order the fetches finish in", async () => {
    // Every completion order of up to four overlapping fetches (exhaustive, not sampled).
    const permutations = (items: number[]): number[][] =>
      items.length <= 1
        ? [items]
        : items.flatMap((x, i) =>
            permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) =>
              [x].concat(rest),
            ),
          );
    for (let n = 1; n <= 4; n++) {
      for (const order of permutations([...Array(n).keys()])) {
        await createRoot(async (dispose) => {
          const pending = Array.from({ length: n }, () => deferred<number>());
          let call = 0;
          const [data, { refetch }] = createResource(() => pending[call++]!.promise);
          await settled();
          for (let i = 1; i < n; i++) void refetch();
          for (const index of order) {
            pending[index]!.resolve(index);
            await settled();
          }
          expect(data()).toBe(n - 1);
          expect(data.loading).toBe(false);
          dispose();
        });
      }
    }
  });

  it("ignores a fetch that settles after disposal", async () => {
    let read: (() => number | undefined) | undefined;
    const next = deferred<number>();
    createRoot((dispose) => {
      const [data] = createResource(() => next.promise);
      read = data;
      dispose();
    });
    next.resolve(3);
    await settled();
    expect(read!()).toBeUndefined();
  });
});
