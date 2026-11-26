// Runs the RC-CLOSURE-B program (program.mjs) against a local fireemu Test World, so its run
// directory can be sanitised and compared with the production passes (coordinator ruling 21).
//
//   node src/remote-config-web/local.mjs --binary <fireemu> --profile strict|emulator --out <new dir>
//
// The admin side writes fireemu's client template through the control capability; the page runs
// the same pinned Web SDK with `FIREBASE_REMOTE_CONFIG_URL_BASE` set to fireemu, so its fetches and
// its realtime stream reach fireemu over loopback. Fireemu has no Installations service: the
// harness answers the SDK's Installations requests in the browser (coordinator ruling 10), with
// the id the SDK generated. The baseline is production's: the client template published and empty
// before the pass.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Transport } from "../remote-config-observe/transport.mjs";
import { openBrowser } from "./driver.mjs";
import { MAX_PAGE_REQUESTS, observe } from "./program.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const LOCAL_PROJECT = "demo-rc-web";
export const LOCAL_NUMBER = "123456789012";
export const LOCAL_APP_ID = `1:${LOCAL_NUMBER}:web:0000000000000000000000`;
export const LOCAL_KEY = "local-api-key";
/** Shorter windows than production's (a local publication reaches the stream within 250 ms). */
export const LOCAL_TIMING = {
  paceMs: 300,
  streamOpenMs: 15_000,
  updateWindowMs: 15_000,
  quietWindowMs: 8000,
  reconnectGapMs: 3000,
  pollMs: 0,
  polls: 1,
};

/** The harness's Installations: create (with the SDK's id), token refresh and delete. */
export function installations() {
  let n = 0;
  return async (request) => {
    const url = new URL(request.url());
    const json = (body) => ({
      status: 200,
      headers: { "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body),
    });
    if (request.method() === "DELETE") return json({});
    if (url.pathname.endsWith("/authTokens:generate"))
      return json({ token: `local-token-${(n += 1)}`, expiresIn: "604800s" });
    const fid = JSON.parse(request.postData()).fid;
    n += 1;
    return json({
      name: `projects/${LOCAL_NUMBER}/installations/${fid}`,
      fid,
      refreshToken: `local-refresh-${n}`,
      authToken: { token: `local-token-${n}`, expiresIn: "604800s" },
    });
  };
}

export async function runLocal({
  binary,
  profile,
  out,
  port = 47901,
  followup = null,
  preflight = null,
}) {
  const { withTestWorld } = await import(pathToFileURL(join(ROOT, "npm/fireemu/testing.mjs")).href);
  return withTestWorld(
    {
      projectId: LOCAL_PROJECT,
      services: ["auth"],
      binaryPath: resolve(binary),
      config: { schemaVersion: 1, profile },
      env: { ...process.env, NODE_PATH: "" },
    },
    async (world) => {
      const base = world.endpoints.control.apiBaseUrl;
      const token = world.environment.FIREEMU_CONTROL_TOKEN;
      const client = new URL(`projects/${LOCAL_PROJECT}/remoteConfig`, base).href;
      // Production's baseline: the client template published and empty.
      const setup = await fetch(client, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "if-match": "*",
        },
        body: "{}",
      });
      if (setup.status !== 200) throw new Error(`setup: ${setup.status} ${await setup.text()}`);
      const dir = resolve(out);
      mkdirSync(dir, { recursive: false, mode: 0o700 });
      const runId = `${Date.now().toString().slice(-12)}loc`;
      writeFileSync(join(dir, "run.json"), JSON.stringify({ runId, pid: process.pid }) + "\n");
      const transport = new Transport({
        out: dir,
        allow: (url) => url.href.startsWith(client),
        token: () => token,
        maxRequests: 60,
        timeoutMs: 30_000,
      });
      const browser = await openBrowser({
        port,
        cap: MAX_PAGE_REQUESTS,
        fake: installations(),
        rcBase: new URL(base).origin,
        followup: followup !== null,
      });
      let result;
      try {
        result = await observe({
          transport,
          browser,
          urls: { client },
          project: LOCAL_PROJECT,
          number: LOCAL_NUMBER,
          appId: LOCAL_APP_ID,
          fakeKey: LOCAL_KEY,
          runId,
          timing: LOCAL_TIMING,
          ...(followup ? { followup } : {}),
          ...(preflight ? { preflight: (config) => preflight(config, base) } : {}),
          production: false,
        });
      } finally {
        await browser.close();
      }
      for (const [name, c] of Object.entries(result.clients)) {
        writeFileSync(join(dir, `wire-${name}.json`), JSON.stringify(c.wire ?? [], null, 2) + "\n");
        delete c.wire;
      }
      writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2) + "\n");
      return result;
    },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  const result = await runLocal(args);
  console.log(
    JSON.stringify({ complete: result.complete, stopped: result.stopped, open: result.open }),
  );
  process.exitCode = result.complete ? 0 : 1;
}
