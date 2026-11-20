import StorageEtag.Spec

namespace StorageEtag

theorem varint_digits_bounded_size (fuel value : Nat) :
    (varintDigits fuel value).length ≤ fuel := by
  induction fuel generalizing value with
  | zero => simp [varintDigits]
  | succ fuel ih =>
    by_cases h : value < 128
    · simp [varintDigits, h]
    · simpa [varintDigits, h] using ih (value / 128)

theorem varint_digits_read (fuel n : Nat) (hasFuel : 0 < fuel) (bound : n < 128 ^ fuel) (suffix : List Nat) :
    readVarint (varintDigits fuel n ++ suffix) = some (n, suffix) := by
  induction fuel generalizing n with
  | zero => omega
  | succ fuel ih =>
    by_cases small : n < 128
    · simp [varintDigits, readVarint, small]
    · have positive : fuel > 0 := by
        cases fuel with
        | zero => simp at bound; omega
        | succ remaining => omega
      have divided : n / 128 < 128 ^ fuel := by
        rw [Nat.pow_succ] at bound
        omega
      have leading : ¬ 128 + n % 128 < 128 := by omega
      simp [varintDigits, readVarint, small, leading, ih (n / 128) positive divided]
      omega

theorem varint_read (n : Nat) (bound : n < 2 ^ 64) (suffix : List Nat) :
    readVarint (varint n ++ suffix) = some (n, suffix) :=
  varint_digits_read 10 n (by omega) (by omega) suffix

theorem varint_injective_for_u64 (a b : Nat) (ha : a < 2 ^ 64) (hb : b < 2 ^ 64)
    (same : varint a = varint b) : a = b := by
  have left := varint_read a ha []
  have right := varint_read b hb []
  rw [same, right] at left
  exact congrArg Prod.fst (Option.some.inj left.symm)

theorem base64_emits_full_quartets : (bytes : List Nat) →
    (base64Symbols bytes).length = 4 * ((bytes.length + 2) / 3)
  | [] => by decide
  | [_] => by simp [base64Symbols]
  | [_, _] => by simp [base64Symbols]
  | _ :: _ :: _ :: rest => by
    simp only [base64Symbols, List.length_cons, base64_emits_full_quartets rest]
    omega

theorem bucket_tags_and_payload (n : Nat) (bound : n < 2 ^ 64) :
    (bucketBytes n).head? = some 8 ∧ readVarint (bucketBytes n).tail = some (n, []) := by
  simpa [bucketBytes] using varint_read n bound []

theorem object_tags_and_payload (g m : Nat) (hg : g < 2 ^ 64) :
    (objectBytes g m).head? = some 8 ∧
    readVarint (objectBytes g m).tail = some (g, 16 :: varint m) := by
  refine ⟨rfl, ?_⟩
  simpa [objectBytes, List.append_assoc] using varint_read g hg (16 :: varint m)

theorem object_metageneration_payload (m : Nat) (hm : m < 2 ^ 64) :
    readVarint (16 :: varint m).tail = some (m, []) := by
  simpa using varint_read m hm []

theorem recorded_object_vector : objectEtag 1790789164648913 2 = "CNGTm8DplpcDEAI=" := by decide

theorem recorded_bucket_vector : bucketEtag 2 = "CAI=" := by decide

end StorageEtag
