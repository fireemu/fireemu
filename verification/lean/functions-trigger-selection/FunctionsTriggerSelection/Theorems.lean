import FunctionsTriggerSelection.Spec

namespace FTS

theorem dispatch_append (a b : List Function) (q : Query) :
    dispatch (a ++ b) q = dispatch a q ++ dispatch b q := by
  simp [dispatch, List.filter_append]

theorem dispatch_reverse (fs : List Function) (q : Query) :
    dispatch fs.reverse q = (dispatch fs q).reverse := by
  simp [dispatch, List.filter_reverse]

theorem dispatch_selects_iff (f : Function) (fs : List Function) (q : Query) :
    f ∈ dispatch fs q ↔ f ∈ fs ∧ applies f.trigger q = true := by
  simp [dispatch]

theorem disabled_stays_disabled (fs : List Function) (kind : String) :
    blockingTarget fs kind .disabled = .ok none := rfl

theorem discovery_chooses_first_matching (f : Function) (fs : List Function) (kind : String)
    (matching : f.trigger = .blocking kind) :
    blockingTarget (f :: fs) kind .discovery = .ok (some f.name) := by
  simp [blockingTarget, matching]

theorem named_wrong_event_precedes_region (f : Function) (kind : String) (region : Option String)
    (wrong : f.trigger ≠ .blocking kind) :
    blockingTarget [f] kind (.named f.name region) = .error .wrongEvent := by
  simp [blockingTarget, wrong]

end FTS
