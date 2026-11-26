import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PRODUCTION_PROJECT } from "../remote-config-observe/plan.mjs";
import { Transport } from "../remote-config-observe/transport.mjs";
import { adminRoutes, observeAdmin, runAdmin } from "./admin.mjs";

const provider = "https://firebaseremoteconfig.googleapis.com/v1/";
const local = "http://127.0.0.1:9250/v1/";
const routes = adminRoutes(provider, PRODUCTION_PROJECT);
const empty = (n) => ({
  status: 200,
  etag: `etag-fixture-${n}`,
  json: { version: { versionNumber: String(n) } },
});
const dataPlane = {
  ...empty(23),
  json: {
    conditions: [],
    parameters: {
      fireemu_obs_top: { defaultValue: { value: "default" } },
      fireemu_obs_number: { defaultValue: { value: "12.5" } },
      fireemu_obs_json: { defaultValue: { value: '{"a":1}' } },
    },
    version: { versionNumber: "23", isLegacy: false },
  },
};

function fake(options = {}) {
  const calls = [];
  let saved;
  let reads = 0;
  const transport = {
    unknown: [],
    get count() {
      return calls.length;
    },
    async send(id, url, opts = {}) {
      calls.push({ id, url, ...opts });
      if (id === "a-client" || id === "g-client")
        return empty(options.clientChange && id === "g-client" ? 67 : 66);
      if (id === "a-server") {
        const clean = empty(22);
        if (options.falseEmpty) clean.json.__futureRemoteConfigField = [];
        return options.nonempty ? { ...clean, json: { parameters: { other: {} } } } : clean;
      }
      if (id === "p-server") {
        saved = opts.body;
        if (options.unknownPublish) {
          this.unknown.push(id);
          throw new Error("unknown publication");
        }
        return empty(23);
      }
      if (id === "r-data") return dataPlane;
      if (id.startsWith("r-defaults"))
        return { status: options.defaultsStatus ?? 200, etag: null, text: "fixture defaults" };
      if (id === "g-server") {
        reads += 1;
        return {
          ...empty(23),
          json: {
            ...saved,
            version: {
              ...saved?.version,
              versionNumber: "23",
              ...(options.foreign && { description: "foreign" }),
            },
          },
        };
      }
      if (id === "g-restore") return options.refusedRestore ? { status: 412 } : empty(24);
      if (id === "g-after") return empty(options.staleRestore ? 22 : 24);
      throw new Error("unplanned case " + id);
    },
  };
  return { transport, calls, restoredReads: () => reads };
}

test("closed administration routes do not permit a client mutation or foreign host", () => {
  assert.equal(routes.allow(new URL(routes.client), "GET"), true);
  assert.equal(routes.allow(new URL(routes.client), "PUT"), false);
  assert.equal(routes.allow(new URL(routes.server), "PUT"), true);
  assert.equal(routes.allow(new URL(routes.server), "POST"), false);
  assert.equal(routes.allow(new URL(routes.server + "?validateOnly=true"), "PUT"), false);
  assert.equal(routes.allow(new URL(routes.data), "GET"), true);
  assert.equal(routes.allow(new URL(routes.defaults[0]), "GET"), true);
  assert.equal(routes.allow(new URL(routes.defaults[0] + "&format=XML"), "GET"), false);
  assert.equal(
    routes.allow(new URL(routes.server.replace("googleapis.com", "example.com")), "GET"),
    false,
  );
  assert.throws(() => adminRoutes(provider, "other-project"), /destination/);
  assert.throws(() => adminRoutes("https://example.com/v1/", PRODUCTION_PROJECT), /destination/);
  const mock = adminRoutes(local, "demo-rc-followup");
  assert.equal(mock.allow(new URL(mock.data), "GET"), true);
});

const run = (transport) => observeAdmin({ transport, routes, runId: "abcdefghijkl" });

test("evaluates the real Admin SDK and restores only the exact owned server version", async () => {
  const fixture = fake();
  const result = await run(fixture.transport);
  assert.equal(result.complete, true);
  assert.equal(result.evaluation.sdk, "14.3.0");
  assert.equal(result.evaluation.cases[0].number, 12.5);
  assert.equal(result.evaluation.cases[0].defaultsSource, "default");
  assert.deepEqual(
    result.defaults.map(({ status }) => status),
    [200, 200, 200],
  );
  assert.deepEqual(
    fixture.calls.filter((call) => call.method === "PUT").map((call) => [call.id, call.ifMatch]),
    [
      ["p-server", "etag-fixture-22"],
      ["g-restore", "etag-fixture-23"],
    ],
  );
  assert.equal(fixture.restoredReads(), 1);
});

