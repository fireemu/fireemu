import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SETUP, handlers, parseArgs } from "./local.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("parseArgs requires the binary, profile, out and events file, and new paths only", () => {
  const args = [
    "--binary",
    "b",
    "--profile",
    "strict",
    "--out",
    "/nonexistent/out",
    "--events-file",
    "/nonexistent/e",
  ];
  assert.deepEqual(parseArgs(args), {
    binary: "b",
    profile: "strict",
    out: "/nonexistent/out",
    "events-file": "/nonexistent/e",
  });
  assert.throws(() => parseArgs(args.slice(2)), /--binary is required/);
  assert.throws(
    () => parseArgs([...args.slice(0, 3), "production", ...args.slice(4)]),
    /strict or emulator/,
  );
  assert.throws(() => parseArgs([...args, "--send-production", "x"]), /unknown argument/);
  assert.throws(() => parseArgs([...args.slice(0, 5), ROOT, ...args.slice(6)]), /must not exist/);
});

test("handlers copies the committed Remote Config handlers under conformance/.runs", (t) => {
  const dir = handlers();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.ok(dir.startsWith(join(ROOT, "conformance/.runs/remote-config-functions-")));
  assert.equal(
    readFileSync(join(dir, "index.js"), "utf8"),
    readFileSync(
      join(ROOT, "tools/sdk-smoke/functions-project/fixtures/remote-config/index.js"),
      "utf8",
    ),
  );
  assert.ok(existsSync(join(dir, "package.json")));
});

test("the setup publishes keep the two namespaces' new version numbers disjoint", () => {
  assert.equal(SETUP.filter((p) => p === "remoteConfig").length, 10);
  assert.equal(SETUP.filter((p) => p.includes("firebase-server")).length, 20);
});
