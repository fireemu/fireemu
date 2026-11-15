---
title: Export and import data
description: Save emulator data, load it at startup, and keep it between runs.
---

Export the data of a running emulator to a directory, import it at startup, and write it back when the run ends.

## Export from a running emulator

Run this in another terminal while `fireemu up` is running:

```sh
npx fireemu emulators:export ./emulator-data
```

`--force` overwrites a non-empty destination.

## Import at startup and export on exit

`--import <dir>` loads an export at startup. `--export-on-exit` without a directory writes the state back to the same directory when the run ends:

```sh
npx fireemu exec --import ./emulator-data --export-on-exit -- npm test
```

What `--import` accepts:

- An empty `--import` directory starts with no data, so the first run needs no separate command.
- A missing directory is refused, so a mistyped path cannot start an empty suite, unless it is also where `--export-on-exit` writes.
- A directory that holds files but no `firebase-export-metadata.json` is refused.
- Realtime Database imports are validated before any product installs data. Under `strict`, a lone surrogate in an imported JSON string value is refused; the `emulator` profile replaces it with `?`, as the official emulator does. Invalid keys are refused in both profiles. See [Realtime Database import](../../products/realtime-database/#export-import-and-snapshots).

What `--export-on-exit` does:

- A failed `--export-on-exit` is printed as an `error:` line, and the run exits 1 when the command succeeded. The official CLI only warns and exits 0; Fireemu differs so that a CI job that depends on the saved data cannot pass without it.
- The export directory may be a volume mount point, such as a container volume mounted at `/data`. A mount point cannot be replaced by an atomic rename, so the export is staged inside it and moved into place, the old `firebase-export-metadata.json` leaving first and the new one arriving last. That replacement is not atomic: an interrupted export leaves a directory without the manifest, which `--import` refuses instead of loading part of it.
- Any other directory is still replaced atomically.

## Where to export

Before starting a persistent run, inspect the destination without creating directories or changing permissions:

```sh
npx fireemu doctor --export-dir "$HOME/.local/share/fireemu/emulator-data"
```

On Unix-like systems, the destination and every existing ancestor are checked for ownership and permissions, including the home directory. Each must be owned by you or root and not writable by other users. The exception is a root-owned directory with the sticky bit such as `/tmp` (on macOS `/tmp` is a root-owned link to `/private/tmp`, which is followed).

- **Shared directories.** In a sticky directory other users can create entries but cannot rename or remove yours, so `--export-on-exit /tmp/emulator-data` works. Another user can still take the name first, which refuses the export, so a dedicated directory of your own is the more reliable choice on a shared machine. Below `/tmp`, an export directory that already exists must be yours and not writable by other users (`chmod 700`).
- **Refused.** A directory other users can write without the sticky bit, or another user's directory.
- **Symlinks.** Every symlink on the export path is checked. It is followed only when root owns it, or when you own it in a directory only you (or root) can write, so a link another user makes in `/tmp` is never followed. `..` right after a symlink is refused. The directory holding a link must pass the same checks as an ancestor (a volume that enforces ownership, no ACL entry for other users).
- **When the checks run.** `--export-on-exit` checks before the daemon or child command starts and validates again when exporting, since permissions can change. It keeps the export directory's parent open from the preflight to the end of the run, so nothing renamed or linked on the way meanwhile is followed.
- **Volume mounts.** A volume mount destination needs to be writable even when its parent need not be.
- **Group-writable files.** Configuration discovery permits group-writable files for private-group setups, but export publication keeps its stricter cleanup safety rules.

### macOS

- **ACLs.** An ancestor directory with an ACL is refused when the ACL has an `allow` entry for anyone but the owner, root or the user running the export, whatever permissions the entry shows (the kernel grants rights that `ls -le` does not list). `deny` entries are accepted, so a standard home directory (which carries `group:everyone deny delete`) and the folders below it work.
- **Fixing an ACL refusal.** When an export is refused for an ACL, the message names the entry; remove it (`chmod -a`) or export to another directory, for example one under `$TMPDIR`. Check an ancestor with `/bin/ls -led <directory>`.
- **Volumes that ignore ownership.** A destination on a volume that ignores ownership (exFAT and FAT sticks and cards, or an external APFS volume with "Ignore ownership on this volume" turned on) is refused, because the owner and the mode of its directories do not show who can change them; export to a volume that enforces ownership.
- **Volumes without atomic rename.** A volume without atomic directory rename (exFAT, FAT, some network filesystems) cannot publish an export either: use a directory on an APFS volume.

### Windows

`emulators:export` and `--export-on-exit` are not currently available. Import and the rest of the emulators work.

## Export independent test worlds

In a [test world](../test-worlds/), `hub: true` enables a private Hub for the world's existing CLI export command. Use an absolute caller-owned export path outside `world.directory`:

```js
import { resolve } from 'node:path';
import { createTestWorld } from 'fireemu/testing';

const exportPath = resolve('./emulator-data');
const services = ['auth', 'firestore', 'storage'];
const world = await createTestWorld({ services, hub: true });
try {
  await world.run('fireemu', [
    'emulators:export', exportPath, '--project', world.projectId,
  ]);
} finally {
  await world.dispose();
}
const restored = await createTestWorld({ services, import: exportPath });
try {
  // Connect fresh SDK clients through restored.endpoints or restored.run(...).
} finally {
  await restored.dispose();
}
```

- Pass `--project` explicitly.
- The helper owns the Hub's OS-assigned port and private locator; same-project worlds stay independent.
- For a development binary, use its absolute path for both `binaryPath` and the export command.
- Imports are snapshotted at creation, so later edits to the original export do not affect reset.
- Exports outside the world directory remain caller-owned after disposal.

See the [full export and import guide](https://github.com/fireemu/fireemu/blob/main/docs/test-worlds.md#export-and-import-test-data).

## What an export preserves

| Preserved | Not preserved |
| --- | --- |
| Auth users and password credentials | App Check state |
| Firestore documents | Virtual clocks |
| Storage bytes and metadata | Functions process memory |
| Realtime Database data | The validity of previously issued tokens |

## Related

- [Test worlds](../test-worlds/)
- [CLI reference](../../reference/cli/)
- [Realtime Database](../../products/realtime-database/#export-import-and-snapshots)
- [Troubleshooting](../troubleshooting/)
