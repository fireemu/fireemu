import FirestoreQueryScope.Spec

namespace FirestoreQueryScope

theorem remainder_of_suffix (anchor suffix : Path) :
    remainder anchor (anchor ++ suffix) = some suffix := by
  induction anchor with
  | nil => rfl
  | cons head tail ih => simp [remainder, ih]

theorem remainder_gives_decomposition (anchor path suffix : Path)
    (h : remainder anchor path = some suffix) : path = anchor ++ suffix := by
  induction anchor generalizing path with
  | nil => simpa [remainder] using h
  | cons first rest ih =>
    cases path with
    | nil => simp [remainder] at h
    | cons head tail =>
      by_cases same : first = head
      · subst head
        simp [remainder] at h
        simp [ih tail h]
      · simp [remainder, same] at h

theorem excludes_anchor (reach : Reach) (name : Option String) (anchor : Path) :
    contains reach name anchor anchor = false := by
  have h : remainder anchor anchor = some [] := by simpa using remainder_of_suffix anchor []
  simp [contains, h, describes]

theorem child_is_descendant (name : Option String) (anchor path : Path)
    (h : contains .direct name anchor path = true) :
    contains .descendants name anchor path = true := by
  cases rest : remainder anchor path with
  | none => simp [contains, rest] at h
  | some suffix =>
    cases suffix with
    | nil => simp [contains, rest, describes] at h
    | cons first tail =>
      cases tail with
      | nil => simpa [contains, rest, describes] using h
      | cons next later => simp [contains, rest, describes] at h

theorem named_is_kindless (reach : Reach) (name : String) (anchor path : Path)
    (h : contains reach (some name) anchor path = true) :
    contains reach none anchor path = true := by
  cases rest : remainder anchor path with
  | none => simp [contains, rest] at h
  | some suffix =>
    cases reach <;> cases suffix with
    | nil => simp [contains, rest, describes] at h
    | cons first tail =>
      cases tail <;> simp_all [contains, describes]

theorem root_kindless_contains_every_document (head : Pair) (tail : Path) :
    contains .descendants none [] (head :: tail) = true := by
  simp [contains, describes, remainder]

end FirestoreQueryScope
