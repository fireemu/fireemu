---------------------------- MODULE ClockSettle ----------------------------
(* Settling one clock move across a runner swap and an outer cancellation.

   FunctionsRuntime::sync_clock captures the move's revision (Target), then repeats a pass:
   read the current runner generation, send it the clock (Runner::sync_clock, which registers
   a stdin waiter, takes the stdin lock, writes the frame and waits for the acknowledgement),
   and finish only if the generation it sent to is still current. A reload or a recovery can
   install a replacement runner at any time; the replacement sampled the clock before it
   started, so it may still hold the revision before the move. The old runner is stopped on
   purpose, so its pending send ends without an error.

   The whole wait runs under an outer timeout (settle_within, CLOCK_SETTLE_BOUND) that can drop
   the send at any of its await points: waiting for the stdin lock, in the middle of a frame
   write, or waiting for the acknowledgement.

   Constants whose TRUE value is the implementation:
   - GenRecheck: a pass finishes only if the generation it sent to is still current
     (FALSE: the mutant that removes the re-check, review r4 Should 1).
   - CancelGuard: dropping a send removes its waiter and retires a pipe holding a half frame
     (FALSE: the code before the follow-up, review r4 Should 2). *)
EXTENDS Integers

CONSTANTS GenRecheck, CancelGuard

Gens == {1, 2}
Target == 2

VARIABLES gen, swapped, rrev, alive, waiter, pipe, frameSent, pc, seen

vars == <<gen, swapped, rrev, alive, waiter, pipe, frameSent, pc, seen>>

Init ==
    /\ gen = 1
    /\ swapped = FALSE
    \* Runner 1 has not seen the move yet; runner 2 does not exist until the swap.
    /\ rrev = [g \in Gens |-> 1]
    /\ alive = [g \in Gens |-> g = 1]
    /\ waiter = [g \in Gens |-> FALSE]
    /\ pipe = [g \in Gens |-> "clean"]
    /\ frameSent = [g \in Gens |-> FALSE]
    /\ pc = "snap"
    /\ seen = 1

Sending == pc \in {"lock", "writing", "await"}

\* A pass reads the current generation and registers the waiter of its frame.
Snap ==
    /\ pc = "snap"
    /\ seen' = gen
    /\ waiter' = [waiter EXCEPT ![gen] = TRUE]
    /\ frameSent' = [frameSent EXCEPT ![gen] = FALSE]
    /\ pc' = "lock"
    /\ UNCHANGED <<gen, swapped, rrev, alive, pipe>>

Lock ==
    /\ pc = "lock" /\ alive[seen]
    /\ pc' = "writing"
    /\ pipe' = [pipe EXCEPT ![seen] = "half"]
    /\ UNCHANGED <<gen, swapped, rrev, alive, waiter, frameSent, seen>>

Written ==
    /\ pc = "writing" /\ alive[seen]
    /\ pc' = "await"
    /\ pipe' = [pipe EXCEPT ![seen] = "clean"]
    /\ frameSent' = [frameSent EXCEPT ![seen] = TRUE]
    /\ UNCHANGED <<gen, swapped, rrev, alive, waiter, seen>>

Ack ==
    /\ pc = "await" /\ alive[seen]
    /\ rrev' = [rrev EXCEPT ![seen] = Target]
    /\ waiter' = [waiter EXCEPT ![seen] = FALSE]
    /\ pc' = "check"
    /\ UNCHANGED <<gen, swapped, alive, pipe, frameSent, seen>>

\* The runner was stopped on purpose: its waiter is drained and the send ends without error.
Gone ==
    /\ Sending /\ ~alive[seen]
    /\ waiter' = [waiter EXCEPT ![seen] = FALSE]
    /\ pc' = "check"
    /\ UNCHANGED <<gen, swapped, rrev, alive, pipe, frameSent, seen>>

Check ==
    /\ pc = "check"
    /\ pc' = IF ~GenRecheck \/ seen = gen THEN "ok" ELSE "snap"
    /\ UNCHANGED <<gen, swapped, rrev, alive, waiter, pipe, frameSent, seen>>

\* A reload or recovery installs runner 2, started with a clock sampled before or after the
\* move, and stops runner 1 on purpose (its reader drains runner 1's waiters).
Swap ==
    /\ ~swapped /\ pc \notin {"ok", "cancelled"}
    /\ \E start \in {1, Target}:
        rrev' = [rrev EXCEPT ![2] = start]
    /\ gen' = 2
    /\ swapped' = TRUE
    /\ alive' = [alive EXCEPT ![1] = FALSE, ![2] = TRUE]
    /\ waiter' = [waiter EXCEPT ![1] = FALSE]
    /\ UNCHANGED <<pipe, frameSent, pc, seen>>

\* The outer timeout drops the send at one of its await points.
Cancel ==
    /\ Sending
    /\ pc' = "cancelled"
    /\ IF CancelGuard
         THEN /\ waiter' = [waiter EXCEPT ![seen] = FALSE]
              /\ IF pipe[seen] = "half"
                   THEN /\ pipe' = [pipe EXCEPT ![seen] = "retired"]
                        /\ alive' = [alive EXCEPT ![seen] = FALSE]
                   ELSE UNCHANGED <<pipe, alive>>
         ELSE UNCHANGED <<waiter, pipe, alive>>
    /\ UNCHANGED <<gen, swapped, rrev, frameSent, seen>>

\* After a cancellation a frame that was written in full is still answered; the reader removes
\* its waiter. A frame that never reached the runner gets no answer.
LateAck ==
    /\ pc = "cancelled" /\ alive[seen] /\ frameSent[seen] /\ waiter[seen]
    /\ waiter' = [waiter EXCEPT ![seen] = FALSE]
    /\ UNCHANGED <<gen, swapped, rrev, alive, pipe, frameSent, pc, seen>>

Next == Snap \/ Lock \/ Written \/ Ack \/ Gone \/ Check \/ Swap \/ Cancel \/ LateAck

Spec == Init /\ [][Next]_vars

\* A settled move has reached the runner that is current when settlement answers.
SettledReachesCurrent == pc = "ok" => rrev[gen] >= Target

\* Once the send was dropped and no step can still answer it, no waiter is left registered on a
\* live runner (only a fully written frame is still answered, by LateAck).
NoStrandedWaiter ==
    pc = "cancelled" => \A g \in Gens: ~(alive[g] /\ waiter[g] /\ ~frameSent[g])

\* A live runner never keeps a pipe with a half-written frame once its writer is gone.
NoHalfFrameOnLiveRunner ==
    pc = "cancelled" => \A g \in Gens: ~(alive[g] /\ pipe[g] = "half")

TypeOK ==
    /\ gen \in Gens /\ seen \in Gens
    /\ pc \in {"snap", "lock", "writing", "await", "check", "ok", "cancelled"}
    /\ \A g \in Gens: pipe[g] \in {"clean", "half", "retired"} /\ rrev[g] \in {1, Target}
=============================================================================
