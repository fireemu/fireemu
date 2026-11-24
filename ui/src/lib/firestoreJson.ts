import { err, ok, type Result } from "neverthrow";
import type { FsValue } from "./firestoreValue";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const plainDeepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => plainDeepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && plainDeepEqual(a[k], b[k]))
    );
  }
  return false;
};

/** Convert a Firestore REST typed value to plain JSON for readable export or editing. */
export const fsValueToPlain = (value: FsValue): unknown => {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) {
    const num = Number(value.integerValue);
    return Number.isSafeInteger(num) ? num : value.integerValue;
  }
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(fsValueToPlain);
  }
  if ("mapValue" in value) {
    return fsFieldsToPlainJson(value.mapValue.fields);
  }
  return null;
};

/** Convert a Firestore document's fields map to a plain JSON object. */
export const fsFieldsToPlainJson = (
  fields: Record<string, FsValue> | undefined,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    // A reserved-looking name such as `__proto__` must stay an own property: assignment would
    // set the prototype instead and drop the field, hiding the server's refusal of that name.
    Object.defineProperty(out, key, {
      value: fsValueToPlain(value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
};

/** Convert a plain JSON value into a Firestore REST typed value, preserving `original` if unchanged. */
export const plainJsonToFsValue = (
  value: unknown,
  insideArray = false,
  original?: FsValue,
): Result<FsValue, string> => {
  if (original !== undefined && plainDeepEqual(value, fsValueToPlain(original))) {
    return ok(original);
  }
  if (value === null) return ok({ nullValue: null });
  if (typeof value === "boolean") return ok({ booleanValue: value });
  if (typeof value === "string") return ok({ stringValue: value });
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return err("Numbers must be finite.");
    return ok(
      Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value },
    );
  }
  if (Array.isArray(value)) {
    if (insideArray) return err("Firestore arrays cannot directly contain another array.");
    const origItems =
      original && "arrayValue" in original ? (original.arrayValue.values ?? []) : [];
    const origPlain = origItems.map(fsValueToPlain);
    const usedOrig = new Set<number>();
    const values: FsValue[] = [];
    for (let i = 0; i < value.length; i++) {
      let matched: FsValue | undefined;
      if (i < origItems.length && !usedOrig.has(i) && plainDeepEqual(value[i], origPlain[i])) {
        usedOrig.add(i);
        matched = origItems[i];
      } else {
        const found = origPlain.findIndex(
          (candidate, idx) => !usedOrig.has(idx) && plainDeepEqual(value[i], candidate),
        );
        if (found >= 0) {
          usedOrig.add(found);
          matched = origItems[found];
        }
      }
      const converted = plainJsonToFsValue(value[i], true, matched);
      if (converted.isErr()) return err(`[${i}]: ${converted.error}`);
      values.push(converted.value);
    }
    return ok({ arrayValue: { values } });
  }
  if (isPlainObject(value)) {
    const origFields =
      original && "mapValue" in original ? (original.mapValue.fields ?? {}) : undefined;
    const fields: Record<string, FsValue> = Object.create(null) as Record<string, FsValue>;
    for (const [k, v] of Object.entries(value)) {
      const origChild = origFields && Object.hasOwn(origFields, k) ? origFields[k] : undefined;
      const converted = plainJsonToFsValue(v, false, origChild);
      if (converted.isErr()) return err(`${k}: ${converted.error}`);
      fields[k] = converted.value;
    }
    return ok({ mapValue: { fields: { ...fields } } });
  }
  return err("Unsupported JSON value.");
};

/** Parse a JSON text string representing a document's top-level fields object into Firestore values. */
export const plainJsonToFsFields = (
  raw: string,
  original?: Record<string, FsValue>,
): Result<Record<string, FsValue>, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (e) {
    return err(e instanceof Error ? e.message : "Invalid JSON");
  }
  if (!isPlainObject(parsed)) {
    return err("Document JSON must be a JSON object.");
  }
  const fields: Record<string, FsValue> = Object.create(null) as Record<string, FsValue>;
  for (const [key, value] of Object.entries(parsed)) {
    if (!key) return err("Field names must not be empty.");
    const origField = original && Object.hasOwn(original, key) ? original[key] : undefined;
    const converted = plainJsonToFsValue(value, false, origField);
    if (converted.isErr()) return err(`${key}: ${converted.error}`);
    fields[key] = converted.value;
  }
  return ok({ ...fields });
};
