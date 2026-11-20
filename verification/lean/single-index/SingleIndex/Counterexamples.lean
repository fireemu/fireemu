import SingleIndex.Theorems

namespace SI

def a : Path := ["a"]
def b : Path := ["b"]
def tags : Path := ["tags"]
def localCollection := "items"

def defaults : Overrides := fun _ _ => none
def disabled : Overrides := fun _ _ => some []
def ascOnly : Overrides := fun _ _ => some [(.collection, ascending)]

theorem group_composite_serves_collection :
    let r := orderOnly a .asc .desc
    let i := singleFieldIndex localCollection .group a ascending .desc
    compositeServes i r localCollection .collection = true ∧
      ¬ Serves i localCollection .collection [] none [(a, .asc)] .desc := by
  simp [Serves, singleFieldIndex]
  decide

theorem name_before_order :
    let i : Index := ⟨localCollection, .collection, [key .asc, (a, ascending)]⟩
    compositeServes i (orderOnly a .asc .asc) localCollection .collection = true ∧
      ¬ ScanKeys i.fields [] none [(a, .asc)] .asc := by
  refine ⟨by decide, ?_⟩
  rintro ⟨fixed, suffix, hf, hfixed, _, _⟩
  have h : fixed = [] := List.eq_nil_of_length_eq_zero hfixed.1
  simp [h, key, varyingKeys, arrayKeys, a, name] at hf

theorem first_name_wins :
    let i : Index := ⟨localCollection, .collection, [(a, ascending), key .asc, key .desc]⟩
    compositeServes i (orderOnly a .asc .asc) localCollection .collection = true ∧
      ¬ ScanKeys i.fields [] none [(a, .asc)] .asc := by
  refine ⟨by decide, ?_⟩
  rintro ⟨fixed, suffix, hf, hfixed, _, hs⟩
  have h : fixed = [] := List.eq_nil_of_length_eq_zero hfixed.1
  rcases hs with rfl | ⟨rfl, _⟩ <;> simp [h, key, varyingKeys, arrayKeys, a, name] at hf

theorem implicit_name_ignores_fixed_prefix :
    let i : Index := ⟨localCollection, .collection, [(a, ascending)]⟩
    compositeServes i (equalityOnly a .desc) localCollection .collection = true ∧
      ¬ ScanKeys i.fields [a] none [] .desc := by
  refine ⟨by decide, ?_⟩
  rintro ⟨fixed, suffix, hf, hfixed, _, hs⟩
  have hl := hfixed.1
  simp at hl
  rcases hs with rfl | ⟨rfl, hdir⟩
  · have he := congrArg List.length hf
    simp [arrayKeys, varyingKeys, hl] at he
  · simp [arrayKeys, varyingKeys] at hf hdir
    rw [← hf] at hdir
    contradiction

theorem implicit_name_ignores_array_key :
    let i : Index := ⟨localCollection, .collection, [(tags, .contains)]⟩
    compositeServes i (membershipOnly tags .desc) localCollection .collection = true ∧
      ¬ ScanKeys i.fields [] (some tags) [] .desc := by
  refine ⟨by decide, ?_⟩
  rintro ⟨fixed, suffix, hf, hfixed, _, hs⟩
  have he : fixed = [] := List.eq_nil_of_length_eq_zero hfixed.1
  rcases hs with rfl | ⟨rfl, hdir⟩
  · simp [he, arrayKeys, varyingKeys] at hf
  · simp [he, arrayKeys, varyingKeys, implicitTie] at hdir

theorem contains_covers_overlapping_equality :
    let i := singleFieldIndex localCollection .collection tags .contains .asc
    automaticIndexFor (overlapping tags .asc) defaults localCollection .collection = some i ∧
      compositeServes i (overlapping tags .asc) localCollection .collection = false := by decide

theorem opposite_order_name_needs_composite :
    let r := orderOnly a .asc .desc
    let i := singleFieldIndex localCollection .collection a ascending .desc
    compositeServes i r localCollection .collection = true ∧
      automaticIndexFor r defaults localCollection .collection = none := by decide

theorem repeated_order_uses_first_direction :
    let r : Requirement := ⟨[], none, [(a, .asc), (a, .desc), (name, .asc)], false⟩
    let i := singleFieldIndex localCollection .collection a ascending .asc
    automaticIndexFor r defaults localCollection .collection = some i ∧
      compositeServes i r localCollection .collection = false := by decide

theorem primary_key_reversal_refused :
    let r : Requirement := ⟨[], none, [(name, .asc)], false⟩
    (automaticIndexFor r defaults localCollection .collection).isSome = true ∧
      automaticIndexFor (flipRequirement r) defaults localCollection .collection = none := by decide

theorem equality_reversal_depends_on_enabled_modes :
    let r := equalityOnly a .asc
    let reversedLookup : Overrides := fun _ _ => some [(.collection, descending)]
    automaticIndexFor r ascOnly localCollection .collection =
      some (singleFieldIndex localCollection .collection a ascending .asc) ∧
      automaticIndexFor (flipRequirement r) ascOnly localCollection .collection =
        some (singleFieldIndex localCollection .collection a ascending .desc) ∧
      automaticIndexFor (flipRequirement r) reversedLookup localCollection .collection =
        some (singleFieldIndex localCollection .collection a descending .desc) := by decide

theorem head_refuses_ascending_only :
    let r := equalityOnly a .desc
    decideBase r ascOnly localCollection .collection [] .production .standard none =
      .useIndex (singleFieldIndex localCollection .collection a ascending .desc) ∧
    decideHead r ascOnly localCollection .collection [] .production .standard true true none none =
      .missing (requiredIndex r localCollection .collection) := by
  dsimp only
  refine ⟨by decide, ?_⟩
  have hb : decideBase (equalityOnly a .desc) ascOnly localCollection .collection []
      .production .standard none =
      .useIndex (singleFieldIndex localCollection .collection a ascending .desc) := by decide
  rw [decideHead, hb]
  rfl

def manyEqualities (n : Nat) : List Path :=
  (List.range n).map fun n => [s!"e{n}"]

theorem required_index_can_exceed_capacity :
    let r : Requirement := ⟨manyEqualities 100, none, [(name, .asc)], false⟩
    let i := requiredIndex r localCollection .collection
    checkCapacity i = some .tooManyFields ∧ checkNecessary i = none ∧
      compositeServes i r localCollection .collection = true := by
  let r : Requirement := ⟨manyEqualities 100, none, [(name, .asc)], false⟩
  let i := requiredIndex r localCollection .collection
  have hlen : i.fields.length = 101 := by simp [i, r, requiredIndex, sortPaths, manyEqualities]
  change checkCapacity i = _ ∧ checkNecessary i = _ ∧ compositeServes i r _ _ = _
  exact ⟨by simp [checkCapacity, hlen], by simp [checkNecessary, hlen],
    required_index_accepted r localCollection .collection [] .asc rfl (by simp)⟩

theorem name_before_order_reorders_documents :
    let left : Document := ⟨fun p => if p = name then 0 else 1, fun _ => []⟩
    let right : Document := ⟨fun p => if p = name then 1 else 0, fun _ => []⟩
    lexCompare [key .asc, (a, ascending)] left right = .lt ∧
      lexCompare [(a, ascending), key .asc] left right = .gt := by decide

theorem contains_scan_can_admit_non_equal_array :
    let d : Document := ⟨fun _ => 2, fun _ => [0, 1]⟩
    let expected := fun (_ : Path) => 1
    matchesQuery d [] (some tags) expected 0 ∧
      ¬ matchesQuery d [tags] (some tags) expected 0 := by
  simp [matchesQuery]

end SI
