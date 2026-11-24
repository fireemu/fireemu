import { err, ok, type Result } from "neverthrow";
import type { FsValue } from "./firestoreValue";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    out[key] = fsValueToPlain(value);
  }
  return out;
};

/** Convert a plain JSON value into a Firestore REST typed value. */
export const plainJsonToFsValue = (value: unknown, insideArray = false): Result<FsValue, string> => {
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
    const values: FsValue[] = [];
    for (let i = 0; i < value.length; i++) {
      const converted = plainJsonToFsValue(value[i], true);
      if (converted.isErr()) return err(`[${i}]: ${converted.error}`);
      values.push(converted.value);
    }
    return ok({ arrayValue: { values } });
  }
  if (isPlainObject(value)) {
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(value)) {
      const converted = plainJsonToFsValue(v, false);
      if (converted.isErr()) return err(`${k}: ${converted.error}`);
      fields[k] = converted.value;
    }
    return ok({ mapValue: { fields } });
  }
  return err("Unsupported JSON value.");
};

/** Parse a JSON text string representing a document's top-level fields object into Firestore values. */
export const plainJsonToFsFields = (raw: string): Result<Record<string, FsValue>, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (e) {
    return err(e instanceof Error ? e.message : "Invalid JSON");
  }
  if (!isPlainObject(parsed)) {
    return err("Document JSON must be a JSON object.");
  }
  const fields: Record<string, FsValue> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key) return err("Field names must not be empty.");
    const converted = plainJsonToFsValue(value, false);
    if (converted.isErr()) return err(`${key}: ${converted.error}`);
    fields[key] = converted.value;
  }
  return ok(fields);
};
