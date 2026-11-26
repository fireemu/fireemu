// RC-CLOSURE-B recorder entry point. Production only (the local comparison harness follows the
// recording, coordinator ruling 10):
//
//   node src/remote-config-web/record.mjs --send-production --out <new dir>
//   node src/remote-config-web/record.mjs --send-production --a2-of <run dir> --out <new dir>
//
// Reads FIREEMU_SANDBOX_PROJECT_NUMBER and the caller's ADC token from gcloud; refuses a
// credential file or a gcloud override in the environment. Production is sent only with
// --send-production, which only the packet's launch script passes.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { newRunId } from "../remote-config-observe/record.mjs";
import { Transport } from "../remote-config-observe/transport.mjs";
import { openBrowser } from "./driver.mjs";
import {
  API_TARGETS,
  KEY_ID,
  MAX_ADMIN_REQUESTS,
  MAX_PAGE_REQUESTS,
  PRODUCTION_TIMING,
  baselineEmpty,
  isDeleted,
  observe,
} from "./program.mjs";

export const PROJECT = "fireemu-oracle-query";
export const A2_MAX_REQUESTS = 4;
export const A2_DELAY_MS = 10 * 60_000;

/** The newest modification time of the files of a run directory (milliseconds since the epoch). */
export function lastActivity(dir) {
  const times = readdirSync(dir).map((name) => statSync(join(dir, name)).mtimeMs);
  if (!times.length) throw new Error(`${dir} is empty`);
  return Math.max(...times);
}
const RC = "https://firebaseremoteconfig.googleapis.com";
const KEYS = "https://apikeys.googleapis.com/v2/";

export function adminUrls(project) {
  const services = new URL(
    `https://serviceusage.googleapis.com/v1/projects/${project}/services:batchGet`,
  );
  for (const s of API_TARGETS)
    services.searchParams.append("names", `projects/${project}/services/${s}`);
  const keys = `${KEYS}projects/${project}/locations/global/keys`;
  return {
    client: `${RC}/v1/projects/${project}/remoteConfig`,
    services: services.href,
    webApps: `https://firebase.googleapis.com/v1beta1/projects/${project}/webApps`,
    keysList: keys,
    keysListDeleted: `${keys}?showDeleted=true`,
    keysCreate: keys,
    keysApi: KEYS,
  };
}

/**
 * The closed set of admin requests: fixed forms bound to their host, and the operation and key
 * names this pass's own create and delete returned (`grants`).
 */
export function productionAllow(project, grants) {
  const u = adminUrls(project);
  const exact = new Set([
    `GET ${u.client}`,
    `PUT ${u.client}`,
    `POST ${u.client}:rollback`,
    `GET ${u.services}`,
    `GET ${u.webApps}`,
    `GET ${u.keysList}`,
    `GET ${u.keysListDeleted}`,
    `POST ${u.keysCreate}`,
  ]);
  return (url, method, { signed } = {}) => {
    if (signed || url.protocol !== "https:" || url.username || url.password || url.port)
      return false;
    const href = url.href;
    if (exact.has(`${method} ${href}`)) return true;
    // A granted name is read only under the complete API Keys prefix, and only when it has the
    // granted type's form (ruling 16 item 5).
    if (!href.startsWith(KEYS) || url.search || url.hash) return false;
    const name = href.slice(KEYS.length);
    if (method === "GET" && OPERATION.test(name) && grants.operations.has(name)) return true;
    if (!KEY_NAME.test(grants.key ?? "")) return false;
    return (
      (method === "GET" && (name === grants.key || name === `${grants.key}/keyString`)) ||
      (method === "DELETE" && name === grants.key)
    );
  };
}

const OPERATION = /^operations\/[A-Za-z0-9._-]+$/;
const KEY_NAME = /^projects\/[0-9]+\/locations\/global\/keys\/[A-Za-z0-9-]+$/;

/** The admin allow list of an invocation: A2's own for `--a2-of`, the pass's otherwise. */
export function allowFor(args, grants) {
  return args["a2-of"] ? a2Allow(PROJECT) : productionAllow(PROJECT, grants);
}

