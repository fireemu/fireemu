/-!
# Order laws for three-way comparators

The laws are stated pointwise, anchored at the first argument, so that they can be proved
for recursive comparators by induction on that argument alone:

* `Refl f x`: `f x x = eq`.
* `Swap f x`: `f y x = (f x y).swap` for every `y`.
* `Trans f x`: whenever `f x y` and `f y z` are both `lt` or `eq`, `f x z` is their
  lexicographic combination `(f x y).then (f y z)`: `lt` if either is `lt`, else `eq`.

`Trans` is stronger than transitivity of `≤`: it also gives transitivity of `<` and of the
equivalence `f x y = eq`. Together with `Swap` it makes `f` a total preorder.
-/

namespace FVO

def Refl (f : α → α → Ordering) (x : α) : Prop := f x x = .eq

def Swap (f : α → α → Ordering) (x : α) : Prop := ∀ y, f y x = (f x y).swap

def Trans (f : α → α → Ordering) (x : α) : Prop :=
  ∀ y z, f x y ≠ .gt → f y z ≠ .gt → f x z = (f x y).then (f y z)

/-- All three laws at one point. -/
def Laws (f : α → α → Ordering) (x : α) : Prop := Refl f x ∧ Swap f x ∧ Trans f x

theorem then_ne_gt_left {a b : Ordering} (h : a.then b ≠ .gt) : a ≠ .gt := by
  cases a <;> simp_all [Ordering.then]

theorem then_ne_gt_right_of_eq {a b : Ordering} (h : a.then b ≠ .gt) (ha : a = .eq) :
    b ≠ .gt := by
  subst ha; simpa [Ordering.then] using h

/-! ## Consequences of the pointwise laws -/

theorem le_trans {f : α → α → Ordering} {x : α} (h : Trans f x) {y z : α}
    (h1 : f x y ≠ .gt) (h2 : f y z ≠ .gt) : f x z ≠ .gt := by
  rw [h y z h1 h2]
  cases hx : f x y <;> cases hy : f y z <;> simp_all [Ordering.then]

theorem lt_trans {f : α → α → Ordering} {x : α} (h : Trans f x) {y z : α}
    (h1 : f x y = .lt) (h2 : f y z = .lt) : f x z = .lt := by
  rw [h y z (by simp [h1]) (by simp [h2]), h1]; rfl

theorem eq_trans {f : α → α → Ordering} {x : α} (h : Trans f x) {y z : α}
    (h1 : f x y = .eq) (h2 : f y z = .eq) : f x z = .eq := by
  rw [h y z (by simp [h1]) (by simp [h2]), h1, h2]; rfl

theorem total {f : α → α → Ordering} {x : α} (h : Swap f x) (y : α) :
    f x y ≠ .gt ∨ f y x ≠ .gt := by
  rw [h y]; cases f x y <;> simp [Ordering.swap]

/-! ## Building blocks -/

/-- Comparator of a linear order given by `<` on `Int`. -/
def cmpInt (a b : Int) : Ordering := if a < b then .lt else if a = b then .eq else .gt

theorem cmpInt_laws (x : Int) : Laws cmpInt x := by
  refine ⟨?_, ?_, ?_⟩
  · simp [Refl, cmpInt]
  · intro y; simp only [cmpInt]
    repeat' split
    all_goals first | rfl | omega
  · intro y z h1 h2
    simp only [cmpInt] at *
    repeat' split at h1
    all_goals repeat' split at h2
    all_goals simp_all [Ordering.then]
    all_goals repeat' split
    all_goals first | rfl | omega | simp_all

def cmpNat (a b : Nat) : Ordering := cmpInt a b

theorem cmpNat_laws (x : Nat) : Laws cmpNat x := by
  have h := cmpInt_laws (x : Int)
  exact ⟨h.1, fun y => h.2.1 y, fun y z => h.2.2 y z⟩

def cmpBool (a b : Bool) : Ordering := cmpNat a.toNat b.toNat

/-- Pull a comparator back along any function. -/
def comap (f : β → β → Ordering) (k : α → β) (a b : α) : Ordering := f (k a) (k b)

