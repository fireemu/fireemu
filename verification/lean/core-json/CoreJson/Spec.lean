import Std

namespace CoreJson

inductive Value where
  | null
  | bool (value : Bool)
  | int (value : Int)
  | float
  | text (value : String)
  | array (elements : List Value)
  | object (members : List (String × Value))
  deriving Inhabited

structure Cursor where
  left : List Char
  byte : Nat
  deriving Inhabited

structure Failure where
  byte : Nat
  expected : String

abbrev Result (α : Type) := Except Failure α

def Cursor.advance (cursor : Cursor) (count : Nat := 1) : Cursor :=
  let bytes := ((cursor.left.take count).map Char.utf8Size).sum
  ⟨cursor.left.drop count, cursor.byte + bytes⟩

def Cursor.head (cursor : Cursor) : Option Char := cursor.left.head?

def Cursor.failure (cursor : Cursor) (why : String) : Result α :=
  .error ⟨cursor.byte, why⟩

def Cursor.satisfy (cursor : Cursor) (predicate : Char → Bool) : Cursor :=
  cursor.advance (cursor.left.takeWhile predicate).length

def Cursor.ws (cursor : Cursor) : Cursor :=
  cursor.satisfy fun c => [' ', '\t', '\n', '\r'].contains c

def Cursor.expect (cursor : Cursor) (character : Char) (why : String) : Result Cursor :=
  if cursor.head == some character then .ok (cursor.advance) else cursor.failure why

def Cursor.literal (cursor : Cursor) (text : String) (v : Value) : Result (Value × Cursor) :=
  if cursor.left.take text.length == text.toList then .ok (v, cursor.advance text.length)
  else cursor.failure "a literal"

def isDigit (c : Char) : Bool := '0' ≤ c && c ≤ '9'

def number (start : Cursor) : Result (Value × Cursor) := do
  let negative := start.head == some '-'
  let digits := if negative then start.advance else start
  let intEnd := digits.satisfy isDigit
  if intEnd.byte = digits.byte then
    return ← digits.failure "a digit"
  if intEnd.byte > digits.byte + 1 && digits.head == some '0' then
    return ← digits.failure "no leading zero"
  let hasFraction := intEnd.head == some '.'
  let fracEnd ← if hasFraction then
    let fraction := intEnd.advance
    let ending := fraction.satisfy isDigit
    if ending.byte = fraction.byte then fraction.failure "fraction digits" else pure ending
  else pure intEnd
  let hasExponent := fracEnd.head == some 'e' || fracEnd.head == some 'E'
  let ending ← if hasExponent then
    let initial := fracEnd.advance
    let exponent := if initial.head == some '+' || initial.head == some '-'
      then initial.advance else initial
    let ending := exponent.satisfy isDigit
    if ending.byte = exponent.byte then exponent.failure "exponent digits" else pure ending
  else pure fracEnd
  if hasFraction || hasExponent then return (.float, ending)
  let spelling := String.ofList (start.left.take (ending.byte - start.byte))
  let some integer := spelling.toInt? | ending.failure "a number"
  if -(2 ^ 63 : Int) ≤ integer && integer < (2 ^ 63 : Int)
  then return (.int integer, ending)
  else return (.float, ending)

def nibble (c : Char) : Option Nat :=
  if '0' ≤ c && c ≤ '9' then some (c.toNat - '0'.toNat)
  else if 'a' ≤ c && c ≤ 'f' then some (10 + c.toNat - 'a'.toNat)
  else if 'A' ≤ c && c ≤ 'F' then some (10 + c.toNat - 'A'.toNat)
  else none

def hex4 (cursor : Cursor) : Result (Nat × Cursor) :=
  match (cursor.left.take 4).mapM nibble with
  | some [a, b, c, d] => .ok (a * 4096 + b * 256 + c * 16 + d, cursor.advance 4)
  | _ => cursor.failure "4 hex digits"

def highSurrogate (n : Nat) : Bool := 0xd800 ≤ n && n < 0xdc00
def lowSurrogate (n : Nat) : Bool := 0xdc00 ≤ n && n < 0xe000

def combine (high low : Nat) : Nat := 0x10000 + (high - 0xd800) * 1024 + (low - 0xdc00)

def unicode (cursor : Cursor) : Result (Char × Cursor) := do
  let (first, after) ← hex4 cursor
  if highSurrogate first then
    if after.left.take 2 != ['\\', 'u'] then return ← after.failure "low surrogate"
    let (second, ending) ← hex4 (after.advance 2)
    if !lowSurrogate second then return ← ending.failure "low surrogate"
    return (Char.ofNat (combine first second), ending)
  if lowSurrogate first then return ← after.failure "a scalar value"
  return (Char.ofNat first, after)

