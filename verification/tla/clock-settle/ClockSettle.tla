---------------------------- MODULE ClockSettle ----------------------------
(* Settling one clock move (FunctionsRuntime::sync_clock) while runners are swapped, crash and
   are recovered, while the outer settlement timeout (settle_within, CLOCK_SETTLE_BOUND) drops a
   send, while a clock frame runs past its own deadline, and with handlers dispatched before and
   after settlement answered.

   One codebase. The Rust scan checks the codebases one after another, each with the same check
   as here (is the runner the pass sent to still the current one, and did it acknowledge?), and
   the guarantee is per codebase at the moment it was checked; nothing in the check depends on
   another codebase, so one codebase is the whole check. Swaps and recoveries may also happen
   after settlement answered, which is why the settlement property is about the moment of the
   check and the dispatch property carries the rest.

   Runners have identities (a reload installs a new runner with a new revision, a recovery
   replaces the runner of the same revision; the Rust re-check compares the revision and the
   runner, so identity is what it sees). A replacement starts with a clock sampled before or
   after the move. A replaced runner is stopped on purpose (its pending send ends without an
   error) or kept running to drain its admitted work.

   Runner::sync_clock registers a waiter, takes the stdin lock, writes the frame and waits for
   the answer. A fully written frame is applied by a live runner whether or not anyone still
   waits; the reader then removes the waiter if one is left.

   Constants whose TRUE value is the implementation:
   - GenRecheck: a pass finishes only if the runner it sent to is still current (FALSE: the
     mutant that removes the re-check, review r4).
   - WaiterGuard: dropping a send removes its waiter (WaiterRegistration; FALSE: the code
     before the follow-up).
   - PipeGuard: dropping a write closes the pipe holding a half frame and retires the runner
     (FrameWrite; FALSE: the code before the follow-up).
   - ClockTimeoutCleanup: a clock frame past its own 5 s deadline gives up on its answer and
     removes its waiter (FALSE: it kept the waiter for a late answer nobody awaits).
   - DispatchSync: every dispatch syncs the clock of the runner it runs on first
     (sync_runner_clock; run_due syncs the runner it selected for the batch). Without it a runner
     installed after settlement answered, with a clock sampled before the move, would run a
     handler on the old clock.

   A runner stopped on purpose and left installed (a fixed-inspector restart; an unstarted
   placeholder behaves the same) answers a send without error and runs nothing until it is
   replaced; the check counts it as settled. Work admitted before the move and run later keeps
   the clock it was admitted with: AdmittedSeesSettled states that non-goal, and only the
   ClockSettleAdmittedWork configuration checks it, to show that it does not hold. *)
EXTENDS Integers

CONSTANTS GenRecheck, WaiterGuard, PipeGuard, ClockTimeoutCleanup, DispatchSync

Runners == 1..3
Target == 2
Before == 1

VARIABLES cur, nextR, alive, onPurpose, rrev, inbox, pipe, waiter,
          pc, seen, answered, cancelledIn, witness, settled, staleRun,
          admitted, staleAdmitted

vars == <<cur, nextR, alive, onPurpose, rrev, inbox, pipe, waiter,
          pc, seen, answered, cancelledIn, witness, settled, staleRun,
          admitted, staleAdmitted>>

Init ==
    /\ cur = 1
    /\ nextR = 2
    /\ alive = [r \in Runners |-> r = 1]
    /\ onPurpose = [r \in Runners |-> FALSE]
    \* Runner 1 has not seen the move yet.
    /\ rrev = [r \in Runners |-> Before]
    /\ inbox = [r \in Runners |-> FALSE]
    /\ pipe = [r \in Runners |-> "clean"]
    /\ waiter = [r \in Runners |-> FALSE]
    /\ pc = "snap"
    /\ seen = 1
    /\ answered = FALSE
    /\ cancelledIn = "none"
    /\ witness = FALSE
    /\ settled = FALSE
    /\ staleRun = FALSE
    \* Work admitted to runner 1 before the move, carrying the pre-move clock (0 once it ran).
    /\ admitted = Before
    /\ staleAdmitted = FALSE

Sending == pc \in {"lock", "writing", "await"}
Done == pc \in {"ok", "err", "cancelled", "timedout"}

runnerState == <<alive, onPurpose, rrev, inbox, pipe>>

\* A pass reads the current runner and registers the waiter of its frame.
Snap ==
    /\ pc = "snap"
    /\ seen' = cur
    /\ waiter' = [waiter EXCEPT ![cur] = TRUE]
    /\ answered' = FALSE
    /\ pc' = "lock"
    /\ UNCHANGED <<cur, nextR, runnerState, cancelledIn, witness, settled, staleRun>>

