import PubSubMessageIds.Spec
import Init.Data.Nat.Coprime

namespace PMI

private def inverse : Nat := 1_322_628_862_499

/-- The residue of a counter can be recovered from its permuted offset. -/
theorem recover_residue (counter : Nat) : (offset counter * inverse) % span = counter % span := by
  have certificate : (stride * inverse) % span = 1 := by decide
  calc
    _ = (inverse * ((counter * stride) % span)) % span := by rw [offset, Nat.mul_comm]
    _ = (inverse * (counter * stride)) % span := Nat.mul_mod_mod _ _ _
    _ = (counter * (stride * inverse)) % span := by
      rw [Nat.mul_comm inverse, Nat.mul_assoc]
    _ = (counter * ((stride * inverse) % span)) % span := (Nat.mul_mod_mod _ _ _).symm
    _ = _ := by rw [certificate, Nat.mul_one]

theorem message_ids_equal_iff_residues (a b : Nat) :
    brokerId a = brokerId b ↔ a % span = b % span := by
  constructor
  · intro h
    unfold brokerId at h
    have offsets : offset a = offset b := Nat.add_left_cancel h
    rw [← recover_residue a, ← recover_residue b, offsets]
  · intro h
    unfold brokerId offset
    rw [Nat.mul_mod a stride span, Nat.mul_mod b stride span, h]

theorem message_ids_are_17_digits (counter : Nat) :
    10 ^ 16 ≤ brokerId counter ∧ brokerId counter < 10 ^ 17 := by
  have residue := Nat.mod_lt (counter * stride) (show span > 0 by decide)
  unfold brokerId offset first span at *
  omega

theorem broker_partition_is_injective (a b : Nat) (ha : 1 ≤ a ∧ a ≤ half)
    (hb : 1 ≤ b ∧ b ≤ half) (h : brokerId a = brokerId b) : a = b := by
  have residues := (message_ids_equal_iff_residues a b).mp h
  unfold half span at *
  omega

theorem runtime_slots_in_upper_half (counter : Nat) :
    half < runtimeSlot counter ∧ runtimeSlot counter ≤ span := by
  have residue := Nat.mod_lt (max counter 1 - 1) (show half > 0 by decide)
  unfold runtimeSlot half span at *
  omega

theorem affine_slots_in_upper_half (multiplier addend counter : Nat) :
    half < affineSlot multiplier addend counter ∧ affineSlot multiplier addend counter ≤ span := by
  have residue := Nat.mod_lt (multiplier * counter + addend) (show half > 0 by decide)
  unfold affineSlot half span at *
  omega

private theorem disjoint_slots (broker upper : Nat) (hb : 1 ≤ broker ∧ broker ≤ half)
    (hr : half < upper ∧ upper ≤ span) : brokerId broker ≠ brokerId upper := by
  intro h
  have residues := (message_ids_equal_iff_residues broker upper).mp h
  unfold half span at *
  omega

theorem broker_and_runtime_disjoint (broker runtime : Nat)
    (hb : 1 ≤ broker ∧ broker ≤ half) : brokerId broker ≠ runtimeId runtime := by
  exact disjoint_slots broker (runtimeSlot runtime) hb (runtime_slots_in_upper_half runtime)

theorem broker_and_seeded_runtime_disjoint (broker session runtime : Nat)
    (hb : 1 ≤ broker ∧ broker ≤ half) : brokerId broker ≠ seededRuntimeId session runtime := by
  exact disjoint_slots broker _ hb (affine_slots_in_upper_half _ _ runtime)

theorem runtime_normalizes_zero : runtimeId 0 = runtimeId 1 := by decide

theorem runtime_wraps (counter : Nat) (h : 1 ≤ counter) :
    runtimeId (counter + half) = runtimeId counter := by
  have hsum : 1 ≤ counter + half := by omega
  have hsub : counter + half - 1 = counter - 1 + half := by omega
  simp only [runtimeId, runtimeSlot, Nat.max_eq_left hsum, Nat.max_eq_left h, hsub, Nat.add_mod_right]

private theorem affine_slot_wraps (multiplier addend counter : Nat) :
    affineSlot multiplier addend (counter + half) = affineSlot multiplier addend counter := by
  unfold affineSlot
  rw [Nat.mul_add, Nat.add_right_comm (multiplier * counter) (multiplier * half) addend,
    Nat.add_mul_mod_self_right]

theorem seeded_runtime_wraps (session counter : Nat) :
    seededRuntimeId session (counter + half) = seededRuntimeId session counter := by
  simp only [seededRuntimeId, affine_slot_wraps]

theorem position_is_bounded (previous count : Nat) : position previous count < half :=
  Nat.mod_lt _ (by decide)

