import Lean

namespace NpmClockDuration

inductive Scalar where
  | integer (value : Int)
  | fraction
  | text (value : String)
  | flag (value : Bool)
  | null
  deriving DecidableEq

def Scalar.json : Scalar → Lean.Json
  | .integer n => Lean.toJson n
  | .fraction => .num ⟨15, 1⟩
  | .text s => .str s
  | .flag b => .bool b
  | .null => .null

def Scalar.safeInt : Scalar → Bool
  | .integer n => n.natAbs ≤ 9007199254740991
  | _ => false

def Scalar.magnitude : Scalar → Nat
  | .integer n => n.natAbs
  | _ => 0

def Scalar.negative : Scalar → Bool
  | .integer n => n < 0
  | _ => false

def Scalar.positive : Scalar → Bool
  | .integer n => 0 < n
  | _ => false

abbrev Fields := List (String × Scalar)

inductive Input where
  | scalar (value : Scalar)
  | object (fields : Fields)
  | emptyArray

structure Options where
  zone : Option Scalar := none
  backwards : Option Scalar := none

def Options.present (options : Options) : Bool := options.zone.isSome || options.backwards.isSome

def dateUnits : List (String × String) := [("years", "Y"), ("months", "M"), ("weeks", "W"), ("days", "D")]
def timeUnits : List (String × String) := [("hours", "H"), ("minutes", "M"), ("seconds", "S")]

def calendarKeys : List String :=
  dateUnits.map Prod.fst ++ ["hours", "minutes"]

def knownKeys : List String :=
  (dateUnits ++ timeUnits).map Prod.fst

def has (fields : Fields) (key : String) : Bool :=
  fields.any fun field => field.1 == key

def hasCalendar (fields : Fields) : Bool :=
  fields.any fun field => calendarKeys.contains field.1

def amounts (fields : Fields) (order : List (String × String)) : List (Nat × String) :=
  order.filterMap fun (key, unit) =>
    let amount := (fields.lookup key).map Scalar.magnitude |>.getD 0
    if amount == 0 then none else some (amount, unit)

def renderParts (parts : List (Nat × String)) : String :=
  String.join (parts.map fun (magnitude, unit) => toString magnitude ++ unit)

def formatParts (negative : Bool) (date time : List (Nat × String)) : String :=
  if date.isEmpty && time.isEmpty then "PT0S"
  else (if negative then "-P" else "P") ++ renderParts date ++
    (if time.isEmpty then "" else "T" ++ renderParts time)

def isoDuration (fields : Fields) : Except String String :=
  if fields.isEmpty then .error "calendar duration must contain at least one unit"
  else match fields.find? (fun field => !knownKeys.contains field.1) with
    | some (unit, _) => .error s!"unknown duration unit {unit}; use years, months, weeks, days, hours, minutes or seconds"
    | none =>
      if !fields.all (fun field => field.2.safeInt) then .error "duration units must be safe integers"
      else
        let negative := fields.any fun field => field.2.negative
        let positive := fields.any fun field => field.2.positive
        if negative && positive then .error "duration units must all have the same sign"
        else .ok (formatParts negative (amounts fields dateUnits) (amounts fields timeUnits))

def zoneFields : Option Scalar → Except String Fields
  | none => .ok []
  | some (.text name) => .ok [("timeZone", .text name)]
  | _ => .error "timeZone must be a string"

def backwardsFields : Option Scalar → Except String Fields
  | none => .ok []
  | some (.flag allowed) => .ok [("allowBackwards", .flag allowed)]
  | _ => .error "allowBackwards must be a boolean"

def moveOptions (options : Options) : Except String Fields := do
  let zone ← zoneFields options.zone
  let backwards ← backwardsFields options.backwards
  return zone ++ backwards

def durationText : Input → Except String String
  | .scalar (.text duration) => .ok duration
  | .object fields => isoDuration fields
  | .emptyArray => isoDuration []
  | _ => .error "duration must be an ISO 8601 string or an object of calendar units"

def legacyBody (input : Input) (options : Options) : Except String Fields :=
  if options.present then .error "timeZone and allowBackwards require an ISO 8601 duration or calendar units"
  else match input with
    | .scalar number@(.integer _) | .scalar number@.fraction => .ok [("millis", number)]
    | .object fields => if has fields "seconds" || has fields "millis" then .ok fields
      else .error "advance requires seconds, millis or calendar units"
    | _ => .error "advance requires seconds, millis or calendar units"

def calendarBody (duration : Input) (options : Options) : Except String Fields := do
  let value ← durationText duration
  let rest ← moveOptions options
  return ("duration", .text value) :: rest

def advance (input : Input) (options : Options) : Except String Fields :=
  match input with
  | .scalar (.text _) => calendarBody input options
  | .object fields =>
    if hasCalendar fields then
      if has fields "millis" then .error "millis cannot be combined with calendar units"
      else calendarBody input options
    else legacyBody input options
  | _ => legacyBody input options

def anchor (target : Scalar) (duration : Option Input) (options : Options) : Except String Fields :=
  match target with
  | .text name => do
    let body ← match duration with
      | none => pure []
      | some input => do
        let value ← durationText input
        pure [("duration", .text value)]
    let rest ← moveOptions options
    return ("to", .text name) :: body ++ rest
  | _ => .error "the anchor must be a string such as endOfMonth"

end NpmClockDuration
