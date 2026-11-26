import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { SDK_VERSION, deleteApp, initializeApp } from "firebase-admin/app";
import { getRemoteConfig } from "firebase-admin/remote-config";
import { CANDIDATES, PRODUCTION_PROJECT, serverTemplate } from "../remote-config-observe/plan.mjs";
import { Transport } from "../remote-config-observe/transport.mjs";

const PROVIDER = "https://firebaseremoteconfig.googleapis.com/v1/";
const LOCAL_PROJECT = "demo-rc-followup";
const MAX_REQUESTS = 14;
const SUPPORTED = ["numeric_ge", "string_regex", "percent_between", "semver_ge", "and"];
const CASES = [
  { randomizationId: "fireemu-01", fireemu_n: "5", fireemu_s: "ab", fireemu_v: "1.2.3" },
  { randomizationId: "fireemu-02", fireemu_n: "4", fireemu_s: "a", fireemu_v: "1.2.2" },
  { randomizationId: "fireemu-03", fireemu_n: "invalid", fireemu_s: "bc", fireemu_v: "2.0.0" },
  {},
];

export function adminRoutes(base, project) {
  const url = new URL(base);
  const isLocal =
    url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && url.pathname === "/v1/";
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      (url.href === PROVIDER && project === PRODUCTION_PROJECT) ||
      (isLocal && project === LOCAL_PROJECT)
    )
  )
    throw new Error("unexpected Remote Config destination");
  const root = new URL(`projects/${project}/`, url);
  const client = new URL("remoteConfig", root).href;
  const server = new URL("namespaces/firebase-server/remoteConfig", root).href;
  const data = new URL("namespaces/firebase-server/serverRemoteConfig", root).href;
  const defaults = ["JSON", "XML", "PLIST"].map(
    (format) => `${server}:downloadDefaults?format=${format}`,
  );
  const reads = new Set([client, server, data, ...defaults]);
  return {
    client,
    server,
    data,
    defaults,
    allow: (target, method) =>
      (method === "GET" && reads.has(target.href)) || (method === "PUT" && target.href === server),
  };
}

const sha = (value) => createHash("sha256").update(value).digest("hex");
const positiveVersion = (doc) =>
  typeof doc?.version?.versionNumber === "string" &&
  /^[1-9][0-9]*$/.test(doc.version.versionNumber);
const tag = (row) => typeof row?.etag === "string" && row.etag.length > 0 && row.etag !== "*";
const emptyTemplate = (doc) =>
  doc &&
  !Array.isArray(doc) &&
  typeof doc === "object" &&
  Object.keys(doc).length === 1 &&
  Object.hasOwn(doc, "version");
const baseline = (row) =>
  row?.status === 200 && tag(row) && positiveVersion(row.json) && emptyTemplate(row.json);

export async function evaluateAdmin(template, etag) {
  if (SDK_VERSION !== "14.3.0") throw new Error("unexpected Admin SDK version");
  const deny = {
    getAccessToken: async () => {
      throw new Error("network not permitted in evaluation");
    },
  };
  const app = initializeApp(
    { credential: deny, projectId: LOCAL_PROJECT },
    "rc-followup-" + randomBytes(8).toString("hex"),
  );
  try {
    const defaults = { local_limit: 17 };
    const config = getRemoteConfig(app).initServerTemplate({
      template: { ...template, etag },
      defaultConfig: defaults,
    });
    return {
      sdk: SDK_VERSION,
      cases: CASES.map((inputs) => {
        const result = config.evaluate(inputs);
        return {
          text: result.getString("fireemu_obs_top"),
          textSource: result.getValue("fireemu_obs_top").getSource(),
          number: result.getNumber("fireemu_obs_number"),
          json: JSON.parse(result.getString("fireemu_obs_json")),
          localLimit: result.getNumber("local_limit"),
          defaultsSource: result.getValue("local_limit").getSource(),
          missingSource: result.getValue("missing_parameter").getSource(),
        };
      }),
    };
  } finally {
    await deleteApp(app);
  }
}

