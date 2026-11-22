// The configuration changes of an index-merge observation send come from its lane's index file and are created before recording and removed after it in the sandbox `(default)` database of fireemu-oracle-query.
//
//   node src/fs-query-index-merge/config.mjs status --set <set> --out <new dir> [--journal <file>]...
//   node src/fs-query-index-merge/config.mjs apply  --set <set> --out <new dir>
//   node src/fs-query-index-merge/config.mjs remove --set <set> --out <new dir> [--journal <file>]...
//   node src/fs-query-index-merge/config.mjs may-retry --set <s> --first <remove result.json> --a2 <status result.json>...
//
// `status` is read-only: which entries of the set exist (composites by the paged, database-wide
// list `collectionGroups/-/indexes`, filtered by each validated name's own group; overrides by a GET
// of their field) and the state of the operations named in earlier
// journals. `apply` requires every entry of the set to be absent, then sends one POST or PATCH per
// entry, polls the operations they return and reads every entry back. `remove` reads every entry
// of the set first and sends nothing unless every read succeeded and showed either the expected
// entry or its absence; then it deletes the composites by the names it read, resets the overrides
// with the request the FS-CONFIG-LIFECYCLE recording sent to revert one (PATCH
// ?updateMask=indexConfig, body `{}`), polls the resets and reads back. `may-retry` sends nothing:
// it says from this send's result files whether a second remove may run (attempt2Allowed).
//
// Rules (presend reviews of packet v2, coordinator ruling 3, 2026-11-19):
// - Targets are fixed here; a name read from production is used only after it matches its full
//   expected pattern (project id or the FIREEMU_SANDBOX_PROJECT_NUMBER number, `(default)`, its
//   own group). A read counts only in a shape production was recorded answering (entryState,
//   operationState); a failed, malformed or unrecorded read sends nothing.
// - A composite with a configured trailing `__name__` reads with exactly its configured fields.
// - A composite read records the trailing implicit `__name__` direction, allowing DESCENDING only when the last configured field has no order.
// - A composite list is unreadable if a resource name repeats anywhere in its pages.
// - Remove sends nothing if two entries read present as composites with the same name.
// - A journaled composite operation is unreadable in status if its target differs from the entry's present name, another entry reads present at that target, or another entry's operation claims the same target.
// - Redirects are never followed (a 3xx is unknown for a write, unreadable for a read), and the URL
//   sent is exactly the URL checked.
// - Every mutating request is sent once and classified done (2xx with a readable body), refused
//   (a definite 4xx other than 408, 429 and 499, with a readable body) or unknown (anything else).
//   An unknown create settles only on an own read showing the entry or its operation reading done;
//   absence never settles it. `remove` settles an entry's absence only against the journals of
//   the apply that created it, or of an earlier remove that removed it (--journal).
// - Bounds: a request cap per subcommand computed from the set, a wall-time cap checked before and
//   after the token, at most five pages per list, a timeout per request of 30 s or the time left, a
//   fresh token at least every 10 minutes from a gcloud call limited to 30 s; the journal
//   (journal.jsonl in --out, which must not exist yet) records every request and the counter.
// - Nothing is sent unless FIREEMU_MERGE_CONFIG_SEND has the launch script's exact value. No test
//   sets it.

import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { isMainModule } from "../fs-query-index/main-module.mjs";

export const PROJECT = "fireemu-oracle-query";
export const DATABASE = "(default)";
export const API = "https://firestore.googleapis.com/v1";
export const SEND_FLAG = "FIREEMU_MERGE_CONFIG_SEND";
export const SEND_FLAG_VALUE = "index-merge-obs-launch-v3";

const ASC = { fieldPath: "a", order: "ASCENDING" };
const A_DESC = { fieldPath: "a", order: "DESCENDING" };
const B_ASC = { fieldPath: "b", order: "ASCENDING" };
const TAGS = { fieldPath: "tags", arrayConfig: "CONTAINS" };
const NAME_DESC = { fieldPath: "__name__", order: "DESCENDING" };

/**
 * As the lane index files state them, E1 to E5 are the first observation's entries, E6 to E8 are the added overrides for observation 2a, and E9 to E16 are the entries that fs-query-index-merge3.indexes.json adds to the base for observation 2b-1.
 * E17 to E23 are the entries that fs-query-index-merge4.indexes.json adds to the base for observation 2b-2.
 * E24 to E30 are the entries that fs-query-index-merge5.indexes.json adds to the base for observation 2b-3.
 * E31 to E36 are the entries that fs-query-index-merge6.indexes.json adds to the base for observation 2b-4.
 * E37 to E43 are the entries that fs-query-index-merge7.indexes.json adds to the base for observation 2b-5.
 * E44 to E51 are the entries that fs-query-index-merge8.indexes.json adds to the base for observation 2b-6.
 */
