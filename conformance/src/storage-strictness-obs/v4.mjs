// Stage v4: the Storage strict residuals (list, glob, token, metadata order, 204 framing, bucket
// resource and the non-Firebase bucket). One fresh uniform-access bucket T, every request fixed here.
// This module holds the finite request vocabulary and the sequence; guard.mjs, wire.mjs and run.mjs
// apply it with the same checks as v3.

export const V4_BUDGET = 140;
export const V4_HOSTS = ["storage.googleapis.com", "firebasestorage.googleapis.com"];
const BOUNDARY = "fireemuobsv4";
// Objects the sequence may create. Cleanup deletes exactly these names (and the copy target).
export const V4_OBJECTS = [
  ["tl-d1", "tl/d1/", ""],
  ["tl-d1a", "tl/d1/a.txt", "fire"],
  ["tl-d2a", "tl/d2/a.txt", "fire"],
  ["tl-f", "tl/f.txt", "fire"],
  ["pg-a", "pg/a", "fire"],
  ["pg-b", "pg/b", "fire"],
  ["pg-c", "pg/c", "fire"],
  ["pg-d", "pg/d", "fire"],
  ["pg-e", "pg/e", "fire"],
  ["gl-a", "gl/a.txt", "fire"],
  ["gl-ab", "gl/ab.txt", "fire"],
  ["gl-c", "gl/sub/c.txt", "fire"],
  ["md-plain", "md/plain.txt", "fire"],
  ["x-xml", "x/xml.txt", "fire"],
];
export const V4_MULTIPART_NAME = "md/up.txt";
export const V4_COPY_NAME = "md/copy.txt";
export const V4_METADATA = { zeta: "1", alpha: "2", mid: "3" };
export const V4_GLOB_LENGTHS = [64, 512, 1024, 1025, 2048, 4096, 8000];
export const nest = (depth) => {
  let pattern = "a";
  for (let i = 0; i < depth; i++) pattern = `{${pattern},zz}`;
  return pattern;
};
export const TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{1,1024}$/;
export const TOKEN_MARK = "<token>";

export const V4_GLOBS = [
  ["ctl", "gl/*"],
  ["doublestar", "gl/**"],
  ...V4_GLOB_LENGTHS.slice(0, 4).map((n) => [`len-${n}`, `gl/${"a".repeat(n - 3)}`]),
  ["brace-3", `gl/${nest(3)}.txt`],
  ["brace-32", `gl/${nest(32)}.txt`],
  ["star-seg-64", `gl/${"*".repeat(64)}.txt`],
  ["doublestar-chain-8", `gl/${"**/".repeat(8)}c.txt`],
  ["unterm-bracket", "gl/[a"],
  ["unterm-brace", "gl/{a,b"],
  ["unterm-escape", "gl/a\\"],
  ["empty", ""],
  ...V4_GLOB_LENGTHS.slice(4).map((n) => [`len-${n}`, `gl/${"a".repeat(n - 3)}`]),
];

