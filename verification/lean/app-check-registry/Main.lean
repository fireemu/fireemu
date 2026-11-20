import AppCheckRegistryModel

open AppCheckRegistryModel

private def recordText (r : Record) : String :=
  s!"dbg-{r.id}:{r.label}:{r.time}"

private def registrationText (record : Option Record) : String :=
  (record.map fun r => s!"dbg-{r.id}").getD "cap"

private def recordsText (records : List Record) : String :=
  if records.isEmpty then "-" else String.intercalate "," (records.map recordText)

private def history (capName restoreName mutation : String) (cap restoreScope : Scope)
    (statics : Nat) : String :=
  let (initial1, first) := add (initial statics) .first "first-base" 1
  let (initial2, second) := add first .second "second-base" 2
  let saved := capture second cap
  let (action, third) :=
    if mutation == "delete" then
      let (found, updated) := dropToken second .first initial1
      (if found then "deleted" else "missing", updated)
    else if mutation == "clear" then ("cleared", clear second .first)
    else ("retained", second)
  let (added1, fourth) := add third .first "first-post" 3
  let (added2, fifth) := add fourth .second "second-post" 4
  let final := restore fifth restoreScope saved
  let count := statics + (final.live .first).length
  s!"history {capName} {restoreName} {mutation} {statics} {registrationText initial1} {registrationText initial2} {action} {registrationText added1} {registrationText added2} {recordsText (final.live .first)} {recordsText (final.live .second)} {count}"

private def epochText (epoch : Nat) : String :=
  let digit := "0123456789abcdef".toList
  String.ofList ((List.range 32).reverse.map fun shift => digit[epoch / 16 ^ shift % 16]!)

private def issueText : Except Refusal (Nat × Nat) → String
  | .ok (epoch, counter) => s!"{epochText epoch}-{counter}"
  | .error .unknown => "unknown"
  | .error .disabled => "disabled"
  | .error .noEpoch => "missing-epoch"

private def epochRow (name : String) (app : App) : String :=
  let original : EpochState := ⟨none, 0, 0⟩
  let (before, prior) := issue original app
  let first := rotate prior 1
  let (one, afterOne) := issue first app
  let (two, afterTwo) := issue afterOne app
  let second := rotate afterTwo 2
  let (next, final) := issue second app
  s!"epoch {name} {original.generation} {issueText before} {first.generation} {issueText one} {issueText two} {final.generation} {issueText next} {epochText (final.value.getD 0)}"

def main : IO Unit := do
  let mut rows := #[]
  let scopes : List (String × Scope) :=
    [("none", .none), ("first", .first), ("second", .second), ("both", .both)]
  for (captureName, captureScope) in scopes do
    for (restoreName, selected) in scopes do
      for mutation in ["delete", "clear", "retain"] do
        for statics in [0, 127, 128] do
          rows := rows.push (history captureName restoreName mutation captureScope selected statics)
  let apps : List (String × App) := [("first", .first), ("second", .second), ("unknown", .unknown)]
  for (name, app) in apps do rows := rows.push (epochRow name app)
  IO.println s!"# cases {rows.size}"
  for row in rows do IO.println row
