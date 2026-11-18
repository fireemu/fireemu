---------------------------- MODULE ClockMode ----------------------------
(* Switching the shared virtual clock between frozen and following real time at runtime
   (clock:freeze, clock:resume, clock:resume with syncToRealTime), against the ticker that
   publishes the running time and the Functions runner sync loop that sends the daemon's
   instant and mode to a Node runner.

   The daemon side is VirtualClock under its mutex: every daemon step is one critical section.
   `real` is the time source; the wall clock reads `real` too (the daemon's source is wall
   nanoseconds since the epoch). `Live` is what a read of the daemon clock returns.

   A sync to real time either takes one reading for its target, comparison and anchor
   (OneWallRead, the implementation) or reads the wall clock for the target and samples the
   clock later (the reviewed defect). The runner keeps what application code was last shown
   as a floor (RunnerFloor, the implementation) or drops it on a freeze frame (the reviewed
   defect). *)
EXTENDS Integers

CONSTANTS MaxReal, MaxInstant, MaxRev, PublishModeChange, OneWallRead, RunnerFloor

VARIABLES now, following, at, real, rev, backwards,
          dirty, pc, seenRev, seenFollow, seenInstant, seenBack,
          runnerRev, runnerFollow, rInstant, rAt, rShown, rBack, appShown, rewound,
          syncPc, syncTarget, syncAllow, atWallAtRead, refusedAtWall

daemon == <<now, following, at, rev, backwards>>
loop == <<dirty, pc, seenRev, seenFollow, seenInstant, seenBack>>
runner == <<runnerRev, runnerFollow, rInstant, rAt, rShown, rBack, appShown, rewound>>
sync == <<syncPc, syncTarget, syncAllow, atWallAtRead, refusedAtWall>>
vars == <<daemon, real, loop, runner, sync>>

Live == IF following THEN now + (real - at) ELSE now
RLive == IF runnerFollow THEN rInstant + (real - rAt) ELSE rInstant
Max(a, b) == IF a >= b THEN a ELSE b

Init ==
  /\ now = 0 /\ following \in BOOLEAN /\ at = 0 /\ real = 0
  /\ rev = 0 /\ backwards = 0
  /\ dirty = FALSE /\ pc = "idle"
  /\ seenRev = 0 /\ seenFollow = following /\ seenInstant = 0 /\ seenBack = 0
  /\ runnerRev = 0 /\ runnerFollow = following /\ rInstant = 0 /\ rAt = 0
  /\ rShown = -1 /\ rBack = 0 /\ appShown = 0 /\ rewound = FALSE
  /\ syncPc = "idle" /\ syncTarget = 0 /\ syncAllow = FALSE
  /\ atWallAtRead = FALSE /\ refusedAtWall = FALSE

\* A publication moves the clock to `instant`, re-anchors it at `anchor` and marks the watch
\* channel. `back` counts an allowed rewind.
PublishAt(instant, mode, back, anchor) ==
  /\ now' = instant /\ following' = mode /\ at' = anchor
  /\ rev' = rev + 1 /\ backwards' = backwards + back
  /\ dirty' = TRUE
Publish(instant, mode, back) == PublishAt(instant, mode, back, real)

Others == <<pc, seenRev, seenFollow, seenInstant, seenBack>>

RealTimePasses ==
  /\ real < MaxReal /\ Live < MaxInstant
  /\ real' = real + 1
  /\ UNCHANGED <<daemon, loop, runner, sync>>

Ticker ==
  /\ syncPc = "idle" /\ following /\ Live > now /\ Publish(Live, TRUE, 0)
  /\ UNCHANGED <<real, Others, runner, sync>>

Freeze ==
  /\ syncPc = "idle" /\ following
  /\ IF PublishModeChange THEN Publish(Live, FALSE, 0)
     ELSE /\ now' = Live /\ following' = FALSE /\ at' = real
          /\ UNCHANGED <<rev, backwards, dirty>>
  /\ UNCHANGED <<real, Others, runner, sync>>

Resume ==
  /\ syncPc = "idle" /\ ~following /\ Publish(now, TRUE, 0)
  /\ UNCHANGED <<real, Others, runner, sync>>

Advance(d) ==
  /\ syncPc = "idle" /\ Live + d <= MaxInstant /\ Publish(Live + d, following, 0)
  /\ UNCHANGED <<real, Others, runner, sync>>

\* clock:set with allowBackwards: a counted rewind (keeps the mode).
Rewind(t) ==
  /\ syncPc = "idle" /\ t < Live /\ Publish(t, following, 1)
  /\ UNCHANGED <<real, Others, runner, sync>>

\* clock:resume {syncToRealTime}, one reading: the target, the comparison and the anchor are
\* the same `real`. A refusal changes nothing.
SyncOneRead(allow) ==
  /\ OneWallRead /\ syncPc = "idle"
  /\ IF real >= Live \/ allow
       THEN /\ PublishAt(real, TRUE, IF real < Live THEN 1 ELSE 0, real)
            /\ UNCHANGED refusedAtWall
       ELSE /\ UNCHANGED daemon /\ UNCHANGED dirty
            /\ refusedAtWall' = (refusedAtWall \/ Live = real)
  /\ UNCHANGED <<real, Others, runner, syncPc, syncTarget, syncAllow, atWallAtRead>>

