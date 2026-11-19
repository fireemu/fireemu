import CursorOrder.Model

namespace CO

theorem effective_name (e : Order) (i : List Nat) : 0 ∈ (effective e i).map Prod.fst := by
  by_cases h : 0 ∈ e.map Prod.fst <;> simp [effective, h]

/-- No name in the explicit order, or a final explicit name and no still-unordered inequality. -/
theorem effective_well_formed (e : Order) (i : List Nat) (he : (e.map Prod.fst).Nodup)
    (hi : i.Nodup) (shape : 0 ∉ e.map Prod.fst ∨
      (∃ p b, e = p ++ [(0,b)]) ∧ ∀ f ∈ i, f = 0 ∨ f ∈ e.map Prod.fst) :
    EffectiveSpec e (effective e i) := by
  let fs := e.map Prod.fst
  let extra := i.filter fun f => f != 0 && !fs.contains f
  have hx : extra.Nodup := hi.filter _
  have sep (f) (h : f ∈ extra) : f ≠ 0 ∧ f ∉ fs := by simpa [extra] using (List.mem_filter.mp h).2
  have nd : (fs ++ extra).Nodup := List.nodup_append.mpr
    ⟨he, hx, fun a ha b hb eq => sep b hb |>.2 (eq ▸ ha)⟩
  rcases shape with h | ⟨⟨p,b,rfl⟩, covered⟩
  · have hz : 0 ∉ fs ++ extra := by
      simp only [List.mem_append, not_or]; exact ⟨h, fun hh => (sep 0 hh).1 rfl⟩
    constructor
    · have hh : fs.contains 0 = false := by simpa [fs] using h
      change ((e ++ extra.map _ ++ (if fs.contains 0 then [] else [_])).map Prod.fst).Nodup
      simp only [hh, Bool.false_eq_true, ↓reduceIte, List.map_append, List.map_map, Function.comp_def, List.map_cons, List.map_nil]
      simpa only [List.map_id'] using
        (show ((fs ++ extra) ++ [0]).Nodup from List.nodup_append.mpr
          ⟨nd, by simp, by intro a ha b hb eq; simp at hb; exact hz ((eq.trans hb) ▸ ha)⟩)
    · exact ⟨e ++ extra.map (fun f => (f,(e.getLast?.map Prod.snd).getD false)), by simp [extra, fs, effective, h]⟩
  · have empty : extra = [] := List.eq_nil_iff_forall_not_mem.mpr fun f hf => by
      rcases covered f (List.mem_filter.mp hf).1 with h | h
      · exact (sep f hf).1 h
      · exact (sep f hf).2 h
    have hout : effective (p ++ [(0,b)]) i = p ++ [(0,b)] := by
      change (p ++ [(0,b)]) ++ extra.map _ ++ (if fs.contains 0 then [] else _) = _
      simp [empty, fs]
    rw [hout]
    exact ⟨he, p, by simp⟩

theorem explicit_name_before_inequality :
    effective [(0,true)] [1] = [(0,true),(1,true)] ∧
    check false [(0,true)] [1] 0 = some .afterName := by decide

theorem duplicate_explicit_field :
    effective [(1,false),(1,true)] [] = [(1,false),(1,true),(0,true)] ∧
    check false [(1,false),(1,true)] [] 0 = none ∧
    check true [(1,false),(1,true)] [] 0 = some .duplicate := by decide

theorem implicit_cursor_arity :
    check true [] [] 1 = some .arity ∧ check false [] [] 1 = none := by decide

theorem pair_projection (a b : Row) (f : Nat) :
    (slot a f).pair (slot b f) = FVO.cmp (project a f) (project b f) := by
  by_cases h : f = 0 <;> simp [slot, project, h, Slot.pair, FVO.cmp]

theorem cursor_projection (s : Slot) (v : FVO.Val) : s.against v = FVO.cmp s.value v := by
  cases s with
  | stored => rfl
  | name p => cases v <;> simp [Slot.against, Slot.value, FVO.cmp, FVO.Val.rank]

theorem keys_spec (o : Order) (a b : Row) : compareKeys o (key a o) (key b o) = lexSpec o a b := by
  induction o with
  | nil => rfl
  | cons c cs ih =>
    simp only [key, List.map_cons, compareKeys, scan, pair_projection] at *
    unfold lexSpec at *
    simp only [List.map_cons, List.find?_cons]
    rw [ih]
    cases directed c.2 (FVO.cmp (project a c.1) (project b c.1)) <;> rfl

theorem full_cursor (o : Order) (a b : Row) :
    compareCursor o (key a o) ((key b o).map Slot.value) = compareKeys o (key a o) (key b o) := by
  induction o with
  | nil => rfl
  | cons c cs ih =>
    simp only [key, List.map_cons, compareKeys, compareCursor, scan, cursor_projection, pair_projection] at *
    rw [ih]
    by_cases h : c.1 = 0 <;> simp [slot, project, h, Slot.value]

theorem prefix_cursor (o : Order) (k : List Slot) (v : List FVO.Val) :
    compareCursor o k v = compareCursor (o.take v.length) (k.take v.length) v := by
  induction v generalizing o k with
  | nil => cases o <;> cases k <;> rfl
  | cons v vs ih =>
    cases o <;> cases k <;> simp only [List.length_cons, List.take_succ_cons, List.take_nil, compareCursor, scan]
    exact congrArg _ (ih _ _)

theorem bounds_partition (o : Order) (k : List Slot) (v : List FVO.Val) (before : Bool) :
    admits o k (some (v,before)) none = !(admits o k none (some (v,before))) := by
  cases before <;> cases h : compareCursor o k v <;> simp [admits, bound, h]

theorem start_after (o : Order) (a b : Row) :
    admits o (key a o) (some ((key b o).map Slot.value,false)) none =
    (compareKeys o (key a o) (key b o) == .gt) := by
  simp only [admits, Option.all, Bool.and_true, full_cursor]
  cases compareKeys o (key a o) (key b o) <;> rfl

def reverseOrder (o : Order) := o.map fun c => (c.1, !c.2)

theorem reverse_keys (o : Order) (a b : Row) :
    compareKeys (reverseOrder o) (key a (reverseOrder o)) (key b (reverseOrder o)) =
    (compareKeys o (key a o) (key b o)).swap := by
  induction o with
  | nil => rfl
  | cons c cs ih =>
    simp only [reverseOrder, key, List.map_cons, compareKeys, scan, Ordering.swap_then] at *
    rw [ih]
    cases c.2 <;> simp [directed]


theorem directed_laws (desc : Bool) (v : FVO.Val) :
    FVO.Laws (fun a b => directed desc (FVO.cmp a b)) v := by
  cases desc with
  | false => exact FVO.cmp_laws v
  | true =>
    simp only [directed, ite_true]
    refine ⟨by simp [FVO.Refl, FVO.cmp_refl], ?_, ?_⟩
    · intro y; dsimp only; rw [FVO.cmp_swap v y]
    · intro y z h₁ h₂
      dsimp only at h₁ h₂ ⊢
      rw [← FVO.cmp_swap] at h₁ h₂ ⊢
      rw [(FVO.cmp_laws z).2.2 y v h₂ h₁, ← FVO.cmp_swap, ← FVO.cmp_swap]
      cases h : FVO.cmp z y <;> cases h' : FVO.cmp y v <;> simp_all [Ordering.then]

theorem keys_laws (o : Order) (a : Row) :
    FVO.Laws (fun x y => compareKeys o (key x o) (key y o)) a := by
  induction o with
  | nil => exact ⟨rfl, fun _ => rfl, fun _ _ _ _ => rfl⟩
  | cons c cs ih =>
    simp only [key, List.map_cons, compareKeys, scan, pair_projection] at *
    exact FVO.comap_laws (k := fun x : Row => (project x c.1,x))
      (FVO.pairCmp_laws (directed_laws c.2 _) ih)

theorem lex_eq_injective {f : α → α → Ordering} (h : ∀ a b, f a b = .eq → a = b)
    (as bs : List α) : FVO.lex f as bs = .eq → as = bs := by
  induction as generalizing bs with
  | nil => cases bs <;> simp [FVO.lex]
  | cons a as ih =>
    cases bs with
    | nil => simp [FVO.lex]
    | cons b bs =>
      cases hc : f a b <;> simp [FVO.lex, hc, Ordering.then]
      exact fun ht => ⟨h a b hc, ih bs ht⟩

theorem name_separates (o : Order) (a b : Row) (hn : 0 ∈ o.map Prod.fst)
    (eq : compareKeys o (key a o) (key b o) = .eq) : a.name = b.name := by
  induction o with
  | nil => simp at hn
  | cons c cs ih =>
    simp only [key, List.map_cons, compareKeys, scan] at eq
    cases hc : (slot a c.1).pair (slot b c.1) <;> cases hd : c.2 <;>
      simp [directed, hc, hd, Ordering.then] at eq
    all_goals
      rcases List.mem_cons.mp hn with head | tail
      · simp [slot, ← head, Slot.pair] at hc
        apply lex_eq_injective _ _ _ hc
        intro x y hxy
        apply lex_eq_injective _ _ _ hxy
        intro x y h
        unfold FVO.cmpNat FVO.cmpInt at h
        split at h <;> simp_all <;> omega
      · exact ih tail eq

theorem effective_distinct (e : Order) (i : List Nat) (a b : Row) (h : a.name ≠ b.name) :
    compareKeys (effective e i) (key a (effective e i)) (key b (effective e i)) ≠ .eq :=
  fun eq => h (name_separates _ _ _ (effective_name e i) eq)


def Document.row (d : Document) : Row := ⟨d.name, fun f => (d.field f).getD .null⟩

theorem present_key (d : Document) (o : Order) (k : List Slot) (h : orderKey d o = some k) :
    k = key d.row o := by
  induction o generalizing k with
  | nil => simpa [orderKey, key] using h.symm
  | cons c cs ih =>
    cases ht : orderKey d cs with
    | none =>
      simp only [orderKey] at ht h
      by_cases hn : c.1 = 0 <;> cases hv : d.field c.1 <;>
        simp [List.mapM_cons, hn, hv, ht] at h
    | some tail =>
      have eq := ih tail ht
      simp only [orderKey] at ht h
      by_cases hn : c.1 = 0 <;> cases hv : d.field c.1 <;>
        simp_all [List.mapM_cons, key, slot, Document.row]

theorem built_cursor (doc : Option Document) (scope : Bool) (filter : Except Unit Bool)
    (o : Order) (s e : Option Cursor) (c : Cursor)
    (h : cursorAfterDocument doc scope filter o s e = .ok (some c)) :
    ∃ d, doc = some d ∧ c = ((key d.row o).map Slot.value, false) := by
  cases doc with
  | none => simp [cursorAfterDocument, pure, Except.pure] at h
  | some d =>
    cases scope <;> cases filter with
    | error => simp [cursorAfterDocument, Except.bind, bind, pure, Except.pure] at h
    | ok ok =>
      cases ok <;> cases hk : orderKey d o <;>
        simp [cursorAfterDocument, hk, Except.bind, bind, pure, Except.pure] at h
      all_goals split at h <;> simp_all [present_key d o _ hk]


theorem start_after_built (d : Document) (scope : Bool) (filter : Except Unit Bool)
    (o : Order) (s e : Option Cursor) (c : Cursor)
    (h : cursorAfterDocument (some d) scope filter o s e = .ok (some c)) (a : Row) :
    admits o (key a o) (some c) none = (compareKeys o (key a o) (key d.row o) == .gt) := by
  obtain ⟨d', hd, rfl⟩ := built_cursor _ _ _ _ _ _ _ h
  cases hd
  exact start_after _ _ _

theorem name_before_last_explicit :
    effective [(0,false),(1,true)] [] = [(0,false),(1,true)] ∧
    check true [(0,false),(1,true)] [] 0 = some .afterName := by decide

theorem missing_field_no_cursor :
    cursorAfterDocument (some ⟨[[97]], fun _ => none⟩) true (.ok true)
      (effective [(1,false)] []) none none = .ok none := rfl


theorem bound_spec (start before : Bool) (sign : Ordering) :
    bound start before sign = true ↔ BoundSpec start before sign := by
  cases start <;> cases before <;> cases sign <;> simp [BoundSpec, bound]

theorem effective_fields (e : Order) (i : List Nat) (f : Nat) :
    f ∈ (effective e i).map Prod.fst ↔ f = 0 ∨ f ∈ e.map Prod.fst ∨ f ∈ i := by
  by_cases h : 0 ∈ e.map Prod.fst <;> by_cases hf : f ∈ e.map Prod.fst <;>
    by_cases hz : f = 0 <;> simp_all [effective, List.mem_append]

theorem prefix_document (n : Nat) (o : Order) (a b : Row) :
    compareCursor o (key a o) (((key b o).map Slot.value).take n) = lexSpec (o.take n) a b := by
  have eq : compareCursor o (key a o) (((key b o).map Slot.value).take n) =
      compareKeys (o.take n) (key a (o.take n)) (key b (o.take n)) := by
    induction n generalizing o with
    | zero => cases o <;> rfl
    | succ n ih =>
      cases o with
      | nil => rfl
      | cons c cs =>
        simp only [key, List.map_cons, List.take_succ_cons, compareKeys, compareCursor, scan,
          cursor_projection, pair_projection] at *
        rw [ih]
        by_cases h : c.1 = 0 <;> simp [slot, project, h, Slot.value]
  exact eq.trans (keys_spec _ _ _)


theorem repeated_name :
    effective [(0,true),(0,false)] [] = [(0,true),(0,false)] ∧
    check false [(0,true),(0,false)] [] 0 = some .afterName ∧
    check true [(0,true),(0,false)] [] 0 = some .duplicate := by decide

theorem build_iff (d : Document) (o : Order) (s e : Option Cursor) (c : Cursor) :
    cursorAfterDocument (some d) true (.ok true) o s e = .ok (some c) ↔
      ∃ k, orderKey d o = some k ∧ admits o k s e = true ∧ c = (k.map Slot.value,false) := by
  cases hk : orderKey d o with
  | none => simp [cursorAfterDocument, hk, Except.bind, bind, pure, Except.pure]
  | some k =>
    cases ha : admits o k s e <;>
      simp [cursorAfterDocument, hk, ha, Except.bind, bind, pure, Except.pure] <;> exact eq_comm


/-- On the domain where orderKey exists, the order is total and an equal comparison implies identical document names. -/
theorem document_total_order (e : Order) (i : List Nat) (a b c : Row) :
    let o := effective e i
    let cmp := fun x y => compareKeys o (key x o) (key y o)
    cmp a a = .eq ∧ cmp b a = (cmp a b).swap ∧
      (cmp a b ≠ .gt ∨ cmp b a ≠ .gt) ∧
      (cmp a b ≠ .gt → cmp b c ≠ .gt → cmp a c ≠ .gt) ∧
      (cmp a b = .eq → a.name = b.name) := by
  dsimp only
  have laws := keys_laws (effective e i) a
  exact ⟨laws.1, laws.2.1 b, FVO.total laws.2.1 b, FVO.le_trans laws.2.2,
    name_separates _ _ _ (effective_name e i)⟩


/-- Rendering a valid resource name into a cursor and splitting the reference for comparison preserves exactly the borrowed path segments. -/
theorem rendered_name_value (p : Path) (nonempty : p ≠ []) (segments : ∀ s ∈ p, 47 ∉ s) :
    (Slot.name p).value = .reference (([47].intercalate p).splitOn 47) := by
  rw [List.splitOn_intercalate 47 segments nonempty]
  rfl

theorem effective_layout (e : Order) (i : List Nat) : LayoutSpec e i (effective e i) := by
  refine ⟨i.filter (fun f => f != 0 && !(e.map Prod.fst).contains f), List.filter_sublist, ?_, ?_⟩
  · intro f; simp
  · simp [effective]

end CO
