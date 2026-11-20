import PythonRunnerEventData

open PySlice

def digits := "0123456789abcdef".toList

def asHex (text : String) : String :=
  String.ofList (text.toUTF8.data.toList.flatMap fun b =>
    [digits[b.toNat / 16]!, digits[b.toNat % 16]!])

def dataCases : List (String × String) :=
  [("number", "-0.00e+02"), ("escaped-string", "\"é\\u2603\\\"x\""),
   ("object", "{ \"é\": 1E3, \"k\" : [true, null] }"), ("array", "[ 1 , {\"x\" : false} ]"),
   ("literal", "false")]

def innerFields (style value : String) (boundary : Boundary) : List (Member Slice) :=
  let target := ⟨"data", "\"data\"", ⟨value, boundary⟩⟩
  let noise := ⟨"noise", "\"noise\"", ⟨"{\"data\":\"} and \\\"data\\\"\"}", .comma⟩⟩
  let duplicate := ⟨"data", "\"data\"", ⟨"999", .close⟩⟩
  match style with
  | "plain" => [target]
  | "escaped" =>
    let escaped := { target with spelling := "\"\\u0064ata\"" }
    if boundary == .missing then [noise, escaped]
    else [noise, { escaped with value := ⟨value, .comma⟩ }, duplicate]
  | _ => [noise]

def fieldText (name value : String) : String := name ++ " : \t" ++ value

def eventSource (fields : List (Member Slice)) (ending : String) : String :=
  let members := fields.map fun member => fieldText member.spelling member.value.source
  let after := if ending == "comma" then " , \"after\" : true }"
    else if ending == "truncated" then " \t"
    else " }"
  "{ " ++ String.intercalate " , " members ++ after

def rootMembers (style : String) (event : EventObject) : RootObject :=
  let wanted := Member.mk "event" "\"event\"" (some event)
  let ordinary := Member.mk "other" "\"other\"" (some event)
  let noise := Member.mk "noise" "\"noise\"" none
  match style with
  | "plain" => [wanted]
  | "preceded" => [noise, wanted]
  | "escaped" => [{ wanted with spelling := "\"\\u0065vent\"" }]
  | "duplicate" => [wanted, { wanted with value := some [⟨"data", "\"data\"", ⟨"777", .close⟩⟩] }]
  | "absent" => [ordinary]
  | "nonobject" => [{ wanted with value := none }]
  | _ => [wanted]

def emitObject (root : RootObject) (ending : String) : String :=
  let members := root.map fun member =>
    fieldText member.spelling (match member.value with
      | some event => eventSource event ending
      | none => if member.name == "noise" then "\"a } and \\\"event\\\"\"" else "[]")
  if ending == "truncated" then "{ " ++ String.intercalate " , " (members.take
      (if root.head?.any (fun m => m.name == "noise") then 2 else 1))
  else "{ " ++ String.intercalate " , " members ++ (if ending == "open-outer" then "" else " }")

def encodedResult (x : Option String) : String := x.map asHex |>.getD "-"

def main : IO Unit := do
  IO.println "# seam|kind|outer|inner|boundary|input-hex|expected-hex-or-dash"
  for (kind, value) in dataCases do
    for outer in ["plain", "preceded", "escaped", "duplicate", "absent", "nonobject", "array"] do
      for inner in ["plain", "escaped", "absent"] do
        for ending in ["close", "comma", "truncated", "open-outer"] do
          let boundary := if ending == "truncated" then Boundary.missing
            else if ending == "comma" then .comma else .close
          let event := innerFields inner value boundary
          let root := rootMembers outer event
          let object := emitObject root ending
          let text := " \n" ++ (if outer == "array" then "[" ++ object ++ "]" else object)
          let expected := select (if outer == "array" then none else some root)
          IO.println s!"slice|{kind}|{outer}|{inner}|{ending}|{asHex text}|{encodedResult expected}"
    for trigger in ["eventarc", "pubsub", "storage", "database", "schedule"] do
      for presence in ["escaped", "absent", "last-absent", "first-absent"] do
        let withData := innerFields "escaped" value .comma
        let withoutData := innerFields "absent" value .comma
        let events := match presence with
          | "escaped" => [withData]
          | "absent" => [withoutData]
          | "last-absent" => [withData, withoutData]
          | _ => [withoutData, withData]
        let root : RootObject := events.map fun event => ⟨"event", "\"\\u0065vent\"", some event⟩
        let hasData := events.getLast?.any fun event => (firstMember "data" event).isSome
        let fields := root.map fun member => fieldText member.spelling (eventSource (member.value.getD []) "comma")
        let text := "{\"type\":\"invoke\",\"invocationId\":\"case\",\"function\":\"demo\",\"trigger\":\"" ++
          trigger ++ "\"," ++ String.intercalate "," fields ++ "}"
        let expected := inFrame trigger hasData (some root)
        IO.println s!"frame|{kind}|{trigger}|{presence}|comma|{asHex text}|{encodedResult expected}"
