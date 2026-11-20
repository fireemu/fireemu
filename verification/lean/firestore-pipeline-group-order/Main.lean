import FirestorePipelineGroupOrder

open FirestorePipelineGroupOrder

def cellLabel : Cell → String
  | .missing => "missing"
  | .null => "null"
  | .i0 => "i0"
  | .d0 => "d0"
  | .dn0 => "dn0"
  | .i1 => "i1"
  | .d1 => "d1"
  | .i2 => "i2"
  | .nanA => "nanA"
  | .nanB => "nanB"
  | .nestI => "nestI"
  | .nestD => "nestD"
  | .nest2 => "nest2"

def families : List (String × Cell × Cell × Cell × Cell) :=
  [("numeric", .i1, .d1, .dn0, .d0),
   ("nested", .nestI, .nestD, .nest2, .nest2),
   ("nullish", .missing, .null, .nanA, .nanB)]

def adjustments (arity : Nat) (cells : List Cell) : List (List Cell) :=
  cells.zipIdx.map fun (cell, slot) =>
    if arity = 0 then [] else
      if arity = 1 then [cell] else [cell, if slot % 3 = 0 then .i2 else .d0]

def renderRow (row : List Cell) : String :=
  if row.isEmpty then "_" else String.intercalate "," (row.map cellLabel)

def renderRows (rows : List String) : String :=
  if rows.isEmpty then "-" else String.intercalate ";" rows

def main : IO Unit := do
  IO.println "# stage|input|family|arity|rows|results"
  for stage in ["distinct", "aggregate"] do
    for (family, a, a', b, b') in families do
      for (shape, cells) in [("empty", []), ("first", [a]), ("duplicate", [a', a, a]),
                             ("reverse", [b', b, a', a]), ("interleaved", [a,a',b,a,b',b,a'])] do
        for arity in [0, 1, 2] do
          let rows := adjustments arity cells
          let expected :=
            if stage = "distinct" then
              (partition rows).map fun g => renderRow g.leader
            else
              (groups arity rows).map fun g => s!"{renderRow g.leader}:{g.count}"
          IO.println s!"{stage}|{shape}|{family}|{arity}|{renderRows (rows.map renderRow)}|{renderRows expected}"
