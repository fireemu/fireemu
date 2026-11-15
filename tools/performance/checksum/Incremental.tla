---------------- MODULE Incremental ----------------
EXTENDS Naturals, Sequences

Data == <<0, 255, 1, 127, 3>>
ChunkSize == 2

N == Len(Data)
ByteStep(state, byte) == (state + byte) % 256
Minimum(left, right) == IF left < right THEN left ELSE right

VARIABLES wholeState, wholeIndex, partState, partIndex, remaining
vars == <<wholeState, wholeIndex, partState, partIndex, remaining>>

Init ==
    /\ wholeState = 0
    /\ wholeIndex = 1
    /\ partState = 0
    /\ partIndex = 1
    /\ remaining = 0

WholeStep ==
    /\ wholeIndex <= N
    /\ wholeState' = ByteStep(wholeState, Data[wholeIndex])
    /\ wholeIndex' = wholeIndex + 1
    /\ UNCHANGED <<partState, partIndex, remaining>>

BeginChunk ==
    /\ remaining = 0
    /\ partIndex <= N
    /\ remaining' = Minimum(ChunkSize, N - partIndex + 1)
    /\ UNCHANGED <<wholeState, wholeIndex, partState, partIndex>>

PartStep ==
    /\ remaining > 0
    /\ partIndex <= N
    /\ partState' = ByteStep(partState, Data[partIndex])
    /\ partIndex' = partIndex + 1
    /\ remaining' = remaining - 1
    /\ UNCHANGED <<wholeState, wholeIndex>>

Next == WholeStep \/ BeginChunk \/ PartStep
Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ wholeState \in 0..255
    /\ partState \in 0..255
    /\ wholeIndex \in 1..(N + 1)
    /\ partIndex \in 1..(N + 1)
    /\ remaining \in 0..ChunkSize

EqualPrefixStates ==
    wholeIndex = partIndex => wholeState = partState

CompleteStatesAgree ==
    (wholeIndex = N + 1 /\ partIndex = N + 1) => wholeState = partState

=================================================
