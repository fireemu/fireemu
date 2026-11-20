import Std

namespace PubSubNames

inductive Kind where
  | topic
  | subscription
  | snapshot
  deriving Repr, DecidableEq, BEq

def Kind.label : Kind → String
  | .topic => "topic"
  | .subscription => "subscription"
  | .snapshot => "snapshot"

def Kind.collection (kind : Kind) : String := kind.label ++ "s"

def control (c : Char) : Bool :=
  c.toNat < 32 || (127 ≤ c.toNat && c.toNat ≤ 159)

def firstOffset (invalid : Char → Bool) (characters : List Char) : Option Nat :=
  match characters with
  | [] => none
  | c :: rest => if invalid c then some 0 else
      (firstOffset invalid rest).map ((String.singleton c).utf8ByteSize + ·)

def allowed (c : Char) : Bool := c.isAlphanum || ['.', '_', '~', '%', '+', '-'].contains c

def projectProblem (project : String) : Option String :=
  if project.isEmpty then some "project id is empty"
  else if project.utf8ByteSize > 255 then some "project id exceeds 255 bytes"
  else if project.contains '/' then some "project id must not contain '/'"
  else (firstOffset control project.toList).map fun byte =>
    s!"project id has a control character at byte {byte}"

def resourceProblem (kind : Kind) (id : String) : Option String :=
  if id.utf8ByteSize < 3 || 255 < id.utf8ByteSize then
    some s!"{kind.label} id must be 3..=255 characters"
  else if !(id.toList.head?.any Char.isAlpha) then
    some s!"{kind.label} id must start with a letter"
  else if let some byte := firstOffset (!allowed ·) id.toList then
    some s!"{kind.label} id has an invalid character at byte {byte}; allowed: letters, digits and . _ ~ % + -"
  else if id.startsWith "goog" then
    some s!"{kind.label} id must not start with the reserved prefix 'goog'"
  else none

def admitted (kind : Kind) (project id : String) : Bool :=
  (projectProblem project).isNone && (resourceProblem kind id).isNone

def acceptsParts (kind : Kind) : List String → Bool
  | ["projects", project, collection, id] =>
      collection == kind.collection && admitted kind project id
  | ["_deleted-topic_"] => kind == .topic
  | _ => false

theorem no_forbidden_char {bad : Char → Bool} (cs : List Char) :
    firstOffset bad cs = none ↔ cs.all (!bad ·) = true := by
  induction cs with
  | nil => simp [firstOffset]
  | cons c rest ih =>
    cases he : bad c <;> cases hr : firstOffset bad rest <;>
      simp [firstOffset, he, hr] at ih ⊢ <;> exact ih

theorem accepted_project_excludes_slash (project : String)
    (ok : projectProblem project = none) : project.contains '/' = false := by
  unfold projectProblem at ok
  split at ok
  · contradiction
  split at ok
  · contradiction
  split at ok
  · contradiction
  · simp_all

theorem accepted_id_has_allowed_alphabet (kind : Kind) (id : String)
    (ok : resourceProblem kind id = none) :
    id.toList.all allowed = true := by
  unfold resourceProblem at ok
  split at ok
  · contradiction
  split at ok
  · contradiction
  split at ok
  · contradiction
  · rename_i absent
    have clean : firstOffset (!allowed ·) id.toList = none := by
      cases h : firstOffset (!allowed ·) id.toList with
      | none => rfl
      | some byte => exact False.elim (absent byte h)
    simpa using (no_forbidden_char (bad := (!allowed ·)) id.toList).1 clean

theorem canonical_topic (project id : String) :
    acceptsParts .topic ["projects", project, "topics", id] = admitted .topic project id := by
  rfl

theorem subscription_cannot_parse_topic (project id : String) :
    acceptsParts .subscription ["projects", project, "topics", id] = false := by
  rfl

theorem sentinel_only_topic (kind : Kind) :
    acceptsParts kind ["_deleted-topic_"] = true ↔ kind = .topic := by
  cases kind <;> decide

end PubSubNames

/- Axiom guards for the stated contract laws. -/

/-- info: 'PubSubNames.no_forbidden_char' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubNames.no_forbidden_char

/-- info: 'PubSubNames.accepted_project_excludes_slash' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubNames.accepted_project_excludes_slash

/-- info: 'PubSubNames.accepted_id_has_allowed_alphabet' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubNames.accepted_id_has_allowed_alphabet

/-- info: 'PubSubNames.canonical_topic' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubNames.canonical_topic

/-- info: 'PubSubNames.subscription_cannot_parse_topic' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubNames.subscription_cannot_parse_topic

/-- info: 'PubSubNames.sentinel_only_topic' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubNames.sentinel_only_topic