export async function observeAdmin({ transport, routes, runId, beforeRestore = async () => {} }) {
  if (!/^[a-z0-9]{12,24}$/.test(runId)) throw new Error("invalid run id");
  const description = "fireemu-rc-followup-" + runId;
  const result = { complete: false, sandboxAtBaseline: false, runId, defaults: [], open: [] };
  let client;
  let server;
  let publishAttempted = false;
  try {
    client = await transport.send("a-client", routes.client);
    server = await transport.send("a-server", routes.server);
    if (!baseline(client) || !baseline(server))
      throw new Error("published empty baselines required");
    result.before = {
      client: client.json.version.versionNumber,
      server: server.json.version.versionNumber,
    };
    publishAttempted = true;
    const draft = serverTemplate(
      SUPPORTED.map((name) =>
        CANDIDATES.find((condition) => condition.name === "fireemu_obs_" + name),
      ),
      { description },
    );
    const published = await transport.send("p-server", routes.server, {
      method: "PUT",
      body: draft,
      ifMatch: server.etag,
    });
    if (
      published.status !== 200 ||
      !tag(published) ||
      !positiveVersion(published.json) ||
      BigInt(published.json.version.versionNumber) <= BigInt(server.json.version.versionNumber)
    )
      throw new Error("server publication not confirmed");
    result.published = published.json.version.versionNumber;
    const data = await transport.send("r-data", routes.data);
    if (
      data.status !== 200 ||
      !tag(data) ||
      data.json?.version?.versionNumber !== result.published ||
      !Object.hasOwn(data.json?.parameters ?? {}, "fireemu_obs_top")
    )
      throw new Error("server data plane not at the observed version");
    result.evaluation = await evaluateAdmin(data.json, data.etag);
    for (const [index, url] of routes.defaults.entries()) {
      const answer = await transport.send("r-defaults-" + index, url, {
        textBody: true,
        textErrorStatuses: [400, 404],
      });
      if (![200, 400, 404].includes(answer.status))
        throw new Error("server defaults read did not return an in-scope outcome");
      result.defaults.push({ status: answer.status, sha256: sha(answer.text) });
    }
  } catch {
    result.open.push("forward program incomplete");
  }
  if (publishAttempted) {
    try {
      let current = await transport.send("g-server", routes.server);
      if (current.json?.version?.description === description) {
        if (
          current.status !== 200 ||
          !tag(current) ||
          !positiveVersion(current.json) ||
          BigInt(current.json.version.versionNumber) <= BigInt(server.json.version.versionNumber) ||
          (result.published && current.json.version.versionNumber !== result.published)
        )
          throw new Error("unverified owned template");
        await beforeRestore();
        const restored = await transport.send("g-restore", routes.server, {
          method: "PUT",
          body: {},
          ifMatch: current.etag,
        });
        if (
          !baseline(restored) ||
          BigInt(restored.json.version.versionNumber) <= BigInt(current.json.version.versionNumber)
        )
          throw new Error("restore did not advance the owned version");
        current = await transport.send("g-after", routes.server);
        if (
          !baseline(current) ||
          current.etag !== restored.etag ||
          !isDeepStrictEqual(current.json, restored.json)
        )
          throw new Error("restored server readback differs");
        result.restored = current.json.version.versionNumber;
      } else if (result.published || !baseline(current) || !isDeepStrictEqual(current, server)) {
        throw new Error("server state is neither owned nor baseline");
      }
      const after = await transport.send("g-client", routes.client);
      if (
        !baseline(after) ||
        after.etag !== client.etag ||
        !isDeepStrictEqual(after.json, client.json)
      )
        throw new Error("client baseline changed");
      result.sandboxAtBaseline = true;
    } catch {
      result.open.push("baseline not verified");
    }
  }
  result.requests = transport.count;
  result.unknown = [...transport.unknown];
  result.complete =
    result.sandboxAtBaseline &&
    result.open.length === 0 &&
    result.unknown.length === 0 &&
    result.evaluation !== undefined &&
    result.defaults.length === routes.defaults.length;
  return result;
}

export async function runAdmin({ base, project, production, out, runId, token, redact, ready }) {
  const routes = adminRoutes(base, project);
  if (
    production !== (base === PROVIDER) ||
    typeof token !== "string" ||
    token.length === 0 ||
    (production && typeof ready !== "function")
  )
    throw new Error("invalid production or credential setting");
  mkdirSync(out, { mode: 0o700 });
  const write = (file, value) =>
    writeFileSync(join(out, file), JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  write("run.json", { runId, pid: process.pid });
  await ready?.();
  const transport = new Transport({
    out,
    allow: routes.allow,
    token: () => token,
    maxRequests: MAX_REQUESTS,
    timeoutMs: 20_000,
    userProject: production ? project : undefined,
    redact: (text) =>
      redact ? redact(text.split(token).join("TOKEN")) : text.split(token).join("TOKEN"),
  });
  const result = await observeAdmin({
    transport,
    routes,
    runId,
    beforeRestore: production ? () => sleep(2500) : undefined,
  });
  write("result.json", result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const [mode, out, runId, readyPath] = process.argv.slice(2);
  if (
    process.argv.length !== 6 ||
    !readyPath ||
    mode !== "--send-production" ||
    !out ||
    !/^[a-z0-9]{12,24}$/.test(runId) ||
    process.env.FIREEMU_RC_FOLLOWUP_ADMISSION !== runId ||
    process.env.FIREBASE_TOKEN ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  )
    throw new Error("production requires the reviewed launch context");
  const token = readFileSync(0, "utf8").trim();
  if (!/^[A-Za-z0-9_.-]{20,8192}$/.test(token)) throw new Error("invalid reviewed ADC transfer");
  const number = process.env.FIREEMU_SANDBOX_PROJECT_NUMBER;
  if (!/^[1-9][0-9]{9,12}$/.test(number ?? ""))
    throw new Error("expected the sandbox project number");
  const ready = async () => {
    for (let i = 0; i < 100; i += 1) {
      try {
        if (readFileSync(readyPath, "utf8") !== runId + "\n")
          throw new Error("wrong admission receipt");
        return;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await sleep(100);
    }
    throw new Error("missing admission receipt");
  };
  const result = await runAdmin({
    ready,
    base: PROVIDER,
    project: PRODUCTION_PROJECT,
    production: true,
    out,
    runId,
    token,
    redact: (text) =>
      text
        .replaceAll(PRODUCTION_PROJECT, "PROJECT_ID")
        .replaceAll(number, "PROJECT_NUMBER")
        .replace(
          /AIza[A-Za-z0-9_-]{35}|ya29\.[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
          "CREDENTIAL",
        ),
  });
  process.exitCode = result.complete ? 0 : 1;
}