/** A2's own allow list: its two read-only forms and nothing else (ruling 16 item 7). */
export function a2Allow(project) {
  const u = adminUrls(project);
  const exact = new Set([`GET ${u.client}`, `GET ${u.keysListDeleted}`]);
  return (url, method, { signed } = {}) =>
    !signed &&
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    exact.has(`${method} ${url.href}`);
}

/**
 * A2: the client template and the key list with deleted keys; never throws. Its answer names the
 * run it reads back (`runId`, `a2Of`), and is at baseline only when the template has the baseline's
 * one shape and the key list is a complete object holding no live key of the pass (ruling 18 item 6).
 */
export async function readBack(transport, urls, { runId = null, a2Of = null } = {}) {
  const out = { runId, a2Of, atBaseline: false, errors: [] };
  try {
    const client = await transport.send("a2-client", urls.client);
    out.clientEmpty = client.status === 200 && baselineEmpty(client.json);
    // The second read goes out only after a 200 to the first (ruling 19 item 1).
    if (client.status !== 200) {
      out.errors.push(`a2-client: ${client.status}`);
      out.requests = transport.count;
      return out;
    }
    const keys = await transport.send("a2-keys", urls.keysListDeleted);
    const list = keys.json;
    // A complete list: 200, an object with no error member and no further page (ruling 16 item 3).
    out.keyListComplete =
      keys.status === 200 &&
      list !== null &&
      typeof list === "object" &&
      !Array.isArray(list) &&
      !("error" in list) &&
      !("nextPageToken" in list) &&
      (list.keys === undefined ||
        // Every entry a well-formed key object (ruling 19 item 3).
        (Array.isArray(list.keys) &&
          list.keys.every(
            (k) =>
              k !== null &&
              typeof k === "object" &&
              !Array.isArray(k) &&
              typeof k.name === "string" &&
              KEY_NAME.test(k.name) &&
              (k.displayName === undefined || typeof k.displayName === "string") &&
              (k.deleteTime === undefined || isDeleted(k)),
          )));
    const ours = out.keyListComplete
      ? (list.keys ?? []).filter((k) => k?.displayName === KEY_ID)
      : [];
    out.keys = ours.map((k) => ({ deleted: isDeleted(k) }));
    out.atBaseline = out.clientEmpty && out.keyListComplete && ours.every((k) => isDeleted(k));
  } catch (error) {
    out.errors.push(error.message);
  }
  out.requests = transport.count;
  return out;
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** Whether `pid` is a live recorder process (pid and command checked; a reused pid is not). */
export function recorderAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error.code === "EPERM";
  }
  let args = "";
  try {
    args = execFileSync("/bin/ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8" });
  } catch {
    // The pid is alive and its command cannot be read: it may be the recorder.
    return true;
  }
  return args.includes("remote-config-web/record.mjs") || args.includes("launch-b13.sh");
}

/**
 * Whether A2 may read a pass back (ruling 18 item 7): its run.json names the run and the
 * recorder's pid, that process is gone, a completion (result.json) or interruption
 * (interrupted.json) checkpoint of the same run exists, and ten minutes have passed since the
 * newest file. Returns the refusal, or null.
 */
export function a2Refusal(dir, now = Date.now()) {
  const run = readJson(join(dir, "run.json"));
  if (!run || typeof run.runId !== "string" || !Number.isInteger(run.pid))
    return "the pass has no run.json with its runId and pid";
  if (recorderAlive(run.pid)) return "the pass's recorder is still running";
  // The same lock-holder check as the launcher's (ruling 19 item 7): the project lock beside the
  // run directories exists and its launcher is gone.
  const lock = readJson(join(dir, "..", "..", "sandbox-locks", "fireemu-oracle-query.lock"));
  if (!lock) return "the project lock is not held";
  // The lock is this packet's, for this pass (the launcher's own check; ruling 20).
  const pass = Number(/^send-web-([12])$/.exec(basename(dir))?.[1]);
  if (
    lock.packetId !== PACKET_ID ||
    lock.envelopeId !== ENVELOPE_ID ||
    lock.mode !== "live" ||
    lock.pass !== pass
  )
    return "the project lock is not this packet's lock for this pass";
  if (recorderAlive(lock.pid)) return "the pass's launcher is still running";
  const checkpoint = [readJson(join(dir, "result.json")), readJson(join(dir, "interrupted.json"))];
  if (!checkpoint.some((c) => c?.runId === run.runId))
    return "the pass has no completion or interruption checkpoint";
  if (now - lastActivity(dir) < A2_DELAY_MS)
    return `A2 needs ${A2_DELAY_MS / 60_000} minutes after the pass's last activity`;
  return null;
}