\* The reviewed defect: the wall clock is read for the target first ...
SyncReadWall(allow) ==
  /\ ~OneWallRead /\ syncPc = "idle"
  /\ syncPc' = "read" /\ syncTarget' = real /\ syncAllow' = allow
  /\ atWallAtRead' = (Live = real)
  /\ UNCHANGED <<daemon, real, loop, runner, refusedAtWall>>

\* ... and the clock is sampled (and anchored) at a later reading.
SyncApply ==
  /\ syncPc = "read" /\ syncPc' = "idle"
  /\ IF syncTarget >= Live \/ syncAllow
       THEN /\ PublishAt(syncTarget, TRUE, IF syncTarget < Live THEN 1 ELSE 0, real)
            /\ UNCHANGED refusedAtWall
       ELSE /\ UNCHANGED daemon /\ UNCHANGED dirty
            /\ refusedAtWall' = (refusedAtWall \/ atWallAtRead)
  /\ UNCHANGED <<real, Others, runner, syncTarget, syncAllow, atWallAtRead>>

\* The Functions sync loop: take the publication, read (revision, mode, instant), send it, and
\* read again until nothing changed in between.
SyncStart ==
  /\ pc = "idle" /\ dirty
  /\ dirty' = FALSE /\ pc' = "send"
  /\ seenRev' = rev /\ seenFollow' = following /\ seenInstant' = Live /\ seenBack' = backwards
  /\ UNCHANGED <<daemon, real, runner, sync>>

\* The runner applies a frame when it arrives, re-anchoring at the real time of arrival.
\* A rewind the daemon counted resets what was shown; otherwise what was shown stays the floor
\* (RunnerFloor) or a freeze frame drops it (the reviewed defect).
SyncSend ==
  /\ pc = "send" /\ pc' = "check"
  /\ runnerRev' = seenRev /\ runnerFollow' = seenFollow
  /\ rInstant' = seenInstant /\ rAt' = real /\ rBack' = seenBack
  /\ rewound' = (rewound \/ seenBack > rBack)
  /\ rShown' = IF seenBack > rBack THEN -1
               ELSE IF ~RunnerFloor /\ ~seenFollow THEN -1
               ELSE rShown
  /\ UNCHANGED <<appShown, daemon, real, dirty, seenRev, seenFollow, seenInstant, seenBack, sync>>

SyncCheck ==
  /\ pc = "check"
  /\ IF <<rev, following>> = <<seenRev, seenFollow>>
       THEN pc' = "idle" /\ UNCHANGED <<seenRev, seenFollow, seenInstant, seenBack>>
       ELSE /\ pc' = "send" /\ seenRev' = rev /\ seenFollow' = following
            /\ seenInstant' = Live /\ seenBack' = backwards
  /\ UNCHANGED <<daemon, real, dirty, runner, sync>>

\* Application code reads Date.now() in the runner.
AppRead ==
  /\ appShown' = Max(RLive, rShown) /\ rShown' = Max(RLive, rShown) /\ rewound' = FALSE
  /\ UNCHANGED <<daemon, real, loop, runnerRev, runnerFollow, rInstant, rAt, rBack, sync>>

Next ==
  \/ RealTimePasses \/ Ticker \/ Freeze \/ Resume
  \/ \E d \in 0..1 : Advance(d)
  \/ \E t \in 0..MaxInstant : Rewind(t)
  \/ \E allow \in BOOLEAN : SyncOneRead(allow) \/ SyncReadWall(allow)
  \/ SyncApply
  \/ SyncStart \/ SyncSend \/ SyncCheck \/ AppRead

Spec == Init /\ [][Next]_vars

\* Bounds the search: every publication adds a revision.
Bounded == rev <= MaxRev

\* A frozen clock shows its last move.
FrozenStandsStill == ~following => Live = now

\* Once the loop has nothing left to take, the runner has the daemon's revision and mode.
RunnerAgrees == (pc = "idle" /\ ~dirty) => <<runnerRev, runnerFollow>> = <<rev, following>>

\* A sync of a clock that shows the wall time is never refused as going backwards.
SyncAtWallIsAccepted == ~refusedAtWall

\* The daemon clock never reads earlier unless an allowed rewind was counted.
NeverBackwardsUncounted == [][Live' >= Live \/ backwards' > backwards]_vars

\* Application time in the runner never goes back unless a counted rewind reached it.
AppTimeMonotonic == [][appShown' >= appShown \/ rewound]_vars

\* Freezing keeps the instant: the switch itself never moves the clock.
FreezeKeepsTheInstant == [][(following /\ ~following') => Live' = Live]_vars
=============================================================================
