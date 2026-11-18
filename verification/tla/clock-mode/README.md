# ClockMode

TLA+ model of switching the shared virtual clock between frozen and following real time while the daemon runs (`clock:freeze`, `clock:resume`, `clock:resume` with `syncToRealTime`), together with the clock ticker, counted rewinds (`clock:set` with `allowBackwards`), the Functions sync loop (`FunctionsRuntime::sync_clock`, which repeats until the `(revision, following)` it sent is still the daemon's) and a Node runner that applies each frame when it arrives and shows application time and timer elapsed time (`tools/runner-node/clock.mjs`).

The daemon's time source is the host wall clock, which can step back (an NTP correction); a following clock then holds at its high-water mark. The runner counts on its own monotonic clock, which never steps back.

Checked properties:

- `FrozenStandsStill`: a frozen clock reads its last move.
- `RunnerAgrees`: once the sync loop has no publication left to take, the runner holds the daemon's revision and mode.
- `NeverBelowPublished`: no read of the daemon clock takes back what a publication showed the observers (the sync's publication is split into its anchor and its snapshot, between which the source can move).
- `SettleWithoutChasing`: one round of the sync loop settles a move; it does not re-send because a running clock published again meanwhile.
- `SyncAtWallIsAccepted`: a sync of a clock that already shows the wall time is never refused as backwards.
- `SyncedFollowsWall`: after a sync, until the wall steps back again or the clock is moved, the clock shows the wall time (also after a step back that the sync followed with `allowBackwards`).
- `NeverBackwardsUncounted`: the daemon clock never reads an earlier instant unless an allowed rewind was counted.
- `AppTimeMonotonic`: application time in the runner never goes back unless a counted rewind reached the runner.
- `TimerElapsedMonotonic`: timer elapsed time in the runner never goes back.
- `FreezeKeepsTheInstant`: freezing does not move the clock.

Negative controls, each of which must fail:

- `ClockModeUnpublished.cfg`: a freeze that changes the mode without publishing violates `RunnerAgrees`.
- `ClockModeSplitWallRead.cfg`: a sync that reads the wall clock for its target and samples the clock at a later reading violates `SyncAtWallIsAccepted`.
- `ClockModeStaleAnchor.cfg`: a sync that anchors at the held drift instead of the raw wall reading violates `SyncedFollowsWall` (the review round 2 Must).
- `ClockModeNoRunnerFloor.cfg`: a runner that drops what it showed on a freeze frame violates `AppTimeMonotonic`.
- `ClockModeSnapshotReset.cfg`: a sync that publishes with the folded anchor and resets anchor and high-water mark after the snapshot violates `NeverBelowPublished` (review round 3 M1).
- `ClockModeChaseTicks.cfg`: a sync loop that waits for the revision to stand still violates `SettleWithoutChasing` (review round 3 M2).
- `ClockModeNoElapsedFloor.cfg`: a runner that takes the daemon's elapsed time without its own floor violates `TimerElapsedMonotonic`.

```sh
tla2tools -workers 4 -config ClockMode.cfg ClockMode.tla   # no error (11,263,291 distinct states, about 5 minutes)
for c in Unpublished SplitWallRead StaleAnchor SnapshotReset ChaseTicks NoRunnerFloor NoElapsedFloor; do
  tla2tools -workers 2 -config ClockMode$c.cfg ClockMode.tla  # each reports its property violated
done
```
