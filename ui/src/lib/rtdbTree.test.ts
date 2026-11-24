import { describe, expect, it } from "vitest";
import { normalizeRtdbPath, parseRtdbTree, rtdbBreadcrumbs } from "./rtdbTree";

describe("rtdbTree", () => {
  it("builds breadcrumbs from nested paths", () => {
    expect(rtdbBreadcrumbs("/", "Root")).toEqual([{ label: "Root", path: "/" }]);
    expect(rtdbBreadcrumbs("users/alice/profile/", "Root")).toEqual([
      { label: "Root", path: "/" },
      { label: "users", path: "/users" },
      { label: "alice", path: "/users/alice" },
      { label: "profile", path: "/users/alice/profile" },
    ]);
    expect(normalizeRtdbPath("//a//b/")).toBe("/a/b");
    expect(normalizeRtdbPath("/")).toBe("/");
    expect(normalizeRtdbPath("")).toBe("/");
    expect(rtdbBreadcrumbs("/a/b", "Root")).toEqual([
      { label: "Root", path: "/" },
      { label: "a", path: "/a" },
      { label: "b", path: "/a/b" },
    ]);
  });

  it("extracts sorted child entries for objects and indexed entries for arrays", () => {
    const exact80 = "x".repeat(80);
    const over80 = "y".repeat(81);
    const obj = parseRtdbTree(
      JSON.stringify({
        z: 1,
        a: { x: true },
        b: [1, 2],
        flag: false,
        empty: null,
        exact80,
        over80,
      }),
      "/rooms",
    );
    expect(obj).toEqual({
      truncated: 0,
      entries: [
        { key: "a", path: "/rooms/a", kind: "object", preview: "{1}", childCount: 1 },
        { key: "b", path: "/rooms/b", kind: "array", preview: "[2]", childCount: 2 },
        { key: "empty", path: "/rooms/empty", kind: "null", preview: "null" },
        {
          key: "exact80",
          path: "/rooms/exact80",
          kind: "string",
          preview: JSON.stringify(exact80),
        },
        { key: "flag", path: "/rooms/flag", kind: "boolean", preview: "false" },
        {
          key: "over80",
          path: "/rooms/over80",
          kind: "string",
          preview: JSON.stringify(`${"y".repeat(80)}…`),
        },
        { key: "z", path: "/rooms/z", kind: "number", preview: "1" },
      ],
    });

    const arr = parseRtdbTree('["hi",null,"yo"]', "/");
    expect(arr?.entries.map((e) => [e.key, e.path, e.kind, e.preview])).toEqual([
      ["0", "/0", "string", '"hi"'],
      ["2", "/2", "string", '"yo"'],
    ]);

    const intSorted = parseRtdbTree(
      JSON.stringify({
        "2147483648": "above-i32",
        "2147483647": "max-i32",
        "10": "ten",
        "10a": "suffix",
        "2": "two",
        "0": "zero",
        "-5": "neg",
        "-2147483648": "min-i32",
        "-2147483649": "below-i32",
        k1: "prefix",
        a: "alpha",
        b: "beta",
      }),
      "/",
    );
    expect(intSorted?.entries.map((e) => e.key)).toEqual([
      "-2147483648",
      "-5",
      "0",
      "2",
      "10",
      "2147483647",
      "-2147483649",
      "10a",
      "2147483648",
      "a",
      "b",
      "k1",
    ]);
  });

  it("returns empty entries for primitives and null for invalid JSON", () => {
    expect(parseRtdbTree("null", "/")).toEqual({ entries: [], truncated: 0 });
    expect(parseRtdbTree('"hello"', "/")).toEqual({ entries: [], truncated: 0 });
    expect(parseRtdbTree("{bad", "/")).toBeNull();
  });

  it("caps entries and reports truncated count", () => {
    const big = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, i]));
    const parsed = parseRtdbTree(JSON.stringify(big), "/", 2);
    expect(parsed?.entries).toHaveLength(2);
    expect(parsed?.truncated).toBe(3);
  });
});
