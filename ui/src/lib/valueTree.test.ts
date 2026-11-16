import { expect, test } from "vitest";
import type { FsValue } from "./firestoreValue";
import { buildValueTree, countNodes, DEFAULT_LIMITS } from "./valueTree";

test("every wire type gets its type and the one-line preview the list view uses", () => {
  const tree = buildValueTree({
    s: { stringValue: "Tokyo" },
    i: { integerValue: "14000000" },
    d: { doubleValue: 1.5 },
    nan: { doubleValue: "NaN" },
    b: { booleanValue: true },
    n: { nullValue: null },
    t: { timestampValue: "2026-01-02T03:04:05Z" },
    g: { geoPointValue: { latitude: 35.68, longitude: 139.69 } },
    r: { referenceValue: "projects/p/databases/(default)/documents/users/a" },
    y: { bytesValue: "AAEC" },
  });
  const byKey = Object.fromEntries(tree.map((n) => [n.key, n]));
  expect(tree.map((n) => n.key)).toEqual(["b", "d", "g", "i", "n", "nan", "r", "s", "t", "y"]);
  expect(byKey.s).toEqual({
    key: "s",
    type: "string",
    preview: '"Tokyo"',
    size: 0,
    children: [],
    omitted: 0,
  });
  expect(byKey.i).toMatchObject({ type: "number", numberKind: "integer", preview: "14000000" });
  expect(byKey.d).toMatchObject({ type: "number", numberKind: "double", preview: "1.5" });
  expect(byKey.nan).toMatchObject({ type: "number", numberKind: "double", preview: "NaN" });
  expect(byKey.b).toMatchObject({ type: "boolean", preview: "true" });
  expect(byKey.b).not.toHaveProperty("numberKind");
  expect(byKey.n).toMatchObject({ type: "null", preview: "null" });
  expect(byKey.t).toMatchObject({ type: "timestamp", preview: "2026-01-02T03:04:05Z" });
  expect(byKey.g).toMatchObject({ type: "geopoint", preview: "[35.68, 139.69]" });
  expect(byKey.r).toMatchObject({
    type: "reference",
    preview: "users/a",
    reference: "projects/p/databases/(default)/documents/users/a",
  });
  expect(byKey.t).not.toHaveProperty("reference");
  expect(byKey.y).toMatchObject({ type: "bytes", preview: "bytes(4)" });
});

test("maps expose their entries sorted by name and arrays theirs by index", () => {
  const [profile, tags] = buildValueTree({
    tags: { arrayValue: { values: [{ stringValue: "b" }, { stringValue: "a" }] } },
    profile: {
      mapValue: { fields: { zip: { stringValue: "1" }, active: { booleanValue: true } } },
    },
  });
  expect(profile).toMatchObject({ key: "profile", type: "map", size: 2, omitted: 0 });
  expect(profile!.preview).toBe('{"zip":"1","active":true}');
  expect(profile!.children.map((c) => c.key)).toEqual(["active", "zip"]);
  expect(tags).toMatchObject({ key: "tags", type: "array", size: 2, preview: '["b","a"]' });
  expect(tags!.children.map((c) => [c.key, c.preview])).toEqual([
    ["0", '"b"'],
    ["1", '"a"'],
  ]);
});

test("empty and absent containers have no children and nothing omitted", () => {
  const tree = buildValueTree({
    a: { arrayValue: {} },
    m: { mapValue: {} },
    e: { arrayValue: { values: [] } },
  });
  for (const node of tree) {
    expect(node).toMatchObject({ size: 0, children: [], omitted: 0 });
  }
  expect(buildValueTree(undefined)).toEqual([]);
});

test("a wide container shows the first entries and counts the rest", () => {
  const values: FsValue[] = Array.from({ length: 5 }, (_, i) => ({ integerValue: String(i) }));
  const limits = { ...DEFAULT_LIMITS, maxChildren: 3 };
  const [node] = buildValueTree({ wide: { arrayValue: { values } } }, limits);
  expect(node!.size).toBe(5);
  expect(node!.children.map((c) => c.key)).toEqual(["0", "1", "2"]);
  expect(node!.omitted).toBe(2);
  const [exact] = buildValueTree({ wide: { arrayValue: { values: values.slice(0, 3) } } }, limits);
  expect(exact!.children).toHaveLength(3);
  expect(exact!.omitted).toBe(0);
});

test("nesting stops at the depth limit and reports what it left out", () => {
  let value: FsValue = { stringValue: "leaf" };
  for (let i = 0; i < 6; i += 1) value = { mapValue: { fields: { next: value, other: value } } };
  const limits = { ...DEFAULT_LIMITS, maxDepth: 2 };
  const [top] = buildValueTree({ top: value }, limits);
  // depth 0 and 1 expand; the nodes at depth 2 keep their size but no children.
  const level1 = top!.children[0]!;
  const level2 = level1.children[0]!;
  expect(top!.children).toHaveLength(2);
  expect(level1.children).toHaveLength(2);
  expect(level2).toMatchObject({ type: "map", size: 2, children: [], omitted: 2 });
  expect(countNodes([top!])).toBe(1 + 2 + 4);
});

test("a long preview is cut with an ellipsis at the limit, a short one is untouched", () => {
  const limits = { ...DEFAULT_LIMITS, maxPreview: 5 };
  const [long, short] = buildValueTree(
    { a: { stringValue: "abcdefgh" }, b: { stringValue: "abc" } },
    limits,
  );
  expect(long!.preview).toBe('"abcd…');
  expect(short!.preview).toBe('"abc"');
});

test("the default limits bound the rendered nodes of a hostile document", () => {
  const values: FsValue[] = Array.from({ length: 5000 }, () => ({ nullValue: null }));
  const [node] = buildValueTree({ big: { arrayValue: { values } } });
  expect(node!.children).toHaveLength(DEFAULT_LIMITS.maxChildren);
  expect(node!.omitted).toBe(5000 - DEFAULT_LIMITS.maxChildren);
  expect(node!.preview.length).toBe(DEFAULT_LIMITS.maxPreview + 1);
});

test("prototype-named fields are ordinary keys", () => {
  const tree = buildValueTree(
    JSON.parse('{"__proto__":{"stringValue":"x"},"constructor":{"stringValue":"y"}}'),
  );
  expect(tree.map((n) => n.key).toSorted()).toEqual(["__proto__", "constructor"]);
});
