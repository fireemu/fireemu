import { describe, expect, it } from "vitest";
import { fsFieldsToPlainJson, plainJsonToFsFields } from "./firestoreJson";

describe("firestoreJson", () => {
  it("converts Firestore REST fields to plain JSON", () => {
    const plain = fsFieldsToPlainJson({
      name: { stringValue: "Tokyo" },
      pop: { integerValue: "14000000" },
      ratio: { doubleValue: 1.5 },
      capital: { booleanValue: true },
      empty: { nullValue: null },
      tags: { arrayValue: { values: [{ stringValue: "a" }, { integerValue: "2" }] } },
      meta: { mapValue: { fields: { active: { booleanValue: false } } } },
    });
    expect(plain).toEqual({
      name: "Tokyo",
      pop: 14000000,
      ratio: 1.5,
      capital: true,
      empty: null,
      tags: ["a", 2],
      meta: { active: false },
    });
  });

  it("parses plain JSON objects into Firestore REST fields", () => {
    const parsed = plainJsonToFsFields(
      JSON.stringify({
        city: "Osaka",
        count: 42,
        score: 3.14,
        flag: false,
        nothing: null,
        items: ["x", { nested: 1 }],
      }),
    );
    expect(parsed.isOk()).toBe(true);
    expect(parsed._unsafeUnwrap()).toEqual({
      city: { stringValue: "Osaka" },
      count: { integerValue: "42" },
      score: { doubleValue: 3.14 },
      flag: { booleanValue: false },
      nothing: { nullValue: null },
      items: {
        arrayValue: {
          values: [
            { stringValue: "x" },
            { mapValue: { fields: { nested: { integerValue: "1" } } } },
          ],
        },
      },
    });
  });

  it("preserves original special Firestore types when unchanged in JSON mode", () => {
    const original = {
      createdAt: { timestampValue: "2026-08-29T12:00:00Z" },
      ref: { referenceValue: "projects/p/databases/(default)/documents/users/u1" },
      blob: { bytesValue: "AQID" },
      loc: { geoPointValue: { latitude: 35.6, longitude: 139.7 } },
      bigInt: { integerValue: "9007199254740993" },
      wholeDouble: { doubleValue: 5 },
      nested: {
        mapValue: {
          fields: {
            at: { timestampValue: "2026-08-29T12:00:00Z" },
            title: { stringValue: "old" },
          },
        },
      },
    };
    const plain = fsFieldsToPlainJson(original);
    (plain.nested as Record<string, unknown>).title = "new";
    const reparsed = plainJsonToFsFields(JSON.stringify(plain), original);
    expect(reparsed.isOk()).toBe(true);
    expect(reparsed._unsafeUnwrap()).toEqual({
      ...original,
      nested: {
        mapValue: {
          fields: {
            at: { timestampValue: "2026-08-29T12:00:00Z" },
            title: { stringValue: "new" },
          },
        },
      },
    });
  });

  it("rejects non-object roots, empty keys, and nested arrays", () => {
    expect(plainJsonToFsFields("[1,2]").isErr()).toBe(true);
    expect(plainJsonToFsFields('{"": 1}').isErr()).toBe(true);
    expect(plainJsonToFsFields('{"bad": [[1]]}').isErr()).toBe(true);
    expect(plainJsonToFsFields("{bad").isErr()).toBe(true);
  });
});