def escape (cursor : Cursor) : Result (Char × Cursor) :=
  match cursor.head with
  | none => cursor.failure "escape"
  | some e =>
    let next := cursor.advance
    match e with
    | '"' | '\\' | '/' => .ok (e, next)
    | 'b' => .ok (Char.ofNat 8, next)
    | 'f' => .ok (Char.ofNat 12, next)
    | 'n' => .ok ('\n', next)
    | 'r' => .ok ('\r', next)
    | 't' => .ok ('\t', next)
    | 'u' => unicode next
    | _ => .error ⟨cursor.byte + 1, "a valid escape"⟩

def stringTail : Nat → Cursor → List Char → Result (String × Cursor)
  | 0, cursor, _ => cursor.failure "model string fuel"
  | fuel + 1, cursor, rev => do
    match cursor.head with
    | none => cursor.failure "closing '\"'"
    | some '"' => return (String.ofList rev.reverse, cursor.advance)
    | some '\\' =>
      let (decoded, after) ← escape cursor.advance
      stringTail fuel after (decoded :: rev)
    | some c =>
      if c.toNat < 32 then cursor.failure "no control characters in strings"
      else stringTail fuel cursor.advance (c :: rev)

def string (cursor : Cursor) : Result (String × Cursor) := do
  let after ← cursor.expect '"' "'\"'"
  stringTail (after.left.length + 1) after []

def put (key : String) (value : Value) (members : List (String × Value)) :
    List (String × Value) :=
  (key, value) :: members.filter (fun entry => entry.1 != key)

def lookup (key : String) (members : List (String × Value)) : Option Value :=
  (members.find? (fun entry => entry.1 == key)).map Prod.snd

def depthLimit : Nat := 64

mutual
  def value : Nat → Nat → Cursor → Result (Value × Cursor)
    | 0, _, cursor => cursor.failure "model value fuel"
    | fuel + 1, depth, cursor => do
      if depth > depthLimit then return ← cursor.failure "nesting within the depth budget"
      match cursor.head with
      | some '[' =>
        let next := cursor.advance.ws
        if next.head == some ']' then return (.array [], next.advance)
        arrayTail fuel depth next []
      | some '{' =>
        let next := cursor.advance.ws
        if next.head == some '}' then return (.object [], next.advance)
        objectTail fuel depth next []
      | some '"' =>
        let (v, ending) ← string cursor
        return (.text v, ending)
      | some 'n' => cursor.literal "null" .null
      | some 't' => cursor.literal "true" (.bool true)
      | some 'f' => cursor.literal "false" (.bool false)
      | some c => if c == '-' || isDigit c then number cursor else cursor.failure "a value"
      | none => cursor.failure "a value"

  def arrayTail : Nat → Nat → Cursor → List Value → Result (Value × Cursor)
    | 0, _, cursor, _ => cursor.failure "model array fuel"
    | fuel + 1, depth, cursor, rev => do
      let (v, ending) ← value fuel (depth + 1) cursor
      let next := ending.ws
      match next.head with
      | some ',' => arrayTail fuel depth next.advance.ws (v :: rev)
      | some ']' => return (.array (v :: rev).reverse, next.advance)
      | _ => next.failure "',' or ']'"

  def objectTail : Nat → Nat → Cursor → List (String × Value) → Result (Value × Cursor)
    | 0, _, cursor, _ => cursor.failure "model object fuel"
    | fuel + 1, depth, cursor, members => do
      let (key, ending) ← string cursor
      let separator ← ending.ws.expect ':' "':'"
      let (v, ending) ← value fuel (depth + 1) separator.ws
      let next := ending.ws
      let members := put key v members
      match next.head with
      | some ',' => objectTail fuel depth next.advance.ws members
      | some '}' => return (.object members, next.advance)
      | _ => next.failure "',' or '}'"
end

def parse (text : String) : Result Value := do
  let start : Cursor := ⟨text.toList, 0⟩
  let (v, ending) ← value (3 * start.left.length + 10) 0 start.ws
  let last := ending.ws
  if last.left.isEmpty then pure v else last.failure "end of input"

def digit (n : Nat) : Char := ("0123456789abcdef".toList[n]?).getD '0'

def hex (text : String) : String :=
  String.ofList (text.toUTF8.data.toList.flatMap fun b =>
    [digit (b.toNat / 16), digit (b.toNat % 16)])

partial def display : Value → String
  | .null => "n"
  | .bool b => if b then "t" else "f"
  | .int n => s!"i{n}"
  | .float => "d"
  | .text s => "s" ++ hex s
  | .array xs => "[" ++ String.intercalate "," (xs.map display) ++ "]"
  | .object members =>
    let sorted := members.mergeSort (fun a b => a.1 ≤ b.1)
    "{" ++ String.intercalate "," (sorted.map (fun (k, v) => hex k ++ ":" ++ display v)) ++ "}"

end CoreJson
