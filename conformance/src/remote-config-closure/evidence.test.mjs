import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { gitReaders } from "../remote-config-production/evidence.mjs";
import {
  CASES,
  COMPARISONS,
  CONDITION_ROWS,
  DIR,
  FILES,
  KNOWN,
  PINS,
  RECORD_LOCK,
  TRUST_INPUTS,
  comparison,
  conditionCounts,
  conditionOf,
  corpusNumber,
  verifyEvidence,
} from "./evidence.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (bytes) => JSON.parse(bytes);
const bytesOf = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

function headFiles() {
  const { read } = gitReaders("HEAD", ROOT);
  return Object.fromEntries([...Object.keys(PINS), RECORD_LOCK].map((path) => [path, read(path)]));
}

function readers(files) {
  return {
    list: (dir) =>
      Object.keys(files)
        .filter((path) => dirname(path) === dir)
        .map((path) => path.slice(dir.length + 1)),
    read: (path) => files[path] ?? null,
  };
}

const pinsOf = (files) =>
  Object.fromEntries(Object.keys(PINS).map((path) => [path, sha256(files[path])]));

/** A forger who rewrites one input, recomputes every comparison, every pin and the record lock. */
function reforge(files, path, change) {
  const out = { ...files };
  const value = json(out[path]);
  change(value);
  out[path] = bytesOf(value);
  for (const [key, left, right, kind, profile] of COMPARISONS)
    out[FILES[key]] = bytesOf(
      comparison({
        kind,
        profile,
        left: { bytes: out[FILES[left]] },
        right: { bytes: out[FILES[right]] },
        known: { bytes: out[KNOWN] },
      }),
    );
  const pins = pinsOf(out);
  const lock = json(out[RECORD_LOCK]);
  lock.records[FILES.pass1] = pins[FILES.pass1];
  lock.records[FILES.pass2] = pins[FILES.pass2];
  out[RECORD_LOCK] = bytesOf(lock);
  return { files: out, pins };
}

const check = (forged) => verifyEvidence({ ...readers(forged.files), pins: forged.pins });

test("the committed closure evidence of HEAD is valid when read from git objects", () => {
  assert.deepEqual(verifyEvidence(gitReaders("HEAD", ROOT)), []);
});

test("the pins are a closed table of the evidence directory and the known differences", () => {
  assert.deepEqual(Object.keys(PINS).toSorted(), TRUST_INPUTS);
  const files = headFiles();
  const { [FILES.emulatorVsPass2]: _dropped, ...fewer } = PINS;
  assert.match(verifyEvidence({ ...readers(files), pins: fewer })[0], /trust table/);
  const extra = { ...files, [`${DIR}/extra.json`]: Buffer.from("{}\n") };
  assert.ok(verifyEvidence(readers(extra)).includes(`${DIR}/extra.json: not pinned`));
  const { [FILES.pass2]: _missing, ...absent } = files;
  assert.ok(verifyEvidence(readers(absent)).includes(`${FILES.pass2}: pinned but absent`));
});

test("forgery: altered bytes fail their pin; a re-pinned pass is refused by the record lock", () => {
  const files = headFiles();
  const altered = { ...files, [FILES.pass1]: Buffer.from(files[FILES.pass1].toString() + " ") };
  assert.ok(
    verifyEvidence(readers(altered)).includes(`${FILES.pass1}: sha256 differs from its pin`),
  );
  const pins = { ...PINS, [FILES.pass1]: sha256(altered[FILES.pass1]) };
  assert.ok(
    verifyEvidence({ ...readers(altered), pins }).includes(
      `${FILES.pass1}: its pin differs from ${RECORD_LOCK}`,
    ),
  );
});

test("forgery: a comparison that is not the recomputed one", () => {
  const files = headFiles();
  for (const [key] of COMPARISONS) {
    const value = json(files[FILES[key]]);
    value.rows[0].status = value.rows[0].status === "MATCH" ? "MISMATCH" : "MATCH";
    const forged = { ...files, [FILES[key]]: bytesOf(value) };
    const pins = { ...PINS, [FILES[key]]: sha256(forged[FILES[key]]) };
    assert.ok(
      verifyEvidence({ ...readers(forged), pins }).includes(
        `${FILES[key]}: differs from the recomputed comparison`,
      ),
      key,
    );
  }
});

test("forgery: a widened known-difference rule is refused even with every pin recomputed", () => {
  const forged = reforge(headFiles(), KNOWN, (known) => {
    known.entries[0].fieldSuffixes.push(":value");
  });
  assert.ok(check(forged).includes(`${KNOWN}: the rules differ from the pinned rules`));
  const scope = reforge(headFiles(), KNOWN, (known) => {
    known.entries[1].appliesTo.push("production-vs-local");
  });
  assert.ok(check(scope).includes(`${KNOWN}: the rules differ from the pinned rules`));
});

