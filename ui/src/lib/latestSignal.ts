import { createSignal, type Accessor } from "solid-js";

/**
 * A signal whose last written value can be read back at once. Solid 2 commits signal writes on
 * the next microtask, so `read()` right after `write()` still returns the old value; logic that
 * decides from state it may have written in the same tick (a refresh right after a failed load)
 * reads `peek()` instead. `read` stays the tracked accessor for rendering.
 */
export const createLatestSignal = <T>(
  initial: Exclude<T, Function>,
): [read: Accessor<T>, write: (next: T | ((previous: T) => T)) => void, peek: () => T] => {
  let latest: T = initial;
  const [read, set] = createSignal<T>(initial);
  const write = (next: T | ((previous: T) => T)) => {
    latest = typeof next === "function" ? (next as (previous: T) => T)(latest) : next;
    const value = latest;
    set(() => value);
  };
  return [read, write, () => latest];
};
