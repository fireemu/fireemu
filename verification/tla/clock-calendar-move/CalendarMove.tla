---------------------------- MODULE CalendarMove ----------------------------
EXTENDS Integers

CONSTANTS LastInstant, SingleSample
VARIABLES live, sampled, kind, argument, allowRewind, status, published, revision, rewinds
vars == <<live, sampled, kind, argument, allowRewind, status, published, revision, rewinds>>

InRange(t) == t \in 0..LastInstant
Target(t) == IF kind = "relative" THEN t + argument ELSE argument
Allowed(t, start) == InRange(t) /\ (t >= start \/ allowRewind)

Init ==
    /\ live \in 0..LastInstant
    /\ sampled = live /\ published = live
    /\ kind \in {"relative", "anchor"}
    /\ argument \in (-1)..(LastInstant + 1)
    /\ allowRewind \in BOOLEAN
    /\ status = "planned" /\ revision = 0 /\ rewinds = 0

\* A running clock can advance during planning. This does not change the recorded sample.
Tick ==
    /\ live < LastInstant + 1 /\ live' = live + 1
    /\ UNCHANGED <<sampled, kind, argument, allowRewind, status, published, revision, rewinds>>

\* The old path validated the plan before asking the clock to apply it with a fresh reading.
Commit ==
    /\ status = "planned"
    /\ LET target == Target(IF SingleSample THEN sampled ELSE live)
           accepts == Allowed(Target(sampled), sampled)
                      /\ (SingleSample \/ kind = "relative" \/ target >= live \/ Target(sampled) < sampled)
       IN IF accepts
          THEN /\ status' = "accepted" /\ published' = target /\ revision' = 1
               /\ rewinds' = IF target < (IF SingleSample THEN sampled ELSE live) THEN 1 ELSE 0
          ELSE /\ status' = "refused" /\ UNCHANGED <<published, revision, rewinds>>
    /\ UNCHANGED <<live, sampled, kind, argument, allowRewind>>

Terminal == status # "planned" /\ UNCHANGED vars
Spec == Init /\ [][Tick \/ Commit \/ Terminal]_vars

CheckedPublication ==
    status = "accepted" => InRange(published) /\ published = Target(sampled)
RefusalPreservesState ==
    status = "refused" => published = sampled /\ revision = 0 /\ rewinds = 0
SampledDecision ==
    /\ (status = "accepted" => Allowed(Target(sampled), sampled) /\ revision = 1
         /\ rewinds = (IF Target(sampled) < sampled THEN 1 ELSE 0))
    /\ (status = "refused" => ~Allowed(Target(sampled), sampled))
=============================================================================
