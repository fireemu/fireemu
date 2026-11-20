import AppCheckClaims.Spec

namespace AppCheckClaims

theorem rounded_seconds_floor (instant : Int) (h : fitsI64 (instant / second)) :
    unixSeconds instant * second ≤ instant ∧
      instant < (unixSeconds instant + 1) * second := by
  simp only [unixSeconds, h, ite_true]
  unfold second
  omega

theorem out_of_range_uses_maximum (instant : Int) (h : ¬ fitsI64 (instant / second)) :
    unixSeconds instant = i64Max := by simp [unixSeconds, h]

theorem subsecond_negative_instant_rounds_down : unixSeconds (-1) = -1 := by decide

theorem expiration_always_fits (issued ttl : Int) : fitsI64 (expiry issued ttl) := by
  unfold expiry saturate fitsI64
  split
  · constructor
    · omega
    · decide
  split
  · constructor
    · decide
    · omega
  omega

theorem intact_lifetime (issued ttl : Int) (original : fitsI64 ttl)
    (result : fitsI64 (issued + ttl)) :
    reportedLifetime issued (expiry issued ttl) = ttl := by
  unfold fitsI64 at original result
  have h1 : ¬ issued + ttl < i64Min := by omega
  have h2 : ¬ issued + ttl > i64Max := by omega
  have h3 : ¬ ttl < i64Min := by omega
  have h4 : ¬ ttl > i64Max := by omega
  have cancel : issued + ttl - issued = ttl := by omega
  simp [reportedLifetime, expiry, saturate, h1, h2, h3, h4, cancel]

theorem epoch_is_fixed_width (value : Nat) : (epochText value).length = 32 := by
  simp [epochText]

theorem invalid_reasons_collapse (reason : String) :
    denial .enforced (.invalid reason) = some .invalid := rfl

theorem no_identity_for_invalid (mode : Mode) (reason : String) :
    exposedIdentity mode (.invalid reason) = none := by
  cases mode <;> rfl

theorem only_valid_reveals_identity (mode : Mode) (credential : Credential) (identity : String) :
    exposedIdentity mode credential = some identity ↔ credential = .valid identity := by
  cases mode <;> cases credential <;> simp [exposedIdentity, denial]

theorem non_enforcement_does_not_deny (mode : Mode) (credential : Credential)
    (modeIsPermissive : mode ≠ .enforced) : denial mode credential = none := by
  cases mode <;> simp_all [denial]

end AppCheckClaims
