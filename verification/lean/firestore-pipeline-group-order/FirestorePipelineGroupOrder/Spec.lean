namespace FirestorePipelineGroupOrder

inductive Cell where
  | missing | null | i0 | d0 | dn0 | i1 | d1 | i2 | nanA | nanB | nestI | nestD | nest2
  deriving BEq, DecidableEq, Repr

def familyKey : Cell → Nat
  | .missing | .null => 0
  | .i0 | .d0 | .dn0 => 1
  | .i1 | .d1 => 2
  | .i2 => 3
  | .nanA | .nanB => 4
  | .nestI | .nestD => 5
  | .nest2 => 6

def materialize : Cell → Cell
  | .missing => .null
  | cell => cell

def key (row : List Cell) : List Nat := row.map familyKey

structure Group where
  leader : List Cell
  count : Nat
  deriving DecidableEq, Repr

def insert (row : List Cell) : List Group → List Group
  | [] => [⟨row.map materialize, 1⟩]
  | g :: gs =>
      if key row = key g.leader then
        ⟨g.leader, g.count + 1⟩ :: gs
      else
        g :: insert row gs

def partition (rows : List (List Cell)) : List Group := rows.foldl (fun gs row => insert row gs) []

def groups (arity : Nat) (rows : List (List Cell)) : List Group :=
  if arity = 0 then [⟨[], rows.length⟩] else partition rows

def count : List Group → Nat
  | [] => 0
  | g :: gs => g.count + count gs

end FirestorePipelineGroupOrder
