// The judge of the Remote Config observation: compares the rows of two sanitised runs of the same
// recorder plan (production against local fireemu, or one production run against another). Pure.
//
// Rules, fixed before any comparison was read:
//  - Rows are paired by case name. A case absent from one side, or not answered on either side,
//    is UNKNOWN, never a match and never a mismatch.
//  - Compared per answer: status, Content-Type, Content-Encoding, the ETag by form (absent, or
//    `etag-<prefix>-<version>` with the version as an offset from the run's baseline of its
//    namespace), the layout length (`skeletonBytes`, measured by the sanitiser on the raw body), the
//    count of \u escapes, and the decoded body: member names and their order, value types, and
//    values. Volatile values are compared by form only:
//      - version numbers (`versionNumber`, a non-zero `rollbackSource`, a numeric `nextPageToken`,
//        the number in "Rollback to version n") as offsets from the baseline of the row's namespace;
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
//    same way, plus one row per client step for whether its v1 and v2 events share their event id.
//    The per-generation summary of the recorder is compared field by field (`summary:g1`, `summary:g2`).

export const STATUSES = ["MATCH", "MATCH_LAYOUT", "KNOWN_DIFFERENCE", "MISMATCH", "UNKNOWN"];

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const VERSION_KEYS = new Set(["versionNumber", "nextPageToken", "rollbackSource"]);
const HISTORY = /:listVersions$/;
const ID_KEYS = new Set(["id", "eventId"]);
const BASELINE_CASES = new Set(["a-client", "a-server"]);

/** The form of an event id: a decimal int32 by sign, anything else by length. */
export function idForm(value) {
  if (typeof value !== "string") return value;
  if (/^(?:0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 2147483647n) return "id:int32-positive";
  if (/^-[1-9][0-9]*$/.test(value) && BigInt(value) >= -2147483648n) return "id:int32-negative";
  return `id:other:${value.length}`;
}

export const namespaceOf = (path) =>
  path.includes("/namespaces/firebase-server/") ? "server" : "client";

/** The form of one value, with the version numbers of `namespace` as offsets from `base`. */
export function form(value, base, key = null) {
  if (Array.isArray(value)) return value.map((item) => form(item, base));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, form(v, base, k)]));
  if (typeof value === "string") {
    if (ID_KEYS.has(key)) return idForm(value);
    const time = TIME.exec(value);
    if (time) return `time:${time[1]?.length ?? 0}:${time[2]}`;
    if (
      VERSION_KEYS.has(key) &&
      /^[0-9]+$/.test(value) &&
      !(key === "rollbackSource" && value === "0")
    )
      return `version:${BigInt(value) - BigInt(base)}`;
    const rollback = /^Rollback to version ([0-9]+)$/.exec(value);
    if (rollback) return `Rollback to version version:${BigInt(rollback[1]) - BigInt(base)}`;
  }
  return value;
}

/** The form of an ETag: absent, or its prefix kind and version offset (a validation tag keeps -0). */
export function etagForm(tag, base) {
  if (tag === null || tag === undefined) return null;
  const match = /^etag-(.+)-([0-9]+)$/.exec(tag);
  if (!match) return `unrecognised:${tag.length}`;
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
  const history = HISTORY.test(row.path);
  const whole = !history && !BASELINE_CASES.has(row.case);
  let body = history ? historyProjection(row.body, base) : row.body;
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
    unicodeEscapes: whole ? row.unicodeEscapes : null,
    bodyBytes: whole ? row.bodyBytes : null,
    body,
    bodyForm: form(body, base),
  };
}

const answered = (row) => row?.phase === "response-persisted";

function compareAnswers(a, b) {
  const fields = [];
  for (const key of [
    "status",
    "contentType",
    "contentEncoding",
    "etag",
    "skeletonBytes",
    "unicodeEscapes",
  ])
    if (a[key] !== b[key]) fields.push(key);
  fields.push(...diffValues(a.bodyForm, b.bodyForm));
  const layoutOnly = a.bodyBytes !== b.bodyBytes || diffValues(a.body, b.body).length > 0;
  return { fields, layoutOnly };
}

/** Rows of the events: one per (client step, generation) and one per client step for the shared id. */
export function eventRows(run) {
  const steps = new Map(run.versions.map((v) => [`${v.versionNumber}|${v.updateTime}`, v]));
  const rows = new Map();
  const ids = new Map();
  for (const event of run.events) {
    const version = steps.get(`${event.versionNumber}|${event.updateTime}`);
    if (!version) continue;
    const id = `event:${version.namespace}:${version.step}:g${event.generation}`;
    const base = run.baseline[version.namespace].version;
    const value = { data: event.data, context: event.context };
    rows.set(id, rows.has(id) ? { duplicate: true } : { value, valueForm: form(value, base) });
    if (version.namespace === "client") {
      const key = `event-id:${version.step}`;
      ids.set(key, { ...ids.get(key), [event.generation]: event.eventId });
    }
  }
  for (const [key, byGeneration] of ids)
    rows.set(key, {
      value: { shared: byGeneration[1] !== undefined && byGeneration[1] === byGeneration[2] },
      valueForm: { shared: byGeneration[1] !== undefined && byGeneration[1] === byGeneration[2] },
    });
  for (const generation of ["1", "2"]) {
    const summary = run.summary?.generations?.[generation];
    if (summary) {
      // The local baseline publishes deliver events too, so the counts of all and of unmatched
      // events are not compared; duplicates, steps, order and the value sets are.
      const { duplicates, events: _events, unmatched: _unmatched, ...rest } = summary;
      const value = { ...rest, duplicates: duplicates.length };
      rows.set(`summary:g${generation}`, { value, valueForm: value });
    }
  }
  return rows;
}

function applyKnown(id, fields, known, kind) {
  const entries = known.filter(
    (entry) =>
      entry.appliesTo.includes(kind) && (entry.rows.includes("*") || entry.rows.includes(id)),
  );
  const covered = (field) =>
    entries.find(
      (entry) =>
        (entry.fields ?? []).some(
          (f) =>
            field === f ||
            field.startsWith(`${f}.`) ||
            field.startsWith(`${f}[`) ||
            field.startsWith(`${f}:`),
        ) || (entry.fieldSuffixes ?? []).some((suffix) => field.endsWith(suffix)),
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
export function compareRuns(left, right, { known = [], kind }) {
  const byCase = (run) => new Map(run.rows.map((row) => [row.case, row]));
  const a = byCase(left);
  const b = byCase(right);
  const order = [...new Set([...left.rows.map((r) => r.case), ...right.rows.map((r) => r.case)])];
  const rows = [];
  for (const id of order) {
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
