import Std

namespace PyWire

inductive Value where
  | number (lexeme : String)
  | text (value : String)
  | literal (lexeme : String)
  | array (items : List Value)
  | object (fields : List (String × Value))

inductive Layout where
  | compact
  | pubsub
  | storage
  deriving DecidableEq

def storageKeys : List String :=
  ["kind", "id", "selfLink", "name", "bucket", "generation", "metageneration",
    "contentType", "timeCreated", "updated", "storageClass", "timeStorageClassUpdated",
    "size", "md5Hash", "mediaLink", "crc32c", "etag"]

def lexical : (String × Value) → (String × Value) → Bool :=
  fun a b => decide (a.1 ≤ b.1)

def gcsOrder : (String × Value) → (String × Value) → Bool :=
  fun a b =>
    let ia := storageKeys.idxOf a.1
    let ib := storageKeys.idxOf b.1
    decide (ia < ib) || (ia == ib && lexical a b)

/-- Storage applies its resource order at the root object only. -/
def orderedFields (layout : Layout) (rootObject : Bool) (fields : List (String × Value)) :
    List (String × Value) :=
  match layout, rootObject with
  | .compact, _ => fields
  | .pubsub, _ => fields.mergeSort lexical
  | .storage, true => fields.mergeSort gcsOrder
  | .storage, false => fields.mergeSort lexical

def quote (text : String) : String :=
  let encode : Char → String := fun c =>
    match c with
    | '"' => "\\\""
    | '\\' => "\\\\"
    | '\n' => "\\n"
    | '\r' => "\\r"
    | '\t' => "\\t"
    | _ => String.singleton c
  "\"" ++ String.join (text.toList.map encode) ++ "\""

def spaces (n : Nat) : String := String.ofList (List.replicate n ' ')

def join (pretty : Bool) (depth : Nat) (opening closing : String) : List String → String
  | [] => opening ++ closing
  | parts =>
    if pretty then
      let inner := "\n" ++ spaces ((depth + 1) * 2)
      opening ++ inner ++ String.intercalate ("," ++ inner) parts ++ "\n" ++ spaces (depth * 2) ++ closing
    else opening ++ String.intercalate "," parts ++ closing

/-- Fuel bounds the nesting of corpus values. The generator stays below that bound. -/
def write (layout : Layout) (gcsRoot : Bool) (depth : Nat) : Nat → Value → String
  | 0, _ => ""
  | _ + 1, .number token => token
  | _ + 1, .literal token => token
  | _ + 1, .text value => quote value
  | fuel + 1, .array children =>
    let parts := children.map (write layout false (depth + 1) fuel)
    join (layout == .storage) depth "[" "]" parts
  | fuel + 1, .object fields =>
    let pretty := layout == .storage
    let sep := if pretty then ": " else ":"
    let parts := (orderedFields layout gcsRoot fields).map fun (key, value) =>
      quote key ++ sep ++ write layout false (depth + 1) fuel value
    join pretty depth "{" "}" parts

/-- Storage preserves order below a non-object root, while still indenting. -/
def prettyOriginal (depth : Nat) : Nat → Value → String
  | 0, _ => ""
  | _ + 1, .number token => token
  | _ + 1, .literal token => token
  | _ + 1, .text value => quote value
  | fuel + 1, .array children =>
    join true depth "[" "]" (children.map (prettyOriginal (depth + 1) fuel))
  | fuel + 1, .object fields =>
    let parts := fields.map fun (key, value) => quote key ++ ": " ++ prettyOriginal (depth + 1) fuel value
    join true depth "{" "}" parts

def render (layout : Layout) (fuel : Nat) (value : Value) : String :=
  match layout, value with
  | .compact, _ => write .compact false 0 fuel value
  | .pubsub, _ => write .pubsub false 0 fuel value ++ "\n"
  | .storage, .object _ => write .storage true 0 fuel value ++ "\n"
  | .storage, _ => prettyOriginal 0 fuel value ++ "\n"

end PyWire
