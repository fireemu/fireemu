# ClockSettle

TLA+ model of settling one clock move (`FunctionsRuntime::sync_clock`) while runners are swapped by a reload (the replaced runner stopped on purpose or kept running to drain), crash and are recovered, while the outer settlement timeout (`settle_within`, `CLOCK_SETTLE_BOUND`) drops a runner's send (`Runner::sync_clock` and `invoke_inner`) at one of its await points (the stdin lock, the middle of a frame write, the answer), while a clock frame runs past its own 5 s deadline, and with handlers dispatched before and after settlement answered. A replacement starts with a clock sampled before or after the move. Runners have identities, because the Rust re-check compares the generation revision and the runner, and a recovery replaces the runner without a new revision. `ClockMode` covers the clock modes with one runner; this model covers only settlement.

What settlement guarantees, and what it leaves to dispatch:

- An `Ok` means that every runner generation the final scan checked was, at the moment it was checked, the one the pass had sent to, and that it had acknowledged the move's revision. The Rust scan checks the codebases one after another, not atomically. The model has one codebase because each codebase's check reads only that codebase, so the per-codebase property is exactly the model's `SettledChecksCurrent`, recorded at the moment of the check.
- A runner installed after its codebase was checked is not covered by settlement. The reload path samples the clock before it awaits the process start and installs the runner without a clock push, so a runner can become current with the pre-move clock after settlement answered OK. The model allows swaps and recoveries after `ok` for this reason. Handlers still never run on that old clock, because every dispatch syncs the runner's clock first (`sync_runner_clock`; timer batches go through `run_due`, which settles first). `DispatchSeesSettled` checks that, and `ClockSettleNoDispatchSync.cfg` shows that it depends on the sync before dispatch. Do not remove that sync on the strength of the settlement property.
- Known limit, not modelled as a failure: a runner replaced while the pass is sending to it, and kept running to drain its admitted work, still owes the pass an answer within its own 5 s frame deadline. If it gives none, the settlement fails with that error before the re-check could skip it.
- A runner retired by a dropped half write is not stopped on purpose. Later clock calls with something to send fail at once (503 `CLOCK_NOT_SETTLED` at the control API) until function work recovers the runner on demand under the restart policy. Settlement does not start a recovery. The model's `Gone` step gives such a runner an error.

Checked properties:

- `SettledChecksCurrent`: when settlement answers, the runner its check read was the one the pass sent to, and it had acknowledged the move then.
- `NoOrphanWaiter`: a caller that gave up on its frame (dropped by the outer timeout, or past its own deadline) leaves no waiter behind, also when the frame was written in full.
- `CancelledWriteClosesPipe`: a write dropped in the middle closes the pipe itself.
- `NoHalfFrameOnLiveRunner`: no live runner holds a half frame, except the one being written to right now.
- `DispatchSeesSettled`: no handler runs with a clock older than the last settled move.

Negative controls, each of which must fail:

- `ClockSettleNoRecheck.cfg`: a pass that finishes without checking that its runner is still current violates `SettledChecksCurrent` (review r4, runner replacement during settlement).
- `ClockSettleStrandedWaiter.cfg`: a dropped send that keeps its waiter violates `NoOrphanWaiter`.
- `ClockSettleHalfFrame.cfg`: a dropped write that leaves the pipe in place violates `CancelledWriteClosesPipe`.
- `ClockSettleTimeoutLeak.cfg`: a clock frame past its own deadline that keeps its waiter for an answer nobody awaits violates `NoOrphanWaiter`.
- `ClockSettleNoDispatchSync.cfg`: a dispatch without a clock sync first violates `DispatchSeesSettled`.

The Rust tests for the same cases are in `crates/fireemu-adapter-functions`:

- `settling_a_clock_move_reaches_a_runner_swapped_in_during_the_send` and `a_clock_call_after_a_retired_half_write_fails_until_a_dispatch_recovers_the_runner`, both in `tests/runtime.rs`.
- `a_send_dropped_while_waiting_for_stdin_leaves_no_waiter`, `a_send_dropped_in_the_middle_of_a_frame_retires_the_pipe`, `a_send_dropped_while_waiting_for_its_answer_leaves_no_waiter` and `a_clock_frame_past_its_deadline_leaves_no_waiter`, all in `src/runner.rs`.

```sh
tla2tools -workers 2 -config ClockSettle.cfg ClockSettle.tla   # no error (11,138 distinct states)
for c in NoRecheck StrandedWaiter HalfFrame TimeoutLeak NoDispatchSync; do
  tla2tools -workers 2 -config ClockSettle$c.cfg ClockSettle.tla  # each reports its property violated
done
```
