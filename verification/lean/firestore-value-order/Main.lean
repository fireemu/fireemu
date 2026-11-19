import FirestoreValueOrder

/-!
# Golden corpus generator

Prints one line per value pair: `<lt|eq|gt> <a> <b>`, where the order is `rcmp a b` from the
specification. Values are written in prefix form, separated by single spaces:

* `null`, `bool:0`, `bool:1`, `int:<decimal i64>`, `dbl:<16 hex digits of the f64 bits>`
* `ts:<seconds>:<nanos>`, `str:<hex UTF-8>`, `bytes:<hex>`, `ref:<hex UTF-8>`
* `geo:<lat bits>:<lon bits>`, `vec:<n>` followed by `n` f64 bit patterns
* `arr:<n>` followed by `n` values, `map:<n>` followed by `n` pairs `key:<hex UTF-8> <value>`

Pairs: every ordered pair inside each type group (NaN and numbers form one group), and for
every two different type groups the ordered pairs of their first two values.
-/

open FVO

def hexDigit (n : Nat) : Char := "0123456789abcdef".toList[n % 16]!

def hexByte (b : Nat) : String := String.ofList [hexDigit (b / 16), hexDigit b]

def hexBytes (bs : List Nat) : String := String.join (bs.map hexByte)

def hex64 (x : UInt64) : String :=
  String.ofList ((List.range 16).reverse.map (fun i => hexDigit (x.toNat / 16 ^ i)))

partial def enc : RValue → String
  | .null => "null"
  | .boolean b => if b then "bool:1" else "bool:0"
  | .integer i => s!"int:{i}"
  | .double b => s!"dbl:{hex64 b}"
  | .timestamp s n => s!"ts:{s}:{n}"
  | .string s => s!"str:{hexBytes (utf8 s)}"
  | .bytes b => s!"bytes:{hexBytes (b.map (·.toNat))}"
  | .reference s => s!"ref:{hexBytes (utf8 s)}"
  | .geoPoint a b => s!"geo:{hex64 a}:{hex64 b}"
  | .array xs => " ".intercalate (s!"arr:{xs.length}" :: xs.map enc)
  | .vector xs => " ".intercalate (s!"vec:{xs.length}" :: xs.map hex64)
  | .map es =>
    " ".intercalate (s!"map:{es.length}" :: es.map (fun (k, v) => s!"key:{hexBytes (utf8 k)} {enc v}"))

/-- Map keys must be strictly increasing in byte order, as a `BTreeMap` iterates them. -/
partial def wellFormed : RValue → Bool
  | .array xs => xs.all wellFormed
  | .map es =>
    let keys := es.map (fun e => utf8 e.1)
    let sorted := (keys.zip keys.tail).all (fun (a, b) => cmpBytes a b == .lt)
    sorted && es.all (fun e => wellFormed e.2)
  | _ => true

def ordName : Ordering → String
  | .lt => "lt"
  | .eq => "eq"
  | .gt => "gt"

def d (bits : UInt64) : RValue := .double bits
def i (n : Int) : RValue := .integer n

def i64Max : Int := 9223372036854775807
def i64Min : Int := -9223372036854775808
def p53 : Int := 9007199254740992

def nullsAndBools : List RValue := [.null, .boolean false, .boolean true]

def numbers : List RValue := [
  -- NaN payloads and signs
  d 0x7ff8000000000000, d 0x7ff0000000000001, d 0xfff8000000000000,
  -- infinities and extremes
  d 0xfff0000000000000, d 0x7ff0000000000000, d 0x7fefffffffffffff, d 0xffefffffffffffff,
  -- zeros and subnormals
  d 0x0000000000000000, d 0x8000000000000000, d 0x0000000000000001, d 0x8000000000000001,
  d 0x000fffffffffffff, d 0x0010000000000000,
  -- small values
  d 0x3ff0000000000000, d 0xbff0000000000000, d 0x3fe0000000000000, d 0xbfe0000000000000,
  d 0x3ff8000000000000, d 0x3fb999999999999a, d 0x4024000000000000, d 0x3ff0000000000001,
  d 0x3fefffffffffffff,
  -- 2^53 neighbours
  d 0x4340000000000000, d 0x4340000000000001, d 0x433fffffffffffff, d 0xc340000000000000,
  d 0xc340000000000001,
  -- 2^63 neighbours
  d 0x43e0000000000000, d 0x43dfffffffffffff, d 0xc3e0000000000000, d 0xc3e0000000000001,
  d 0xc3dfffffffffffff,
  -- integers
  i 0, i 1, i (-1), i 2, i 10, i (p53 - 1), i p53, i (p53 + 1), i (-p53), i (-p53 - 1),
  i i64Max, i (i64Max - 1), i i64Min, i (i64Min + 1), i 4611686018427387904,
  i 9223372036854774784, i (-9223372036854774784)]

