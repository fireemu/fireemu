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
| **Authentication, Firestore and Storage** | Browse and manage users, documents and objects. The Authentication page also lists the pending email action codes (with their links) and SMS codes, refreshed every few seconds while the tab is visible, for a sign-in or verification flow you follow by hand in a browser. |
| **Functions** | See registered functions with the runtime of each (Node.js or Python, and the `runtime` your `firebase.json` declares), their triggers, invocation results and logs, and the runtime status: work pending, running, waiting for a retry or dead-lettered, Auth events held while the event queue is full, tasks in flight, the state of each codebase's runner, and the exports the runner found and could not serve. Run a scheduled function immediately, or advance the clock to its next occurrence. |
| **Hosting** | See the site Fireemu serves, its local URL, the public directory (with a warning when it did not exist at start), and the rewrites, redirects and headers in the order they apply. The page reads your `firebase.json`; it does not record requests. |
| **Realtime Database** | Browse the data at a path, replace, patch or delete it as the local administrator, read and replace the instance's Rules, and run an anonymous request to see how the Rules answer it. |
| **Alerts** | Publish Firebase alerts to functions that listen for them. |
| **Rules** | Read the newest 100 traced Firestore Security Rules decisions, with bounded expression results. Tracing starts with the UI or the first control-API read; a new ruleset clears the history. See [Security Rules](../security-rules/) for diagnostic limits. |
| **App Check** | See registered apps and debug tokens. |
| **Runtime** | Move the virtual clock forward, or backwards with **Allow moving backwards**, and install a fault plan (see below). |

## Find your way around

- **Command palette**: press <kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>⌘</kbd>+<kbd>K</kbd> on macOS), or select **Search or jump to** in the sidebar. Type a page name to open it, a Firestore path such as `users/alice` to open that document or collection in the default database, or choose an action: switch the session, switch the theme, or copy the `.env` lines.
- **Theme**: the button at the bottom of the sidebar cycles between the system setting, light and dark. An explicit choice is remembered in this browser.
- **Overview figures**: the tiles show what the selected session holds (Firestore document data, Authentication users, Storage objects, registered functions) and link to each page. A figure the daemon does not report is shown as a dash, not as zero.
- **Connection snippets**: the Overview offers the same connection settings as `.env` lines, shell exports, Web SDK code and Admin SDK code, and each service address has a **Copy** button.
- **Firestore fields**: a document's fields are a tree. Each row shows the name, the type (integers and doubles are told apart) and the value; maps and arrays open on demand. A reference into the database you are browsing is a link to that document.
- **Functions search**: the box above the registered functions filters the table by name, region or trigger.
- **Keyboard shortcuts**: press <kbd>?</kbd> (or select **Shortcuts** in the sidebar) for the list. <kbd>/</kbd> opens the command palette, and <kbd>g</kbd> followed by a page key opens that page, for example <kbd>g</kbd> <kbd>f</kbd> for Firestore. Single keys do nothing while a text field has focus.
- **Relative times**: timestamps are followed by their distance from the session's virtual clock, such as `(3 min ago)` or `(in 2 h)`. The distance is measured against the virtual clock, not your computer's clock, so it changes when you advance the clock.
- **Storage upload and preview**: drop one or more files on the **Objects** card, or select several in the file picker, to upload them under the folder you are viewing. Files are sent one at a time; the first failure stops the rest of that batch and names the file. Files dropped while an upload is running wait for it, then go to the folder that was open when they were dropped. An object's details show an inline preview for raster images (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO) up to 10 MiB and text-like content (text, JSON, XML and similar) up to 256 KiB. SVG images are not previewed; use **Download**. Text is always shown as text, never rendered as HTML.
- **Function logs as JSON**: select **Format JSON** above the logs to print a line's JSON object or array indented. The level and text filters still match the lines as they were written.

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
