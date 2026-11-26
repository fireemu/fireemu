# Local Remote Config templates

The daemon's loopback control listener supports reading, validating, publishing, listing and rolling back client and server templates for its configured project. The Emulator UI's Remote Config page works on the same template store for the default project, so its versions and ETags match what these routes and the Admin SDK see. Use its control capability as the bearer token. A template read with no `Authorization` header at all is refused with production's 401 `CREDENTIALS_MISSING` body; a wrong token and the other routes get the listener's own 401. A Test World starts with an empty client template and owns its version history until the daemon stops. `world.reset()` starts a new daemon with an empty history.

```js
import { withTestWorld } from 'fireemu/testing';

await withTestWorld({ projectId: 'demo-config', services: ['auth'] }, async (world) => {
  const origin = world.endpoints.control.apiBaseUrl;
  const template = new URL(`projects/${world.projectId}/remoteConfig`, origin);
  const headers = {
    authorization: `Bearer ${world.environment.FIREEMU_CONTROL_TOKEN}`,
    'accept-encoding': 'gzip',
  };

  const current = await fetch(template, { headers });
  if (!current.ok) throw new Error(await current.text());

  const published = await fetch(template, {
    method: 'PUT',
    headers: {
      ...headers,
      'content-type': 'application/json',
      'if-match': current.headers.get('etag') ?? '*',
    },
    body: JSON.stringify({ parameters: { greeting: { defaultValue: { value: 'Hello' } } } }),
  });
  if (!published.ok) throw new Error(await published.text());
  console.log(await published.json());
});
```

An unpublished client template answers with an empty object and no `ETag`. Request gzip to receive the tag after publication. Tags have production's form, `etag-<project number>-<version>`, with the number from `daemon.authProjectNumbers` or, without an entry, the number Fireemu derives for the project; because the form carries only the version, a client tag also names the server version of the same number, as in production. Use the current tag in `If-Match` for a conditional update. The wildcard explicitly permits a forced update. A client tag for an older version, or a value of another form, is refused with production's 412 answer (`[VERSION_MISMATCH]: Expected version 3, found 4 for project: ...` or `... is not of the format "etag-<project number>-<version number>".`, with `code` 400 in the body, as recorded). Add `validateOnly=true` to check parameter keys, declared types, values, condition references and production's limits (3,000 parameters, 2,000 conditions, 256-character keys, condition and group names, a 1,024-character version description) without creating a version; the refusals carry production's messages (`[VALIDATION_ERROR]: KEY_TOO_LONG ...`, `DUPLICATE_KEY`, `PARAM_VALUE_TYPE_MISMATCH` and the others recorded on 2026-11-21), and a body production's JSON transcoder refused (an unknown field, a list where a map belongs, an unknown `valueType`, a number or boolean as a default value) is refused with its message before the `If-Match` check. A successful validation returns a `version` object containing the description when supplied. A client condition expression wrapped in one pair of parentheses is answered and kept without them, as production answers it (the strict checks below see the expression as written). Its tag is `etag-<project number>-0`. In the strict profile, a client condition written in one of the forms production refused on 2026-11-21 is refused with its message (a condition of one form: no `&&` chain, no outer parentheses, the recorded operators; other expressions are accepted as before): parser errors at production's column (an expression that does not start with a condition, `app.build` or `app.version` compared without a method or given a string instead of a list, `app.firstOpenTimestamp` with an operator other than `<=` or `>`, `dateTime` with one other than `<` or `>=`, a percent value that is negative, above 100 or finer than a micro-percent) and the condition checks (`!`, a two-term `||`, an inverted percent range, more than 50 or malformed Installation ids, a custom-signal name over 250 characters, a country code that is not two letters, an unknown time zone, an app-version expression with unbalanced brackets); the emulator profile accepts every expression, as before. Conditions on app ids, audiences and user properties are not checked: production's answers depend on the project's apps and its Analytics data. In the strict profile, the loser of two concurrent client publications with one tag, both drafts holding the same number of conditions, gets production's 400 `Condition order size [n] does not match condition count [2n] ...`; the emulator profile answers 412.

