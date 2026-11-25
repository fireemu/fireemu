// The judge of the Remote Config observation: compares the rows of two sanitised runs of the same
// recorder plan (production against local fireemu, or one production run against another). Pure.
//
// Rules, fixed before any comparison was read:
//  - Rows are paired by case name. A case absent from one side, or not answered on either side,
//    is UNKNOWN, never a match and never a mismatch.
//  - Compared per answer: status, Content-Type, Content-Encoding, the ETag by form (absent, or
//    `etag-<prefix>-<version>` with the version as an offset from the run's baseline of its
//    namespace, spelled without leading zeros), the layout length (`skeletonBytes`, measured by the
//    sanitiser on the raw body), every escape the raw body wrote by field and position
//    (`escapes`), and the decoded body: member names and their order, value types, and values.
//    Every string is compared in a tagged form, so no input string equals a normalised one; volatile
//    values are compared by form only:
//      - version numbers (`versionNumber`, a non-zero `rollbackSource`, a numeric `nextPageToken`,
//        the number in "Rollback to version n") as offsets from the baseline of the row's namespace,
//        when spelled without leading zeros (any other spelling is compared as written);
//      - RFC 3339 times by form (UTC `Z`, the number of fraction digits), never by value.
//    A form that agrees with different values is MATCH_LAYOUT; equal bodies, equal `bodyBytes`
//    and equal headers are MATCH.
//  - The two baseline reads (cases `a-client`, `a-server`) show the project before the run: their
//    `version` metadata is what earlier writes left, which the two sides do not share, so
//    `body.version` of these rows is not compared (status, headers, ETag form and the rest are).
//  - Event ids (`eventId`, `id`) are compared by form: a decimal int32, positive or negative.
//  - A history answer lists the run's versions after older versions of the project, whose content
//    the two sides do not share: only the entries newer than the baseline are compared, and neither
//    the body length nor the layout length of a history answer is. The same holds for the lengths
//    of the two baseline reads.
//  - A mask hides a value, never a format: no length, precision or member order is normalised.
//  - Known differences (`known-differences.json`) take named fields of named rows out of the
//    comparison. A row whose only differences are known is KNOWN_DIFFERENCE, never MATCH.
//  - Events are rows too: one per (client step, generation), compared on `data` and `context` the
//    same way, plus one row per client step for whether its v1 and v2 events share their event id,
//    and one row (`event-ids`) for the equality relation of all event ids across steps and
//    generations (shared within a version, distinct between versions).
//    The per-generation summary of the recorder is compared field by field (`summary:g1`, `summary:g2`).

export const STATUSES = ["MATCH", "MATCH_LAYOUT", "KNOWN_DIFFERENCE", "MISMATCH", "UNKNOWN"];

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const VERSION_KEYS = new Set(["versionNumber", "nextPageToken", "rollbackSource"]);
const HISTORY = /:listVersions$/;
const ID_KEYS = new Set(["id", "eventId"]);
const BASELINE_CASES = new Set(["a-client", "a-server"]);

/**
 * The form of an event id: a decimal int32 other than 0, anything else by length. Production's
 * ids take either sign (RC-CLOSURE-A 2026-11-25: 6 of 14 negative over two passes, e.g.
 * `-820123519`) and were never 0 (coordinator ruling 5).
 */
export function idForm(value) {
  if (typeof value !== "string") return value;
  if (
    /^-?[1-9][0-9]*$/.test(value) &&
    BigInt(value) <= 2147483647n &&
    BigInt(value) >= -2147483648n
  )
    return "id:int32";
  return `id:other:${value.length}`;
}

/**
 * An RFC 3339 UTC time as nanoseconds, whatever its fraction digits (`.120Z` and `.12Z` are one
 * instant, `.120000001Z` another; ruling 11 item 2); `null` otherwise.
 */
export function instant(text) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(text ?? "");
  if (!m) return null;
  return BigInt(Date.parse(`${m[1]}Z`)) * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0"));
}

