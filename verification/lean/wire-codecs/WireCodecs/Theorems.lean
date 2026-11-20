import WireCodecs.Spec

namespace WC

theorem escape_append (short : Bool) (a b : List Char) :
    escape short (a ++ b) = escape short a ++ escape short b :=
  List.flatMap_append

theorem percent_length (space : Bool) (input : List Nat) :
    (percent space input).2.length ≤ input.length := by
  fun_induction percent space input <;> simp_all <;> omega

theorem no_recursive_decoding :
    percent false [37, 50, 53, 52, 49] = (true, [37, 52, 49]) := by decide

theorem malformed_suffix_remains_visible :
    percent true [37, 43, 102] = (false, [37, 32, 102]) := by decide

theorem hex_nibble_bounded (n h : Nat) (eq : nibble n = some h) : h < 16 := by
  unfold nibble at eq
  split at eq
  · simp_all
    omega
  · split at eq
    · simp_all
      omega
    · split at eq
      · simp_all
        omega
      · cases eq

end WC
