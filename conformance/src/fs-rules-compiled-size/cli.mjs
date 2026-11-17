// FS-9 observer entry point: `plan` prints the corpus, `local` loads it into a loopback daemon,
// `record` observes production and refuses to start without the runner's admission.
import { fileURLToPath } from "node:url";

import {
  admissionPlanDigest,
  parseAdmissionEnvironment,
  requireChildProductionAdmission,
} from "../fs-data-write-admission.mjs";
import { recomputeCorpus } from "./corpus.mjs";
import { runLocal } from "./local.mjs";
import { ALLOWED_HOST, SANDBOX_PROJECT, requestCapFor, runObserver } from "./session.mjs";

export const MODE = "rulesize";
const RUN_ID = /^[a-f0-9]{32}$/;

export function planFor(corpus = recomputeCorpus()) {
  return {
    host: ALLOWED_HOST,
    project: SANDBOX_PROJECT,
    requestCap: requestCapFor(corpus.rungs.length),
    corpusSha256: corpus.digest,
    rungs: corpus.rungs.map(({ id, sha256, byteLength, leafCount }) => ({
      id,
      sha256,
      byteLength,
      leafCount,
    })),
  };
}

export const planDigest = (plan) => admissionPlanDigest(plan);

export function planText(corpus = recomputeCorpus()) {
  const plan = planFor(corpus);
  const lines = plan.rungs.map(
    (rung) =>
      `${rung.id.padEnd(18)} leaves=${String(rung.leafCount).padStart(6)} bytes=${String(rung.byteLength).padStart(7)} ${rung.sha256.slice(0, 12)}`,
  );
  return [
    ...lines,
    `request cap: ${plan.requestCap}`,
    `corpus sha256: ${plan.corpusSha256}`,
    `planSha256: ${planDigest(plan)}`,
  ].join("\n");
}

/** Refuses unless every gate holds; only then does it read the token and send anything. */
export async function recordCommand({
  env,
  fetchImpl = fetch,
  verify,
  corpus = recomputeCorpus(),
}) {
  const admission = parseAdmissionEnvironment(env);
  if (admission === null) {
    throw new Error(
      "record requires the runner's production admission (FIRESTORE_PROBE_ADMISSION)",
    );
  }
  if (admission.mode !== MODE) throw new Error(`record requires admission mode ${MODE}`);
  const runId = env.FIREEMU_RULESIZE_RUN_ID;
  if (!RUN_ID.test(runId ?? ""))
    throw new Error("record requires a 32-hex FIREEMU_RULESIZE_RUN_ID");
  requireChildProductionAdmission({
    production: true,
    env,
    runId,
    ...(verify ? { verify } : {}),
  });
  const token = env.FIREEMU_RULESIZE_TOKEN;
  if (typeof token !== "string" || token === "") {
    throw new Error("record requires FIREEMU_RULESIZE_TOKEN");
  }
  const plan = planFor(corpus);
  const outcome = await runObserver({
    fetchImpl,
    token,
    project: SANDBOX_PROJECT,
    rungs: corpus.rungs,
  });
  const text = JSON.stringify({ planSha256: planDigest(plan), runId, ...outcome }, null, 2);
  if (text.includes(token)) throw new Error("refusing to print a record that contains the token");
  return { outcome, text };
}

export async function main(argv, env = process.env, write = (text) => process.stdout.write(text)) {
  const [command, ...rest] = argv;
  if (command === "plan") {
    write(`${planText()}\n`);
    return 0;
  }
  if (command === "local") {
    const controlUrl = rest[0] ?? env.FIREEMU_CONTROL_URL;
    if (!controlUrl)
      throw new Error("local requires a control URL argument or FIREEMU_CONTROL_URL");
    const { rungs } = recomputeCorpus();
    const result = await runLocal({
      fetchImpl: fetch,
      controlUrl,
      token: env.FIREEMU_CONTROL_TOKEN,
      rungs,
    });
    write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (command === "record") {
    const { outcome, text } = await recordCommand({ env });
    write(`${text}\n`);
    return outcome.exitCode;
  }
  throw new Error("usage: cli.mjs plan | local [control-url] | record");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
    },
  );
}
