import RulesLexicalFunctions.Spec

/-- info: 'RulesLexicalFunctions.last_declaration' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesLexicalFunctions.last_declaration

/-- info: 'RulesLexicalFunctions.unrelated_declaration' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms RulesLexicalFunctions.unrelated_declaration

/-- info: 'RulesLexicalFunctions.nearest_shadows_every_ancestor' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesLexicalFunctions.nearest_shadows_every_ancestor

/-- info: 'RulesLexicalFunctions.falls_back_on_miss' depends on axioms: [propext] -/
#guard_msgs in #print axioms RulesLexicalFunctions.falls_back_on_miss

/-- info: 'RulesLexicalFunctions.wrapper_uses_its_declaration_scope' does not depend on any axioms -/
#guard_msgs in #print axioms RulesLexicalFunctions.wrapper_uses_its_declaration_scope

/-- info: 'RulesLexicalFunctions.duplicate_rejects_before_lookup' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms RulesLexicalFunctions.duplicate_rejects_before_lookup
