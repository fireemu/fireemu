import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js";

/**
 * The subset of the Solid 1.x `createResource` contract the pages rely on, rebuilt on Solid 2
 * signals. Solid 2 removed `createResource` in favour of async memos under a `<Loading>`
 * boundary; the pages instead keep showing the previous value while a refetch runs and render
 * their own spinners and error banners, so they keep this explicit shape.
 *
 * - The fetcher runs when the source becomes a value other than `null`, `undefined` or `false`,
 *   and again on every change of the source.
 * - `data()` and `latest` hold the last settled value (kept while a newer fetch runs).
 * - Only the newest fetch may settle the resource; an older one that finishes late is ignored.
 * - `mutate` replaces the value without cancelling a fetch in flight (as in Solid 1.x).
 * - `loading` is `true` from the start of a fetch until the newest one settles.
 */
export type Resource<T> = Accessor<T | undefined> & {
  readonly loading: boolean;
  readonly error: unknown;
  readonly latest: T | undefined;
};

export type ResourceActions<T> = {
  refetch: () => Promise<T | undefined>;
  mutate: (value: T | undefined) => void;
};

type Source<S> = S | null | undefined | false;

export function createResource<T>(
  fetcher: () => T | PromiseLike<T>,
): [Resource<T>, ResourceActions<T>];
export function createResource<T, S>(
  source: Accessor<Source<S>>,
  fetcher: (source: S) => T | PromiseLike<T>,
): [Resource<T>, ResourceActions<T>];
export function createResource<T, S>(
  first: Accessor<Source<S>> | (() => T | PromiseLike<T>),
  second?: (source: S) => T | PromiseLike<T>,
): [Resource<T>, ResourceActions<T>] {
  const source: Accessor<Source<S>> = second
    ? (first as Accessor<Source<S>>)
    : () => true as unknown as S;
  const fetcher: (source: S) => T | PromiseLike<T> =
    second ?? (() => (first as () => T | PromiseLike<T>)());
  const [value, setValue] = createSignal<T | undefined>(undefined);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<unknown>(undefined);
  let generation = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    generation++;
  });

  const run = (key: Source<S>): Promise<T | undefined> => {
    if (key === null || key === undefined || key === false) return Promise.resolve(untrack(value));
    const mine = ++generation;
    setLoading(true);
    let pending: T | PromiseLike<T>;
    try {
      pending = fetcher(key);
    } catch (e) {
      pending = Promise.reject(e);
    }
    return Promise.resolve(pending).then(
      (result) => {
        if (!disposed && mine === generation) {
          setValue(() => result);
          setError(undefined);
          setLoading(false);
        }
        return result;
      },
      (e: unknown) => {
        if (!disposed && mine === generation) {
          setError(() => e);
          setLoading(false);
        }
        return undefined;
      },
    );
  };

  createEffect(source, (key) => {
    void run(key);
  });

  const resource = (() => value()) as Resource<T>;
  Object.defineProperties(resource, {
    loading: { get: loading },
    error: { get: error },
    latest: { get: value },
  });
  return [
    resource,
    {
      refetch: () => run(untrack(source)),
      mutate: (next) => setValue(() => next),
    },
  ];
}
