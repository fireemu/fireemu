// Remote Config observation of the items Fireemu still answers with a conservative default
// (REMOTE-CONFIG parent, "Unrecorded after work/remote-config-server"): the fixed request plan,
// the request bodies, and the extraction of the recorded answers into a summary. Pure: no I/O.

export const PRODUCTION_PROJECT = "fireemu-oracle-query";
export const REGION = "us-central1";
export const SEED = "fireemu_obs";

// Server condition expressions beyond the two forms recorded on 2026-11-21
// (`app.customSignal[k].exactlyMatches([...])` and `percent(seed) <= n`). One family per operator
// of the Admin SDK's structured form (OneOfCondition, PercentConditionOperator, CustomSignalOperator).
const signal = (key) => `app.customSignal['fireemu_${key}']`;
export const CANDIDATES = [
  ["percent_between", `percent('${SEED}') between 10 and 60`],
  ["percent_between_fraction", `percent('${SEED}') between 0.5 and 99.25`],
  ["percent_greater", `percent('${SEED}') > 50`],
  ["percent_unseeded", "percent <= 50"],
  ["numeric_lt", `${signal("n")} < 5`],
  ["numeric_le", `${signal("n")} <= 5`],
  ["numeric_eq", `${signal("n")} == 5`],
  ["numeric_ne", `${signal("n")} != 5`],
  ["numeric_gt", `${signal("n")} > 5`],
  ["numeric_ge", `${signal("n")} >= 5`],
  ["string_contains", `${signal("s")}.contains(['ab'])`],
  ["string_not_contains", `${signal("s")}.notContains(['ab'])`],
  ["string_regex", `${signal("s")}.matches(['^ab$'])`],
  ["semver_lt", `version(${signal("v")}) < '1.2.3'`],
  ["semver_le", `version(${signal("v")}) <= '1.2.3'`],
  ["semver_eq", `version(${signal("v")}) == '1.2.3'`],
  ["semver_ne", `version(${signal("v")}) != '1.2.3'`],
  ["semver_gt", `version(${signal("v")}) > '1.2.3'`],
  ["semver_ge", `version(${signal("v")}) >= '1.2.3'`],
  ["and", `${signal("s")}.exactlyMatches(['a']) && percent('${SEED}') <= 50`],
  ["or", `${signal("s")}.exactlyMatches(['a']) || percent('${SEED}') <= 50`],
  ["not", `!(percent('${SEED}') <= 50)`],
  ["literal_true", "true"],
  ["literal_false", "false"],
].map(([name, expression]) => ({ name: `fireemu_obs_${name}`, expression }));

const leaf = (value, valueType = "STRING", conditional = {}) => ({
  defaultValue: { value },
  valueType,
  ...(Object.keys(conditional).length
    ? {
        conditionalValues: Object.fromEntries(
          Object.entries(conditional).map(([name, v]) => [name, { value: v }]),
        ),
      }
    : {}),
});

/** The validate-only body for one candidate: the condition and one parameter that uses it. */
export function candidateTemplate(candidate) {
  return {
    conditions: [candidate],
    parameters: { fireemu_obs_probe: leaf("default", "STRING", { [candidate.name]: "matched" }) },
  };
}

/** The server template published with the accepted candidates and a parameter group. */
export function serverTemplate(accepted, { description, top = "default" }) {
  const first = accepted[0]?.name;
  return {
    ...(description === undefined ? {} : { version: { description } }),
    conditions: accepted,
    parameters: {
      fireemu_obs_top: leaf(
        top,
        "STRING",
        Object.fromEntries(accepted.map((c) => [c.name, `value-${c.name}`])),
      ),
    },
    parameterGroups: {
      fireemu_obs_group: {
        description: "Fireemu observation group",
        parameters: {
          fireemu_obs_number: leaf("12.5", "NUMBER"),
          fireemu_obs_json: leaf('{"a":1}', "JSON", first ? { [first]: '{"a":2}' } : {}),
        },
      },
    },
  };
}

/** Client templates: c0 is the control before the server phase, c1 has no description. */
export function clientTemplate(step, runId) {
  const body = { parameters: { fireemu_obs_client: leaf(step) } };
  return step === "c1"
    ? body
    : { version: { description: `fireemu rc-observe ${runId} ${step}` }, ...body };
}

export function isEmptyTemplate(doc) {
  if (!doc || typeof doc !== "object") return false;
  const filled = (v) => v && typeof v === "object" && Object.keys(v).length > 0;
  return !filled(doc.parameters) && !filled(doc.conditions) && !filled(doc.parameterGroups);
}

/** Fresh names for one run; the run id is lowercase letters and digits only. */
export function names(runId) {
  if (!/^[a-z0-9]{8,24}$/.test(runId)) throw new Error("invalid run id");
  return {
    gen1: `rcObs1${runId}`,
    gen2: `rc-obs-2-${runId}`,
    label: { "fireemu-rc-observe": runId },
    marker: `fireemu-rc-observe-${runId}`,
  };
}

/**
 * Normalises one handler row: production rows carry the raw handler arguments, local rows (the
 * firebase-functions fixture) carry `{generation, data, context}`.
 */