def timestamps : List RValue := [
  .timestamp (-62135596800) 0, .timestamp (-1) 999999999, .timestamp 0 0, .timestamp 0 1,
  .timestamp 0 1000, .timestamp 1 0, .timestamp 253402300799 999999999]

def strings : List RValue := [
  .string "", .string "a", .string "a\x00", .string "ab", .string "b", .string "B",
  .string "é", .string "￿", .string (String.singleton (Char.ofNat 0x10000)), .string "\x7f", .string "\u0080"]

def bytesValues : List RValue := [
  .bytes [], .bytes [0], .bytes [0, 0], .bytes [1], .bytes [255], .bytes [0, 255]]

def doc : String := "projects/p/databases/(default)/documents/"

def references : List RValue := [
  .reference "", .reference "a", .reference "a/b", .reference "a!", .reference "a/b/c",
  .reference "a/", .reference "b", .reference "a/a", .reference (doc ++ "c/d"),
  .reference (doc ++ "c!/d"), .reference (doc ++ "c/d/e/f"), .reference (doc ++ "c/d!")]

def geoPoints : List RValue := [
  .geoPoint 0 0, .geoPoint 0 0x3ff0000000000000, .geoPoint 0x3ff0000000000000 0,
  .geoPoint 0x8000000000000000 0, .geoPoint 0xc056800000000000 0xc066800000000000,
  .geoPoint 0x4056800000000000 0x4066800000000000,
  .geoPoint 0x3ff0000000000000 0xbff0000000000000]

def arrays : List RValue := [
  .array [], .array [.null], .array [i 1], .array [d 0x3ff0000000000000], .array [i 1, i 2],
  .array [i 2], .array [.array []], .array [d 0x7ff8000000000000], .array [.boolean true],
  .array [i 1, d 0x7ff8000000000000], .array [d 0x8000000000000000], .array [.array [i 1]],
  .array [.map []], .array [.string "a", .bytes []]]

def vectors : List RValue := [
  .vector [], .vector [0x3ff0000000000000], .vector [0, 0], .vector [0x4000000000000000],
  .vector [0x3ff0000000000000, 0], .vector [0x7ff8000000000000], .vector [0x8000000000000000],
  .vector [0xfff0000000000000], .vector [0x3ff0000000000000, 0x3ff0000000000000],
  .vector [0]]

def maps : List RValue := [
  .map [], .map [("", .null)], .map [("a", i 1)], .map [("a", d 0x3ff0000000000000)],
  .map [("a", i 2)], .map [("a", d 0x7ff8000000000000)], .map [("b", i 0)],
  .map [("a", i 1), ("b", i 0)], .map [("a", .map [("b", .array [])])],
  .map [("é", .null)], .map [("aa", .null)], .map [("a", .null)]]

def groups : List (List RValue) :=
  [nullsAndBools, numbers, timestamps, strings, bytesValues, references, geoPoints, arrays,
    vectors, maps]

def pairsWithin (g : List RValue) : List (RValue × RValue) :=
  g.flatMap (fun a => g.map (fun b => (a, b)))

def pairsAcross : List (RValue × RValue) :=
  groups.flatMap (fun g => groups.flatMap (fun h =>
    if g.length == h.length && enc g.head! == enc h.head! then []
    else (g.take 2).flatMap (fun a => (h.take 2).map (fun b => (a, b)))))

def main : IO UInt32 := do
  let all := groups.flatten
  if !(all.all wellFormed) then
    IO.eprintln "a map in the pool has keys out of order"
    return 1
  let pairs := groups.flatMap pairsWithin ++ pairsAcross
  IO.println s!"# Generated by verification/lean/firestore-value-order (lake exe corpus). Do not edit."
  IO.println s!"# {pairs.length} pairs. Format: see Main.lean."
  for (a, b) in pairs do
    IO.println s!"{ordName (rcmp a b)} {enc a} {enc b}"
  return 0
