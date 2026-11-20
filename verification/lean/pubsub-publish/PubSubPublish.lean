import Std

namespace PubSubPublish

inductive Issue where
  | empty | dataSize | count | keyInvalid | keySize | valueSize | keyNul | valueNul
  | totalSize | orderingSize | orderingNul
  deriving DecidableEq, Repr

abbrev Attributes := List (String × String)

def attrIssue (key value : String) : Option Issue :=
  if key.isEmpty then some .keyInvalid
  else if key.utf8ByteSize > 256 then some .keySize
  else if value.utf8ByteSize > 1024 then some .valueSize
  else if key.startsWith "goog" then some .keyInvalid
  else if key.contains (Char.ofNat 0) then some .keyNul
  else if value.contains (Char.ofNat 0) then some .valueNul
  else none

def total (data : Nat) (attrs : Attributes) : Nat :=
  data + (attrs.map fun (key, value) => key.utf8ByteSize + value.utf8ByteSize).sum

def attributesIssue (attrs : Attributes) : Option Issue :=
  (attrs.mergeSort (fun a b => decide (a.1 ≤ b.1))).findSome?
    (fun (key, value) => attrIssue key value)

def admission (data : Nat) (attrs : Attributes) (ordering : String) : Option Issue :=
  if data = 0 ∧ attrs = [] then some .empty
  else if data > 10000000 then some .dataSize
  else if attrs.length > 100 then some .count
  else
    if let some issue := attributesIssue attrs then some issue
    else if total data attrs > 10000000 then some .totalSize
    else if ordering.utf8ByteSize > 1024 then some .orderingSize
    else if ordering.contains (Char.ofNat 0) then some .orderingNul
    else none

theorem ordering_alone_is_empty (ordering : String) :
    admission 0 [] ordering = some .empty := rfl

theorem oversized_data_precedes_attribute_checks (data : Nat) (attrs : Attributes)
    (ordering : String) (oversized : 10000000 < data) :
    admission data attrs ordering = some .dataSize := by
  have nonzero : data ≠ 0 := by omega
  simp [admission, nonzero, oversized]

theorem accepted_total_is_bounded (data : Nat) (attrs : Attributes) (ordering : String)
    (accepted : admission data attrs ordering = none) : total data attrs ≤ 10000000 := by
  by_cases bound : total data attrs ≤ 10000000
  · exact bound
  · have oversized : 10000000 < total data attrs := by omega
    unfold admission at accepted
    split at accepted
    · contradiction
    · split at accepted
      · contradiction
      · split at accepted
        · contradiction
        · cases result : attributesIssue attrs <;> simp [result, oversized] at accepted

theorem reserved_key_refused (key value : String) (nonempty : key.isEmpty = false)
    (keySize : key.utf8ByteSize ≤ 256) (valueSize : value.utf8ByteSize ≤ 1024)
    (reserved : key.startsWith "goog" = true) : attrIssue key value = some .keyInvalid := by
  simp [attrIssue, nonempty, Nat.not_lt_of_ge keySize, Nat.not_lt_of_ge valueSize, reserved]

end PubSubPublish

/- Guard the axioms used by the stated laws. -/

/-- info: 'PubSubPublish.ordering_alone_is_empty' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubPublish.ordering_alone_is_empty

/-- info: 'PubSubPublish.oversized_data_precedes_attribute_checks' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubPublish.oversized_data_precedes_attribute_checks

/-- info: 'PubSubPublish.accepted_total_is_bounded' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubPublish.accepted_total_is_bounded

/-- info: 'PubSubPublish.reserved_key_refused' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms PubSubPublish.reserved_key_refused
