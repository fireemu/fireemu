import RunnerParameterDefaults.Spec

namespace RunnerParameterDefaults

theorem existing_value_skips_evaluation (result : Result) (decl : Declaration) (text : String)
    (present : lookup result.env decl.name = some text) : step result decl = result := by
  simp [step, present]

theorem secret_skips_evaluation (result : Result) (decl : Declaration) (secret : decl.secret = true) :
    step result decl = result := by
  simp [step, secret]

theorem step_preserves_existing_value (result : Result) (decl : Declaration)
    (name text : String) (present : lookup result.env name = some text) :
    lookup (step result decl).env name = some text := by
  by_cases same : decl.name = name
  · rw [existing_value_skips_evaluation result decl text (same ▸ present)]
    exact present
  · unfold step
    split
    · exact present
    · split
      · exact present
      · simpa [lookup, List.find?_cons, same] using present

theorem run_preserves_existing_value (env : Env) (declarations : List Declaration)
    (name text : String) (present : lookup env name = some text) :
    lookup (run env declarations).env name = some text := by
  have preserved (start : Result) (ds : List Declaration)
      (h : lookup start.env name = some text) :
      lookup (ds.foldl step start).env name = some text := by
    induction ds generalizing start with
    | nil => exact h
    | cons decl rest ih =>
      exact ih (step start decl) (step_preserves_existing_value _ _ _ _ h)
  exact preserved { env } declarations present

theorem ordering_is_observable :
    let definition : Declaration := ⟨"x", false, .serialized "preset"⟩
    let dependent : Declaration := ⟨"y", false, .reference "x"⟩
    lookup (run [] [definition, dependent]).env "y" = some "preset" ∧
    lookup (run [] [dependent, definition]).env "y" = none := by decide

theorem empty_value_is_present :
    run [("x", "")] [⟨"x", false, .serialized "new"⟩] = { env := [("x", "")] } := by decide

theorem retry_after_failed_default :
    (run [] [⟨"x", false, .thrown⟩, ⟨"x", false, .serialized "new"⟩]).assigned = ["x"] := by decide

end RunnerParameterDefaults
