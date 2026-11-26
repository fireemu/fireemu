import { spawn } from "node:child_process";
import {
  closeSync,
  openSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

export const NATIVE_BUNDLES = {
  android: "com.fireemu.oracle.rcandroid20261121",
  ios: "com.fireemu.oracle.rcios20261121",
};

const androidSteps =
  "settings defaults signals fetch activate fetch observe activate delete-installation";
const iosStages =
  "initialized beforeFetch customSignals forcedFetch activate afterActivate cachedFetch afterCachedFetch realtimeListening realtimeUpdate realtimeActivate afterRealtimeActivate installationDelete done";
const oneKey = (keys) => Array.isArray(keys) && keys.length === 1 && keys[0] === "native_value";

function values(platform, row, expected, active = true) {
  const android = platform === "android";
  return [
    ["native_value", expected, active ? (android ? 2 : 0) : android ? 0 : 2],
    ["native_tier", active ? "gold" : "", active ? (android ? 2 : 0) : android ? 0 : 2],
    ["unpublished_default", "app default", 1],
    ["missing_value", "", android ? 0 : 2],
  ].every(([key, value, source]) => {
    const actual = android ? row.values?.[key] : row.values?.[key]?.effective;
    return actual?.string === value && actual.source === source;
  });
}

export function verifyNativeReceipt(platform, result) {
  if (platform === "android") {
    const steps = result?.steps;
    if (
      !Array.isArray(steps) ||
      steps.map((step) => step?.op).join(" ") !== androidSteps ||
      steps.some((step) => step.error)
    )
      return false;
    const [, , , first, initial, cached, advice, updated, deletion] = steps;
    return (
      first.lastFetchStatus === -1 &&
      cached.lastFetchStatus === -1 &&
      first.fetchTimeMillis > 0 &&
      first.fetchTimeMillis === cached.fetchTimeMillis &&
      values(platform, first, "", false) &&
      initial.changed === true &&
      values(platform, initial, "before") &&
      values(platform, cached, "before") &&
      values(platform, advice, "before") &&
      oneKey(advice.event?.updatedKeys) &&
      updated.changed === true &&
      values(platform, updated, "after") &&
      deletion.deleted === true
    );
  }
  if (platform !== "ios") return false;
  const events = result?.events;
  if (
    !Array.isArray(events) ||
    events.map((event) => event?.stage).join(" ") !== iosStages ||
    events.some((event) => event.error && Object.keys(event.error).length > 0)
  )
    return false;
  const [, , , first, initial, before, cached, afterCache, , advice, activate, after] = events;
  return (
    first.status === 1 &&
    cached.status === 1 &&
    initial.changed === true &&
    before.lastFetchTime > 0 &&
    before.lastFetchTime === afterCache.lastFetchTime &&
    values(platform, before, "before") &&
    values(platform, afterCache, "before") &&
    oneKey(advice.keys) &&
    activate.changed === true &&
    values(platform, after, "after")
  );
}

function invalidates(body, version) {
  try {
    const input = String(body).trim();
    if (!input.startsWith("[")) return false;
    const frames = JSON.parse(input.endsWith("]") ? input : input + "]");
    if (!Array.isArray(frames) || frames.length !== 1) return false;
    const [frame] = frames;
    return (
      frame &&
      typeof frame === "object" &&
      Object.keys(frame).every((key) =>
        ["latestTemplateVersionNumber", "featureDisabled"].includes(key),
      ) &&
      !frame.featureDisabled &&
      String(frame.latestTemplateVersionNumber) === version
    );
  } catch {
    return false;
  }
}

export function verifyNativeExchange(rows, versions) {
  const requests = rows.filter(({ phase }) => phase === "request");
  if (
    requests.map(({ operation }) => operation).join(" ") !== "create fetch realtime fetch delete" ||
    rows.length !== 2 * requests.length
  )
    return false;
  const [, , realtime, automatic] = requests;
  const answers = requests.map(({ sequence, operation }) =>
    rows.find(
      (row) =>
        row.sequence === sequence &&
        row.operation === operation &&
        row.phase === (operation === "realtime" ? "stream" : "response"),
    ),
  );
  const [created, before, stream, after, deleted] = answers;
  return (
    created?.status === 200 &&
    before?.status === 200 &&
    stream?.status === 200 &&
    after?.status === 200 &&
    [200, 204].includes(deleted?.status) &&
    realtime.body?.lastKnownVersionNumber === versions.initial &&
    stream.termination === "client-disconnect" &&
    invalidates(stream.bodyText, versions.update) &&
    /^ETAG_\d+$/.test(before.etag) &&
    automatic.ifNoneMatch === before.etag &&
    /^ETAG_\d+$/.test(after.etag) &&
    after.etag !== before.etag &&
    before.body?.state === "UPDATE" &&
    before.body.entries?.native_value === "before" &&
    before.body.entries.native_tier === "gold" &&
    after.body?.state === "UPDATE" &&
    after.body.entries?.native_value === "after" &&
    after.body.entries.native_tier === "gold"
  );
}

function checkedFile(spool, basename, value) {
  const target = join(spool, basename);
  const temporary = target + ".tmp";
  writeFileSync(temporary, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
  renameSync(temporary, target);
}

async function until(check, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const result = check();
    if (result !== undefined) return result;
    await pause(300);
  }
  return null;
}

/** Own one fixed test device. Private SDK configuration lives in the spool only until consumed. */
export function nativeDevice({ driver, platform, pass, spool, port }) {
  mkdirSync(spool, { mode: 0o700 });
  const diagnostics = openSync(join(spool, "driver.log"), "wx", 0o600);
  let child;
  try {
    child = spawn(
      join(homedir(), ".local/bin/python3.12"),
      ["-I", "-B", driver, platform, pass, spool, String(port)],
      { stdio: ["ignore", diagnostics, diagnostics] },
    );
  } finally {
    closeSync(diagnostics);
  }
  let exit;
  child.once("exit", (code, signal) => {
    exit = { code, signal };
  });
  child.once("error", () => {
    exit = { code: -1 };
  });
  const readyFile = join(spool, "ready.json");
  const receiptFile = join(spool, "sdk.json");

  async function ready() {
    const readiness = await until(
      () =>
        existsSync(readyFile)
          ? JSON.parse(readFileSync(readyFile, "utf8"))
          : exit
            ? null
            : undefined,
      540_000,
    );
    if (
      readiness?.platform !== platform ||
      readiness.bundle !== NATIVE_BUNDLES[platform] + "." + pass
    )
      throw new Error("native device did not report the pinned application");
  }

  function start(config) {
    if (exit) throw new Error("native device exited before receiving its private configuration");
    checkedFile(spool, "start.json", { platform, ...config });
  }

  async function result() {
    const value = await until(
      () =>
        existsSync(receiptFile)
          ? JSON.parse(readFileSync(receiptFile, "utf8"))
          : exit
            ? null
            : undefined,
      400_000,
    );
    return value;
  }

  async function stopped() {
    if (!exit) await until(() => exit, 25_000);
    if (!exit) {
      child.kill("SIGTERM");
      await until(() => exit, 150_000);
    }
    rmSync(join(spool, "start.json"), { force: true });
    return exit?.code === 0;
  }

  async function cancel() {
    if (!exit) child.kill("SIGTERM");
    await stopped();
  }

  return { ready, start, result, stopped, cancel };
}