theorem position_updates_compose (previous a b : Nat) :
    position (position previous a) b = position previous (a + b) := by
  unfold position
  rw [Nat.mod_add_mod, Nat.add_assoc]

theorem adjustment_removes_factor_five (n : Nat) : adjust n % 5 ≠ 0 := by
  unfold adjust
  split <;> omega

theorem adjustment_keeps_parity (n : Nat) : adjust n % 2 = n % 2 := by
  unfold adjust
  split <;> omega

private theorem coprime_power {a b : Nat} (base : a.Coprime b) (n : Nat) :
    a.Coprime (b ^ n) := by
  induction n with
  | zero => exact Nat.coprime_one_right _
  | succ n ih => rw [Nat.pow_succ]; exact ih.mul_right base

private theorem adjust_odd_coprime (n : Nat) (odd : n % 2 = 1) :
    (adjust n).Coprime half := by
  have p2 : (adjust n).Coprime 2 := by
    apply Nat.Coprime.symm
    change Nat.gcd 2 (adjust n) = 1
    rw [Nat.gcd_rec, adjustment_keeps_parity, odd]
    decide
  have p5 : (adjust n).Coprime 5 := by
    apply Nat.Coprime.symm
    change Nat.gcd 5 (adjust n) = 1
    rw [Nat.gcd_rec]
    have notZero := adjustment_removes_factor_five n
    have bounded := Nat.mod_lt (adjust n) (show 0 < 5 by decide)
    have choices : adjust n % 5 = 1 ∨ adjust n % 5 = 2 ∨
        adjust n % 5 = 3 ∨ adjust n % 5 = 4 := by omega
    rcases choices with h | h | h | h <;> rw [h] <;> decide
  rw [show half = 2 ^ 12 * 5 ^ 13 by decide]
  exact (coprime_power p2 12).mul_right (coprime_power p5 13)

theorem seeded_multiplier_is_coprime (session : Nat) :
    (affineParams session).1.Coprime half := by
  let folded := mix (BitVec.ofNat 64 session) + BitVec.ofNat 64 (session / 2 ^ 64)
  let odd := (mix folded ||| 1#64)
  have lsb : odd.getLsbD 0 = true := by
    unfold odd
    simp only [BitVec.getLsbD_or]
    cases (mix folded).getLsbD 0 <;> rfl
  have parity : odd.toNat % 2 = 1 := Nat.mod_two_eq_one_iff_testBit_zero.mpr lsb
  have h := (adjust_odd_coprime odd.toNat parity).symm
  change Nat.gcd (adjust odd.toNat % half) half = 1
  rw [← Nat.gcd_rec]
  exact h

private theorem coprime_slots_injective_of_le
    (multiplier addend a b : Nat) (coprime : multiplier.Coprime half)
    (le : a ≤ b) (gap : b - a < half)
    (equal : affineSlot multiplier addend a = affineSlot multiplier addend b) :
    a = b := by
  have residues :
      (multiplier * a + addend) % half = (multiplier * b + addend) % half := by
    unfold affineSlot at equal
    omega
  have dividendLe : multiplier * a + addend ≤ multiplier * b + addend :=
    Nat.add_le_add_right (Nat.mul_le_mul_left multiplier le) addend
  have divA := Nat.mod_add_div (multiplier * a + addend) half
  have divB := Nat.mod_add_div (multiplier * b + addend) half
  have difference :
      (multiplier * b + addend) - (multiplier * a + addend) =
        half * (((multiplier * b + addend) / half) - ((multiplier * a + addend) / half)) := by
    unfold half at *
    omega
  have divides : half ∣ multiplier * (b - a) := by
    rw [Nat.mul_sub_left_distrib, ← Nat.add_sub_add_right
      (multiplier * b) addend (multiplier * a), difference]
    exact Nat.dvd_mul_right _ _
  have gapDivides := coprime.symm.dvd_of_dvd_mul_left divides
  have zero := Nat.mod_eq_zero_of_dvd gapDivides
  rw [Nat.mod_eq_of_lt gap] at zero
  omega

theorem seeded_ids_are_injective_under_half_span (session a b : Nat)
    (le : a ≤ b) (gap : b - a < half)
    (equal : seededRuntimeId session a = seededRuntimeId session b) :
    a = b := by
  let param := affineParams session
  have ha := affine_slots_in_upper_half param.1 param.2 a
  have hb := affine_slots_in_upper_half param.1 param.2 b
  have eqResidues := (message_ids_equal_iff_residues _ _).mp equal
  have slots : affineSlot param.1 param.2 a = affineSlot param.1 param.2 b := by
    change affineSlot param.1 param.2 a % span = affineSlot param.1 param.2 b % span
      at eqResidues
    unfold half span at *
    omega
  exact coprime_slots_injective_of_le _ _ a b (seeded_multiplier_is_coprime session)
    le gap slots

end PMI
