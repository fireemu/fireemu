// The RC-CLOSURE-A corpus: the request bodies and query forms of the two closure passes for the
// six recorded REMOTE-CONFIG conditions (template-read, template-validation, template-publish,
// version-history-and-rollback, server-template-evaluation, publish-trigger). Pure: no I/O.
//
// Every request repeats a form production already answered on 2026-11-21 or in RC-OBSERVE-V2-3
// (cited per group), so the two passes record each answer twice under the committed recorder.
import { CANDIDATES, serverTemplate } from "../remote-config-observe/plan.mjs";

export { CANDIDATES, serverTemplate };

/** The condition name every validation draft uses (2026-11-21 observe_validate.py). */
export const MATCH = "fireemu_match";

const leaf = (value, kind = "STRING", conditions = {}) => ({
  defaultValue: { value },
  valueType: kind,
  ...(Object.keys(conditions).length
    ? {
        conditionalValues: Object.fromEntries(
          Object.entries(conditions).map(([name, v]) => [name, { value: v }]),
        ),
      }
    : {}),
});

/**
 * A client template with two conditions, typed values, an in-app default, a conditional-only
 * value and a group: the drafts of the 2026-11-21 Web campaign (client.py `draft`), whose defaults
 * files production served byte for byte as recorded.
 */
export function clientDraft(label, runId) {
  return {
    version: { description: `fireemu rc-closure ${runId} ${label}` },
    conditions: [
      {
        name: "fireemu_premium",
        expression: "app.customSignal['fireemu_segment'].exactlyMatches(['premium'])",
      },
      { name: "fireemu_percent", expression: "percent('fireemu_web') <= 100" },
    ],
    parameters: {
      fireemu_source: leaf(`${label}-default`, "STRING", {
        fireemu_premium: `${label}-premium`,
        fireemu_percent: `${label}-fallback`,
      }),
      fireemu_count: leaf("12.5", "NUMBER", { fireemu_premium: "2.25" }),
      fireemu_json: leaf('{"synthetic":1}', "JSON"),
      fireemu_bool: leaf("true", "BOOLEAN", { fireemu_premium: "false" }),
      fireemu_inapp: { defaultValue: { useInAppDefault: true } },
      fireemu_only_conditional: { conditionalValues: { fireemu_premium: { value: '<&"' } } },
    },
    parameterGroups: {
      "Fireemu probe": { parameters: { fireemu_grouped: leaf('<&"') }, description: "Disposable" },
    },
  };
}

const VALUE = { defaultValue: { value: "synthetic" } };
const param = (fields = {}) => ({ parameters: { fireemu_probe: { ...VALUE, ...fields } } });
const condition = (expression, name = MATCH) => ({ conditions: [{ name, expression }] });
const many = (count, make) => Object.fromEntries(Array.from({ length: count }, (_, i) => make(i)));

/** The client validation drafts (2026-11-21 validate-*, validation-edges-*, validation-resume-*). */
export function validationDrafts() {
  const drafts = [
    ["v-empty", {}],
    ["v-description-only", { version: { description: "Fireemu validation probe" } }],
    ["v-kind-invalid", param({ valueType: "OTHER" })],
    ["v-boolean-invalid", param({ defaultValue: { value: "maybe" }, valueType: "BOOLEAN" })],
    ["v-number-invalid", param({ defaultValue: { value: "not-a-number" }, valueType: "NUMBER" })],
    ["v-json-invalid", param({ defaultValue: { value: "{" }, valueType: "JSON" })],
    ["v-bad-type", param({ defaultValue: { value: 1 }, valueType: "BOOLEAN" })],
    ["v-missing-reference", param({ conditionalValues: { fireemu_absent: { value: "x" } } })],
    [
      "v-duplicate-parameter",
      {
        ...param(),
        parameterGroups: { "fireemu group": { parameters: { fireemu_probe: VALUE } } },
      },
    ],
    [
      "v-duplicate-conditions",
      {
        conditions: [
          { name: MATCH, expression: "percent <= 100" },
          { name: MATCH, expression: "percent <= 100" },
        ],
        ...param(),
      },
    ],
    ["v-unknown-field", { fireemuUnknown: true }],
    ["v-parameters-not-object", { parameters: [] }],
    ["v-groups-not-object", { parameterGroups: [] }],
    ["v-condition-name-empty", condition("percent <= 100", "")],
    ["v-parameter-key-leading-digit", { parameters: { "1probe": VALUE } }],
    ["v-parameter-key-unicode", { parameters: { 試験: VALUE } }],
    ["v-parameter-key-underscore", { parameters: { _fireemu: VALUE } }],
    ["v-parameter-key-256", { parameters: { ["k".repeat(256)]: VALUE } }],
    ["v-parameter-key-257", { parameters: { ["k".repeat(257)]: VALUE } }],
    ["v-condition-name-256", condition("percent <= 100", "c".repeat(256))],
    ["v-condition-name-257", condition("percent <= 100", "c".repeat(257))],
    [
      "v-group-name-257",
      {
        parameterGroups: {
          ["g".repeat(257)]: { parameters: { k: { defaultValue: { value: "x" } } } },
        },
      },
    ],
    ["v-description-1024", { version: { description: "d".repeat(1024) } }],
    ["v-description-1025", { version: { description: "d".repeat(1025) } }],
    ["v-description-utf8-1025", { version: { description: "あ".repeat(1025) } }],
    ["v-parameter-count-3000", { parameters: many(3000, (i) => [`p${i}`, VALUE]) }],
    ["v-parameter-count-3001", { parameters: many(3001, (i) => [`p${i}`, VALUE]) }],
    [
      "v-condition-count-2000",
      {
        conditions: Array.from({ length: 2000 }, (_, i) => ({
          name: `c${i}`,
          expression: "percent <= 100",
        })),
      },
    ],
    [
      "v-condition-count-2001",
      {
        conditions: Array.from({ length: 2001 }, (_, i) => ({
          name: `c${i}`,
          expression: "percent <= 100",
        })),
      },
    ],
  ];
  return drafts;
}