export const ENTRIES = {
  E1: { kind: "composite", group: "imx", queryScope: "COLLECTION", fields: [ASC, TAGS] },
  E2: { kind: "composite", group: "imc", queryScope: "COLLECTION", fields: [ASC, TAGS] },
  E3: {
    kind: "override",
    group: "ima",
    field: "a",
    indexes: [{ queryScope: "COLLECTION", order: "ASCENDING" }],
  },
  E4: { kind: "override", group: "imx", field: "a", indexes: [] },
  E5: { kind: "override", group: "imx", field: "tags", indexes: [] },
  E6: {
    kind: "override",
    group: "igc",
    field: "a",
    indexes: [{ queryScope: "COLLECTION_GROUP", order: "ASCENDING" }],
  },
  E7: {
    kind: "override",
    group: "iga",
    field: "a",
    indexes: [{ queryScope: "COLLECTION_GROUP", order: "DESCENDING" }],
  },
  E8: {
    kind: "override",
    group: "iga",
    field: "tags",
    indexes: [{ queryScope: "COLLECTION_GROUP", arrayConfig: "CONTAINS" }],
  },
  E9: { kind: "composite", group: "iw2", queryScope: "COLLECTION", fields: [ASC, TAGS] },
  E10: { kind: "composite", group: "iw2", queryScope: "COLLECTION", fields: [B_ASC, TAGS] },
  E11: { kind: "override", group: "iw2", field: "a", indexes: [] },
  E12: { kind: "override", group: "iw2", field: "b", indexes: [] },
  E13: { kind: "override", group: "iw2", field: "tags", indexes: [] },
  E14: { kind: "composite", group: "it1", queryScope: "COLLECTION", fields: [ASC, TAGS] },
  E15: { kind: "override", group: "it1", field: "a", indexes: [] },
  E16: {
    kind: "override",
    group: "imd",
    field: "a",
    indexes: [{ queryScope: "COLLECTION", order: "DESCENDING" }],
  },
  E17: { kind: "composite", group: "iwd", queryScope: "COLLECTION", fields: [ASC, TAGS] },
  E18: { kind: "composite", group: "iwd", queryScope: "COLLECTION", fields: [A_DESC, TAGS] },
  E19: { kind: "override", group: "iwd", field: "a", indexes: [] },
  E20: { kind: "override", group: "iwd", field: "tags", indexes: [] },
  E21: { kind: "composite", group: "io1", queryScope: "COLLECTION", fields: [ASC, TAGS] },
  E22: { kind: "override", group: "io1", field: "a", indexes: [] },
  E23: {
    kind: "override",
    group: "io1",
    field: "tags",
    indexes: [
      { queryScope: "COLLECTION", order: "ASCENDING" },
      { queryScope: "COLLECTION", order: "DESCENDING" },
    ],
  },
  E24: { kind: "composite", group: "ig2", queryScope: "COLLECTION", fields: [ASC, TAGS] },
  E25: { kind: "override", group: "ig2", field: "a", indexes: [] },
  E26: {
    kind: "override",
    group: "ig2",
    field: "tags",
    indexes: [{ queryScope: "COLLECTION_GROUP", arrayConfig: "CONTAINS" }],
  },
  E27: { kind: "composite", group: "i2p", queryScope: "COLLECTION", fields: [ASC, B_ASC, TAGS] },
  E28: { kind: "override", group: "i2p", field: "a", indexes: [] },
  E29: { kind: "override", group: "i2p", field: "b", indexes: [] },
  E30: { kind: "override", group: "i2p", field: "tags", indexes: [] },
  E31: {
    kind: "composite",
    group: "ig1",
    queryScope: "COLLECTION_GROUP",
    fields: [ASC, NAME_DESC],
  },
  E32: { kind: "override", group: "ig1", field: "a", indexes: [] },
  E33: { kind: "composite", group: "irv", queryScope: "COLLECTION", fields: [ASC, NAME_DESC] },
  E34: { kind: "override", group: "irv", field: "a", indexes: [] },
  E35: { kind: "composite", group: "icm", queryScope: "COLLECTION", fields: [ASC, NAME_DESC] },
  E36: { kind: "override", group: "icm", field: "a", indexes: [] },
  E37: { kind: "composite", group: "igx", queryScope: "COLLECTION_GROUP", fields: [ASC, TAGS] },
  E38: { kind: "override", group: "igx", field: "a", indexes: [] },
  E39: { kind: "override", group: "igx", field: "tags", indexes: [] },
  E40: {
    kind: "override",
    group: "igx",
    field: "b",
    indexes: [
      { queryScope: "COLLECTION", order: "ASCENDING" },
      { queryScope: "COLLECTION_GROUP", order: "ASCENDING" },
    ],
  },
  E41: { kind: "composite", group: "ip1", queryScope: "COLLECTION", fields: [A_DESC, TAGS] },
  E42: { kind: "override", group: "ip1", field: "a", indexes: [] },
  E43: { kind: "override", group: "ip1", field: "tags", indexes: [] },
  E44: {
    kind: "override",
    group: "is1",
    field: "a",
    indexes: [{ queryScope: "COLLECTION", order: "ASCENDING" }],
  },
  E45: {
    kind: "override",
    group: "is1",
    field: "tags",
    indexes: [{ queryScope: "COLLECTION", arrayConfig: "CONTAINS" }],
  },
  E46: {
    kind: "override",
    group: "is2",
    field: "a",
    indexes: [{ queryScope: "COLLECTION", order: "DESCENDING" }],
  },
  E47: {
    kind: "override",
    group: "is2",
    field: "tags",
    indexes: [{ queryScope: "COLLECTION", arrayConfig: "CONTAINS" }],
  },
  E48: { kind: "composite", group: "igy", queryScope: "COLLECTION_GROUP", fields: [ASC, TAGS] },
  E49: { kind: "override", group: "igy", field: "a", indexes: [] },
  E50: { kind: "override", group: "igy", field: "tags", indexes: [] },
  E51: {
    kind: "override",
    group: "igy",
    field: "b",
    indexes: [
      { queryScope: "COLLECTION", order: "ASCENDING" },
      { queryScope: "COLLECTION_GROUP", order: "ASCENDING" },
    ],
  },
};

/**
 * The first observation uses `f2` (E3), `f1` (composites and exemptions) or `all` (both), observation 2a uses `obs2a` (`all` plus the group-scope overrides in `g`), and observation 2b-1 uses `obs2b1` (the additions in fs-query-index-merge3.indexes.json).
 * Observation 2b-2 uses `obs2b2`, starting with the ordered-only tags override.
 * Observation 2b-3 uses `obs2b3`, starting with the group-scope contains override.
 * Observation 2b-4 uses `obs2b4`, starting with the three explicit-name composites.
 * Observation 2b-5 uses `obs2b5`, starting with the ascending b override at both scopes.
 * Observation 2b-6 uses `obs2b6`, starting with the ascending b override at both scopes on igy.
 */
export const SETS = {
  f2: ["E3"],
  f1: ["E1", "E2", "E4", "E5"],
  all: ["E3", "E1", "E2", "E4", "E5"],
  g: ["E6", "E7", "E8"],
  obs2a: ["E3", "E1", "E2", "E4", "E5", "E6", "E7", "E8"],
  obs2b1: ["E16", "E9", "E10", "E14", "E11", "E12", "E13", "E15"],
  obs2b2: ["E23", "E17", "E18", "E21", "E19", "E20", "E22"],
  obs2b3: ["E26", "E24", "E27", "E25", "E28", "E29", "E30"],
  obs2b4: ["E31", "E33", "E35", "E32", "E34", "E36"],
  obs2b5: ["E40", "E37", "E41", "E38", "E39", "E42", "E43"],
  obs2b6: ["E51", "E48", "E44", "E45", "E46", "E47", "E49", "E50"],
};

