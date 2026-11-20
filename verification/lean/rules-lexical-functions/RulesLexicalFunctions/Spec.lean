import Std

namespace RulesLexicalFunctions

abbrev Scope := List (String × Nat)

/-- Lookup within one scope. Parsed scopes contain unique declaration names. -/
def inScope (name : String) (scope : Scope) : Option Nat :=
  scope.foldl (fun found (decl, value) => if decl = name then some value else found) none

/-- Search the scope at the call site, then its lexical ancestors. -/
def resolve (name : String) : List Scope → Option Nat
  | [] => none
  | here :: parents => (inScope name here).orElse (fun _ => resolve name parents)

def call (wrapper : Bool) (outer inner : Scope) : Option Nat :=
  resolve "pick" (if wrapper then [outer] else [inner, outer])

def duplicates (scope : Scope) : Bool :=
  let names := scope.map Prod.fst
  names.eraseDups.length != names.length

/-- The outer option represents whether the parser admitted both scopes. -/
def checkedCall (wrapper : Bool) (outer inner : Scope) : Option (Option Nat) :=
  if duplicates outer || duplicates inner then none else some (call wrapper outer inner)

theorem duplicate_rejects_before_lookup (wrapper : Bool) (outer inner : Scope)
    (duplicate : (duplicates outer || duplicates inner) = true) :
    checkedCall wrapper outer inner = none := by
  simp [checkedCall, duplicate]

theorem last_declaration (name : String) (scope : Scope) (value : Nat) :
    inScope name (scope ++ [(name, value)]) = some value := by
  simp [inScope, List.foldl_append]

theorem unrelated_declaration (name other : String) (scope : Scope) (value : Nat)
    (different : other ≠ name) :
    inScope name (scope ++ [(other, value)]) = inScope name scope := by
  simp [inScope, List.foldl_append, different]

theorem nearest_shadows_every_ancestor (name : String) (here : Scope) (parents : List Scope)
    (value : Nat) (found : inScope name here = some value) :
    resolve name (here :: parents) = some value := by
  simp [resolve, found]

theorem falls_back_on_miss (name : String) (here : Scope) (parents : List Scope)
    (missing : inScope name here = none) :
    resolve name (here :: parents) = resolve name parents := by
  simp [resolve, missing]

theorem wrapper_uses_its_declaration_scope (outer left right : Scope) :
    call true outer left = call true outer right := rfl

end RulesLexicalFunctions