/** The client condition expressions production answered (2026-11-21), condition `fireemu_match`. */
export const CLIENT_EXPRESSIONS = [
  ["percent-zero", "percent <= 0"],
  ["percent-fraction", "percent <= 0.000001"],
  ["percent-fraction-overprecision", "percent <= 0.0000001"],
  ["percent-negative", "percent <= -1"],
  ["percent-above-max", "percent <= 101"],
  ["percent-above", "percent > 50"],
  ["percent-range", "percent between 10 and 60"],
  ["percent-inverted-range", "percent between 60 and 10"],
  ["percent-seeded", "percent('fireemu') <= 50"],
  ["percent-seeded-range", "percent('fireemu') between 10 and 60"],
  ["conjunction", "percent > 0 && percent <= 100"],
  ["disjunction", "percent > 0 || percent <= 100"],
  ["parenthesized", "(percent > 0 && percent <= 100)"],
  ["negation", "!(percent > 0)"],
  ["app-build-number", "app.build >= 123"],
  ["app-build-string", "app.build.exactlyMatches(['123'])"],
  ["app-version-semver", "app.version >= '1.2.3'"],
  ["app-version-prerelease", "app.version >= '1.2.3-beta'"],
  ["app-version-regex", "app.version.matches(['^1[.]2'])"],
  ["app-version-malformed-regex", "app.version.matches(['['])"],
  ["app-browser", "app.browserAndVersion.inOne([browserName('Chrome').anyVersion])"],
  ["app-browser-unknown", "app.browserAndVersion.inOne([browserName('fireemu').anyVersion])"],
  [
    "app-os-version",
    "app.operatingSystemAndVersion.inOne([operatingSystemName('Macintosh').version.==('10.15')])",
  ],
  ["install-id", "app.firebaseInstallationId in ['eyJhbGciOiJFUzI1N_iIs5']"],
  ["install-id-bad", "app.firebaseInstallationId in ['synthetic-not-valid']"],
  ["custom-number", "app.customSignal['fireemu'] >= 12"],
  ["custom-exact", "app.customSignal['fireemu'].exactlyMatches(['synthetic'])"],
  ["custom-regex", "app.customSignal['fireemu'].matches(['^synthetic$'])"],
  ["custom-semver", "version(app.customSignal['fireemu']) >= '1.2.3'"],
  ["first-open-time", "app.firstOpenTimestamp >= ('2026-01-01T00:00:00')"],
  ["first-open-lt", "app.firstOpenTimestamp <= ('2026-01-01T00:00:00')"],
  ["first-open-gt-zone", "app.firstOpenTimestamp > ('2026-01-01T00:00:00', 'Asia/Tokyo')"],
  ["device-country", "device.country in ['jp', 'us']"],
  ["device-invalid-country", "device.country in ['invalid']"],
  ["device-language", "device.language in ['ja-JP', 'en-US']"],
  ["device-os", "device.os == 'android'"],
  ["device-date-time", "dateTime <= dateTime('2026-12-31T23:59:59', 'Asia/Tokyo')"],
  ["date-time-before-tz", "dateTime < dateTime('2026-12-31T23:59:59', 'Asia/Tokyo')"],
  ["date-time-after-nozone", "dateTime >= dateTime('2026-12-31T23:59:59')"],
  [
    "date-time-before-invalid-zone",
    "dateTime < dateTime('2026-12-31T23:59:59', 'Fireemu/Invalid')",
  ],
  ["app-build-numeric-method", "app.build.>=('123')"],
  ["app-version-semver-method", "app.version.>=('1.2.3')"],
  ["invalid-expression", "unknown.thing = no"],
  [
    "install-id-size-50",
    `app.firebaseInstallationId in [${Array.from({ length: 50 }, (_, i) => `'c${String(i).padStart(21, "0")}'`).join(", ")}]`,
  ],
  [
    "install-id-size-51",
    `app.firebaseInstallationId in [${Array.from({ length: 51 }, (_, i) => `'c${String(i).padStart(21, "0")}'`).join(", ")}]`,
  ],
  ["custom-key-250", `app.customSignal['${"k".repeat(250)}'] >= 12`],
  ["custom-key-251", `app.customSignal['${"k".repeat(251)}'] >= 12`],
];