export const POLL_ROUNDS = 40;
export const POLL_INTERVAL_MS = 15_000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const TOKEN_MAX_AGE_MS = 10 * 60_000;
export const WALL_MS = { status: 5 * 60_000, apply: 20 * 60_000, remove: 20 * 60_000 };
/** Operations an earlier journal may name that `status` reads once each. */
export const STATUS_MAX_OPERATIONS = 5;
/** Pages one composite list may take, as the base runner's productionIndexes allows. */
export const MAX_LIST_PAGES = 5;
/** The least time between the last request of a send step and its A2 read. */
export const A2_DELAY_MS = 10 * 60_000;

const databasePath = `projects/${PROJECT}/databases/${DATABASE}`;
const groupPath = (group) => `${databasePath}/collectionGroups/${group}`;
/** Where a composite is created: its own group (CreateIndex needs the parent group). */
export const indexListUrl = (group) => `${API}/${groupPath(group)}/indexes`;
/**
 * Where composites are read: the database-wide list with the `-` group, as the base lane's
 * verify-indexes (run.mjs productionIndexes) and firebase-tools list them. Production ignores the
 * group of a list path anyway: the send of packet v5.1 (2026-11-19) asked
 * `.../collectionGroups/imx/indexes` and got all 24 composites of the database in one page.
 */
export const indexReadUrl = `${API}/${groupPath("-")}/indexes`;
export const fieldUrl = (entry) => `${API}/${groupPath(entry.group)}/fields/${entry.field}`;

/**
 * The request cap of a subcommand for a set: every read, write and poll it may send, fixed before
 * the first request (status: one read per entry and at most STATUS_MAX_OPERATIONS operation reads).
 */
export function requestCap(command, set) {
  const n = SETS[set].length;
  const resets = SETS[set].filter((id) => ENTRIES[id].kind === "override").length;
  // One read of the set: a field GET per override, up to MAX_LIST_PAGES list pages per composite.
  const read = SETS[set].reduce(
    (sum, id) => sum + (ENTRIES[id].kind === "composite" ? MAX_LIST_PAGES : 1),
    0,
  );
  if (command === "status") return read + STATUS_MAX_OPERATIONS;
  if (command === "apply") return read + n + POLL_ROUNDS * n + read;
  if (command === "remove") return read + n + POLL_ROUNDS * resets + read;
  throw new Error(`unknown command ${command}`);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The project forms a name may carry: the id, and the sandbox number when it is given. */
export function projectForms(env = process.env) {
  const number = env.FIREEMU_SANDBOX_PROJECT_NUMBER ?? "";
  return /^[1-9]\d{5,}$/.test(number) ? [PROJECT, number] : [PROJECT];
}

const namePattern = (forms, tail) =>
  new RegExp(`^projects/(?:${forms.map(escape).join("|")})/databases/\\(default\\)/${tail}$`);
export const indexNamePattern = (forms, group) =>
  namePattern(forms, `collectionGroups/${escape(group)}/indexes/[A-Za-z0-9_-]+`);
/** An index of this project and database in any group. */
export const anyIndexNamePattern = (forms) =>
  namePattern(forms, "collectionGroups/([A-Za-z0-9_-]+)/indexes/[A-Za-z0-9_-]+");
export const fieldNamePattern = (forms, group, field) =>
  namePattern(forms, `collectionGroups/${escape(group)}/fields/${escape(field)}`);
export const operationNamePattern = (forms) => namePattern(forms, "operations/[A-Za-z0-9_-]+");

/** The POST body of a composite and the PATCH of an override, as firebase-tools 15.28.2 sends them. */
export function createRequest(entry) {
  if (entry.kind === "composite")
    return {
      method: "POST",
      url: indexListUrl(entry.group),
      body: { fields: entry.fields, queryScope: entry.queryScope },
    };
  return {
    method: "PATCH",
    url: `${fieldUrl(entry)}?updateMask=indexConfig`,
    body: {
      indexConfig: {
        indexes: entry.indexes.map((index) => ({
          queryScope: index.queryScope,
          fields: [
            {
              fieldPath: entry.field,
              ...(index.order ? { order: index.order } : {}),
              ...(index.arrayConfig ? { arrayConfig: index.arrayConfig } : {}),
            },
          ],
        })),
      },
    },
  };
}

/** What a mutating answer settles: `done`, `refused` or `unknown` (see the header). */
export function classify(answer) {
  if (!answer || answer.error !== undefined || !Number.isInteger(answer.status)) return "unknown";
  if (answer.json === undefined) return "unknown";
  if (answer.status >= 200 && answer.status < 300) return "done";
  if (answer.status >= 400 && answer.status < 500 && ![408, 429, 499].includes(answer.status))
    return "refused";
  return "unknown";
}

const readOk = (answer) => answer?.status === 200 && answer.json !== undefined && !answer.error;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (object, allowed) => Object.keys(object).every((key) => allowed.includes(key));
/** An object's JSON with sorted keys, so key order never decides equality. */
const canonical = (object) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(object).toSorted(([a], [b]) => a.localeCompare(b))),
  );
export const ancestorPattern = (forms) =>
  namePattern(forms, "collectionGroups/__default__/fields/\\*");

export const INDEX_META = "type.googleapis.com/google.firestore.admin.v1.IndexOperationMetadata";
export const FIELD_META = "type.googleapis.com/google.firestore.admin.v1.FieldOperationMetadata";

/**
 * The shapes production was recorded answering (conformance/fs-config-lifecycle-production.json,
 * program fs-config/field/index-config/exemption, and the composite lists of FS-CONFIG-LIFECYCLE):
 * a composite is {name, queryScope, fields, state, density SPARSE_ALL}; a field is {name,
 * indexConfig} whose indexConfig is {ancestorField, indexes?, usesAncestorConfig?} (proto3 JSON
 * omits a false usesAncestorConfig and an empty indexes list, so an exemption reads
 * {ancestorField} only); a single-field mode is {fields: [one {fieldPath, order} or {fieldPath,
 * arrayConfig}], queryScope, state}. Anything else is `unexpected`.
 */