theorem comap_laws {f : β → β → Ordering} {k : α → β} {x : α} (h : Laws f (k x)) :
    Laws (comap f k) x :=
  ⟨h.1, fun y => h.2.1 (k y), fun y z => h.2.2 (k y) (k z)⟩

theorem cmpBool_laws (x : Bool) : Laws cmpBool x := comap_laws (k := Bool.toNat) (cmpNat_laws _)

/-- Lexicographic product. -/
def pairCmp (f : α → α → Ordering) (g : β → β → Ordering) (p q : α × β) : Ordering :=
  (f p.1 q.1).then (g p.2 q.2)

theorem pairCmp_laws {f : α → α → Ordering} {g : β → β → Ordering} {p : α × β}
    (hf : Laws f p.1) (hg : Laws g p.2) : Laws (pairCmp f g) p := by
  obtain ⟨a, b⟩ := p
  refine ⟨?_, ?_, ?_⟩
  · simp only [Refl, pairCmp]; rw [hf.1, hg.1]; rfl
  · intro ⟨c, d⟩
    simp only [pairCmp]
    rw [hf.2.1 c, hg.2.1 d, Ordering.swap_then]
  · intro ⟨c, d⟩ ⟨e, k⟩ h1 h2
    simp only [pairCmp] at *
    have hf1 := then_ne_gt_left h1
    have hf2 := then_ne_gt_left h2
    rw [hf.2.2 c e hf1 hf2]
    cases hac : f a c with
    | gt => exact absurd hac hf1
    | lt => rfl
    | eq =>
      cases hce : f c e with
      | gt => exact absurd hce hf2
      | lt =>
        rw [hac] at h1; simp only [Ordering.then] at h1
        cases hgd : g b d <;> simp_all [Ordering.then]
      | eq =>
        rw [hac] at h1; rw [hce] at h2
        simp only [Ordering.then] at h1 h2 ⊢
        exact hg.2.2 d k h1 h2

/-- Lexicographic order on lists; a proper prefix is smaller. -/
def lex (f : α → α → Ordering) : List α → List α → Ordering
  | [], [] => .eq
  | [], _ :: _ => .lt
  | _ :: _, [] => .gt
  | x :: xs, y :: ys => (f x y).then (lex f xs ys)

theorem lex_laws {f : α → α → Ordering} :
    ∀ (xs : List α), (∀ x ∈ xs, Laws f x) → Laws (lex f) xs
  | [], _ => by
    refine ⟨rfl, ?_, ?_⟩
    · intro ys; cases ys <;> rfl
    · intro ys zs h1 h2
      cases ys <;> cases zs <;> simp_all [lex, Ordering.then]
  | x :: xs, h => by
    have hx := h x (List.mem_cons_self ..)
    have ih := lex_laws xs (fun y hy => h y (List.mem_cons_of_mem _ hy))
    refine ⟨?_, ?_, ?_⟩
    · simp only [Refl, lex]; rw [hx.1, ih.1]; rfl
    · intro ys
      cases ys with
      | nil => rfl
      | cons y ys => simp only [lex]; rw [hx.2.1 y, ih.2.1 ys, Ordering.swap_then]
    · intro ys zs h1 h2
      cases ys with
      | nil => simp [lex] at h1
      | cons y ys =>
        cases zs with
        | nil => simp [lex] at h2
        | cons z zs =>
          simp only [lex] at *
          have hf1 := then_ne_gt_left h1
          have hf2 := then_ne_gt_left h2
          rw [hx.2.2 y z hf1 hf2]
          cases hxy : f x y with
          | gt => exact absurd hxy hf1
          | lt => rfl
          | eq =>
            cases hyz : f y z with
            | gt => exact absurd hyz hf2
            | lt =>
              rw [hxy] at h1; simp only [Ordering.then] at h1
              cases hl : lex f xs ys <;> simp_all [Ordering.then]
            | eq =>
              rw [hxy] at h1; rw [hyz] at h2
              simp only [Ordering.then] at h1 h2 ⊢
              exact ih.2.2 ys zs h1 h2

end FVO