export function requestsV4(t) {
  const { defaultBucket: D, tempBucket: T } = t;
  const b = (bucket) => `/storage/v1/b/${bucket}`;
  const o = (bucket, name) => `${b(bucket)}/o/${encodeURIComponent(name)}`;
  const out = {};
  const json = { "content-type": "application/json" };
  function add(
    id,
    method,
    path,
    {
      firebase = false,
      headers = {},
      body,
      action,
      resource,
      auth = "bearer",
      token,
      localBearer,
    } = {},
  ) {
    out[id] = {
      case: id,
      method,
      url: `${t.local ?? `https://${V4_HOSTS[firebase ? 1 : 0]}`}${path}`,
      headers,
      body,
      action,
      resource,
      auth,
      ...(token ? { token } : {}),
      ...(localBearer ? { localBearer } : {}),
    };
  }
  const read = (id, resource) => add(id, "GET", resource, { action: "read", resource });
  const list = (id, query, token) => add(id, "GET", `${b(T)}/o?${query}`, { token });
  const tok = "&pageToken=" + TOKEN_MARK;
  read("V4-P-location", b(D));
  read("V4-P-absent", b(T));
  add("V4-W-bucket", "POST", `/storage/v1/b?project=${t.project}`, {
    body: JSON.stringify({
      name: T,
      location: t.location ?? "US",
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
      softDeletePolicy: { retentionDurationSeconds: 0 },
    }),
    headers: json,
    action: "create",
    resource: b(T),
  });
  read("V4-W-verify", b(T));
  add("V4-initial-list", "GET", `${b(T)}/o`);
  for (const [key, name, body] of V4_OBJECTS)
    add(
      `V4-U-${key}`,
      "POST",
      `/upload/storage/v1/b/${T}/o?uploadType=media&name=${encodeURIComponent(name)}`,
      { body, headers: { "content-type": "text/plain" } },
    );
  add("V4-U-md-up", "POST", `/upload/storage/v1/b/${T}/o?uploadType=multipart`, {
    headers: { "content-type": `multipart/related; boundary=${BOUNDARY}` },
    body:
      `--${BOUNDARY}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name: V4_MULTIPART_NAME, contentType: "text/plain", metadata: V4_METADATA })}` +
      `\r\n--${BOUNDARY}\r\ncontent-type: text/plain\r\n\r\nfire\r\n--${BOUNDARY}--`,
  });
  // includeTrailingDelimiter: placeholder tl/d1/, prefix tl/d1/ and tl/d2/ (no placeholder), item tl/f.txt.
  const tl = "prefix=tl%2F&delimiter=%2F";
  list("V4-L-delim", tl);
  list("V4-L-itd-true", `${tl}&includeTrailingDelimiter=true`);
  list("V4-L-itd-false", `${tl}&includeTrailingDelimiter=false`);
  list("V4-L-sub", "prefix=tl%2Fd1%2F&delimiter=%2F");
  list("V4-L-itd-sub", "prefix=tl%2Fd1%2F&delimiter=%2F&includeTrailingDelimiter=true");
  list("V4-L-itd-nodelim", "prefix=tl%2F&includeTrailingDelimiter=true");
  const itd1 = `${tl}&includeTrailingDelimiter=true&maxResults=1`;
  list("V4-L-itd-p1", itd1);
  list("V4-L-itd-p2", itd1 + tok, "V4-L-itd-p1");
  list("V4-L-itd-p3", itd1 + tok, "V4-L-itd-p2");
  list("V4-L-itd-p4", itd1 + tok, "V4-L-itd-p3");
  list("V4-L-nf-p1", `${tl}&maxResults=1`);
  list("V4-L-nf-p2", `${tl}&maxResults=1` + tok, "V4-L-nf-p1");
  list("V4-L-nf-p3", `${tl}&maxResults=1` + tok, "V4-L-nf-p2");
  // A page token whose entry disappears before the next request.
  const del = (id, name) => add(id, "DELETE", o(T, name));
  list("V4-G-p1", "prefix=pg%2F&maxResults=2");
  del("V4-G-del-b", "pg/b");
  list("V4-G-p2", "prefix=pg%2F&maxResults=2" + tok, "V4-G-p1");
  list("V4-G-p1b", "prefix=pg%2F&maxResults=2");
  del("V4-G-del-d", "pg/d");
  list("V4-G-p2b", "prefix=pg%2F&maxResults=2" + tok, "V4-G-p1b");
  list("V4-G-p1c", "prefix=pg%2F&maxResults=1");
  del("V4-G-del-c", "pg/c");
  del("V4-G-del-e", "pg/e");
  list("V4-G-p2c", "prefix=pg%2F&maxResults=1" + tok, "V4-G-p1c");
  list("V4-G-d1", `${tl}&maxResults=1`);
  del("V4-G-del-d2a", "tl/d2/a.txt");
  list("V4-G-d2", `${tl}&maxResults=1` + tok, "V4-G-d1");
  // Custom metadata member order.
  add(
    "V4-MD-copy",
    "POST",
    `${o(T, V4_MULTIPART_NAME)}/copyTo/b/${T}/o/${encodeURIComponent(V4_COPY_NAME)}`,
    {
      body: "",
    },
  );
  const patch = (id, name, metadata) =>
    add(id, "PATCH", o(T, name), { headers: json, body: JSON.stringify({ metadata }) });
  read("V4-MD-get-up", o(T, V4_MULTIPART_NAME));
  patch("V4-MD-patch-add", V4_MULTIPART_NAME, { beta: "4" });
  patch("V4-MD-patch-replace", V4_MULTIPART_NAME, { alpha: "9" });
  patch("V4-MD-patch-delete", V4_MULTIPART_NAME, { zeta: null });
  patch("V4-MD-patch-plain", "md/plain.txt", { yb: "1", ya: "2", yc: "3" });
  list("V4-MD-list", "prefix=md%2F");
  // 204 framing. Legacy ACL routes are not observed: they need a fine-grained bucket and an ACL grant.
  // The XML API refuses an anonymous DELETE, so a local run carries a bearer for these two requests.
  add("V4-X-xml-delete", "DELETE", `/${T}/x/xml.txt`, { localBearer: true });
  add("V4-X-xml-delete-again", "DELETE", `/${T}/x/xml.txt`, { localBearer: true });
  // The bucket resource (the fields-less GET is V4-W-verify) and a non-Firebase bucket on the Firebase API.
  add("V4-B-full", "GET", `${b(T)}?projection=full`);
  add("V4-B-patch", "PATCH", b(T), {
    headers: json,
    body: JSON.stringify({ labels: { "fireemu-obs": "v4" } }),
  });
  add("V4-N-get", "GET", `/v0/b/${T}/o/${encodeURIComponent("tl/f.txt")}`, {
    firebase: true,
    auth: "none",
  });
  add("V4-N-list", "GET", `/v0/b/${T}/o?prefix=tl%2F`, { firebase: true, auth: "none" });
  // matchGlob: a control, syntax and the pattern length ladder (longest last).
  for (const [key, pattern] of V4_GLOBS)
    list(`V4-M-${key}`, `matchGlob=${encodeURIComponent(pattern)}`);
  // Cleanup and read-back.
  for (const [key, name] of [
    ...V4_OBJECTS.map(([k, n]) => [k, n]),
    ["md-up", V4_MULTIPART_NAME],
    ["md-copy", V4_COPY_NAME],
  ])
    add(`V4-K-del-${key}`, "DELETE", o(T, name));
  read("V4-K-read-object", o(T, "tl/f.txt"));
  read("V4-K-read-created-bucket", b(T));
  add("V4-K-delete-bucket", "DELETE", b(T), { action: "delete", resource: b(T) });
  read("V4-K-bucket", b(T));
  read("V4-A2-bucket", b(T));
  read("V4-A2-object", o(T, "tl/f.txt"));
  return out;
}