const COMPOSITE_KEYS = ["name", "queryScope", "fields", "state", "density"];
const FIELD_KEYS = ["name", "indexConfig"];
const INDEX_CONFIG_KEYS = ["ancestorField", "indexes", "usesAncestorConfig"];
const MODE_KEYS = ["fields", "queryScope", "state"];
const OPERATION_KEYS = ["name", "metadata", "done", "response", "error"];
/**
 * The metadata keys of each operation type: the ones recorded in fs-config-lifecycle-production.json
 * (IndexOperationMetadata: index, state, startTime, endTime, progressDocuments; FieldOperationMetadata:
 * also indexConfigDeltas and ttlConfigDelta) and progressBytes, which both messages define (Firestore
 * Admin API v1) and the recording shows on its bulk operations.
 */
const METADATA_KEYS = {
  [INDEX_META]: [
    "@type",
    "index",
    "state",
    "startTime",
    "endTime",
    "progressDocuments",
    "progressBytes",
  ],
  [FIELD_META]: [
    "@type",
    "field",
    "state",
    "startTime",
    "endTime",
    "indexConfigDeltas",
    "progressDocuments",
    "progressBytes",
    "ttlConfigDelta",
  ],
};

/** A listed composite must match the scope, configured fields and permitted `__name__` suffix. */
export function compositeMatches(index, entry) {
  const last = entry.fields.at(-1);
  const explicitName = last?.fieldPath === "__name__";
  if (
    index?.queryScope !== entry.queryScope ||
    !Array.isArray(index.fields) ||
    index.fields.length !== entry.fields.length + (explicitName ? 0 : 1)
  )
    return false;
  const order =
    last && !Object.hasOwn(last, "order") && index.fields.at(-1)?.order === "DESCENDING"
      ? "DESCENDING"
      : "ASCENDING";
  const expected = explicitName
    ? entry.fields
    : [...entry.fields, { fieldPath: "__name__", order }];
  return index.fields.every(
    (field, i) => isObject(field) && canonical(field) === canonical(expected[i]),
  );
}

/** One single-field mode in the entry's form, or undefined when it is not a recorded shape. */
function modeOf(index, fieldPath) {
  if (!isObject(index) || !onlyKeys(index, MODE_KEYS)) return undefined;
  if (!["COLLECTION", "COLLECTION_GROUP"].includes(index.queryScope)) return undefined;
  if (index.state !== undefined && typeof index.state !== "string") return undefined;
  if (!Array.isArray(index.fields) || index.fields.length !== 1) return undefined;
  const [field] = index.fields;
  if (!isObject(field) || field.fieldPath !== fieldPath) return undefined;
  const keys = Object.keys(field).toSorted().join(",");
  if (keys === "fieldPath,order" && ["ASCENDING", "DESCENDING"].includes(field.order))
    return { queryScope: index.queryScope, order: field.order };
  if (keys === "arrayConfig,fieldPath" && field.arrayConfig === "CONTAINS")
    return { queryScope: index.queryScope, arrayConfig: "CONTAINS" };
  return undefined;
}

const unexpected = (reason) => ({ state: "unexpected", reason });

function compositeState(entry, body, forms) {
  if (typeof body.invalidPage === "string") return unexpected(body.invalidPage);
  if (body.nextPageToken !== undefined) return unexpected("more than one page");
  if (!onlyKeys(body, ["indexes"])) return unexpected("unknown list keys");
  // Absent means none (proto3 JSON omits an empty list); present must be an array.
  if (Object.hasOwn(body, "indexes") && !Array.isArray(body.indexes))
    return unexpected("malformed list");
  const listed = Object.hasOwn(body, "indexes") ? body.indexes : [];
  // Each listed name must belong to this project and database, and only indexes of the entry's group are matched against its siblings.
  const own = [];
  for (const index of listed) {
    if (!isObject(index) || !onlyKeys(index, COMPOSITE_KEYS))
      return unexpected("unknown index keys");
    const group =
      typeof index.name === "string" ? anyIndexNamePattern(forms).exec(index.name)?.[1] : undefined;
    if (group === undefined) return unexpected("index name outside the expected pattern");
    if (group === entry.group) own.push(index);
  }
  const siblings = Object.values(ENTRIES).filter(
    (e) => e.kind === "composite" && e.group === entry.group,
  );
  const matches = [];
  for (const index of own) {
    if (index.density !== undefined && index.density !== "SPARSE_ALL")
      return unexpected("index density differs");
    if (typeof index.state !== "string") return unexpected("index without a state");
    const matched = siblings.filter((sibling) => compositeMatches(index, sibling));
    if (matched.length === 0) return unexpected(`an index of ${entry.group} matches no entry`);
    if (matched.length > 1) return unexpected(`an index of ${entry.group} matches two entries`);
    if (compositeMatches(index, entry)) matches.push(index);
  }
  if (matches.length === 0) return { state: "absent" };
  if (matches.length > 1) return unexpected(`${matches.length} indexes match the entry`);
  const [index] = matches;
  return {
    state: "present",
    name: index.name,
    ready: index.state === "READY",
    ...(entry.fields.at(-1)?.fieldPath === "__name__"
      ? {}
      : { implicitName: index.fields.at(-1).order }),
  };
}

function fieldState(entry, body, forms) {
  if (body.ttlConfig !== undefined) return unexpected("the field has a TTL");
  if (!onlyKeys(body, FIELD_KEYS)) return unexpected("unknown field keys");
  if (
    typeof body.name !== "string" ||
    !fieldNamePattern(forms, entry.group, entry.field).test(body.name)
  )
    return unexpected("field name outside the expected pattern");
  const config = body.indexConfig;
  if (!isObject(config) || !onlyKeys(config, INDEX_CONFIG_KEYS))
    return unexpected("malformed indexConfig");
  if (
    typeof config.ancestorField !== "string" ||
    !ancestorPattern(forms).test(config.ancestorField)
  )
    return unexpected("ancestor field outside the expected pattern");
  if (![undefined, true, false].includes(config.usesAncestorConfig))
    return unexpected("malformed usesAncestorConfig");
  if (Object.hasOwn(config, "indexes") && !Array.isArray(config.indexes))
    return unexpected("malformed indexes");
  const listed = Object.hasOwn(config, "indexes") ? config.indexes : [];
  const modes = listed.map((index) => modeOf(index, entry.field));
  if (modes.includes(undefined)) return unexpected("a mode outside the recorded shape");
  if (config.usesAncestorConfig === true) return { state: "absent" };
  const sort = (list) => list.map((m) => canonical(m)).toSorted();
  if (!same(sort(modes), sort(entry.indexes)))
    return unexpected("the override differs from the entry");
  const ready = listed.every((index) => index.state === "READY");
  return { state: "present", name: body.name, ready };
}

