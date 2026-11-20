import DeterministicIdSource.Spec

namespace DIS

private theorem undoScramble (x : Word) (shift : Nat) (cover : 64 ≤ shift + shift + shift) :
    scramble x shift ^^^ (scramble x shift >>> shift) ^^^
      (scramble x shift >>> (shift + shift)) = x := by
  apply BitVec.eq_of_getLsbD_eq_iff.mpr
  intro i _
  have outside : x.getLsbD (shift + (shift + (shift + i))) = false :=
    BitVec.getLsbD_of_ge _ _ (by omega)
  simp only [scramble, BitVec.getLsbD_xor, BitVec.getLsbD_ushiftRight, Nat.add_assoc, outside]
  cases x.getLsbD i <;> cases x.getLsbD (shift + i) <;>
    cases x.getLsbD (shift + (shift + i)) <;> rfl

private theorem cancelMul (m inv : Word) (identity : m * inv = 1#64)
    {a b : Word} (eq : a * m = b * m) : a = b := by
  calc
    a = a * m * inv := by rw [BitVec.mul_assoc, identity, BitVec.mul_one]
    _ = b * m * inv := by rw [eq]
    _ = b := by rw [BitVec.mul_assoc, identity, BitVec.mul_one]

theorem mix_injective {a b : Word} (h : mix a = mix b) : a = b := by
  let aA := scramble (a + increment) 30 * mulA
  let bA := scramble (b + increment) 30 * mulA
  let aB := scramble aA 27 * mulB
  let bB := scramble bA 27 * mulB
  change scramble aB 31 = scramble bB 31 at h
  have hB : aB = bB := by
    simpa only [undoScramble _ 31 (by decide)] using
      congrArg (fun (x : Word) => x ^^^ (x >>> 31) ^^^ (x >>> 62)) h
  have h27 : scramble aA 27 = scramble bA 27 :=
    cancelMul mulB 0x319642b2d24d8ec3 (by decide) hB
  have hA : aA = bA := by
    simpa only [undoScramble _ 27 (by decide)] using
      congrArg (fun (x : Word) => x ^^^ (x >>> 27) ^^^ (x >>> 54)) h27
  have h30 : scramble (a + increment) 30 = scramble (b + increment) 30 :=
    cancelMul mulA 0x96de1b173f119089 (by decide) hA
  have shifted : a + increment = b + increment := by
    simpa only [undoScramble _ 30 (by decide)] using
      congrArg (fun (x : Word) => x ^^^ (x >>> 30) ^^^ (x >>> 60)) h30
  simpa only [BitVec.add_sub_cancel] using
    congrArg (fun (x : Word) => x - increment) shifted

theorem projected_append (kind : Kind) (a b : List Kind) :
    projectedCount kind (a ++ b) = projectedCount kind a + projectedCount kind b := by
  exact List.countP_append

theorem unrelated_calls_keep_next_id (lo hi seed : Word) (history extra : List Kind)
    (kind : Kind) (h : projectedCount kind extra = 0) :
    nextId lo hi seed (history ++ extra) kind = nextId lo hi seed history kind := by
  simp only [nextId, projected_append, h, Nat.add_zero]

theorem command_ids_are_dense_before_wrap (lo hi seed : Word) (history : List Kind)
    (h : projectedCount .command history + 1 < 2 ^ 64) :
    nextId lo hi seed history .command = projectedCount .command history + 1 := by
  simpa [nextId, BitVec.toNat_ofNat] using Nat.mod_eq_of_lt h

theorem unrelated_append_keeps_counter (a b : Kind) (history : List Kind) (h : a ≠ b) :
    projectedCount b (history ++ [a]) = projectedCount b history := by
  simp [projectedCount, h]

private theorem pack_upper (a b : Word) : pack a b / 2 ^ 64 = a.toNat := by
  unfold pack
  have hb := b.isLt
  omega

private theorem pack_lower (a b : Word) : pack a b % 2 ^ 64 = b.toNat := by
  unfold pack
  have hb := b.isLt
  omega

theorem mixed_kinds_disjoint_at_fixed_session_and_seed
    (lo hi seed : Word) (kindA kindB : Kind) (counterA counterB : Word)
    (h : kindA ≠ kindB) :
    mixedId lo hi seed kindA counterA ≠ mixedId lo hi seed kindB counterB := by
  intro eq
  have keys := congrArg (fun id : Nat => id / 2 ^ 64) eq
  simp only [mixedId, pack_upper] at keys
  have tags := mix_injective (BitVec.eq_of_toNat_eq keys)
  have shifted : kindA.tag <<< 56 = kindB.tag <<< 56 :=
    (BitVec.xor_right_inj _).mp tags
  cases kindA <;> cases kindB <;> first
    | contradiction
    | exact False.elim (by revert shifted; decide)

theorem mixed_counters_injective_before_wrap
    (lo hi seed : Word) (kind : Kind) (a b : Word)
    (h : mixedId lo hi seed kind a = mixedId lo hi seed kind b) : a = b := by
  have lower := congrArg (fun id : Nat => id % 2 ^ 64) h
  simp only [mixedId, pack_lower] at lower
  have unfolded := mix_injective (BitVec.eq_of_toNat_eq lower)
  exact (BitVec.xor_right_inj _).mp unfolded

theorem selected_draw_is_below_bound (bound : Nat) (words : List Word) (out : Nat)
    (hBound : 0 < bound) (h : selectBelow bound words = some out) :
    out < bound := by
  unfold selectBelow at h
  split at h
  · simp at h
    omega
  · cases found : words.find? (fun w => decide (w.toNat < rejectionZone bound)) with
    | none => simp [found] at h
    | some word =>
      simp only [found, Option.map_some, Option.some.injEq] at h
      subst out
      exact Nat.mod_lt _ hBound

theorem draw_wraps_seed_space (seed : Word) (i : Nat) :
    draw seed (i + 2 ^ 64) = draw seed i := by
  have h : BitVec.ofNat 64 (i + 2 ^ 64) = BitVec.ofNat 64 i := by
    apply BitVec.eq_of_toNat_eq
    simp only [BitVec.toNat_ofNat, Nat.add_mod_right]
  simp only [draw, h]

/-- The distinct sessions 0 and 2^64 + 2^17 fold to the same mixer key. -/
theorem distinct_sessions_can_alias (seed : Word) (kind : Kind) (counter : Word) :
    mixedId 0 0 seed kind counter = mixedId 131072 1 seed kind counter := by
  have rotation : (1 : Word).rotateLeft 17 = 131072 := by decide
  have zero : (0 : Word).rotateLeft 17 = 0 := by decide
  simp only [mixedId, upper, rotation, zero, BitVec.xor_self, BitVec.zero_xor]

end DIS
