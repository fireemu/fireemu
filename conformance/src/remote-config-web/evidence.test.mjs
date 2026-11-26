// The RC-CLOSURE-B evidence: the committed fixtures, comparisons and pins, read from the working
// tree, and the forgeries the check refuses; the judge's rows; the sanitiser's refusals.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DIR, FILES, KNOWN, PINS, comparison, sha256, verifyEvidence } from "./evidence.mjs";
import { compare, offsetText, role } from "./judge.mjs";
import { assertSanitised, maskText } from "./sanitise.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readers = (overrides = {}) => ({
  list: (dir) => readdirSync(join(ROOT, dir)),
  read: (path) =>
    path in overrides
      ? overrides[path]
      : existsSync(join(ROOT, path))
        ? readFileSync(join(ROOT, path))
        : null,
});
const fixture = (key) => JSON.parse(readFileSync(join(ROOT, FILES[key]), "utf8"));

test("the committed evidence verifies", () => {
  assert.deepEqual(verifyEvidence(readers()), []);
});

test("a changed fixture, an unpinned file or a widened comparison is refused", () => {
  const pass = readFileSync(join(ROOT, FILES.pass1), "utf8");
  assert.match(
    verifyEvidence(
      readers({ [FILES.pass1]: Buffer.from(pass.replace('"v1-premium', '"v9-premium')) }),
    ).join(),
    /sha256 differs from its pin/,
  );
  // A forged pass with its pin moved: the record lock still holds the old pin.
  const forged = Buffer.from(pass.replace('"v1-premium', '"v9-premium'));
  const pins = { ...PINS, [FILES.pass1]: sha256(forged) };
  assert.match(
    verifyEvidence({ ...readers({ [FILES.pass1]: forged }), pins }).join(),
    /its pin differs from spec\/compatibility\/closure\/record-digests\.json/,
  );
  assert.match(
    verifyEvidence({ ...readers(), pins: { ...PINS, extra: "x" } }).join(),
    /not the evidence files/,
  );
  const extra = {
    list: (dir) => [...readdirSync(join(ROOT, dir)), "stray.json"],
    read: readers().read,
  };
  assert.match(verifyEvidence(extra).join(), /stray\.json: not pinned/);
});

test("the fixtures hold no key, token, installation id, project number or project id", () => {
  for (const key of ["pass1", "pass2", "localStrict", "localEmulator"]) {
    const text = readFileSync(join(ROOT, FILES[key]), "utf8");
    assert.doesNotThrow(() => assertSanitised(JSON.parse(text)), key);
    for (const pattern of [
      /AIza/,
      /eyJ/,
      /FIS_v2/,
      /[0-9]{9,}:web:/,
      /fireemu-oracle/,
      /refreshToken":"[^s]/,
    ])
      assert.doesNotMatch(text, pattern, `${key} ${pattern}`);
    // The page's labels and the sanitiser's placeholders are what stand in for them.
    assert.match(text, /API_KEY/);
    assert.match(text, /FID_1/);
    assert.match(text, /1:PROJECT_NUMBER:web:WEB_APP_HASH/);
  }
});