// The observation steps in the order they run; the glob ladder is last so a stop loses only its tail.
export const V4_OBSERVATIONS = [
  "V4-L-delim",
  "V4-L-itd-true",
  "V4-L-itd-false",
  "V4-L-sub",
  "V4-L-itd-sub",
  "V4-L-itd-nodelim",
  "V4-L-itd-p1",
  "V4-L-itd-p2",
  "V4-L-itd-p3",
  "V4-L-itd-p4",
  "V4-L-nf-p1",
  "V4-L-nf-p2",
  "V4-L-nf-p3",
  "V4-G-p1",
  "V4-G-del-b",
  "V4-G-p2",
  "V4-G-p1b",
  "V4-G-del-d",
  "V4-G-p2b",
  "V4-G-p1c",
  "V4-G-del-c",
  "V4-G-del-e",
  "V4-G-p2c",
  "V4-G-d1",
  "V4-G-del-d2a",
  "V4-G-d2",
  "V4-MD-copy",
  "V4-MD-get-up",
  "V4-MD-patch-add",
  "V4-MD-patch-replace",
  "V4-MD-patch-delete",
  "V4-MD-patch-plain",
  "V4-MD-list",
  "V4-X-xml-delete",
  "V4-X-xml-delete-again",
  "V4-B-full",
  "V4-B-patch",
  "V4-N-get",
  "V4-N-list",
  ...V4_GLOBS.map(([key]) => `V4-M-${key}`),
];
