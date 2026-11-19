// The configuration changes of an index-merge observation send: the five entries that
// fs-query-index-merge.indexes.json adds to fs-query-index.indexes.json, created before the
// recording and removed after it, in the sandbox `(default)` database of fireemu-oracle-query.
//
//   node src/fs-query-index-merge/config.mjs status --set <f2|f1|all> --out <new dir> [--journal <file>]...
//   node src/fs-query-index-merge/config.mjs apply  --set <f2|f1|all> --out <new dir>
//   node src/fs-query-index-merge/config.mjs remove --set <f2|f1|all> --out <new dir> [--journal <file>]...
//
// `status` is read-only: which entries of the set exist (composites by a one-page list of their
// group, overrides by a GET of their field) and the state of the operations named in earlier
// journals. `apply` requires every entry of the set to be absent, then sends one POST or PATCH per
// entry, polls the operations they return and reads every entry back. `remove` reads every entry
// of the set first and sends nothing unless every read succeeded and showed either the expected
// entry or its absence; then it deletes the composites by the names it read, resets the overrides
// with the body firebase-tools sends to delete one (`{}`), polls the resets and reads back.
//
// Rules (presend reviews of packet v2, coordinator ruling 3, 2026-11-19):
// - Targets are fixed here; a name read from production is used only after it matches its full
//   expected pattern (project id or the FIREEMU_SANDBOX_PROJECT_NUMBER number, `(default)`, its
//   own group). A failed or malformed read sends nothing.
// - Every mutating request is sent once and classified done (2xx with a readable body), refused
//   (a definite 4xx other than 408, 429 and 499, with a readable body) or unknown (anything else).
//   An unknown create settles only on an own read showing the entry or its operation reading done;
//   absence never settles it. `remove` settles an entry's absence only against the journals of
//   the apply that created it, or of an earlier remove that removed it (--journal).
// - Bounds: a request cap per subcommand computed from the set, a wall-time cap, at most one page
//   per list, a 30 s timeout per request, a fresh token at least every 10 minutes; the journal
//   (journal.jsonl in --out, which must not exist yet) records every request and the counter.
// - Nothing is sent unless FIREEMU_MERGE_CONFIG_SEND has the launch script's exact value. No test
//   sets it.

import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { isMainModule } from "../fs-query-index/main-module.mjs";

export const PROJECT = "fireemu-oracle-query";
export const DATABASE = "(default)";
export const API = "https://firestore.googleapis.com/v1";
export const SEND_FLAG = "FIREEMU_MERGE_CONFIG_SEND";
export const SEND_FLAG_VALUE = "index-merge-obs-launch-v3";

const ASC = { fieldPath: "a", order: "ASCENDING" };
const TAGS = { fieldPath: "tags", arrayConfig: "CONTAINS" };

/** The five entries, as the lane index file states them (the test derives them from the file). */
export const ENTRIES = {
  E1: { kind: "composite", group: "imx", queryScope: "COLLECTION", fields: [ASC, TAGS] },
  E2: { kind: "composite", group: "imc", queryScope: "COLLECTION", fields: [ASC, TAGS] },
  E3: {
    kind: "override",
    group: "ima",
    field: "a",
    indexes: [{ queryScope: "COLLECTION", order: "ASCENDING" }],
  },
  E4: { kind: "override", group: "imx", field: "a", indexes: [] },
  E5: { kind: "override", group: "imx", field: "tags", indexes: [] },
};

/** F2 alone needs E3; F1 needs the composites and the exemptions. */
export const SETS = {
  f2: ["E3"],
  f1: ["E1", "E2", "E4", "E5"],
  all: ["E3", "E1", "E2", "E4", "E5"],
};

export const POLL_ROUNDS = 40;
export const POLL_INTERVAL_MS = 15_000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const TOKEN_MAX_AGE_MS = 10 * 60_000;
export const WALL_MS = { status: 5 * 60_000, apply: 20 * 60_000, remove: 20 * 60_000 };
/** Operations an earlier journal may name that `status` reads once each. */
export const STATUS_MAX_OPERATIONS = 5;

