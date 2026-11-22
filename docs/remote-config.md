# Local Remote Config templates

The daemon's loopback control listener supports reading, validating, publishing, listing and rolling back client and server templates for its configured project. Use its control capability as the bearer token. A Test World starts with an empty client template and owns its version history until the daemon stops. `world.reset()` starts a new daemon with an empty history.

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

An unpublished client template answers with an empty object and no `ETag`. Request gzip to receive the tag after publication. Use the current tag in `If-Match` for a conditional update. The wildcard explicitly permits a forced update. Add `validateOnly=true` to check parameter keys, declared types, values, and condition references without creating a version. A successful validation returns a `version` object containing the description when supplied. Its tag ends in `-0` and is for validation feedback.

Read a published version with `?versionNumber=n` and history with `:listVersions`. A zero or negative version selects the current template. An unavailable positive version returns an empty object. When the history response includes `nextPageToken`, pass it back as `pageToken`. An omitted or zero `pageSize` uses the default of 300. Larger sizes are capped at 300. Send `POST :rollback` with `{"versionNumber":"1"}` to copy the contents of version 1 into a new version. History retains up to 300 versions in memory.

## Namespaces

`projects/{project}/remoteConfig` and `projects/{project}/namespaces/firebase/remoteConfig` address the client template. `projects/{project}/namespaces/firebase-server/remoteConfig` addresses the server template, with the same actions (`:listVersions`, `:rollback`, `validateOnly`). The two namespaces keep separate contents, version numbers, ETags and history: a server publish leaves the client template unchanged, and a tag of one namespace is refused with 412 by the other. Another namespace name is refused with 400 `INVALID_ARGUMENT`. Unlike the client template, an unpublished server template reads as `{}` together with an `ETag` (on gzip requests), and that tag can be used in `If-Match` for the first publish. Production showed these differences on 2026-11-21.

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

Fireemu does not evaluate server conditions; the SDK does. Fireemu converts the two condition expressions recorded in production into their structured form: `app.customSignal['key'].exactlyMatches(['a', 'b'])` and `percent('seed') <= n` (n from 0 to 100, up to six decimals). Any other expression becomes an empty condition, which the SDK evaluates as false. Server parameter groups keep their metadata, and the data plane strips `valueType` from the parameters inside each group.

## Functions triggered by a publish

A successful client-template publish or rollback delivers one event per new version to the registered v1 (`functions.remoteConfig.onUpdate`) and v2 (`onConfigUpdated`) handlers of the default session. The event carries the version's `versionNumber` (a string), `updateTime`, `updateOrigin`, `updateType` (`INCREMENTAL_UPDATE`, `FORCED_UPDATE` or `ROLLBACK`), `description` and, for a rollback, `rollbackSource`, in the envelope shapes recorded in production: the v1 context `eventId`, `eventType`, `resource` and `timestamp`, and the v2 CloudEvent attributes `id`, `project`, `source`, `specversion`, `time` and `type`. In the v2 data `rollbackSource` is `"0"` for a publish, as recorded. Validate-only requests and refused publishes or rollbacks deliver nothing.

Delivery follows the ordinary Functions background delivery rules, the same path as the injection action below: events of one namespace are admitted in version order, and retries follow each function's retry policy. Production's duplicate delivery and ordering guarantees were not recorded, so do not rely on either. A server-template publish delivers no event, because production's behavior there was not recorded. If the Functions event queue is full, a client publish or rollback returns 429 `RESOURCE_EXHAUSTED` and leaves the current template, its ETag and history unchanged. A publish or rollback in either namespace also leaves them unchanged and returns 500 `INTERNAL` if the local clock is outside the RFC 3339 range.

Fireemu omits `updateUser` from version metadata and events because the control token carries no user principal. Production reports `updateUser.email` in version metadata and events, and includes `updateUser.name` and `updateUser.imageUrl` in version history. The values of the v2 `@type` and `project` attributes follow the Firebase event schema.

Use the existing capability-protected [Functions event injection](functions-export-inventory.md) when a test needs a caller-supplied Remote Config event. The [Remote Config compatibility record](../spec/compatibility/closure/REMOTE-CONFIG.json) tracks SDK client fetching, real-time delivery and the production comparisons still to come.