/**
 * One entry's state from its read: `absent`, `present` (with `name` and `ready`), or `unexpected`
 * (with a reason). A read that failed (anything but a 200 with a JSON object) is `unreadable`.
 */
export function entryState(entry, answer, forms) {
  if (typeof answer?.unreadable === "string")
    return { state: "unreadable", reason: answer.unreadable };
  if (!readOk(answer)) return { state: "unreadable", reason: `read answered ${answer?.status}` };
  if (!isObject(answer.json)) return unexpected("the body is not an object");
  return entry.kind === "composite"
    ? compositeState(entry, answer.json, forms)
    : fieldState(entry, answer.json, forms);
}

/** Thrown when a cap would be exceeded; the request is not sent. */
export class BudgetExceeded extends Error {}

/**
 * The request layer of one subcommand: counts and journals every request, enforces the request and
 * wall-time caps and keeps the token fresh. `http` sends one request ({method, url, body, token})
 * and resolves to {status, json} or {error}; `token` resolves to an access token.
 */
export function createSession({ http, token, cap, wallMs, now = Date.now, journal = () => {} }) {
  const started = now();
  let sent = 0;
  let current;
  let fetchedAt = -Infinity;
  async function freshToken() {
    if (current === undefined || now() - fetchedAt >= TOKEN_MAX_AGE_MS) {
      current = await token();
      fetchedAt = now();
    }
    return current;
  }
  /** The wall time left, or BudgetExceeded when none is. */
  function timeLeft(method, url) {
    const left = wallMs - (now() - started);
    if (left <= 0)
      throw new BudgetExceeded(`wall time ${wallMs} ms reached before ${method} ${url}`);
    return left;
  }
  async function send(phase, { method, url, body }) {
    if (sent >= cap) throw new BudgetExceeded(`request cap ${cap} reached before ${method} ${url}`);
    timeLeft(method, url);
    const bearer = await freshToken();
    // Checked again after the token: the request goes out only inside the budget, and its
    // timeout never reaches past it.
    const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, timeLeft(method, url));
    sent += 1;
    let answer;
    try {
      answer = await http({ method, url, body, token: bearer, timeoutMs });
    } catch (error) {
      answer = { error: String(error?.message ?? error) };
    }
    await journal({
      seq: sent,
      phase,
      method,
      url,
      timeoutMs,
      ...(body === undefined ? {} : { body }),
      status: answer.status,
      ...(answer.error ? { error: answer.error } : {}),
      ...(answer.json === undefined ? {} : { json: answer.json }),
    });
    return answer;
  }
  return {
    send,
    get sent() {
      return sent;
    },
    cap,
  };
}

/** A query value encoded so that the URL parser keeps it byte for byte (the href check holds). */
const encodeQueryValue = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
/** A page of the database-wide list: the fixed URL, and the token only as its one query parameter. */
export const pageUrl = (token) =>
  token === undefined ? indexReadUrl : `${indexReadUrl}?pageToken=${encodeQueryValue(token)}`;

/**
 * Reads the database-wide composite list, following nextPageToken as the base runner does, up to
 * MAX_LIST_PAGES pages. Returns the answer entryState reads: the union of every page's indexes, or
 * the first page that is not a readable page in the recorded shape. A page must be a JSON object
 * with keys only `indexes` (absent or an array) and `nextPageToken` (a non-empty string not seen
 * before); a further page past the cap, or anything else, makes the read unexpected.
 */
export async function readCompositeList(session, phase) {
  const union = [];
  const seen = new Set();
  let token;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const answer = await session.send(phase, { method: "GET", url: pageUrl(token) });
    if (!readOk(answer)) return answer;
    const body = answer.json;
    const bad = (reason) => ({ status: 200, json: { indexes: [], invalidPage: reason } });
    if (!isObject(body) || !onlyKeys(body, ["indexes", "nextPageToken"]))
      return bad("a page outside the recorded shape");
    if (Object.hasOwn(body, "indexes") && !Array.isArray(body.indexes))
      return bad("malformed list");
    union.push(...(Object.hasOwn(body, "indexes") ? body.indexes : []));
    if (!Object.hasOwn(body, "nextPageToken")) {
      const names = union.map((index) => index?.name).filter((name) => typeof name === "string");
      if (new Set(names).size !== names.length)
        return { unreadable: "a resource name repeats in the list" };
      return { status: 200, json: { indexes: union } };
    }
    token = body.nextPageToken;
    if (typeof token !== "string" || token === "" || seen.has(token))
      return bad("a page token that is not a new non-empty string");
    seen.add(token);
  }
  return { status: 200, json: { indexes: [], invalidPage: `more than ${MAX_LIST_PAGES} pages` } };
}

/** Reads every entry of the set; the states keyed by entry id. */
export async function readStates(session, phase, ids, forms) {
  const states = {};
  for (const id of ids) {
    const entry = ENTRIES[id];
    const answer =
      entry.kind === "composite"
        ? await readCompositeList(session, phase)
        : await session.send(phase, { method: "GET", url: fieldUrl(entry) });
    states[id] = entryState(entry, answer, forms);
  }
  return states;
}

/** The entry an operation key names (`E3`, or `apply:E3` from a journal). */
const entryOfKey = (key) => ENTRIES[String(key).split(":").pop()];

/**
 * An operation answer for an entry: `done` (done with a response), `failed` (done with an error),
 * `running` (not done, neither), or `unreadable`: not a 200 JSON object in the recorded shape
 * ({name, metadata, done?, response?, error?}), another name, or metadata of another type or
 * target: the metadata must name exactly `target`, the index or field the create or reset answer
 * named, which must itself be of the entry's group or field.
 */
export function operationState(answer, name, forms, entry, target) {
  // An answer of any shape is classified, never thrown on: a value that cannot become a string
  // (a JSON object with a `toString` key, say) is unreadable for this entry only.
  try {
    return operationStateOf(answer, name, forms, entry, target);
  } catch {
    return "unreadable";
  }
}

