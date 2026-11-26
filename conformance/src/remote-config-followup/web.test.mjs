import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { requestPolicy } from "../remote-config-web/driver.mjs";
import { advancedVersion, preciseTag } from "../remote-config-web/program.mjs";
import { verifiedReconnect, streamWindow, probePreflights } from "./web.mjs";

const first = {
  n: 1,
  status: 200,
  at: 1,
  answeredAt: 2,
  disconnectedAt: 5,
  finishedAt: 6,
  ended: "error:AbortError",
};
const second = { n: 3, status: null, at: 8, requestBody: '{"lastKnownVersionNumber":"24"}' };

test("confirm a distinct SDK HTTP stream after an established scoped abort", () => {
  assert.equal(verifiedReconnect(first, second, { version: "24" }), true);
  assert.equal(verifiedReconnect(first, { ...second, n: 1 }, { version: "24" }), false);
  assert.equal(verifiedReconnect(first, { ...second, at: 4 }, { version: "24" }), false);
  assert.equal(
    verifiedReconnect({ ...first, ended: "error:TypeError" }, second, { version: "24" }),
    false,
  );
  assert.equal(
    verifiedReconnect(first, { ...second, requestBody: "{}" }, { version: "24" }),
    false,
  );
});

test("distinguish a censored measurement from a provider EOF", () => {
  assert.deepEqual(streamWindow({ at: 10, answeredAt: 15 }, 80), {
    preHeadersMs: 5,
    preHeadersCensored: false,
    postHeadersMs: 65,
    postHeadersCensored: true,
    terminal: null,
  });
  assert.deepEqual(streamWindow({ at: 10, answeredAt: 15, finishedAt: 50, ended: "done" }, 80), {
    preHeadersMs: 5,
    preHeadersCensored: false,
    postHeadersMs: 35,
    postHeadersCensored: false,
    terminal: "done",
  });
  assert.deepEqual(streamWindow({ at: 10 }, 80), {
    preHeadersMs: 70,
    preHeadersCensored: true,
    postHeadersMs: null,
    postHeadersCensored: null,
    terminal: null,
  });
});

test("dispatch every generated reconnect evidence row", (t) => {
  const input = process.env.FIREEMU_RC_WEB_TABLE;
  if (!input) return t.skip("PICT table is staged by the follow-up verification");
  for (const row of readFileSync(input, "utf8").trim().split(/\r?\n/).slice(1)) {
    const [abort, terminal, next] = row.split("\t");
    const a = {
      ...first,
      disconnectedAt: abort === "exact" ? first.disconnectedAt : undefined,
      ended: { abort: "error:AbortError", none: undefined, other: "error:TypeError" }[terminal],
    };
    const b = {
      ...second,
      n: next === "same" ? first.n : second.n,
      at: next === "early" ? first.disconnectedAt - 1 : second.at,
      requestBody: next === "stale" ? '{"lastKnownVersionNumber":"23"}' : second.requestBody,
    };
    assert.equal(
      verifiedReconnect(a, b, { version: "24" }),
      abort === "exact" && terminal === "abort" && next === "valid",
      row,
    );
  }
});

test("the explicit preflight uses two exact POST counterparts and masks the query key", async () => {
  const requests = [];
  const options = {
    project: "fireemu-oracle-query",
    key: "owned-fixture-key",
    port: 47870,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "http://localhost:47870",
          "access-control-allow-methods": "POST",
          vary: "Origin",
        },
      });
    },
  };
  const verdict = await probePreflights(options);
  assert.deepEqual(
    verdict.map(({ status }) => status),
    [204, 204],
  );
  assert.deepEqual(
    requests.map(({ url }) => url.hostname),
    ["firebaseremoteconfig.googleapis.com", "firebaseremoteconfigrealtime.googleapis.com"],
  );
  assert.ok(
    requests.every(
      ({ url, init }) =>
        url.searchParams.get("key") === options.key &&
        init.method === "OPTIONS" &&
        init.redirect === "manual",
    ),
  );
  assert.ok(!JSON.stringify(verdict).includes(options.key));
  await assert.rejects(probePreflights({ ...options, project: "foreign" }), /destination/);
  await assert.rejects(
    probePreflights({ ...options, fetchImpl: async () => new Response(null, { status: 302 }) }),
    /unexpected status/,
  );
});

test("a follow-up context reserves one Installation creation even before a response", () => {
  const project = "fireemu-oracle-query";
  const request = {
    method: "POST",
    href: `https://firebaseinstallations.googleapis.com/v1/projects/${project}/installations`,
    headers: { "x-goog-api-key": "fixture-key" },
    postData: JSON.stringify({ fid: "cf01234567890123456789" }),
  };
  const ctx = {
    project,
    key: "fixture-key",
    appId: "fixture-app",
    fids: new Set(),
    maxInstallations: 1,
  };
  const create = requestPolicy(request, ctx);
  assert.equal(create.verdict, "create");
  ctx.fids.add(create.fid);
  assert.notEqual(requestPolicy(request, ctx).verdict, "create");
});

test("a forward publication must acknowledge a newer decimal version and a precise ETag", () => {
  const reply = (etag, versionNumber) => ({ etag, json: { version: { versionNumber } } });
  assert.equal(preciseTag("*"), false);
  assert.equal(preciseTag(undefined), false);
  assert.equal(preciseTag("etag-4"), true);
  assert.equal(advancedVersion(reply("etag-4", "4"), "3"), "4");
  assert.equal(advancedVersion(reply("etag-3", "3"), "3"), null);
  assert.equal(advancedVersion(reply("*", "4"), "3"), null);
  assert.equal(advancedVersion(reply("etag-4", "004"), "3"), null);
});
