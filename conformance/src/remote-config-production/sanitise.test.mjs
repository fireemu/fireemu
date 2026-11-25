import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  PLACEHOLDERS,
  assertSanitised,
  escapeMap,
  maskText,
  maskValue,
  sanitiseRun,
  secretsOf,
  skeletonBytes,
} from "./sanitise.mjs";

// Synthetic private values: a 12-digit number and a project id that only these tests use.
const PROJECT = "synthetic-sandbox";
const NUMBER = "123456789012";
const RUN = "261124000000abc";
const SECRETS = { project: PROJECT, number: NUMBER, run: RUN };
const HOST = "https://firebaseremoteconfig.googleapis.com";

function body(value) {
  return Buffer.from(JSON.stringify(value, null, 2));
}

/** A production run of three requests: one Remote Config read, one infrastructure read, one publish. */
function run({ target = "production", tamper } = {}) {
  const read = body({
    version: {
      versionNumber: "27",
      updateUser: {
        email: "owner@corp.example.org",
        name: "Owner Name",
        imageUrl: "https://lh3.example/x",
      },
    },
  });
  const publish = body({
    version: { versionNumber: "28", description: `fireemu rc-observe ${RUN} c0` },
  });
  const iam = body({ bindings: [{ members: [`serviceAccount:service-${NUMBER}@example.iam`] }] });
  const answer = (seq, file, bytes, extra = {}) => ({
    seq,
    phase: "response-persisted",
    status: 200,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    file,
    contentType: "application/json; charset=UTF-8",
    contentEncoding: "gzip",
    ...extra,
  });
  const journal = [
    {
      seq: 1,
      case: "a-client",
      phase: "before-send",
      method: "GET",
      url: `${HOST}/v1/projects/${PROJECT}/remoteConfig`,
    },
    answer(1, "001.body", read, { etag: `etag-${NUMBER}-27` }),
    {
      seq: 2,
      case: "a-iam",
      phase: "before-send",
      method: "POST",
      url: `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`,
    },
    answer(2, "002.body", iam),
    {
      seq: 3,
      case: "c0-publish",
      phase: "before-send",
      method: "PUT",
      url: `${HOST}/v1/projects/${PROJECT}/namespaces/firebase/remoteConfig?validateOnly=false`,
      ifMatch: `etag-${NUMBER}-27`,
    },
    answer(3, "003.body", publish, { etag: `etag-${NUMBER}-28` }),
  ];
  const files = { "001.body": read, "002.body": iam, "003.body": publish };
  if (tamper) tamper({ journal, files });
  return {
    run: { runId: RUN, target },
    journal,
    files,
    events: [
      {
        generation: 1,
        eventId: "1",
        data: { description: `x ${RUN}` },
        context: { resource: `projects/${PROJECT}` },
      },
    ],
    result: {
      complete: true,
      open: [],
      baseline: {
        before: {
          client: { version: "27", empty: true, etag: `etag-${NUMBER}-27` },
          server: { version: "6", empty: true },
        },
      },
      versions: [
        { namespace: "client", step: "c0", versionNumber: "28", etag: `etag-${NUMBER}-28` },
      ],
      summary: { generations: { 1: { projectValues: [PROJECT] } } },
    },
  };
}

test("secretsOf reads the project id, the project number of the ETags and the run id", () => {
  assert.deepEqual(secretsOf(run()), SECRETS);
  const two = run({
    tamper: ({ journal }) => {
      journal[5].etag = "etag-987654321098-28";
    },
  });
  assert.throws(() => secretsOf(two), /more than one project number/);
  assert.throws(() => secretsOf({ run: { runId: RUN }, journal: [] }), /no Remote Config request/);
  assert.throws(() => secretsOf({ ...run(), run: { runId: "BAD ID" } }), /no valid run id/);
});

test("maskText replaces e-mail addresses, the number, the project and the run id", () => {
  assert.equal(
    maskText(`a@b.co projects/${PROJECT} etag-${NUMBER}-3 ${RUN} x@y`, SECRETS),
    `${PLACEHOLDERS.email} projects/PROJECT_ID etag-PROJECT_NUMBER-3 RUN_ID x@y`,
  );
});

