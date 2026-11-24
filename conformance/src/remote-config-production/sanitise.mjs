// Turns one run directory of the Remote Config observation recorder (src/remote-config-observe)
// into a committable fixture: the Remote Config rows only, with the private values replaced.
//
//   node src/remote-config-production/sanitise.mjs <run dir> <new fixture file>
//
// The run directory holds run.json, journal.jsonl, events.json, result.json and one .body file per
// answer. Only requests to the Remote Config API (production) or to the control listener's
// Remote Config routes (local) are kept; the infrastructure rows of a production run (Service
// Usage, IAM, Functions deploys, logs) are dropped and only counted.
//
// Replaced everywhere (strings in bodies, paths, headers, events and the summary):
//   - the project id -> PROJECT_ID, the project number (read from the production ETags) ->
//     PROJECT_NUMBER, the run id -> RUN_ID;
//   - any e-mail address -> user@example.com; a non-empty `updateUser.name` -> Example User and a
//     non-empty `updateUser.imageUrl` -> https://example.com/user.png.
// The recorded `bodyBytes` and the layout length (`skeletonBytes`: the body bytes without the bytes
// inside string values, measured on the raw body) are kept, so the judge compares layout on the
// recorded bytes, never on the re-serialised masked body. `assertSanitised` refuses any output that
// still contains a private value.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDERS = {
  project: "PROJECT_ID",
  number: "PROJECT_NUMBER",
  run: "RUN_ID",
  email: "user@example.com",
  name: "Example User",
  image: "https://example.com/user.png",
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PRODUCTION_HOST = "firebaseremoteconfig.googleapis.com";
const ROUTE = /^\/v1\/projects\/([^/]+)\/(?:remoteConfig|namespaces\/[^/]+\/)/;

/** The project id, project number and run id of a run, read from its own records. */
export function secretsOf({ run, journal }) {
  const sends = journal.filter((row) => row.phase === "before-send");
  const remote = sends.map((row) => new URL(row.url)).find((url) => ROUTE.test(url.pathname));
  if (!remote) throw new Error("the journal has no Remote Config request");
  const project = decodeURIComponent(ROUTE.exec(remote.pathname)[1]);
  const numbers = new Set(
    journal
      .flatMap((row) => [row.etag, row.ifMatch])
      .map((tag) => /^etag-([0-9]+)-[0-9]+$/.exec(tag ?? "")?.[1])
      .filter(Boolean),
  );
  if (numbers.size > 1) throw new Error("the ETags name more than one project number");
  if (!/^[a-z0-9]{8,24}$/.test(run.runId ?? "")) throw new Error("run.json has no valid run id");
  return { project, number: [...numbers][0] ?? null, run: run.runId };
}

/** Replaces the private values inside one string. */
export function maskText(text, secrets) {
  let out = text.replace(EMAIL, PLACEHOLDERS.email);
  if (secrets.number) out = out.split(secrets.number).join(PLACEHOLDERS.number);
  out = out.split(secrets.project).join(PLACEHOLDERS.project);
  return out.split(secrets.run).join(PLACEHOLDERS.run);
}

/** Masks every string of a JSON value, and the name and image of every `updateUser` object. */
export function maskValue(value, secrets) {
  if (Array.isArray(value)) return value.map((item) => maskValue(item, secrets));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[maskText(key, secrets)] =
        key === "updateUser" && item && typeof item === "object" && !Array.isArray(item)
          ? maskUser(item, secrets)
          : maskValue(item, secrets);
    }
    return out;
  }
  return typeof value === "string" ? maskText(value, secrets) : value;
}

function maskUser(user, secrets) {
  const out = maskValue(user, secrets);
  if (typeof user.name === "string" && user.name !== "") out.name = PLACEHOLDERS.name;
  if (typeof user.imageUrl === "string" && user.imageUrl !== "") out.imageUrl = PLACEHOLDERS.image;
  return out;
}

/**
 * The bytes of a raw JSON text outside string values: the body length minus the raw bytes between
 * the quotes of every string that is a value (object keys are layout and stay counted).
 */
export function skeletonBytes(raw) {
  const bytes = Buffer.from(raw, "utf8");
  let total = bytes.length;
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] !== 0x22) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < bytes.length && bytes[j] !== 0x22) j += bytes[j] === 0x5c ? 2 : 1;
    if (j >= bytes.length) throw new Error("unterminated string in a JSON body");
    let k = j + 1;
    while (k < bytes.length && [0x20, 0x0a, 0x0d, 0x09].includes(bytes[k])) k += 1;
    if (bytes[k] !== 0x3a) total -= j - i - 1;
    i = j + 1;
  }
  return total;
}

