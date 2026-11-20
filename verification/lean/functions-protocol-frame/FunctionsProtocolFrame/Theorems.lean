import FunctionsProtocolFrame.Spec

namespace FunctionsProtocolFrame

theorem header_suffix (digits length n : Nat) (wire rest suffix : Bytes)
    (h : scan digits length wire = .done n rest) :
    scan digits length (wire ++ suffix) = .done n (rest ++ suffix) := by
  induction wire generalizing digits length with
  | nil =>
    simp [scan] at h
    split at h <;> contradiction
  | cons byte tail ih =>
    by_cases newline : byte = 10 ∧ digits > 0
    · simp [scan, newline] at h ⊢
      simp [h.1, h.2]
    · by_cases decimal : 48 ≤ byte ∧ byte ≤ 57 ∧ digits < maxDigits
      · by_cases large : length * 10 + (byte - 48) > maxFrameBytes
        · simp [scan, newline, decimal, large] at h
        · simp [scan, newline, decimal, large] at h ⊢
          exact ih _ _ h
      · simp [scan, newline, decimal] at h

theorem header_success_respects_cap (digits length n : Nat) (wire rest : Bytes)
    (bound : length ≤ maxFrameBytes) (h : scan digits length wire = .done n rest) :
    n ≤ maxFrameBytes := by
  induction wire generalizing digits length with
  | nil =>
    simp [scan] at h
    split at h <;> contradiction
  | cons byte tail ih =>
    by_cases newline : byte = 10 ∧ digits > 0
    · simp [scan, newline] at h
      simpa [h.1] using bound
    · by_cases decimal : 48 ≤ byte ∧ byte ≤ 57 ∧ digits < maxDigits
      · by_cases large : length * 10 + (byte - 48) > maxFrameBytes
        · simp [scan, newline, decimal, large] at h
        · simp [scan, newline, decimal, large] at h
          exact ih _ _ (Nat.not_lt.mp large) h
      · simp [scan, newline, decimal] at h

theorem separates_consecutive_payloads (payload suffix : Bytes) :
    splitPayload payload.length (payload ++ suffix) = some (payload, suffix) := by
  simp [splitPayload]

theorem refuses_incomplete_payload (length : Nat) (wire : Bytes) (h : wire.length < length) :
    splitPayload length wire = none := by
  simp [splitPayload, Nat.not_le.mpr h]

theorem encoded_body_is_unchanged (payload : Bytes) :
    (encode payload).drop ((bytes (toString payload.length)).length + 1) = payload := by
  simp [encode]

theorem digit_limit_stops_before_body (length : Nat) (rest : Bytes) :
    scan maxDigits length (48 :: rest) = .malformed := by
  simp [scan]

theorem highest_accepted_length_is_inclusive (rest : Bytes) :
    scan 8 maxFrameBytes (10 :: rest) = .done maxFrameBytes rest := by
  simp [scan]

end FunctionsProtocolFrame
