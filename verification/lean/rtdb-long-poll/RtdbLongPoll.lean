import Std

namespace RtdbLongPoll

structure Segment where
  number : Nat
  total : Nat
  body : String
  deriving BEq, Inhabited

structure Bounds where
  bytes : Nat
  count : Nat

structure State where
  next : Nat
  waiting : List Segment
  deriving Inhabited

def waitingBytes (waiting : List Segment) : Nat :=
  (waiting.map fun s => s.body.utf8ByteSize).sum

def findSegment (waiting : List Segment) (number : Nat) : Option Segment :=
  waiting.find? (fun s => s.number == number)

def duplicate (state : State) (segment : Segment) : Bool :=
  segment.number < state.next || (findSegment state.waiting segment.number).isSome

def save (bounds : Bounds) (state : State) (segment : Segment) : Except Unit State :=
  if duplicate state segment then .ok state
  else if waitingBytes (segment :: state.waiting) ≤ bounds.bytes &&
      (segment :: state.waiting).length ≤ bounds.count then
    .ok { state with waiting := segment :: state.waiting }
  else .error ()

def digit (c : Char) : Option Nat :=
  if 'A' ≤ c && c ≤ 'Z' then some (c.toNat - 65)
  else if 'a' ≤ c && c ≤ 'z' then some (c.toNat - 97 + 26)
  else if '0' ≤ c && c ≤ '9' then some (c.toNat - 48 + 52)
  else if c == '-' || c == '+' then some 62
  else if c == '_' || c == '/' then some 63
  else none

/-- Base64 groups are accumulated modulo the number of unconsumed bits. -/
def bytesOfDigits (values : List Nat) : ByteArray :=
  (values.foldl (fun (carry, remainder, bytes) value =>
    let bits := remainder + 6
    let combined := carry * 64 + value
    if 8 ≤ bits then
      let low := bits - 8
      let unit := 2 ^ low
      (combined % unit, low, bytes.push ((combined / unit).toUInt8))
    else (combined, bits, bytes)) (0, 0, ByteArray.empty)).2.2

def decode (text : String) : Option String := do
  let trailing := (text.toList.reverse.takeWhile (fun c => c == '.' || c == '=')).length
  let size := text.toList.length
  let body := text.toList.take (size - trailing)
  if trailing > 2 || (trailing > 0 && size % 4 != 0) || body.length % 4 == 1 then none
  else
    let values ← body.mapM digit
    String.fromUTF8? (bytesOfDigits values)

def advance (state : State) (total : Nat) : State :=
  let boundary := state.next + max total 1
  ⟨boundary, state.waiting.filter (fun s => boundary ≤ s.number)⟩

def takePacket (state : State) : Except Unit (Option (State × String)) :=
  match findSegment state.waiting state.next with
  | none => .ok none
  | some first =>
    let width := max first.total 1
    let boundary := state.next + width
    if boundary > 18446744073709551615 then .error ()
    else if width > state.waiting.length then .ok none
    else
      match (List.range width).mapM (fun offset => findSegment state.waiting (state.next + offset)) with
      | none => .ok none
      | some segments =>
        match decode (String.join (segments.map Segment.body)) with
        | none => .error ()
        | some message => .ok (some (advance state first.total, message))

def drain : Nat → State → Except Unit (State × List String)
  | 0, state => .ok (state, [])
  | fuel + 1, state => do
    match ← takePacket state with
    | none => return (state, [])
    | some (next, message) =>
      let (final, messages) ← drain fuel next
      return (final, message :: messages)

def receive (bounds : Bounds) (state : State) (request : List Segment) :
    Except Unit (State × List String) := do
  let staged ← request.foldlM (save bounds) state
  drain staged.waiting.length staged

theorem duplicatesKeepState (bounds : Bounds) (s : State) (segment : Segment)
    (h : duplicate s segment) : save bounds s segment = .ok s := by
  simp [save, h]

theorem saveWithinLimits (bounds : Bounds) (s result : State) (segment : Segment)
    (bytes : waitingBytes s.waiting ≤ bounds.bytes) (count : s.waiting.length ≤ bounds.count)
    (h : save bounds s segment = .ok result) :
    waitingBytes result.waiting ≤ bounds.bytes ∧ result.waiting.length ≤ bounds.count := by
  unfold save at h
  split at h
  · cases h
    exact ⟨bytes, count⟩
  · split at h
    · rename_i fits
      cases h
      simpa using fits
    · simp at h

theorem advanceIncreases (s : State) (total : Nat) : s.next < (advance s total).next := by
  unfold advance
  simp
  omega

theorem packetIncreases (s next : State) (msg : String)
    (h : takePacket s = .ok (some (next, msg))) : s.next < next.next := by
  unfold takePacket at h
  split at h
  · simp at h
  · dsimp only at h
    split at h
    · simp at h
    · split at h
      · simp at h
      · split at h
        · simp at h
        · split at h
          · simp at h
          · cases h
            exact advanceIncreases _ _

theorem drainDoesNotRewind (fuel : Nat) (s final : State) (messages : List String)
    (h : drain fuel s = .ok (final, messages)) : s.next ≤ final.next := by
  induction fuel generalizing s final messages with
  | zero =>
    simp [drain] at h
    exact h.1 ▸ Nat.le_refl _
  | succ fuel ih =>
    rw [drain] at h
    cases hp : takePacket s with
    | error e => simp [hp, bind, Except.bind] at h
    | ok result =>
      cases result with
      | none =>
        simp [hp, bind, Except.bind, pure, Except.pure] at h
        exact h.1 ▸ Nat.le_refl _
      | some pair =>
        obtain ⟨mid, message⟩ := pair
        have advance := packetIncreases s mid message hp
        cases hd : drain fuel mid with
        | error e => simp [hp, hd, bind, Except.bind] at h
        | ok result =>
          obtain ⟨step, rest⟩ := result
          have remaining := ih mid step rest hd
          simp [hp, hd, bind, Except.bind, pure, Except.pure] at h
          rw [← h.1]
          omega

/-- info: 'RtdbLongPoll.duplicatesKeepState' depends on axioms: [propext] -/
#guard_msgs in #print axioms duplicatesKeepState
/-- info: 'RtdbLongPoll.saveWithinLimits' depends on axioms: [propext] -/
#guard_msgs in #print axioms saveWithinLimits
/-- info: 'RtdbLongPoll.advanceIncreases' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms advanceIncreases
/-- info: 'RtdbLongPoll.packetIncreases' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms packetIncreases
/-- info: 'RtdbLongPoll.drainDoesNotRewind' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms drainDoesNotRewind

end RtdbLongPoll
