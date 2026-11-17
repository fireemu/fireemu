// A synthetic world for the v4 recorder: it exercises the sequence, never production evidence.
// Page tokens name the last entry returned; nothing here claims to be what production does.
const json = (status, value) => ({
  status,
  headers: { "content-type": "application/json; charset=UTF-8" },
  body: Buffer.from(JSON.stringify(value)),
});
const empty = (status, headers = {}) => ({ status, headers, body: Buffer.alloc(0) });
const fail = (status, message, reason) =>
  json(status, {
    error: { code: status, message, errors: [{ message, domain: "global", reason }] },
  });
const xmlError = (status, code, message) => ({
  status,
  headers: { "content-type": "application/xml; charset=UTF-8" },
  body: Buffer.from(
    `<?xml version='1.0' encoding='UTF-8'?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
  ),
});

export function globRegex(pattern) {
  if (pattern.length > 1024) return { error: "pattern too long" };
  let out = "";
  let braces = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      if (i + 1 >= pattern.length) return { error: "trailing escape" };
      out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "*") {
      if (pattern[i + 1] === "*") {
        while (pattern[i + 1] === "*") i++;
        out += ".*";
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end < 0) return { error: "unterminated bracket" };
      out += pattern.slice(i, end + 1);
      i = end;
    } else if (c === "{") {
      braces++;
      out += "(?:";
    } else if (c === "}") {
      if (!braces) return { error: "unbalanced brace" };
      braces--;
      out += ")";
    } else if (c === "," && braces) out += "|";
    else out += c.replace(/[.+^$()|\\]/g, "\\$&");
  }
  return braces ? { error: "unterminated brace" } : { regex: new RegExp(`^${out}$`) };
}

export function createFakeV4World(
  target,
  { faults = {}, applyBeforeFault = [], clock = { now: Date.now } } = {},
) {
  const buckets = new Map([[target.defaultBucket, { name: target.defaultBucket, location: "US" }]]);
  // A local run addresses a bucket the emulator configuration declares; production creates it.
  if (target.local) buckets.set(target.tempBucket, { name: target.tempBucket, location: "US" });
  const objects = new Map();
  const log = [];
  const resourceOf = (bucket) => ({
    kind: "storage#bucket",
    name: bucket.name,
    location: bucket.location ?? "US",
    storageClass: "STANDARD",
    ...(bucket.labels ? { labels: bucket.labels } : {}),
    ...(bucket.softDeletePolicy ? { softDeletePolicy: bucket.softDeletePolicy } : {}),
    iamConfiguration: bucket.iamConfiguration ?? {},
  });
  const objectResource = (object) => ({
    kind: "storage#object",
    name: object.name,
    bucket: object.bucket,
    size: String(object.size),
    ...(Object.keys(object.metadata).length ? { metadata: object.metadata } : {}),
  });
  const key = (bucket, name) => `${bucket}\n${name}`;
  const store = (bucket, name, body, metadata = {}) =>
    objects.set(key(bucket, name), { name, bucket, size: body.length, metadata, acl: [] });
  function list(bucket, url) {
    const q = url.searchParams;
    const prefix = q.get("prefix") ?? "";
    const delimiter = q.get("delimiter");
    const trailing = q.get("includeTrailingDelimiter") === "true";
    const max = Number(q.get("maxResults") ?? 1000);
    const token = q.get("pageToken");
    let match = null;
    if (q.has("matchGlob")) {
      const glob = globRegex(q.get("matchGlob"));
      if (glob.error) return fail(400, `Invalid matchGlob: ${glob.error}`, "invalid");
      match = glob.regex;
    }
    const entries = new Map();
    for (const object of [...objects.values()]
      .filter((o) => o.bucket === bucket && o.name.startsWith(prefix))
      .toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
      if (match && !match.test(object.name)) continue;
      const rest = object.name.slice(prefix.length);
      const at = delimiter ? rest.indexOf(delimiter) : -1;
      if (at < 0) entries.set(object.name, { item: object });
      else {
        const dir = prefix + rest.slice(0, at + 1);
        const entry = entries.get(dir) ?? {};
        entry.prefix = dir;
        if (trailing && object.name === dir) entry.item = object;
        entries.set(dir, entry);
      }
    }
    const after = token ? Buffer.from(token, "base64url").toString() : null;
    const ordered = [...entries.entries()]
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .filter(([name]) => after === null || name > after);
    const page = ordered.slice(0, max);
    const result = { kind: "storage#objects" };
    const prefixes = page.filter(([, e]) => e.prefix).map(([name]) => name);
    const items = page.filter(([, e]) => e.item).map(([, e]) => objectResource(e.item));
    if (prefixes.length) result.prefixes = prefixes;
    if (ordered.length > max)
      result.nextPageToken = Buffer.from(page.at(-1)[0]).toString("base64url");
    if (items.length) result.items = items;
    return json(200, result);
  }
  function multipart(r) {
    const boundary = /boundary=(.+)$/.exec(r.headers["content-type"])?.[1];
    const parts = r.body.split(`--${boundary}`).slice(1, -1);
    const [head, data] = parts.map((part) => part.split("\r\n\r\n")[1].replace(/\r\n$/, ""));
    return { meta: JSON.parse(head), data };
  }
  function perform(r) {
    const url = new URL(r.url);
    const path = url.pathname;
    const T = target.tempBucket;
    if (r.method === "POST" && path === "/storage/v1/b") {
      if (buckets.has(T)) return fail(409, "You already own this bucket.", "conflict");
      const body = JSON.parse(r.body);
      buckets.set(T, {
        ...body,
        softDeletePolicy: {
          retentionDurationSeconds: String(body.softDeletePolicy.retentionDurationSeconds),
        },
      });
      return json(200, resourceOf(buckets.get(T)));
    }
    if (path.startsWith("/v0/b/")) {
      const bucket = path.split("/")[3];
      if (!buckets.has(bucket)) return fail(404, "Not Found. Could not access bucket", "notFound");
      return fail(412, "Please enable Firebase Storage", "failedPrecondition");
    }
    const bucket =
      /^\/(?:storage\/v1|upload\/storage\/v1)\/b\/([^/]+)/.exec(path)?.[1] ?? path.split("/")[1];
    if (!buckets.has(bucket)) return fail(404, "The specified bucket does not exist.", "notFound");
    if (!path.startsWith("/storage/") && !path.startsWith("/upload/")) {
      const name = path.split("/").slice(2).join("/");
      if (r.method === "DELETE") {
        if (!objects.delete(key(bucket, name)))
          return xmlError(404, "NoSuchKey", "The specified key does not exist.");
        return empty(204);
      }
    }
    if (path.startsWith("/upload/")) {
      if (url.searchParams.get("uploadType") === "multipart") {
        const { meta, data } = multipart(r);
        store(bucket, meta.name, data, meta.metadata ?? {});
        return json(200, objectResource(objects.get(key(bucket, meta.name))));
      }
      const name = url.searchParams.get("name");
      store(bucket, name, r.body);
      return json(200, objectResource(objects.get(key(bucket, name))));
    }
    const parts = path.split("/").slice(5);
    if (!parts.length) {
      if (r.method === "DELETE") {
        if ([...objects.values()].some((o) => o.bucket === bucket))
          return fail(409, "The bucket you tried to delete is not empty.", "conflict");
        buckets.delete(bucket);
        return empty(204, { "content-length": "0", "content-type": "application/json" });
      }
      if (r.method === "PATCH") Object.assign(buckets.get(bucket), JSON.parse(r.body));
      return json(200, resourceOf(buckets.get(bucket)));
    }
    if (parts.length === 1) return list(bucket, url);
    const name = decodeURIComponent(parts[1]);
    const object = objects.get(key(bucket, name));
    if (!object) return fail(404, `No such object: ${bucket}/${name}`, "notFound");
    if (parts[2] === "copyTo") {
      const copy = decodeURIComponent(parts[6]);
      store(bucket, copy, "fire", { ...object.metadata });
      return json(200, objectResource(objects.get(key(bucket, copy))));
    }
    if (parts[2] === "acl") {
      const entity = parts[3] && decodeURIComponent(parts[3]);
      if (r.method === "POST") {
        const body = JSON.parse(r.body);
        object.acl.push({ entity: body.entity, role: body.role });
        return json(200, { kind: "storage#objectAccessControl", ...body });
      }
      if (r.method === "DELETE") {
        const at = object.acl.findIndex((entry) => entry.entity === entity);
        if (at < 0) return fail(404, "Not Found", "notFound");
        object.acl.splice(at, 1);
        return empty(204, { "content-length": "0", "content-type": "application/json" });
      }
      return json(200, {
        kind: "storage#objectAccessControls",
        items: object.acl.map((e) => ({ kind: "storage#objectAccessControl", ...e })),
      });
    }
    if (r.method === "DELETE") {
      objects.delete(key(bucket, name));
      return empty(204, { "content-length": "0", "content-type": "application/json" });
    }
    if (r.method === "PATCH") {
      for (const [member, value] of Object.entries(JSON.parse(r.body).metadata ?? {})) {
        if (value === null) delete object.metadata[member];
        else object.metadata[member] = value;
      }
    }
    return json(200, objectResource(object));
  }
  return {
    buckets,
    objects,
    sessions: new Map(),
    log,
    async net(request) {
      log.push({ ...request, at: clock.now() });
      const fault = faults[request.case];
      const answer =
        fault === undefined || applyBeforeFault.includes(request.case)
          ? perform(request)
          : undefined;
      if (fault === "transport") throw new Error("synthetic transport failure");
      if (typeof fault === "function") return fault(request, { buckets, objects, answer });
      return fault === undefined ? answer : { headers: {}, body: Buffer.alloc(0), ...fault };
    },
  };
}
