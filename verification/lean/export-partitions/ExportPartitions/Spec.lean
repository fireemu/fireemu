import Std

namespace ExportPartitions

inductive Partition where
  | all
  | kind (collection : String)
  | namespace (name : String)
  deriving Repr, DecidableEq

def namespacePartition (name : String) : Partition :=
  if name = "" then .all else .namespace name

/-- Explicit namespaces take precedence. The order of the winning filter list is observable. -/
def select (collections namespaces : List String) : List Partition :=
  match namespaces, collections with
  | n :: ns, _ => (n :: ns).map namespacePartition
  | [], c :: cs => (c :: cs).map Partition.kind
  | [], [] => [.all]

/-- The collection field is the innermost collection of the document path. -/
structure Document where
  collection : String
  path : String
  deriving Repr, DecidableEq

def documentsFor (docs : List Document) : Partition → List Document
  | .all => docs
  | .kind c => docs.filter (fun doc => doc.collection == c)
  | .namespace _ => []

def directory : Partition → String
  | .all => "all_namespaces/all_kinds"
  | .kind c => "all_namespaces/kind_" ++ c
  | .namespace n => "namespace_" ++ n ++ "/all_kinds"

def metadata (p : Partition) : String :=
  directory p ++ "/" ++ (directory p).replace "/" "_" ++ ".export_metadata"

def output (p : Partition) (ordinal : Nat) : String :=
  directory p ++ "/output-" ++ toString ordinal

/-- The aggregate metadata precedes the metadata/data pair for each partition. -/
def files (name : String) (partitions : List Partition) : List String :=
  (name ++ ".overall_export_metadata") ::
    (partitions.zipIdx.flatMap fun (p, ordinal) => [metadata p, output p ordinal])

end ExportPartitions
