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
    expect(plainJsonToFsFields("null").isErr()).toBe(true);
    expect(plainJsonToFsFields('{"": 1}').isErr()).toBe(true);
    expect(plainJsonToFsFields('{"bad": [[1]]}').isErr()).toBe(true);
    expect(plainJsonToFsFields("{bad").isErr()).toBe(true);
  });

  it("handles empty maps/arrays, type changes, new keys, and reordered array elements", () => {
    expect(
      fsFieldsToPlainJson({
        emptyArr: { arrayValue: {} },
        emptyMap: { mapValue: {} },
      }),
    ).toEqual({ emptyArr: [], emptyMap: {} });
    expect(fsFieldsToPlainJson(undefined)).toEqual({});

    const original = {
      list: {
        arrayValue: {
          values: [
            { timestampValue: "2026-08-29T12:00:00Z" },
            { doubleValue: 5 },
            { stringValue: "keep" },
          ],
        },
      },
      wasStringNowArray: { stringValue: "old" },
      wasStringNowMap: { stringValue: "old" },
      emptyMap: { mapValue: {} },
      deepArr: {
        arrayValue: {
          values: [
            { mapValue: { fields: { a: { integerValue: "1" }, b: { integerValue: "2" } } } },
          ],
        },
      },
    };
    const reparsed = plainJsonToFsFields(
      JSON.stringify({
        list: ["inserted", 5, "2026-08-29T12:00:00Z", "keep"],
        wasStringNowArray: ["x"],
        wasStringNowMap: { added: true },
        emptyMap: { fresh: 1 },
        deepArr: [{ a: 1, b: 2 }, { a: 1 }],
        brandNew: "hello",
      }),
      original,
    );
    expect(reparsed.isOk()).toBe(true);
    const out = reparsed._unsafeUnwrap();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(out.list).toEqual({
      arrayValue: {
        values: [
          { stringValue: "inserted" },
          { doubleValue: 5 },
          { timestampValue: "2026-08-29T12:00:00Z" },
          { stringValue: "keep" },
        ],
      },
    });
    expect(out.wasStringNowArray).toEqual({ arrayValue: { values: [{ stringValue: "x" }] } });
    expect(out.wasStringNowMap).toEqual({
      mapValue: { fields: { added: { booleanValue: true } } },
    });
    const mapField = out.wasStringNowMap;
    expect(mapField && "mapValue" in mapField).toBe(true);
    if (mapField && "mapValue" in mapField) {
      expect(Object.getPrototypeOf(mapField.mapValue.fields)).toBe(Object.prototype);
    }
    expect(out.emptyMap).toEqual({ mapValue: { fields: { fresh: { integerValue: "1" } } } });
    expect(out.brandNew).toEqual({ stringValue: "hello" });
  });

  it("keeps a __proto__ field in the plain JSON so the server can refuse its reserved name", () => {
    // JSON.parse creates an own `__proto__` key, as a REST reply or a form map would.
    const fields = JSON.parse(
      '{"__proto__":{"nullValue":null},"m":{"mapValue":{"fields":{"__proto__":{"stringValue":"x"}}}}}',
    ) as Record<string, never>;
    const plain = fsFieldsToPlainJson(fields);
    const text = JSON.stringify(plain);
    expect(text).toBe('{"__proto__":null,"m":{"__proto__":"x"}}');
    // Converting the text back keeps the key, so the write reaches the server and is refused there.
    const back = plainJsonToFsFields(text)._unsafeUnwrap();
    expect(Object.keys(back)).toEqual(["__proto__", "m"]);
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
  });
});
