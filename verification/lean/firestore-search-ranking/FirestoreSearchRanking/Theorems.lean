import FirestoreSearchRanking.Spec

namespace FirestoreSearchRanking

theorem candidate_covers_required_term (present : String → Bool) (terms : List String)
    (term : String) (joined : Option String) (member : term ∈ terms)
    (matched : terms.all present = true) : postingCandidate present term joined = true := by
  have found := List.all_eq_true.mp matched term member
  simp [postingCandidate, found]

theorem concatenation_is_independent (present : String → Bool) (term joined : String)
    (matched : present joined = true) : postingCandidate present term (some joined) = true := by
  simp [postingCandidate, matched]

theorem retrieval_is_bounded (input : List Hit) (depth : Nat) :
    (retrieved input (some depth)).length ≤ depth := by
  simp [retrieved, Nat.min_le_left]

theorem zero_depth_selects_nothing (input : List Hit) (score : Bool) (offset : Nat)
    (limit : Option Nat) : page input (some 0) score offset limit = [] := by
  simp [page, ranked, retrieved]

theorem rank_keeps_retrieval_members (input : List Hit) (depth : Option Nat) (score : Bool)
    (hit : Hit) : hit ∈ ranked input depth score ↔ hit ∈ retrieved input depth := by
  cases score <;> simp [ranked]

theorem score_ranking_preserves_length (input : List Hit) (depth : Option Nat) :
    (ranked input depth true).length = (retrieved input depth).length := by
  simp [ranked]

end FirestoreSearchRanking
