import FunctionsEventarcVerbatim

open Verbatim

def types : List (String × Scalar) :=
  [("absent", .absent), ("null", .null), ("false", .no), ("true", .yes),
   ("zero", .zero), ("negative-zero", .zero), ("nonzero", .nonzero),
   ("empty", .empty), ("text", .text), ("array", .array), ("object", .object)]

def nestedValues : List (String × Nested) :=
  [("absent", .absent), ("plain", .plain), ("string", .stringField),
   ("timestamp", .timestampField), ("malformed", .malformedString),
   ("null", .null)]

def render (value : Option String) : String :=
  match value with
  | none => "-"
  | some text => s!"+{text}"

def main : IO Unit := do
  IO.println "# type|top member|nested member|outer allows|verbatim type|attribute|admitted type"
  for (typeName, kind) in types do
    for (member, top) in types do
      for (nestedName, nested) in nestedValues do
        IO.println s!"{typeName}|{member}|{nestedName}|{outerAllows kind}|{render (eventType kind)}|{render (filterAttribute top nested)}|{render (admittedType kind)}"
