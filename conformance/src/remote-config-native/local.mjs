import { realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Transport } from "../remote-config-observe/transport.mjs";
import { nativeDestination, nativeDispatch } from "./endpoint.mjs";
import { nativeFixture } from "./fixture.mjs";
import { exerciseNative, NATIVE_LIMIT } from "./record.mjs";
import { nativeBudget } from "./session.mjs";
import { nativeTemplateControl } from "./template.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const LOCAL_PROJECT = "demo-rc-native";
const NUMBER = "100000000004";
const KEY = "A00000000000000000000000000000000000000";
const PLATFORMS = ["android", "ios"];

function fixtureReply(upstream, { service, path, method, wire, headers }) {
  const response = upstream.receive({
    target: "/" + service + path,
    method,
    wire,
    apiKey: headers["x-goog-api-key"],
    encoding: headers["content-encoding"],
  });
  return {
    status: response.status,
    headers: { "content-type": "application/json" },
    body: [Buffer.from(JSON.stringify(response.body))],
  };
}

/** Run both real native clients against the configured Fireemu profile. Only FIS is a fixture. */
export async function runLocal({ binary, profile, out, spool, driver, ports, pass }) {
  if (!["strict", "emulator"].includes(profile) || !["c1", "c2"].includes(pass))
    throw new Error("invalid local native profile or pass");
  const { withTestWorld } = await import(pathToFileURL(join(ROOT, "npm/fireemu/testing.mjs")).href);
  return withTestWorld(
    {
      projectId: LOCAL_PROJECT,
      services: ["auth"],
      binaryPath: resolve(binary),
      config: {
        schemaVersion: 1,
        profile,
        daemon: { authProjectNumbers: { [LOCAL_PROJECT]: NUMBER } },
      },
      env: { ...process.env, NODE_PATH: "" },
    },
    async (world) => {
      const base = world.endpoints.control.apiBaseUrl;
      const token = world.environment.FIREEMU_CONTROL_TOKEN;
      const client = new URL("projects/" + LOCAL_PROJECT + "/remoteConfig", base).href;
      const baseline = await fetch(client, {
        method: "PUT",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
          "if-match": "*",
        },
        body: "{}",
      });
      if (baseline.status !== 200) throw new Error("local Remote Config baseline unavailable");
      const runId = "1234567890" + pass;
      const budget = nativeBudget(NATIVE_LIMIT, 4);
      const transport = new Transport({
        out,
        token: () => token,
        allow(url, method) {
          return (
            (url.href === client && (method === "GET" || method === "PUT")) ||
            (url.href === client + ":rollback" && method === "POST")
          );
        },
        maxRequests: 12,
        timeoutMs: 10_000,
      });
      const template = nativeTemplateControl({
        transport,
        url: client,
        runId,
        stopped: budget.stopped,
      });
      const configs = Object.fromEntries(
        PLATFORMS.map((platform) => [
          platform,
          {
            appId: "1:" + NUMBER + ":" + platform + ":0000000000000000000000",
            apiKey: KEY,
            projectId: LOCAL_PROJECT,
            projectNumber: NUMBER,
          },
        ]),
      );
      const fixtures = Object.fromEntries(
        PLATFORMS.map((platform) => [
          platform,
          nativeFixture({ ...configs[platform], key: KEY, platform }),
        ]),
      );
      const remoteConfig = new URL(base).origin;
      const forward = nativeDispatch(
        nativeDestination({ kind: "local", remoteConfig, installations: remoteConfig }),
        75_000,
      );

      const result = await exerciseNative({
        out,
        spool,
        driver,
        pass,
        ports,
        runId,
        budget,
        dispatch(platform, ticket) {
          return ticket.service === "installations"
            ? fixtureReply(fixtures[platform], ticket)
            : forward(ticket);
        },
        control: {
          async prepare() {
            await template.baseline();
            return configs;
          },
          publish: template.publish,
          restore: template.restore,
          cleanup: async (clean) =>
            clean.length === PLATFORMS.length &&
            PLATFORMS.every((platform) => fixtures[platform].summary().installations === 0),
        },
      });
      const report = { ...result, profile, pass, runId };
      writeFileSync(join(out, "result.json"), JSON.stringify(report, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      return report;
    },
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [binary, profile, out, spool, driver, pass, android, ios] = process.argv.slice(2);
  const result = await runLocal({
    binary,
    profile,
    out,
    spool,
    driver,
    pass,
    ports: {
      android: Number(android),
      ios: Number(ios),
    },
  });
  console.log(JSON.stringify(result));
  process.exitCode = result.complete && result.leakScanClean ? 0 : 1;
}
