import FirestorePipelineGroupOrder.Theorems

namespace FirestorePipelineGroupOrder

/-- info: 'FirestorePipelineGroupOrder.materialization_keeps_key' depends on axioms: [propext] -/
#guard_msgs in
#print axioms materialization_keeps_key

/-- info: 'FirestorePipelineGroupOrder.insertion_preserves_head' depends on axioms: [propext] -/
#guard_msgs in
#print axioms insertion_preserves_head

/-- info: 'FirestorePipelineGroupOrder.insertion_counts_one' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms insertion_counts_one

/-- info: 'FirestorePipelineGroupOrder.cardinality_from_accumulator' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms cardinality_from_accumulator

/-- info: 'FirestorePipelineGroupOrder.grouped_cardinality' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in
#print axioms grouped_cardinality

/-- info: 'FirestorePipelineGroupOrder.no_alias_group_on_empty_input' depends on axioms: [propext] -/
#guard_msgs in
#print axioms no_alias_group_on_empty_input

/-- info: 'FirestorePipelineGroupOrder.no_distinct_keys_on_empty_input' depends on axioms: [propext] -/
#guard_msgs in
#print axioms no_distinct_keys_on_empty_input

end FirestorePipelineGroupOrder
