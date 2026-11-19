import RulesRegex.Spec

namespace RR

theorem nullable_iff (r : RE) : nullable r = true ↔ lang r [] := by
  induction r <;> simp_all [nullable, lang, Cat, Star.nil] <;> grind

theorem join_lang (p q : RE) (w : Word) : lang (join p q) w ↔ lang p w ∨ lang q w := by
  cases p <;> simp [join, lang]

theorem cat_lang (p q : RE) (w : Word) : lang (cat p q) w ↔ Cat (lang p) (lang q) w := by
  cases p <;> simp [cat, lang, Cat] <;> grind

theorem cat_cons (P Q : Language) (c : Char) (w : Word) :
    Cat P Q (c :: w) ↔ Cat (fun u => P (c :: u)) Q w ∨ (P [] ∧ Q (c :: w)) := by
  constructor
  · rintro ⟨u, v, h, hu, hv⟩
    cases u with
    | nil => exact Or.inr ⟨hu, h.symm ▸ hv⟩
    | cons d u =>
      cases h
      exact Or.inl ⟨u, v, rfl, hu, hv⟩
  · rintro (⟨u, v, rfl, hu, hv⟩ | ⟨h, hv⟩)
    · exact ⟨c :: u, v, rfl, hu, hv⟩
    · exact ⟨[], c :: w, rfl, h, hv⟩

theorem star_cons (P : Language) (c : Char) (w : Word) :
    Star P (c :: w) ↔ Cat (fun u => P (c :: u)) (Star P) w := by
  constructor
  · intro h
    cases h with
    | cons h t => exact ⟨_, _, rfl, h, t⟩
  · rintro ⟨u, v, rfl, hu, hv⟩
    exact .cons hu hv

theorem deriv_iff (r : RE) (c : Char) (w : Word) : lang (deriv c r) w ↔ lang r (c :: w) := by
  induction r generalizing w with
  | zero | eps => simp [deriv, lang]
  | atom f => cases h : f c <;> simp [deriv, lang, h] <;> grind
  | alt p q hp hq => simp [deriv, join_lang, lang, hp, hq]
  | star p hp => simp [deriv, cat_lang, lang, star_cons, Cat, hp]
  | seq p q hp hq =>
    change _ ↔ Cat (lang p) (lang q) (c :: w)
    rw [cat_cons]
    cases h : nullable p <;> simp [deriv, join_lang, cat_lang, Cat, hp, hq, ← nullable_iff, h]

theorem matches_iff (r : RE) (w : Word) : «matches» r w = true ↔ lang r w := by
  induction w generalizing r with
  | nil => exact nullable_iff r
  | cons c w ih => exact (ih (deriv c r)).trans (deriv_iff r c w)

theorem steps_eq_length (r : RE) (w : Word) : (run r w).2 = w.length := by
  induction w generalizing r with
  | nil => rfl
  | cons c w ih => simp [run, ih]

/-- Exactly n (possibly empty) factors followed by a word in Q. -/
def Factors (P Q : Language) : Nat → Language
  | 0 => Q
  | n+1 => Cat P (Factors P Q n)

theorem copies_lang (r tail : RE) (n : Nat) (w : Word) :
    lang (copies r n tail) w ↔ Factors (lang r) (lang tail) n w := by
  induction n generalizing w <;> simp_all [copies, Factors, lang, Cat]

theorem optional_lang (r : RE) (n : Nat) (w : Word) :
    lang (optionalCopies r n) w ↔ ∃ k ≤ n, Factors (lang r) (lang .eps) k w := by
  induction n generalizing w with
  | zero => simp [optionalCopies, Factors]
  | succ n ih =>
    change (w = [] ∨ Cat (lang r) (lang (optionalCopies r n)) w) ↔ _
    constructor
    · rintro (h | ⟨u, v, e, hu, hv⟩)
      · exact ⟨0, Nat.zero_le _, h⟩
      · obtain ⟨k, hk, t⟩ := (ih v).mp hv
        exact ⟨k+1, Nat.succ_le_succ hk, u, v, e, hu, t⟩
    · rintro ⟨_|k, hk, h⟩
      · exact Or.inl h
      · obtain ⟨u, v, e, hu, hv⟩ := h
        exact Or.inr ⟨u, v, e, hu, (ih v).mpr ⟨k, Nat.le_of_succ_le_succ hk, hv⟩⟩

/-- An accepted finite bound requires lo factors, then zero through hi-lo more. -/
theorem bounded_expansion (r : RE) (lo extra : Nat) (w : Word) :
    lang (expand r lo (some (lo + extra))) w ↔
      Factors (lang r) (fun v => ∃ k ≤ extra, Factors (lang r) (lang .eps) k v) lo w := by
  simp only [expand, Option.elim, Nat.add_sub_cancel_left, copies_lang]
  exact Iff.of_eq (congrArg (fun Q => Factors (lang r) Q lo w)
    (funext fun v => propext (optional_lang r extra v)))

theorem open_expansion (r : RE) (lo : Nat) (w : Word) :
    lang (expand r lo none) w ↔ Factors (lang r) (Star (lang r)) lo w :=
  copies_lang r (.star r) lo w

end RR

namespace RR

theorem dot_singleton (c : Char) :
    «matches» (.atom (· != '\n')) [c] = true ↔ c ≠ '\n' := by
  rw [matches_iff]
  simp [lang]

theorem dot_refuses_lf : «matches» (.atom (· != '\n')) ['\n'] = false := rfl

end RR
