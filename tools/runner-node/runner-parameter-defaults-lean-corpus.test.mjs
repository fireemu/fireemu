import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveDeclaredParams, resolveWhenDeclared } from "./params.mjs";

function setup(prior, kind, order) {
  const env = Object.create(null);
  if (prior === "existing") env.base = "from-env";
  if (prior === "empty") env.base = "";
  const called = [];
  function definition(name, type, makeDefault) {
    return {
      name,
      constructor: { type },
      get options() {
        called.push(name);
        return { default: makeDefault() };
      },
    };
  }
  const base = definition("base", "string", () => {
    switch (kind) {
      case "text": return "first";
      case "integer": return -9;
      case "boolean": return false;
      case "list": return ["left", "right"];
      case "unsupported": return { value: 1 };
      case "throwing": throw new Error("default expression failed");
      case "absent": return undefined;
      default: throw new Error(`unknown default ${kind}`);
    }
  });
  const dependent = definition("dependent", "string", () => ({
    runtimeValue: () => env.base,
  }));
  const fallback = definition("base", "string", () => "fallback");
  const secret = definition("secret", "secret", () => {
    throw new Error("secret must not be read");
  });
  const invalid = definition("", "string", () => "ignored");
  const body = order === "normal" ? [base, dependent]
    : order === "reversed" ? [dependent, base]
      : [base, fallback, dependent];
  return { env, declared: [invalid, secret, ...body], called };
}

function text(encoded) {
  return encoded === "-" ? undefined : Buffer.from(encoded, "hex").toString("utf8");
}

function entries(encoded) {
  return encoded === "-" ? [] : encoded.split(",").map((name) => ({ name, type: "string" }));
}

test("ordered defaults, existing values and missing parameters agree with Lean", () => {
  const corpus = readFileSync(new URL("./tests/fixtures/lean-runner-parameter-defaults.corpus", import.meta.url), "utf8");
  const [heading, ...rows] = corpus.trimEnd().split("\n");
  assert.equal(heading, "# prior|default|order|base encoded|dependent encoded|missing|defaulted|evaluated");
  assert.equal(rows.length, 63);
  for (const row of rows) {
    const [prior, kind, order, base, dependent, missing, defaulted, evaluated] = row.split("|");
    const expected = [text(base), text(dependent), undefined, undefined];
    const { env, declared, called } = setup(prior, kind, order);
    assert.deepEqual(resolveDeclaredParams(declared, env), {
      missing: entries(missing), defaulted: entries(defaulted),
    }, row);
    assert.deepEqual([env.base, env.dependent, env.secret, env[""]], expected, row);
    const visits = evaluated === "-" ? [] : evaluated.split(",");
    assert.deepEqual(called, visits, row);

    const injected = setup(prior, kind, order);
    const hooked = [];
    assert.equal(resolveWhenDeclared(hooked, injected.env), true, row);
    assert.equal(resolveWhenDeclared(hooked, injected.env), false, row);
    for (const definition of injected.declared) hooked.push(definition);
    assert.equal(hooked.length, injected.declared.length, row);
    assert.deepEqual([injected.env.base, injected.env.dependent, injected.env.secret, injected.env[""]], expected, row);
    assert.deepEqual(injected.called, visits, row);
  }
});