const databasePath = `projects/${PROJECT}/databases/${DATABASE}`;
const groupPath = (group) => `${databasePath}/collectionGroups/${group}`;
export const indexListUrl = (group) => `${API}/${groupPath(group)}/indexes`;
export const fieldUrl = (entry) => `${API}/${groupPath(entry.group)}/fields/${entry.field}`;

/**
 * The request cap of a subcommand for a set: every read, write and poll it may send, fixed before
 * the first request (status: one read per entry and at most STATUS_MAX_OPERATIONS operation reads).
 */
export function requestCap(command, set) {
  const n = SETS[set].length;
  const resets = SETS[set].filter((id) => ENTRIES[id].kind === "override").length;
  if (command === "status") return n + STATUS_MAX_OPERATIONS;
  if (command === "apply") return n + n + POLL_ROUNDS * n + n;
  if (command === "remove") return n + n + POLL_ROUNDS * resets + n;
  throw new Error(`unknown command ${command}`);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The project forms a name may carry: the id, and the sandbox number when it is given. */
export function projectForms(env = process.env) {
  const number = env.FIREEMU_SANDBOX_PROJECT_NUMBER ?? "";
  return /^[1-9]\d{5,}$/.test(number) ? [PROJECT, number] : [PROJECT];
}

const namePattern = (forms, tail) =>
  new RegExp(`^projects/(?:${forms.map(escape).join("|")})/databases/\\(default\\)/${tail}$`);
export const indexNamePattern = (forms, group) =>
  namePattern(forms, `collectionGroups/${escape(group)}/indexes/[A-Za-z0-9_-]+`);
export const fieldNamePattern = (forms, group, field) =>
  namePattern(forms, `collectionGroups/${escape(group)}/fields/${escape(field)}`);
export const operationNamePattern = (forms) => namePattern(forms, "operations/[A-Za-z0-9_-]+");

/** The POST body of a composite and the PATCH of an override, as firebase-tools 15.28.2 sends them. */
export function createRequest(entry) {
  if (entry.kind === "composite")
    return {
      method: "POST",
      url: indexListUrl(entry.group),
      body: { fields: entry.fields, queryScope: entry.queryScope },
    };
  return {
    method: "PATCH",
    url: `${fieldUrl(entry)}?updateMask=indexConfig`,
    body: {
      indexConfig: {
        indexes: entry.indexes.map((index) => ({
          queryScope: index.queryScope,
          fields: [
            {
              fieldPath: entry.field,
              ...(index.order ? { order: index.order } : {}),
              ...(index.arrayConfig ? { arrayConfig: index.arrayConfig } : {}),
            },
          ],
        })),
      },
    },
  };
}

/** What a mutating answer settles: `done`, `refused` or `unknown` (see the header). */
export function classify(answer) {
  if (!answer || answer.error !== undefined || !Number.isInteger(answer.status)) return "unknown";
  if (answer.json === undefined) return "unknown";
  if (answer.status >= 200 && answer.status < 300) return "done";
  if (answer.status >= 400 && answer.status < 500 && ![408, 429, 499].includes(answer.status))
    return "refused";
  return "unknown";
}

const readOk = (answer) => answer?.status === 200 && answer.json !== undefined && !answer.error;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fieldKey = (f) => `${f.fieldPath}:${f.order ?? f.arrayConfig ?? "?"}`;

/** A composite as listed matches its entry: same scope, the entry's fields then `__name__` ASC. */
export function compositeMatches(index, entry) {
  return (
    index?.queryScope === entry.queryScope &&
    Array.isArray(index.fields) &&
    same(
      index.fields.map(fieldKey),
      [...entry.fields, { fieldPath: "__name__", order: "ASCENDING" }].map(fieldKey),
    )
  );
}

/** The single-field indexes of a field as read, in the entry's form. */
const modesOf = (field) =>
  (field.indexConfig?.indexes ?? []).map((index) => {
    const mode = { queryScope: index.queryScope };
    const [first] = index.fields ?? [];
    if (first?.order) mode.order = first.order;
    if (first?.arrayConfig) mode.arrayConfig = first.arrayConfig;
    return mode;
  });

/**
 * One entry's state from its read: `absent`, `present` (with `name` and `ready`), or `unexpected`
 * (with a reason). A read that failed is `unreadable`.
 */
export function entryState(entry, answer, forms) {
  if (!readOk(answer)) return { state: "unreadable", reason: `read answered ${answer?.status}` };
  const body = answer.json;
  if (entry.kind === "composite") {
    if (body.nextPageToken) return { state: "unexpected", reason: "more than one page" };
    const indexes = body.indexes ?? [];
    if (!Array.isArray(indexes)) return { state: "unexpected", reason: "malformed list" };
    if (indexes.length === 0) return { state: "absent" };
    if (indexes.length > 1) return { state: "unexpected", reason: `${indexes.length} indexes` };
    const [index] = indexes;
    if (typeof index.name !== "string" || !indexNamePattern(forms, entry.group).test(index.name))
      return { state: "unexpected", reason: "index name outside the expected pattern" };
    if (!compositeMatches(index, entry))
      return { state: "unexpected", reason: "index fields or scope differ" };
    return { state: "present", name: index.name, ready: index.state === "READY" };
  }
  if (
    typeof body.name !== "string" ||
    !fieldNamePattern(forms, entry.group, entry.field).test(body.name)
  )
    return { state: "unexpected", reason: "field name outside the expected pattern" };
  if (body.ttlConfig !== undefined) return { state: "unexpected", reason: "the field has a TTL" };
  if (body.indexConfig?.usesAncestorConfig === true) return { state: "absent" };
  if (
    body.indexConfig?.usesAncestorConfig !== false &&
    body.indexConfig?.usesAncestorConfig !== undefined
  )
    return { state: "unexpected", reason: "malformed indexConfig" };
  const modes = modesOf(body);
  const sort = (list) => list.map((m) => JSON.stringify(m)).toSorted();
  if (!same(sort(modes), sort(entry.indexes)))
    return { state: "unexpected", reason: "the override differs from the entry" };
  const ready = (body.indexConfig?.indexes ?? []).every((index) => index.state === "READY");
  return { state: "present", name: body.name, ready };
}

/** Thrown when a cap would be exceeded; the request is not sent. */
export class BudgetExceeded extends Error {}

/**
 * The request layer of one subcommand: counts and journals every request, enforces the request and
 * wall-time caps and keeps the token fresh. `http` sends one request ({method, url, body, token})
 * and resolves to {status, json} or {error}; `token` resolves to an access token.
 */
export function createSession({ http, token, cap, wallMs, now = Date.now, journal = () => {} }) {
  const started = now();
  let sent = 0;
  let current;
  let fetchedAt = -Infinity;
  async function freshToken() {
    if (current === undefined || now() - fetchedAt >= TOKEN_MAX_AGE_MS) {
      current = await token();
      fetchedAt = now();
    }
    return current;
  }
  async function send(phase, { method, url, body }) {
    if (sent >= cap) throw new BudgetExceeded(`request cap ${cap} reached before ${method} ${url}`);
    if (now() - started >= wallMs)
      throw new BudgetExceeded(`wall time ${wallMs} ms reached before ${method} ${url}`);
    const bearer = await freshToken();
    sent += 1;
    let answer;
    try {
      answer = await http({ method, url, body, token: bearer });
    } catch (error) {
      answer = { error: String(error?.message ?? error) };
    }
    await journal({
      seq: sent,
      phase,
      method,
      url,
      ...(body === undefined ? {} : { body }),
      status: answer.status,
      ...(answer.error ? { error: answer.error } : {}),
      ...(answer.json === undefined ? {} : { json: answer.json }),
    });
    return answer;
  }
  return {
    send,
    get sent() {
      return sent;
    },
    cap,
  };
}

const readEntry = (session, phase, entry) =>
  session.send(phase, {
    method: "GET",
    url: entry.kind === "composite" ? indexListUrl(entry.group) : fieldUrl(entry),
  });

/** Reads every entry of the set; the states keyed by entry id. */
export async function readStates(session, phase, ids, forms) {
  const states = {};
  for (const id of ids)
    states[id] = entryState(ENTRIES[id], await readEntry(session, phase, ENTRIES[id]), forms);
  return states;
}

/** An operation answer: `done`, `failed` (done with an error), `running` or `unreadable`. */
export function operationState(answer, name, forms) {
  if (!readOk(answer)) return "unreadable";
  if (answer.json.name !== name || !operationNamePattern(forms).test(name)) return "unreadable";
  if (answer.json.done !== true) return "running";
  return answer.json.error === undefined ? "done" : "failed";
}

/**
 * Polls operations, all of them once per round, until every one is settled or POLL_ROUNDS rounds
 * have run. Only names that match the operation pattern are polled; one unreadable answer ends the
 * polling of that operation.
 */
export async function pollOperations(session, operations, forms, sleep) {
  const states = Object.fromEntries(Object.keys(operations).map((id) => [id, "running"]));
  for (let round = 0; round < POLL_ROUNDS; round += 1) {
    const open = Object.keys(operations).filter((id) => states[id] === "running");
    if (open.length === 0) break;
    if (round > 0) await sleep(POLL_INTERVAL_MS);
    for (const id of open) {
      const name = operations[id];
      const answer = await session.send("poll", { method: "GET", url: `${API}/${name}` });
      states[id] = operationState(answer, name, forms);
    }
  }
  return states;
}

/** The operation name of a done create or reset, when it has the expected form. */
function operationOf(answer, forms) {
  const name = answer?.json?.name;
  return typeof name === "string" && operationNamePattern(forms).test(name) ? name : undefined;
}

/**
 * apply: every entry of the set must read absent; then one create per entry, in the set's order,
 * stopping at the first answer that is not done; polls; reads back. Each entry ends as `created`
 * (done or unknown write, then its operation done or an own read showing it), `not-created` (its
 * write refused and an own read showing it absent), `not-sent`, or `open` (anything else: A2).
 */
export async function apply({ session, set, forms, sleep }) {
  const ids = SETS[set];
  const before = await readStates(session, "before", ids, forms);
  const blocked = ids.filter((id) => before[id].state !== "absent");
  if (blocked.length)
    return { ok: false, refusedBeforeSending: true, before, entries: {}, sent: session.sent };
  const writes = {};
  const operations = {};
  for (const id of ids) {
    if (Object.values(writes).some((w) => w.class !== "done")) {
      writes[id] = { class: "not-sent" };
      continue;
    }
    const answer = await session.send("create", createRequest(ENTRIES[id]));
    const operation = operationOf(answer, forms);
    writes[id] = {
      class: classify(answer),
      status: answer.status,
      ...(operation ? { operation } : {}),
    };
    if (operation) operations[id] = operation;
  }
  const polled = await pollOperations(session, operations, forms, sleep);
  const after = await readStates(session, "after", ids, forms);
  const entries = {};
  for (const id of ids) {
    const write = writes[id];
    const read = after[id];
    let outcome = "open";
    if (write.class === "not-sent" && read.state === "absent") outcome = "not-sent";
    else if (write.class === "refused" && read.state === "absent") outcome = "not-created";
    else if (read.state === "present" && read.ready && (polled[id] ?? "done") !== "failed")
      outcome = "created";
    else if (read.state === "present") outcome = "created-not-ready";
    entries[id] = { write, operation: polled[id], read, outcome };
  }
  const ok = ids.every((id) => entries[id].outcome === "created");
  return { ok, before, entries, sent: session.sent };
}

/** The outcome an apply journal gave each entry (the last apply that names it wins). */
export function applyOutcomes(results) {
  const outcomes = {};
  for (const result of results)
    for (const [id, entry] of Object.entries(result.entries ?? {})) outcomes[id] = entry.outcome;
  return outcomes;
}

/**
 * remove: reads every entry first; sends nothing unless every read is `absent` or `present`.
 * Deletes the present composites by the names read, resets the present overrides, polls the
 * resets, reads back. An entry is `closed` when it reads absent at the end and either this run
 * removed it (own DELETE or reset done, then absent) or the apply's own answers show it was never
 * created (`not-created`, `not-sent`), or an earlier remove closed it
 * (its journal). Everything else is `open` (A2).
 */
export async function remove({ session, set, forms, sleep, applied = {}, removed = [] }) {
  const ids = SETS[set];
  const before = await readStates(session, "before", ids, forms);
  const blocked = ids.filter((id) => !["absent", "present"].includes(before[id].state));
  if (blocked.length)
    return { ok: false, refusedBeforeSending: true, before, entries: {}, sent: session.sent };
  const writes = {};
  const operations = {};
  for (const id of ids) {
    if (before[id].state !== "present") continue;
    const entry = ENTRIES[id];
    const request =
      entry.kind === "composite"
        ? { method: "DELETE", url: `${API}/${before[id].name}` }
        : { method: "PATCH", url: fieldUrl(entry), body: {} };
    const answer = await session.send("remove", request);
    const operation = entry.kind === "override" ? operationOf(answer, forms) : undefined;
    writes[id] = {
      class: classify(answer),
      status: answer.status,
      ...(operation ? { operation } : {}),
    };
    if (operation) operations[id] = operation;
  }
  const polled = await pollOperations(session, operations, forms, sleep);
  const after = await readStates(session, "after", ids, forms);
  const entries = {};
  for (const id of ids) {
    const write = writes[id];
    const absent = after[id].state === "absent";
    const removedHere =
      write?.class === "done" && (ENTRIES[id].kind === "composite" || polled[id] === "done");
    const neverCreated = ["not-created", "not-sent"].includes(applied[id]);
    const removedEarlier = removed.includes(id);
    const outcome =
      absent && (removedHere || (!write && (neverCreated || removedEarlier))) ? "closed" : "open";
    entries[id] = { before: before[id], write, operation: polled[id], after: after[id], outcome };
  }
  const ok = ids.every((id) => entries[id].outcome === "closed");
  return { ok, before, entries, sent: session.sent };
}

/** status: the entries' states, and one read of each operation named in earlier journals. */
export async function status({ session, set, forms, operations = {} }) {
  const ids = SETS[set];
  const states = await readStates(session, "status", ids, forms);
  const names = Object.entries(operations).slice(0, STATUS_MAX_OPERATIONS);
  const polled = {};
  for (const [id, name] of names) {
    if (!operationNamePattern(forms).test(name)) {
      polled[id] = "unreadable";
      continue;
    }
    polled[id] = operationState(
      await session.send("status", { method: "GET", url: `${API}/${name}` }),
      name,
      forms,
    );
  }
  const ok = ids.every((id) => states[id].state === "absent" || states[id].state === "present");
  // `baseline`: none of the set exists; `applied`: all of it exists and is READY.
  const baseline = ok && ids.every((id) => states[id].state === "absent");
  const applied = ids.every((id) => states[id].state === "present" && states[id].ready);
  return { ok, baseline, applied, states, operations: polled, sent: session.sent };
}

/** The operation names and apply outcomes in journals of earlier runs (their result lines). */
export function fromJournals(texts) {
  const results = [];
  for (const text of texts)
    for (const line of text.split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.result) results.push(row.result);
    }
  const operations = {};
  for (const result of results)
    for (const [id, entry] of Object.entries(result.entries ?? {})) {
      const name = entry.write?.operation;
      if (name) operations[`${result.command}:${id}`] = name;
    }
  return {
    operations,
    applied: applyOutcomes(results.filter((r) => r.command === "apply")),
    // Entries an earlier remove closed (its own DELETE or reset done, then read absent).
    removed: [
      ...new Set(
        results
          .filter((r) => r.command === "remove")
          .flatMap((r) => Object.entries(r.entries ?? {}))
          .filter(([, entry]) => entry.outcome === "closed")
          .map(([id]) => id),
      ),
    ],
  };
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["status", "apply", "remove"].includes(command))
    throw new Error("usage: status|apply|remove");
  const args = { command, journals: [] };
  for (let i = 0; i < rest.length; i += 2) {
    const [key, value] = [rest[i], rest[i + 1]];
    if (value === undefined) throw new Error(`${key} needs a value`);
    if (key === "--set") args.set = value;
    else if (key === "--out") args.out = value;
    else if (key === "--journal") args.journals.push(value);
    else throw new Error(`unknown argument ${key}`);
  }
  if (!Object.hasOwn(SETS, args.set ?? "")) throw new Error("--set must be f2, f1 or all");
  if (!args.out) throw new Error("--out is required");
  if (command === "apply" && args.journals.length) throw new Error("apply takes no --journal");
  return args;
}

