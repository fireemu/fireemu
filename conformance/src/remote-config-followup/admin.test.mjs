import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PRODUCTION_PROJECT } from "../remote-config-observe/plan.mjs";
import { adminRoutes, observeAdmin } from "./admin.mjs";

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
      if (id === "a-server")
        return options.nonempty ? { ...empty(22), json: { parameters: { other: {} } } } : empty(22);
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
