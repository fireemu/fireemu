// Turns one RC-CLOSURE-B run directory (send-web-<pass>, or a local run of the same program) into a
// committable fixture: the client side of the pass (both contexts' exchanges, SDK results and
// listener updates) and the pass's steps, with the private values replaced.
//
//   node src/remote-config-web/sanitise.mjs <run dir> <new fixture file>
//
// The page already masked the API key (API_KEY), the installation ids (FID_n) and every
// Installations credential (TOKEN_n, REFRESH_n) before anything left it. Replaced here, everywhere
// (strings, keys, paths, headers): the project id -> PROJECT_ID, the project number (read from the
// web app's id `1:<number>:web:<hash>`) -> PROJECT_NUMBER, the web app's hash -> WEB_APP_HASH, the
// run id -> RUN_ID. Times are dropped (the order is kept). `assertSanitised` refuses any output
// that still holds a private value or anything shaped like a key, a token or an installation id.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PLACEHOLDERS = {
  project: "PROJECT_ID",
  number: "PROJECT_NUMBER",
  app: "WEB_APP_HASH",
  run: "RUN_ID",
};

const APP_ID = /^1:([0-9]+):web:([0-9a-f]+)$/;
const PATH = /^\/v1\/projects\/([^/]+)\//;

/** The private values of a run, read from its own records. */
export function secretsOf({ run, result, wires }) {
  const entries = Object.values(wires).flat();
  const projects = new Set(entries.map((e) => PATH.exec(e.path ?? "")?.[1]).filter(Boolean));
  if (projects.size !== 1) throw new Error(`the wire names ${projects.size} projects`);
  const apps = new Set(
    entries
      .map((e) => {
        try {
          return (
            JSON.parse(e.requestBody ?? "null")?.app_id ??
            JSON.parse(e.requestBody ?? "null")?.appId
          );
        } catch {
          return undefined;
        }
      })
      .filter(Boolean),
  );
  if (apps.size !== 1) throw new Error(`the wire names ${apps.size} web apps`);
  const [, number, app] = APP_ID.exec([...apps][0]) ?? [];
  if (!number) throw new Error("the web app id has no project number");
  if (!/^[a-z0-9]{8,24}$/.test(run.runId ?? "") || run.runId !== result.runId)
    throw new Error("run.json and result.json do not name one valid run");
  return { project: [...projects][0], number, app, run: run.runId };
}

/** Replaces the private values inside one string. */
export function maskText(text, secrets) {
  let out = text;
  for (const [name, value] of [
    ["number", secrets.number],
    ["app", secrets.app],
    ["project", secrets.project],
    ["run", secrets.run],
  ])
    if (value) out = out.split(value).join(PLACEHOLDERS[name]);
  return out;
}

export function maskValue(value, secrets) {
  if (Array.isArray(value)) return value.map((item) => maskValue(item, secrets));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        maskText(key, secrets),
        maskValue(item, secrets),
      ]),
    );
  return typeof value === "string" ? maskText(value, secrets) : value;
}

/** One exchange of a context, without its times. */
function exchange(entry) {
  const { at: _at, answeredAt: _answered, chunks, ...rest } = entry;
  return chunks ? { ...rest, chunkLengths: chunks.map((c) => c.length) } : rest;
}

const STEP_FIELDS = ["name", "version", "updated", "opened", "reopened", "first", "again"];

/** The fixture of one run directory. */
export function sanitise(dir) {
  const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
  const result = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
  const wires = Object.fromEntries(
    ["one", "two"].map((name) => [
      name,
      JSON.parse(readFileSync(join(dir, `wire-${name}.json`), "utf8")),
    ]),
  );
  const secrets = secretsOf({ run, result, wires });
  const fixture = {
    schema: "rc-closure-b-fixture/1",
    runId: PLACEHOLDERS.run,
    complete: result.complete,
    stopped: result.stopped,
    open: result.open,
    baseline: {
      before: result.baseline?.before?.version ?? null,
      after: result.baseline?.after?.version ?? null,
    },
    steps: result.steps.map((step) =>
      Object.fromEntries(STEP_FIELDS.filter((f) => f in step).map((f) => [f, step[f]])),
    ),
    clients: Object.fromEntries(
      ["one", "two"].map((name) => [
        name,
        {
          fetches: result.clients?.[name]?.fetches ?? [],
          updates: (result.clients?.[name]?.updates ?? []).map(({ at: _at, ...u }) => u),
          wire: wires[name].map(exchange),
        },
      ]),
    ),
    installations: result.installations ?? [],
  };
  const out = maskValue(fixture, secrets);
  assertSanitised(out, secrets);
  return out;
}

/** Refuses a fixture that still holds a private value, or a key-, token- or id-shaped string. */
export function assertSanitised(fixture, secrets = {}) {
  const text = JSON.stringify(fixture);
  for (const [name, value] of Object.entries(secrets))
    if (value && text.includes(value)) throw new Error(`the fixture still holds the ${name}`);
  for (const [what, pattern] of [
    ["an API key", /AIza[0-9A-Za-z_-]{20,}/],
    ["an installation token", /eyJ[0-9A-Za-z_-]{10,}/],
    ["an Installations credential", /FIS_v2/],
    ["an installation id", /"c[A-Za-z0-9_-]{21}"/],
    ["a refresh token", /"refreshToken":"[^s]/],
    ["a project number", /\b[0-9]{9,}:web:/],
    ["a key query", /[?&]key=(?!API_KEY)/],
  ])
    if (pattern.test(text)) throw new Error(`the fixture holds ${what}`);
  return fixture;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, file] = process.argv.slice(2);
  writeFileSync(file, JSON.stringify(sanitise(dir), null, 2) + "\n", { flag: "wx" });
}
