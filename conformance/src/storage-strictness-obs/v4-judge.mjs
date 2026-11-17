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
// Links carry the serving host, which differs between production and a local emulator: hide their length too.
const LINKS = new Set(["selfLink", "mediaLink"]);
const masked = (value, key) =>
  LINKS.has(key) ? "<url>" : `<${typeof value}:${String(value).length}>`;
const scrub = (value) => {
  if (Array.isArray(value)) return value.map(scrub);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, member]) => [
      key,
      GENERATED.has(key) || key === "effectiveTime" ? masked(member, key) : scrub(member),
    ]),
  );
};
const keys = (value) => (isRecord(value) ? Object.keys(value) : []);

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
  return { facts, shape: null };
}
