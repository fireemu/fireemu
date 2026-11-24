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
  });

  it("extracts sorted child entries for objects and indexed entries for arrays", () => {
    const obj = parseRtdbTree('{"z":1,"a":{"x":true},"b":[1,2]}', "/rooms");
    expect(obj).toEqual({
      truncated: 0,
      entries: [
        { key: "a", path: "/rooms/a", kind: "object", preview: "{1}", childCount: 1 },
        { key: "b", path: "/rooms/b", kind: "array", preview: "[2]", childCount: 2 },
        { key: "z", path: "/rooms/z", kind: "number", preview: "1" },
      ],
    });

    const arr = parseRtdbTree('["hi",null,"yo"]', "/");
    expect(arr?.entries.map((e) => [e.key, e.path, e.kind])).toEqual([
      ["0", "/0", "string"],
      ["2", "/2", "string"],
    ]);

    const intSorted = parseRtdbTree('{"10":"ten","2":"two","a":"alpha"}', "/");
    expect(intSorted?.entries.map((e) => e.key)).toEqual(["2", "10", "a"]);
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