test("maskValue replaces a non-empty updateUser name and image, keeps empty ones and masks keys", () => {
  const masked = maskValue(
    {
      [PROJECT]: { updateUser: { email: "a@b.example", name: "N", imageUrl: "u" } },
      v2: { updateUser: { email: "a@b.example", name: "", imageUrl: "" } },
      list: [`${RUN}`],
    },
    SECRETS,
  );
  assert.deepEqual(masked, {
    PROJECT_ID: {
      updateUser: {
        email: PLACEHOLDERS.email,
        name: PLACEHOLDERS.name,
        imageUrl: PLACEHOLDERS.image,
      },
    },
    v2: { updateUser: { email: PLACEHOLDERS.email, name: "", imageUrl: "" } },
    list: ["RUN_ID"],
  });
});

test("skeletonBytes removes the bytes inside string values and keeps keys, escapes and layout", () => {
  assert.equal(skeletonBytes('{"a": "xyz"}'), '{"a": ""}'.length);
  assert.equal(skeletonBytes('{"a" : "x\\"y"}'), '{"a" : ""}'.length);
  assert.equal(skeletonBytes('["é", 1, {"k":"v"}]'), '["", 1, {"k":""}]'.length);
  assert.throws(() => skeletonBytes('{"a": "x'), /unterminated/);
  // Whitespace of every JSON kind may stand between a key and its colon.
  for (const space of [" ", "\n", "\r", "\t"])
    assert.equal(
      skeletonBytes(`{"key"${space}: "value"}`),
      `{"key"${space}: ""}`.length,
      JSON.stringify(space),
    );
});

// A seeded generator of JSON values: the skeleton of any pretty-printed value equals the length of
// the same value with every string value emptied (keys kept).
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
function randomJson(random, depth = 0) {
  const pick = random();
  const text = () => {
    const alphabet = ["a", "Z", '"', "\\", "é", " ", ":", "\n", "\u0001", "{", "😀"];
    return Array.from(
      { length: Math.floor(random() * 6) },
      () => alphabet[Math.floor(random() * alphabet.length)],
    ).join("");
  };
  if (depth > 3 || pick < 0.3) return text();
  if (pick < 0.4) return Math.floor(random() * 1000);
  if (pick < 0.45) return random() < 0.5;
  if (pick < 0.7)
    return Array.from({ length: Math.floor(random() * 4) }, () => randomJson(random, depth + 1));
  return Object.fromEntries(
    Array.from({ length: Math.floor(random() * 4) }, () => [text(), randomJson(random, depth + 1)]),
  );
}
const emptied = (v) =>
  typeof v === "string"
    ? ""
    : Array.isArray(v)
      ? v.map(emptied)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, emptied(x)]))
        : v;

test("property: skeletonBytes equals the length of the value with its string values emptied", () => {
  const random = prng(20261124);
  for (let i = 0; i < 2000; i += 1) {
    const v = randomJson(random);
    for (const indent of [0, 2]) {
      const text = JSON.stringify(v, null, indent);
      assert.equal(
        skeletonBytes(text),
        Buffer.byteLength(JSON.stringify(emptied(v), null, indent)),
        text,
      );
    }
  }
});

test("sanitiseRun keeps the Remote Config rows only, masked, with the recorded lengths", () => {
  const fixture = sanitiseRun(run());
  assert.equal(fixture.requests, 3);
  assert.equal(fixture.infrastructureRequests, 1);
  assert.deepEqual(
    fixture.rows.map((r) => [r.case, r.path, r.query, r.ifMatch, r.etag]),
    [
      ["a-client", "/v1/projects/PROJECT_ID/remoteConfig", "", null, "etag-PROJECT_NUMBER-27"],
      [
        "c0-publish",
        "/v1/projects/PROJECT_ID/namespaces/firebase/remoteConfig",
        "validateOnly=false",
        "etag-PROJECT_NUMBER-27",
        "etag-PROJECT_NUMBER-28",
      ],
    ],
  );
  const raw = run().files["001.body"];
  assert.equal(fixture.rows[0].bodyBytes, raw.length);
  assert.equal(fixture.rows[0].skeletonBytes, skeletonBytes(raw.toString()));
  assert.deepEqual(fixture.rows[0].body.version.updateUser, {
    email: PLACEHOLDERS.email,
    name: PLACEHOLDERS.name,
    imageUrl: PLACEHOLDERS.image,
  });
  assert.equal(fixture.rows[1].body.version.description, "fireemu rc-observe RUN_ID c0");
  assert.deepEqual(fixture.baseline, {
    client: { version: "27", empty: true },
    server: { version: "6", empty: true },
  });
  assert.equal(fixture.events[0].context.resource, "projects/PROJECT_ID");
  // The recorder's summary is not kept (ruling 12): the judge computes it from the events.
  assert.equal(Object.hasOwn(fixture, "summary"), false);
  const text = JSON.stringify(fixture);
  for (const secret of [PROJECT, NUMBER, RUN, "owner@corp", "Owner Name", "lh3.example"])
    assert.ok(!text.includes(secret), secret);
});

