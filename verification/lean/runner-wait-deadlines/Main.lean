import RunnerWaitDeadlines

open Lean RunnerWaitDeadlines

private def array (entries : List Json) : Json := .arr entries.toArray

private def emit (tag : String) (axes : List String) (args : List Json)
    (result : Json) : IO Unit :=
  IO.println (array [.str tag, array (axes.map Json.str), array args, result]).compress

private def quietCases : List (String × NumericInput) :=
  [("zero", .integer 0), ("ordinary", .integer 30000), ("negative", .integer (-1)),
   ("fraction", .fraction), ("text", .text "30000"), ("null", .null),
   ("safe-edge", .integer 9007199254740991), ("unsafe", .integer 9007199254740992)]

private def marginCases : List (String × Option NumericInput) :=
  [("default", none), ("zero", some (.integer 0)), ("one", some (.integer 1)),
   ("two", some (.integer 2)), ("three", some (.integer 3)), ("negative", some (.integer (-1))),
   ("fraction", some .fraction), ("text", some (.text "3")), ("null", some .null),
   ("safe-edge", some (.integer 9007199254740991)), ("unsafe", some (.integer 9007199254740992))]

private def bases : List (String × Nat) :=
  [("zero", 0), ("ordinary", 35000), ("near-safe", maxSafeInteger - 2), ("safe-edge", maxSafeInteger)]

private def caps : List (String × Option Nat) :=
  [("default", none), ("zero", some 0), ("odd", some 3), ("ordinary", some 2000), ("safe-edge", some maxSafeInteger)]

private def lags (cap : Nat) : List (String × Nat) :=
  [("zero", 0), ("below-half", cap / 2 - 1), ("half", cap / 2), ("above-half", cap / 2 + 1),
   ("safe-edge", maxSafeInteger)]

private def progressAt (mode : String) (tick : Nat) : Nat :=
  match mode with
  | "changed" => tick
  | "alternating" => tick % 2
  | "early" => if tick < 2 then 0 else 1
  | "late" => if tick < 4 then 0 else 1
  | _ => 0

private def samples (mode event : String) : List Sample :=
  (List.range 7).map fun tick =>
    ⟨tick, ((event == "early-ready" || event == "both") && tick == 0) ||
          (event == "late-ready" && tick == 3),
         ((event == "early-fail" || event == "both") && tick == 0) ||
          (event == "late-fail" && tick == 3),
         progressAt mode tick⟩

private def Sample.json (sample : Sample) : Json :=
  array [toJson sample.tick, .bool sample.ready, .bool sample.failed, toJson sample.progress]

private def resultName : Result → String
  | .ready => "ready"
  | .failed => "failed"
  | .stalled => "stalled"
  | .hardLimit => "hard"
  | .keepWaiting _ => "waiting"

private def callName : Call → String
  | .check => "check"
  | .failFast => "failFast"
  | .progress => "progress"
  | .sleep => "sleep"

def main : IO Unit := do
  IO.println "# load-independent wait reference cases"
  for (quietName, quiet) in quietCases do
    for (marginName, margin) in marginCases do
      let result := match quietStall quiet margin with
        | .ok n => array [.str "ok", .str (toString n)]
        | .error reason => array [.str "error", .str reason]
      emit "quiet" [quietName, marginName] [quiet.json, (margin.map NumericInput.json).getD .null, .bool margin.isSome] result
  for (baseName, base) in bases do
    for (capName, cap) in caps do
      for (lagName, lag) in lags (cap.getD capDefault) do
        let (limit, tooLoaded) := deadline base lag cap
        emit "deadline" [baseName, capName, lagName] [toJson base, toJson lag, toJson cap]
          (Json.mkObj [("limit", .str (toString limit)), ("tooLoaded", .bool tooLoaded)])
  for mode in ["static", "changed", "alternating", "early", "late"] do
    for stall in [1, 2, 3, 6] do
      for hard in [1, 2, 3, 6] do
        for event in ["none", "early-ready", "early-fail", "both", "late-ready", "late-fail"] do
          let timeline := samples mode event
          let (result, tick, calls) := trace ⟨0, stall, hard⟩ ⟨0, 0⟩ timeline
          emit "poll" [mode, toString stall, toString hard, event]
            [toJson stall, toJson hard, array (timeline.map Sample.json)]
            (array [.str (resultName result), toJson tick, array (("progress" :: calls.map callName).map Json.str)])