export const namespaceOf = (path) =>
  path.includes("/namespaces/firebase-server/") ? "server" : "client";

/** The form of one value, with the version numbers of `namespace` as offsets from `base`. */
const CANONICAL = /^(?:0|[1-9][0-9]*)$/;

export function form(value, base, key = null, source = null, rule = "proto") {
  if (Array.isArray(value)) return value.map((item) => form(item, base, null, source, rule));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, form(v, base, k, source, rule)]),
    );
  if (typeof value === "string") {
    // An id member is read by idForm on both sides, so its form needs no tag.
    if (ID_KEYS.has(key)) return idForm(value);
    const time = TIME.exec(value);
    if (time) return `t:${timeForm(time[1] ?? "", rule)}:${time[2]}`;
    // The baseline version's own rollback source is the sandbox's state, not the pass's
    // behaviour: it reads as `base-source` on either side (RC-CLOSURE-A pass 2 started on a
    // rollback to 32, pass 1 on one to 27).
    if (key === "rollbackSource" && source !== null && value === source) return "v:base-source";
    if (
      VERSION_KEYS.has(key) &&
      CANONICAL.test(value) &&
      !(key === "rollbackSource" && value === "0")
    )
      return `v:${BigInt(value) - BigInt(base)}`;
    const rollback = /^Rollback to version ((?:0|[1-9][0-9]*))$/.exec(value);
    if (rollback && source !== null && rollback[1] === source) return "r:base-source";
    if (rollback) return `r:${BigInt(rollback[1]) - BigInt(base)}`;
    return `s:${embedded(value, base)}`;
  }
  return value;
}

/**
 * Whether a time's fraction is written as the field's kind requires (ruling 11 item 1): `proto` as
 * protobuf JSON writes a timestamp (REST answers and Gen2 events: no fraction, or 3, 6 or 9 digits
 * whose last group is not 000; RC-CLOSURE-A `.949`, `.193490`), `minimal` without trailing zeros
 * (Gen1 events: `.19349`). A conforming time reads `ok`, any other spelling as itself.
 */
export function timeForm(fraction, rule) {
  const fits =
    rule === "minimal"
      ? !fraction.endsWith("0")
      : fraction === "" || ([3, 6, 9].includes(fraction.length) && !fraction.endsWith("000"));
  return fits ? "ok" : `other:${fraction.length}:${fraction}`;
}

/**
 * A message with the volatile values production embeds in it: RFC 3339 times by form (the history
 * refusals echo the request's bounds and the retention edge), and the two version numbers of the
 * stale-tag refusal as offsets. Brackets that no recorded message contains mark them.
 */
function embedded(text, base) {
  return text
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d+))?Z/g,
      (_, fraction) => `\u27e8t:${timeForm(fraction ?? "", "proto")}\u27e9`,
    )
    .replace(
      /^(\[VERSION_MISMATCH\]: Expected version )((?:0|[1-9][0-9]*)), found ((?:0|[1-9][0-9]*))/,
      (_, head, expected, found) =>
        `${head}\u27e8v:${BigInt(expected) - BigInt(base)}\u27e9, found \u27e8v:${BigInt(found) - BigInt(base)}\u27e9`,
    );
}

/**
 * The entries of a defaults file production served as XML or a property list, in file order, so
 * the judge compares them like members (order, keys, values); its JSON form is a body already.
 */
export function defaultsEntries(text, contentType) {
  const pattern = /application\/xml/.test(contentType ?? "")
    ? /<entry>\s*<key>([^<]*)<\/key>\s*(?:<value>([^<]*)<\/value>|<value\/>)/g
    : /application\/x-plist/.test(contentType ?? "")
      ? /<key>([^<]*)<\/key>\s*<string>((?:<!\[CDATA\[[\s\S]*?\]\]>|[^<])*)<\/string>/g
      : null;
  if (!pattern || text === undefined || text === null) return null;
  return Object.fromEntries([...text.matchAll(pattern)].map((m) => [m[1], m[2] ?? ""]));
}

