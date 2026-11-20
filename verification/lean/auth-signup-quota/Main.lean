import AuthSignupQuota

open AuthSignupQuota

private def modes : List (String × Mode) :=
  [("off", .off), ("observe", .observe), ("enforce", .enforce)]

private def offerTag : Offer → String
  | .untracked | .tracked false => "ok"
  | .tracked true => "over"
  | .exceeds => "exceeded"
  | .invalidPeer => "invalid-peer"

private def outcomeTag : Outcome → String
  | .ok => "ok"
  | .stale => "stale"
  | .invalid => "invalid"

private def configTag : Option ConfigError → String
  | none => "ok"
  | some .defaultLimit => "default"
  | some .buckets => "buckets"
  | some .quota => "quota"
  | some .duration => "duration"
  | some .overflow => "overflow"

private def traceRow (modeName : String) (mode : Mode) (limit : Nat) (action : String) :
    String :=
  let initial : Usage := {}
  let proposed := offer mode limit initial
  let held := addReservation initial proposed
  let checkMore := offer mode limit held
  let before : Snapshot := ⟨mode, 0, 0, limit⟩
  let after : Snapshot :=
    if proposed == .exceeds then before
    else if action == "late" then {before with now := hour}
    else if action == "changed" then {before with generation := 1}
    else if action == "override" then {before with now := 1, limit := limit + 1}
    else before
  let execute := if action == "release" then Finalizer.release else .commit
  let (finalizer, duplicate, usage) :=
    if proposed == .exceeds then ("skipped", "skipped", held)
    else
      let tracked := proposed != .untracked
      let (result, updated) := finalize before after execute tracked true held
      let (repeated, _) := finalize before after .commit tracked false updated
      (outcomeTag result, outcomeTag repeated, updated)
  let finalUsage := if window before.now == window after.now then usage else initial
  let endOffer := offer mode after.limit finalUsage
  s!"trace {modeName} {limit} {action} {offerTag proposed} {offerTag checkMore} {finalizer} {duplicate} {usage.committed} {usage.held} {offerTag endOffer}"

def main : IO Unit := do
  let mut rows := #[]
  for limit in [0, 999999, 1000000, 1000001, 2 ^ 64 - 1] do
    for buckets in [0, 1, 2, 65535, 65536, 65537] do
      rows := rows.push s!"config {limit} {buckets} {configTag (validate limit buckets)}"
  for limit in [0, 1, 2 ^ 63 - 1, 2 ^ 63, 2 ^ 64 - 1] do
    for start in [-1, 0, 1, 2 ^ 127 - 2, 2 ^ 127 - 1] do
      for duration in [-1, 0, 1, 2] do
        rows := rows.push s!"temporary {limit} {start} {duration} {configTag (validateTemporary limit start duration)}"
  let times := [-hour - 1, -hour, -hour + 1, -1, 0, 1, hour - 1, hour, hour + 1]
  for before in times do
    for after in times do
      let result := if window before == window after then "ok" else "stale"
      rows := rows.push s!"window {before} {after} {result}"
  for instant in [-2, -1, 0, 1, 2] do
    let result := offer .enforce (if overrideActive (-1) 2 instant then 1 else 0) {}
    rows := rows.push s!"override {instant} {offerTag result}"
  for (modeName, mode) in modes do
    for (peerName, peer) in [("empty", ""), ("control", "ip\t"), ("valid", "192.0.2.1")] do
      let result := if validPeer peer then offer mode 1 {} else .invalidPeer
      rows := rows.push s!"peer {modeName} {peerName} {offerTag result}"
    for limit in [0, 1, 2] do
      for action in ["commit", "release", "late", "changed", "override"] do
        rows := rows.push (traceRow modeName mode limit action)
  IO.println s!"# cases {rows.size}"
  for row in rows do IO.println row
