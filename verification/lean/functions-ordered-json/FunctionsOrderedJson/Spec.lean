import Std

namespace FOJ

inductive Atom where
  | nil
  | boolean (value : Bool)
  | unsigned (value : Nat)
  | text (value : String)

inductive Value where
  | atom (value : Atom)
  | array (items : List Atom)
  | object (members : List (String × Atom))

def first (members : List (String × α)) (key : String) : Option α :=
  (members.find? (fun entry => entry.1 == key)).map Prod.snd

def last (members : List (String × α)) (key : String) : Option α :=
  first members.reverse key

/-- The strings in this fragment include ordinary Unicode, quotes, slashes, tabs and newlines. -/
def quoted (s : String) : String :=
  "\"" ++ String.join (s.toList.map fun ch =>
    match ch with
    | '"' => "\\\""
    | '\\' => "\\\\"
    | '\t' => "\\t"
    | '\n' => "\\n"
    | c => String.singleton c) ++ "\""

def atomText : Atom → String
  | .nil => "null"
  | .boolean v => toString v
  | .unsigned v => toString v
  | .text v => quoted v

def padding (n : Nat) : String := String.ofList (List.replicate (n * 2) ' ')

def frame (pretty : Bool) (depth : Nat) (left right : String) (values : List String) : String :=
  if values.isEmpty then left ++ right
  else if pretty then
    left ++ "\n" ++ padding (depth + 1) ++
      String.intercalate (",\n" ++ padding (depth + 1)) values ++ "\n" ++ padding depth ++ right
  else left ++ String.intercalate "," values ++ right

def objectText (pretty : Bool) (depth : Nat) (render : α → String)
    (members : List (String × α)) : String :=
  frame pretty depth "{" "}" (members.map fun (key, item) =>
    quoted key ++ (if pretty then ": " else ":") ++ render item)

def valueText (pretty : Bool) (depth : Nat) : Value → String
  | .atom value => atomText value
  | .array items => frame pretty depth "[" "]" (items.map atomText)
  | .object members => objectText pretty depth atomText members

end FOJ
