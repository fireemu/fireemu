import NpmClockDuration

open NpmClockDuration Lean

private def array (entries : List Json) : Json := .arr entries.toArray

private def inputJson : Input → Json
  | .scalar value => array [.str "scalar", value.json]
  | .object fields => array [.str "object", array (fields.map fun (key, value) => array [.str key, value.json])]
  | .emptyArray => array [.str "array"]

private def fieldsJson (fields : Fields) : Json :=
  Json.mkObj (fields.map fun (key, value) => (key, value.json))

private def optionsJson (options : NpmClockDuration.Options) : Json :=
  fieldsJson ((options.zone.map (fun value => ("timeZone", value))).toList ++
    (options.backwards.map (fun value => ("allowBackwards", value))).toList)

private def outcome (encode : α → Json) : Except String α → Json
  | .ok value => array [.str "ok", encode value]
  | .error reason => array [.str "error", .str reason]

private def emit (tag : String) (axes : List String) (args : List Json)
    (result : Json) (identity := false) : IO Unit :=
  IO.println (array [.str tag, array (axes.map Json.str), array args, result, .bool identity]).compress

private def layouts : List (String × List String) :=
  [("all", knownKeys), ("date", dateUnits.map Prod.fst), ("time", timeUnits.map Prod.fst),
   ("sparse", ["years", "weeks", "minutes", "seconds"]), ("seconds", ["seconds"]),
   ("empty", []), ("unknown", ["fortnights", "months"]), ("two-unknown", ["cycles", "fortnights", "days"])]

private def amount (kind : String) (index : Nat) : Scalar :=
  match kind with
  | "zero" => .integer 0
  | "negative" => .integer (-(Int.ofNat index + 1))
  | "mixed" => if index % 2 == 0 then .integer 2 else .integer (-3)
  | "safe-edge" => .integer 9007199254740991
  | "unsafe" => .integer 9007199254740992
  | "fraction" => .fraction
  | "text" => .text "4"
  | _ => .integer (Int.ofNat index + 1)

private def orderFields (fields : Fields) (mode : String) : Fields :=
  match mode with
  | "reverse" => fields.reverse
  | "rotate" => fields.drop 1 ++ fields.take 1
  | _ => fields

private def optionsCases : List (String × NpmClockDuration.Options) :=
  [("none", {}), ("zone", ⟨some (.text "Asia/Tokyo"), none⟩),
   ("backwards", ⟨none, some (.flag false)⟩), ("both", ⟨some (.text ""), some (.flag true)⟩),
   ("bad-zone", ⟨some (.integer 9), none⟩), ("bad-backwards", ⟨none, some (.text "yes")⟩),
   ("both-invalid", ⟨some .null, some .null⟩)]

private def advanceShapes : List String :=
  ["number", "seconds", "millis", "legacy-combined", "legacy-extra", "raw", "calendar", "calendar-seconds",
   "calendar-millis", "calendar-unknown", "mixed-sign", "empty", "other-field", "null", "array", "boolean"]

private def advanceInput (shape : String) (value : Scalar) : Input :=
  match shape with
  | "number" => .scalar value
  | "seconds" => .object [("seconds", value)]
  | "millis" => .object [("millis", value)]
  | "legacy-combined" => .object [("seconds", value), ("millis", .integer 3)]
  | "legacy-extra" => .object [("seconds", value), ("verbatim", .null)]
  | "raw" => .scalar (.text "not validated here")
  | "calendar" => .object [("months", value)]
  | "calendar-seconds" => .object [("days", value), ("seconds", value)]
  | "calendar-millis" => .object [("hours", value), ("millis", .null)]
  | "calendar-unknown" => .object [("hours", value), ("fortnights", .null)]
  | "mixed-sign" => .object [("days", .integer (-1)), ("minutes", .integer 1)]
  | "empty" => .object []
  | "other-field" => .object [("fortnights", value)]
  | "null" => .scalar .null
  | "array" => .emptyArray
  | _ => .scalar (.flag false)

private def anchorTargets : List (String × Scalar) :=
  [("known", .text "endOfMonth"), ("arbitrary", .text "unknown anchor"),
   ("numeric", .integer 42), ("null", .null)]

private def anchorInputs : List (String × Option Input) :=
  [("absent", none), ("raw", some (.scalar (.text "PT2.50S"))),
   ("calendar", some (.object [("days", .integer (-2)), ("minutes", .integer (-4))])),
   ("seconds", some (.object [("seconds", .integer 5)])),
   ("empty", some (.object [])), ("array", some .emptyArray),
   ("scalar", some (.scalar .fraction)),
   ("mixed-sign", some (.object [("days", .integer (-1)), ("minutes", .integer 1)]))]

def main : IO Unit := do
  IO.println "# npm clock helper reference cases"
  for (shape, units) in layouts do
    for mode in ["positive", "zero", "negative", "mixed", "safe-edge", "unsafe", "fraction", "text"] do
      for order in ["source", "reverse", "rotate"] do
        let fields := orderFields (units.zipIdx.map fun (key, index) => (key, amount mode index)) order
        emit "iso" [shape, mode, order] [inputJson (.object fields)] (outcome Json.str (isoDuration fields))
  for shape in advanceShapes do
    for mode in ["positive", "zero", "negative", "fraction", "unsafe", "text"] do
      for (optionCase, options) in optionsCases do
        let input := advanceInput shape (amount mode 0)
        let result := advance input options
        let identity := ["seconds", "millis", "legacy-combined", "legacy-extra"].contains shape && optionCase == "none"
        emit "advance" [shape, mode, optionCase] [inputJson input, optionsJson options] (outcome fieldsJson result) identity
  for (targetCase, target) in anchorTargets do
    for (durationCase, duration) in anchorInputs do
      for (optionCase, options) in optionsCases do
        emit "anchor" [targetCase, durationCase, optionCase]
          [target.json, (duration.map inputJson).getD .null, optionsJson options] (outcome fieldsJson (anchor target duration options))
