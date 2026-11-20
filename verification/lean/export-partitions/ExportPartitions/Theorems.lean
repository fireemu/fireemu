import ExportPartitions.Spec

namespace ExportPartitions

theorem default_partition : select [] [] = [.all] := rfl

theorem always_at_least_one (collections namespaces : List String) :
    (select collections namespaces).length > 0 := by
  cases namespaces <;> cases collections <;> simp [select]

theorem namespaces_override (collections : List String) (n : String) (ns : List String) :
    select collections (n :: ns) = select [] (n :: ns) := by
  cases collections <;> rfl

theorem namespaces_keep_order (collections : List String) (n : String) (ns : List String) :
    select collections (n :: ns) = (n :: ns).map namespacePartition := by
  cases collections <;> rfl

theorem collections_keep_order (c : String) (cs : List String) :
    select (c :: cs) [] = (c :: cs).map Partition.kind := rfl

theorem adding_collections_appends_partitions (c : String) (cs extra : List String) :
    select ((c :: cs) ++ extra) [] =
      select (c :: cs) [] ++ extra.map Partition.kind := by
  simp [select]

theorem repeated_empty_namespace_keeps_duplicates (cs : List String) :
    select cs ["", ""] = [.all, .all] := by
  cases cs <;> rfl

theorem only_leaf_collection_is_selected (docs : List Document) (c : String) (doc : Document) :
    doc ∈ documentsFor docs (.kind c) ↔ doc ∈ docs ∧ doc.collection = c := by
  simp [documentsFor]

theorem named_namespaces_are_empty (docs : List Document) (ns : String) (h : ns ≠ "") :
    documentsFor docs (namespacePartition ns) = [] := by
  simp [namespacePartition, documentsFor, h]

theorem selection_preserves_order (left right : List Document) (p : Partition) :
    documentsFor (left ++ right) p = documentsFor left p ++ documentsFor right p := by
  cases p <;> simp [documentsFor]

end ExportPartitions
