// The REST request layer of the shared FS-QUERY-INDEX recorder (fs-query-index/session.mjs): a
// failure while the response body is read is a transport failure of that step, like a failure of
// the fetch, and a recorded program goes on with its next step.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createContext, isTransient } from "./fs-query-index/harness.mjs";
import { createSession } from "./fs-query-index/session.mjs";
import { isUnknownRow } from "./fs-query-index/unknown-rows.mjs";

const ctx = createContext({
  run: "1",
  startedMs: Date.UTC(2026, 10, 23),
  target: { kind: "local", origin: "http://127.0.0.1:9999", grpcHost: "127.0.0.1", grpcPort: 9999 },
});

const jsonResponse = (body) => new Response(JSON.stringify(body), { status: 200 });
/** A response whose status line arrived and whose body then fails with `error`. */
const brokenBody = (error, status = 200) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.error(error);
      },
    }),
    { status },
  );

/** Runs `program` against a fake fetch that answers each recorded request from `answers`. */
async function record(program, answers) {
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push(`${init.method} ${new URL(url).pathname}`);
    if (init.method === "DELETE") return new Response(null, { status: 200 });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const lines = [];
  const session = createSession(ctx, { log: (line) => lines.push(line) });
  try {
    return { ...(await session.runProgram(program)), lines, sent };
  } finally {
    globalThis.fetch = original;
    await session.close();
  }
}

const commitStep = { id: "write", rpc: "commit", body: { writes: [] } };
const queryStep = {
  id: "read",
  rpc: "runQuery",
  body: { structuredQuery: { from: [{ collectionId: "c" }] } },
};
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

test("a body read that times out after the status line is a transport failure of that step", async () => {
  const { steps, lines } = await record({ id: "p", steps: [commitStep, queryStep] }, [
    brokenBody(timeout()),
    jsonResponse([]),
  ]);
  assert.deepEqual(steps.write, { status: 0, transportError: "body:TimeoutError" });
  assert.equal(isTransient(steps.write), true);
  // The failure is an unknown answer in the run log, which a write must never settle on.
  assert.equal(lines[0], "p#write 0");
  assert.equal(isUnknownRow(lines[0]), true);
  // The program goes on with its next step and cleans up.
  assert.equal(steps.read.status, 200);
  assert.equal(lines[1], "p#read 200");
});

test("each body read failure code is recorded with the body marker", async () => {
  for (const [error, expected] of [
    [Object.assign(new TypeError("terminated"), { cause: { code: "ECONNRESET" } }), "ECONNRESET"],
    [new TypeError("terminated"), "TypeError"],
    [{}, "error"],
  ]) {
    const { steps } = await record({ id: "p", steps: [commitStep] }, [brokenBody(error)]);
    assert.deepEqual(steps.write, { status: 0, transportError: `body:${expected}` });
  }
});

test("a fetch failure keeps its own transport error, without the body marker", async () => {
  const { steps, lines } = await record({ id: "p", steps: [commitStep] }, [timeout()]);
  assert.deepEqual(steps.write, { status: 0, transportError: "TimeoutError" });
  assert.equal(lines[0], "p#write 0");
});

test("a body that is read is recorded as before", async () => {
  const { steps, raw } = await record({ id: "p", steps: [queryStep] }, [
    jsonResponse([{ readTime: "2026-11-23T00:00:00Z" }]),
  ]);
  assert.equal(steps.read.status, 200);
  assert.equal(raw.read.response.status, 200);
  assert.equal(typeof raw.read.response.text, "string");
});

test("a harness request whose body cannot be read stops the run instead of passing as empty", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    init.method === "DELETE" ? new Response(null, { status: 200 }) : brokenBody(timeout());
  const session = createSession(ctx, {});
  try {
    await assert.rejects(
      session.runProgram({
        id: "p",
        seed: [["c/d", { a: { integerValue: "1" } }]],
        steps: [queryStep],
      }),
      (error) => error.fatal === true && /harness commit: HTTP 0/.test(error.message),
    );
  } finally {
    globalThis.fetch = original;
    await session.close();
  }
});
