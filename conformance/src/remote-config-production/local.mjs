// Runs the Remote Config observation recorder (src/remote-config-observe/record.mjs) against a local
// fireemu Test World, so its run directory can be sanitised and compared with a production run.
//
//   node src/remote-config-production/local.mjs --binary <fireemu> [--functions-source <dir>]
//     --profile strict|emulator --out <new run dir> --events-file <new jsonl>
//
// Without --functions-source, the v1 and v2 Remote Config handlers of
// tools/sdk-smoke/functions-project/fixtures/remote-config/index.js are copied to a new directory
// under conformance/.runs/, where they resolve conformance's pinned firebase-functions 7.3.2. Before the recorder starts, empty client and server templates are published
// (the production baseline: both namespaces published and empty), ten client and twenty server
// versions, so the version numbers the run creates in the two namespaces stay disjoint, as they
// were in production (events carry no namespace). The configured `remoteConfig.updateUser` is the
// sanitised identity, so the masked production values and the local values are the same text.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PLACEHOLDERS } from "./sanitise.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const SETUP = [
  ...Array(10).fill("remoteConfig"),
  ...Array(20).fill("namespaces/firebase-server/remoteConfig"),
];

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!["binary", "functions-source", "profile", "out", "events-file"].includes(key))
      throw new Error(`unknown argument ${argv[i]}`);
    args[key] = argv[i + 1];
  }
  for (const key of ["binary", "profile", "out", "events-file"])
    if (!args[key]) throw new Error(`--${key} is required`);
  if (!["strict", "emulator"].includes(args.profile))
    throw new Error("--profile is strict or emulator");
  if (existsSync(args.out) || existsSync(args["events-file"]))
    throw new Error("--out and --events-file must not exist");
  return args;
}

/** A new directory under conformance/.runs/ with the committed handlers. */
export function handlers() {
  const runs = join(ROOT, "conformance/.runs");
  mkdirSync(runs, { recursive: true });
  const dir = mkdtempSync(join(runs, "remote-config-functions-"));
  copyFileSync(
    join(ROOT, "tools/sdk-smoke/functions-project/fixtures/remote-config/index.js"),
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
    pathToFileURL(join(ROOT, "conformance/src/remote-config-observe/record.mjs")).href
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
        { ...process.env, FIREEMU_CONTROL_TOKEN: token },
      );
    },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runLocal(parseArgs(process.argv.slice(2)));
}
