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
// The recorder's own delivery summary is not kept: the judge computes it from the events and the
// versions (coordinator ruling 12, Should 4; the recorder's summary of a production pass matched
// times as text). Replaced everywhere (strings in bodies, paths, headers and events):
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
  otherRun: "OTHER_RUN_ID",
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
  out = out.split(secrets.run).join(PLACEHOLDERS.run);
  // An earlier run's id in a version description that a history page lists (RC-CLOSURE-A pass 1
  // listed the RC-OBSERVE-V2-3 versions): the recorders' run-id form after their marker.
  return out.replace(
    /(fireemu rc-(?:observe|closure) )[0-9]{12}[a-z0-9]{3}\b/g,
    `$1${PLACEHOLDERS.otherRun}`,
  );
}

/** Masks every string of a JSON value, and the name and image of every `updateUser` object. */
export function maskValue(value, secrets) {
  if (Array.isArray(value)) return value.map((item) => maskValue(item, secrets));
  if (value && typeof value === "object") {
    // Object.fromEntries defines own properties, so a member named __proto__ survives.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        maskText(key, secrets),
        key === "updateUser" && item && typeof item === "object" && !Array.isArray(item)
          ? maskUser(item, secrets)
          : maskValue(item, secrets),
      ]),
    );
  }
  return typeof value === "string" ? maskText(value, secrets) : value;
}

function maskUser(user, secrets) {
  return Object.fromEntries(
    Object.entries(maskValue(user, secrets)).map(([key, item]) => [
      key,
      key === "name" && typeof user.name === "string" && user.name !== ""
        ? PLACEHOLDERS.name
        : key === "imageUrl" && typeof user.imageUrl === "string" && user.imageUrl !== ""
          ? PLACEHOLDERS.image
          : item,
    ]),
  );
}

const pointer = (key) => key.replaceAll("~", "~0").replaceAll("/", "~1");

/**
 * Where a raw JSON text writes a character as an escape: for every string, under `name:<pointer>`
 * for a member name and `value:<pointer>` for a string value (two spaces that cannot collide,
 * coordinator ruling 5), the position in the decoded string and the escape as written, such as
 * `[15, "\\u003c"]`. The judge compares these by field and position, so an escape moved to
 * another character or another field is a difference.
 */
export function escapeMap(raw) {
  const escapes = {};
  let i = 0;
  const space = () => {
    while (i < raw.length && " \n\r\t".includes(raw[i])) i += 1;
  };
  const string = (at) => {
    i += 1;
    let decoded = "";
    const found = [];
    while (raw[i] !== '"') {
      if (i >= raw.length) throw new Error("unterminated string in a JSON body");
      if (raw[i] === "\\") {
        const sequence = raw[i + 1] === "u" ? raw.slice(i, i + 6) : raw.slice(i, i + 2);
        found.push([decoded.length, sequence]);
        decoded += JSON.parse(`"${sequence}"`);
        i += sequence.length;
      } else {
        decoded += raw[i];
        i += 1;
      }
    }
    i += 1;
    return { decoded, found, at };
  };
  const value = (path) => {
    space();
    if (raw[i] === "{") {
      i += 1;
      space();
      while (raw[i] !== "}") {
        if (i >= raw.length) throw new Error("unterminated object in a JSON body");
        space();
        const name = string(path);
        const keyed = `${path}/${pointer(name.decoded)}`;
        if (name.found.length) escapes[`name:${keyed}`] = name.found;
        space();
        i += 1; // ':'
        value(keyed);
        space();
        if (raw[i] === ",") i += 1;
        space();
      }
      i += 1;
    } else if (raw[i] === "[") {
      i += 1;
      let index = 0;
      space();
      while (raw[i] !== "]") {
        if (i >= raw.length) throw new Error("unterminated array in a JSON body");
        value(`${path}/${index}`);
        index += 1;
        space();
        if (raw[i] === ",") i += 1;
        space();
      }
      i += 1;
    } else if (raw[i] === '"') {
      const text = string(path);
      if (text.found.length) escapes[`value:${path}`] = text.found;
    } else {
      while (i < raw.length && !",}] \n\r\t".includes(raw[i])) i += 1;
    }
  };
  value("");
  return escapes;
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
      // A body that is not JSON (a defaults file, an empty defaults body) is kept as masked text.
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const json = parsed !== undefined;
      Object.assign(row, {
        status: answer.status,
        bodyBytes: answer.bytes,
        skeletonBytes: json ? skeletonBytes(text) : answer.bytes,
        // maskValue masks the paths (member names) as well as the escapes' text.
        escapes: json ? maskValue(escapeMap(text), secrets) : {},
        contentType: answer.contentType ?? null,
        contentEncoding: answer.contentEncoding ?? null,
        etag:
          answer.etag === undefined || answer.etag === null ? null : maskText(answer.etag, secrets),
        body: json ? maskValue(parsed, secrets) : null,
        ...(json ? {} : { text: maskText(text, secrets) }),
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
  };
  assertSanitised(JSON.stringify(fixture), secrets);
  return fixture;
}

/**
 * The text and what it may carry encoded: the text with its percent-escapes decoded, and every token
 * that could be base64 or base64url decoded as Latin-1 (one character per byte, so a digit run or
 * an address survives).
 */
export function decodedForms(text) {
  // Decode repeatedly, each form both ways, until nothing new appears (coordinator ruling 5:
  // percent inside base64, base64 inside percent, repeated); bounded in rounds and forms.
  const seen = new Set([text]);
  let frontier = [text];
  for (let round = 0; round < 6 && frontier.length && seen.size < 50_000; round += 1) {
    const next = [];
    for (const form of frontier) {
      const candidates = [
        form.replace(/%[0-9A-Fa-f]{2}/g, (escape) =>
          String.fromCharCode(parseInt(escape.slice(1), 16)),
        ),
        // Node's base64 decoder reads the base64url alphabet as well.
        ...(form.match(/[A-Za-z0-9+/_-]{8,}={0,2}/g) ?? []).map((token) =>
          Buffer.from(token, "base64").toString("latin1"),
        ),
      ];
      for (const candidate of candidates) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          next.push(candidate);
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}

/** Throws when a fixture text still carries a private value, plainly or encoded. */
export function assertSanitised(text, secrets) {
  const found = new Set();
  for (const form of decodedForms(text)) {
    if (form.includes(secrets.project)) found.add("project id");
    if (secrets.number && form.includes(secrets.number)) found.add("project number");
    if (form.includes(secrets.run)) found.add("run id");
    if (/etag-[0-9]+-/.test(form)) found.add("numeric ETag");
    const emails = (form.match(EMAIL) ?? []).filter((email) => email !== PLACEHOLDERS.email);
    if (emails.length) found.add("e-mail address");
  }
  if (found.size) throw new Error(`fixture still carries: ${[...found].join(", ")}`);
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
