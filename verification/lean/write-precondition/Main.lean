import WritePrecondition

/-!
# Golden corpus generator

After the header, each case is one line:

    <label> <import-clock> <initial-update-time> <initial-field> <now> <write>... => <status> <final-update-time> <final-field> <commit-time> <reported-update-time>...

Times are signed decimal nanoseconds. Fields are decimal i64s. A dash means missing. Writes are
`kind:condition[:operand[:delta]]`, with `none`, `exists`, `missing` or `at@<nanoseconds>` as the
condition. A dash operand means a missing field or an invalid numeric transform operand, depending
on the kind. `create` always takes `missing`. All writes target the same document. A failed batch
has no commit time or per-write reports. The results are from `WP.batch` and `WP.publishedDocument`.
-/

open WP

def encOptional (value : Option Int) : String := (value.map toString).getD "-"

def encCondition : Condition → String
  | .none => "none"
  | .exists true => "exists"
  | .exists false => "missing"
  | .updateTime t => s!"at@{t}"

def encWrite (kind : String) (write : Write) : String :=
  let args := match write.op with
    | .replace v | .patch v | .increment v => [encOptional v]
    | .patchIncrement v d => [encOptional v, encOptional d]
    | .emptyMask | .delete _ => []
  ":".intercalate (kind :: encCondition write.precondition :: args)

def encError : Error → String
  | .notFound => "NOT_FOUND"
  | .alreadyExists => "ALREADY_EXISTS"
  | .failedPrecondition => "FAILED_PRECONDITION"
  | .invalidArgument => "INVALID_ARGUMENT"

structure Case where
  label : String
  last : State
  initial : Option Document
  now : Int
  writes : List (String × Write)

def encCase (c : Case) : String :=
  let stamp := nextCommitTime (c.last.map fun clock => importClock (nextCommitTime none clock) c.initial) c.now
  let result := batch stamp c.initial (c.writes.map Prod.snd)
  let final := publishedDocument c.initial result
  let input := [c.label, encOptional c.last, encOptional (documentTime c.initial),
    encOptional (c.initial.bind (·.value)), toString c.now] ++
    c.writes.map (fun (kind, w) => encWrite kind w)
  let state := [encOptional (documentTime final), encOptional (final.bind (·.value))]
  let output := match result with
    | .error e => [encError e] ++ state ++ ["-"]
    | .ok (_, times) => ["applied"] ++ state ++ [toString stamp] ++ times.map encOptional
  " ".intercalate input ++ " => " ++ " ".intercalate output

def kinds : List (String × Operation) :=
  [("set", .replace (some 7)), ("update", .replace (some 7)), ("masked", .patch (some 7)),
   ("empty-mask", .emptyMask), ("delete", .delete false), ("transform", .increment (some 1)),
   ("masked-transform", .patchIncrement (some 7) (some 1)),
   ("delete-transform", .delete true), ("bad-transform", .increment none)]

def states : List (Option Document) :=
  [none, some ⟨10000, some 7⟩, some ⟨10000, none⟩, some ⟨10001, some 7⟩]

def conditions : List Condition :=
  [.none, .exists true, .exists false, .updateTime 9000, .updateTime 9999,
    .updateTime 10000, .updateTime 10001, .updateTime 11000]

def matrix : List Case :=
  states.flatMap fun doc =>
    (⟨"create", some 10000, doc, 10001, [("create", create (some 7))]⟩ : Case) ::
    kinds.flatMap fun (kind, op) =>
      conditions.map fun p => ⟨"matrix", some 10000, doc, 10001, [(kind, ⟨op, p⟩)]⟩

def scenarios : List Case :=
  let old : Option Document := some ⟨10000, some 7⟩
  let last := some 10000
  let set := fun (v : Int) (p : Condition) => ("set", (⟨.replace (some v), p⟩ : Write))
  let del := fun (p : Condition) => ("delete", (⟨.delete false, p⟩ : Write))
  let inc := fun (d : Option Int) (p : Condition) =>
    (if d.isSome then "transform" else "bad-transform", (⟨.increment d, p⟩ : Write))
  let mk := fun label doc writes => (⟨label, last, doc, 10001, writes⟩ : Case)
  [mk "create-then-match-stage" none [("create", create (some 7)), set 8 (.updateTime 11000)],
   mk "create-twice-rolls-back" none [("create", create (some 7)), ("create", create (some 7))],
   mk "stale-after-change" old [set 8 .none, del (.updateTime 10000)],
   mk "noop-keeps-time-for-next-write" old [set 7 .none, set 8 (.updateTime 10000)],
   mk "delete-then-create" old [del .none, ("create", create (some 8))],
   mk "delete-then-update-time" old [del .none, set 8 (.updateTime 10000)],
   mk "three-writes-share-stamp" old [set 8 .none, inc (some 1) (.updateTime 11000),
     inc (some 1) (.updateTime 11000)],
   mk "third-precondition-rolls-back" old [set 8 .none, inc (some 1) (.exists true),
     del (.updateTime 10000)],
   mk "third-invalid-transform-rolls-back" old [del .none, set 8 (.exists false), inc none .none],
   mk "create-delete-create" none [("create", create (some 7)), del (.exists true),
     ("create", create (some 8))],
   mk "delete-missing-twice" none [del .none, del (.exists false)],
   mk "mask-removes-field" old [("masked", ⟨.patch none, .exists true⟩),
     inc (some 1) (.updateTime 11000)],
   mk "saturates-above" (some ⟨10000, some 9223372036854775806⟩) [inc (some 2) .none],
   mk "saturates-below" (some ⟨10000, some (-9223372036854775807)⟩) [inc (some (-2)) .none],
   mk "saturation-is-a-noop" (some ⟨10000, some 9223372036854775807⟩)
     [inc (some 1) .none, inc (some 1) (.updateTime 10000)],
   mk "changed-fields-reject-stale-imported-time" (some ⟨11000, some 7⟩)
     [set 8 .none, set 8 (.updateTime 11000)],
   ⟨"negative-clock-floors", none, none, -1, [set 7 .none]⟩,
   ⟨"clock-skips-microseconds", last, old, 12543, [set 8 .none]⟩]

def main : IO Unit := do
  let cases := matrix ++ scenarios
  IO.println "# Generated by verification/lean/write-precondition (lake exe corpus). Do not edit."
  IO.println s!"# {cases.length} cases. Format: see Main.lean."
  for c in cases do
    IO.println (encCase c)