test("a foreign, unknown or refused write cannot earn a complete result", async () => {
  for (const options of [
    { nonempty: true },
    { foreign: true },
    { unknownPublish: true },
    { refusedRestore: true },
    { staleRestore: true },
    { clientChange: true },
  ]) {
    const fixture = fake(options);
    const result = await run(fixture.transport);
    assert.equal(result.complete, false, JSON.stringify(options));
    if (options.nonempty) assert.ok(fixture.calls.every((call) => call.method !== "PUT"));
    if (options.foreign) assert.ok(!fixture.calls.some(({ id }) => id === "g-restore"));
    if (options.unknownPublish) {
      assert.ok(fixture.calls.some(({ id }) => id === "g-restore"));
      assert.ok(!fixture.calls.some(({ id }) => id === "r-data"));
    }
  }
});

test("evaluates every generated route-policy table row", (t) => {
  const path = process.env.FIREEMU_RC_ROUTE_TABLE;
  if (!path) return t.skip("PICT table is staged by the follow-up verification");
  const [, ...rows] = readFileSync(path, "utf8").trim().split(/\r?\n/);
  for (const row of rows) {
    const [target, method, route] = row.split("\t");
    const mock = adminRoutes(local, "demo-rc-followup");
    const selected = target === "loopback" ? mock : routes;
    const href = {
      server: selected.server,
      client: selected.client,
      data: selected.data,
      defaults: selected.defaults[0],
      "wrong-query": selected.server + "?validateOnly=true",
      fragment: selected.server + "#fragment",
    }[route];
    const url = new URL(href);
    if (target === "foreign") url.hostname = "example.com";
    const expected =
      target !== "foreign" &&
      ((method === "GET" && ["server", "client", "data", "defaults"].includes(route)) ||
        (method === "PUT" && route === "server"));
    assert.equal(selected.allow(url, method), expected, row);
  }
});

test("stops defaults observation on a permission or quota failure, but restores the owned template", async () => {
  for (const defaultsStatus of [401, 403, 429]) {
    const fixture = fake({ defaultsStatus });
    const result = await run(fixture.transport);
    assert.equal(result.complete, false);
    assert.equal(result.sandboxAtBaseline, true);
    assert.equal(fixture.calls.filter(({ id }) => id.startsWith("r-defaults")).length, 1);
    assert.ok(fixture.calls.some(({ id }) => id === "g-after"));
  }
});

test("refuses the supposedly empty server when its shape carries an unrecognized field", async () => {
  const fixture = fake({ falseEmpty: true });
  const result = await run(fixture.transport);
  assert.equal(result.complete, false);
  assert.deepEqual(
    fixture.calls.map(({ id }) => id),
    ["a-client", "a-server"],
  );
});

test("an unsuccessful admission acknowledgement issues zero production requests", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "rc-followup-entry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const out = join(root, "pre-admission");
  await assert.rejects(
    runAdmin({
      base: provider,
      project: PRODUCTION_PROJECT,
      production: true,
      out,
      runId: "abcdefghijkl",
      token: "synthetic-token",
      ready: async () => {
        throw new Error("closed acknowledgement");
      },
    }),
    /closed acknowledgement/,
  );
  assert.ok(existsSync(join(out, "run.json")));
  assert.equal(existsSync(join(out, "journal.jsonl")), false);
});

test("only explicitly approved defaults errors may persist a non-JSON body as an answer", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "rc-followup-defaults-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const make = (status) =>
    new Transport({
      out: root,
      allow: routes.allow,
      token: () => "mock",
      maxRequests: 3,
      timeoutMs: 500,
      fetchImpl: async () => new Response("<html>unavailable</html>", { status }),
    });
  const body = await make(404).send("approved", routes.defaults[0], {
    textBody: true,
    textErrorStatuses: [400, 404],
  });
  assert.equal(body.status, 404);
  assert.equal(body.text, "<html>unavailable</html>");
  await assert.rejects(
    make(404).send("usual", routes.defaults[0], { textBody: true }),
    /unreadable body/,
  );
  await assert.rejects(
    make(503).send("provider-error", routes.defaults[0], {
      textBody: true,
      textErrorStatuses: [400, 404],
    }),
    /status 503/,
  );
});
