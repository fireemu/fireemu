import HostingMatch.Spec

namespace HostingMatch

theorem first_matching_rule_keeps_order (rule : Rule) (tail : List Rule) (prod : Bool)
    (path : String) (matchHead : admitsRule prod rule path = true) :
    firstRule prod path (rule :: tail) = some 0 := by
  simp [firstRule, firstIndex, matchHead]

theorem nonempty_glob_wins_over_other_properties (rule : Rule) (prod : Bool) (path : String)
    (nonempty : rule.glob.isEmpty = false) :
    admitsRule prod rule path = glob prod rule.glob path := by
  simp [admitsRule, nonempty]

theorem emulator_star_keeps_dot_shield (value : String) (dot : value.startsWith "." = true) :
    segment false "*" value = false := by
  simp [segment, dot]

theorem trailing_empty_part_is_accepted_after_matching (prod : Bool) :
    matchComponents prod [] [""] = true := by
  rfl

end HostingMatch