/** The form of an ETag: absent, or its prefix kind and version offset (a validation tag keeps -0). */
export function etagForm(tag, base) {
  if (tag === null || tag === undefined) return null;
  const match = /^etag-(.+)-([0-9]+)$/.exec(tag);
  if (!match) return `unrecognised:${tag.length}`;
  if (!CANONICAL.test(match[2])) return `noncanonical:${match[1].length}:${match[2]}`;
  const prefix =
    match[1] === "PROJECT_NUMBER"
      ? "project-number"
      : /^fireemu-[0-9a-f]{32}$/.test(match[1])
        ? "fireemu-hash"
        : `other:${match[1].length}`;
  return `${prefix}:${match[2] === "0" ? "0" : `version:${BigInt(match[2]) - BigInt(base)}`}`;
}

/** Differences between two decoded JSON values, with member order, as field paths. */
export function diffValues(a, b, path = "body") {
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = a.length === b.length ? [] : [`${path}:length`];
    for (let i = 0; i < Math.min(a.length, b.length); i += 1)
      out.push(...diffValues(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (isObject(a) && isObject(b)) {
    const out = [];
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    for (const k of ka) if (!Object.hasOwn(b, k)) out.push(`${path}.${k}:missing-right`);
    for (const k of kb) if (!Object.hasOwn(a, k)) out.push(`${path}.${k}:missing-left`);
    const shared = ka.filter((k) => Object.hasOwn(b, k));
    if (shared.join("\n") !== kb.filter((k) => Object.hasOwn(a, k)).join("\n"))
      out.push(`${path}:member-order`);
    for (const k of shared) out.push(...diffValues(a[k], b[k], `${path}.${k}`));
    return out;
  }
  return Object.is(a, b) ? [] : [`${path}:value`];
}

const historyProjection = (body, base) =>
  body && Array.isArray(body.versions)
    ? { ...body, versions: body.versions.filter((v) => BigInt(v.versionNumber) > BigInt(base)) }
    : body;

/** The compared projection of one answered row, given the run's baselines. */
export function projectRow(row, baseline) {
  const base = baseline[namespaceOf(row.path)].version;
  const source = baseline[namespaceOf(row.path)].source ?? null;
  const history = HISTORY.test(row.path);
  const whole = !history && !BASELINE_CASES.has(row.case);
  let body = history
    ? historyProjection(row.body, base)
    : (row.body ?? defaultsEntries(row.text, row.contentType));
  // The history projection drops older entries, so the escapes move with the entries they belong
  // to: `/versions/<i>` of the answer becomes `/versions/<j>` of the projection (ruling 5).
  let escapes = row.escapes ?? {};
  if (history && Array.isArray(row.body?.versions)) {
    const kept = new Map();
    row.body.versions.forEach((v, i) => {
      if (BigInt(v.versionNumber) > BigInt(base)) kept.set(i, kept.size);
    });
    escapes = Object.fromEntries(
      Object.entries(escapes).flatMap(([path, found]) => {
        const match = /^(name|value):\/versions\/([0-9]+)(\/.*|$)/.exec(path);
        if (!match) return [[path, found]];
        const j = kept.get(Number(match[2]));
        return j === undefined ? [] : [[`${match[1]}:/versions/${j}${match[3]}`, found]];
      }),
    );
  }
  if (BASELINE_CASES.has(row.case) && body && typeof body === "object") {
    const { version: _version, ...rest } = body;
    body = rest;
  }
  return {
    status: row.status,
    contentType: row.contentType,
    contentEncoding: row.contentEncoding,
    etag: etagForm(row.etag, base),
    // The layout lengths of a whole history or baseline answer include what the run did not write.
    skeletonBytes: whole ? row.skeletonBytes : null,
    escapes: projectedEscapes(escapes, body),
    bodyBytes: whole ? row.bodyBytes : null,
    body,
    bodyForm: form(body, base, null, source),
    // A body that is not JSON nor a defaults file is compared as its text.
    text: body === null || body === undefined ? (row.text ?? null) : null,
  };
}

/** The escapes of the fields the compared body still holds (JSON pointers, `@key` for a name). */
function projectedEscapes(escapes, body) {
  const resolves = (path) => {
    let node = body;
    for (const part of path
      .replace(/^(?:name|value):/, "")
      .split("/")
      .slice(1)) {
      const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
      if (node === null || typeof node !== "object" || !Object.hasOwn(node, key)) return false;
      node = node[key];
    }
    return true;
  };
  return Object.fromEntries(
    Object.entries(escapes)
      .filter(([path]) => resolves(path))
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

const answered = (row) => row?.phase === "response-persisted";

function compareAnswers(a, b) {
  const fields = [];
  for (const key of ["status", "contentType", "contentEncoding", "etag", "skeletonBytes", "text"])
    if (a[key] !== b[key]) fields.push(key);
  for (const path of new Set([...Object.keys(a.escapes), ...Object.keys(b.escapes)]))
    if (JSON.stringify(a.escapes[path] ?? []) !== JSON.stringify(b.escapes[path] ?? []))
      fields.push(`escapes:${path}`);
  fields.push(...diffValues(a.bodyForm, b.bodyForm));
  const layoutOnly = a.bodyBytes !== b.bodyBytes || diffValues(a.body, b.body).length > 0;
  return { fields, layoutOnly };
}

/** Rows of the events: one per (client step, generation) and one per client step for the shared id. */
export function eventRows(run) {
  // An event names its version by number and time; the time is compared as an instant, since
  // Gen1 drops trailing zeros that the version keeps (`.19349` for `.193490`).
  const at = (number, time) => `${number}|${instant(time) ?? time}`;
  const steps = new Map(run.versions.map((v) => [at(v.versionNumber, v.updateTime), v]));
  const rows = new Map();
  const ids = new Map();
  for (const event of run.events) {
    const version = steps.get(at(event.versionNumber, event.updateTime));
    if (!version) continue;
    const id = `event:${version.namespace}:${version.step}:g${event.generation}`;
    const base = run.baseline[version.namespace].version;
    const value = { data: event.data, context: event.context };
    // Gen1 writes times without trailing zeros, Gen2 as protobuf does (ruling 11 item 1).
    const rule = event.generation === 1 ? "minimal" : "proto";
    rows.set(
      id,
      rows.has(id)
        ? { duplicate: true }
        : { value, valueForm: form(value, base, null, null, rule) },
    );
    if (version.namespace === "client") {
      const key = `event-id:${version.step}`;
      ids.set(key, { ...ids.get(key), [event.generation]: event.eventId });
    }
  }
  // The equality relation of all ids: each (step, generation) by the first one with its id.
  const keyed = run.events
    .map((event) => ({ event, version: steps.get(at(event.versionNumber, event.updateTime)) }))
    .filter(({ version }) => version?.namespace === "client")
    .map(({ event, version }) => [`${version.step}:g${event.generation}`, event.eventId])
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const first = new Map();
  const relation = keyed.map(([key, id]) => {
    if (!first.has(id)) first.set(id, key);
    return [key, first.get(id)];
  });
  if (relation.length) rows.set("event-ids", { value: relation, valueForm: relation });
  for (const [key, byGeneration] of ids)
    rows.set(key, {
      value: { shared: byGeneration[1] !== undefined && byGeneration[1] === byGeneration[2] },
      valueForm: { shared: byGeneration[1] !== undefined && byGeneration[1] === byGeneration[2] },
    });
  // The delivery summary per generation, computed here from the events and the versions (the
  // recorder's own summary matched times as text, and Gen1 drops trailing zeros): the client and
  // server steps in arrival order, the steps that arrived more than once, whether the client steps
  // arrived in publication order, and every delivery that names no version of the run (an extra
  // or unexpected event is a difference, never dropped; ruling 11 item 3).
  const publication = new Map(run.versions.map((v, i) => [v, i]));
  for (const generation of [1, 2]) {
    const delivered = run.events
      .filter((event) => event.generation === generation)
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((event) => steps.get(at(event.versionNumber, event.updateTime)));
    const arrived = delivered.filter(Boolean);
    if (!delivered.length && !run.summary?.generations?.[generation]) continue;
    const seen = new Set();
    let duplicates = 0;
    for (const version of arrived) {
      if (seen.has(version)) duplicates += 1;
      seen.add(version);
    }
    const client = [...seen].filter((v) => v.namespace === "client");
    const value = {
      clientSteps: client.map((v) => v.step),
      serverSteps: [...seen].filter((v) => v.namespace === "server").map((v) => v.step),
      duplicates,
      unmatched: delivered.length - arrived.length,
      inPublicationOrder: client.every(
        (v, i) => i === 0 || publication.get(client[i - 1]) < publication.get(v),
      ),
    };
    rows.set(`summary:g${generation}`, { value, valueForm: value });
  }
  return rows;
}

function applyKnown(id, fields, known, kind) {
  const entries = known.filter(
    (entry) =>
      entry.appliesTo.includes(kind) &&
      (entry.rows.includes("*") || entry.rows.includes(id)) &&
      !(entry.exceptRows ?? []).includes(id),
  );
  // A suffix waives only a difference the comparison emitted with it (a member-order difference of
  // a body path), never an escape path, whose pointer can carry any member name (ruling 11 item 4).
  const covered = (field) =>
    entries.find(
      (entry) =>
        (entry.fields ?? []).some(
          (f) =>
            field === f ||
            field.startsWith(`${f}.`) ||
            field.startsWith(`${f}[`) ||
            field.startsWith(`${f}:`),
        ) ||
        (!field.startsWith("escapes:") &&
          (entry.fieldSuffixes ?? []).some((suffix) => field.endsWith(suffix))),
    );
  const remaining = fields.filter((field) => !covered(field));
  const used = [
    ...new Set(
      fields
        .map(covered)
        .filter(Boolean)
        .map((entry) => entry.id),
    ),
  ];
  return { remaining, used };
}

/** Compares two sanitised runs. `known` are the entries of known-differences.json. */
/** The run's baselines with each namespace's baseline rollback source, from its a-* read. */
function withSources(run) {
  const source = (caseId) =>
    run.rows.find((row) => row.case === caseId)?.body?.version?.rollbackSource ?? null;
  return {
    ...run,
    baseline: {
      client: { ...run.baseline.client, source: source("a-client") },
      server: { ...run.baseline.server, source: source("a-server") },
    },
  };
}

export function compareRuns(leftRun, rightRun, { known = [], kind }) {
  const left = withSources(leftRun);
  const right = withSources(rightRun);
  const byCase = (run) => new Map(run.rows.map((row) => [row.case, row]));
  const a = byCase(left);
  const b = byCase(right);
  const order = [...new Set([...left.rows.map((r) => r.case), ...right.rows.map((r) => r.case)])];
  const rows = [];
  for (const id of order) {
    if (RACE.includes(id)) {
      if (id === RACE[0]) rows.push(raceVerdict(left, right, known, kind));
      continue;
    }
    const ra = a.get(id);
    const rb = b.get(id);
    if (!answered(ra) || !answered(rb)) {
      rows.push({
        id,
        status: "UNKNOWN",
        reason: !ra || !rb ? "missing-row" : "unanswered",
        differences: [],
        knownDifferences: [],
      });
      continue;
    }
    const { fields, layoutOnly } = compareAnswers(
      projectRow(ra, left.baseline),
      projectRow(rb, right.baseline),
    );
    rows.push(verdict(id, fields, layoutOnly, known, kind));
  }
  const ea = eventRows(left);
  const eb = eventRows(right);
  for (const id of new Set([...ea.keys(), ...eb.keys()])) {
    const va = ea.get(id);
    const vb = eb.get(id);
    if (!va || !vb || va.duplicate || vb.duplicate) {
      rows.push({
        id,
        status: "UNKNOWN",
        reason: !va || !vb ? "missing-row" : "duplicate-event",
        differences: [],
        knownDifferences: [],
      });
      continue;
    }
    const fields = diffValues(va.valueForm, vb.valueForm, "event");
    rows.push(verdict(id, fields, diffValues(va.value, vb.value, "event").length > 0, known, kind));
  }
  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]),
  );
  return { rows, counts };
}

/**
 * The race of two concurrent publications with one tag (corpus `p7-race-a`, `p7-race-b`): which of
 * the two wins, and whether the loser is refused before or after the winner commits, depend on the
 * timing of the two requests, which no recording fixes. The pair is compared as one row: each side
 * has exactly one accepted publication, the winners are compared as answers with the label of the
 * draft ("race-a" or "race-b") as the only value taken out, and each loser is a 400 or 412
 * refusal with FAILED_PRECONDITION or INVALID_ARGUMENT (recorded on 2026-11-21: 400
 * INVALID_ARGUMENT; a sequential loser: 412 FAILED_PRECONDITION).
 */
export const RACE = ["p7-race-a", "p7-race-b"];
function raceVerdict(left, right, known, kind) {
  const id = "p7-race";
  const side = (run) => {
    const pair = RACE.map((caseId) => run.rows.find((row) => row.case === caseId));
    if (!pair.every(answered)) return null;
    const winners = pair.filter((row) => row.status === 200);
    const losers = pair.filter((row) => row.status !== 200);
    if (winners.length !== 1) return null;
    const label = winners[0].case.slice("p7-".length);
    const strip = (value) => JSON.parse(JSON.stringify(value).replaceAll(label, "race-X"));
    return { winner: { ...winners[0], body: strip(winners[0].body) }, loser: losers[0] };
  };
  const [sa, sb] = [side(left), side(right)];
  if (!sa || !sb)
    return { id, status: "UNKNOWN", reason: "race-outcome", differences: [], knownDifferences: [] };
  const fields = [];
  // The loser is one of the recorded refusals (400 INVALID_ARGUMENT, 2026-11-21; 412
  // FAILED_PRECONDITION, RC-CLOSURE-A) and both sides answer it alike: status and the whole error
  // body together (ruling 11 item 6).
  for (const loser of [sa.loser, sb.loser]) {
    const error = loser.body?.error;
    const recorded =
      (loser.status === 400 && error?.code === 400 && error?.status === "INVALID_ARGUMENT") ||
      (loser.status === 412 && error?.code === 400 && error?.status === "FAILED_PRECONDITION");
    if (!recorded) fields.push("loser");
  }
  const loser = compareAnswers(
    projectRow(sa.loser, left.baseline),
    projectRow(sb.loser, right.baseline),
  );
  fields.push(...loser.fields.map((field) => `loser.${field}`));
  const winner = compareAnswers(
    projectRow(sa.winner, left.baseline),
    projectRow(sb.winner, right.baseline),
  );
  fields.push(...winner.fields.map((field) => `winner.${field}`));
  return verdict(id, fields, winner.layoutOnly, known, kind);
}

function verdict(id, fields, layoutOnly, known, kind) {
  const { remaining, used } = applyKnown(id, fields, known, kind);
  const status = remaining.length
    ? "MISMATCH"
    : used.length
      ? "KNOWN_DIFFERENCE"
      : layoutOnly
        ? "MATCH_LAYOUT"
        : "MATCH";
  return { id, status, differences: remaining, knownDifferences: used };
}
