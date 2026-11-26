import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { API_TARGETS } from "../remote-config-web/program.mjs";
import { exerciseNative, oracleControl } from "./record.mjs";
import { nativeBudget } from "./session.mjs";

test("the run receipt survives a failure before any listener, SDK or oracle control starts", async () => {
  const root = mkdtempSync(join(tmpdir(), "native-receipt-"));
  try {
    const out = join(root, "out");
    const pass = "c1";
    const runId = "0123abcd0123abcd";
    const budget = nativeBudget(30, 4);
    const result = await exerciseNative({
      out,
      spool: join(root, "spool"),
      ports: { android: -1, ios: -1 },
      pass,
      runId,
      budget,
      control: { prepare: () => assert.fail("unarmed run sent work") },
    });
    assert.deepEqual(JSON.parse(readFileSync(join(out, "run.json"), "utf8")), {
      runId,
      pass,
      pid: process.pid,
    });
    assert.equal(result.nativeRequests, 0);
    assert.equal(result.sandboxAtBaseline, true);
    assert.equal(result.complete, false);
    assert.equal(result.leakScanClean, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an Apple registration collision or unreadable baseline receives only GETs", async () => {
  for (const apple of [
    {
      apps: [
        { appId: "1:100000000004:ios:abcdef", bundleId: "com.fireemu.oracle.rcios20261121.c1" },
      ],
    },
    { apps: null },
    { error: { status: "UNAVAILABLE" } },
  ]) {
    const dir = mkdtempSync(join(tmpdir(), "native-prewrite-"));
    const sent = [];
    try {
      const number = "100000000004";
      const control = oracleControl({
        number,
        out: dir,
        pass: "c1",
        runId: "0123abcd0123abcd",
        budget: nativeBudget(30, 4),
        token: () => "synthetic",
        async fetchImpl(url, options) {
          sent.push(options.method);
          const path = url.pathname;
          const data = path.endsWith("/remoteConfig")
            ? { version: { versionNumber: "1" } }
            : path.endsWith("services:batchGet")
              ? {
                  services: API_TARGETS.map((service) => ({
                    name: "projects/" + number + "/services/" + service,
                    state: "ENABLED",
                  })),
                }
              : path.endsWith("/iosApps")
                ? apple
                : {};
          return new Response(JSON.stringify(data), { headers: { etag: "fixture" } });
        },
      });
      await assert.rejects(control.prepare());
      assert.deepEqual(sent, ["GET", "GET", "GET", "GET"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
