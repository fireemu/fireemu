// Guards against a test or a mutation run reaching production through the Batch 3 recorder
// (lane guide section 5, 2026-11-11 and 2026-11-12). The first tests run everywhere. The last
// block runs only under the mutation harness (FS_WRITE_LIMITS_MUTATION=1) and asserts the
// isolation the harness promises before any mutant runs; it must pass, not skip, there.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { requireChildProductionAdmission } from "./fs-data-write-admission.mjs";
import {
  assertNoAmbientProductionToken,
  requireBracketArguments,
} from "./fs-data-write-sandbox-run.mjs";
import { assertNoProxyEnvironment } from "./firestore-probe/webchannel-request-bytes.mjs";

test("a production child refuses to start without the runner's admission", () => {
  assert.throws(
    () => requireChildProductionAdmission({ production: true, env: {}, runId: "a".repeat(32) }),
    /requires the runner's admission/,
  );
  const env = { FIRESTORE_PROBE_ADMISSION: JSON.stringify({ mode: "writelimits" }) };
  assert.throws(
    () => requireChildProductionAdmission({ production: true, env, runId: "nope" }),
    /32-hex run ID/,
  );
  // A local child needs none.
  assert.equal(requireChildProductionAdmission({ production: false, env: {} }), null);
});

test("the admission, once present, must verify against the ledger and the review", () => {
  let verified = 0;
  const env = { FIRESTORE_PROBE_ADMISSION: JSON.stringify({ mode: "writelimits" }) };
  assert.throws(() =>
    requireChildProductionAdmission({
      production: true,
      env,
      runId: "a".repeat(32),
      verify: () => {
        verified += 1;
        throw new Error("admission ledger packet does not match the reviewed pins");
      },
    }),
  );
  assert.equal(verified, 1);
});

test("the parent refuses without every pin, with a duplicate flag, and with an ambient token", () => {
  assert.throws(() => requireBracketArguments([]), /requires --nonce/);
  assert.throws(
    () =>
      requireBracketArguments([
        "--nonce",
        "a",
        "--nonce",
        "b",
        "--review",
        "r",
        "--review-sha256",
        "0",
        "--packet",
        "p",
        "--packet-sha256",
        "0",
      ]),
    /requires --nonce/,
  );
  assert.throws(
    () => assertNoAmbientProductionToken({ FIREEMU_PRODUCTION_TOKEN: "x" }),
    /refuses FIREEMU_PRODUCTION_TOKEN/,
  );
  assert.doesNotThrow(() => assertNoAmbientProductionToken({}));
  assert.throws(() => assertNoProxyEnvironment({ HTTPS_PROXY: "http://127.0.0.1:1" }));
});

test("this process carries no production credential variable", () => {
  for (const key of [
    "FIREEMU_PRODUCTION_TOKEN",
    "FIRESTORE_PROBE_ADMISSION",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "FIREBASE_TOKEN",
  ]) {
    assert.equal(process.env[key], undefined, key);
  }
});

const mutation = process.env.FS_WRITE_LIMITS_MUTATION === "1";

test(
  "under the mutation harness: empty HOME, no credentials, own git root, no network, no docs.local",
  {
    skip: mutation ? false : "runs only under the mutation harness",
  },
  async () => {
    assert.equal(process.env.NEGCACHE_SANDBOX, "1", "the OS-level barrier must be active");
    const home = process.env.HOME;
    assert.ok(
      home.startsWith(os.tmpdir()) || home.startsWith("/private/tmp"),
      "HOME is a temp dir",
    );
    assert.deepEqual(fs.readdirSync(home), [], "HOME is empty");
    for (const key of Object.keys(process.env)) {
      assert.ok(!/^CLOUDSDK_|^GOOGLE_|^FIREBASE_TOKEN$|^FIREEMU_PRODUCTION_TOKEN$/.test(key), key);
    }
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    assert.equal(fs.realpathSync(top), fs.realpathSync(path.resolve(import.meta.dirname, "../..")));
    assert.throws(() =>
      fs.readFileSync(path.join(process.env.NEGCACHE_REAL_DOCS_LOCAL, "runs/sandbox-ledger.jsonl")),
    );
    assert.throws(() =>
      fs.writeFileSync(path.join(process.env.NEGCACHE_REAL_HOME, "fs-write-limits-probe"), "x"),
    );
    await assert.rejects(
      new Promise((resolve, reject) => {
        const socket = net.connect({ host: "1.1.1.1", port: 443, timeout: 3000 });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
        socket.once("timeout", () => reject(new Error("timeout")));
      }),
    );
  },
);
