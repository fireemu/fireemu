import HostingMatch.Theorems

/-! Guard the trusted axiom set of the exported results. -/

/-- info: 'HostingMatch.first_matching_rule_keeps_order' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms HostingMatch.first_matching_rule_keeps_order

/-- info: 'HostingMatch.nonempty_glob_wins_over_other_properties' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms HostingMatch.nonempty_glob_wins_over_other_properties

/-- info: 'HostingMatch.emulator_star_keeps_dot_shield' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms HostingMatch.emulator_star_keeps_dot_shield

/-- info: 'HostingMatch.trailing_empty_part_is_accepted_after_matching' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms HostingMatch.trailing_empty_part_is_accepted_after_matching
