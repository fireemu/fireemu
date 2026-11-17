import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isSuccess, isUnknownStatus } from "./guard.mjs";
import { v4Facts, V4_ROW_CASES } from "./v4-judge.mjs";

export function readJournal(path) {
  const text = readFileSync(path, "utf8");
  if (!text.endsWith("\n")) throw new Error("incomplete journal");
  return text
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

export function settlement(entries) {
  const states = new Map();
  const answered = new Set(
    entries
      .filter((entry) => entry.phase === "after")
      .map((entry) => `${entry.session ?? "run"}:${entry.n}`),
  );
  for (const entry of entries) {
    if (
      entry.phase !== "after" &&
      !(entry.phase === "before" && !answered.has(`${entry.session ?? "run"}:${entry.n}`))
    )
      continue;
    if (!entry.resource || !entry.action) continue;
    // Preflight reads of the default bucket confer no ownership or deletion obligation.
    if (entry.action === "read" && !states.has(entry.resource)) continue;
    const state = states.get(entry.resource) ?? {
      resource: entry.resource,
      confirmed: false,
      unknownCreate: false,
      unknownDelete: false,
      deleted: false,
      absent: false,
    };
    states.set(entry.resource, state);
    const unknown = entry.phase === "before" || entry.unknown || isUnknownStatus(entry.status);
    if (entry.action === "create") {
      if (unknown) {
        state.unknownCreate = true;
        state.absent = false;
        state.deleted = false;
      } else if (isSuccess(entry.status)) {
        state.confirmed = true;
        state.absent = false;
        state.deleted = false;
      }
    }
    if (entry.action === "delete") {
      if (unknown) {
        state.unknownDelete = true;
        state.absent = false;
      } else if (isSuccess(entry.status)) {
        state.deleted = true;
        state.absent = false;
      }
    }
    if (entry.action === "read" && !unknown) {
      if (isSuccess(entry.status) && entry.showsResource) {
        state.confirmed = true;
        state.unknownCreate = false;
        state.absent = false;
        state.deleted = false;
      }
      if (entry.status === 404 && !state.unknownCreate) {
        if (entry.session === "a2" || (state.deleted && !state.unknownDelete)) state.absent = true;
        if (entry.session === "a2") state.unknownDelete = false;
      }
    }
  }
  const unresolved = [...states.values()]
    .filter((s) => s.unknownCreate || s.unknownDelete || (s.confirmed && !s.absent))
    .map((s) =>
      Object.assign({}, s, {
        reason: s.unknownCreate
          ? "unconfirmed create"
          : s.unknownDelete
            ? "unknown delete"
            : "created, not deleted and read back absent",
      }),
    );
  return { closureReady: unresolved.length === 0, unresolved };
}

export function parseXmlError(text) {
  const match = /^(?:<\?xml\s+[^?]*\?>\s*)?<Error>([\s\S]*)<\/Error>\s*$/.exec(text);
  if (!match) return null;
  const fields = {};
  let remainder = match[1];
  const entity = (value) =>
    value.replace(
      /&(?:amp|lt|gt|quot|apos);/g,
      (s) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[s],
    );
  while (remainder.trim()) {
    const field =
      /^\s*<(Code|Message|Details|Resource|RequestId|HostId|BucketName)>([^<]*)<\/\1>/.exec(
        remainder,
      );
    if (!field || Object.hasOwn(fields, field[1]) || /&(?!(?:amp|lt|gt|quot|apos);)/.test(field[2]))
      return null;
    fields[field[1]] = entity(field[2]);
    remainder = remainder.slice(field[0].length);
  }
  return fields.Code && fields.Message ? { Code: fields.Code, Message: fields.Message } : null;
}

// The comparable error semantics of a JSON body: its code, message and first reason.
export function jsonErrorFields(value) {
  const error = value?.error;
  if (!error || typeof error !== "object") return null;
  return {
    code: error.code ?? null,
    message: error.message ?? null,
    reason: error.errors?.[0]?.reason ?? null,
  };
}

// The comparable error semantics of a recorded body text, whichever encoding it uses.
export function bodyErrorFields(text) {
  try {
    return { json: jsonErrorFields(JSON.parse(text)), xml: null };
  } catch {
    return { json: null, xml: parseXmlError(text) };
  }
}

// Validates a resumable Location against its own request and returns its request-relative
// structure. Protocol, host and bucket name differ between production and a local emulator,
// so only their agreement with the request is kept; the session id is masked.
export function resumableLocation(locationText, requestUrl) {
  try {
    const location = new URL(locationText);
    const request = new URL(requestUrl);
    const bucket = /^\/upload\/storage\/v1\/b\/([^/]+)\/o$/.exec(request.pathname)?.[1];
    const object = request.searchParams.get("name");
    const query = [...location.searchParams].toSorted(([a], [b]) => a.localeCompare(b));
    const expected = [...request.searchParams, ["upload_id", "<UPLOAD_ID>"]].toSorted(([a], [b]) =>
      a.localeCompare(b),
    );
    const mask = ([key, value]) => [
      key,
      key === "upload_id" ? "<UPLOAD_ID>" : key === "name" ? "<REQUEST_OBJECT>" : value,
    ];
    if (
      !bucket ||
      !object ||
      !["http:", "https:"].includes(location.protocol) ||
      location.origin !== request.origin ||
      location.pathname !== `/upload/storage/v1/b/${bucket}/o` ||
      location.username ||
      location.password ||
      location.hash ||
      location.searchParams.get("uploadType") !== "resumable" ||
      location.searchParams.getAll("name").length !== 1 ||
      location.searchParams.get("name") !== object ||
      location.searchParams.getAll("upload_id").length !== 1 ||
      !location.searchParams.get("upload_id") ||
      JSON.stringify(
        query.map(([key, value]) => [key, key === "upload_id" ? "<UPLOAD_ID>" : value]),
      ) !== JSON.stringify(expected)
    )
      return null;
    return {
      origin: "<REQUEST_ORIGIN>",
      path: "/upload/storage/v1/b/<REQUEST_BUCKET>/o",
      query: query.map(mask),
    };
  } catch {
    // An invalid or fully redacted Location is not evidence of a resumable URL.
    return null;
  }
}

export function judgeAnswer(entry) {
  const body = Buffer.from(entry.bodyBase64 ?? "", "base64");
  const headers = Object.fromEntries(new Headers(entry.headers ?? {}).entries());
  // Only names relevant to CORS are comparable; transport and Google frontend headers vary.
  const headerNames = Object.keys(headers)
    .filter((name) => name.startsWith("access-control-") || ["vary", "location"].includes(name))
    .toSorted();
  const row = {
    case: entry.case,
    status: entry.status,
    bodyBytes: entry.bodyBytes,
    sha256: createHash("sha256").update(body).digest("hex"),
    headerNames,
    headers: Object.fromEntries(
      headerNames
        .filter((name) => name.startsWith("access-control-") || name === "vary")
        .map((name) => [name, headers[name]]),
    ),
    json: null,
    xml: null,
    location: null,
    shape: "unrecorded",
    known: false,
  };
  const v3 =
    /^V3-(absent|empty|configured)-(metadata|media|bucket|list|acl|preflight|resumable|cancel|session-read)$/.exec(
      entry.case,
    );
  if (v3?.[2] === "resumable")
    row.exposesLocation = (headers["access-control-expose-headers"] ?? "")
      .split(",")
      .some((name) => name.trim().toLowerCase() === "location");
  const text = body.toString("utf8");
  try {
    const value = JSON.parse(text);
    const error = value?.error;
    if (error && typeof error === "object") {
      row.json = jsonErrorFields(value);
      if (
        Object.keys(value).length === 1 &&
        Object.keys(error).every((key) => ["code", "message", "errors"].includes(key)) &&
        Number.isInteger(error.code) &&
        error.code >= 400 &&
        error.code < 500 &&
        error.code === entry.status &&
        typeof error.message === "string" &&
        (error.errors === undefined ||
          (Array.isArray(error.errors) &&
            error.errors.length > 0 &&
            error.errors.every(
              (item) =>
                item &&
                typeof item.reason === "string" &&
                Object.keys(item).every((key) =>
                  ["reason", "message", "domain", "location", "locationType"].includes(key),
                ),
            )))
      )
        row.shape = "json-error";
    }
    // Validate resource shapes against their request; generated IDs, sizes and times are not compared.
    if (
      v3 &&
      entry.status === 200 &&
      entry.method === "GET" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !error
    ) {
      const bucket = /\/b\/([^/]+)/.exec(new URL(entry.url).pathname)?.[1];
      const object = (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        item.bucket === bucket &&
        item.name === "cors/o.txt" &&
        /^\d+$/.test(item.size ?? "");
      if (v3[2] === "metadata" && object(value)) row.shape = "object-metadata";
      if (v3[2] === "bucket" && value.name === bucket && typeof value.location === "string")
        row.shape = "bucket-metadata";
      if (
        v3[2] === "list" &&
        Array.isArray(value.items) &&
        value.items.length === 1 &&
        value.items.every(object) &&
        !value.nextPageToken
      )
        row.shape = "object-list";
      if (
        v3[2] === "acl" &&
        Array.isArray(value.items) &&
        value.items.length > 0 &&
        value.items.every(
          (item) =>
            item &&
            item.bucket === bucket &&
            item.object === "cors/o.txt" &&
            typeof item.entity === "string" &&
            typeof item.role === "string",
        )
      )
        row.shape = "object-acl";
    }
  } catch {
    row.xml = parseXmlError(text);
    if (row.xml && entry.status >= 400 && entry.status < 500) row.shape = "xml-error";
    else if (
      !body.length &&
      ((entry.method === "OPTIONS" && entry.status === 200) ||
        (entry.method === "DELETE" && entry.status === 204))
    )
      row.shape = "empty";
    else if (
      text === "fire" &&
      entry.status === 200 &&
      (["C5", "C6"].includes(entry.case) || (v3?.[2] === "media" && entry.method === "GET"))
    )
      row.shape = "media";
  }
  if (
    v3?.[2] === "resumable" &&
    entry.method === "POST" &&
    entry.status === 200 &&
    !body.length &&
    headerNames.includes("location")
  ) {
    row.location = resumableLocation(headers.location, entry.url);
    if (row.location) row.shape = "resumable-start";
  }
  if (entry.case?.startsWith("V4-")) {
    const { facts, shape } = v4Facts(entry, body, headers);
    row.v4 = facts;
    if (shape && row.shape === "unrecorded") row.shape = shape;
  }
  row.known =
    row.shape !== "unrecorded" &&
    !entry.unknown &&
    !entry.withheld &&
    !entry.headersRedacted &&
    !isUnknownStatus(entry.status) &&
    Number.isInteger(entry.bodyBytes) &&
    entry.bodyBytes === body.length &&
    body.toString("base64") === entry.bodyBase64;
  return row;
}

export function judgeJournal(entries) {
  const after = new Map(
    entries.filter((entry) => entry.phase === "after").map((entry) => [entry.n, entry]),
  );
  const before = entries.filter((entry) => entry.phase === "before");
  if (entries[0]?.stage === "v4") {
    return V4_ROW_CASES.flatMap((id) => {
      const matches = before.filter((entry) => entry.case === id);
      return (matches.length ? matches : [{ case: id }]).map((entry) => {
        const response = after.get(entry.n);
        return judgeAnswer(
          response ?? { ...entry, unknown: true, status: null, bodyBytes: 0, bodyBase64: "" },
        );
      });
    });
  }
  if (entries[0]?.stage === "v3") {
    const expected = ["absent", "empty", "configured"].flatMap((state) =>
      [
        "metadata",
        "media",
        "bucket",
        "list",
        "acl",
        "preflight",
        "resumable",
        "cancel",
        "session-read",
      ].map((endpoint) => `V3-${state}-${endpoint}`),
    );
    return expected.flatMap((id) => {
      const matches = before.filter((entry) => entry.case === id);
      return (matches.length ? matches : [{ case: id }]).map((entry) => {
        let response = after.get(entry.n);
        if (id.endsWith("-resumable") && response?.headers?.location === "<redacted-session>") {
          // Older journals redact the whole header, but record the issued URL when cancelling it.
          // The recorder accepts cancellation only for that exact issued URL; retain its structure.
          const cancellations = before.filter(
            (candidate) =>
              candidate.case === id.replace(/-resumable$/, "-cancel") &&
              candidate.method === "DELETE" &&
              candidate.n > entry.n &&
              candidate.session === entry.session,
          );
          if (cancellations.length === 1)
            response = {
              ...response,
              headers: { ...response.headers, location: cancellations[0].url },
            };
        }
        return judgeAnswer(
          response ?? {
            ...entry,
            unknown: true,
            status: null,
            bodyBytes: 0,
            bodyBase64: "",
          },
        );
      });
    });
  }
  return before.map((entry) =>
    judgeAnswer(
      after.get(entry.n) ?? {
        ...entry,
        unknown: true,
        status: null,
        bodyBytes: 0,
        bodyBase64: "",
      },
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(judgeJournal(readJournal(process.argv[2])), null, 2));
  } catch {
    console.error("Could not judge journal");
    process.exitCode = 1;
  }
}
