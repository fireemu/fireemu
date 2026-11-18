import { describe, expect, it } from "vitest";
import { render, waitFor } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { ok, err, type Result } from "neverthrow";
import { createScopedFetch } from "./rules-state";
import type { ApiError } from "../api/client";

const deferred = () => {
  let resolve!: (r: Result<string, ApiError>) => void;
  const promise = new Promise<Result<string, ApiError>>((r) => (resolve = r));
  return { promise, resolve };
};

describe("scope-owned diagnostics reads", () => {
  it("retains success through refreshing and errors, then recovers on retry", async () => {
    const calls = [deferred(), deferred(), deferred()];
    let n = 0;
    let resource!: ReturnType<typeof createScopedFetch<string>>;
    const ui = render(() => {
      resource = createScopedFetch(
        () => "a",
        () => calls[n++]!.promise,
      );
      return <span>{resource.data()}</span>;
    });
    expect(resource.loading()).toBe(true);
    calls[0]!.resolve(ok("recorded"));
    flush();
    await waitFor(() => expect(resource.data()).toBe("recorded"));
    const refresh = resource.refetch();
    flush();
    expect(resource.data()).toBe("recorded");
    expect(resource.loading()).toBe(true);
    calls[1]!.resolve(err({ status: 500, message: "offline" }));
    flush();
    await refresh;
    flush();
    expect(resource.data()).toBe("recorded");
    expect(resource.error()).toBe("offline");
    const retry = resource.refetch();
    flush();
    calls[2]!.resolve(ok("new"));
    flush();
    await retry;
    flush();
    expect(resource.data()).toBe("new");
    expect(resource.error()).toBeNull();
    ui.unmount();
  });
  it("rejects late old-scope and superseded reads, including A/B/A and disposal", async () => {
    const [scope, setScope] = createSignal("a");
    const calls: ReturnType<typeof deferred>[] = [];
    let resource!: ReturnType<typeof createScopedFetch<string>>;
    const ui = render(() => {
      resource = createScopedFetch(scope, () => {
        const d = deferred();
        calls.push(d);
        return d.promise;
      });
      return <span>{resource.data()}</span>;
    });
    calls[0]!.resolve(ok("a old"));
    flush();
    await waitFor(() => expect(resource.data()).toBe("a old"));
    const old = resource.refetch();
    flush();
    setScope("b");
    await waitFor(() => expect(calls.length).toBe(3));
    expect(resource.data()).toBeUndefined();
    setScope("a");
    await waitFor(() => expect(calls.length).toBe(4));
    calls[1]!.resolve(ok("stale a"));
    flush();
    calls[2]!.resolve(ok("late b"));
    flush();
    await old;
    flush();
    expect(resource.data()).toBeUndefined();
    calls[3]!.resolve(ok("fresh a"));
    flush();
    await waitFor(() => expect(resource.data()).toBe("fresh a"));
    const late = resource.refetch();
    flush();
    ui.unmount();
    calls[4]!.resolve(ok("disposed"));
    flush();
    await late;
    flush();
    expect(resource.data()).toBe("fresh a");
  });
});
