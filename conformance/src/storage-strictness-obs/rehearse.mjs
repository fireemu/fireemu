// Pass the same --run-id to run.mjs --local after starting fireemu with this configuration.
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CORS, targetOf } from "./guard.mjs";

export function rehearsalConfig(target) {
  return {
    schemaVersion: 1,
    profile: "strict",
    storage: {
      defaultBucket: "firebasestorage.app",
      buckets: [
        target.defaultBucket,
        ...(target.stage === "v3"
          ? ["absent", "empty", "configured"].map((state) => `${target.tempBucket}-${state}`)
          : [target.tempBucket]),
      ],
      undeclaredBuckets: "refuse",
      cors:
        target.stage === "v4"
          ? {}
          : target.stage === "v3"
            ? { [`${target.tempBucket}-empty`]: [], [`${target.tempBucket}-configured`]: CORS }
            : { [target.tempBucket]: CORS },
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        project: { type: "string" },
        "default-bucket": { type: "string" },
        "run-id": { type: "string" },
      },
    });
    if (positionals.length > 1 || (positionals.length && !["v3", "v4"].includes(positionals[0])))
      throw new Error("invalid stage");
    const target = targetOf({
      stage: positionals[0] ?? "v2",
      project: values.project,
      defaultBucket: values["default-bucket"],
      runId: values["run-id"],
    });
    console.log(JSON.stringify(rehearsalConfig(target), null, 2));
  } catch {
    console.error("Invalid rehearsal arguments");
    process.exitCode = 1;
  }
}
