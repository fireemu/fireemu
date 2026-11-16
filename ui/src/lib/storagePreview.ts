// What the Storage page may preview inline, decided from the object's declared content type
// and size. Images go through `<img>`, text through a text node; nothing is rendered as HTML.

export type PreviewKind = "image" | "text" | "none";

export const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_PREVIEW_BYTES = 256 * 1024;

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

const TEXT_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-ndjson",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
]);

/** The media type without parameters, lower-cased (`Text/Plain; charset=utf-8` -> `text/plain`). */
export const baseType = (contentType: string): string =>
  (contentType.split(";", 1)[0] ?? "").trim().toLowerCase();

/** How an object of this type and size is previewed; `none` when it is not, or is too large. */
export const previewKind = (contentType: string, size: number): PreviewKind => {
  if (!Number.isFinite(size) || size < 0) return "none";
  const type = baseType(contentType);
  if (IMAGE_TYPES.has(type)) return size <= MAX_IMAGE_PREVIEW_BYTES ? "image" : "none";
  const textLike =
    type.startsWith("text/") ||
    TEXT_TYPES.has(type) ||
    type.endsWith("+json") ||
    type.endsWith("+xml");
  if (textLike) return size <= MAX_TEXT_PREVIEW_BYTES ? "text" : "none";
  return "none";
};

/** Whether a drag carries files (as opposed to text or a link dragged across the page). */
export const dragHasFiles = (types: readonly string[] | undefined): boolean =>
  (types ?? []).includes("Files");
