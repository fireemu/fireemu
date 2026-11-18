---------------------------- MODULE ClockMode ----------------------------
(* Switching the shared virtual clock between frozen and following real time at runtime
   (clock:freeze, clock:resume), against the ticker that publishes the running time and the
   Functions runner sync loop that copies (revision, following) to the runners.

   The daemon side is VirtualClock under its mutex: every step below is one critical section.
   `live` is what a read returns: the last move plus the real time since, when following.
   The sync loop is FunctionsRuntime::sync_clock: read (revision, following), send it to the
   runner, read again, and repeat until the two reads agree. `dirty` stands for the watch
   channel: every publication marks it, and the loop starts by taking it. *)
EXTENDS Integers

CONSTANTS MaxReal, MaxInstant, MaxRev, PublishModeChange

VARIABLES now, following, at, real, rev, backwards,
          dirty, pc, seenRev, seenFollow, runnerRev, runnerFollow

vars == <<now, following, at, real, rev, backwards,
          dirty, pc, seenRev, seenFollow, runnerRev, runnerFollow>>

Live == IF following THEN now + (real - at) ELSE now

Init ==
  /\ now = 0 /\ following \in BOOLEAN /\ at = 0 /\ real = 0
  /\ rev = 0 /\ backwards = 0
  /\ dirty = FALSE /\ pc = "idle"
  /\ seenRev = 0 /\ seenFollow = following
  /\ runnerRev = 0 /\ runnerFollow = following

daemonOnly == <<pc, seenRev, seenFollow, runnerRev, runnerFollow>>

\* A publication folds the running time in and re-anchors at the current real time.
Publish(instant, mode, back) ==
  /\ now' = instant /\ following' = mode /\ at' = real
  /\ rev' = rev + 1 /\ backwards' = backwards + back
  /\ dirty' = TRUE
  /\ UNCHANGED <<real>> /\ UNCHANGED daemonOnly

RealTimePasses ==
  /\ real < MaxReal /\ Live < MaxInstant
  /\ real' = real + 1
  /\ UNCHANGED <<now, following, at, rev, backwards, dirty>> /\ UNCHANGED daemonOnly

Ticker == following /\ Live > now /\ Publish(Live, TRUE, 0)

Freeze ==
  /\ following
  /\ IF PublishModeChange THEN Publish(Live, FALSE, 0)
     ELSE /\ now' = Live /\ following' = FALSE /\ at' = real
          /\ UNCHANGED <<real, rev, backwards, dirty>> /\ UNCHANGED daemonOnly

Resume == ~following /\ Publish(now, TRUE, 0)

\* clock:resume {syncToRealTime}: a set to `t` that also starts following; backwards only
\* with allowBackwards. A refused one changes nothing, so it is no step at all.
ResumeAt(t, allow) ==
  /\ (t >= Live \/ allow)
  /\ Publish(t, TRUE, IF t < Live THEN 1 ELSE 0)

Advance(d) == Live + d <= MaxInstant /\ Publish(Live + d, following, 0)

SyncStart ==
  /\ pc = "idle" /\ dirty
  /\ dirty' = FALSE /\ pc' = "send"
  /\ seenRev' = rev /\ seenFollow' = following
  /\ UNCHANGED <<now, following, at, real, rev, backwards, runnerRev, runnerFollow>>

SyncSend ==
  /\ pc = "send"
  /\ runnerRev' = seenRev /\ runnerFollow' = seenFollow /\ pc' = "check"
  /\ UNCHANGED <<now, following, at, real, rev, backwards, dirty, seenRev, seenFollow>>

SyncCheck ==
  /\ pc = "check"
  /\ IF <<rev, following>> = <<seenRev, seenFollow>>
       THEN pc' = "idle" /\ UNCHANGED <<seenRev, seenFollow>>
       ELSE pc' = "send" /\ seenRev' = rev /\ seenFollow' = following
  /\ UNCHANGED <<now, following, at, real, rev, backwards, dirty, runnerRev, runnerFollow>>

Next ==
  \/ RealTimePasses \/ Ticker \/ Freeze \/ Resume
  \/ \E t \in 0..MaxInstant, allow \in BOOLEAN : ResumeAt(t, allow)
  \/ \E d \in 0..1 : Advance(d)
  \/ SyncStart \/ SyncSend \/ SyncCheck

Spec == Init /\ [][Next]_vars

\* Bounds the search: every publication adds a revision.
Bounded == rev <= MaxRev

\* A frozen clock shows its last move; nothing but a move or a resume changes it.
FrozenStandsStill == ~following => Live = now

\* Once the loop has nothing left to take, the runner has the daemon's revision and mode.
RunnerAgrees == (pc = "idle" /\ ~dirty) => <<runnerRev, runnerFollow>> = <<rev, following>>

\* The clock never shows an earlier instant unless a rewind was allowed and counted.
NeverBackwardsUncounted == [][Live' >= Live \/ backwards' = backwards + 1]_vars

\* Freezing keeps the instant: the switch itself never moves the clock.
FreezeKeepsTheInstant == [][(following /\ ~following' /\ rev' <= rev + 1 /\ backwards' = backwards) => Live' = Live]_vars
=============================================================================
