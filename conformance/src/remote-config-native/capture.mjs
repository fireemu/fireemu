import { constants, gunzipSync } from "node:zlib";

import { MAX_NATIVE_REQUEST_BYTES, nativePayload, nativeRequestBody } from "./wire.mjs";

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const CREDENTIAL =
  /AIza[A-Za-z0-9_-]{35}|ya29\.[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
const encodedForms = (value) => [
  value,
  encodeURIComponent(value),
  Buffer.from(value).toString("base64"),
  Buffer.from(value).toString("base64url"),
];

const REQUEST_HEADERS = [
  "accept",
  "accept-encoding",
  "content-type",
  "x-android-cert",
  "x-android-package",
  "x-firebase-rc-fetch-type",
  "x-goog-api-client",
  "x-ios-bundle-identifier",
];
const RESPONSE_HEADERS = ["content-type", "cache-control", "vary"];

function layout(bytes) {
  const text = UTF8.decode(bytes);
  if (!text.length) return { format: "empty", tokens: "", finalNewline: false };
  let format = "json";
  try {
    JSON.parse(text);
  } catch {
    format = "json5";
  }
  const parts = text.match(
    /"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[{}[\],:]|\s+|[^{}[\],:'"\s]+|./gu,
  );
  if (parts.length > 8192) throw new Error("native payload layout exceeds limit");
  const tokens = parts
    .map((part) => {
      if (part[0] === '"') return "d";
      if (part[0] === "'") return "s";
      if (/^[{}[\],:]$/.test(part)) return part;
      if (/^\s/.test(part)) return "w";
      return "v";
    })
    .join("");
  return { format, tokens, finalNewline: text.endsWith("\n") };
}

function contentEncoding(headers) {
  const encoding = headers["content-encoding"];
  if (encoding === undefined || encoding === "identity") return "identity";
  if (encoding === "gzip") return encoding;
  throw new Error("unknown native capture encoding");
}

/** Mask one native app's wire records before they leave the process. */
export function nativeCapture({ platform, projectId, projectNumber, appId, key }) {
  const secrets = new Map([
    [projectId, "PROJECT_ID"],
    [projectNumber, "PROJECT_NUMBER"],
    [appId, "APP_ID"],
    [key, "API_KEY"],
  ]);
  const etags = new Map();
  let fidCount = 0;
  let tokenCount = 0;

  function addFID(fid) {
    if (typeof fid === "string" && fid && !secrets.has(fid)) secrets.set(fid, `FID_${++fidCount}`);
  }

  function addToken(token) {
    if (typeof token === "string" && token.length > 0 && !secrets.has(token))
      secrets.set(token, `TOKEN_${++tokenCount}`);
  }

  function mask(text) {
    const substitutions = [...secrets.entries()]
      .flatMap(([value, label]) => encodedForms(value).map((form) => [form, label]))
      .toSorted(([a], [b]) => b.length - a.length);
    let result = text;
    for (const [source, label] of substitutions) result = result.replaceAll(source, label);
    if (CREDENTIAL.test(result)) throw new Error("unrecognized native capture secret");
    return result;
  }

  function masked(value) {
    if (Array.isArray(value)) return value.map(masked);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([name, field]) => [mask(name), masked(field)]),
      );
    if (typeof value === "string") return mask(value);
    if (typeof value === "number") return secrets.get(String(value)) ?? value;
    return value;
  }

  function headerProjection(headers, names) {
    return Object.fromEntries(
      names.flatMap((name) =>
        typeof headers[name] === "string" ? [[name, mask(headers[name])]] : [],
      ),
    );
  }

  function request({ operation, service, fid, wire, path, headers }) {
    addFID(fid);
    const encoding = contentEncoding(headers);
    const body = nativePayload({ wire, encoding }, { operation, service }, platform);
    if (body === null) throw new Error("native captured request body is unreadable");
    const conditional = headers["if-none-match"];
    return {
      requestBytes: wire.length,
      path: mask(path),
      encoding,
      ifNoneMatch:
        conditional === undefined || conditional === "*"
          ? (conditional ?? null)
          : (etags.get(conditional) ?? "UNSEEN"),
      body: masked(body),
      headers: headerProjection(headers, REQUEST_HEADERS),
      credentials: {
        apiKey: Boolean(headers["x-goog-api-key"]),
        installationsAuth: Boolean(headers["x-goog-firebase-installations-auth"]),
        authorization: Boolean(headers.authorization),
      },
      layout: layout(wire.length ? nativeRequestBody(wire, encoding).decoded : wire),
    };
  }

  function response({ operation, status, fid, wire, headers }) {
    addFID(fid);
    const encoding = contentEncoding(headers);
    const isSuccess = status >= 200 && status < 300;
    let body = null;
    let etag = null;
    let payloadLayout = null;
    if (isSuccess && wire.length) {
      const { decoded } = nativeRequestBody(wire, encoding);
      body = JSON.parse(UTF8.decode(decoded));
      payloadLayout = layout(decoded);
      if (operation === "create") {
        addFID(body.fid);
        addToken(body.refreshToken);
        addToken(body.authToken?.token);
      } else if (operation === "token") {
        addToken(body.token);
      }
      body = masked(body);
    }
    const tag = headers.etag;
    if (isSuccess && typeof tag === "string") {
      if (!etags.has(tag)) etags.set(tag, `ETAG_${etags.size + 1}`);
      etag = etags.get(tag);
    }
    return {
      status,
      responseBytes: wire.length,
      encoding,
      etag,
      body,
      layout: payloadLayout,
      headers: isSuccess ? headerProjection(headers, RESPONSE_HEADERS) : {},
    };
  }

  function stream({ wire, headers, chunkLengths }) {
    if (
      !chunkLengths.every((n) => Number.isSafeInteger(n) && n > 0) ||
      chunkLengths.reduce((a, b) => a + b, 0) !== wire.length ||
      wire.length > MAX_NATIVE_REQUEST_BYTES
    )
      throw new Error("invalid native stream framing");
    const encoding = contentEncoding(headers);
    const decoded =
      encoding === "gzip"
        ? gunzipSync(wire, {
            maxOutputLength: MAX_NATIVE_REQUEST_BYTES,
            finishFlush: constants.Z_SYNC_FLUSH,
          })
        : wire;
    return {
      encoding,
      responseBytes: wire.length,
      chunkLengths,
      headers: headerProjection(headers, RESPONSE_HEADERS),
      bodyText: mask(UTF8.decode(decoded)),
    };
  }

  return { request, response, stream };
}
