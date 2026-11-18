---------------------------- MODULE ClockMode ----------------------------
(* Switching the shared virtual clock between frozen and following real time at runtime
   (clock:freeze, clock:resume, clock:resume with syncToRealTime), against the ticker that
   publishes the running time and the Functions runner sync loop that sends the daemon's
   instant, mode and elapsed time to a Node runner.

   The daemon side is VirtualClock under its mutex: every daemon step is one critical section.
   `wall` is the daemon's time source, the host wall clock, which can step back (an NTP
   correction); the wall instant of a reading is the reading itself. A following clock holds at
   its high-water mark (`peak`) while the source is behind it. `mono` is the runner's monotonic
   clock (process.hrtime), which never steps back.

   Defects the reviews found, each behind a constant whose TRUE value is the implementation:
   - OneWallRead: a sync reads the wall clock once for its target, comparison and anchor
     (FALSE: the target is read first and the clock sampled later).
   - RawAnchor: an accepted sync anchors at the raw wall reading (FALSE: at the anchor plus the
     held drift, which leaves the clock behind the wall after a step back).
   - RunnerFloor: the runner keeps the Date it showed as a floor across a late freeze frame
     (FALSE: it drops it on a freeze frame).
   - ElapsedFloor: the runner keeps the timer elapsed time it counted as a floor (FALSE: it
     takes the daemon's elapsed time as is).
   - PublishModeChange: freeze and resume publish (FALSE: the mode changes silently). *)
EXTENDS Integers

CONSTANTS MaxWall, MaxInstant, MaxRev, MaxSteps,
          PublishModeChange, OneWallRead, RawAnchor, RunnerFloor, ElapsedFloor

VARIABLES now, following, at, peak, elapsed, rev, backwards,
          wall, mono, steps,
          dirty, pc, seenRev, seenFollow, seenInstant, seenBack, seenElapsed,
          runnerRev, runnerFollow, rInstant, rAt, rShown, rBack, rElapsed, rFloor,
          appShown, timerSeen, rewound,
          syncPc, syncTarget, syncAllow, atWallAtRead, refusedAtWall, synced

daemon == <<now, following, at, peak, elapsed, rev, backwards>>
time == <<wall, mono, steps>>
loop == <<dirty, pc, seenRev, seenFollow, seenInstant, seenBack, seenElapsed>>
runner == <<runnerRev, runnerFollow, rInstant, rAt, rShown, rBack, rElapsed, rFloor,
            appShown, timerSeen, rewound>>
sync == <<syncPc, syncTarget, syncAllow, atWallAtRead, refusedAtWall, synced>>
vars == <<daemon, time, loop, runner, sync>>

Max(a, b) == IF a >= b THEN a ELSE b

\* What a read of the daemon clock returns: the drift held at the high-water mark.
Drift == IF following THEN Max(wall - at, peak) ELSE 0
Live == now + Drift
\* The elapsed time a read reports: forward movement only.
ElapsedLive == elapsed + Drift

RLive == IF runnerFollow THEN rInstant + (mono - rAt) ELSE rInstant
RElapsedLive == Max(rElapsed + (IF runnerFollow THEN mono - rAt ELSE 0), rFloor)

Init ==
  /\ now = 0 /\ following \in BOOLEAN /\ at = 0 /\ peak = 0 /\ elapsed = 0
  /\ rev = 0 /\ backwards = 0
  /\ wall = 0 /\ mono = 0 /\ steps = 0
  /\ dirty = FALSE /\ pc = "idle"
  /\ seenRev = 0 /\ seenFollow = following /\ seenInstant = 0 /\ seenBack = 0
  /\ seenElapsed = 0
  /\ runnerRev = 0 /\ runnerFollow = following /\ rInstant = 0 /\ rAt = 0
  /\ rShown = -1 /\ rBack = 0 /\ rElapsed = 0 /\ rFloor = 0
  /\ appShown = 0 /\ timerSeen = 0 /\ rewound = FALSE
  /\ syncPc = "idle" /\ syncTarget = 0 /\ syncAllow = FALSE
  /\ atWallAtRead = FALSE /\ refusedAtWall = FALSE /\ synced = FALSE

