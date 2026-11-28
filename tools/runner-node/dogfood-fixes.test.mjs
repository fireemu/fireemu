import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRuntimeClock } from "./clock.mjs";

const runnerPath = fileURLToPath(new URL("./index.mjs", import.meta.url));

function spawnRunner(sourceDir, env = {}, extraArgs = []) {
  const child = spawn(process.execPath, [runnerPath, "--source", sourceDir, ...extraArgs], {
    cwd: sourceDir,
    env: {
      PATH: process.env.PATH,
      HOME: sourceDir,
      GCLOUD_PROJECT: "demo-test",
      FIREBASE_CONFIG: '{"projectId":"demo-test"}',
      FIREEMU_RUNNER_SECRET: "fixture-secret",
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let pending = Buffer.alloc(0);
  let stderr = "";
  let exited = null;
  const frames = [];
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      const nl = pending.indexOf(0x0a);
      if (nl < 0) return;
      const len = Number(pending.subarray(0, nl).toString());
      if (!Number.isSafeInteger(len) || len < 1) return;
      if (pending.length < nl + 1 + len) return;
      frames.push(JSON.parse(pending.subarray(nl + 1, nl + 1 + len).toString()));
      pending = pending.subarray(nl + 1 + len);
    }
  });
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });
  async function waitForFrame(predicate, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = frames.find(predicate);
      if (found) return found;
      if (exited) throw new Error(`runner exited early: ${JSON.stringify(exited)} ${stderr}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timed out waiting for runner frame; stderr=${stderr}`);
  }
  async function stop() {
    child.stdin.end();
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
  return { child, frames, waitForFrame, stop };
}

