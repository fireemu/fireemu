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
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

/** A2: the client template and the key list with deleted keys; never throws. */
export async function readBack(transport, urls) {
  const out = { atBaseline: false, errors: [] };
  try {
    const client = await transport.send("a2-client", urls.client);
    const doc = client.json ?? {};
    out.clientEmpty =
      client.status === 200 &&
      !["parameters", "conditions", "parameterGroups"].some(
        (k) => doc[k] && Object.keys(doc[k]).length,
      );
    const keys = await transport.send("a2-keys", urls.keysListDeleted);
    const ours = (keys.json.keys ?? []).filter((k) => k.displayName === KEY_ID);
    out.keys = ours.map((k) => ({ deleted: typeof k.deleteTime === "string" }));
    // An incomplete list (another page) cannot show that no live key is left (ruling 16 item 3).
    out.keyListComplete = keys.status === 200 && !keys.json.nextPageToken;
    out.atBaseline =
      out.clientEmpty && out.keyListComplete && ours.every((k) => typeof k.deleteTime === "string");
  } catch (error) {
    out.errors.push(error.message);
  }
  out.requests = transport.count;
  return out;
}

export async function main(argv, env = process.env) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--send-production") args.send = true;
    else if (["--out", "--a2-of"].includes(argv[i])) args[argv[i].slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (args.send !== true) throw new Error("production needs --send-production");
  if (!args.out) throw new Error("--out is required");
  for (const name of [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "FIREBASE_TOKEN",
    "NODE_OPTIONS",
    "DEBUG",
    "PWDEBUG",
    "DEBUG_FILE",
  ])
    if (env[name]) throw new Error(`${name} must not be set`);
  if (Object.keys(env).some((name) => name.startsWith("CLOUDSDK_")))
    throw new Error("CLOUDSDK_* must not be set");
  const number = env.FIREEMU_SANDBOX_PROJECT_NUMBER;
  if (!/^[1-9][0-9]{5,}$/.test(number ?? ""))
    throw new Error("FIREEMU_SANDBOX_PROJECT_NUMBER is required");
  const out = resolve(args.out);
  if (existsSync(out)) throw new Error("--out must not exist");
  mkdirSync(out, { recursive: false, mode: 0o700 });
  let cached = null;
  const token = () => {
    if (!cached || Date.now() - cached.at > 30 * 60_000)
      cached = {
        at: Date.now(),
        value: execFileSync("gcloud", ["auth", "application-default", "print-access-token"], {
          encoding: "utf8",
        }).trim(),
      };
    return cached.value;
  };
  const grants = { operations: new Set(), key: null };
  const urls = adminUrls(PROJECT);
  const transport = new Transport({
    out,
    allow: args["a2-of"] ? a2Allow(PROJECT) : productionAllow(PROJECT, grants),
    token,
    maxRequests: args["a2-of"] ? A2_MAX_REQUESTS : MAX_ADMIN_REQUESTS,
    timeoutMs: 30_000,
    userProject: PROJECT,
  });
  if (args["a2-of"]) {
    // A2 reads at least ten minutes after the pass's last activity, whatever ended it: the newest
    // file of its run directory (every request is journaled before it is sent).
    const quiet = Date.now() - lastActivity(resolve(args["a2-of"]));
    if (quiet < A2_DELAY_MS)
      throw new Error(`A2 needs ${A2_DELAY_MS / 60_000} minutes after the pass's last activity`);
    const runId = JSON.parse(readFileSync(join(resolve(args["a2-of"]), "run.json"), "utf8")).runId;
    writeFileSync(
      join(out, "run.json"),
      JSON.stringify({ runId, a2Of: resolve(args["a2-of"]) }) + "\n",
    );
    const back = await readBack(transport, urls);
    writeFileSync(join(out, "a2.json"), JSON.stringify(back, null, 2) + "\n");
    console.log(JSON.stringify(back));
    return back.atBaseline ? 0 : 1;
  }
  const runId = newRunId();
  writeFileSync(
    join(out, "run.json"),
    JSON.stringify({ runId, startedAt: new Date().toISOString() }) + "\n",
  );
  const browser = await openBrowser({ port: 47853, cap: MAX_PAGE_REQUESTS });
  let result;
  try {
    result = await observe({
      transport,
      browser,
      urls,
      project: PROJECT,
      number,
      runId,
      timing: PRODUCTION_TIMING,
      production: true,
      grant: (kind, value) => {
        if (kind === "operation") grants.operations.add(value);
        if (kind === "key") grants.key = value;
      },
    });
  } finally {
    await browser.close();
  }
  for (const [name, client] of Object.entries(result.clients)) {
    writeFileSync(
      join(out, `wire-${name}.json`),
      JSON.stringify(client.wire ?? [], null, 2) + "\n",
    );
    delete client.wire;
  }
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 2;
    },
  );
