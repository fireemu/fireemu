import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { nativeRelay } from "./relay.mjs";
import { nativeBudget, nativeSession } from "./session.mjs";

const projectId = "demo-native-config";
const projectNumber = "100000000004";
const key = "synthetic-key";
const appId = "synthetic-app";
const fid = "cRc0000000000000000000";
const token = "synthetic-auth-token";
const refreshToken = "synthetic-refresh-token";
const createPath = `/installations/v1/projects/${projectId}/installations`;
const fetchPath = `/fetch/v1/projects/${projectNumber}/namespaces/firebase:fetch`;
const streamPath = `/realtime/v1/projects/${projectNumber}/namespaces/firebase:streamFetchInvalidations`;
const body = (value) => Buffer.from(JSON.stringify(value));
const sdkRequest = (target, wire, extra = {}) => ({
  target,
  wire,
  method: "POST",
  headers: {
    "x-goog-api-key": key,
    "x-goog-firebase-installations-auth": token,
    authorization: "FIS_v2 " + refreshToken,
  },
  ...extra,
});
const createRequest = sdkRequest(createPath, body({ appId, fid }));
const fetchRequest = sdkRequest(
  fetchPath,
  body({ appId, appInstanceId: fid, appInstanceIdToken: token }),
);
const streamRequest = sdkRequest(
  streamPath,
  body({
    appId,
    appInstanceId: fid,
    project: projectNumber,
    namespace: "firebase",
    lastKnownVersionNumber: "1",
  }),
);
const removeRequest = sdkRequest(createPath + "/" + fid, Buffer.alloc(0), { method: "DELETE" });

function setup(dispatch) {
  const session = nativeSession({
    platform: "android",
    projectId,
    projectNumber,
    key,
    appId,
    budget: nativeBudget(8, 1),
  });
  const rows = [];
  const relay = nativeRelay({ session, dispatch, record: (row) => rows.push(row) });
  return { relay, rows, session };
}

const register = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: [body({ fid, authToken: { token }, refreshToken })],
};

test("a compressed SDK request reaches the selected transport with literally the same bytes", async () => {
  const { relay, rows } = setup(({ service, path, wire, headers }) => {
    assert.equal(service, "installations");
    assert.equal(path, createPath.slice("/installations".length));
    assert.strictEqual(wire, compressed);
    assert.equal(headers["content-encoding"], "gzip");
    assert.equal(headers["content-length"], String(compressed.length));
    assert.equal(headers.host, undefined);
    assert.equal(headers["x-hop"], undefined);
    assert.equal(headers["x-goog-api-key"], key);
    return register;
  });
  const compressed = gzipSync(createRequest.wire);
  const result = await relay(
    sdkRequest(createPath, compressed, {
      headers: {
        ...createRequest.headers,
        host: "127.0.0.1:1234",
        connection: "X-Hop",
        "x-hop": "synthetic-hop-secret",
        "content-encoding": "gzip",
      },
    }),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(Buffer.concat(result.body), Buffer.concat(register.body));
  assert.equal(rows[0].operation, "create");
  for (const secret of [key, fid, token, refreshToken, "synthetic-hop-secret"]) {
    assert.ok(!JSON.stringify(rows).includes(secret));
  }
});

test("response redirects are converted to a closed response and do not get to the SDK", async () => {
  const { relay, rows } = setup(() => ({
    status: 307,
    headers: { location: "https://outside.invalid/" },
    body: [body({})],
  }));
  const response = await relay(createRequest);
  assert.equal(response.status, 502);
  assert.equal(response.headers.location, undefined);
  assert.equal(rows.at(-1).status, 307);
});

test("losing a create response cannot make the installation safe to close", async () => {
  let cancelled = false;
  const { relay, session, rows } = setup(() => ({
    status: 200,
    headers: {},
    abort() {
      cancelled = true;
    },
    async *body() {
      yield Buffer.from('{"fid":');
      throw new Error("the connection ended before its response");
    },
  }));
  assert.equal((await relay(createRequest)).status, 502);
  assert.equal(cancelled, true);
  assert.equal(rows.at(-1).phase, "incomplete");
  assert.equal(session.canClose(), false);
  assert.equal((await relay(fetchRequest)).status, 400);
});

test("a 429 stops additional sends when its headers arrive, before reading a slow body", async () => {
  let normalSends = 0;
  let release;
  let started;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const headersSeen = new Promise((resolve) => {
    started = resolve;
  });
  const { relay, session } = setup(({ operation }) => {
    if (operation === "create") return register;
    if (operation === "delete") return { status: 200, headers: {}, body: [] };
    normalSends++;
    return {
      status: 429,
      headers: {},
      async *body() {
        started();
        await waiting;
        yield body({});
      },
    };
  });
  await relay(createRequest);
  const attempt = relay(fetchRequest);
  await headersSeen;
  assert.equal((await relay(fetchRequest)).status, 400);
  assert.equal(normalSends, 1);
  assert.equal((await relay(removeRequest)).status, 200);
  assert.equal(session.canClose(), false);
  release();
  assert.equal((await attempt).status, 429);
  assert.equal(session.canClose(), true);
});

test("stream chunks remain streamed and keep their exact order and bytes", async () => {
  const first = Buffer.from('[{"latestTemplateVersionNumber":');
  const second = Buffer.from("2}\n");
  const { relay, rows } = setup(({ operation }) =>
    operation === "create"
      ? register
      : {
          status: 200,
          headers: { "transfer-encoding": "chunked", "content-type": "application/json" },
          body: [first, second],
        },
  );
  await relay(createRequest);
  const stream = await relay(streamRequest);
  assert.equal(stream.status, 200);
  const chunks = [];
  for await (const chunk of stream.body) chunks.push(chunk);
  assert.strictEqual(chunks[0], first);
  assert.strictEqual(chunks[1], second);
  assert.equal(stream.headers["transfer-encoding"], undefined);
  assert.equal(rows.at(-1).responseBytes, first.length + second.length);
});

test("an empty realtime termination stops new normal sends and still permits deletion", async () => {
  const { relay, rows } = setup(({ operation }) =>
    operation === "create" ? register : { status: 200, headers: {}, body: [] },
  );
  await relay(createRequest);
  const stream = await relay(streamRequest);
  for await (const chunk of stream.body) assert.fail("unexpected stream chunk " + chunk.length);
  assert.equal(rows.at(-1).termination, "upstream-end");
  assert.equal((await relay(fetchRequest)).status, 400);
  assert.equal((await relay(removeRequest)).status, 200);
});
