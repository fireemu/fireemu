import FirestoreValueOrder.Laws

/-!
# Specification of the Firestore value order

Written from the documented Firestore value type order
(https://firebase.google.com/docs/firestore/manage-data/data-types#value_type_ordering) and the
comments in `crates/fireemu-core-firestore/src/value.rs`:

Null < Boolean < NaN < Number (integers and doubles, numerically) < Timestamp < String
(UTF-8 byte order) < Bytes < Reference (by path segment) < GeoPoint (latitude, then
longitude) < Array (element-wise, a prefix is smaller) < Vector (length, then element-wise)
< Map (entry-wise by key bytes then value, a prefix is smaller).

Numbers are abstract here: every finite `f64` and every `i64` is an integer multiple of
`2^-1074`, so a finite number is the `Int` `x * 2^1074` and numbers order as `Int`s, with
the infinities at either end. `Concrete.lean` maps `f64` bit patterns and `i64`s onto this.
-/

namespace FVO

/-- A double inside a vector or a geo point: NaN sorts below every other double. -/
inductive Dbl
  | nan
  | negInf
  /-- `fin z` is the finite double `z * 2^-1074`. -/
  | fin (z : Int)
  | posInf
  deriving Repr, DecidableEq

def Dbl.key : Dbl → Nat × Int
  | .nan => (0, 0)
  | .negInf => (1, 0)
  | .fin z => (2, z)
  | .posInf => (3, 0)

def cmpDbl : Dbl → Dbl → Ordering := comap (pairCmp cmpNat cmpInt) Dbl.key

theorem cmpDbl_laws (x : Dbl) : Laws cmpDbl x :=
  comap_laws (pairCmp_laws (cmpNat_laws _) (cmpInt_laws _))

/-- A top-level number that is not NaN: an integer or a non-NaN double. -/
inductive Num
  | negInf
  | fin (z : Int)
  | posInf
  deriving Repr, DecidableEq

def Num.key : Num → Nat × Int
  | .negInf => (0, 0)
  | .fin z => (1, z)
  | .posInf => (2, 0)

def cmpNum : Num → Num → Ordering := comap (pairCmp cmpNat cmpInt) Num.key

theorem cmpNum_laws (x : Num) : Laws cmpNum x :=
  comap_laws (pairCmp_laws (cmpNat_laws _) (cmpInt_laws _))

/-- Abstract Firestore value. Strings, bytes and keys are byte lists; a reference is its
list of path segments; a map is its entry list in key order. -/
inductive Val
  | null
  | bool (b : Bool)
  | nan
  | num (n : Num)
  | timestamp (seconds : Int) (nanos : Nat)
  | string (utf8 : List Nat)
  | bytes (b : List Nat)
  | reference (segments : List (List Nat))
  | geoPoint (latitude longitude : Dbl)
  | array (xs : List Val)
  | vector (xs : List Dbl)
  | map (entries : List (List Nat × Val))
  deriving Repr

/-- Position of the value's type in the type order. -/
def Val.rank : Val → Nat
  | .null => 0
  | .bool _ => 1
  | .nan => 2
  | .num _ => 3
  | .timestamp .. => 4
  | .string _ => 5
  | .bytes _ => 6
  | .reference _ => 7
  | .geoPoint .. => 8
  | .array _ => 9
  | .vector _ => 10
  | .map _ => 11

def cmpBytes : List Nat → List Nat → Ordering := lex cmpNat

theorem cmpBytes_laws (x : List Nat) : Laws cmpBytes x :=
  lex_laws x (fun _ _ => cmpNat_laws _)

def cmpVector (xs ys : List Dbl) : Ordering :=
  (cmpNat xs.length ys.length).then (lex cmpDbl xs ys)

theorem cmpVector_laws (xs : List Dbl) : Laws cmpVector xs := by
  have h : Laws (comap (pairCmp cmpNat (lex cmpDbl)) (fun xs : List Dbl => (xs.length, xs))) xs :=
    comap_laws (pairCmp_laws (cmpNat_laws _) (lex_laws xs (fun _ _ => cmpDbl_laws _)))
  exact h

mutual
/-- The specified order. Values of different types order by `Val.rank`. -/
def cmp : Val → Val → Ordering
  | .bool a, .bool b => cmpBool a b
  | .num a, .num b => cmpNum a b
  | .timestamp s n, .timestamp s' n' => pairCmp cmpInt cmpNat (s, n) (s', n')
  | .string a, .string b => cmpBytes a b
  | .bytes a, .bytes b => cmpBytes a b
  | .reference a, .reference b => lex cmpBytes a b
  | .geoPoint a b, .geoPoint c d => pairCmp cmpDbl cmpDbl (a, b) (c, d)
  | .array xs, .array ys => cmpArray xs ys
  | .vector xs, .vector ys => cmpVector xs ys
  | .map xs, .map ys => cmpMap xs ys
  | a, b => cmpNat a.rank b.rank

def cmpArray : List Val → List Val → Ordering
  | [], [] => .eq
  | [], _ :: _ => .lt
  | _ :: _, [] => .gt
  | x :: xs, y :: ys => (cmp x y).then (cmpArray xs ys)

def cmpMap : List (List Nat × Val) → List (List Nat × Val) → Ordering
  | [], [] => .eq
  | [], _ :: _ => .lt
  | _ :: _, [] => .gt
  | (k, v) :: xs, (k', v') :: ys => ((cmpBytes k k').then (cmp v v')).then (cmpMap xs ys)
end

theorem cmpArray_eq : ∀ xs ys, cmpArray xs ys = lex cmp xs ys
  | [], [] => rfl
  | [], _ :: _ => rfl
  | _ :: _, [] => rfl
  | x :: xs, y :: ys => by simp only [cmpArray, lex, cmpArray_eq xs ys]

theorem cmpMap_eq : ∀ xs ys, cmpMap xs ys = lex (pairCmp cmpBytes cmp) xs ys
  | [], [] => rfl
  | [], _ :: _ => rfl
  | _ :: _, [] => rfl
  | (k, v) :: xs, (k', v') :: ys => by simp only [cmpMap, lex, pairCmp, cmpMap_eq xs ys]

/-! ## Type order -/

theorem cmpNat_of_lt {a b : Nat} (h : a < b) : cmpNat a b = .lt := by
  unfold cmpNat cmpInt; repeat' split
  all_goals first | rfl | omega

theorem cmpNat_of_gt {a b : Nat} (h : b < a) : cmpNat a b = .gt := by
  unfold cmpNat cmpInt; repeat' split
  all_goals first | rfl | omega

theorem cmp_of_rank_ne {a b : Val} (h : a.rank ≠ b.rank) : cmp a b = cmpNat a.rank b.rank := by
  cases a <;> cases b <;> simp_all [Val.rank, cmp]

theorem cmp_of_rank_lt {a b : Val} (h : a.rank < b.rank) : cmp a b = .lt := by
  rw [cmp_of_rank_ne (by omega), cmpNat_of_lt h]

theorem rank_le_of_cmp {a b : Val} (h : cmp a b ≠ .gt) : a.rank ≤ b.rank := by
  apply Classical.byContradiction; intro hn
  exact h (by rw [cmp_of_rank_ne (by omega), cmpNat_of_gt (by omega)])

/-- The laws hold at `c p` if they hold for the comparator `F` that `cmp` uses between two
values of the constructor `c`, and every value of the same type is some `c q`. -/
theorem laws_via {P : Type} (c : P → Val) (F : P → P → Ordering) (p : P)
    (hc : ∀ q r, cmp (c q) (c r) = F q r)
    (hsurj : ∀ y : Val, y.rank = (c p).rank → ∃ q, y = c q)
    (hF : Laws F p) : Laws cmp (c p) := by
  refine ⟨?_, ?_, ?_⟩
  · show cmp (c p) (c p) = .eq; rw [hc]; exact hF.1
  · intro y
    by_cases hy : y.rank = (c p).rank
    · obtain ⟨q, rfl⟩ := hsurj y hy
      rw [hc, hc]; exact hF.2.1 q
    · rw [cmp_of_rank_ne hy, cmp_of_rank_ne (Ne.symm hy)]
      exact (cmpNat_laws _).2.1 _
  · intro y z h1 h2
    have r1 := rank_le_of_cmp h1
    have r2 := rank_le_of_cmp h2
    by_cases hay : (c p).rank < y.rank
    · rw [cmp_of_rank_lt hay, cmp_of_rank_lt (by omega)]; rfl
    · obtain ⟨q, rfl⟩ := hsurj y (by omega)
      by_cases hyz : (c q).rank < z.rank
      · rw [cmp_of_rank_lt hyz, cmp_of_rank_lt (by omega)]
        cases h : cmp (c p) (c q) <;> simp_all [Ordering.then]
      · obtain ⟨r, rfl⟩ := hsurj z (by omega)
        rw [hc, hc, hc] at *
        exact hF.2.2 q r h1 h2

/-- Every value of the same type as `c p` is some `c q`. -/
macro "same_type" : tactic =>
  `(tactic| (intro y hy; cases y <;> simp_all [Val.rank]))

/-- `cmp` satisfies all three laws at every value: it is a total preorder. -/
theorem cmp_laws : ∀ a : Val, Laws cmp a
  | .null => laws_via (P := Unit) (fun _ => .null) (fun _ _ => .eq) ()
      (fun _ _ => rfl) (by same_type) ⟨rfl, fun _ => rfl, fun _ _ _ _ => rfl⟩
  | .nan => laws_via (P := Unit) (fun _ => .nan) (fun _ _ => .eq) ()
      (fun _ _ => rfl) (by same_type) ⟨rfl, fun _ => rfl, fun _ _ _ _ => rfl⟩
  | .bool b => laws_via Val.bool cmpBool b (fun _ _ => by simp [cmp]) (by same_type)
      (cmpBool_laws b)
  | .num n => laws_via Val.num cmpNum n (fun _ _ => by simp [cmp]) (by same_type)
      (cmpNum_laws n)
  | .timestamp s n => laws_via (P := Int × Nat) (fun q => .timestamp q.1 q.2)
      (pairCmp cmpInt cmpNat) (s, n) (fun _ _ => by simp [cmp]) (by same_type)
      (pairCmp_laws (cmpInt_laws s) (cmpNat_laws n))
  | .string u => laws_via Val.string cmpBytes u (fun _ _ => by simp [cmp]) (by same_type)
      (cmpBytes_laws u)
  | .bytes u => laws_via Val.bytes cmpBytes u (fun _ _ => by simp [cmp]) (by same_type)
      (cmpBytes_laws u)
  | .reference r => laws_via Val.reference (lex cmpBytes) r (fun _ _ => by simp [cmp])
      (by same_type) (lex_laws r (fun _ _ => cmpBytes_laws _))
  | .geoPoint la lo => laws_via (P := Dbl × Dbl) (fun q => .geoPoint q.1 q.2)
      (pairCmp cmpDbl cmpDbl) (la, lo) (fun _ _ => by simp [cmp]) (by same_type)
      (pairCmp_laws (cmpDbl_laws la) (cmpDbl_laws lo))
  | .vector v => laws_via Val.vector cmpVector v (fun _ _ => by simp [cmp]) (by same_type)
      (cmpVector_laws v)
  | .array xs => laws_via Val.array (lex cmp) xs (fun _ _ => by simp [cmp, cmpArray_eq])
      (by same_type) (lex_laws xs (fun x _ => cmp_laws x))
  | .map es => laws_via Val.map (lex (pairCmp cmpBytes cmp)) es
      (fun _ _ => by simp [cmp, cmpMap_eq]) (by same_type)
      (lex_laws es (fun e _ => pairCmp_laws (cmpBytes_laws e.1) (cmp_laws e.2)))
termination_by a => sizeOf a
decreasing_by
  all_goals
    simp_wf
    first
    | (have := List.sizeOf_lt_of_mem ‹_ ∈ xs›; omega)
    | (obtain ⟨k, v⟩ := e; have := List.sizeOf_lt_of_mem ‹(k, v) ∈ es›; simp at this ⊢; omega)

/-! ## The order laws in their usual form -/

theorem cmp_refl (a : Val) : cmp a a = .eq := (cmp_laws a).1

theorem cmp_swap (a b : Val) : cmp b a = (cmp a b).swap := (cmp_laws a).2.1 b

theorem cmp_le_trans {a b c : Val} (h1 : cmp a b ≠ .gt) (h2 : cmp b c ≠ .gt) :
    cmp a c ≠ .gt := le_trans (cmp_laws a).2.2 h1 h2

theorem cmp_lt_trans {a b c : Val} (h1 : cmp a b = .lt) (h2 : cmp b c = .lt) :
    cmp a c = .lt := lt_trans (cmp_laws a).2.2 h1 h2

theorem cmp_eq_trans {a b c : Val} (h1 : cmp a b = .eq) (h2 : cmp b c = .eq) :
    cmp a c = .eq := eq_trans (cmp_laws a).2.2 h1 h2

theorem cmp_total (a b : Val) : cmp a b ≠ .gt ∨ cmp b a ≠ .gt := total (cmp_laws a).2.1 b

end FVO
