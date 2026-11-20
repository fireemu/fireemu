import AdapterBoundedBody.Theorems

/-- info: 'AB.successful_body_fits' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms AB.successful_body_fits

/-- info: 'AB.trailers_free' does not depend on any axioms -/
#guard_msgs in #print axioms AB.trailers_free

/-- info: 'AB.transport_stops' does not depend on any axioms -/
#guard_msgs in #print axioms AB.transport_stops

/-- info: 'AB.over_budget_stops' depends on axioms: [propext] -/
#guard_msgs in #print axioms AB.over_budget_stops