\* A publication moves the clock to `instant`, folds the drift into elapsed (plus any forward
\* hand move), re-anchors at `anchor` and marks the watch channel.
PublishAt(instant, mode, back, anchor) ==
  /\ now' = instant /\ following' = mode /\ at' = anchor /\ peak' = 0
  /\ elapsed' = elapsed + Drift + Max(instant - Live, 0)
  /\ rev' = rev + 1 /\ backwards' = backwards + back
  /\ dirty' = TRUE
Publish(instant, mode, back) == PublishAt(instant, mode, back, at + Drift)

Others == <<pc, seenRev, seenFollow, seenInstant, seenBack, seenElapsed>>
Keep == <<Others, runner>>

RealTimePasses ==
  /\ wall < MaxWall /\ Live < MaxInstant
  /\ wall' = wall + 1 /\ mono' = mono + 1
  /\ peak' = IF following THEN Max(peak, wall' - at) ELSE peak
  /\ UNCHANGED <<now, following, at, elapsed, rev, backwards, steps, loop, runner, sync>>

\* The host clock steps back by one; the runner's monotonic clock does not.
WallStepsBack ==
  /\ steps < MaxSteps /\ wall > 0
  /\ wall' = wall - 1 /\ steps' = steps + 1
  /\ synced' = FALSE
  /\ UNCHANGED <<daemon, mono, loop, runner, syncPc, syncTarget, syncAllow,
                 atWallAtRead, refusedAtWall>>

DaemonStep(p) ==
  /\ syncPc = "idle" /\ p
  /\ synced' = FALSE
  /\ UNCHANGED <<time, Keep, syncPc, syncTarget, syncAllow, atWallAtRead, refusedAtWall>>

Ticker == DaemonStep(following /\ Live > now /\ Publish(Live, TRUE, 0))

Freeze == DaemonStep(
  /\ following
  /\ IF PublishModeChange THEN Publish(Live, FALSE, 0)
     ELSE /\ now' = Live /\ following' = FALSE /\ at' = wall /\ peak' = 0
          /\ elapsed' = elapsed + Drift
          /\ UNCHANGED <<rev, backwards, dirty>>)

Resume == DaemonStep(~following /\ PublishAt(now, TRUE, 0, wall))

Advance(d) == DaemonStep(Live + d <= MaxInstant /\ Publish(Live + d, following, 0))

\* clock:set with allowBackwards: a counted rewind (keeps the mode).
Rewind(t) == DaemonStep(t < Live /\ Publish(t, following, 1))

\* The anchor an accepted sync runs from.
SyncAnchor(reading) == IF RawAnchor THEN reading ELSE IF following THEN at + Drift ELSE reading

\* clock:resume {syncToRealTime}, one reading: the target, the comparison and the anchor are
\* the same wall reading. A refusal changes nothing.
SyncOneRead(allow) ==
  /\ OneWallRead /\ syncPc = "idle"
  /\ IF wall >= Live \/ allow
       THEN /\ PublishAt(wall, TRUE, IF wall < Live THEN 1 ELSE 0, SyncAnchor(wall))
            /\ synced' = TRUE /\ UNCHANGED refusedAtWall
       ELSE /\ UNCHANGED <<daemon, dirty, synced>>
            /\ refusedAtWall' = (refusedAtWall \/ Live = wall)
  /\ UNCHANGED <<time, Keep, syncPc, syncTarget, syncAllow, atWallAtRead>>

\* The reviewed defect: the wall clock is read for the target first ...
SyncReadWall(allow) ==
  /\ ~OneWallRead /\ syncPc = "idle"
  /\ syncPc' = "read" /\ syncTarget' = wall /\ syncAllow' = allow
  /\ atWallAtRead' = (Live = wall)
  /\ UNCHANGED <<daemon, time, loop, runner, refusedAtWall, synced>>

