// Runs the Remote Config observation recorder (src/remote-config-observe/record.mjs) against a local
// fireemu Test World, so its run directory can be sanitised and compared with a production run.
//
//   node src/remote-config-production/local.mjs --binary <fireemu> [--functions-source <dir>]
//     --profile strict|emulator --out <new run dir> --events-file <new jsonl>
//
// Without --functions-source, the raw v1 and v2 Remote Config handlers of functions/index.cjs
// (the same layer as production's functions-framework handlers, no SDK) are copied to a new
// temporary directory outside the repository. Before the recorder starts, empty client and server templates are published
// (the production baseline: both namespaces published and empty), ten client and twenty server
// versions, so the version numbers the run creates in the two namespaces stay disjoint, as they
// were in production (events carry no namespace). The handlers' events of the setup versions are dropped before the recorder starts, as production's handlers were deployed after its baseline, so every delivery in a fixture belongs to the run. The configured `remoteConfig.updateUser` is the
// sanitised identity, so the masked production values and the local values are the same text.
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PLACEHOLDERS } from "./sanitise.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const SETUP = [
  ...Array(10).fill("remoteConfig"),
  ...Array(20).fill("namespaces/firebase-server/remoteConfig"),
];
/**
 * The closure corpus's baseline, as production's (RC-CLOSURE-A passes): each namespace's head is a
 * rollback to an empty version at production's distance (client v32 rolled back to v27, so local
 * v10 rolls back to v5; server v9 to v6, so local v20 to v17), and the handlers' events of these
 * setup versions are dropped before the pass starts (production's handlers were deployed after
 * its baseline was written).
 */
export const CLOSURE_SETUP = [
  ...Array(9).fill(["PUT", "remoteConfig"]),
  ["POST", "remoteConfig:rollback", "5"],
  ...Array(19).fill(["PUT", "namespaces/firebase-server/remoteConfig"]),
  ["POST", "namespaces/firebase-server/remoteConfig:rollback", "17"],
];

/**
 * The recorder of each corpus: RC-OBSERVE-V2-3, or RC-CLOSURE-A, which also reads the template
 * under the project number, so the daemon is given a synthetic one (`daemon.authProjectNumbers`).
 */
export const RECORDERS = {
  observe: "conformance/src/remote-config-observe/record.mjs",
  closure: "conformance/src/remote-config-closure/record.mjs",
};
export const LOCAL_PROJECT_NUMBER = "123456789012";

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!["binary", "functions-source", "profile", "out", "events-file", "corpus"].includes(key))
      throw new Error(`unknown argument ${argv[i]}`);
    args[key] = argv[i + 1];
  }
  for (const key of ["binary", "profile", "out", "events-file"])
    if (!args[key]) throw new Error(`--${key} is required`);
  if (!["strict", "emulator"].includes(args.profile))
    throw new Error("--profile is strict or emulator");
  args.corpus ??= "observe";
  if (!Object.hasOwn(RECORDERS, args.corpus)) throw new Error("--corpus is observe or closure");
  if (existsSync(args.out) || existsSync(args["events-file"]))
    throw new Error("--out and --events-file must not exist");
  return args;
}

/**
 * A new directory with the committed raw handlers, outside the repository: the handlers need no
 * package, and the Test World snapshot copies the node_modules of a source's ancestors, which
 * under conformance/ is the whole SDK installation.
 */
export function handlers() {
  const dir = mkdtempSync(join(tmpdir(), "remote-config-functions-"));
  copyFileSync(
    join(ROOT, "conformance/src/remote-config-production/functions/index.cjs"),
    join(dir, "index.js"),
  );
  writeFileSync(
    join(dir, "package.json"),
    '{"name":"fireemu-remote-config-observe-local","private":true,"main":"index.js"}\n',
  );
  return dir;
}

/** Waits for the `count` setup events (client versions, both generations), then drops them. */
async function dropSetupEvents(file, count) {
  const lines = () =>
    existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0;
  for (let i = 0; i < 300 && lines() < count; i += 1) await new Promise((r) => setTimeout(r, 100));
  if (lines() !== count) throw new Error(`setup: ${lines()} handler events, expected ${count}`);
  writeFileSync(file, "");
}

export async function runLocal(args) {
  const { withTestWorld } = await import(pathToFileURL(join(ROOT, "npm/fireemu/testing.mjs")).href);
  const { main } = await import(
    pathToFileURL(join(ROOT, RECORDERS[args.corpus ?? "observe"])).href
  );
  const own = !args["functions-source"];
  const source = own ? handlers() : resolve(args["functions-source"]);
  const eventsFile = resolve(args["events-file"]);
  // The functions runtime passes the source's dotenv chain to the handlers, not the daemon environment.
  writeFileSync(join(source, ".env"), `REMOTE_CONFIG_OUTPUT=${eventsFile}\n`);
  try {
    return await withTestWorld(
      {
        projectId: "demo-rc-observe",
        services: ["functions"],
        functionsSource: source,
        binaryPath: resolve(args.binary),
        config: {
          schemaVersion: 1,
          profile: args.profile,
          ...(args.corpus === "closure"
            ? { daemon: { authProjectNumbers: { "demo-rc-observe": LOCAL_PROJECT_NUMBER } } }
            : {}),
          remoteConfig: {
            updateUser: {
              email: PLACEHOLDERS.email,
              name: PLACEHOLDERS.name,
              imageUrl: PLACEHOLDERS.image,
            },
          },
        },
        env: { ...process.env, NODE_PATH: "" },
      },
      async (world) => {
        const base = world.endpoints.control.apiBaseUrl;
        const token = world.environment.FIREEMU_CONTROL_TOKEN;
        // The closure corpus's times fall on whole milliseconds ending in zero (.120, .370, ...),
        // so they exercise production's shortened forms: three digits in the REST answers and
        // Gen2 events, the trailing zero dropped in Gen1 events (the judge compares times by the
        // rendering rule both sides satisfy).
        if (args.corpus === "closure") await world.clock.set("2026-01-01T00:00:00.120Z");
        const setup =
          args.corpus === "closure" ? CLOSURE_SETUP : SETUP.map((path) => ["PUT", path]);
        for (const [method, path, target] of setup) {
          const rollback = method === "POST";
          const answer = await fetch(new URL(`projects/${world.projectId}/${path}`, base), {
            method,
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              ...(rollback ? {} : { "if-match": "*" }),
            },
            body: rollback ? JSON.stringify({ versionNumber: target }) : "{}",
          });
          if (answer.status !== 200)
            throw new Error(`setup ${path}: ${answer.status} ${await answer.text()}`);
        }
        // Both corpora's setups publish ten client versions; their events are not the run's.
        await dropSetupEvents(eventsFile, 2 * 10);
        return main(
          [
            "--target",
            "local",
            "--base",
            base,
            "--project",
            world.projectId,
            "--events-file",
            eventsFile,
            "--out",
            resolve(args.out),
          ],
          {
            ...process.env,
            FIREEMU_CONTROL_TOKEN: token,
            ...(args.corpus === "closure"
              ? { FIREEMU_LOCAL_PROJECT_NUMBER: LOCAL_PROJECT_NUMBER }
              : {}),
          },
          // The closure corpus filters history by update time, so the virtual clock moves 1.25 s
          // before each write and the versions get distinct times.
          { tick: () => world.clock.advance(1250) },
        );
      },
    );
  } finally {
    // The handlers' directory this run made, with its .env, is removed whatever the outcome.
    if (own) rmSync(source, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runLocal(parseArgs(process.argv.slice(2)));
}
