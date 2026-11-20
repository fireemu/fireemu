import RtdbKeyOrder
open RtdbKeyOrder

def render (s : String) : String :=
  ",".intercalate (s.toList.map (fun c => toString c.toNat))

def ord (o : Ordering) : String :=
  match o with
  | .lt => "lt"
  | .eq => "eq"
  | .gt => "gt"

def signs : List (String × String) := [("plain", ""), ("negative", "-"), ("positive", "+")]
def prefixes : List (String × String) :=
  [("bare", ""), ("padded", "00"), ("long", String.ofList (List.replicate 64 '0'))]
def magnitudes : List (String × String) :=
  [("zero", "0"), ("one", "1"), ("max", "2147483647"), ("pastMax", "2147483648"),
   ("pastMin", "2147483649"), ("wide", "12345678901"), ("text", "a"), ("empty", "")]
def examples : List String :=
  ["", "-", "0", "-0", "00", "001", "1", "9", "10", "2", "2147483647", "2147483648",
   "-2147483648", "-2147483649", "+1", "1a", "a", "é", "１", "𐀀", "", "😀",
   "x", "x𐀀", "x"]

def main : IO Unit := do
  for (a, sign) in signs do
    for (b, padding) in prefixes do
      for (c, magnitude) in magnitudes do
        let key := sign ++ padding ++ magnitude
        IO.println <| "\t".intercalate ["integer", a, b, c, render key, (integer key).elim "-" toString]
  for a in examples do
    for b in examples do
      IO.println <| "\t".intercalate ["compare", render a, render b, ord (keyCompare a b), ord (List.compareLex compare (utf16 a) (utf16 b))]
  for key in examples ++ ((List.range 128).map fun n => "x" ++ String.singleton (Char.ofNat n) ++ "z") do
    IO.println <| "\t".intercalate ["validate", render key, if valid key then "ok" else "invalid"]
