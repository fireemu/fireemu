import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createInvocationLogger } from "./log-context.mjs";

const methodNames = ["log", "info", "debug", "warn", "error"];
const metadata = { functionName: "structured", invocationId: "lean-replay" };

function fields(payload) {
  if (payload === "bad-key") return ['"value\\ud800"', "0"];
  if (payload === "bad-value") return ['"value"', '"\\ud800"'];
  if (payload === "pair") return ['"value"', '"\\ud83d\\ude80"'];
  if (payload === "depth64" || payload === "depth65") {
    const depth = payload === "depth64" ? 62 : 63;
    return ['"value"', "[".repeat(depth) + "0" + "]".repeat(depth)];
  }
  assert.equal(payload, "scalar");
  return ['"value"', "0"];
}

function input(shape, severity, key, value, message) {
  const members = [key + ":" + value];
  if (severity !== "missing") {
    members.push('"severity":' + (severity === "numeric" ? "3" : JSON.stringify(severity)));
  }
  if (message !== "absent") {
    members.push('"message":' + (message === "text" ? '"hello"' : "17"));
  }
  const object = "{" + members.join(",") + "}";
  switch (shape) {
    case "object": return object;
    case "space": return "\t \r\n" + object + "\n ";
    case "array": return "[" + object + "]";
    case "null": return "null";
    case "number": return "12";
    case "malformed": return object.slice(0, -1);
    case "plain": return "ordinary log";
    default: throw new Error("unexpected fixture shape " + shape);
  }
}

test("structured log admission and projection match Lean", () => {
  const fixture = new URL("./tests/fixtures/lean-runner-structured-log.corpus", import.meta.url);
  const [heading, ...rows] = readFileSync(fixture, "utf8").trimEnd().split("\n");
  assert.equal(heading, "# shape|argument-count|severity|payload|message|structured-level");
  assert.equal(rows.length, 3024);
  let last;
  let count = 0;
  const logger = createInvocationLogger((entry) => {
    last = entry;
    count++;
  });
  const target = Object.fromEntries(methodNames.map((method) => [method, () => {}]));
  const restore = logger.install(target);
  try {
    logger.run(metadata, () => {
      for (const row of rows) {
        const [shape, argc, severity, payload, message, level] = row.split("|");
        const [key, value] = fields(payload);
        const text = input(shape, severity, key, value, message);
        const args = argc === "1" ? [text] : [text, "tail"];
        target.warn(...args);
        const expected = level === "-"
          ? { level: "error", message: args.join(" ") }
          : {
              level,
              message: message === "text" ? "hello" : "",
              fields: { value: JSON.parse(value) },
            };
        assert.deepEqual(last, { ...expected, ...metadata, user: true }, row);
      }
    });
  } finally {
    restore();
  }
  assert.equal(count, rows.length);
});