function operationStateOf(answer, name, forms, entry, target) {
  if (!readOk(answer) || !isObject(answer.json) || !entry || typeof target !== "string")
    return "unreadable";
  const op = answer.json;
  if (!onlyKeys(op, OPERATION_KEYS)) return "unreadable";
  if (op.name !== name || !operationNamePattern(forms).test(name)) return "unreadable";
  const meta = op.metadata;
  if (!isObject(meta) || typeof meta["@type"] !== "string") return "unreadable";
  if (!Object.hasOwn(METADATA_KEYS, meta["@type"])) return "unreadable";
  if (!onlyKeys(meta, METADATA_KEYS[meta["@type"]])) return "unreadable";
  // The operation must name exactly the index or field its create or reset answer named.
  const named =
    entry.kind === "composite"
      ? meta["@type"] === INDEX_META &&
        meta.index === target &&
        indexNamePattern(forms, entry.group).test(target)
      : meta["@type"] === FIELD_META &&
        meta.field === target &&
        fieldNamePattern(forms, entry.group, entry.field).test(target);
  if (!named) return "unreadable";
  if (op.done === undefined)
    return op.response === undefined && op.error === undefined ? "running" : "unreadable";
  if (op.done !== true) return "unreadable";
  if (isObject(op.error) && op.response === undefined) return "failed";
  if (isObject(op.response) && op.error === undefined) return "done";
  return "unreadable";
}

/**
 * Polls operations, all of them once per round, until every one is settled or POLL_ROUNDS rounds
 * have run. Only names that match the operation pattern are polled; one unreadable answer ends the
 * polling of that operation.
 */
export async function pollOperations(session, operations, forms, sleep) {
  const states = Object.fromEntries(Object.keys(operations).map((id) => [id, "running"]));
  for (let round = 0; round < POLL_ROUNDS; round += 1) {
    const open = Object.keys(operations).filter((id) => states[id] === "running");
    if (open.length === 0) break;
    if (round > 0) await sleep(POLL_INTERVAL_MS);
    for (const id of open) {
      const { name, target } = operations[id];
      const answer = await session.send("poll", { method: "GET", url: `${API}/${name}` });
      states[id] = operationState(answer, name, forms, entryOfKey(id), target);
    }
  }
  return states;
}

/**
 * The operation of a done create or reset and the exact index or field it names, when the answer is
 * a readable operation of the entry; polls must then name that same target.
 */
function operationOf(answer, forms, entry) {
  const name = answer?.json?.name;
  const meta = answer?.json?.metadata;
  const target = entry.kind === "composite" ? meta?.index : meta?.field;
  if (typeof name !== "string" || typeof target !== "string") return undefined;
  return operationState(answer, name, forms, entry, target) === "unreadable"
    ? undefined
    : { name, target };
}

/**
 * Whether a create or reset answer carries an operation whose classification cannot even be
 * attempted: its metadata type is not a string, or reading it throws. The writes stop there
 * (no further mutating request in the run), as they did before the poll path learned to treat
 * such a body as unreadable for its entry (coordinator ruling 9).
 */
export function unclassifiable(answer) {
  try {
    const meta = answer?.json?.metadata;
    if (!isObject(meta) || !Object.hasOwn(meta, "@type")) return false;
    return typeof meta["@type"] !== "string";
  } catch {
    return true;
  }
}

/**
 * Whether a create or reset answer lets the writes go on, only when it is positively classified:
 * not `unclassifiable`, and either refused (a 4xx that is not a timeout or rate limit) or done as
 * a readable operation of its entry in one of the known operation types (`operation`, from
 * `operationOf`). Anything else stops the writes: an unknown answer (no status, a transport
 * error, a 5xx, an empty or non-JSON body), or a done one with another or an unknown metadata
 * type, no metadata or another target (coordinator rulings 10 and 12).
 */
export function accepted(answer, operation) {
  if (unclassifiable(answer)) return false;
  const verdict = classify(answer);
  return verdict === "refused" || (verdict === "done" && operation !== undefined);
}

/**
 * apply: every entry of the set must read absent; then one create per entry, in the set's order,
 * stopping at the first answer that is not done; polls; reads back. Each entry ends as `created`
 * (done or unknown write, then its operation done or an own read showing it), `not-created` (its
 * write refused and an own read showing it absent), `not-sent`, or `open` (anything else: A2).
 */
export async function apply({ session, set, forms, sleep }) {
  const ids = SETS[set];
  const before = await readStates(session, "before", ids, forms);
  const blocked = ids.filter((id) => before[id].state !== "absent");
  if (blocked.length)
    return { ok: false, refusedBeforeSending: true, before, entries: {}, sent: session.sent };
  const writes = {};
  const operations = {};
  for (const id of ids) {
    if (Object.values(writes).some((w) => w.class !== "done" || w.unclassified)) {
      writes[id] = { class: "not-sent" };
      continue;
    }
    const answer = await session.send("create", createRequest(ENTRIES[id]));
    const operation = operationOf(answer, forms, ENTRIES[id]);
    writes[id] = {
      class: classify(answer),
      status: answer.status,
      ...(operation ? { operation: operation.name, target: operation.target } : {}),
      ...(accepted(answer, operation) ? {} : { unclassified: true }),
    };
    if (operation) operations[id] = operation;
  }
  const polled = await pollOperations(session, operations, forms, sleep);
  const after = await readStates(session, "after", ids, forms);
  const entries = {};
  for (const id of ids) {
    const write = writes[id];
    const read = after[id];
    let outcome = "open";
    if (write.class === "not-sent" && read.state === "absent") outcome = "not-sent";
    else if (write.class === "refused" && read.state === "absent") outcome = "not-created";
    else if (
      read.state === "present" &&
      read.ready &&
      polled[id] === "done" &&
      (ENTRIES[id].kind === "override" || read.name === write.target)
    )
      outcome = "created";
    // Without an operation of its own, only a composite's READY read shows it in effect; an
    // override (an exemption has no index state at all) stays pending.
    else if (read.state === "present" && read.ready && polled[id] === undefined)
      outcome = ENTRIES[id].kind === "composite" ? "created" : "created-pending";
    else if (read.state === "present" && read.ready && polled[id] !== "failed")
      outcome = "created-pending";
    else if (read.state === "present") outcome = "created-not-ready";
    entries[id] = { write, operation: polled[id], read, outcome };
  }
  const ok = ids.every((id) => entries[id].outcome === "created");
  return { ok, before, entries, sent: session.sent };
}