test("forgery: a fixture with another case list, an open item or a private value", () => {
  const files = headFiles();
  const dropped = reforge(files, FILES.pass2, (fixture) => fixture.rows.pop());
  assert.ok(check(dropped).includes(`${FILES.pass2}: the rows are not the cases of the plan`));
  const open = reforge(files, FILES.pass1, (fixture) => fixture.open.push("x"));
  assert.ok(check(open).includes(`${FILES.pass1}: the run left open items`));
  const number = reforge(files, FILES.pass1, (fixture) => {
    fixture.rows[0].text = "123456789012";
  });
  assert.ok(check(number).includes(`${FILES.pass1}: a number of 11 or more digits`));
  const tag = reforge(files, FILES.localStrict, (fixture) => {
    fixture.rows[0].etag = "etag-123456789012-3";
  });
  assert.ok(check(tag).includes(`${FILES.localStrict}: a numeric ETag`));
  // The recomputed comparisons alone never make a forged fixture valid.
  assert.notDeepEqual(check(open), []);
});

test("corpusNumber admits only the corpus's own long digit runs", () => {
  assert.ok(corpusNumber("9223372036854775807"));
  assert.ok(corpusNumber("000000000000000000049"));
  assert.ok(corpusNumber("000000000000000000000"));
  for (const digits of [
    "9223372036854775806",
    "000000000123456789012",
    "123456789012",
    "100000000000000000000",
  ])
    assert.equal(corpusNumber(digits), false, digits);
});

test("conditions own the rows: one owner each, and counts by condition", () => {
  assert.equal(conditionOf("a-client"), "REMOTE-CONFIG/template-read");
  assert.equal(conditionOf("g-server"), "REMOTE-CONFIG/template-read");
  assert.equal(conditionOf("v-cond-negation"), "REMOTE-CONFIG/template-validation");
  assert.equal(conditionOf("p7-race"), "REMOTE-CONFIG/template-publish");
  assert.equal(conditionOf("c9-restore"), "REMOTE-CONFIG/version-history-and-rollback");
  assert.equal(conditionOf("k2-rollback-unknown"), "REMOTE-CONFIG/version-history-and-rollback");
  assert.equal(conditionOf("s7-history"), "REMOTE-CONFIG/server-template-evaluation");
  assert.equal(conditionOf("s-validate-00"), "REMOTE-CONFIG/server-template-evaluation");
  assert.equal(conditionOf("summary:g1"), "REMOTE-CONFIG/publish-trigger");
  assert.equal(conditionOf("event-ids"), "REMOTE-CONFIG/publish-trigger");
  assert.equal(conditionOf("x-unknown"), null);
  for (const id of CASES) assert.ok(conditionOf(id), id);
  const document = {
    rows: [
      { id: "r-identity", status: "MATCH" },
      { id: "r-number", status: "KNOWN_DIFFERENCE" },
      { id: "v-empty", status: "MISMATCH" },
    ],
  };
  assert.deepEqual(conditionCounts(document, "REMOTE-CONFIG/template-read"), {
    rows: 2,
    counts: { MATCH: 1, MATCH_LAYOUT: 0, KNOWN_DIFFERENCE: 1, MISMATCH: 0, UNKNOWN: 0 },
  });
  assert.equal(Object.keys(CONDITION_ROWS).length, 6);
});

// The Codex r3 forgeries (ruling 11), each a forged local strict fixture with every comparison and
// pin recomputed: the evidence check refuses each through the comparisons it recomputes.
const refusedForgery = (change) => {
  const problems = check(reforge(headFiles(), FILES.localStrict, change));
  assert.ok(
    problems.some((p) => /closure-a-strict-vs-pass-[12]\.json: [1-9][0-9]* MISMATCH/.test(p)),
    problems.join("\n"),
  );
};
const rowOf = (fixture, caseId) => fixture.rows.find((row) => row.case === caseId);
const eventOf = (fixture, versionNumber, generation) =>
  fixture.events.find((e) => e.versionNumber === versionNumber && e.generation === generation);

test("forgery r3-1: a REST time in Gen1's spelling, and a Gen1 time in REST's", () => {
  refusedForgery((fixture) => {
    const row = rowOf(fixture, "p1-publish");
    row.body.version.updateTime = row.body.version.updateTime.replace(".120Z", ".12Z");
    row.bodyBytes -= 1;
  });
  refusedForgery((fixture) => {
    const version = rowOf(fixture, "p1-publish").body.version.versionNumber;
    const event = eventOf(fixture, version, 1);
    const longer = (t) => t.replace(/\.12Z$/, ".120Z");
    event.updateTime = longer(event.updateTime);
    event.data.updateTime = longer(event.data.updateTime);
    event.context.timestamp = longer(event.context.timestamp);
  });
});

test("forgery r3-2: an event a nanosecond after its version is another instant", () => {
  refusedForgery((fixture) => {
    const version = rowOf(fixture, "p1-publish").body.version.versionNumber;
    const event = eventOf(fixture, version, 2);
    const later = (t) => t.replace(/\.120Z$/, ".120000001Z");
    event.updateTime = later(event.updateTime);
    event.data.updateTime = later(event.data.updateTime);
    event.context.time = later(event.context.time);
  });
});

