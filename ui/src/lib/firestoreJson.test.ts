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

  it("rejects non-object roots, empty keys, and nested arrays", () => {
    expect(plainJsonToFsFields("[1,2]").isErr()).toBe(true);
    expect(plainJsonToFsFields('{"": 1}').isErr()).toBe(true);
    expect(plainJsonToFsFields('{"bad": [[1]]}').isErr()).toBe(true);
    expect(plainJsonToFsFields("{bad").isErr()).toBe(true);
  });
});
