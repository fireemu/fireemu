import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { PRODUCTION_PROJECT } from "../remote-config-observe/plan.mjs";
import { Transport } from "../remote-config-observe/transport.mjs";
import { adminRoutes } from "./admin.mjs";

export function classifyPermission(row, control = null) {
  const { status, json } = row;
  if (status === 200) {
    if (!confirmed(row)) return "unexpected";
    return control && !isDeepStrictEqual(capture(row), capture(control))
      ? "different-template"
      : "allowed";
  }
  const error = json?.error;
  if (status === 401 && error?.status === "UNAUTHENTICATED") return "unauthenticated";
  if (status !== 403 || error?.status !== "PERMISSION_DENIED") return "unexpected";
  const details = Array.isArray(error.details) ? error.details : [];
  if (details.some(({ reason }) => reason === "USER_PROJECT_DENIED")) return "quota-project-denied";
  if (details.some(({ reason }) => reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
    return "oauth-scope-denied";
  const named = details.some(
    ({ reason, metadata }) =>
      reason === "IAM_PERMISSION_DENIED" && metadata?.permission === "cloudconfig.configs.get",
  );
  const conflicting = details.some(({ reason }) => reason && reason !== "IAM_PERMISSION_DENIED");
  const explicit =
    typeof error.message === "string" &&
    /^Permission ['"]cloudconfig\.configs\.get['"] (?:is )?denied\b/.test(error.message);
  return !conflicting && (named || explicit)
    ? "remote-config-permission-denied"
    : "generic-permission-denied";
}

const names = ["client", "server"];
const confirmed = (row) =>
  row?.status === 200 &&
  row.json &&
  !Object.hasOwn(row.json, "error") &&
  typeof row.etag === "string" &&
  row.etag !== "" &&
  row.etag !== "*" &&
  typeof row.json?.version?.versionNumber === "string" &&
  /^[1-9][0-9]*$/.test(row.json.version.versionNumber);
const capture = ({ etag, json }) => ({ etag, json });

export async function observePermission(send) {
  const controls = {};
  const probes = {};
  for (const name of names) {
    const before = await send("a-" + name, "owner", name);
    if (!confirmed(before)) throw new Error("owner control did not return a versioned template");
    controls[name] = capture(before);
  }
  for (const name of names) {
    probes[name] = classifyPermission(await send("p-" + name, "alternate", name), controls[name]);
    if (probes[name] === "unexpected")
      throw new Error("alternate read did not return a typed verdict");
  }
  for (const name of names) {
    const after = await send("g-" + name, "owner", name);
    if (!confirmed(after) || !isDeepStrictEqual(capture(after), controls[name]))
      throw new Error("versioned template readback diverged");
  }
  return { complete: true, sandboxAtBaseline: true, probes, open: [] };
}

async function launch([out, runId, ack]) {
  if (
    !out ||
    !ack ||
    !/^[0-9a-f]{16}$/.test(runId ?? "") ||
    process.env.FIREEMU_RC_FOLLOWUP_ADMISSION !== runId
  )
    throw new Error("requires a frozen coordinated invocation");
  const input = JSON.parse(readFileSync(0, "utf8"));
  const [owner, alternate] = input;
  if (
    input.length !== 2 ||
    [owner, alternate].some((v) => typeof v !== "string" || !/^[A-Za-z0-9_.-]{20,8192}$/.test(v)) ||
    owner === alternate
  )
    throw new Error("requires two independently verified tokens");
  mkdirSync(out, { mode: 0o700 });
  const write = (path, data) =>
    writeFileSync(join(out, path), JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  write("run.json", { runId, pid: process.pid });
  let ready = false;
  for (let i = 0; i < 100; i += 1) {
    try {
      ready = readFileSync(ack, "utf8") === runId + "\n";
      if (!ready) throw new Error("wrong acknowledgement");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await sleep(100);
  }
  if (!ready) throw new Error("no parent acknowledgement");
  const routes = adminRoutes("https://firebaseremoteconfig.googleapis.com/v1/", PRODUCTION_PROJECT);
  const projectNumber = process.env.FIREEMU_SANDBOX_PROJECT_NUMBER;
  if (!/^[1-9][0-9]{9,12}$/.test(projectNumber ?? ""))
    throw new Error("expected sandbox project number");
  const tokens = { owner, alternate };
  let principal = "owner";
  const transport = new Transport({
    out,
    allow: (url, method) => method === "GET" && [routes.client, routes.server].includes(url.href),
    token: () => tokens[principal],
    maxRequests: 6,
    timeoutMs: 15_000,
    userProject: PRODUCTION_PROJECT,
    redact: (text) =>
      text
        .replaceAll(owner, "TOKEN")
        .replaceAll(alternate, "TOKEN")
        .replaceAll(projectNumber, "PROJECT_NUMBER")
        .replace(/AIza[A-Za-z0-9_-]{35}|ya29\.[\w-]+/g, "CREDENTIAL"),
  });
  let result;
  try {
    result = await observePermission((caseId, as, name) => {
      principal = as;
      return transport.send(caseId, routes[name]);
    });
  } catch (err) {
    result = { complete: false, sandboxAtBaseline: false, open: [err.message] };
  }
  write("result.json", { ...result, runId, requests: transport.count, unknown: transport.unknown });
  return result.complete ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  process.exitCode = await launch(process.argv.slice(2));
}
