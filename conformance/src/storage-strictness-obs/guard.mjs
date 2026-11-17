import { randomBytes } from "node:crypto";
import { requestsV4, TOKEN_MARK, TOKEN_PATTERN, V4_BUDGET } from "./v4.mjs";

export const SEND_FLAG = "STORAGE_STRICTNESS_OBS_PRODUCTION_SEND";
export const HOSTS = ["storage.googleapis.com", "firebasestorage.googleapis.com"];
export const CORS = [
  { origin: ["*"], method: ["GET"], responseHeader: ["*"] },
  {
    origin: ["http://localhost:3000"],
    method: ["PUT", "GET"],
    responseHeader: ["Content-Type"],
    maxAgeSeconds: 600,
  },
];
export class GuardError extends Error {}

export function targetOf({
  project,
  defaultBucket,
  runId = `ss-${randomBytes(4).toString("hex")}`,
  local,
  stage = "v2",
}) {
  if (
    !["v2", "v3", "v4"].includes(stage) ||
    project !== "fireemu-oracle-query" ||
    defaultBucket !== `${project}.firebasestorage.app` ||
    !/^ss-[a-f0-9]{8}$/.test(runId)
  ) {
    throw new GuardError("invalid project, default bucket or run ID");
  }
  if (local) {
    const url = new URL(local);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new GuardError("local mode requires a loopback origin");
    }
    local = url.origin;
  }
  return {
    project,
    defaultBucket,
    stage,
    runId,
    local,
    tempBucket: `fireemu-obs-${runId}`,
    missingBucket: `fireemu-obs-${runId}-absent`,
    prefix: `storage-strictness/${runId}/`,
  };
}

