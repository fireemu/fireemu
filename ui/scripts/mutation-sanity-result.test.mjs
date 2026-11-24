import assert from "node:assert/strict";
import test from "node:test";
import { assessSanity } from "./mutation-sanity-result.mjs";

const baseReport = (mutants, overrides = {}) => ({
  evaluation: "evaluated",
  baseline: { status: "passed", tests: 12 },
  extraction: [{ file: "src/lib/unsaved.tsx", path: "fast" }],
  mutants,
  ...overrides,
});

test("a dry run or empty mutant selection is not mutation evidence", () => {
  assert.equal(assessSanity(baseReport([])).isErr(), true);
});

test("rejects incomplete evaluation, failed baseline, or extraction diagnostic", () => {
  assert.equal(
    assessSanity(baseReport([{ status: "killed" }], { evaluation: "incomplete" })).isErr(),
    true,
  );
  assert.equal(
    assessSanity(baseReport([{ status: "killed" }], { baseline: { status: "failed" } })).isErr(),
    true,
  );
  assert.equal(
    assessSanity(
      baseReport([{ status: "killed" }], {
        extraction: [{ file: "src/lib/unsaved.tsx", path: "diagnostic" }],
      }),
    ).isErr(),
    true,
  );
});

for (const status of [
  "survived",
  "unreached",
  "timeout",
  "error",
  "ignored",
  "unsupported",
  "load_error",
]) {
  test(`rejects ${status} even when another mutant was killed`, () => {
    assert.equal(assessSanity(baseReport([{ status: "killed" }, { status }])).isErr(), true);
  });
}

test("accepts only a nonempty set of killed mutants from an evaluated run", () => {
  const result = assessSanity(baseReport([{ status: "killed" }, { status: "killed" }]));
  assert.equal(result.isOk(), true);
  assert.equal(result.value, 2);
});
