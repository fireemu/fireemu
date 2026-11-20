# ClockSettle

TLA+ model of settling one clock move (`FunctionsRuntime::sync_clock`) while a reload or a recovery swaps the runner generation, and while the outer settlement timeout (`settle_within`, `CLOCK_SETTLE_BOUND`) drops a runner's send (`Runner::sync_clock` and `invoke_inner`) at one of its await points: waiting for the stdin lock, in the middle of a frame write, or waiting for the acknowledgement. The replacement runner may have sampled the clock before the move. `ClockMode` covers the clock modes with one runner; this model covers only the runner swap and the cancellation.

Checked properties:

- `SettledReachesCurrent`: when settlement answers, the runner that is current then holds the move's revision.
- `NoStrandedWaiter`: after a dropped send, no waiter is left registered on a live runner for a frame that never reached it.
- `NoHalfFrameOnLiveRunner`: after a dropped send, no live runner keeps a pipe holding a half-written frame.

Negative controls, each of which must fail:

- `ClockSettleNoRecheck.cfg`: a pass that finishes without checking that its generation is still current violates `SettledReachesCurrent` (review r4, runner replacement during settlement).
- `ClockSettleStrandedWaiter.cfg`: a dropped send that keeps its waiter violates `NoStrandedWaiter`.
- `ClockSettleHalfFrame.cfg`: a dropped write that leaves the pipe in place violates `NoHalfFrameOnLiveRunner`.

The tests that pin the same cases in Rust: `settling_a_clock_move_reaches_a_runner_swapped_in_during_the_send` (crates/fireemu-adapter-functions/tests/runtime.rs) and the cancellation tests in `crates/fireemu-adapter-functions/src/runner.rs`.

```sh
tla2tools -workers 2 -config ClockSettle.cfg ClockSettle.tla   # no error (93 distinct states)
for c in NoRecheck StrandedWaiter HalfFrame; do
  tla2tools -workers 2 -config ClockSettle$c.cfg ClockSettle.tla  # each reports its property violated
done
```
