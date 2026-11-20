import AuthBase32.Spec

namespace AuthBase32

theorem padded_symbol_count (width : Nat) (stream : List Bool) :
    (paddedGroups width stream).length = (stream.length + width - 1) / width := by
  simp [paddedGroups]

theorem decoded_octet_count (values : List Nat) :
    (fullGroups 8 (values.flatMap (bits 5))).length = values.length * 5 / 8 := by
  have length : (values.flatMap (bits 5)).length = values.length * 5 := by
    induction values with
    | nil => rfl
    | cons head tail ih =>
      simp [bits, List.length_flatMap] at ih ⊢
      omega
  simp [fullGroups, length]

theorem padding_alignment (symbols : Nat) : (symbols + padding symbols) % 8 = 0 := by
  unfold padding
  omega

theorem encoded_length_is_aligned (octets : List Nat) :
    (encode octets).length % 8 = 0 := by
  simpa [encode] using padding_alignment (paddedGroups 5 (octets.flatMap (bits 8))).length

theorem prefix_stops_at_padding (stem suffix : List Char) :
    beforePadding (stem ++ '=' :: suffix) = beforePadding stem := by
  induction stem with
  | nil => simp [beforePadding]
  | cons head tail ih =>
    by_cases padding : head = '=' <;> simp [beforePadding, ih, padding]

theorem trailing_text_has_no_effect (stem suffix : List Char) :
    decode (stem ++ '=' :: suffix) = decode stem := by
  simp [decode, prefix_stops_at_padding]

end AuthBase32