Read a published version with `?versionNumber=n` and history with `:listVersions`. A zero or negative version selects the current template. An unavailable positive version returns an empty object (with the tag `etag-<project number>-0`, as recorded), and a value that is not a number is refused with the transcoder's message. When the history response includes `nextPageToken`, the number of the next version to list, pass it back as `pageToken`. A client rollback to a version that does not exist is refused with production's 404 (`[NOT_FOUND]: Template version [n] not found for project [ProjectKey{projectNumber=..., namespace=firebase}]`). An omitted or zero `pageSize` uses the default of 300. Larger sizes are capped at 300. History also takes production's filters: `endVersionNumber` (0 for none), `startTime` (inclusive) and `endTime` (exclusive), refusing a negative end version, a start that is not before the end and an end more than 91 days before the request with production's messages; a window with no version answers `{}`. Send `POST :rollback` with `{"versionNumber":"1"}` to copy the contents of version 1 into a new version. History retains up to 300 versions in memory. Times are written at microsecond precision the way production writes them (no fraction on a whole second, three digits on a whole millisecond, otherwise six; a Gen1 event's `timestamp` and `updateTime` drop the trailing zeros), `<` and `>` in JSON strings as `\u003c` and `\u003e`, and the `Content-Type` is `application/json; charset=UTF-8`, as recorded. Production also serves the client template's current read under the project number (`projects/<number>/remoteConfig`, no query); Fireemu does too, and answers other routes and queries under the number as an unknown project.

`GET :downloadDefaults?format=JSON` (also `XML` and `PLIST`) returns the defaults file production serves: each top-level parameter and then each group parameter with its default value, an in-app default as the empty string, in the recorded layouts and content types, gzip-compressed when the request accepts gzip, and an empty, uncompressed body for an empty template. A missing or unknown `format` is refused with production's messages. The entries follow the published template's own order, as production writes them (the top-level parameters as written, then each group as written with its parameters as written); a rollback keeps the order of the version it restores. How `>`, `'`, `=` and control characters are written in each format was not recorded.

## Namespaces

`projects/{project}/remoteConfig` and `projects/{project}/namespaces/firebase/remoteConfig` address the client template. `projects/{project}/namespaces/firebase-server/remoteConfig` addresses the server template, with the same actions (`:listVersions`, `:rollback`, `validateOnly`). The two namespaces keep separate contents, version numbers and history: a server publish leaves the client template unchanged. Their tags have the same form, so when both namespaces are at the same version number their tags are identical and a tag of one is accepted by the other; at different versions it is refused with 412. Another namespace name is refused with 400 `INVALID_ARGUMENT`. Unlike the client template, an unpublished server template reads as `{}` together with an `ETag` (on gzip requests), and that tag can be used in `If-Match` for the first publish. Production showed these differences on 2026-11-21.

## Server templates for the Admin SDK

`GET projects/{project}/namespaces/firebase-server/serverRemoteConfig` serves the current server template in the shape the Node Admin SDK reads: conditions in their structured form, parameters without `valueType`, and `version` holding only `versionNumber` and `isLegacy`. Before the first server publish it answers 404 `NOT_FOUND`, which the SDK reports as `remote-config/not-found`. Point the SDK at the control listener with `FIREBASE_REMOTE_CONFIG_URL_BASE` and give it the control token as its access token:

```js
process.env.FIREBASE_REMOTE_CONFIG_URL_BASE = new URL(world.endpoints.control.apiBaseUrl).origin;
const app = initializeApp({
  projectId: world.projectId,
  credential: { getAccessToken: async () => ({ access_token: world.environment.FIREEMU_CONTROL_TOKEN, expires_in: 3600 }) },
});
const template = await getRemoteConfig(app).getServerTemplate({ defaultConfig: { limit: 10 } });
const config = template.evaluate({ randomizationId: 'user-1', tier: 'premium' });
```

Fireemu does not evaluate server conditions; the SDK does. Fireemu converts the condition expressions recorded in production (2026-11-21 and 2026-11-24) into their structured form, one `orCondition` holding one `andCondition` with the atoms in source order:

- `percent('seed') <= n`, `percent('seed') > n`, `percent('seed') between a and b` and the unseeded `percent <= n`, with percentages from 0 to 100 and up to six decimals, served in micro-percent;
- `app.customSignal['key'].exactlyMatches([...])`, `.contains([...])`, `.notContains([...])` and `.matches([...])` with single-quoted strings;
- `app.customSignal['key'] < n` (also `<=`, `==`, `!=`, `>`, `>=`) with an integer, and `version(app.customSignal['key']) < '1.2.3'` (the same six comparisons);
- any `&&` chain of these.

Any other expression becomes an empty condition, which the SDK evaluates as false. In the strict profile, a server publish or validation whose condition is a two-term `||` whose operands each parse as one of the supported atoms or `&&` chains above, a whole `!(...)` around such an operand, `true` or `false` is refused with production's 400 `INVALID_ARGUMENT` message (after the `If-Match` check); the emulator profile accepts these, as before, and serves them as empty conditions. The data plane lists the parameters of parameter groups next to the top-level parameters, without `valueType` and without the group, as production does; the admin reads keep the groups. A regular-expression target is converted only in its plain recorded form (an optional `^`, letters, digits, `_`, `-`, space and `.`, an optional `$`), and a semantic-version target only as one to five dot-separated numbers without leading zeros (`0` alone is a number); other targets serve an empty condition, as before. Fireemu writes JSON members in sorted key order, while production keeps its own order (for example `percentOperator` before `microPercent`); the values and the body length are the same, and JSON readers such as the Admin SDK do not depend on member order.

## Web client fetch and real-time updates

The Web SDK (`firebase/remote-config`) fetches from `POST /v1/projects/<project>/namespaces/firebase:fetch` and listens on `POST /v1/projects/<project>/namespaces/firebase:streamFetchInvalidations`. Fireemu serves these routes on the control listener for the default project without a control token. The wire comparison used two production recordings of the Web SDK (firebase 12.18.0) on 2026-11-25. Point the SDK at Fireemu before it loads:

```js
window.FIREBASE_REMOTE_CONFIG_URL_BASE = "http://127.0.0.1:<control port>";
```

A fetch answers the client template's values for the request's `custom_signals` and installation id: custom-signal exact matches and numeric comparisons and seeded percent conditions are evaluated, the first matching condition in the template's condition order chooses a parameter's value, and a parameter whose chosen value is the in-app default is left out. The answer is `200` with `entries`, `state: "UPDATE"` and `templateVersion`, and an `ETag` of production's form `etag-<project>-firebase-fetch-<number>`; a fetch whose `If-None-Match` is the current tag answers `state: "NO_CHANGE"` with the same tag. Fireemu derives the tag from the evaluated entries and template version. In both production recordings, the tag changed after each publication and rollback, including those that preserved the values. Before the first publication a fetch answers `state: "NO_TEMPLATE"` (not recorded in production).

The real-time stream waits until the client template is newer than the request's `lastKnownVersionNumber`, then writes `latestTemplateVersionNumber` frames on the same open response. The SDK fetches again after each invalidation. Both production recordings covered separate changed, metadata-only, same-content and rollback publications. The listener unsubscribed and resubscribed while the SDK kept its existing stream. For an already-stale listener, Fireemu starts with the current version. It then emits each newer version in order. Fireemu sends headers after 60 seconds without a newer version and closes the response an hour after sending headers. The production recordings covered neither those timing limits nor a new transport connection.

Differences from production: the number in the fetch tag differs (production's is a hash whose input was not recorded), the percent outcome for a given installation id follows the server-template hash, not production's client hash, and Fireemu sends responses without gzip. The recordings covered the pinned Web SDK's plaintext request bytes and did not establish production's CORS preflight responses or handling of compressed request bytes. Fireemu has no Installations service: the SDK still calls `firebaseinstallations.googleapis.com` before it fetches, so a test page answers those requests itself (for example with Playwright request interception) or the fetch fails. The comparison and its declared differences are in `conformance/remote-config-web/`.

## Android and Apple SDKs

Remote Config Android 22.1.0 and Apple 12.18.0 were recorded twice on 2026-11-26. The cases cover initial fetch and activation, a cached fetch, evaluation of a custom signal, one real-time invalidation, automatic conditional refetch, and explicit activation of the changed value. The same SDK calls are compared on both Fireemu profiles.

Android sends the configured project number on both SDK routes and uses camelCase request fields. Apple sends the project ID for fetch and the project number for real-time updates, with gzip-compressed bodies. Set the project's number in `daemon.authProjectNumbers` to match the SDK's Firebase options. A native UPDATE includes the SDK package name or bundle identifier as `appName`.

The native comparison uses instrumented test apps and a scoped Installations fixture. Fireemu serves the recorded Remote Config responses with identity encoding and its CORS header policy. In the recorded fetch bodies, Fireemu writes `appName` before `entries`; Google writes `entries` first. The [native comparison fixtures](../conformance/remote-config-native/) document the matched exchanges and these differences.

## Functions triggered by a publish

A successful client-template publish or rollback delivers one event per new version, with one event id shared by its v1 and v2 events as in production (a decimal 32-bit integer of either sign, never 0, as the recorded ids), to the registered v1 (`functions.remoteConfig.onUpdate`) and v2 (`onConfigUpdated`) handlers of the default session. The event carries the version's `versionNumber` (a string), `updateTime`, `updateOrigin`, `updateType` (`INCREMENTAL_UPDATE`, `FORCED_UPDATE` or `ROLLBACK`), `description` and, for a rollback, `rollbackSource`, in the envelope shapes recorded in production: the v1 context `eventId`, `eventType`, `resource` and `timestamp`, and the v2 CloudEvent attributes `id`, `project`, `source`, `specversion`, `time` and `type`. In the v2 data `rollbackSource` is `"0"` for a publish, as recorded. Validate-only requests and refused publishes or rollbacks deliver nothing.

Delivery follows the ordinary Functions background delivery rules, the same path as the injection action below: events of one namespace are admitted in version order, and retries follow each function's retry policy. In three production recordings (five chained publishes on 2026-11-24, and seven client publications and rollbacks in each of two passes on 2026-11-25), each version reached each handler once and in order within bounded windows of about five minutes; that is no guarantee, so do not rely on either. A server-template publish delivers no event, as production delivered none within five minutes in any of the three recordings while client events reached the same handlers. If the Functions event queue is full, a client publish or rollback returns 429 `RESOURCE_EXHAUSTED` and leaves the current template, its ETag and history unchanged. A publish or rollback in either namespace also leaves them unchanged and returns 500 `INTERNAL` if the local clock is outside the RFC 3339 range.

The control token carries no user principal, so by default Fireemu omits `updateUser`. To report one, set `remoteConfig.updateUser` in the Fireemu configuration (`{"email": "dev@example.com", "name": "Dev", "imageUrl": "https://example.com/dev.png"}`; `name` and `imageUrl` are optional). Fireemu then reports it in production's shapes: `{"email": ...}` on published and read versions and in v1 event data, `{"email": ..., "name": "", "imageUrl": ""}` in v2 event data, and email, name and image in version history. The v2 `@type` is `type.googleapis.com/google.events.firebase.remoteconfig.v1.RemoteConfigEventData`, `project` is the project id, and a version without a description has `description: ""` in v2 data and none in v1 data, as recorded.

Use the existing capability-protected [Functions event injection](functions-export-inventory.md) when a test needs a caller-supplied Remote Config event. The [Remote Config compatibility record](../spec/compatibility/closure/REMOTE-CONFIG.json) records the production comparisons, including fetch-and-activate and real-time updates for Web, Android, and Apple.
