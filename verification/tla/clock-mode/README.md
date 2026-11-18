# ClockMode

TLA+ model of switching the shared virtual clock between frozen and following real time while the daemon runs (`clock:freeze`, `clock:resume`, `clock:resume` with `syncToRealTime`), together with the clock ticker, counted rewinds (`clock:set` with `allowBackwards`), the Functions sync loop (`FunctionsRuntime::sync_clock`, which repeats until the `(revision, following)` it sent is still the daemon's) and a Node runner that applies each frame when it arrives and shows application time (`tools/runner-node/clock.mjs`).

Checked properties:

- `FrozenStandsStill`: a frozen clock reads its last move.
- `RunnerAgrees`: once the sync loop has no publication left to take, the runner holds the daemon's revision and mode.
- `SyncAtWallIsAccepted`: a sync of a clock that already shows the wall time is never refused as backwards.
- `NeverBackwardsUncounted`: the daemon clock never reads an earlier instant unless an allowed rewind was counted.
- `AppTimeMonotonic`: application time in the runner never goes back unless a counted rewind reached the runner.
- `FreezeKeepsTheInstant`: freezing does not move the clock.

Negative controls, each of which must fail:

- `ClockModeUnpublished.cfg`: a freeze that changes the mode without publishing violates `RunnerAgrees` (why `VirtualClock::freeze` and `resume` publish).
- `ClockModeSplitWallRead.cfg`: a sync that reads the wall clock for its target and samples the clock at a later reading violates `SyncAtWallIsAccepted` (why `read_wall` and `resume_at_wall` use one reading).
- `ClockModeNoRunnerFloor.cfg`: a runner that drops what it showed on a freeze frame violates `AppTimeMonotonic` (why the runner keeps the shown time as a floor and resets it only on a rewind the daemon counted).

```sh
tla2tools -workers 2 -config ClockMode.cfg ClockMode.tla               # no error (472,839 distinct states)
tla2tools -workers 2 -config ClockModeUnpublished.cfg ClockMode.tla    # RunnerAgrees violated
tla2tools -workers 2 -config ClockModeSplitWallRead.cfg ClockMode.tla  # SyncAtWallIsAccepted violated
tla2tools -workers 2 -config ClockModeNoRunnerFloor.cfg ClockMode.tla  # AppTimeMonotonic violated
```
