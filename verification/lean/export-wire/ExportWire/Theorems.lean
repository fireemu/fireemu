import ExportWire.Spec

namespace ExportWire

theorem digit_count (fuel value : Nat) : (digits fuel value).length ≤ fuel := by
  induction fuel generalizing value with
  | zero => simp [digits]
  | succ fuel ih =>
    simp only [digits]
    split
    · simp
    · simp only [List.length_cons]
      exact Nat.succ_le_succ (ih _)

theorem next_digit_fits (fuel value : Nat) (h : value < 128 ^ (fuel + 1)) :
    value / 128 < 128 ^ fuel := by
  rw [Nat.pow_succ] at h
  exact (Nat.div_lt_iff_lt_mul (by decide : 0 < 128)).2 h

theorem expanding_then_decoding (fuel value : Nat) (suffix : List Nat)
    (fits : value < 128 ^ fuel) (nonzero : 0 < fuel) :
    decode fuel (digits fuel value ++ suffix) = .value value (digits fuel value).length := by
  induction fuel generalizing value with
  | zero => omega
  | succ fuel ih =>
    by_cases h : value / 128 = 0
    · have eq : value % 128 = value := by omega
      have small : value < 128 := by omega
      simp [digits, decode, h, eq, small]
    · have nf : 0 < fuel := by
        have := next_digit_fits fuel value fits
        cases fuel <;> simp_all
      have high := ih (value / 128) (next_digit_fits fuel value fits) nf
      have continuation : ¬ value % 128 + 128 < 128 := by omega
      have sum : value % 128 + 128 * (value / 128) = value := by omega
      simp [digits, decode, h, continuation, high, sum]

theorem u64_roundtrip (n : Nat) (fits : n < unsignedSpace) (suffix : List Nat) :
    decodeU64 (digits 10 n ++ suffix) = .value n (digits 10 n).length := by
  have room : unsignedSpace ≤ 128 ^ 10 := by decide
  simp only [decodeU64, expanding_then_decoding _ _ _ (Nat.lt_of_lt_of_le fits room) (by decide)]
  rw [Nat.mod_eq_of_lt fits]

theorem signed_bits_roundtrip (bits : Nat) (fits : bits < unsignedSpace) :
    signedBits (asSigned bits) = bits := by
  unfold signedBits asSigned unsignedSpace signBoundary at *
  split <;> omega

theorem eleven_continuation_bytes_refused :
    decodeU64 (List.replicate 11 128) = .long 10 := by decide

theorem tenth_byte_cannot_widen_u64 :
    decodeU64 (List.replicate 9 128 ++ [127]) = .value 9223372036854775808 10 := by decide

end ExportWire