test("sanitiseRun refuses a body that does not match its journal size or digest, or is missing", () => {
  const resized = run({
    tamper: ({ files }) =>
      void (files["001.body"] = Buffer.concat([files["001.body"], Buffer.from(" ")])),
  });
  assert.throws(() => sanitiseRun(resized), /is not \d+ bytes/);
  const altered = run({
    tamper: ({ files }) => {
      const b = Buffer.from(files["001.body"]);
      b[b.indexOf("27")] = "3".charCodeAt(0);
      files["001.body"] = b;
    },
  });
  assert.throws(() => sanitiseRun(altered), /does not match its journal digest/);
  const missing = run({ tamper: ({ files }) => void delete files["003.body"] });
  assert.throws(() => sanitiseRun(missing), /is missing/);
});

test("sanitiseRun keeps an unanswered row as such, and a local run keeps its control-listener rows", () => {
  const unanswered = sanitiseRun(run({ tamper: ({ journal }) => void journal.splice(5, 1) }));
  assert.equal(unanswered.rows[1].phase, "unanswered");
  assert.equal(unanswered.rows[1].status, undefined);
  const local = sanitiseRun(
    run({
      target: "local",
      tamper: ({ journal }) => {
        for (const row of journal)
          if (row.url) row.url = row.url.replace(HOST, "http://127.0.0.1:4400");
      },
    }),
  );
  assert.equal(local.rows.length, 2);
  assert.equal(local.target, "local");
});

test("assertSanitised names every private value it finds", () => {
  assert.throws(() => assertSanitised(`x ${PROJECT}`, SECRETS), /project id/);
  assert.throws(() => assertSanitised(`x ${NUMBER}`, SECRETS), /project number/);
  assert.throws(() => assertSanitised(`x ${RUN}`, SECRETS), /run id/);
  assert.throws(() => assertSanitised("etag-98765-2", SECRETS), /numeric ETag/);
  assert.throws(() => assertSanitised("a@b.example", SECRETS), /e-mail address/);
  assert.doesNotThrow(() =>
    assertSanitised(`${PLACEHOLDERS.email} PROJECT_ID etag-PROJECT_NUMBER-2`, SECRETS),
  );
});

test("sanitiseRun drops a production request to another host even on a Remote Config path", () => {
  const fixture = sanitiseRun(
    run({
      tamper: ({ journal }) =>
        void (journal[4].url = journal[4].url.replace(HOST, "https://example.googleapis.com")),
    }),
  );
  assert.deepEqual(
    fixture.rows.map((r) => r.case),
    ["a-client"],
  );
  assert.equal(fixture.infrastructureRequests, 2);
});