/** The outcome an apply journal gave each entry (the last apply that names it wins). */
export function applyOutcomes(results) {
  const outcomes = {};
  for (const result of results)
    for (const [id, entry] of Object.entries(result.entries ?? {})) outcomes[id] = entry.outcome;
  return outcomes;
}

/**
 * remove: reads every entry first; sends nothing unless every read is `absent` or `present`.
 * Deletes the present composites by the names read, resets the present overrides, polls the
 * resets, reads back. An entry is `closed` when it reads absent at the end and either this run
 * removed it (own DELETE or reset done, then absent) or the apply's own answers show it was never
 * created (`not-created`, `not-sent`), or an earlier remove closed it
 * (its journal). Everything else is `open` (A2).
 */
export async function remove({ session, set, forms, sleep, applied = {}, removed = [] }) {
  const ids = SETS[set];
  const before = await readStates(session, "before", ids, forms);
  const names = ids
    .filter((id) => ENTRIES[id].kind === "composite" && before[id].state === "present")
    .map((id) => before[id].name);
  if (new Set(names).size !== names.length)
    return {
      ok: false,
      refusedBeforeSending: true,
      reason: "two entries read the same index name",
      before,
      entries: {},
      sent: session.sent,
    };
  const blocked = ids.filter((id) => !["absent", "present"].includes(before[id].state));
  if (blocked.length)
    return { ok: false, refusedBeforeSending: true, before, entries: {}, sent: session.sent };
  const writes = {};
  const operations = {};
  for (const id of ids) {
    if (before[id].state !== "present") continue;
    if (Object.values(writes).some((w) => w.unclassified)) {
      writes[id] = { class: "not-sent" };
      continue;
    }
    const entry = ENTRIES[id];
    const request =
      entry.kind === "composite"
        ? { method: "DELETE", url: `${API}/${before[id].name}` }
        : { method: "PATCH", url: `${fieldUrl(entry)}?updateMask=indexConfig`, body: {} };
    const answer = await session.send("remove", request);
    const operation = entry.kind === "override" ? operationOf(answer, forms, entry) : undefined;
    writes[id] = {
      class: classify(answer),
      status: answer.status,
      ...(operation ? { operation: operation.name, target: operation.target } : {}),
      // A composite DELETE answers no operation; a reset must answer a readable one.
      ...((entry.kind === "override" ? accepted(answer, operation) : !unclassifiable(answer))
        ? {}
        : { unclassified: true }),
    };
    if (operation) operations[id] = operation;
  }
  const polled = await pollOperations(session, operations, forms, sleep);
  const after = await readStates(session, "after", ids, forms);
  const entries = {};
  for (const id of ids) {
    const write = writes[id];
    const absent = after[id].state === "absent";
    const removedHere =
      write?.class === "done" && (ENTRIES[id].kind === "composite" || polled[id] === "done");
    const neverCreated = ["not-created", "not-sent"].includes(applied[id]);
    const removedEarlier = removed.includes(id);
    const outcome =
      absent && (removedHere || (!write && (neverCreated || removedEarlier))) ? "closed" : "open";
    entries[id] = { before: before[id], write, operation: polled[id], after: after[id], outcome };
  }
  const ok = ids.every((id) => entries[id].outcome === "closed");
  return { ok, before, entries, sent: session.sent };
}

/** status: the entries' states, and one read of each operation named in earlier journals. */
export async function status({ session, set, forms, operations = {} }) {
  const ids = SETS[set];
  const states = await readStates(session, "status", ids, forms);
  const journaled = Object.entries(operations);
  const polled = {};
  for (const [id, { name, target }] of journaled.slice(0, STATUS_MAX_OPERATIONS)) {
    if (typeof name !== "string" || !operationNamePattern(forms).test(name)) {
      polled[id] = "unreadable";
      continue;
    }
    polled[id] = operationState(
      await session.send("status", { method: "GET", url: `${API}/${name}` }),
      name,
      forms,
      entryOfKey(id),
      target,
    );
  }
  // Journal targets can conflict even when the operation read cap excludes one of them.
  for (const [id, { target }] of journaled) {
    const entry = entryOfKey(id);
    if (entry?.kind !== "composite") continue;
    const entryId = id.split(":").pop();
    const state = states[entryId];
    if (
      (state?.state === "present" && target !== state.name) ||
      ids.some(
        (otherId) =>
          otherId !== entryId &&
          states[otherId].state === "present" &&
          states[otherId].name === target,
      ) ||
      (typeof target === "string" &&
        journaled.some(([otherId, other]) => {
          const otherEntry = entryOfKey(otherId);
          return other.target === target && otherEntry && otherEntry !== entry;
        }))
    )
      polled[id] = "unreadable";
  }
  const ok = ids.every((id) => states[id].state === "absent" || states[id].state === "present");
  // `baseline`: none of the set exists; `applied`: all of it exists and is READY.
  const baseline = ok && ids.every((id) => states[id].state === "absent");
  const applied = ids.every((id) => states[id].state === "present" && states[id].ready);
  return { ok, baseline, applied, states, operations: polled, sent: session.sent };
}

/** The operation names and apply outcomes in journals of earlier runs (their result lines). */
export function fromJournals(texts) {
  const results = [];
  for (const text of texts)
    for (const line of text.split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.result) results.push(row.result);
    }
  const operations = {};
  for (const result of results)
    for (const [id, entry] of Object.entries(result.entries ?? {})) {
      const name = entry.write?.operation;
      if (name) operations[`${result.command}:${id}`] = { name, target: entry.write.target };
    }
  return {
    operations,
    applied: applyOutcomes(results.filter((r) => r.command === "apply")),
    // Entries an earlier remove closed (its own DELETE or reset done, then read absent).
    removed: [
      ...new Set(
        results
          .filter((r) => r.command === "remove")
          .flatMap((r) => Object.entries(r.entries ?? {}))
          .filter(([, entry]) => entry.outcome === "closed")
          .map(([id]) => id),
      ),
    ],
  };
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["status", "apply", "remove", "may-retry"].includes(command))
    throw new Error("usage: status|apply|remove|may-retry");
  const args = { command, journals: [], a2: [] };
  for (let i = 0; i < rest.length; i += 2) {
    const [key, value] = [rest[i], rest[i + 1]];
    if (value === undefined) throw new Error(`${key} needs a value`);
    if (key === "--set") args.set = value;
    else if (key === "--out") args.out = value;
    else if (key === "--journal") args.journals.push(value);
    else if (key === "--first" && command === "may-retry") args.first = value;
    else if (key === "--a2" && command === "may-retry") args.a2.push(value);
    else throw new Error(`unknown argument ${key}`);
  }
  if (!Object.hasOwn(SETS, args.set ?? ""))
    throw new Error(`--set must be one of ${Object.keys(SETS).join(", ")}`);
  if (command === "may-retry") {
    if (!args.first || args.out || args.journals.length)
      throw new Error("may-retry takes --set, --first and --a2 only");
    return args;
  }
  if (!args.out) throw new Error("--out is required");
  if (command === "apply" && args.journals.length) throw new Error("apply takes no --journal");
  return args;
}