/** The fixture of one run. `files` maps a body file name to its bytes. */
export function sanitiseRun({ run, journal, events, result, files }) {
  const secrets = secretsOf({ run, journal });
  const sends = new Map(
    journal.filter((row) => row.phase === "before-send").map((row) => [row.seq, row]),
  );
  const answers = new Map(
    journal.filter((row) => row.phase !== "before-send").map((row) => [row.seq, row]),
  );
  const rows = [];
  let dropped = 0;
  for (const [seq, send] of sends) {
    const url = new URL(send.url);
    const remote =
      ROUTE.test(url.pathname) && (run.target === "local" || url.hostname === PRODUCTION_HOST);
    if (!remote) {
      dropped += 1;
      continue;
    }
    const answer = answers.get(seq);
    const row = {
      seq,
      case: send.case,
      method: send.method,
      path: maskText(decodeURIComponent(url.pathname), secrets),
      query: maskText(url.search.replace(/^\?/, ""), secrets),
      ifMatch: send.ifMatch === undefined ? null : maskText(send.ifMatch, secrets),
      phase: answer?.phase ?? "unanswered",
    };
    if (answer?.phase === "response-persisted") {
      const raw = files[answer.file];
      if (raw === undefined) throw new Error(`body file ${answer.file} is missing`);
      const text = raw.toString("utf8");
      if (raw.length !== answer.bytes)
        throw new Error(`${answer.file} is not ${answer.bytes} bytes`);
      if (createHash("sha256").update(raw).digest("hex") !== answer.sha256)
        throw new Error(`${answer.file} does not match its journal digest`);
      Object.assign(row, {
        status: answer.status,
        bodyBytes: answer.bytes,
        skeletonBytes: skeletonBytes(text),
        unicodeEscapes: (text.match(/\\u[0-9a-fA-F]{4}/g) ?? []).length,
        contentType: answer.contentType ?? null,
        contentEncoding: answer.contentEncoding ?? null,
        etag:
          answer.etag === undefined || answer.etag === null ? null : maskText(answer.etag, secrets),
        body: maskValue(JSON.parse(text), secrets),
      });
    }
    rows.push(row);
  }
  const before = result.baseline?.before ?? {};
  const fixture = {
    schemaVersion: 1,
    kind: "remote-config-observation-rows",
    target: run.target,
    requests: journal.filter((row) => row.phase === "before-send").length,
    infrastructureRequests: dropped,
    baseline: Object.fromEntries(
      ["client", "server"].map((ns) => [
        ns,
        { version: before[ns]?.version ?? null, empty: before[ns]?.empty ?? null },
      ]),
    ),
    complete: result.complete === true,
    open: maskValue(result.open ?? [], secrets),
    rows,
    versions: maskValue(result.versions ?? [], secrets),
    events: maskValue(events, secrets),
    summary: maskValue(result.summary ?? null, secrets),
  };
  assertSanitised(JSON.stringify(fixture), secrets);
  return fixture;
}

/** Throws when a fixture text still carries a private value. */
export function assertSanitised(text, secrets) {
  const found = [];
  if (text.includes(secrets.project)) found.push("project id");
  if (secrets.number && text.includes(secrets.number)) found.push("project number");
  if (text.includes(secrets.run)) found.push("run id");
  if (/etag-[0-9]{5,}-/.test(text)) found.push("numeric ETag");
  const emails = (text.match(EMAIL) ?? []).filter((email) => email !== PLACEHOLDERS.email);
  if (emails.length) found.push("e-mail address");
  if (found.length) throw new Error(`fixture still carries: ${found.join(", ")}`);
}

/** Reads a run directory into the inputs of `sanitiseRun`. */
export function readRun(dir) {
  const json = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  const journal = readFileSync(join(dir, "journal.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const files = {};
  for (const row of journal) if (row.file) files[row.file] = readFileSync(join(dir, row.file));
  return {
    run: json("run.json"),
    journal,
    events: json("events.json"),
    result: json("result.json"),
    files,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) throw new Error("usage: sanitise.mjs <run dir> <new fixture file>");
  if (existsSync(out)) throw new Error(`${out} exists`);
  writeFileSync(out, JSON.stringify(sanitiseRun(readRun(dir)), null, 2) + "\n", { flag: "wx" });
}
