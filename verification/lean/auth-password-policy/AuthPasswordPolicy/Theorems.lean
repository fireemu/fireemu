import AuthPasswordPolicy.Spec

namespace AuthPasswordPolicy

theorem off_never_rejects (forced : Bool) (operation : Operation) (policy : Policy)
    (password : String) : rejects .off forced operation policy password = false := by
  rfl

theorem unspecified_never_rejects (forced : Bool) (operation : Operation) (policy : Policy)
    (password : String) : rejects .unspecified forced operation policy password = false := by
  rfl

theorem signin_requires_force (state : Enforcement) (policy : Policy) (password : String) :
    rejects state false .signin policy password = false := by
  cases state <;> rfl

theorem forced_signin_agrees_with_signup (state : Enforcement) (policy : Policy)
    (password : String) :
    rejects state true .signin policy password = rejects state true .register policy password := by
  cases state <;> rfl

theorem utf16_length_additive (first last : String) :
    utf16Length (first ++ last) = utf16Length first + utf16Length last := by
  simp [utf16Length, List.sum_append]

theorem supplementary_scalar_uses_two_units (character : Char)
    (high : 65536 ≤ character.toNat) : units character = 2 := by
  simp [units, Nat.not_lt_of_ge high]

theorem valid_minimum_bounds {minimum : Nat} {maximum : Option Nat} {allowed : List Char}
    (valid : validateConfiguration minimum maximum allowed = none) :
    6 ≤ minimum ∧ minimum ≤ 30 := by
  by_cases low : minimum < 6
  · simp [validateConfiguration, low] at valid
  by_cases high : 30 < minimum
  · simp [validateConfiguration, high] at valid
  omega

end AuthPasswordPolicy
