import AuthCustomClaims

open AuthCustomClaims

private def hex (text : String) : String :=
  let alphabet := "0123456789abcdef".toList
  String.ofList (text.toUTF8.data.toList.flatMap fun byte =>
    let n := byte.toNat
    [alphabet[n / 16]!, alphabet[n % 16]!])

private def trace (source shape : String) (character : Char) (count : Nat) (action : String) : String :=
  let entries := [("v", quote (String.ofList (List.replicate count character))), ("a", "true")]
  let original :=
    if source == "direct" then none
    else if source == "compact" then some (render entries)
    else match entries with
      | [(_, v), _] => some (" { \"v\":" ++ v ++ ", \"a\":true } ")
      | _ => none
  let initial : ClaimState := ⟨entries, original⟩
  let state := if action == "replace" then replace initial "v" (quote "replacement")
    else if action == "remove" then remove initial "v"
    else if action == "miss" then remove initial "absent"
    else initial
  let format := if state.source.isSome then "source" else "canonical"
  let outcome := if fits state then "accept" else "refuse"
  let value := if action == "replace" then "replacement" else if action == "remove" then "absent" else "initial"
  s!"trace {source} {shape} {count} {action} {format} {storedBytes state} {(canonical state.entries).utf8ByteSize} {outcome} {value}"

private def literal (text action : String) (entries : Entries) : String :=
  let initial : ClaimState := ⟨entries, some text⟩
  let state := if action == "remove" then remove initial "user_id" else initial
  let reported := (presentation state).map hex
  s!"literal {hex text} {hex (canonical state.entries)} {action} {reported.getD "-"}"

def main : IO Unit := do
  let mut rows := #[]
  for source in ["direct", "compact", "padded"] do
    for (shape, character) in [("ascii", 'a'), ("bmp", 'é'), ("astral", '😀'), ("escape", '\n')] do
      for count in [0, 1, 245, 246, 491, 492, 493, 494, 495, 981, 982, 983, 984, 985, 986, 1000] do
        for action in ["keep", "replace", "remove", "miss", "reject"] do
          rows := rows.push (trace source shape character count action)
  rows := rows.push (literal " { } " "keep" [])
  rows := rows.push (literal "{\"user_id\":null}" "remove" [("user_id", "null")])
  rows := rows.push (literal " { \"z\": \"é\", \"a\": 3 } " "keep" [("z", quote "é"), ("a", "3")])
  rows := rows.push (literal "{\"a\":\"\\u0008\\f\\t\\n\\r\"}" "keep"
    [("a", quote (String.ofList [Char.ofNat 8, Char.ofNat 12, '\t', '\n', '\r']))])
  IO.println s!"# cases {rows.size}"
  for row in rows do IO.println row
