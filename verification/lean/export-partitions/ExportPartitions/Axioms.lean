import ExportPartitions.Theorems

/-- info: 'ExportPartitions.default_partition' does not depend on any axioms -/
#guard_msgs in #print axioms ExportPartitions.default_partition

/-- info: 'ExportPartitions.always_at_least_one' depends on axioms: [propext] -/
#guard_msgs in #print axioms ExportPartitions.always_at_least_one

/-- info: 'ExportPartitions.namespaces_override' does not depend on any axioms -/
#guard_msgs in #print axioms ExportPartitions.namespaces_override

/-- info: 'ExportPartitions.namespaces_keep_order' does not depend on any axioms -/
#guard_msgs in #print axioms ExportPartitions.namespaces_keep_order

/-- info: 'ExportPartitions.collections_keep_order' does not depend on any axioms -/
#guard_msgs in #print axioms ExportPartitions.collections_keep_order

/-- info: 'ExportPartitions.adding_collections_appends_partitions' depends on axioms: [propext] -/
#guard_msgs in #print axioms ExportPartitions.adding_collections_appends_partitions

/-- info: 'ExportPartitions.repeated_empty_namespace_keeps_duplicates' does not depend on any axioms -/
#guard_msgs in #print axioms ExportPartitions.repeated_empty_namespace_keeps_duplicates

/-- info: 'ExportPartitions.only_leaf_collection_is_selected' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ExportPartitions.only_leaf_collection_is_selected

/-- info: 'ExportPartitions.named_namespaces_are_empty' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ExportPartitions.named_namespaces_are_empty

/-- info: 'ExportPartitions.selection_preserves_order' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms ExportPartitions.selection_preserves_order
