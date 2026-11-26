import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { Transport } from "../remote-config-observe/transport.mjs";
import { API_TARGETS } from "../remote-config-web/program.mjs";
import { adminUrls, productionAllow, PROJECT, REFUSED_ENV } from "../remote-config-web/record.mjs";
import { nativeAppRegistry } from "./apps.mjs";
import { nativeCapture } from "./capture.mjs";
import {
  NATIVE_BUNDLES,
  nativeDevice,
  verifyNativeExchange,
  verifyNativeReceipt,
} from "./device-client.mjs";
import { nativeDestination, nativeDispatch, openNativeListener } from "./endpoint.mjs";
import { nativeKeyControl } from "./key.mjs";
import { runNativePass } from "./program.mjs";
import { nativeRelay } from "./relay.mjs";
import { nativeBudget, nativeSession } from "./session.mjs";
import { nativeTemplateControl } from "./template.mjs";

export const NATIVE_LIMIT = 30;
export const ADMIN_LIMIT = 100;
const PLATFORMS = Object.keys(NATIVE_BUNDLES);
const SECRET =
  /AIza[A-Za-z0-9_-]{35}|ya29\.[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;
const phaseReadinessMs = 165_000;

function json(out, name, value) {
  writeFileSync(join(out, name), JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
}

function scan(out) {
  // Device spools are never used as evidence. Raw runtime files are private and temporary.
  return readdirSync(out, { withFileTypes: true }).every(
    (entry) => !entry.isFile() || !readFileSync(join(out, entry.name), "utf8").match(SECRET),
  );
}

/** The same receiver and owned-device lifecycle used by the offline rehearsal and oracle pass. */
export async function exerciseNative({
  out,
  spool,
  ports,
  pass,
  driver,
  control,
  dispatch,
  budget,
  runId,
}) {
  mkdirSync(out, { mode: 0o700 });
  if (runId) json(out, "run.json", { runId, pass, pid: process.pid });
  mkdirSync(spool, { mode: 0o700 });
  const devices = {};
  const sessions = {};
  const listeners = {};
  const rows = { android: [], ios: [] };
  const versions = {};
  const clients = Object.fromEntries(
    PLATFORMS.map((platform) => [
      platform,
      {
        start(config) {
          return devices[platform].start(config);
        },
        async waiting() {
          const deadline = Date.now() + phaseReadinessMs;
          while (Date.now() < deadline && !budget.stopped()) {
            if (
              rows[platform].some(
                ({ phase, operation }) => phase === "request" && operation === "realtime",
              )
            )
              return true;
            await pause(200);
          }
          return false;
        },
        async result() {
          const receipt = await devices[platform].result();
          const sdk = verifyNativeReceipt(platform, receipt);
          if (sdk) {
            await closeListener(platform);
            json(out, platform + "-sdk.json", receipt);
          }
          return { complete: sdk && verifyNativeExchange(rows[platform], versions) };
        },
        async finish() {
          const stopped = await devices[platform].stopped();
          return { cleanupVerified: stopped && sessions[platform].canClose() };
        },
      },
    ]),
  );
  const stop = () => budget.stop();
  async function closeListener(platform) {
    const listener = listeners[platform];
    delete listeners[platform];
    await listener?.close();
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let result;
  let ran = false;
  try {
    for (const platform of PLATFORMS) {
      const relay = (request) =>
        sessions[platform]?.relay(request) ?? { status: 503, headers: {}, body: [] };
      listeners[platform] = await openNativeListener(relay, ports[platform]);
      devices[platform] = nativeDevice({
        driver,
        platform,
        pass,
        spool: join(spool, platform),
        port: ports[platform],
      });
    }
    const ready = await Promise.allSettled(PLATFORMS.map((platform) => devices[platform].ready()));
    if (ready.some(({ status }) => status !== "fulfilled") || budget.stopped())
      throw new Error("native devices are not ready");
    ran = true;
    result = await runNativePass({
      clients,
      stopped: budget.stopped,
      async prepare() {
        const configs = await control.prepare();
        for (const platform of PLATFORMS) {
          const { apiKey: key, ...identity } = configs[platform];
          const scoped = { ...identity, platform, key };
          const session = nativeSession({ ...scoped, budget });
          sessions[platform] = {
            canClose: session.canClose,
            relay: nativeRelay({
              session,
              capture: nativeCapture(scoped),
              dispatch: (ticket) => dispatch(platform, ticket),
              record(entry) {
                appendFileSync(join(out, platform + "-wire.jsonl"), JSON.stringify(entry) + "\n", {
                  mode: 0o600,
                });
                rows[platform].push(entry);
              },
            }),
          };
        }
        return configs;
      },
      async publish(stage) {
        versions[stage] = await control.publish(stage);
      },
      restore: control.restore,
      cleanup: control.cleanup,
    });
  } catch {
    result = {
      complete: false,
      sandboxAtBaseline: !ran,
      open: [ran ? "native observer interrupted" : "devices failed before preparation"],
      verified: [],
    };
  } finally {
    const closures = await Promise.allSettled(
      PLATFORMS.flatMap((platform) => [closeListener(platform), devices[platform]?.cancel()]),
    );
    if (closures.some(({ status }) => status !== "fulfilled")) {
      result.complete = false;
      result.sandboxAtBaseline = false;
      result.open.push("loopback listener or device teardown failed");
    }
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
  return { ...result, versions, nativeRequests: budget.used(), leakScanClean: scan(out) };
}

export function oracleControl({ number, out, pass, runId, budget, token, fetchImpl }) {
  const grants = { operations: new Set(), key: null };
  const apps = {};
  const armed = new Set();
  const urls = adminUrls(PROJECT);
  const allow = productionAllow(PROJECT, grants);
  const readback = new Set([urls.webApps, urls.keysListDeleted]);
  const transport = new Transport({
    out,
    token,
    fetchImpl,
    maxRequests: ADMIN_LIMIT,
    timeoutMs: 25_000,
    userProject: PROJECT,
    redact: (text) => text.replace(SECRET, "CREDENTIAL"),
    allow(url, method, options) {
      if (readback.has(url.href)) return false;
      return (
        allow(url, method, options) ||
        Object.values(apps).some((app) => app.allow(url, method, options))
      );
    },
  });
  transport.onStatus = (id, status) => {
    if (status < 200 || status >= 300) budget.stop();
  };
  const pausePoll = () => pause(1_200);
  const key = nativeKeyControl({
    transport,
    urls,
    grants,
    number,
    name: "rc-closure-native-" + pass,
    beforeCreate: ensureOpen,
    pause: pausePoll,
    polls: 8,
  });
  const template = nativeTemplateControl({
    transport,
    url: urls.client,
    runId,
    stopped: budget.stopped,
  });
  let templateObserved = false;

  function ensureOpen() {
    if (budget.stopped()) throw new Error("native pass halted");
  }

  return {
    async prepare() {
      await template.baseline();
      templateObserved = true;
      const { status, json: doc } = await transport.send("native-sdk-services", urls.services);
      if (
        status !== 200 ||
        !Array.isArray(doc.services) ||
        doc.services.length !== API_TARGETS.length ||
        !API_TARGETS.every((service) =>
          doc.services.some(
            (row) =>
              row.name === `projects/${number}/services/${service}` && row.state === "ENABLED",
          ),
        )
      )
        throw new Error("native Firebase services baseline not recognized");
      const configs = {};
      ensureOpen();
      for (const platform of PLATFORMS) {
        ensureOpen();
        apps[platform] = nativeAppRegistry({
          project: PROJECT,
          number,
          platform,
          bundle: NATIVE_BUNDLES[platform] + "." + pass,
          name: "rc-closure-native-" + platform + "-" + pass,
          beforeCreate: ensureOpen,
          pause: pausePoll,
          polls: 8,
          send: transport.send.bind(transport),
        });
        await apps[platform].inspect();
      }
      ensureOpen();
      const { value: apiKey, uid } = await key.create();
      for (const platform of PLATFORMS) {
        ensureOpen();
        armed.add(platform);
        const { appId } = await apps[platform].create(uid);
        configs[platform] = { appId, apiKey, projectId: PROJECT, projectNumber: number };
      }
      return configs;
    },
    publish: template.publish,
    async restore() {
      return templateObserved && (await template.restore());
    },
    async cleanup(cleanPlatforms) {
      let clean = true;
      for (const platform of armed) {
        if (!cleanPlatforms.includes(platform)) {
          clean = false;
          continue;
        }
        try {
          await apps[platform].remove();
          apps[platform].assertClosed();
        } catch {
          clean = false;
        }
      }
      return clean && (await key.remove()) && key.closed();
    },
    report: () => ({ adminRequests: transport.count, unknown: transport.unknown }),
  };
}

export async function main(argv, env = process.env) {
  if (argv.length !== 7 || argv[0] !== "--send-production")
    throw new Error("native oracle requires its verified launcher");
  const [, pass, rawOut, rawSpool, rawDriver, androidPort, iosPort] = argv;
  if (
    !["c1", "c2"].includes(pass) ||
    resolve(rawOut) === resolve(rawSpool) ||
    !/^\d{1,5}$/.test(androidPort) ||
    !/^\d{1,5}$/.test(iosPort) ||
    androidPort === iosPort
  )
    throw new Error("invalid native pass arguments");
  for (const name of [
    ...REFUSED_ENV,
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "https_proxy",
    "http_proxy",
    "all_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ]) {
    if (env[name]) throw new Error("unsupported native oracle environment");
  }
  if (Object.keys(env).some((name) => name.startsWith("CLOUDSDK_")))
    throw new Error("unsupported native oracle environment");
  const number = env.FIREEMU_SANDBOX_PROJECT_NUMBER;
  if (!/^[1-9][0-9]{5,17}$/.test(number ?? "")) throw new Error("invalid sandbox project number");
  const out = resolve(rawOut);
  const spool = resolve(rawSpool);
  const runId = randomBytes(8).toString("hex");
  let adc;
  function token() {
    if (!adc)
      adc = execFileSync("gcloud", ["auth", "application-default", "print-access-token"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 20_000,
      }).trim();
    if (!adc) throw new Error("ADC token unavailable");
    return adc;
  }
  const budget = nativeBudget(NATIVE_LIMIT, 4);
  const control = oracleControl({ number, out, pass, runId, budget, token });
  const prepare = control.prepare;
  control.prepare = async () => {
    const admission = JSON.parse(readFileSync(join(spool, "admitted.json"), "utf8"));
    if (
      admission.runId !== runId ||
      admission.pass !== pass ||
      admission.pid !== process.pid ||
      admission.project !== PROJECT
    )
      throw new Error("native sandbox start was not admitted by its launcher");
    const target = new URL("https://oauth2.googleapis.com/tokeninfo");
    target.searchParams.set("access_token", token());
    const identity = await fetch(target, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    const info = identity.ok ? await identity.json() : null;
    if (typeof info?.email !== "string" || !info.email.endsWith("@reckona.co.jp"))
      throw new Error("ADC identity is outside the reviewed sandbox account domain");
    json(out, "auth.json", { adc: 1, domain: "reckona.co.jp" });
    return prepare();
  };
  const forward = nativeDispatch(nativeDestination({ kind: "oracle" }), 75_000);
  const observed = await exerciseNative({
    out,
    runId,
    spool,
    driver: resolve(rawDriver),
    pass,
    ports: { android: Number(androidPort), ios: Number(iosPort) },
    control,
    budget,
    dispatch: (_platform, ticket) => forward(ticket),
  });
  const report = { ...observed, ...control.report(), runId, pass };
  report.complete &&= report.leakScanClean && report.unknown.length === 0;
  report.sandboxAtBaseline &&= report.leakScanClean && report.unknown.length === 0;
  json(out, "result.json", report);
  return report.complete ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch {
    console.error("native oracle launcher failed");
    process.exitCode = 1;
  }
}
