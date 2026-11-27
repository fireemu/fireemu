import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Default to Vitest and the UI's shared logic and core API helpers.
const uiRoot = fileURLToPath(new URL("../", import.meta.url));
process.chdir(uiRoot);

const listFiles = (dir, predicate) =>
  readdirSync(dir)
    .filter(predicate)
    .sort()
    .map((name) => `${dir}/${name}`);

const isSource = (name) => /\.(?:ts|tsx)$/.test(name) && !/\.test\.(?:ts|tsx)$/.test(name);
const isTest = (name) => /\.test\.(?:ts|tsx)$/.test(name);

const rawArgs = process.argv.slice(2);
const extraArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
const hasOption = (flag) => extraArgs.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
const hasExplicitScope =
  hasOption("--since") ||
  hasOption("--lines") ||
  extraArgs.some(
    (arg, idx) => !arg.startsWith("-") && (idx === 0 || !extraArgs[idx - 1].startsWith("--")),
  );

const defaultSources = [
  ...listFiles("src/lib", isSource),
  "src/api/client.ts",
  "src/api/firestore.ts",
];
const defaultTests = [
  ...listFiles("src/lib", isTest),
  "src/api/client.test.ts",
  "src/api/client.http.test.ts",
  "src/api/firestore.test.ts",
  "src/api/firestore.http.test.ts",
];

const args = ["analyze", "."];
if (!hasExplicitScope) {
  args.push(...defaultSources);
}
if (!hasOption("--test") && !hasOption("--runner")) {
  for (const testFile of defaultTests) {
    args.push("--test", testFile);
  }
}
if (!hasOption("--copy-exclude")) {
  args.push("--copy-exclude", "dist", "--copy-exclude", "test-results");
}
if (!hasOption("--timeout")) {
  args.push("--timeout", "180");
}
args.push(...extraArgs);

const tmtBin = fileURLToPath(
  new URL("../node_modules/targeted-mutation/bin/tmt.mjs", import.meta.url),
);
const result = spawnSync(process.execPath, [tmtBin, ...args], {
  cwd: uiRoot,
  stdio: "inherit",
});
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