\* ... and the clock is sampled (and anchored) at a later reading.
SyncApply ==
  /\ syncPc = "read" /\ syncPc' = "idle"
  /\ IF syncTarget >= Live \/ syncAllow
       THEN /\ PublishAt(syncTarget, TRUE, IF syncTarget < Live THEN 1 ELSE 0, wall)
            /\ UNCHANGED <<refusedAtWall, synced>>
       ELSE /\ UNCHANGED <<daemon, dirty, synced>>
            /\ refusedAtWall' = (refusedAtWall \/ atWallAtRead)
  /\ UNCHANGED <<time, Keep, syncTarget, syncAllow, atWallAtRead>>

\* The Functions sync loop: take the publication, read (revision, mode, instant, elapsed),
\* send it, and read again until nothing changed in between.
SyncStart ==
  /\ pc = "idle" /\ dirty
  /\ dirty' = FALSE /\ pc' = "send"
  /\ seenRev' = rev /\ seenFollow' = following /\ seenInstant' = Live
  /\ seenBack' = backwards /\ seenElapsed' = ElapsedLive
  /\ UNCHANGED <<daemon, time, runner, sync>>

\* The runner applies a frame when it arrives, re-anchoring on its monotonic clock. A rewind
\* the daemon counted resets what was shown; otherwise what was shown stays the floor. Timer
\* elapsed time keeps what the runner had counted as its floor.
SyncSend ==
  /\ pc = "send" /\ pc' = "check"
  /\ runnerRev' = seenRev /\ runnerFollow' = seenFollow
  /\ rInstant' = seenInstant /\ rAt' = mono /\ rBack' = seenBack
  /\ rElapsed' = seenElapsed
  /\ rFloor' = IF ElapsedFloor THEN RElapsedLive ELSE 0
  /\ rewound' = (rewound \/ seenBack > rBack)
  /\ rShown' = IF seenBack > rBack THEN -1
               ELSE IF ~RunnerFloor /\ ~seenFollow THEN -1
               ELSE rShown
  /\ UNCHANGED <<appShown, timerSeen, daemon, time, dirty, seenRev, seenFollow, seenInstant,
                 seenBack, seenElapsed, sync>>

SyncCheck ==
  /\ pc = "check"
  /\ IF <<rev, following>> = <<seenRev, seenFollow>>
       THEN pc' = "idle" /\ UNCHANGED <<seenRev, seenFollow, seenInstant, seenBack, seenElapsed>>
       ELSE /\ pc' = "send" /\ seenRev' = rev /\ seenFollow' = following
            /\ seenInstant' = Live /\ seenBack' = backwards /\ seenElapsed' = ElapsedLive
  /\ UNCHANGED <<daemon, time, dirty, runner, sync>>

\* Application code reads Date.now() and a timer compares its deadline in the runner.
AppRead ==
  /\ appShown' = Max(RLive, rShown) /\ rShown' = Max(RLive, rShown) /\ rewound' = FALSE
  /\ timerSeen' = RElapsedLive
  /\ UNCHANGED <<daemon, time, loop, runnerRev, runnerFollow, rInstant, rAt, rBack,
                 rElapsed, rFloor, sync>>

Next ==
  \/ RealTimePasses \/ WallStepsBack \/ Ticker \/ Freeze \/ Resume
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

\* After a sync, until the wall steps back or the clock is moved again, it shows the wall time.
SyncedFollowsWall == synced => Live = wall

\* The daemon clock never reads earlier unless an allowed rewind was counted.
NeverBackwardsUncounted == [][Live' >= Live \/ backwards' > backwards]_vars

\* Application time in the runner never goes back unless a counted rewind reached it.
AppTimeMonotonic == [][appShown' >= appShown \/ rewound]_vars

\* Timer elapsed time in the runner never goes back.
TimerElapsedMonotonic == [][timerSeen' >= timerSeen]_vars

\* Freezing keeps the instant: the switch itself never moves the clock.
FreezeKeepsTheInstant == [][(following /\ ~following') => Live' = Live]_vars
=============================================================================