export function normalise(row, order) {
  let data;
  let context;
  if (Array.isArray(row.args)) {
    // Gen1 legacy events, and a Gen2 runtime that passes (data, context), carry the version first.
    if (row.generation === 1 || row.args[0]?.versionNumber !== undefined)
      [data, context] = row.args;
    else {
      const { data: inner, ...rest } = row.args[0] ?? {};
      data = inner;
      context = rest;
    }
  } else {
    data = row.data;
    context = row.context;
  }
  data = data && typeof data === "object" ? data : {};
  context = context && typeof context === "object" ? context : {};
  return {
    generation: row.generation,
    order,
    receivedAt: row.receivedAt ?? null,
    logTimestamp: row.logTimestamp ?? null,
    eventId: (row.generation === 1 ? context.eventId : context.id) ?? null,
    versionNumber: data.versionNumber === undefined ? null : String(data.versionNumber),
    updateTime: data.updateTime ?? null,
    data,
    context,
  };
}

const keys = (value) => (value && typeof value === "object" ? Object.keys(value).sort() : null);

/**
 * Matches every event to the version this run created (namespace and step), by version number and
 * update time. An event that matches no created version is unmatched; one that matches more than
 * one (the two namespaces can share a number and, on a fixed clock, a time) is ambiguous. Neither
 * is attributed to a step.
 */
export function matchEvents(events, versions) {
  return events.map((event) => {
    const exact = versions.filter(
      (v) => v.versionNumber === event.versionNumber && v.updateTime === event.updateTime,
    );
    return { ...event, match: exact.length === 1 ? exact[0] : null, ambiguous: exact.length > 1 };
  });
}

/** The extraction the packet reports per item. Absence is only reported with its control. */
export function summarise({ events, versions, history, dataPlane, wildcard, validations, open }) {
  const matched = matchEvents(events, versions);
  // Events carry no namespace: a server answer is attributable only when the two namespaces' new
  // version numbers are disjoint (production: client 27, server 6 at the last read).
  const numbers = (ns) =>
    new Set(versions.filter((v) => v.namespace === ns).map((v) => v.versionNumber));
  const serverNumbers = numbers("server");
  const overlap = [...numbers("client")].some((n) => serverNumbers.has(n));
  const out = { versionRangesOverlap: overlap, generations: {} };
  for (const generation of [1, 2]) {
    const own = matched.filter((e) => e.generation === generation);
    const client = own.filter((e) => e.match?.namespace === "client");
    const server = own.filter((e) => e.match?.namespace === "server");
    const control = client.some((e) => e.match.step === "c0");
    const ids = new Map();
    for (const e of own) ids.set(e.eventId, (ids.get(e.eventId) ?? 0) + 1);
    const arrival = client.map((e) => e.match.step);
    out.generations[generation] = {
      events: own.length,
      unmatched: own.filter((e) => !e.match && !e.ambiguous).length,
      ambiguous: own.filter((e) => e.ambiguous).length,
      clientSteps: arrival,
      serverSteps: server.map((e) => e.match.step),
      // Item 1: a server answer is evidence only when the control publish before the server phase
      // was delivered to the same handler.
      serverDelivery:
        !control || overlap ? "not-evidence" : server.length ? "delivered" : "none-within-window",
      duplicates: [...ids].filter(([, n]) => n > 1).map(([eventId, count]) => ({ eventId, count })),
      // Item 2: arrival order of the client versions against their publication order.
      inPublicationOrder: isSorted(client.map((e) => versionIndex(versions, e.match))),
      typeValues: [...new Set(own.map((e) => e.data["@type"]).filter((v) => v !== undefined))],
      projectValues: [...new Set(own.map((e) => e.context.project).filter((v) => v !== undefined))],
      descriptionWithout: client
        .filter((e) => e.match.step === "c1")
        .map((e) => ({ present: Object.hasOwn(e.data, "description"), value: e.data.description })),
      updateUserKeys: [...new Set(own.map((e) => JSON.stringify(keys(e.data.updateUser))))],
      updateUserEqualsHistory: own
        .filter((e) => e.match)
        .every((e) => sameUser(e.data.updateUser, historyUser(history, e.match))),
    };
  }
  out.historyUpdateUserKeys = Object.fromEntries(
    Object.entries(history ?? {}).map(([namespace, doc]) => [
      namespace,
      [...new Set((doc?.versions ?? []).map((v) => JSON.stringify(keys(v.updateUser))))],
    ]),
  );
  out.dataPlane = dataPlane
    ? {
        conditions: (dataPlane.conditions ?? []).map((c) => ({
          name: c.name,
          shape: shape(c.condition),
        })),
        parameterGroups: keys(dataPlane.parameterGroups),
        groupParameters: Object.fromEntries(
          Object.entries(dataPlane.parameterGroups ?? {}).map(([g, v]) => [
            g,
            Object.fromEntries(Object.entries(v.parameters ?? {}).map(([p, x]) => [p, keys(x)])),
          ]),
        ),
      }
    : null;
  out.wildcard = wildcard;
  out.validations = validations;
  out.open = open;
  return out;
}

const isSorted = (xs) => xs.every((x, i) => i === 0 || xs[i - 1] <= x);
const versionIndex = (versions, v) => versions.indexOf(v);
const historyUser = (history, version) =>
  (history?.[version.namespace]?.versions ?? []).find(
    (v) => String(v.versionNumber) === version.versionNumber,
  )?.updateUser;
const sameUser = (a, b) => (a?.email ?? null) === (b?.email ?? null);

/** The structure of a structured condition with values reduced to their JSON types. */
export function shape(value) {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
  return typeof value === "string" ? `string:${value}` : typeof value;
}
