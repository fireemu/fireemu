import { describe, expect, it } from "vitest";
import { createRoot, flush } from "solid-js";
import { createLatestSignal } from "./latestSignal";

describe("createLatestSignal", () => {
  it("reads a write back at once through peek and after the flush through the accessor", () => {
    const [read, write, peek] = createRoot(() => createLatestSignal(1));
    write(2);
    expect(peek()).toBe(2);
    write((previous) => previous + 10);
    expect(peek()).toBe(12);
    flush();
    expect(read()).toBe(12);
  });
});