const sameArray = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether a pass is closed so that the next may start (ruling 18 item 2). The closed set:
 *  - complete: result.json of the run with complete true, stopped null, no open item, no unknown
 *    answer and no refusal;
 *  - closed by A2: no open item, and an A2 of this run (its run.json and a2.json naming the run and
 *    this directory) at baseline with no error, the template empty and the key list complete;
 *  - accepted: any open item (an interrupted pass counts as `interrupted`), an A2 as above, and an
 *    acceptance record `<dir>-acceptance.json` { runId, open (exactly the pass's items), kind
 *    "owner-acceptance" or "recovery", ledgerLine } whose owner-ledger line names the packet, the
 *    run and the kind.
 * Returns the reason it is not closed, or null.
 */
export function closureRefusal(dir, ownerLedger) {
  const run = readJson(join(dir, "run.json"));
  if (!run || typeof run.runId !== "string") return "pass 1 has no run.json";
  const result = readJson(join(dir, "result.json"));
  const interrupted = readJson(join(dir, "interrupted.json"));
  let open;
  if (result?.runId === run.runId) {
    // A leak check that did not finish is an open item: no closure by the result or by an A2
    // alone (ruling 20).
    const checked = result.leakCheck === "done";
    if (
      checked &&
      result.complete === true &&
      result.stopped === null &&
      sameArray(result.open, []) &&
      sameArray(result.unknown, []) &&
      sameArray(result.refusals, [])
    )
      return null;
    if (!Array.isArray(result.open)) return "pass 1's result has no open list";
    open = checked ? result.open : [...result.open, "leak-check: not done"];
  } else if (interrupted?.runId === run.runId) open = ["interrupted"];
  else return "pass 1 has no result.json of its run";
  const real = realpathSync(dir);
  const a2 = [1, 2].some((k) => {
    const meta = readJson(join(`${dir}-a2-${k}`, "run.json"));
    const back = readJson(join(`${dir}-a2-${k}`, "a2.json"));
    return (
      meta?.runId === run.runId &&
      meta?.a2Of === real &&
      back?.runId === run.runId &&
      back?.a2Of === real &&
      back.atBaseline === true &&
      back.clientEmpty === true &&
      back.keyListComplete === true &&
      sameArray(back.errors, [])
    );
  });
  if (!a2) return "pass 1 is not closed (no A2 of its run at baseline)";
  if (open.length === 0) return null;
  const record = readJson(`${dir}-acceptance.json`);
  if (
    !record ||
    record.runId !== run.runId ||
    !sameArray(record.open, open) ||
    !["owner-acceptance", "recovery"].includes(record.kind) ||
    !Number.isInteger(record.ledgerLine) ||
    record.ledgerLine < 1
  )
    return "pass 1 has open items and no acceptance or recovery record of them";
  let line = "";
  try {
    line = readFileSync(ownerLedger, "utf8").split("\n")[record.ledgerLine - 1] ?? "";
  } catch {
    line = "";
  }
  const decision = record.kind === "owner-acceptance" ? "accept" : "recovery";
  if (!ownerDecision(line, run.runId, decision))
    return "the acceptance record's owner-ledger line is not the decision line of the packet, the run and the kind";
  return null;
}

export const PACKET_ID = "RC-CLOSURE-B-V1-3";
const ENVELOPE_ID = "RC-CLOSURE-B-20261125-01";

/**
 * The owner's decision line, matched by exact fields (ruling 19 item 4):
 *   - <date> | RC-CLOSURE-B decision | packetId=<PACKET_ID> runId=<runId> decision=<accept|recovery> | <who> | <source>
 * Five ` | `-separated columns; the third holds exactly those three fields in that order and
 * nothing else. It carries no envelopeId, so the launcher's E/V count never sees it.
 */
export function ownerDecision(line, runId, decision) {
  const columns = line.split(" | ");
  return (
    columns.length === 5 &&
    /^- [0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(columns[0]) &&
    columns[1] === "RC-CLOSURE-B decision" &&
    columns[2] === `packetId=${PACKET_ID} runId=${runId} decision=${decision}` &&
    columns[3] === "owner" &&
    columns[4].trim().length > 0 &&
    // Never an envelope's line, so the launcher's E/V count never counts it (ruling 20).
    !line.includes("envelopeId=")
  );
}

/** The variables that would send the browser or its diagnostics elsewhere (ruling 18 item 8). */
export const REFUSED_ENV = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "FIREBASE_TOKEN",
  "NODE_OPTIONS",
  "DEBUG",
  "PWDEBUG",
  "DEBUG_FILE",
  "SELENIUM_REMOTE_URL",
  "SELENIUM_REMOTE_HEADERS",
  "SELENIUM_REMOTE_CAPABILITIES",
  "PLAYWRIGHT_BROWSERS_PATH",
  "PW_CHROMIUM_ATTACH_TO_OTHER",
];

/** The run in progress, for the interruption checkpoint (the CLI's signal handler). */
export const current = { out: null, runId: null };

/**
 * Checks every output file of a run for a secret (ruling 18 item 3): the key's value and anything
 * the pages know (installation ids and tokens). A file that holds one is replaced by its masked
 * copy; the files' names are returned.
 */
export async function leakCheck(out, secrets, browser) {
  const leaked = [];
  for (const name of readdirSync(out)) {
    const file = join(out, name);
    if (!statSync(file).isFile()) continue;
    const text = readFileSync(file, "utf8");
    let masked = text;
    for (const secret of secrets) if (secret) masked = masked.split(secret).join("API_KEY");
    masked = await browser.mask(masked);
    if (masked !== text) {
      writeFileSync(file, masked);
      leaked.push(name);
    }
  }
  return leaked;
}

/**
 * `deps` replaces the token source, the admin fetch, the browser and the timing in tests only
 * (the production write path run offline, ruling 18 item 9); the CLI passes none.
 */
export async function main(argv, env = process.env, deps = {}) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--send-production") args.send = true;
    else if (["--out", "--a2-of", "--closed", "--owner-ledger"].includes(argv[i]))
      args[argv[i].slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  // `--closed <run dir> --owner-ledger <file>`: the launcher's pass-2 gate; reads files only.
  if (args.closed !== undefined) {
    if (!args["owner-ledger"]) throw new Error("--closed needs --owner-ledger");
    const refusal = closureRefusal(resolve(args.closed), resolve(args["owner-ledger"]));
    console.log(refusal ?? "closed");
    return refusal ? 2 : 0;
  }
  if (args.send !== true) throw new Error("production needs --send-production");
  if (!args.out) throw new Error("--out is required");
  for (const name of REFUSED_ENV) if (env[name]) throw new Error(`${name} must not be set`);
  if (Object.keys(env).some((name) => name.startsWith("CLOUDSDK_")))
    throw new Error("CLOUDSDK_* must not be set");
  const number = env.FIREEMU_SANDBOX_PROJECT_NUMBER;
  if (!/^[1-9][0-9]{5,}$/.test(number ?? ""))
    throw new Error("FIREEMU_SANDBOX_PROJECT_NUMBER is required");
  const out = resolve(args.out);
  if (existsSync(out)) throw new Error("--out must not exist");
  // A2 is admitted before anything is created or any token is read (ruling 18 item 7).
  if (args["a2-of"]) {
    const refusal = a2Refusal(resolve(args["a2-of"]), deps.now?.() ?? Date.now());
    if (refusal) throw new Error(refusal);
  }
  mkdirSync(out, { recursive: false, mode: 0o700 });
  let cached = null;
  const token =
    deps.token ??
    (() => {
      if (!cached || Date.now() - cached.at > 30 * 60_000)
        cached = {
          at: Date.now(),
          value: execFileSync("gcloud", ["auth", "application-default", "print-access-token"], {
            encoding: "utf8",
          }).trim(),
        };
      return cached.value;
    });
  const grants = { operations: new Set(), key: null };
  const urls = adminUrls(PROJECT);
  // The key's value, once read, is masked in every body before it is written (ruling 19 item 2).
  const secrets = new Set();
  const redact = (text) => {
    let out = text;
    for (const secret of secrets) if (secret) out = out.split(secret).join("API_KEY");
    return out;
  };
  const transport = new Transport({
    out,
    allow: allowFor(args, grants),
    token,
    maxRequests: args["a2-of"] ? A2_MAX_REQUESTS : MAX_ADMIN_REQUESTS,
    timeoutMs: 30_000,
    userProject: PROJECT,
    redact,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  if (args["a2-of"]) {
    const a2Of = realpathSync(resolve(args["a2-of"]));
    const { runId } = readJson(join(a2Of, "run.json"));
    writeFileSync(join(out, "run.json"), JSON.stringify({ runId, a2Of }) + "\n");
    const back = await readBack(transport, urls, { runId, a2Of });
    writeFileSync(join(out, "a2.json"), JSON.stringify(back, null, 2) + "\n");
    console.log(JSON.stringify(back));
    return back.atBaseline ? 0 : 1;
  }
  const runId = newRunId();
  writeFileSync(
    join(out, "run.json"),
    JSON.stringify({ runId, pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
  );
  Object.assign(current, { out, runId });
  const browser = await (deps.openBrowser ?? openBrowser)({
    port: deps.port ?? 47853,
    cap: MAX_PAGE_REQUESTS,
  });
  let result;
  try {
    result = await observe({
      transport,
      browser,
      urls,
      project: PROJECT,
      number,
      runId,
      timing: deps.timing ?? PRODUCTION_TIMING,
      production: true,
      secrets,
      grant: (kind, value) => {
        if (kind === "operation") grants.operations.add(value);
        if (kind === "key") grants.key = value;
      },
    });
    const complete = result.complete;
    result.complete = false;
    result.leakCheck = "pending";
    // Keep a credential-free interruption checkpoint even if a page cannot finish masking.
    const resultFile = join(out, "result.json");
    writeFileSync(
      resultFile,
      JSON.stringify({ runId, complete: false, leakCheck: "pending" }) + "\n",
    );
    const leaked = new Set();
    const persist = async (name, value) => {
      const text = JSON.stringify(value, null, 2) + "\n";
      const masked = await browser.mask(redact(text));
      if (text !== masked) leaked.add(name);
      writeFileSync(join(out, name), masked);
      return masked;
    };
    for (const [name, client] of Object.entries(result.clients)) {
      await persist(`wire-${name}.json`, client.wire ?? []);
      delete client.wire;
    }
    // Always derive the final file and summary from the already-masked representation.
    result = JSON.parse(await persist("result.json", result));
    for (const name of await leakCheck(out, secrets, browser)) leaked.add(name);
    for (const name of leaked) result.open.push(`leak: ${name} held a secret (masked copy kept)`);
    result.complete = complete && leaked.size === 0;
    result.leakCheck = "done";
    writeFileSync(resultFile, JSON.stringify(result, null, 2) + "\n");
  } finally {
    secrets.clear();
    await browser.close();
  }
  console.log(
    JSON.stringify({
      runId,
      complete: result.complete,
      stopped: result.stopped,
      open: result.open,
      unknown: result.unknown,
      adminRequests: result.adminRequests,
      pageRequests: result.pageRequests,
    }),
  );
  return result.complete ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // The interruption checkpoint (ruling 18 item 7): a pass ended by a signal says so, so that A2
  // can read it back once the process is gone.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(signal, () => {
      if (current.out && current.runId)
        try {
          writeFileSync(
            join(current.out, "interrupted.json"),
            JSON.stringify({ runId: current.runId, signal, at: new Date().toISOString() }) + "\n",
          );
        } catch {
          // the run directory is gone; nothing to record
        }
      process.exit(130);
    });
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 2;
    },
  );
}