// A finite request vocabulary: cleanup may only address objects this sequence can create.
export function requests(t, location = "US") {
  if (typeof location !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(location))
    throw new GuardError("invalid location");
  if (t.stage === "v4") return requestsV4({ ...t, location });
  const { defaultBucket: D, tempBucket: T, missingBucket: M, prefix } = t;
  const b = (bucket) => `/storage/v1/b/${bucket}`;
  const o = (bucket, name) => `${b(bucket)}/o/${encodeURIComponent(name)}`;
  const d = `${prefix}d.txt`;
  const out = {};
  function add(
    id,
    method,
    path,
    { firebase = false, headers = {}, body, action, resource, auth = "bearer" } = {},
  ) {
    out[id] = {
      case: id,
      method,
      url: `${t.local ?? `https://${HOSTS[firebase ? 1 : 0]}`}${path}`,
      headers,
      body,
      action,
      resource,
      auth,
    };
  }
  const read = (id, resource) => add(id, "GET", resource, { action: "read", resource });
  const del = (id, resource) => add(id, "DELETE", resource, { action: "delete", resource });
  const upload = (id, bucket, name) =>
    add(
      id,
      "POST",
      `/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`,
      {
        body: "fire",
        headers: { "content-type": "text/plain" },
        action: "create",
        resource: o(bucket, name),
      },
    );
  if (t.stage === "v3") {
    read("V3-P-location", b(D));
    read("V3-P-absent", b(T));
    add("V3-W-bucket", "POST", `/storage/v1/b?project=${t.project}`, {
      body: JSON.stringify({
        name: T,
        location,
        iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
        softDeletePolicy: { retentionDurationSeconds: 0 },
      }),
      headers: { "content-type": "application/json" },
      action: "create",
      resource: b(T),
    });
    read("V3-W-verify", b(T));
    upload("V3-W-object", T, "cors/o.txt");
    for (const state of ["absent", "empty", "configured"]) {
      const bucket = t.local ? `${T}-${state}` : T;
      const id = `V3-${state}`;
      const origin = { origin: "http://localhost:3000" };
      if (state !== "absent") {
        add(`${id}-patch`, "PATCH", `${b(T)}?fields=cors`, {
          body: JSON.stringify({ cors: state === "empty" ? [] : CORS }),
          headers: { "content-type": "application/json" },
        });
        read(`${id}-verify`, b(T));
      }
      if (t.local) {
        add(`${id}-initial-list`, "GET", `${b(bucket)}/o`);
        upload(`${id}-upload`, bucket, "cors/o.txt");
      }
      for (const [endpoint, path] of [
        ["metadata", o(bucket, "cors/o.txt")],
        ["media", `${o(bucket, "cors/o.txt")}?alt=media`],
        ["bucket", b(bucket)],
        ["list", `${b(bucket)}/o`],
        ["acl", `${o(bucket, "cors/o.txt")}/acl`],
      ])
        add(`${id}-${endpoint}`, "GET", path, { headers: origin });
      add(`${id}-preflight`, "OPTIONS", `/upload/storage/v1/b/${bucket}/o`, {
        auth: "none",
        headers: {
          ...origin,
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "content-type, x-upload-content-type, x-goog-upload-protocol",
        },
      });
      const start = `/upload/storage/v1/b/${bucket}/o?uploadType=resumable&name=${encodeURIComponent(`cors/resumable-${state}.txt`)}`;
      add(`${id}-resumable`, "POST", start, {
        headers: {
          ...origin,
          "content-type": "application/json",
          "x-upload-content-type": "text/plain",
        },
        body: "{}",
      });
      // Only an issued session URL can replace this placeholder at the wire boundary.
      add(`${id}-cancel`, "DELETE", `${start}&upload_id=<session>`);
      add(`${id}-session-read`, "PUT", `${start}&upload_id=<session>`, {
        headers: { "content-range": "bytes */*" },
        body: "",
      });
      if (t.local) {
        del(`${id}-delete-object`, o(bucket, "cors/o.txt"));
        read(`${id}-read-object`, o(bucket, "cors/o.txt"));
      }
    }
    del("V3-K-object", o(T, "cors/o.txt"));
    read("V3-K-read-object", o(T, "cors/o.txt"));
    read("V3-K-read-created-bucket", b(T));
    del("V3-K-delete-bucket", b(T));
    read("V3-K-bucket", b(T));
    read("V3-A2-bucket", b(T));
    read("V3-A2-object", o(T, "cors/o.txt"));
    return out;
  }
  read("P1", b(D));
  read("P2", b(M));
  read("P3", b(T));
  add("P4", "GET", `${b(D)}/o?prefix=${encodeURIComponent(prefix)}`);
  add("W1", "POST", `/storage/v1/b?project=${t.project}`, {
    body: JSON.stringify({
      name: T,
      location,
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
      // Hard deletes: no soft-deleted copy of T or its object outlives the run (presend Should 1).
      softDeletePolicy: { retentionDurationSeconds: 0 },
      cors: CORS,
    }),
    headers: { "content-type": "application/json" },
    action: "create",
    resource: b(T),
  });
  read("W2", b(T));
  upload("W3", T, "cors/o.txt");
  upload("W4", D, d);
  read("A1", o(M, "x"));
  add("A2", "GET", `${o(M, "x")}?alt=media`, { action: "read", resource: o(M, "x") });
  add("A3", "GET", `${b(M)}/o`);
  upload("A4", M, "x");
  del("A5", o(M, "x"));
  add("A6", "POST", `${o(M, "x")}/copyTo/b/${T}/o/y`, { action: "create", resource: o(T, "y") });
  add("A7", "POST", `${o(T, "cors/o.txt")}/rewriteTo/b/${M}/o/y`, {
    action: "create",
    resource: o(M, "y"),
  });
  add("A8", "GET", `${o(M, "x")}/acl`);
  add("A9", "GET", `/${M}/x`, { action: "read", resource: o(M, "x") });
  add("A10", "PUT", `/${M}/x`, {
    body: "fire",
    headers: { "content-type": "text/plain" },
    action: "create",
    resource: o(M, "x"),
  });
  add("A11", "GET", `/v0/b/${M}/o/x`, { firebase: true, action: "read", resource: o(M, "x") });
  add("A12", "POST", `/v0/b/${M}/o?name=x`, {
    firebase: true,
    body: "fire",
    headers: { "content-type": "text/plain" },
    action: "create",
    resource: o(M, "x"),
  });
  add("A13", "GET", `/v0/b/${T}/o/cors%2Fo.txt`, { firebase: true });
  add("A14", "GET", `/v0/b/${T}/o`, { firebase: true });
  const preflight = (id, path, origin, method, requested) =>
    add(id, "OPTIONS", path, {
      auth: "none",
      headers: {
        origin,
        "access-control-request-method": method,
        ...(requested ? { "access-control-request-headers": requested } : {}),
      },
    });
  preflight("C1", `/${T}/cors/o.txt`, "http://a.example", "GET");
  preflight("C2", `/${T}/cors/o.txt`, "http://localhost:3000", "PUT", "content-type");
  preflight("C3", `/${T}/cors/o.txt`, "http://localhost:3000", "DELETE");
  preflight("C4", `/${T}/cors/o.txt`, "http://a.example", "GET", "x-custom-header");
  add("C5", "GET", `/${T}/cors/o.txt`, { headers: { origin: "http://a.example" } });
  add("C6", "GET", `${o(T, "cors/o.txt")}?alt=media`, { headers: { origin: "http://a.example" } });
  add("C7", "GET", o(T, "cors/o.txt"), { headers: { origin: "http://localhost:3000" } });
  preflight("C8", o(T, "cors/o.txt"), "http://a.example", "GET");
  add("R1", "PATCH", `${b(T)}?fields=cors`, {
    body: '{"cors":[]}',
    headers: { "content-type": "application/json" },
  });
  read("R2", b(T));
  for (const id of ["R3", "R4", "R5"]) out[id] = { ...out.C1, case: id };
  add("F1", "GET", `/v0/b/${D}/o/${encodeURIComponent(d)}`, { firebase: true, auth: "malformed" });
  add("F2", "DELETE", `/v0/b/${D}/o/${encodeURIComponent(d)}`, {
    firebase: true,
    action: "delete",
    resource: o(D, d),
  });
  del("K1", o(T, "cors/o.txt"));
  read("K2", o(T, "cors/o.txt"));
  del("K3", b(T));
  read("K4", b(T));
  out.K5 = { ...out.P4, case: "K5" };
  read("K6", o(D, d));
  del("K7", o(D, d));
  read("K8", o(D, d));
  out.K9 = { ...out.P4, case: "K9" };
  add("K-list", "GET", `${b(T)}/o`);
  out["K-retry"] = { ...out.K3, case: "K-retry" };
  for (const [key, bucket, name] of [
    ["t-cors", T, "cors/o.txt"],
    ["t-y", T, "y"],
    ["m-x", M, "x"],
    ["m-y", M, "y"],
  ]) {
    read(`K-read-${key}`, o(bucket, name));
    del(`K-delete-${key}`, o(bucket, name));
    read(`K-verify-${key}`, o(bucket, name));
  }
  read("K-read-bucket", b(T));
  read("K-read-default", o(D, d));
  for (const [id, original] of [
    ["A2-bucket", "K4"],
    ["A2-prefix", "K5"],
    ["A2-object", "K6"],
    ["A2-cors", "K2"],
    ["A2-t-y", "K-read-t-y"],
    ["A2-m-x", "K-read-m-x"],
    ["A2-m-y", "K-read-m-y"],
  ])
    out[id] = { ...out[original], case: id };
  return out;
}