test("forgery r3-3: an extra delivery that names no version of the run", () => {
  refusedForgery((fixture) => {
    const version = rowOf(fixture, "p1-publish").body.version.versionNumber;
    const extra = structuredClone(eventOf(fixture, version, 2));
    const other = (t) => t.replace(/\.120Z$/, ".999Z");
    extra.updateTime = other(extra.updateTime);
    extra.data.updateTime = other(extra.data.updateTime);
    extra.context.time = other(extra.context.time);
    extra.order = fixture.events.length;
    fixture.events.push(extra);
  });
});

test("forgery r3-5: the defaults file in sorted order", () => {
  refusedForgery((fixture) => {
    // The recorded text with its first two entries swapped (the template order of ruling 6).
    const row = rowOf(fixture, "d-json");
    const lines = row.text.split("\n");
    [lines[1], lines[2]] = [lines[2].replace(/,?$/, ","), lines[1].replace(/,?$/, ",")];
    row.text = lines.join("\n");
  });
});

test("forgery r3-6: an unrecorded race loser with the recorded error status", () => {
  refusedForgery((fixture) => {
    const loser = ["p7-race-a", "p7-race-b"]
      .map((c) => rowOf(fixture, c))
      .find((r) => r.status !== 200);
    loser.status = 400;
    loser.body = { error: { code: 418, message: "arbitrary", status: "FAILED_PRECONDITION" } };
  });
});

// The Codex r4 forgeries (ruling 14), through the evidence check with every pin recomputed.
const reforgeAll = (changes) => {
  let forged = { files: headFiles(), pins: PINS };
  for (const [path, change] of changes) forged = reforge(forged.files, path, change);
  return forged;
};
const refusedStrict = (forged) => {
  const problems = check(forged);
  assert.ok(
    problems.some((p) => /closure-a-strict-vs-pass-[12]\.json: [1-9][0-9]* MISMATCH/.test(p)),
    problems.join("\n"),
  );
};

test("forgery r4-1: a changed escape in the race winner, waived by neither member-order rule", () => {
  const winnerOf = (fixture) =>
    ["p7-race-a", "p7-race-b"].map((c) => rowOf(fixture, c)).find((r) => r.status === 200);
  const add = (escaped) => (fixture) => {
    const winner = winnerOf(fixture);
    winner.body = { "a:member-order": "x", ...winner.body };
    if (escaped) winner.escapes = { ...winner.escapes, "value:/a:member-order": [[0, "\\u0078"]] };
  };
  refusedStrict(
    reforgeAll([
      [FILES.pass1, add(true)],
      [FILES.pass2, add(true)],
      [FILES.localStrict, add(false)],
    ]),
  );
});

test("forgery r4-2: a duplicate defaults entry padded to the recorded length", () => {
  refusedStrict(
    reforge(headFiles(), FILES.localStrict, (fixture) => {
      const row = rowOf(fixture, "d-xml");
      const compact = row.text.replace(/\n\s*/g, "");
      const extra = "<entry><key>fireemu_count</key><value>12.5</value></entry>";
      const body = compact.replace("</defaults>", `${extra}</defaults>`);
      row.text = body.replace(
        "</defaults>",
        `${" ".repeat(Math.max(0, row.bodyBytes - body.length))}</defaults>`,
      );
    }),
  );
});

test("forgery r4-3: only an event's envelope time moves off its publication", () => {
  refusedStrict(
    reforge(headFiles(), FILES.localStrict, (fixture) => {
      const version = rowOf(fixture, "p1-publish").body.version.versionNumber;
      const event = eventOf(fixture, version, 2);
      event.context.time = event.context.time.replace(/\.120Z$/, ".120000001Z");
    }),
  );
});

test("forgery r4-4: an extra event of another generation", () => {
  refusedStrict(
    reforge(headFiles(), FILES.localStrict, (fixture) => {
      const version = rowOf(fixture, "p1-publish").body.version.versionNumber;
      const extra = structuredClone(eventOf(fixture, version, 2));
      extra.generation = 3;
      const other = (t) => t.replace(/\.120Z$/, ".999Z");
      extra.updateTime = other(extra.updateTime);
      extra.data.updateTime = other(extra.data.updateTime);
      extra.context.time = other(extra.context.time);
      fixture.events.push(extra);
    }),
  );
});

test("forgery r4 Should: an unrelated change in an emulator carrier row", () => {
  const forged = reforge(headFiles(), FILES.localEmulator, (fixture) => {
    const row = rowOf(fixture, "s2-data-plane");
    row.body.parameters.fireemu_obs_top.defaultValue.value = "zefault";
  });
  const problems = check(forged);
  assert.ok(
    problems.some((p) =>
      p.includes("s2-data-plane differs by more than the accepted server conditions"),
    ),
    problems.join("\n"),
  );
});
