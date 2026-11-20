import AdapterBoundedBody.Spec

namespace AB

theorem successful_body_fits (frames : List Frame) (budget : Nat) (bytes : List Char)
    (h : (collect frames budget).1 = .ok bytes) :
    bytes.length ≤ budget := by
  induction frames generalizing budget bytes with
  | nil =>
    have empty : [] = bytes := Except.ok.inj h
    simp [← empty]
  | cons first tail ih =>
    cases first with
    | transportError => cases h
    | trailers => exact ih budget bytes h
    | data chunk =>
      by_cases x : chunk.length > budget
      · simp [collect, x] at h
      · cases hr : (collect tail (budget - chunk.length)).1 with
        | error e => simp [collect, x, hr, Except.map] at h
        | ok rest =>
          have bounded := ih (budget - chunk.length) rest hr
          simp [collect, x, hr, Except.map] at h
          rw [← h, List.length_append]
          omega

theorem trailers_free (tail : List Frame) (budget : Nat) :
    (collect (.trailers :: tail) budget).1 = (collect tail budget).1 := rfl

theorem transport_stops (tail : List Frame) (budget : Nat) :
    collect (.transportError :: tail) budget = (.error .read, 1) := rfl

theorem over_budget_stops (bytes : List Char) (tail : List Frame) (budget : Nat)
    (h : bytes.length > budget) :
    collect (.data bytes :: tail) budget = (.error .large, 1) := by simp [collect, h]

end AB
