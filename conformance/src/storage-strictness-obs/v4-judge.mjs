// What a v4 answer means, by content. Names, member order, counts and framing are kept; generated
// values (ids, times, etags, tokens, project numbers) are replaced by their kind and length.
import { V4_OBSERVATIONS } from "./v4.mjs";

export const V4_ROW_CASES = [...V4_OBSERVATIONS, "V4-W-verify", "V4-U-md-up"];
const GENERATED = new Set([
  "id",
  "name",
  "selfLink",
  "mediaLink",
  "projectNumber",
  "etag",
  "timeCreated",
  "updated",
  "generation",
  "metageneration",
  "crc32c",
  "md5Hash",
  "timeStorageClassUpdated",
  "bucket",
]);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const masked = (value) => `<${typeof value}:${String(value).length}>`;
const scrub = (value) => {
  if (Array.isArray(value)) return value.map(scrub);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [
      key,
      GENERATED.has(key) || key === "effectiveTime" ? masked(member) : scrub(member),
    ]),
  );
};
const keys = (value) => (isRecord(value) ? Object.keys(value) : []);
const entity = (text) => (typeof text === "string" ? text.replace(/\d+/g, "<n>") : null);

export function v4Facts(entry, body, headers) {
  const facts = {
    contentLength: headers["content-length"] ?? null,
    contentType: headers["content-type"] ?? null,
  };
  let value;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    return { facts, shape: null };
  }
  if (!isRecord(value) || value.error) return { facts, shape: null };
  if (value.kind === "storage#objects") {
    return {
      shape: "object-list",
      facts: {
        ...facts,
        memberOrder: keys(value),
        items: (value.items ?? []).map((item) => item?.name ?? null),
        prefixes: value.prefixes ?? [],
        nextPageToken: value.nextPageToken !== undefined,
        itemMetadataKeys: Object.fromEntries(
          (value.items ?? []).map((item) => [item?.name, keys(item?.metadata)]),
        ),
      },
    };
  }
  if (value.kind === "storage#object")
    return {
      shape: "object",
      facts: { ...facts, memberOrder: keys(value), metadataKeys: keys(value.metadata) },
    };
  if (value.kind === "storage#bucket")
    return {
      shape: "bucket-resource",
      facts: { ...facts, memberOrder: keys(value), members: scrub(value) },
    };
  if (value.kind === "storage#objectAccessControls")
    return {
      shape: "acl-list",
      facts: {
        ...facts,
        memberOrder: keys(value),
        entries: (value.items ?? []).map((item) => [entity(item.entity), item.role ?? null]),
      },
    };
  if (value.kind === "storage#objectAccessControl")
    return {
      shape: "acl-entry",
      facts: { ...facts, memberOrder: keys(value), entries: [[entity(value.entity), value.role]] },
    };
  return { facts, shape: null };
}