export function classifyRequest(target, request, location = "US") {
  const pinned = targetOf(target);
  if (["tempBucket", "missingBucket", "prefix", "local"].some((key) => target[key] !== pinned[key]))
    throw new GuardError("target differs from run scope");
  const url = new URL(request.url);
  if (url.username || url.password || url.hash || request.url.includes("\\"))
    throw new GuardError("URL credentials, fragment or backslash");
  if (target.local) {
    if (url.origin !== target.local) throw new GuardError("non-local egress refused");
  } else if (!HOSTS.some((host) => request.url.startsWith(`https://${host}/`))) {
    throw new GuardError("production origin refused");
  }
  const vocabulary = requests(target, location);
  let planned = vocabulary[request.case];
  if (
    target.stage === "v3" &&
    /^V3-(absent|empty|configured)-(cancel|session-read)$/.test(request.case)
  ) {
    const state = request.case.split("-")[1];
    const start = new URL(vocabulary[`V3-${state}-resumable`].url);
    const keys = [...url.searchParams.keys()];
    if (
      url.origin !== start.origin ||
      url.pathname !== start.pathname ||
      keys.length !== 3 ||
      new Set(keys).size !== 3 ||
      url.searchParams.get("name") !== start.searchParams.get("name") ||
      url.searchParams.get("uploadType") !== "resumable" ||
      !/^[A-Za-z0-9._~-]{1,1024}$/.test(url.searchParams.get("upload_id") ?? "")
    )
      throw new GuardError("session URL outside the plan");
    planned = { ...planned, url: request.url };
  }
  if (target.stage === "v4" && planned?.token) {
    // The one dynamic part of a v4 URL: a page token the previous answer issued.
    const tokens = url.searchParams.getAll("pageToken");
    if (tokens.length !== 1 || !TOKEN_PATTERN.test(tokens[0]))
      throw new GuardError("page token outside the plan");
    planned = { ...planned, url: planned.url.replace(TOKEN_MARK, encodeURIComponent(tokens[0])) };
  }
  if (
    !planned ||
    request.url !== planned.url ||
    request.method !== planned.method ||
    (request.body ?? "") !== (planned.body ?? "")
  )
    throw new GuardError("request outside the plan");
  const headers = Object.fromEntries(new Headers(request.headers).entries());
  const authorization = headers.authorization;
  delete headers.authorization;
  if (
    JSON.stringify(Object.entries(headers).toSorted()) !==
    JSON.stringify(Object.entries(planned.headers).toSorted())
  )
    throw new GuardError("headers outside the plan");
  const expected =
    planned.auth === "malformed"
      ? "malformed"
      : (target.local && !planned.localBearer) || planned.auth === "none"
        ? "none"
        : planned.auth;
  if (
    (expected === "none" && authorization !== undefined) ||
    (expected === "malformed" && authorization !== "Firebase not-a-jwt") ||
    (expected === "bearer" && !/^Bearer [^\s]+$/.test(authorization ?? ""))
  )
    throw new GuardError("authorization outside the plan");
  return planned;
}

export class RequestBudget {
  count = 0;
  constructor(limit = 60) {
    this.limit = limit;
  }
  take() {
    if (this.count >= this.limit) throw new GuardError("request budget exhausted");
    return ++this.count;
  }
}

export const budgetFor = (stage) => new RequestBudget(stage === "v4" ? V4_BUDGET : 60);

export const isUnknownStatus = (status) =>
  !Number.isInteger(status) || status < 200 || (status >= 300 && status < 400) || status >= 500;
export const isSuccess = (status) => Number.isInteger(status) && status >= 200 && status < 300;
