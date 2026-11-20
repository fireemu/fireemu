---------------------------- MODULE PreviewGuard ----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS LastVersion, Guarded, CheckCurrent
VARIABLES epoch, draft, active, nextId, pendingPreview, shownPreview, acceptedCurrent
vars == <<epoch, draft, active, nextId, pendingPreview, shownPreview, acceptedCurrent>>
NoPreview == <<LastVersion + 1, LastVersion + 1>>
Current == <<epoch, draft>>

Init ==
    /\ epoch = 0 /\ draft = 0 /\ active = {} /\ nextId = 0
    /\ pendingPreview = NoPreview /\ shownPreview = NoPreview /\ acceptedCurrent = TRUE

CanStart == (~Guarded \/ active = {}) /\ nextId < 3
StartPreview ==
    /\ CanStart
    /\ active' = active \cup {<<"preview", nextId>>} /\ nextId' = nextId + 1
    /\ pendingPreview' = Current /\ shownPreview' = NoPreview
    /\ UNCHANGED <<epoch, draft, acceptedCurrent>>

FinishPreview ==
    /\ \E id \in 0..2:
       /\ <<"preview", id>> \in active
       /\ active' = active \ {<<"preview", id>>}
    /\ shownPreview' = IF pendingPreview = Current THEN pendingPreview ELSE NoPreview
    /\ UNCHANGED <<epoch, draft, nextId, pendingPreview, acceptedCurrent>>

Edit ==
    /\ draft < LastVersion /\ draft' = draft + 1 /\ shownPreview' = NoPreview
    /\ UNCHANGED <<epoch, active, nextId, pendingPreview, acceptedCurrent>>

SwitchOrRestore ==
    /\ epoch < LastVersion /\ epoch' = epoch + 1
    /\ UNCHANGED <<draft, active, nextId, pendingPreview, shownPreview, acceptedCurrent>>

Confirm ==
    /\ CanStart /\ shownPreview # NoPreview /\ (shownPreview = Current \/ ~CheckCurrent)
    /\ active' = active \cup {<<"confirm", nextId>>} /\ nextId' = nextId + 1
    /\ acceptedCurrent' = (shownPreview = Current) /\ shownPreview' = NoPreview
    /\ UNCHANGED <<epoch, draft, pendingPreview>>

FinishConfirm ==
    /\ \E id \in 0..2:
       /\ <<"confirm", id>> \in active
       /\ active' = active \ {<<"confirm", id>>}
    /\ UNCHANGED <<epoch, draft, nextId, pendingPreview, shownPreview, acceptedCurrent>>

Spec == Init /\ [][StartPreview \/ FinishPreview \/ Edit \/ SwitchOrRestore \/ Confirm \/ FinishConfirm]_vars
OneOperation == Cardinality(active) <= 1
OnlyCurrentPreviewConfirmed == acceptedCurrent
=============================================================================
