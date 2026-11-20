import FirestoreSearchRanking.Theorems

namespace FirestoreSearchRanking

/-- info: 'FirestoreSearchRanking.candidate_covers_required_term' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms candidate_covers_required_term
/-- info: 'FirestoreSearchRanking.concatenation_is_independent' depends on axioms: [propext] -/
#guard_msgs in
#print axioms concatenation_is_independent
/-- info: 'FirestoreSearchRanking.retrieval_is_bounded' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms retrieval_is_bounded
/-- info: 'FirestoreSearchRanking.zero_depth_selects_nothing' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms zero_depth_selects_nothing
/-- info: 'FirestoreSearchRanking.rank_keeps_retrieval_members' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms rank_keeps_retrieval_members
/-- info: 'FirestoreSearchRanking.score_ranking_preserves_length' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms score_ranking_preserves_length

end FirestoreSearchRanking