test("sanitiseRun refuses a run whose private value survives the masking (a JSON number)", () => {
  const leaked = run({
    tamper: ({ journal, files }) => {
      const bytes = Buffer.from(JSON.stringify({ projectNumber: Number(NUMBER) }));
      files["003.body"] = bytes;
      Object.assign(journal[5], {
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    },
  });
  assert.throws(() => sanitiseRun(leaked), /fixture still carries: project number/);
});

// Coordinator ruling 3 (2026-11-24, review of 9bf6af99f).
function withBody(text) {
  return run({
    tamper: ({ journal, files }) => {
      const bytes = Buffer.from(text);
      files["003.body"] = bytes;
      Object.assign(journal[5], {
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    },
  });
}

test("sanitiseRun refuses private values in encoded forms and any numeric ETag left", () => {
  for (const [value, kind] of [
    ["MTIzNDU2Nzg5MDEy", "project number"],
    ["%31%32%33%34%35%36%37%38%39%30%31%32", "project number"],
    ["owner%40corp.example.org", "e-mail address"],
    [Buffer.from(`x ${PROJECT} y`).toString("base64url"), "project id"],
    ["etag-1234-1", "numeric ETag"],
  ]) {
    assert.throws(
      () => sanitiseRun(withBody(JSON.stringify({ note: value }))),
      new RegExp(kind),
      value,
    );
  }
});

test("escapeMap records every escape by field and position", () => {
  assert.deepEqual(escapeMap('{"a": "percent \\u003c= 50", "b": ["\\"", "x"], "c\\u0026": 1}'), {
    "value:/a": [[8, "\\u003c"]],
    "value:/b/0": [[0, '\\"']],
    "name:/c&": [[1, "\\u0026"]],
  });
  // The review's input: the same decoded text with the escape on another character.
  assert.notDeepEqual(
    escapeMap('{"e": "percent \\u003c= 50"}'),
    escapeMap('{"e": "\\u0070ercent <= 50"}'),
  );
  assert.deepEqual(escapeMap('{"k/~": "\\n"}'), { "value:/k~1~0": [[0, "\\n"]] });
  assert.throws(() => escapeMap('{"a": "x'), /unterminated/);
  assert.deepEqual(escapeMap('[["a", "\\u003c"], "\\u003e"]'), {
    "value:/0/1": [[0, "\\u003c"]],
    "value:/1": [[0, "\\u003e"]],
  });
});

test("a member named __proto__ survives sanitising", () => {
  for (const value of ["A", "B"]) {
    const fixture = sanitiseRun(
      withBody(`{"parameters":{"__proto__":{"defaultValue":{"value":"${value}"}}}}`),
    );
    const parameters = fixture.rows[1].body.parameters;
    assert.deepEqual(Object.keys(parameters), ["__proto__"]);
    assert.equal(parameters["__proto__"].defaultValue.value, value);
  }
});

test("escape paths are masked like the members they name", () => {
  const fixture = sanitiseRun(withBody(`{"${PROJECT}": "a\\u003cb"}`));
  assert.deepEqual(fixture.rows[1].escapes, { "value:/PROJECT_ID": [[1, "\\u003c"]] });
});

test("a body that is not JSON is kept as masked text with its recorded lengths", () => {
  for (const text of [
    `<?xml version="1.0"?><defaults><entry><key>${PROJECT}</key><value/></entry></defaults>`,
    "",
  ]) {
    const fixture = sanitiseRun(withBody(text));
    const row = fixture.rows[1];
    assert.equal(row.body, null);
    assert.equal(row.text, text.split(PROJECT).join("PROJECT_ID"));
    assert.equal(row.bodyBytes, Buffer.byteLength(text));
    assert.equal(row.skeletonBytes, Buffer.byteLength(text));
    assert.deepEqual(row.escapes, {});
  }
  // A JSON body keeps no text field.
  assert.equal(Object.hasOwn(sanitiseRun(withBody("{}")).rows[1], "text"), false);
});

test("member-name and value escapes cannot overwrite each other (ruling 5)", () => {
  // The review's two digest-consistent bodies.
  const one = escapeMap('{"a@key":"\\u0078","\\u0061":"d","b@key":"y","\\u0062":"d"}');
  const two = escapeMap('{"a@key":"x","\\u0061":"d","b@key":"\\u0079","\\u0062":"d"}');
  assert.notDeepEqual(one, two);
  assert.deepEqual(Object.keys(one).toSorted(), ["name:/a", "name:/b", "value:/a@key"]);
});

test("privacy checks decode nested encodings (ruling 5)", () => {
  const encoded = [...Buffer.from(NUMBER).toString("base64")]
    .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
    .join("");
  assert.throws(() => sanitiseRun(withBody(JSON.stringify({ note: encoded }))), /project number/);
  const twice = Buffer.from(Buffer.from(NUMBER).toString("base64")).toString("base64");
  assert.throws(() => sanitiseRun(withBody(JSON.stringify({ note: twice }))), /project number/);
  const percentInside = Buffer.from(
    encodeURIComponent(`owner@corp.example.org`).replaceAll("@", "%40"),
  ).toString("base64");
  assert.throws(
    () => sanitiseRun(withBody(JSON.stringify({ note: percentInside }))),
    /e-mail address/,
  );
});

test("privacy checks decode three nested layers (ruling 5)", () => {
  const b64 = (text) => Buffer.from(text).toString("base64");
  const pct = (text) =>
    [...text].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("");
  assert.throws(
    () => sanitiseRun(withBody(JSON.stringify({ note: b64(pct(b64(NUMBER))) }))),
    /project number/,
  );
});

test("an earlier run's id in a listed version description is masked", async () => {
  const { maskText } = await import("./sanitise.mjs");
  const secrets = { project: "p-x", number: null, run: "261125000000abc" };
  assert.equal(
    maskText(
      "fireemu rc-observe 261124031420xyz c1 and fireemu rc-closure 261125000000abc p1",
      secrets,
    ),
    "fireemu rc-observe OTHER_RUN_ID c1 and fireemu rc-closure RUN_ID p1",
  );
  // Only the recorders' marker and run-id form are masked.
  assert.equal(maskText("version 261124031420xyz", secrets), "version 261124031420xyz");
});
