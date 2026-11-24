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
// were in production (events carry no namespace). The configured `remoteConfig.updateUser` is the
// sanitised identity, so the masked production values and the local values are the same text.
import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
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

export async function runLocal(args) {
  const { withTestWorld } = await import(pathToFileURL(join(ROOT, "npm/fireemu/testing.mjs")).href);
  const { main } = await import(
    pathToFileURL(join(ROOT, RECORDERS[args.corpus ?? "observe"])).href
  );
  const source = args["functions-source"] ? resolve(args["functions-source"]) : handlers();
  const eventsFile = resolve(args["events-file"]);
  // The functions runtime passes the source's dotenv chain to the handlers, not the daemon environment.
  writeFileSync(join(source, ".env"), `REMOTE_CONFIG_OUTPUT=${eventsFile}\n`);
  return withTestWorld(
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
      for (const path of SETUP) {
        const answer = await fetch(new URL(`projects/${world.projectId}/${path}`, base), {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "if-match": "*",
          },
          body: "{}",
        });
        if (answer.status !== 200)
          throw new Error(`setup ${path}: ${answer.status} ${await answer.text()}`);
      }
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runLocal(parseArgs(process.argv.slice(2)));
}