/** The production request layer: fetch with the ADC token, the quota project and a timeout. */
export function productionHttp(env = process.env, fetchImpl = fetch) {
  if (env[SEND_FLAG] !== SEND_FLAG_VALUE)
    throw new Error(`refusing to send: ${SEND_FLAG} is not the launch script's value`);
  const allowed = namePattern(projectForms(env), "\\S+");
  return async ({ method, url, body, token }) => {
    if (!url.startsWith(`${API}/`) || !allowed.test(url.slice(API.length + 1)))
      throw new Error(`refusing a request outside ${PROJECT}/${DATABASE}: ${url}`);
    const response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "x-goog-user-project": PROJECT,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, json, bytes: Buffer.byteLength(text) };
  };
}

const execFileAsync = promisify(execFile);
async function adcToken() {
  const { stdout } = await execFileAsync("gcloud", [
    "auth",
    "application-default",
    "print-access-token",
  ]);
  return stdout.trim();
}

/** Runs one subcommand; returns the exit code (0 ok, 2 open or refused, 3 usage or setup). */
export async function main(argv, { env = process.env, http, token = adcToken, sleep, now } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(String(error.message));
    return 3;
  }
  let send;
  try {
    send = http ?? productionHttp(env);
  } catch (error) {
    console.error(String(error.message));
    return 3;
  }
  // A fresh directory per run: an earlier journal is never appended to.
  try {
    await mkdir(args.out, { mode: 0o700 });
  } catch (error) {
    console.error(`--out ${args.out}: ${error.code ?? error.message}`);
    return 3;
  }
  const journalPath = join(args.out, "journal.jsonl");
  const journal = (row) => appendFile(journalPath, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  const earlier = fromJournals(await Promise.all(args.journals.map((p) => readFile(p, "utf8"))));
  const forms = projectForms(env);
  const cap = requestCap(args.command, args.set);
  const session = createSession({
    http: send,
    token,
    cap,
    wallMs: WALL_MS[args.command],
    ...(now ? { now } : {}),
    journal,
  });
  const pause = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let result;
  try {
    if (args.command === "status")
      result = await status({ session, set: args.set, forms, operations: earlier.operations });
    else if (args.command === "apply")
      result = await apply({ session, set: args.set, forms, sleep: pause });
    else
      result = await remove({
        session,
        set: args.set,
        forms,
        sleep: pause,
        applied: earlier.applied,
        removed: earlier.removed,
      });
  } catch (error) {
    result = { ok: false, error: String(error.message), sent: session.sent };
  }
  const summary = { command: args.command, set: args.set, cap, ...result, sent: session.sent };
  await journal({ result: summary });
  await writeFile(join(args.out, "result.json"), `${JSON.stringify(summary, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      command: args.command,
      set: args.set,
      ok: summary.ok,
      sent: summary.sent,
      cap,
    }),
  );
  return summary.ok ? 0 : 2;
}

if (isMainModule(import.meta)) process.exitCode = await main(process.argv.slice(2));
