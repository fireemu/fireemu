import Std

namespace AuthCustomClaims

def quote (text : String) : String :=
  let escaped := text.toList.map fun character =>
    match character with
    | '"' => "\\\""
    | '\\' => "\\\\"
    | '\n' => "\\n"
    | '\r' => "\\r"
    | '\t' => "\\t"
    | c => if c.toNat < 32 then
        let digits := "0123456789abcdef".toList
        "\\u00" ++ String.ofList [digits[c.toNat / 16]!, digits[c.toNat % 16]!]
      else String.singleton c
  "\"" ++ String.intercalate "" escaped ++ "\""

abbrev Entries := List (String × String)

def render (entries : Entries) : String :=
  "{" ++ String.intercalate "," (entries.map fun (key, value) => quote key ++ ":" ++ value) ++ "}"

def canonical (entries : Entries) : String :=
  render (entries.mergeSort fun a b => a.1 ≤ b.1)

structure ClaimState where
  entries : Entries
  source : Option String

def presentation (state : ClaimState) : Option String :=
  match state.source with
  | some original => some original
  | none => if state.entries.isEmpty then none else some (canonical state.entries)

def storedBytes (state : ClaimState) : Nat :=
  (state.source.getD (canonical state.entries)).utf8ByteSize

def fits (state : ClaimState) : Bool := storedBytes state ≤ 1000

def remove (state : ClaimState) (key : String) : ClaimState :=
  if state.entries.any (fun member => member.1 == key) then
    ⟨state.entries.filter fun member => member.1 != key, none⟩
  else state

def replace (state : ClaimState) (key encoded : String) : ClaimState :=
  ⟨(key, encoded) :: state.entries.filter (fun member => member.1 != key), none⟩

end AuthCustomClaims