Lock ==
    /\ pc = "lock" /\ alive[seen] /\ pipe[seen] = "clean"
    /\ pc' = "writing"
    /\ pipe' = [pipe EXCEPT ![seen] = "half"]
    /\ UNCHANGED <<cur, nextR, alive, onPurpose, rrev, inbox, waiter,
                   seen, answered, cancelledIn, witness, settled, staleRun>>

Written ==
    /\ pc = "writing" /\ alive[seen]
    /\ pc' = "await"
    /\ pipe' = [pipe EXCEPT ![seen] = "clean"]
    /\ inbox' = [inbox EXCEPT ![seen] = TRUE]
    /\ UNCHANGED <<cur, nextR, alive, onPurpose, rrev, waiter,
                   seen, answered, cancelledIn, witness, settled, staleRun>>

\* A live runner applies a fully written frame; the reader hands the answer to a waiter left.
Apply(r) ==
    /\ inbox[r] /\ alive[r]
    /\ rrev' = [rrev EXCEPT ![r] = Target]
    /\ inbox' = [inbox EXCEPT ![r] = FALSE]
    /\ waiter' = [waiter EXCEPT ![r] = FALSE]
    /\ answered' = (answered \/ (waiter[r] /\ r = seen /\ pc = "await"))
    /\ UNCHANGED <<cur, nextR, alive, onPurpose, pipe, pc, seen, cancelledIn,
                   witness, settled, staleRun>>

Answered ==
    /\ pc = "await" /\ answered
    /\ pc' = "check"
    /\ UNCHANGED <<cur, nextR, runnerState, waiter, seen, answered, cancelledIn,
                   witness, settled, staleRun>>

\* The runner is gone: the reader drained its waiters; a failed write closed the pipe. A runner
\* stopped on purpose ends the send without an error, any other exit is an error.
Gone ==
    /\ Sending /\ ~alive[seen] /\ ~answered
    /\ waiter' = [waiter EXCEPT ![seen] = FALSE]
    /\ pipe' = IF pc = "writing" THEN [pipe EXCEPT ![seen] = "closed"] ELSE pipe
    /\ pc' = IF onPurpose[seen] THEN "check" ELSE "err"
    /\ UNCHANGED <<cur, nextR, alive, onPurpose, rrev, inbox, seen, answered,
                   cancelledIn, witness, settled, staleRun>>

\* The frame's own 5 s deadline passes without an answer: the clock call fails.
FrameTimeout ==
    /\ pc = "await" /\ ~answered
    /\ pc' = "timedout"
    /\ waiter' = IF ClockTimeoutCleanup THEN [waiter EXCEPT ![seen] = FALSE] ELSE waiter
    /\ UNCHANGED <<cur, nextR, runnerState, seen, answered, cancelledIn, witness,
                   settled, staleRun>>

\* The check of this codebase: one read of its current runner, after the send.
Check ==
    /\ pc = "check"
    \* A runner stopped on purpose runs nothing until it is replaced, so it counts as settled.
    /\ witness' = (seen = cur /\ (rrev[cur] >= Target \/ (~alive[cur] /\ onPurpose[cur])))
    /\ pc' = IF ~GenRecheck \/ seen = cur THEN "ok" ELSE "snap"
    /\ settled' = (settled \/ ~GenRecheck \/ seen = cur)
    /\ UNCHANGED <<cur, nextR, runnerState, waiter, seen, answered, cancelledIn, staleRun>>

\* A reload installs a new runner, started with the clock sampled before or after the move; the
\* replaced runner is stopped on purpose or kept running to drain.
Swap ==
    /\ nextR \in Runners
    /\ \E start \in {Before, Target}, drain \in BOOLEAN:
        /\ rrev' = [rrev EXCEPT ![nextR] = start]
        /\ alive' = [alive EXCEPT ![nextR] = TRUE, ![cur] = alive[cur] /\ drain]
        /\ onPurpose' = [onPurpose EXCEPT ![cur] = ~drain]
        /\ waiter' = IF drain THEN waiter ELSE [waiter EXCEPT ![cur] = FALSE]
    /\ cur' = nextR
    /\ nextR' = nextR + 1
    /\ UNCHANGED <<inbox, pipe, pc, seen, answered, cancelledIn, witness, settled, staleRun>>

\* The current runner is stopped on purpose and stays installed until a replacement comes (a
\* fixed-inspector restart); its reader drains its waiters.
Stop ==
    /\ alive[cur]
    /\ alive' = [alive EXCEPT ![cur] = FALSE]
    /\ onPurpose' = [onPurpose EXCEPT ![cur] = TRUE]
    /\ waiter' = [waiter EXCEPT ![cur] = FALSE]
    /\ UNCHANGED <<cur, nextR, rrev, inbox, pipe, pc, seen, answered, cancelledIn, witness,
                   settled, staleRun>>