test("v6.x ResetValue without symbol tag is treated as unset across all platformOptions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fireemu-resetvalue-"));
  try {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "resetvalue-fixture", main: "index.cjs", type: "commonjs" }),
    );
    fs.writeFileSync(
      path.join(dir, "index.cjs"),
      `
      class ResetValue {
        toJSON() { return null; }
      }
      const RESET = new ResetValue();
      const fn = async () => {};
      fn.__endpoint = {
        platform: "gcfv2",
        availableMemoryMb: RESET,
        timeoutSeconds: RESET,
        minInstances: RESET,
        maxInstances: RESET,
        concurrency: RESET,
        ingressSettings: RESET,
        serviceAccountEmail: RESET,
        preserveExternalChanges: RESET,
        cpu: RESET,
        vpc: RESET,
        labels: {},
        eventTrigger: {
          eventType: "google.cloud.pubsub.topic.v1.messagePublished",
          eventFilters: { topic: "projects/demo-test/topics/t" },
        },
      };
      exports.v6Default = fn;

      const withExpr = async () => {};
      withExpr.__endpoint = {
        platform: "gcfv2",
        availableMemoryMb: { value: () => 512 },
        timeoutSeconds: { value: () => 30 },
        eventTrigger: {
          eventType: "google.cloud.pubsub.topic.v1.messagePublished",
          eventFilters: { topic: "projects/demo-test/topics/t" },
        },
      };
      exports.withExpr = withExpr;
      `,
    );
    const runner = spawnRunner(dir);
    try {
      const hello = await runner.waitForFrame((f) => f.type === "hello");
      const names = hello.manifest.functions.map((f) => f.name).sort();
      assert.deepEqual(names, ["v6Default", "withExpr"]);
      assert.equal(hello.manifest.ignored.length, 0);
      const v6 = hello.manifest.functions.find((f) => f.name === "v6Default");
      assert.equal(v6.platformOptions, undefined);
      const expr = hello.manifest.functions.find((f) => f.name === "withExpr");
      assert.equal(expr.platformOptions.availableMemoryMb, 512);
      assert.equal(expr.timeoutSeconds, 30);
    } finally {
      await runner.stop();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("blockingAuth logs concise warn for expected HttpsError and full error stack for unexpected throws", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fireemu-blocking-log-"));
  try {
    fs.mkdirSync(path.join(dir, "node_modules", "firebase-functions", "https"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(dir, "node_modules", "firebase-functions", "v2", "https"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(dir, "node_modules", "firebase-functions", "lib", "common", "providers"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(dir, "node_modules", "firebase-functions", "package.json"),
      JSON.stringify({ name: "firebase-functions", version: "6.6.0", main: "index.js", type: "commonjs" }),
    );
    fs.writeFileSync(
      path.join(dir, "node_modules", "firebase-functions", "lib", "common", "providers", "https.js"),
      `
      class HttpsError extends Error {
        constructor(code, message) {
          super(message);
          this.code = code;
          this.httpErrorCode = { canonicalName: "PERMISSION_DENIED", status: 403 };
        }
      }
      exports.HttpsError = HttpsError;
      `,
    );
    fs.writeFileSync(
      path.join(dir, "node_modules", "firebase-functions", "index.js"),
      `exports.https = require("./lib/common/providers/https.js");`,
    );
    fs.writeFileSync(
      path.join(dir, "node_modules", "firebase-functions", "https", "index.js"),
      `module.exports = require("../lib/common/providers/https.js");`,
    );
    fs.writeFileSync(
      path.join(dir, "node_modules", "firebase-functions", "v2", "https", "index.js"),
      `module.exports = require("../../lib/common/providers/https.js");`,
    );
    fs.mkdirSync(path.join(dir, "node_modules", "express"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "node_modules", "express", "package.json"),
      JSON.stringify({ name: "express", version: "4.21.2", main: "index.cjs", type: "commonjs" }),
    );
    fs.writeFileSync(
      path.join(dir, "node_modules", "express", "index.cjs"),
      `
      module.exports = function express() {
        let handler;
        const app = (req, res) => {
          const chunks = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => {
            try { req.body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); }
            catch { res.statusCode = 400; res.end("{}"); return; }
            req.get = (name) => req.headers[name.toLowerCase()];
            const p = req.url.split("?")[0].split("/");
            req.params = { project: p[1], region: p[2], name: p[3] };
            res.status = (code) => { res.statusCode = code; return res; };
            res.json = (body) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); return res; };
            res.send = (body) => { res.end(String(body)); return res; };
            handler(req, res, () => { if (!res.writableEnded) { res.statusCode = 500; res.end("{}"); } });
          });
        };
        app.disable = () => app;
        app.use = () => {};
        app.all = (_route, fn) => { handler = fn; };
        return app;
      };
      for (const name of ["json", "text", "raw", "urlencoded"]) module.exports[name] = () => () => {};
      `,
    );
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "blocking-log-fixture", main: "index.cjs", type: "commonjs" }),
    );
    fs.writeFileSync(
      path.join(dir, "index.cjs"),
      `
      const { HttpsError } = require("firebase-functions/v2/https");
      const beforeCreate = () => {};
      beforeCreate.run = async (event) => {
        if (event.data?.email === "expected@test") {
          throw new HttpsError("permission-denied", "Disposable email blocked");
        }
        throw new Error("boom-unexpected");
      };
      beforeCreate.__endpoint = {
        platform: "gcfv2",
        blockingTrigger: { eventType: "providers/cloud.auth/eventTypes/user.beforeCreate" },
      };
      exports.beforeCreate = beforeCreate;
      `,
    );
    const runner = spawnRunner(dir);
    try {
      const hello = await runner.waitForFrame((f) => f.type === "hello");
      const port = hello.httpPort;
      assert.ok(Number.isInteger(port) && port > 0, `expected port in hello: ${JSON.stringify(hello)}`);
      const post = (email) =>
        new Promise((resolve, reject) => {
          const payload = JSON.stringify({ data: { user: { email }, context: {} } });
          const req = http.request(
            {
              host: "127.0.0.1",
              port,
              path: "/demo-test/us-central1/beforeCreate",
              method: "POST",
              headers: {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
                "x-fireemu-runner-secret": "fixture-secret",
              },
            },
            (res) => {
              let body = "";
              res.on("data", (c) => (body += c));
              res.on("end", () => resolve({ status: res.statusCode, body }));
            },
          );
          req.on("error", reject);
          req.end(payload);
        });

      const expectedReply = await post("expected@test");
      assert.equal(expectedReply.status, 403, `body=${expectedReply.body} frames=${JSON.stringify(runner.frames)}`);
      const warnLog = await runner.waitForFrame(
        (f) => f.type === "log" && f.message.includes("Disposable email blocked"),
      );
      assert.equal(warnLog.level, "warn");
      assert.ok(
        !warnLog.message.includes("runner-node/index.mjs"),
        "expected HttpsError should not include runner stack frames",
      );

      const unexpectedReply = await post("unexpected@test");
      assert.equal(unexpectedReply.status, 503);
      const errLog = await runner.waitForFrame(
        (f) => f.type === "log" && f.message.includes("boom-unexpected"),
      );
      assert.equal(errLog.level, "error");
    } finally {
      await runner.stop();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("virtual clock clears native handles safely without throwing", () => {
  const clock = createRuntimeClock({
    date: "virtual",
    timers: "virtual",
    instantNanos: "1700000000000000000",
    following: false,
  });
  const nativeHandle = setTimeout(() => {}, 10_000);
  clock.install();
  try {
    // Clearing a native timer created before install must not throw and should clear it.
    clearTimeout(nativeHandle);
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 10);
    assert.equal(fired, false, "user timers remain virtual while frozen");
  } finally {
    clock.restore();
  }
});
