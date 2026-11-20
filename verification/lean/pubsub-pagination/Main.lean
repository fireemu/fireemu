import PubSubPagination

open PubSubPagination

def name (i : Nat) : String :=
  let digits := toString i
  let padded := String.ofList (List.replicate (4 - digits.length) '0') ++ digits
  "projects/p/subscriptions/sub-" ++ padded

def sizes : List (String × Int) :=
  [("negative", -1), ("default", 0), ("one", 1), ("two", 2), ("cap", 1000),
   ("over", 1001), ("largest", 2147483647)]

def cursors : List String := ["initial", "known", "last", "between", "past", "garbage"]

def cursorFor (policy : Policy) (input : String) : Cursor :=
  let exact := if policy = .strict then Cursor.opaque else Cursor.text
  match input with
  | "initial" => .initial
  | "known" => exact (name 0)
  | "last" => exact (name 2)
  | "between" => .text (name 0 ++ "-extra")
  | "past" => .text "zz-past"
  | _ => .text "!opaque?"

def indexOf (names : List String) (item : Option String) : String :=
  (item.bind fun v => names.findIdx? (· == v)).map toString |>.getD "-"

def main : IO Unit := do
  let policies := [("strict", Policy.strict), ("emulator", Policy.emulator)]
  let counts : List Nat := [0, 3, 1001]
  IO.println s!"# {policies.length * sizes.length * cursors.length * counts.length}"
  for (label, policy) in policies do
    for (sizeLabel, size) in sizes do
      for input in cursors do
        for count in counts do
          let names := (List.range count).map name
          let fields := match page policy size (cursorFor policy input) names with
            | .error .size => ["size", "-", "-", "-"]
            | .error .cursor => ["cursor", "-", "-", "-"]
            | .ok p => ["page", (names.findIdx? (some · == p.resources.head?)).getD 0 |> toString,
                toString p.resources.length, indexOf names p.next]
          IO.println (String.intercalate "\t"
            ([label, sizeLabel, input, toString count, toString size] ++ fields))
