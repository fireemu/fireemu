import Std

namespace RtdbPushId

def alphabet : String := "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz"
def timeBase : Nat := 64 ^ 8
def tailBase : Nat := 64 ^ 12

abbrev State := Nat × Nat

/-- The transition is independent of the generator used for a fresh suffix. Values passed as
`fresh` are a single valid 12-digit radix-64 tail. -/
def next (previous : State) (now fresh : Nat) : State :=
  if previous.1 < now then (now, fresh)
  else if previous.2 + 1 = tailBase then (previous.1 + 1, fresh)
  else (previous.1, previous.2 + 1)

def rank (s : State) : Nat := s.1 % timeBase * tailBase + s.2

def digits (n : Nat) : Nat → List Nat
  | 0 => []
  | width + 1 => digits (n / 64) width ++ [n % 64]

def render (s : State) : String :=
  String.ofList ((digits s.1 8 ++ digits s.2 12).map (fun digit => alphabet.toList[digit]!))

/-- Pure wrapping 64-bit SplitMix transition used by the test-vector generator. -/
def mix (seed : UInt64) : UInt64 × UInt64 :=
  let seed := seed + 0x9e3779b97f4a7c15
  let z := (seed ^^^ (seed >>> 30)) * 0xbf58476d1ce4e5b9
  let z := (z ^^^ (z >>> 27)) * 0x94d049bb133111eb
  (seed, z ^^^ (z >>> 31))

def seededTail (seed : UInt64) : Nat :=
  ((List.range 12).foldl (fun (seed, digits) _ =>
    let (seed, random) := mix seed
    (seed, 64 * digits + (random >>> 58).toNat)) (seed, 0)).2

theorem digitWidth (n width : Nat) : (digits n width).length = width := by
  induction width generalizing n with
  | zero => rfl
  | succ width h => simp [digits, h]

theorem idWidth (s : State) : (render s).toList.length = 20 := by
  simp [render, digitWidth]

theorem rangeOfTail (previous : State) (now fresh : Nat)
    (hprev : previous.2 < tailBase) (hfresh : fresh < tailBase) :
    (next previous now fresh).2 < tailBase := by
  unfold next
  split <;> try exact hfresh
  split <;> try exact hfresh
  dsimp
  omega

theorem increasingBeforeWrap (previous : State) (now fresh : Nat)
    (hprev : previous.2 < tailBase)
    (hold : previous.1 < timeBase)
    (hnext : (next previous now fresh).1 < timeBase) :
    rank previous < rank (next previous now fresh) := by
  simp only [rank, Nat.mod_eq_of_lt hold, Nat.mod_eq_of_lt hnext]
  unfold next
  split
  · rename_i h
    simp only
    have htime : previous.1 * tailBase + tailBase ≤ now * tailBase := by
      rw [← Nat.succ_mul]
      exact Nat.mul_le_mul_right _ h
    omega
  · split
    · simp only [Nat.succ_mul]
      omega
    · simp only
      omega

theorem boundaryWrapReversesRank :
    rank (next (timeBase - 1, tailBase - 1) (timeBase - 1) 0) <
      rank (timeBase - 1, tailBase - 1) := by decide

/-- info: 'RtdbPushId.digitWidth' depends on axioms: [propext] -/
#guard_msgs in #print axioms digitWidth
/-- info: 'RtdbPushId.idWidth' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms idWidth
/-- info: 'RtdbPushId.rangeOfTail' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms rangeOfTail
/-- info: 'RtdbPushId.increasingBeforeWrap' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms increasingBeforeWrap
/-- info: 'RtdbPushId.boundaryWrapReversesRank' does not depend on any axioms -/
#guard_msgs in #print axioms boundaryWrapReversesRank

end RtdbPushId
