import { CORS } from "./guard.mjs";
import { isDeepStrictEqual } from "node:util";

// Synthetic answers exercise the recorder; they are never production evidence.
export function createFakeWorld(
  target,
  { faults = {}, applyBeforeFault = [], clock = { now: Date.now } } = {},
) {
  const buckets = new Map([[target.defaultBucket, { name: target.defaultBucket, location: "US" }]]);
  const objects = new Map();
  const sessions = new Map();
  const log = [];
  const json = (status, value) => ({
    status,
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: Buffer.from(JSON.stringify(value)),
  });
  const empty = (status, headers = {}) => ({ status, headers, body: Buffer.alloc(0) });
  const missing = () =>
    json(404, {
      error: {
        code: 404,
        message: "The specified bucket does not exist.",
        errors: [
          { message: "The specified bucket does not exist.", domain: "global", reason: "notFound" },
        ],
      },
    });
  function perform(r) {
    const url = new URL(r.url);
    const path = url.pathname;
    const bucket =
      /\/(?:storage\/v1|upload\/storage\/v1|v0)\/b\/([^/]+)/.exec(path)?.[1] ?? path.split("/")[1];
    const name = path.includes("/o/")
      ? decodeURIComponent(path.split("/o/")[1].split("/")[0])
      : (url.searchParams.get("name") ?? path.split("/").slice(2).join("/"));
    const resource = `/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}`;
    if (["W1", "V3-W-bucket"].includes(r.case)) {
      if (buckets.has(target.tempBucket))
        return json(409, { error: { code: 409, message: "Already exists" } });
      const body = JSON.parse(r.body);
      // Production reports int64 fields as strings and adds the effective time.
      buckets.set(body.name, {
        ...body,
        ...(body.softDeletePolicy
          ? {
              softDeletePolicy: {
                retentionDurationSeconds: String(body.softDeletePolicy.retentionDurationSeconds),
                effectiveTime: "2026-11-13T00:00:00.000Z",
              },
            }
          : {}),
      });
      return json(200, body);
    }
    if (!buckets.has(bucket)) return missing();
    if (r.case === "F1") return json(403, { error: { code: 403, message: "Invalid token" } });
    if (r.case === "A13" || r.case === "A14")
      return json(412, { error: { code: 412, message: "Bucket is not linked to Firebase" } });
    if (r.case === "A6" || r.case === "A7") return missing();
    if (target.stage === "v3" && url.searchParams.has("upload_id")) {
      if (r.method === "DELETE") {
        sessions.delete(url.searchParams.get("upload_id"));
        return empty(204);
      }
      return sessions.has(url.searchParams.get("upload_id"))
        ? empty(308)
        : json(499, {
            error: {
              code: 499,
              message: "clientClosedRequest",
              errors: [
                { message: "clientClosedRequest", domain: "global", reason: "clientClosedRequest" },
              ],
            },
          });
    }
    if (target.stage === "v3" && r.case.endsWith("-resumable")) {
      const id = `synthetic-session-${r.case}`;
      const location = `${r.url}&upload_id=${id}`;
      sessions.set(id, location);
      return empty(200, { location, "x-guploader-uploadid": id });
    }
    if (target.stage === "v3" && r.method === "OPTIONS")
      return empty(200, {
        "access-control-allow-methods": "POST",
        "access-control-allow-headers": r.headers["access-control-request-headers"],
      });
    if (r.method === "OPTIONS") {
      const rules = buckets.get(bucket).cors ?? [];
      const h = r.headers;
      const rule = rules.find(
        (entry) =>
          (entry.origin.includes("*") || entry.origin.includes(h.origin)) &&
          entry.method.includes(h["access-control-request-method"]) &&
          (!h["access-control-request-headers"] ||
            entry.responseHeader.includes("*") ||
            entry.responseHeader.some(
              (header) => header.toLowerCase() === h["access-control-request-headers"],
            )),
      );
      return empty(
        200,
        rule
          ? {
              "access-control-allow-origin": rule.origin.includes("*") ? "*" : h.origin,
              "access-control-allow-methods": h["access-control-request-method"],
              "access-control-max-age": String(rule.maxAgeSeconds ?? 3600),
              ...(h["access-control-request-headers"]
                ? { "access-control-allow-headers": h["access-control-request-headers"] }
                : {}),
            }
          : {},
      );
    }
    if (r.method === "PATCH") {
      if (target.stage === "v3") Object.assign(buckets.get(bucket), JSON.parse(r.body));
      else delete buckets.get(bucket).cors;
      return json(200, {});
    }
    if (r.action === "create") {
      objects.set(r.resource, { name, bucket, size: "4" });
      return json(200, objects.get(r.resource));
    }
    if (path.endsWith("/o")) {
      const prefix = url.searchParams.get("prefix") ?? "";
      return json(200, {
        items: [...objects.values()].filter(
          (object) => object.bucket === bucket && object.name.startsWith(prefix),
        ),
      });
    }
    if (/^\/storage\/v1\/b\/[^/]+$/.test(path)) {
      if (r.method === "DELETE") {
        if ([...objects.values()].some((object) => object.bucket === bucket))
          return json(409, { error: { code: 409, message: "Bucket not empty" } });
        buckets.delete(bucket);
        return empty(204);
      }
      return json(200, buckets.get(bucket));
    }
    if (!objects.has(resource)) return missing();
    if (target.stage === "v3" && path.endsWith("/acl"))
      return json(400, {
        error: {
          code: 400,
          message: "Uniform bucket-level access is enabled",
          errors: [{ reason: "invalid" }],
        },
      });
    if (r.method === "DELETE") {
      objects.delete(resource);
      return empty(204);
    }
    if (
      url.searchParams.get("alt") === "media" ||
      (!path.startsWith("/storage/") && !path.startsWith("/v0/"))
    )
      return { status: 200, headers: { "content-type": "text/plain" }, body: Buffer.from("fire") };
    return json(200, objects.get(resource));
  }
  return {
    buckets,
    objects,
    sessions,
    log,
    cors: CORS,
    async net(request, { location = "US" } = {}) {
      if (target.stage === "v3") {
        // Frozen v3.1 request vocabulary, independent of the recorder's request builder.
        // Scope, local origin and the observed location are the only substitutions.
        const table = [
          [
            "V3-P-location",
            "GET",
            `/storage/v1/b/${target.defaultBucket}`,
            {},
            null,
            "read",
            `/storage/v1/b/${target.defaultBucket}`,
            "bearer",
          ],
          [
            "V3-P-absent",
            "GET",
            `/storage/v1/b/${target.tempBucket}`,
            {},
            null,
            "read",
            `/storage/v1/b/${target.tempBucket}`,
            "bearer",
          ],
          [
            "V3-W-bucket",
            "POST",
            `/storage/v1/b?project=${target.project}`,
            { "content-type": "application/json" },
            `{"name":"${target.tempBucket}","location":"${location}","iamConfiguration":{"uniformBucketLevelAccess":{"enabled":true}},"softDeletePolicy":{"retentionDurationSeconds":0}}`,
            "create",
            `/storage/v1/b/${target.tempBucket}`,
            "bearer",
          ],
          [
            "V3-W-verify",
            "GET",
            `/storage/v1/b/${target.tempBucket}`,
            {},
            null,
            "read",
            `/storage/v1/b/${target.tempBucket}`,
            "bearer",
          ],
          [
            "V3-W-object",
            "POST",
            `/upload/storage/v1/b/${target.tempBucket}/o?uploadType=media&name=cors%2Fo.txt`,
            { "content-type": "text/plain" },
            "fire",
            "create",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt`,
            "bearer",
          ],
          [
            "V3-absent-metadata",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-absent-media",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt?alt=media`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-absent-bucket",
            "GET",
            `/storage/v1/b/${target.tempBucket}`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-absent-list",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-absent-acl",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt/acl`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-absent-preflight",
            "OPTIONS",
            `/upload/storage/v1/b/${target.tempBucket}/o`,
            {
              origin: "http://localhost:3000",
              "access-control-request-method": "POST",
              "access-control-request-headers":
                "content-type, x-upload-content-type, x-goog-upload-protocol",
            },
            null,
            null,
            null,
            "none",
          ],
          [
            "V3-absent-resumable",
            "POST",
            `/upload/storage/v1/b/${target.tempBucket}/o?uploadType=resumable&name=cors%2Fresumable-absent.txt`,
            {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              "x-upload-content-type": "text/plain",
            },
            "{}",
            null,
            null,
            "bearer",
          ],
          [
            "V3-absent-cancel",
            "DELETE",
            `/upload/storage/v1/b/${target.tempBucket}/o?uploadType=resumable&name=cors%2Fresumable-absent.txt&upload_id=<session>`,
            {},
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-absent-session-read",
            "PUT",
            `/upload/storage/v1/b/${target.tempBucket}/o?uploadType=resumable&name=cors%2Fresumable-absent.txt&upload_id=<session>`,
            { "content-range": "bytes */*" },
            "",
            null,
            null,
            "bearer",
          ],
          [
            "V3-empty-patch",
            "PATCH",
            `/storage/v1/b/${target.tempBucket}?fields=cors`,
            { "content-type": "application/json" },
            '{"cors":[]}',
            null,
            null,
            "bearer",
          ],
          [
            "V3-empty-verify",
            "GET",
            `/storage/v1/b/${target.tempBucket}`,
            {},
            null,
            "read",
            `/storage/v1/b/${target.tempBucket}`,
            "bearer",
          ],
          [
            "V3-empty-metadata",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-empty-media",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt?alt=media`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-empty-bucket",
            "GET",
            `/storage/v1/b/${target.tempBucket}`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-empty-list",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-empty-acl",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt/acl`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-empty-preflight",
            "OPTIONS",
            `/upload/storage/v1/b/${target.tempBucket}/o`,
            {
              origin: "http://localhost:3000",
              "access-control-request-method": "POST",
              "access-control-request-headers":
                "content-type, x-upload-content-type, x-goog-upload-protocol",
            },
            null,
            null,
            null,
            "none",
          ],
          [
            "V3-empty-resumable",
            "POST",
            `/upload/storage/v1/b/${target.tempBucket}/o?uploadType=resumable&name=cors%2Fresumable-empty.txt`,
            {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              "x-upload-content-type": "text/plain",
            },
            "{}",
            null,
            null,
            "bearer",
          ],
          [
            "V3-empty-cancel",
            "DELETE",
            `/upload/storage/v1/b/${target.tempBucket}/o?uploadType=resumable&name=cors%2Fresumable-empty.txt&upload_id=<session>`,
            {},
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-empty-session-read",
            "PUT",
            `/upload/storage/v1/b/${target.tempBucket}/o?uploadType=resumable&name=cors%2Fresumable-empty.txt&upload_id=<session>`,
            { "content-range": "bytes */*" },
            "",
            null,
            null,
            "bearer",
          ],
          [
            "V3-configured-patch",
            "PATCH",
            `/storage/v1/b/${target.tempBucket}?fields=cors`,
            { "content-type": "application/json" },
            '{"cors":[{"origin":["*"],"method":["GET"],"responseHeader":["*"]},{"origin":["http://localhost:3000"],"method":["PUT","GET"],"responseHeader":["Content-Type"],"maxAgeSeconds":600}]}',
            null,
            null,
            "bearer",
          ],
          [
            "V3-configured-verify",
            "GET",
            `/storage/v1/b/${target.tempBucket}`,
            {},
            null,
            "read",
            `/storage/v1/b/${target.tempBucket}`,
            "bearer",
          ],
          [
            "V3-configured-metadata",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-configured-media",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt?alt=media`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-configured-bucket",
            "GET",
            `/storage/v1/b/${target.tempBucket}`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-configured-list",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-configured-acl",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt/acl`,
            { origin: "http://localhost:3000" },
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-configured-preflight",
            "OPTIONS",
            `/upload/storage/v1/b/${target.tempBucket}/o`,
            {
              origin: "http://localhost:3000",
              "access-control-request-method": "POST",
              "access-control-request-headers":
                "content-type, x-upload-content-type, x-goog-upload-protocol",
            },
            null,
            null,
            null,
            "none",
          ],
          [
            "V3-configured-resumable",
            "POST",
            `/upload/storage/v1/b/${target.tempBucket}/o?uploadType=resumable&name=cors%2Fresumable-configured.txt`,
            {
              origin: "http://localhost:3000",
              "content-type": "application/json",
              "x-upload-content-type": "text/plain",
            },
            "{}",
            null,
            null,
            "bearer",
          ],
          [
            "V3-configured-cancel",
            "DELETE",
            `/upload/storage/v1/b/${target.tempBucket}/o?uploadType=resumable&name=cors%2Fresumable-configured.txt&upload_id=<session>`,
            {},
            null,
            null,
            null,
            "bearer",
          ],
          [
            "V3-configured-session-read",
            "PUT",
            `/upload/storage/v1/b/${target.tempBucket}/o?uploadType=resumable&name=cors%2Fresumable-configured.txt&upload_id=<session>`,
            { "content-range": "bytes */*" },
            "",
            null,
            null,
            "bearer",
          ],
          [
            "V3-K-object",
            "DELETE",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt`,
            {},
            null,
            "delete",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt`,
            "bearer",
          ],
          [
            "V3-K-read-object",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt`,
            {},
            null,
            "read",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt`,
            "bearer",
          ],
          [
            "V3-K-read-created-bucket",
            "GET",
            `/storage/v1/b/${target.tempBucket}`,
            {},
            null,
            "read",
            `/storage/v1/b/${target.tempBucket}`,
            "bearer",
          ],
          [
            "V3-K-delete-bucket",
            "DELETE",
            `/storage/v1/b/${target.tempBucket}`,
            {},
            null,
            "delete",
            `/storage/v1/b/${target.tempBucket}`,
            "bearer",
          ],
          [
            "V3-K-bucket",
            "GET",
            `/storage/v1/b/${target.tempBucket}`,
            {},
            null,
            "read",
            `/storage/v1/b/${target.tempBucket}`,
            "bearer",
          ],
          [
            "V3-A2-bucket",
            "GET",
            `/storage/v1/b/${target.tempBucket}`,
            {},
            null,
            "read",
            `/storage/v1/b/${target.tempBucket}`,
            "bearer",
          ],
          [
            "V3-A2-object",
            "GET",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt`,
            {},
            null,
            "read",
            `/storage/v1/b/${target.tempBucket}/o/cors%2Fo.txt`,
            "bearer",
          ],
        ];
        if (target.local) {
          for (const state of ["absent", "empty", "configured"]) {
            const bucket = `${target.tempBucket}-${state}`;
            const resource = `/storage/v1/b/${bucket}/o/cors%2Fo.txt`;
            table.push(
              [
                `V3-${state}-initial-list`,
                "GET",
                `/storage/v1/b/${bucket}/o`,
                {},
                null,
                null,
                null,
                "bearer",
              ],
              [
                `V3-${state}-upload`,
                "POST",
                `/upload/storage/v1/b/${bucket}/o?uploadType=media&name=cors%2Fo.txt`,
                { "content-type": "text/plain" },
                "fire",
                "create",
                resource,
                "bearer",
              ],
              [
                `V3-${state}-delete-object`,
                "DELETE",
                resource,
                {},
                null,
                "delete",
                resource,
                "bearer",
              ],
              [`V3-${state}-read-object`, "GET", resource, {}, null, "read", resource, "bearer"],
            );
          }
        }
        const recorded = table.find(([id]) => id === request.case);
        if (!recorded) throw new Error("request absent from recorded v3 vocabulary");
        const [id, method, path, headers, body, action, resource, auth] = recorded;
        const state =
          /^V3-(absent|empty|configured)-(metadata|media|bucket|list|acl|preflight|resumable|cancel|session-read)$/.exec(
            id,
          )?.[1];
        let expectedPath =
          target.local && state
            ? path.replaceAll(target.tempBucket, `${target.tempBucket}-${state}`)
            : path;
        if (expectedPath.includes("<session>")) {
          const issued = `synthetic-session-V3-${state}-resumable`;
          expectedPath = expectedPath.replace("<session>", issued);
        }
        const actualHeaders = { ...request.headers };
        const authorization = actualHeaders.authorization;
        delete actualHeaders.authorization;
        if (
          request.url !== `${target.local ?? "https://storage.googleapis.com"}${expectedPath}` ||
          request.method !== method ||
          (request.body ?? "") !== (body ?? "") ||
          !isDeepStrictEqual(actualHeaders, headers) ||
          request.action !== (action ?? undefined) ||
          request.resource !== (resource ?? undefined) ||
          request.auth !== auth ||
          (target.local || auth === "none"
            ? authorization !== undefined
            : !/^Bearer [^\s]+$/.test(authorization ?? ""))
        )
          throw new Error("request differs from recorded v3 vocabulary");
      }
      log.push({ ...request, at: clock.now() });
      const fault = faults[request.case];
      const answer =
        fault === undefined || applyBeforeFault.includes(request.case)
          ? perform(request)
          : undefined;
      if (answer && target.stage === "v3" && request.headers.origin) {
        answer.headers = {
          ...answer.headers,
          "access-control-allow-origin": request.headers.origin,
          "access-control-allow-credentials": "true",
          "access-control-expose-headers": "Content-Type, Location",
          vary: "Origin, X-Origin",
        };
      }
      if (fault === "transport") throw new Error("synthetic transport failure");
      if (typeof fault === "function") return fault(request, { buckets, objects, answer });
      return fault === undefined ? answer : { headers: {}, body: Buffer.alloc(0), ...fault };
    },
  };
}
