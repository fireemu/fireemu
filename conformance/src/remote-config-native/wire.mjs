import { gunzipSync } from "node:zlib";

export const MAX_NATIVE_REQUEST_BYTES = 64 * 1024;

const FID = /^[A-Za-z0-9_-]{22}$/;
const INSTALLATIONS = "/installations";
const FETCH = ":fetch";
const REALTIME = ":streamFetchInvalidations";

/**
 * Select the original service by a test-app URL prefix and admit only the known SDK path,
 * project identity and API key placement. Keep the literal target for transmission. An
 * accepted route still needs request-body and installation ownership checks before sending.
 */
export function nativeRequest({ platform, method, target, apiKey = "" }, owner) {
  if (platform !== "android" && platform !== "ios") return null;
  const prefixEnd = target.indexOf("/", 1);
  if (!target.startsWith("/") || prefixEnd < 0) return null;
  const service = target.slice(1, prefixEnd);
  const path = target.slice(prefixEnd);
  const ios = platform === "ios";

  if (service === "installations") {
    if (apiKey !== owner.key) return null;
    const collection = `/v1/projects/${owner.projectId}${INSTALLATIONS}`;
    if (method === "POST" && path === collection) return { service, operation: "create", path };
    if (!path.startsWith(`${collection}/`)) return null;
    const resource = path.slice(collection.length + 1);
    const token = "/authTokens:generate";
    const isToken = resource.endsWith(token);
    const fid = isToken ? resource.slice(0, -token.length) : resource;
    if (!FID.test(fid) || !owner.installations.has(fid)) return null;
    if (method === "POST" && isToken) return { service, operation: "token", path };
    if (method === "DELETE" && !isToken) return { service, operation: "delete", path };
    return null;
  }

  if (service !== "fetch" && service !== "realtime") return null;
  const isFetch = service === "fetch";
  const project = ios && isFetch ? owner.projectId : owner.projectNumber;
  const action = isFetch ? FETCH : REALTIME;
  const query = ios ? `?key=${owner.key}` : "";
  const requiredKeyHeader = ios && isFetch ? "" : owner.key;
  if (apiKey !== requiredKeyHeader) return null;
  if (method !== "POST" || path !== `/v1/projects/${project}/namespaces/firebase${action}${query}`)
    return null;
  return { service, operation: service, path };
}

/** Compression inspection must not change a byte of the relayed SDK request. */
export function nativeRequestBody(wire, encoding) {
  if (!Buffer.isBuffer(wire)) throw new TypeError("invalid native request bytes");
  if (wire.length > MAX_NATIVE_REQUEST_BYTES) throw new Error("native request exceeds byte limit");
  if (encoding === undefined || encoding === "identity") return { wire, decoded: wire };
  if (encoding !== "gzip") throw new Error("unsupported native request encoding");
  try {
    return { wire, decoded: gunzipSync(wire, { maxOutputLength: MAX_NATIVE_REQUEST_BYTES }) };
  } catch (error) {
    if (error.code === "ERR_BUFFER_TOO_LARGE")
      throw new Error("native request exceeds inflated byte limit", { cause: error });
    throw new Error("invalid native request gzip", { cause: error });
  }
}