/** The production request layer: fetch with the ADC token, the quota project and a timeout. */
export function productionHttp(env = process.env, fetchImpl = fetch) {
  if (env[SEND_FLAG] !== SEND_FLAG_VALUE)
    throw new Error(`refusing to send: ${SEND_FLAG} is not the launch script's value`);
  const allowed = namePattern(projectForms(env), "[^\\s#]+");
  return async ({ method, url, body, token, timeoutMs = REQUEST_TIMEOUT_MS }) => {
    // The URL sent is the URL checked: one that the URL parser would rewrite (dot segments,
    // an explicit port, credentials) is refused, and the name pattern admits no fragment, and redirects are never followed.
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      parsed = undefined;
    }
    if (
      !parsed ||
      parsed.href !== url ||
      !url.startsWith(`${API}/`) ||
      !allowed.test(url.slice(API.length + 1))
    )
      throw new Error(`refusing a request outside ${PROJECT}/${DATABASE}: ${url}`);
    const response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "x-goog-user-project": PROJECT,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, json, bytes: Buffer.byteLength(text) };
  };
}

const execFileAsync = promisify(execFile);
/** The owner's ADC access token, from gcloud, which must answer within 30 s. */
export async function adcToken(exec = execFileAsync) {
  const { stdout } = await exec("gcloud", ["auth", "application-default", "print-access-token"], {
    timeout: 30_000,
  });
  const token = String(stdout).trim();
  if (!token) throw new Error("ADC returned an empty token");
  return token;
}

/**
 * Whether a second remove of the set may run: the first remove of the same set ended open, and
 * an a2 status read of the set (or of all entries) that started at least 10 minutes after the
 * first remove finished read every entry and showed one of the set still present.
 */
export function attempt2Allowed({ set, first, a2 = [] }) {
  const no = (reason) => ({ allowed: false, reason });
  if (!first || first.command !== "remove" || first.set !== set)
    return no("no first remove of the set");
  if (first.ok !== false) return no("the first remove closed every entry");
  const finished = Date.parse(first.finishedAt ?? "");
  if (!Number.isFinite(finished)) return no("the first remove has no finish time");
  const ids = SETS[set] ?? [];
  const reads = a2.filter(
    (r) =>
      r?.command === "status" &&
      (r.set === set || r.set === "all") &&
      r.ok === true &&
      Date.parse(r.startedAt ?? "") - finished >= A2_DELAY_MS,
  );
  if (reads.length === 0) return no("no a2 read 10 minutes after the first remove");
  if (!reads.some((r) => ids.some((id) => r.states?.[id]?.state === "present")))
    return no("no entry of the set read present");
  return { allowed: true };
}

/** Runs one subcommand; returns the exit code (0 ok, 2 open or refused, 3 usage or setup). */
export async function main(argv, { env = process.env, http, token = adcToken, sleep, now } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(String(error.message));
    return 3;
  }
  if (args.command === "may-retry") {
    // Local only: reads result files of this send and sends nothing.
    let verdict;
    try {
      const read = async (path) => JSON.parse(await readFile(path, "utf8"));
      verdict = attempt2Allowed({
        set: args.set,
        first: await read(args.first),
        a2: await Promise.all(args.a2.map(read)),
      });
    } catch (error) {
      console.error(String(error.message));
      return 3;
    }
    console.log(JSON.stringify(verdict));
    return verdict.allowed ? 0 : 2;
  }
  // An injected request layer (a test) never gets the real token: the caller injects one too.
  if (http && token === adcToken) {
    console.error("an injected http layer needs an injected token");
    return 3;
  }
  let send;
  try {
    send = http ?? productionHttp(env);
  } catch (error) {
    console.error(String(error.message));
    return 3;
  }
  // A fresh directory per run: an earlier journal is never appended to.
  try {
    await mkdir(args.out, { mode: 0o700 });
  } catch (error) {
    console.error(`--out ${args.out}: ${error.code ?? error.message}`);
    return 3;
  }
  const journalPath = join(args.out, "journal.jsonl");
  const journal = (row) => appendFile(journalPath, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  const earlier = fromJournals(await Promise.all(args.journals.map((p) => readFile(p, "utf8"))));
  const forms = projectForms(env);
  const cap = requestCap(args.command, args.set);
  const session = createSession({
    http: send,
    token,
    cap,
    wallMs: WALL_MS[args.command],
    ...(now ? { now } : {}),
    journal,
  });
  const pause = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const clock = now ?? Date.now;
  const startedAt = new Date(clock()).toISOString();
  let result;
  try {
    if (args.command === "status")
      result = await status({ session, set: args.set, forms, operations: earlier.operations });
    else if (args.command === "apply")
      result = await apply({ session, set: args.set, forms, sleep: pause });
    else
      result = await remove({
        session,
        set: args.set,
        forms,
        sleep: pause,
        applied: earlier.applied,
        removed: earlier.removed,
      });
  } catch (error) {
    result = { ok: false, error: String(error.message), sent: session.sent };
  }
  const summary = {
    command: args.command,
    set: args.set,
    cap,
    startedAt,
    ...result,
    sent: session.sent,
    finishedAt: new Date(clock()).toISOString(),
  };
  await journal({ result: summary });
  await writeFile(join(args.out, "result.json"), `${JSON.stringify(summary, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      command: args.command,
      set: args.set,
      ok: summary.ok,
      sent: summary.sent,
      cap,
    }),
  );
  return summary.ok ? 0 : 2;
}

if (isMainModule(import.meta)) process.exitCode = await main(process.argv.slice(2));
