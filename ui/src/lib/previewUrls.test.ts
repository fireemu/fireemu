import { expect, test, vi } from "vitest";
import { createPreviewUrls } from "./previewUrls";

const setup = () => {
  let n = 0;
  const create = vi.fn((_blob: Blob) => `blob:${(n += 1)}`);
  const revoke = vi.fn((_url: string) => undefined);
  return { urls: createPreviewUrls({ create, revoke }), create, revoke };
};
const blob = new Blob(["x"]);

test("the latest fetch's URL is shown and replaces the one before it", () => {
  const { urls, revoke } = setup();
  const first = urls.begin();
  expect(urls.adopt(first, blob)).toBe("blob:1");
  const second = urls.begin();
  expect(revoke).not.toHaveBeenCalled();
  expect(urls.adopt(second, blob)).toBe("blob:2");
  expect(revoke.mock.calls).toEqual([["blob:1"]]);
});

test("an older fetch that resolves last neither revokes the shown URL nor creates one", () => {
  const { urls, create, revoke } = setup();
  const older = urls.begin();
  const newer = urls.begin();
  expect(urls.adopt(newer, blob)).toBe("blob:1");
  expect(urls.adopt(older, blob)).toBeNull();
  expect(create).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalled();
  urls.dispose();
  expect(revoke.mock.calls).toEqual([["blob:1"]]);
});

test("an older fetch that resolves first is dropped once a newer one has begun", () => {
  const { urls, create } = setup();
  const older = urls.begin();
  urls.begin();
  expect(urls.adopt(older, blob)).toBeNull();
  expect(create).not.toHaveBeenCalled();
});

test("dispose revokes once, and nothing is adopted after it", () => {
  const { urls, create, revoke } = setup();
  urls.adopt(urls.begin(), blob);
  const late = urls.begin();
  urls.dispose();
  urls.dispose();
  expect(urls.adopt(late, blob)).toBeNull();
  expect(create).toHaveBeenCalledTimes(1);
  expect(revoke.mock.calls).toEqual([["blob:1"]]);
});

// Any interleaving of begin/adopt/dispose: every created URL is revoked exactly once by the end,
// and the URL returned last is the one alive until then.
test("every created URL is revoked exactly once across random interleavings", () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let round = 0; round < 300; round += 1) {
    const { urls, create, revoke } = setup();
    const tokens: number[] = [];
    for (let step = 0; step < 12; step += 1) {
      const r = random();
      if (r < 0.4) tokens.push(urls.begin());
      else if (tokens.length > 0) {
        const index = Math.floor(random() * tokens.length);
        const [token] = tokens.splice(index, 1);
        urls.adopt(token!, random() < 0.3 ? null : blob);
      }
      const created = create.mock.results.map((x) => x.value as string);
      const revoked = new Set(revoke.mock.calls.map((c) => c[0]));
      // At most one created URL is alive at any time.
      expect(created.filter((u) => !revoked.has(u)).length).toBeLessThanOrEqual(1);
    }
    urls.dispose();
    const created = create.mock.results.map((x) => x.value as string).toSorted();
    expect(revoke.mock.calls.map((c) => c[0]).toSorted()).toEqual(created);
  }
});

test("a fetch that shows no image clears the shown URL only while it is the latest", () => {
  const { urls, revoke } = setup();
  const older = urls.begin();
  const newer = urls.begin();
  expect(urls.adopt(newer, blob)).toBe("blob:1");
  // An older text or failed fetch resolving last must not take the newer image away.
  expect(urls.adopt(older, null)).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  expect(urls.adopt(urls.begin(), null)).toBeNull();
  expect(revoke.mock.calls).toEqual([["blob:1"]]);
});