/** One validation case per client expression: `v-cond-<name>`. */
export function conditionDrafts() {
  return CLIENT_EXPRESSIONS.map(([name, expression]) => [`v-cond-${name}`, condition(expression)]);
}

/**
 * The history queries of a pass, from the versions it created (2026-11-21 get-* and get-edges-*):
 * `times` are the updateTime strings of three consecutive client versions, `end` the number of the
 * middle one.
 */
export function historyQueries({ times: [t1, t2, t3], end }) {
  const plusMicro = (time, delta) => {
    const [whole, fraction] = time.replace("Z", "").split(".");
    const micros =
      BigInt(Date.parse(`${whole}Z`)) * 1000n +
      BigInt(fraction.padEnd(6, "0").slice(0, 6)) +
      BigInt(delta);
    const ms = micros / 1000n;
    const iso = new Date(Number(ms)).toISOString().replace(/\.\d{3}Z$/, "");
    return `${iso}.${String(micros % 1_000_000n).padStart(6, "0")}Z`;
  };
  return [
    ["h-page", { pageSize: "2" }],
    ["h-end-version", { endVersionNumber: String(end) }],
    ["h-end-version-zero", { endVersionNumber: "0" }],
    ["h-end-version-negative", { endVersionNumber: "-1" }],
    ["h-start", { startTime: t2 }],
    ["h-start-plus", { startTime: plusMicro(t2, 1) }],
    ["h-end", { endTime: t2 }],
    ["h-end-minus", { endTime: plusMicro(t2, -1) }],
    ["h-window", { startTime: t1, endTime: t3 }],
    ["h-same-bounds", { startTime: t2, endTime: t2 }],
    ["h-reversed", { startTime: t3, endTime: t1 }],
    ["h-old-end", { endTime: "2000-01-01T00:00:00Z" }],
    ["h-start-invalid", { startTime: "invalid" }],
    ["h-token-invalid", { pageToken: "fireemu-invalid" }],
    ["h-size-negative", { pageSize: "-1" }],
    ["h-size-zero", { pageSize: "0" }],
  ];
}

/** The template reads (2026-11-21 get-*; RC-READ-05 for the unauthenticated read). */
export const READS = [
  ["r-identity", { gzip: false }],
  ["r-if-none-match", { ifNoneMatch: true }],
  ["r-explicit", { path: "namespaces/firebase/remoteConfig" }],
  ["r-number", { number: true }],
  ["r-version-current", { query: "versionNumber=BASELINE" }],
  ["r-version-snake", { query: "version_number=BASELINE" }],
  ["r-version-zero", { query: "versionNumber=0" }],
  ["r-version-missing", { query: "versionNumber=9223372036854775807" }],
  ["r-version-invalid", { query: "versionNumber=invalid" }],
  ["r-unknown-namespace", { path: "namespaces/fireemu-absent-ns/remoteConfig" }],
  ["r-unauthenticated", { credentials: false }],
];

/** The defaults downloads after the first publication (2026-11-21 defaults-*). */
export const DEFAULTS = [
  ["d-json", "remoteConfig:downloadDefaults?format=JSON", true],
  ["d-xml", "remoteConfig:downloadDefaults?format=XML", true],
  ["d-plist", "remoteConfig:downloadDefaults?format=PLIST", true],
  ["d-explicit", "namespaces/firebase/remoteConfig:downloadDefaults?format=JSON", true],
  ["d-omitted", "remoteConfig:downloadDefaults", false],
  ["d-invalid", "remoteConfig:downloadDefaults?format=INVALID", false],
];

/** A stale tag of another form (2026-11-21 pair-02). */
export const MALFORMED_TAG = "etag-fireemu-expired-validation";
