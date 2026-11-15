---
title: Emulator UI
description: Inspect and manage data, Functions, Security Rules decisions and the clock in the browser.
---

`fireemu up` serves the Emulator UI at `http://127.0.0.1:4000/ui/`. Use it to browse and change data, run functions, read Security Rules decisions and move the clock.

## Open the UI

```sh
# Another port
npx fireemu up --ui-port 4001

# No UI
npx fireemu up --ui-port 0

# exec starts no UI unless asked
npx fireemu exec --ui -- npm test
```

If the default port is busy, `up` starts without the UI; check the startup output.

## What it shows

| Page | What you can do |
| --- | --- |
| **Overview** | See the project, version, virtual clock (frozen, or following real time) and running services, and the `Host` names the emulators answer: the built-in names, the entries you added with `network.allowedHosts` and whether single-label names are allowed. |
| **Authentication, Firestore and Storage** | Browse and manage users, documents and objects. |
| **Functions** | See registered functions with the runtime of each (Node.js or Python, and the `runtime` your `firebase.json` declares), their triggers, invocation results and logs, and the runtime status: work pending, running, waiting for a retry or dead-lettered, Auth events held while the event queue is full, tasks in flight, the state of each codebase's runner, and the exports the runner found and could not serve. Run a scheduled function immediately, or advance the clock to its next occurrence. |
| **Hosting** | See the site Fireemu serves, its local URL, the public directory (with a warning when it did not exist at start), and the rewrites, redirects and headers in the order they apply. The page reads your `firebase.json`; it does not record requests. |
| **Realtime Database** | Browse the data at a path, replace, patch or delete it as the local administrator, read and replace the instance's Rules, and run an anonymous request to see how the Rules answer it. |
| **Alerts** | Publish Firebase alerts to functions that listen for them. |
| **Rules** | Read the newest 100 traced Firestore Security Rules decisions, with bounded expression results. Tracing starts with the UI or the first control-API read; a new ruleset clears the history. See [Security Rules](../security-rules/) for diagnostic limits. |
| **App Check** | See registered apps and debug tokens. |
| **Runtime** | Move the virtual clock forward, or backwards with **Allow moving backwards**, and install a fault plan (see below). |

## Install a fault plan

On the Runtime page, under **Fault plan**:

1. Select a recipe for retrying a Functions event, duplicate delivery, delaying or timing out an attempt, or failing the first attempts, and enter its parameters.
2. Choose **Fill plan**. It puts the plan in the JSON editor; it does not install it.
3. Review or edit the JSON and choose **Install** to apply it to the selected session.

A parseable plan also offers copyable `fireemu/testing` and control API snippets for installing the same plan from a test. **Clear** removes the installed plan.

## Database selection and query reproduction

### Select a Firestore database

The Firestore database field offers the current project's known databases and recently opened names. You can also enter a name directly and select **Open database**.

- The catalog is checked again when the selection changes; **Refresh** checks it without changing the selection.
- A failed catalog request is reported separately from a database that is absent from a successful catalog response.
- Recent names are scoped to the selected session and project and retained only in the browser tab's session storage.

### Reproduce a query with the Node.js SDK

The query panel's **Node.js SDK reproduction** section generates a script using the low-level Firestore Node.js SDK. This preserves typed query values, including 64-bit integers and timestamp nanoseconds.

Install the packages listed in the script, save it as `query.cjs`, and set `FIRESTORE_EMULATOR_HOST` to your local Firestore port before running it. The script refuses non-loopback endpoints. Like console queries, it uses local administrator access rather than testing client Security Rules.

Query drafts are retained per database. Firestore views refresh affected documents by their changed paths, with a membership refresh when a row lacks a usable update time.

## Connection checks and shareable Functions filters

### Connection badge

The header's connection badge describes responses from the control API, not the health of every product listener.

- Its last successful check uses wall-clock time, independently of the emulator's virtual clock.
- A failed check retains the previous successful timestamp; changing the selected session clears it until that target answers.
- Connection changes are announced to assistive technology.

### Functions filter links

Functions function-name and log-level filters are kept in the URL. Search text stays in the tab's session storage, scoped to the selected session and project, unless you explicitly select **Include search text in the shared link** and use **Copy filter link**. Review search text before sharing it.

- Links contain filter settings, not a saved copy of log records; records may no longer be retained when another reader opens the link.
- When browser storage is unavailable, private text is retained only while the page remains mounted.
- An event link selects its session, including when revisited with browser Back or Forward. If the event is no longer retained, the page reports that it expired.

### Clipboard

When clipboard access fails, the Overview page offers a focused, read-only text field for manual keyboard copying instead of reporting success.

## Related

- [Time and scheduled functions](../time/)
- [Security Rules](../security-rules/)
- [Test worlds](../test-worlds/#inspect-a-world-in-the-ui)
- [CLI reference](../../reference/cli/)
