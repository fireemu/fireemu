// Pure corpus for the FS-9 observation: the compiled-size limit of a Firestore Security
// Rules ruleset. Production documents a 256 KB UTF-8 source limit and a 250 KB compiled limit.
// The doubling chain below makes the compiled form grow about 2^D while the source stays
// small, so one ladder brackets the compiled limit without approaching the source limit.
// Two padding controls sit exactly on both sides of the source limit.
import { createHash } from "node:crypto";

export const SOURCE_LIMIT_BYTES = 262_144;
/** The production function call depth limit is 20; stay below it with margin. */
export const MAX_CHAIN_DEPTH = 19;
export const CHAIN_DEPTH = 10;
export const MAX_COPIES = 64;
/** Consecutive rungs differ by at least this ratio (integer percent) once K >= 8. */
export const SPACING_PERCENT = 115;

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const HEADER =
  "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n";
const FOOTER = "  }\n}\n";

/** The ruleset body without padding: a tiny valid ruleset that denies everything. */
const MINIMAL_BODY = `${HEADER}    match /fsrcs/{id} {\n      allow read: if false;\n    }\n${FOOTER}`;

/**
 * Doubling chain f0..fD (fD has 2^D leaves) plus a final function fx that ORs K copies of fD,
 * so the leaf count is K * 2^D and the call depth is D + 2.
 */
export function buildExpansionSource(depth, copies) {
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_CHAIN_DEPTH) {
    throw new RangeError(`depth must be an integer in 1..${MAX_CHAIN_DEPTH}`);
  }
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
    throw new RangeError(`copies must be an integer in 1..${MAX_COPIES}`);
  }
  const lines = ["    function f0(x) { return x == 1; }"];
  for (let level = 1; level <= depth; level += 1) {
    lines.push(`    function f${level}(x) { return f${level - 1}(x) || f${level - 1}(x); }`);
  }
  const terms = Array.from({ length: copies }, () => `f${depth}(x)`).join(" || ");
  lines.push(`    function fx(x) { return ${terms}; }`);
  return `${HEADER}${lines.join("\n")}\n    match /fsrcs/{id} {\n      allow read: if fx(1);\n    }\n${FOOTER}`;
}

/** The copy counts: grow by about 1.15x once past 8, then end exactly on MAX_COPIES. */
export function copyLadder() {
  const copies = [1];
  for (;;) {
    const last = copies.at(-1);
    const next = Math.max(last + 1, Math.ceil((last * SPACING_PERCENT) / 100));
    if (next > MAX_COPIES) break;
    copies.push(next);
  }
  // End exactly on MAX_COPIES; a last step under 1.1x folds into it.
  if (copies.at(-1) * 110 > MAX_COPIES * 100) copies.pop();
  copies.push(MAX_COPIES);
  return copies;
}

/** A source of exactly `bytes` UTF-8 bytes: a valid ruleset plus one padding line comment. */
export function buildPaddedSource(bytes) {
  const prefix = `${MINIMAL_BODY}// `;
  const padding = bytes - Buffer.byteLength(prefix) - 1;
  if (padding < 0) throw new RangeError("target size is smaller than the minimal ruleset");
  const source = `${prefix}${"p".repeat(padding)}\n`;
  if (Buffer.byteLength(source) !== bytes) throw new Error("padding arithmetic is wrong");
  return source;
}

const finish = (rung) => ({
  ...rung,
  byteLength: Buffer.byteLength(rung.source, "utf8"),
  sha256: sha256(rung.source),
});

export function buildExpansionLadder() {
  return copyLadder().map((copies) =>
    finish({
      id: `exp-d${CHAIN_DEPTH}-k${String(copies).padStart(2, "0")}`,
      kind: "expansion",
      depth: CHAIN_DEPTH,
      copies,
      leafCount: copies * 2 ** CHAIN_DEPTH,
      source: buildExpansionSource(CHAIN_DEPTH, copies),
    }),
  );
}

export function buildSizeControls() {
  return [SOURCE_LIMIT_BYTES, SOURCE_LIMIT_BYTES + 1].map((bytes) =>
    finish({
      id: `size-ctl-${bytes}`,
      kind: "size-control",
      depth: 0,
      copies: 0,
      leafCount: 1,
      source: buildPaddedSource(bytes),
    }),
  );
}

/** Rebuilds everything from the constants; the single entry point tests and the CLI use. */
export function recomputeCorpus() {
  const rungs = [...buildExpansionLadder(), ...buildSizeControls()];
  const digest = sha256(
    JSON.stringify(
      rungs.map(({ id, sha256: hash, byteLength, leafCount }) => [id, hash, byteLength, leafCount]),
    ),
  );
  return { rungs, digest, ladder: rungs.filter((rung) => rung.kind === "expansion") };
}
