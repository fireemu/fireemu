# ClockMode

TLA+ model of switching the shared virtual clock between frozen and following real time while the daemon runs (`clock:freeze`, `clock:resume`, `clock:resume` with `syncToRealTime`), together with the clock ticker and the Functions runner sync loop (`FunctionsRuntime::sync_clock`), which repeats until the `(revision, following)` it sent is still the daemon's.

Checked properties:

- `FrozenStandsStill`: a frozen clock reads its last move.
- `RunnerAgrees`: once the sync loop has no publication left to take, the runners hold the daemon's revision and mode.
- `NeverBackwardsUncounted`: the clock never reads an earlier instant unless an allowed rewind was counted.
- `FreezeKeepsTheInstant`: freezing does not move the clock.

`ClockModeUnpublished.cfg` is the negative control: a freeze that changes the mode without publishing must violate `RunnerAgrees`, which is why `VirtualClock::freeze` and `resume` publish.

```sh
tla2tools -workers 2 -config ClockMode.cfg ClockMode.tla            # no error (75,084 distinct states)
tla2tools -workers 2 -config ClockModeUnpublished.cfg ClockMode.tla # RunnerAgrees violated
```
