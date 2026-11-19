import StoragePrecondition

/-!
# Golden corpus generator

Each case is a line of the form `<counter|production> <initial> | <step> [| <step> ...]`.
An object identity is `<generation>:<metageneration>` or `-` if absent. The initial state
is empty or installed by import, which also sets the generation counter. Steps share a store.

Each step is `<operation> <now> <guards> => <outcome> <returned> <live> <counter> <phase>`.
Operations are `read`, `metadata`, `upload`, `delete`, and `finalize`. The instant is signed
nanoseconds. Guards are `-` or a comma-separated list of `gm:<n>`, `mm:<n>`, `gn:<n>`,
`mn:<n>` in written order. Outcomes are `ok`, `412`, `304`, `404`, or `exhausted`.
The returned and live identities and the generation counter are checked after each step.
The phase is `-` except after finalization, when it is `committed` or `aborted`.
-/

open SP

def encodeObject : Current → String
  | none => "-"
  | some o => s!"{o.generation}:{o.metageneration}"

def encodeGuard : Guard → String
  | .generationMatch n => s!"gm:{n}"
  | .metagenerationMatch n => s!"mm:{n}"
  | .generationNotMatch n => s!"gn:{n}"
  | .metagenerationNotMatch n => s!"mn:{n}"

def encodeOp : Op → String
  | .read => "read"
  | .metadata => "metadata"
  | .upload => "upload"
  | .delete => "delete"
  | .finalize => "finalize"

def encodeResult : SP.Result → String
  | .applied o => s!"ok {encodeObject (some o)}"
  | .refused .failed => "412 -"
  | .refused .notModified => "304 -"
  | .refused .notFound => "404 -"
  | .refused .proceed => "invalid -"
  | .identityExhausted => "exhausted -"

structure Request where
  op : Op
  guards : List Guard := []
  now : Int := 0

def trace (initial : Current) (production : Bool) (requests : List Request) : String := Id.run do
  let mut state : State := ⟨initial, (initial.map (·.generation)).getD 0⟩
  let mut line := s!"{if production then "production" else "counter"} {encodeObject initial}"
  for request in requests do
    let (result, next) := step state request.op request.guards production request.now
    let guards := if request.guards.isEmpty then "-"
      else ",".intercalate (request.guards.map encodeGuard)
    let phase := if request.op = .finalize then
        if finalizePhase result = .committed then "committed" else "aborted"
      else "-"
    line := line ++ s!" | {encodeOp request.op} {request.now} {guards} => {encodeResult result} {encodeObject next.current} {next.lastGeneration} {phase}"
    state := next
  return line

def guardKinds : List ((Nat → Guard) × (Nat × Nat)) :=
  [(.generationMatch, 7, 8), (.metagenerationMatch, 3, 4),
   (.generationNotMatch, 7, 8), (.metagenerationNotMatch, 3, 4)]

def singles : List (List Guard) :=
  guardKinds.flatMap fun (guard, same, other) => [[guard same], [guard other], [guard 0]]

def pairs : List (List Guard) := Id.run do
  let mut cases := #[]
  for ((left, a, b), i) in guardKinds.zipIdx do
    for (right, c, d) in guardKinds.drop (i + 1) do
      for (x, y) in [(a, c), (a, d), (b, c), (b, d), (0, 0)] do
        cases := cases.push [left x, right y] |>.push [right y, left x]
  return cases.toList

def allFour : List (List Guard) :=
  [[.generationMatch 7, .metagenerationMatch 3, .generationNotMatch 8, .metagenerationNotMatch 4],
   [.generationMatch 7, .metagenerationMatch 3, .generationNotMatch 7, .metagenerationNotMatch 3],
   [.generationMatch 7, .metagenerationMatch 4, .generationNotMatch 7, .metagenerationNotMatch 3],
   guardKinds.map (fun (guard, _) => guard 0)].flatMap (fun guards => [guards, guards.reverse])

def productCases : List String :=
  [none, some ⟨7, 3⟩].flatMap fun initial =>
    [.read, .metadata, .upload, .delete, .finalize].flatMap fun op =>
      ([[]] ++ singles ++ pairs ++ allFour).map fun guards =>
        trace initial false [{op, guards}]

def scenarios : List String := [
  trace none false [
    ⟨.upload, [.generationMatch 0], 0⟩, ⟨.upload, [.generationMatch 0], 0⟩,
    ⟨.upload, [.generationMatch 1], 0⟩, ⟨.upload, [.generationMatch 1], 0⟩,
    ⟨.metadata, [.generationMatch 2, .metagenerationMatch 1], 0⟩,
    ⟨.read, [.generationMatch 2, .metagenerationMatch 2], 0⟩,
    ⟨.delete, [.generationMatch 2], 0⟩, ⟨.upload, [.generationMatch 0], 0⟩],
  trace (some ⟨7, 3⟩) false [
    ⟨.metadata, [.generationMatch 7, .metagenerationMatch 3], 0⟩,
    ⟨.metadata, [.generationMatch 7, .metagenerationMatch 3], 0⟩,
    ⟨.finalize, [.generationMatch 7, .metagenerationMatch 4], 0⟩,
    ⟨.finalize, [.generationMatch 7], 0⟩, ⟨.finalize, [.generationMatch 8], 0⟩],
  trace none true [
    ⟨.upload, [.generationMatch 0], 76543⟩, ⟨.upload, [.generationMatch 76], 76543⟩,
    ⟨.upload, [.generationMatch 77], -1⟩, ⟨.upload, [.generationMatch 78], 82000⟩,
    ⟨.upload, [.generationMatch 82], (Int.ofNat maxU64 + 1) * 1000⟩],
  trace (some ⟨maxIdentity - 1, maxIdentity - 1⟩) false [
    ⟨.metadata, [.metagenerationMatch (maxIdentity - 1)], 0⟩,
    ⟨.metadata, [.metagenerationMatch maxIdentity], 0⟩,
    ⟨.metadata, [.metagenerationNotMatch maxIdentity], 0⟩,
    ⟨.upload, [.generationMatch (maxIdentity - 1)], 0⟩,
    ⟨.upload, [.generationMatch maxIdentity], 0⟩,
    ⟨.upload, [.generationMatch maxU64], 0⟩,
    ⟨.finalize, [.generationMatch maxIdentity], 0⟩,
    ⟨.delete, [.generationMatch maxIdentity], 0⟩, ⟨.upload, [.generationMatch 0], 0⟩],
  trace none true [
    ⟨.upload, [], (Int.ofNat maxIdentity + 1) * 1000⟩,
    ⟨.upload, [], Int.ofNat maxU64 * 1000⟩,
    ⟨.upload, [.generationMatch 0], Int.ofNat maxIdentity * 1000⟩,
    ⟨.read, [.generationMatch maxU64], 0⟩]]

def main : IO Unit := do
  let cases := productCases ++ scenarios
  IO.println s!"# {cases.length} cases. Generated by lake exe corpus. Format: see Main.lean."
  for line in cases do IO.println line
