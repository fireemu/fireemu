// The sandbox state the Batch 3 judges assume, and the check that refuses a send when the
// coordinator's read-only observation of it differs. The three inputs are the JSON outputs of
// the read-only gcloud commands listed in the packet; nothing here talks to the network.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PROJECT = "fireemu-oracle-sbx";
const INDEX_FILE = new URL("../firestore.indexes.json", import.meta.url);
// Collections whose single-field or composite entries the judges depend on, and every
// collection group a recipe writes under at the first path segment of a field override.
const JUDGED_GROUPS = new Set(["flt", "items", "wlbase64"]);
const EXPECTED_OVERRIDES = new Map([
  ["items/n", [{ scope: "COLLECTION_GROUP", fields: "n:ASCENDING" }]],
]);

export const GCLOUD_COMMANDS = Object.freeze({
  composite: `gcloud firestore indexes composite list --project ${PROJECT} --database='(default)' --format=json`,
  fields: `gcloud firestore indexes fields list --project ${PROJECT} --database='(default)' --format=json`,
  database: `gcloud firestore databases describe --project ${PROJECT} --database='(default)' --format=json`,
});

const fieldKey = (field) => `${field.fieldPath}:${field.order ?? field.arrayConfig}`;
const groupOf = (name) => /\/collectionGroups\/([^/]+)\//.exec(name ?? "")?.[1];

function compositeKey(group, scope, fields) {
  return `${group}|${scope}|${fields.map(fieldKey).join(",")}`;
}

/** The composite indexes the committed index file deploys, as sorted keys. */
export function expectedComposites(file = readFileSync(INDEX_FILE, "utf8")) {
  return JSON.parse(file)
    .indexes.map((index) => compositeKey(index.collectionGroup, index.queryScope, index.fields))
    .toSorted();
}

export function expectedProviderState() {
  return {
    project: PROJECT,
    composites: expectedComposites(),
    readyGroups: ["flt"],
    overrides: Object.fromEntries(EXPECTED_OVERRIDES),
    judgedGroups: [...JUDGED_GROUPS].toSorted(),
    database: {
      type: "FIRESTORE_NATIVE",
      locationId: "us-central1",
      concurrencyMode: "PESSIMISTIC",
      databaseEdition: "STANDARD when present",
    },
  };
}

export const providerStateDigest = () =>
  createHash("sha256").update(JSON.stringify(expectedProviderState())).digest("hex");

/** Every way the observation differs from what the judges assume; empty means it matches. */
export function providerStateProblems({ composite, fields, database }) {
  const problems = [];
  if (!Array.isArray(composite)) problems.push("composite list is not a JSON array");
  else {
    const observed = composite.map((index) =>
      compositeKey(groupOf(index.name), index.queryScope, index.fields ?? []),
    );
    const want = expectedComposites();
    for (const key of want) {
      const missing =
        want.filter((k) => k === key).length - observed.filter((k) => k === key).length;
      if (missing > 0) problems.push(`composite index missing: ${key}`);
    }
    for (const key of new Set(observed)) {
      if (!want.includes(key)) problems.push(`unexpected composite index: ${key}`);
    }
    for (const index of composite) {
      if (JUDGED_GROUPS.has(groupOf(index.name)) && index.state !== "READY") {
        problems.push(`composite index on ${groupOf(index.name)} is ${index.state}, not READY`);
      }
    }
  }
  if (!Array.isArray(fields)) problems.push("field list is not a JSON array");
  else {
    const seen = new Set();
    for (const entry of fields) {
      const group = groupOf(entry.name);
      const field = /\/fields\/(.+)$/.exec(entry.name ?? "")?.[1];
      // Production omits `usesAncestorConfig` when it is false (proto3 JSON drops the default), so
      // an explicit override is any entry that does not say `true`; inherited fields (and
      // TTL-only fields, which inherit) carry `usesAncestorConfig: true`.
      if (!JUDGED_GROUPS.has(group) || entry.indexConfig?.usesAncestorConfig === true) continue;
      const key = `${group}/${field}`;
      if (!entry.indexConfig) {
        problems.push(`field entry ${key} has no indexConfig`);
        continue;
      }
      seen.add(key);
      const want = EXPECTED_OVERRIDES.get(key);
      if (!want) {
        problems.push(`unexpected field override: ${key}`);
        continue;
      }
      const have = (entry.indexConfig.indexes ?? []).map((index) => ({
        scope: index.queryScope,
        fields: (index.fields ?? []).map(fieldKey).join(","),
      }));
      if (JSON.stringify(have) !== JSON.stringify(want)) {
        problems.push(
          `field override ${key} is ${JSON.stringify(have)}, not ${JSON.stringify(want)}`,
        );
      }
    }
    for (const key of EXPECTED_OVERRIDES.keys()) {
      if (!seen.has(key)) problems.push(`field override missing: ${key}`);
    }
  }
  const db = database ?? {};
  if (!String(db.name ?? "").endsWith(`projects/${PROJECT}/databases/(default)`)) {
    problems.push("database description is not projects/fireemu-oracle-sbx/databases/(default)");
  }
  if (db.type !== "FIRESTORE_NATIVE") problems.push(`database type is ${db.type}`);
  if (db.locationId !== "us-central1") problems.push(`database location is ${db.locationId}`);
  if (db.concurrencyMode !== "PESSIMISTIC") {
    problems.push(`database concurrency mode is ${db.concurrencyMode}`);
  }
  if (db.databaseEdition !== undefined && db.databaseEdition !== "STANDARD") {
    problems.push(`database edition is ${db.databaseEdition}`);
  }
  return problems;
}

/** Read the three files the coordinator saved and check them; returns their digests too. */
export function checkProviderStateFiles(paths) {
  const read = (path) => {
    const raw = readFileSync(path);
    return { raw, json: JSON.parse(raw.toString("utf8")) };
  };
  const composite = read(paths.composite);
  const fields = read(paths.fields);
  const database = read(paths.database);
  return {
    problems: providerStateProblems({
      composite: composite.json,
      fields: fields.json,
      database: database.json,
    }),
    sha256: Object.fromEntries(
      Object.entries({ composite, fields, database }).map(([name, { raw }]) => [
        name,
        createHash("sha256").update(raw).digest("hex"),
      ]),
    ),
  };
}