\* A runner exits on its own; the reader drains its waiters.
Crash ==
    /\ alive[cur]
    /\ alive' = [alive EXCEPT ![cur] = FALSE]
    /\ waiter' = [waiter EXCEPT ![cur] = FALSE]
    /\ UNCHANGED <<cur, nextR, onPurpose, rrev, inbox, pipe, pc, seen, answered,
                   cancelledIn, witness, settled, staleRun>>

\* Recovery of a dead current runner (same generation revision, a new runner).
Recover ==
    /\ ~alive[cur] /\ nextR \in Runners
    /\ \E start \in {Before, Target}:
        /\ rrev' = [rrev EXCEPT ![nextR] = start]
    /\ alive' = [alive EXCEPT ![nextR] = TRUE]
    /\ cur' = nextR
    /\ nextR' = nextR + 1
    /\ UNCHANGED <<onPurpose, inbox, pipe, waiter, pc, seen, answered, cancelledIn,
                   witness, settled, staleRun>>

\* The outer timeout drops the send at one of its await points.
Cancel ==
    /\ Sending
    /\ pc' = "cancelled"
    /\ cancelledIn' = pc
    /\ waiter' = IF WaiterGuard THEN [waiter EXCEPT ![seen] = FALSE] ELSE waiter
    /\ IF PipeGuard /\ pc = "writing"
         THEN /\ pipe' = [pipe EXCEPT ![seen] = "closed"]
              /\ alive' = [alive EXCEPT ![seen] = FALSE]
         ELSE UNCHANGED <<pipe, alive>>
    /\ UNCHANGED <<cur, nextR, onPurpose, rrev, inbox, seen, answered, witness,
                   settled, staleRun>>

\* A handler runs on the current runner, after a clock sync when DispatchSync holds.
Dispatch ==
    /\ alive[cur]
    /\ LET used == IF DispatchSync THEN Target ELSE rrev[cur]
       IN /\ rrev' = [rrev EXCEPT ![cur] = used]
          /\ staleRun' = (staleRun \/ (settled /\ used < Target))
    /\ UNCHANGED <<cur, nextR, alive, onPurpose, inbox, pipe, waiter, pc, seen, answered,
                   cancelledIn, witness, settled>>

\* Admitted work runs later with the clock it was admitted with (a draining runner).
RunAdmitted ==
    /\ admitted # 0
    /\ staleAdmitted' = (staleAdmitted \/ (settled /\ admitted < Target))
    /\ admitted' = 0

Core ==
    \/ Snap \/ Lock \/ Written \/ Answered \/ Gone \/ FrameTimeout \/ Check \/ Cancel
    \/ \E r \in Runners: Apply(r)
    \/ Swap \/ Stop \/ Crash \/ Recover \/ Dispatch

Next ==
    \/ Core /\ UNCHANGED <<admitted, staleAdmitted>>
    \/ RunAdmitted /\ UNCHANGED <<cur, nextR, alive, onPurpose, rrev, inbox, pipe,
          waiter, pc, seen, answered, cancelledIn, witness, settled, staleRun>>

Spec == Init /\ [][Next]_vars

\* When settlement answers, the runner its check read was the one the pass sent to, and it had
\* acknowledged the move at that moment (later swaps are not this property's business).
SettledChecksCurrent == pc = "ok" => witness

\* A caller that gave up on its frame (dropped by the outer timeout, or past its own deadline)
\* leaves no waiter behind, also when the frame was written in full.
NoOrphanWaiter == pc \in {"cancelled", "timedout"} => ~waiter[seen]

\* A write dropped in the middle closes the pipe itself.
CancelledWriteClosesPipe == (pc = "cancelled" /\ cancelledIn = "writing") => pipe[seen] = "closed"

\* No live runner holds a half frame, except the one being written to right now.
NoHalfFrameOnLiveRunner ==
    \A r \in Runners: (alive[r] /\ pipe[r] = "half") => (pc = "writing" /\ seen = r)

\* No handler dispatched after the move runs with a clock older than the last settled move.
DispatchSeesSettled == ~staleRun

\* Non-goal: work admitted before the move and run after it was settled sees the settled clock.
AdmittedSeesSettled == ~staleAdmitted

TypeOK ==
    /\ cur \in Runners /\ seen \in Runners /\ nextR \in 2..4
    /\ pc \in {"snap", "lock", "writing", "await", "check", "ok", "err", "cancelled", "timedout"}
    /\ cancelledIn \in {"none", "lock", "writing", "await"}
    /\ \A r \in Runners: pipe[r] \in {"clean", "half", "closed"} /\ rrev[r] \in {Before, Target}
=============================================================================
