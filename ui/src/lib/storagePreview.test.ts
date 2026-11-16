import { expect, test } from "vitest";
import {
  MAX_IMAGE_PREVIEW_BYTES,
  MAX_TEXT_PREVIEW_BYTES,
  baseType,
  dragHasFiles,
  previewKind,
} from "./storagePreview";

test.each([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
])("%s is previewed as an image", (type) => {
  expect(previewKind(type, 1)).toBe("image");
});

test.each([
  "text/plain",
  "text/html",
  "text/csv",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-ndjson",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/ld+json",
  "application/atom+xml",
])("%s is previewed as text", (type) => {
  expect(previewKind(type, 1)).toBe("text");
});

test.each([
  "application/octet-stream",
  "application/pdf",
  "video/mp4",
  "audio/mpeg",
  "image/tiff",
  "image/heic",
  "application/zip",
  "",
  "json",
  "xtext/plain",
  "application/jsonp",
])("%s has no preview", (type) => {
  expect(previewKind(type, 1)).toBe("none");
});

test("parameters and case do not change the type", () => {
  expect(baseType("Text/Plain; charset=utf-8")).toBe("text/plain");
  expect(baseType("  IMAGE/PNG  ")).toBe("image/png");
  expect(baseType("")).toBe("");
  expect(previewKind("Application/JSON; charset=utf-8", 10)).toBe("text");
  expect(previewKind("IMAGE/SVG+XML", 10)).toBe("image");
});

test("the size limits are inclusive and separate for images and text", () => {
  expect(previewKind("image/png", MAX_IMAGE_PREVIEW_BYTES)).toBe("image");
  expect(previewKind("image/png", MAX_IMAGE_PREVIEW_BYTES + 1)).toBe("none");
  expect(previewKind("text/plain", MAX_TEXT_PREVIEW_BYTES)).toBe("text");
  expect(previewKind("text/plain", MAX_TEXT_PREVIEW_BYTES + 1)).toBe("none");
  expect(previewKind("image/png", MAX_TEXT_PREVIEW_BYTES + 1)).toBe("image");
  expect(previewKind("text/plain", 0)).toBe("text");
  expect(MAX_IMAGE_PREVIEW_BYTES).toBe(10 * 1024 * 1024);
  expect(MAX_TEXT_PREVIEW_BYTES).toBe(256 * 1024);
});

test("a size that is not a real size has no preview", () => {
  for (const size of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    expect(previewKind("text/plain", size)).toBe("none");
    expect(previewKind("image/png", size)).toBe("none");
  }
});

test("only a drag that carries files is accepted", () => {
  expect(dragHasFiles(["Files"])).toBe(true);
  expect(dragHasFiles(["text/plain", "Files"])).toBe(true);
  expect(dragHasFiles(["text/plain", "text/uri-list"])).toBe(false);
  expect(dragHasFiles(["files"])).toBe(false);
  expect(dragHasFiles([])).toBe(false);
  expect(dragHasFiles(undefined)).toBe(false);
});
