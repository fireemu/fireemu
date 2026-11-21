# Local Remote Config client templates

The daemon's loopback control listener supports reading, validating, publishing, listing and rolling back client templates for its configured project. Use its control capability as the bearer token. A Test World starts with an empty client template and owns its version history until the daemon stops. `world.reset()` starts a new daemon with an empty history.

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

An unpublished client template answers with an empty object and no `ETag`. Request gzip to receive the tag after publication. Use the current tag in `If-Match` for a conditional update. The wildcard explicitly permits a forced update. Add `validateOnly=true` to check a draft without creating a version. Successful validation tags end in `-0` and are for validation feedback.

Read a published version with `?versionNumber=n` and history with `:listVersions`. When the history response includes `nextPageToken`, pass it back as `pageToken`. Send `POST :rollback` with `{"versionNumber":"1"}` to copy the contents of version 1 into a new version. History retains up to 300 versions in memory.

This interface covers client-template administration. The [Remote Config compatibility record](../spec/compatibility/closure/REMOTE-CONFIG.json) tracks server templates, SDK data-plane fetching and delivery on publication. Use the existing capability-protected [Functions event injection](functions-export-inventory.md) when a test needs a caller-supplied Remote Config event.
