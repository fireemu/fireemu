import ExportLevelDb.Theorems

/-- info: 'ExportLevelDb.chunk_sum' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ExportLevelDb.chunk_sum

/-- info: 'ExportLevelDb.chunks_fit' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ExportLevelDb.chunks_fit

/-- info: 'ExportLevelDb.continuation_payload_sizes' depends on axioms: [propext] -/
#guard_msgs in #print axioms ExportLevelDb.continuation_payload_sizes

/-- info: 'ExportLevelDb.padding_occupies_only_short_trailer' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ExportLevelDb.padding_occupies_only_short_trailer

/-- info: 'ExportLevelDb.first_capacity_bounded' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ExportLevelDb.first_capacity_bounded

/-- info: 'ExportLevelDb.layout_conserves_payload' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ExportLevelDb.layout_conserves_payload

/-- info: 'ExportLevelDb.layouts_conserve_payload' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms ExportLevelDb.layouts_conserve_payload

/-- info: 'ExportLevelDb.exact_header_can_emit_empty_first' does not depend on any axioms -/
#guard_msgs in #print axioms ExportLevelDb.exact_header_can_emit_empty_first

/-- info: 'ExportLevelDb.short_tail_is_padded_before_the_next_header' does not depend on any axioms -/
#guard_msgs in #print axioms ExportLevelDb.short_tail_is_padded_before_the_next_header