test("the sanitiser refuses what a fixture must never hold", () => {
  for (const leak of [
    { k: "AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    { t: "eyJhbGciOiJFUzI1NiJ9.x" },
    { a: "FIS_v2 x" },
    { fid: "cAAAAAAAAAAAAAAAAAAAAA" },
    { refreshToken: "3_AS3qfwx" },
    { app: "1:123456789:web:ab" },
    { q: "?key=AIzaSomething" },
  ])
    assert.throws(() => assertSanitised(leak), /holds/, JSON.stringify(leak));
  assert.throws(() => assertSanitised({ p: "my-project" }, { project: "my-project" }), /project/);
  assert.equal(
    maskText("1:42424242:web:abc etag-proj-x", {
      project: "proj",
      number: "42424242",
      app: "abc",
      run: "r1",
    }),
    "1:PROJECT_NUMBER:web:WEB_APP_HASH etag-PROJECT_ID-x",
  );
});

test("the judge compares versions as offsets and names every difference it accepts", () => {
  assert.equal(offsetText('{"templateVersion": "47"}', 46), '{"templateVersion": "+1"}');
  assert.equal(
    offsetText('{"lastKnownVersionNumber":"54"}', 53),
    '{"lastKnownVersionNumber":"+1"}',
  );
  assert.equal(role({ path: "/v1/projects/P/namespaces/firebase:fetch" }), "fetch");
  assert.equal(
    role({ path: "/v1/projects/P/installations/FID_1", method: "DELETE" }),
    "installation-delete",
  );
  const pass1 = fixture("pass1");
  const pass2 = fixture("pass2");
  // A fixture compared with itself matches everywhere.
  assert.deepEqual(compare(pass1, pass1).counts.MISMATCH, 0);
  // Each changed value is a MISMATCH: an entry, a state, a frame, a status, an update.
  const changed = (edit) => {
    const copy = structuredClone(pass2);
    edit(copy);
    return compare(pass1, copy, { local: true })
      .table.filter((r) => r.verdict === "MISMATCH")
      .map((r) => r.id);
  };
  assert.deepEqual(
    changed((f) => {
      f.clients.one.wire[1].responseBody = f.clients.one.wire[1].responseBody.replace(
        "v1-premium",
        "v1-default",
      );
    }),
    ["one-2-fetch"],
  );
  assert.deepEqual(
    changed((f) => {
      f.clients.one.wire[2].responseBody = f.clients.one.wire[2].responseBody.replace(
        "NO_CHANGE",
        "UPDATE",
      );
    }),
    ["one-3-fetch"],
  );
  assert.deepEqual(
    changed((f) => {
      f.clients.one.wire[3].text = f.clients.one.wire[3].text.replace('"58"', '"57"');
    }),
    ["one-4-realtime"],
  );
  assert.deepEqual(
    changed((f) => {
      f.clients.two.wire[1].status = 429;
    }),
    ["two-2-fetch"],
  );
  assert.deepEqual(
    changed((f) => {
      f.clients.one.updates.pop();
    }),
    ["one-updates"],
  );
  assert.deepEqual(
    changed((f) => {
      f.clients.one.wire[1].responseHeaders.etag = "W/x";
    }),
    ["one-2-fetch"],
  );
  assert.deepEqual(
    changed((f) => {
      f.steps[4].updated = false;
    }),
    ["step-r1-changed"],
  );
  // The percent swap is accepted only for the corpus's percent parameter, default against half.
  assert.deepEqual(
    changed((f) => {
      f.clients.one.wire[1].responseBody = f.clients.one.wire[1].responseBody.replace(
        "v1-premium",
        "v1-half",
      );
    }),
    ["one-2-fetch"],
  );
  assert.deepEqual(
    changed((f) => {
      f.clients.two.wire[1].responseBody = f.clients.two.wire[1].responseBody.replace(
        '"fireemu_limit": "10"',
        '"fireemu_limit": "20"',
      );
    }),
    ["two-2-fetch"],
  );
  // An exchange missing on one side is UNKNOWN.
  const short = structuredClone(pass2);
  short.clients.one.wire.pop();
  assert.ok(compare(pass1, short).table.some((r) => r.verdict === "UNKNOWN"));
  // Local runs carry their own named differences; production-to-production never does.
  const local = comparison(pass1, fixture("localEmulator"), true);
  const named = new Set(local.table.flatMap((r) => r.knownDifferences ?? []));
  for (const id of named)
    assert.ok(
      JSON.parse(readFileSync(join(ROOT, KNOWN))).some((k) => k.id === id),
      id,
    );
  assert.ok(named.has("KD-WEB-FETCH-TAG-NUMBER"));
  const runs = comparison(pass1, pass2, false);
  assert.deepEqual(
    [...new Set(runs.table.flatMap((r) => r.knownDifferences ?? []))],
    ["KD-WEB-PERCENT-INSTALLATION"],
  );
  assert.equal(DIR, "conformance/remote-config-web");
});

test("the closure record's two stage-B conditions cite both passes, their counts and their known differences", async () => {
  const { CONDITIONS, conditionCounts, COMPARISONS } = await import("./evidence.mjs");
  const record = JSON.parse(
    readFileSync(join(ROOT, "spec/compatibility/closure/REMOTE-CONFIG.json"), "utf8"),
  );
  assert.equal(record.parentStatus, "IN_PROGRESS");
  const stageB = record.closureEvidence.stageB;
  assert.equal(stageB.knownDifferencesSha256, PINS[KNOWN]);
  for (const entry of [...stageB.recordings, ...stageB.localRuns])
    assert.equal(entry.fixtureSha256, PINS[entry.fixturePath], entry.fixturePath);
  for (const entry of stageB.comparisons)
    assert.equal(entry.comparisonSha256, PINS[entry.comparisonPath]);
  const tables = Object.fromEntries(
    COMPARISONS.map(([key, left, right, local]) => [
      key,
      comparison(fixture(left), fixture(right), local).table,
    ]),
  );
  for (const [condition, id] of Object.entries(CONDITIONS)) {
    const entry = record.conditions.find((c) => c.conditionId === id);
    assert.equal(entry.status, "VERIFIED", id);
    assert.equal(entry.observedPasses, 2);
    const used = new Set();
    for (const key of ["runVsRun", "strictVsPass1", "strictVsPass2"]) {
      const counts = conditionCounts(tables[key])[condition];
      assert.deepEqual(entry.comparisons[key], counts, `${id} ${key}`);
      assert.ok(counts.rows > 0);
      assert.equal(counts.counts.MISMATCH + counts.counts.UNKNOWN, 0);
    }
    // The differences it names are exactly the ones its rows use.
    const streamed = new Set();
    for (const key of ["runVsRun", "strictVsPass1", "strictVsPass2"]) {
      streamed.clear();
      for (const row of tables[key]) {
        const context = /^(one|two)-/.exec(row.id)?.[1];
        if (context && row.id.endsWith("-realtime")) streamed.add(context);
        const realtime =
          row.id.startsWith("step-r") ||
          row.id.endsWith("-realtime") ||
          row.id.endsWith("-updates") ||
          Boolean(
            context &&
            streamed.has(context) &&
            row.id.endsWith("-fetch") &&
            !row.id.includes("-sdk-"),
          );
        if ((realtime ? "realtime" : "fetch") === condition)
          for (const kd of row.knownDifferences ?? []) used.add(kd);
      }
    }
    assert.deepEqual(entry.knownDifferences, [...used].toSorted(), id);
    assert.equal(
      entry.passComparison,
      entry.comparisons.runVsRun.counts.KNOWN_DIFFERENCE ? "KNOWN_DIFFERENCE" : "MATCH",
    );
    assert.deepEqual(entry.profiles, {
      strict: "MATCHES_RECORDED_CASES",
      emulator: "NO_PRODUCTION_CLAIM",
    });
  }
});

test("near misses from mutation: the percent swap's bounds, paths, queries, sources, the sanitiser's one project, forged comparisons and records", async () => {
  const pass1 = fixture("pass1");
  const pass2 = fixture("pass2");
  const changed = (edit) => {
    const copy = structuredClone(pass2);
    edit(copy);
    return compare(pass1, copy, { local: true })
      .table.filter((r) => r.verdict === "MISMATCH")
      .map((r) => r.id);
  };
  // The swap holds only between two values of one version, and only for the percent parameter.
  assert.deepEqual(
    changed((f) => {
      f.clients.two.wire[1].responseBody = f.clients.two.wire[1].responseBody.replace(
        "v1-half",
        "v2-default",
      );
    }),
    ["two-2-fetch"],
  );
  const other = structuredClone(pass1);
  const swapped = structuredClone(pass2);
  for (const [fixtureCopy, value] of [
    [other, "v1-default"],
    [swapped, "v1-half"],
  ])
    fixtureCopy.clients.one.wire[1].responseBody =
      fixtureCopy.clients.one.wire[1].responseBody.replace(
        '"fireemu_limit": "20"',
        `"fireemu_limit": "${value}"`,
      );
  assert.ok(
    compare(other, swapped, { local: true }).table.some(
      (r) => r.id === "one-2-fetch" && r.verdict === "MISMATCH",
    ),
  );
  assert.deepEqual(
    changed((f) => {
      f.clients.one.wire[1].path = f.clients.one.wire[1].path.replace("PROJECT_ID", "OTHER");
    }),
    ["one-2-fetch"],
  );
  assert.deepEqual(
    changed((f) => {
      f.clients.one.wire[1].query = "?key=API_KEY&x=1";
    }),
    ["one-2-fetch"],
  );
  assert.deepEqual(
    changed((f) => {
      f.clients.one.fetches[0].values.fireemu_limit.source = "default";
    }),
    ["one-sdk-fetch-1"],
  );
  const { secretsOf } = await import("./sanitise.mjs");
  assert.throws(
    () =>
      secretsOf({
        run: { runId: "261125000000abc" },
        result: { runId: "261125000000abc" },
        wires: {
          one: [{ path: "/v1/projects/a/installations", requestBody: '{"app_id":"1:1:web:ab"}' }],
          two: [{ path: "/v1/projects/b/installations" }],
        },
      }),
    /2 projects/,
  );
  // A forged comparison under a moved pin, and a closure record with other counts, are refused.
  const doc = JSON.parse(readFileSync(join(ROOT, FILES.runVsRun), "utf8"));
  doc.counts.MATCH += 1;
  const forged = Buffer.from(JSON.stringify(doc, null, 2) + "\n");
  assert.match(
    verifyEvidence({
      ...readers({ [FILES.runVsRun]: forged }),
      pins: { ...PINS, [FILES.runVsRun]: sha256(forged) },
    }).join(),
    /differs from the recomputed comparison/,
  );
  const record = JSON.parse(
    readFileSync(join(ROOT, "spec/compatibility/closure/REMOTE-CONFIG.json"), "utf8"),
  );
  record.conditions.find(
    (c) => c.conditionId === "REMOTE-CONFIG/realtime-updates",
  ).comparisons.runVsRun.counts.MATCH += 1;
  assert.match(
    verifyEvidence(
      readers({
        "spec/compatibility/closure/REMOTE-CONFIG.json": Buffer.from(JSON.stringify(record)),
      }),
    ).join(),
    /realtime-updates runVsRun differs from the recomputed counts/,
  );
});

test("the judge refuses undeclared fetch and realtime wire differences", () => {
  const pass = fixture("pass1");
  const fetches = (run) => run.clients.one.wire.filter((wire) => role(wire) === "fetch");
  const stream = (run) => run.clients.one.wire.find((wire) => role(wire) === "realtime");
  const tag = "etag-PROJECT_ID-firebase-fetch-2147483647";
  for (const [name, edit] of Object.entries({
    "a changed NO_CHANGE tag": (f) => {
      fetches(f)[1].responseHeaders.etag = tag;
      fetches(f)[2].requestHeaders["if-none-match"] = tag;
    },
    "a broken cache chain": (f) => {
      fetches(f)[2].requestHeaders["if-none-match"] = tag;
    },
    "an unrecorded top-level response field": (f) => {
      fetches(f)[0].responseBody = fetches(f)[0].responseBody.replace(
        '"state":',
        '"extra": true,\n  "state":',
      );
    },
    "an unrecorded content encoding": (f) => {
      fetches(f)[0].responseHeaders["content-encoding"] = "br";
    },
    "an unrecorded vary field": (f) => {
      fetches(f)[0].responseHeaders.vary = "*";
    },
    "changed realtime app identity": (f) => {
      stream(f).requestBody = stream(f).requestBody.replace("WEB_APP_HASH", "OTHER_APP");
    },
  })) {
    const forged = structuredClone(pass);
    edit(forged);
    assert.ok(compare(pass, forged, { local: true }).counts.MISMATCH > 0, name);
  }
});
