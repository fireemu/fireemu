import StorageHttpRange.Spec

namespace StorageHttpRange

theorem clipped_interval_bounds (length first last lo hi : Nat)
    (selected : clipClosed length first last = some (lo, hi)) :
    lo = first ∧ hi ≤ length ∧ lo < hi := by
  by_cases valid : first < length ∧ first ≤ last
  · have keys : first = lo ∧ min length (last + 1) = hi := by
      simpa [clipClosed, valid] using selected
    obtain ⟨rfl, rfl⟩ := keys
    exact ⟨rfl, Nat.min_le_left _ _, Nat.lt_min.mpr ⟨valid.1, by omega⟩⟩
  · simp [clipClosed, valid] at selected

theorem positive_suffix_has_nonempty_interval (length count : Nat)
    (nonempty : 0 < length) (positive : 0 < count) :
    select length (.suffix count) = .slice (length - count) length ∧ length - count < length := by
  simp [select, Nat.ne_of_gt positive, Nat.ne_of_gt nonempty]
  omega

theorem unsatisfied_range_falls_back_in_emulator (data : String) (header : Range)
    (rejected : select data.length header = .rejected) :
    download .emulator data header = (200, "-", data) := by
  simp [download, rejected, String.length_toList]
  rfl

theorem terminal_upload_recovers_via_status (session : Session) (declared : Option Nat) (chunk : String)
    (success : session.phase = .committed) :
    ingest session (.status declared) chunk = (session, .finished (String.ofList session.bytes)) := by
  simp [ingest, parseModeled, status, success]

theorem retry_does_not_double_append (prior chunk : List Char) (offset : Nat)
    (repeated : offset + chunk.length ≤ prior.length) :
    reconcile prior offset chunk = prior := by
  have discarded : chunk.drop (prior.length - offset) = [] := by
    apply List.drop_eq_nil_iff.mpr
    omega
  simp [reconcile, discarded]

theorem contiguous_chunk_is_appended (prior chunk : List Char) :
    reconcile prior prior.length chunk = prior ++ chunk := by
  simp [reconcile]

theorem closed_u64_end_has_no_successor (start : Nat) (total : Option Nat) (chunkSize : Nat) :
    parseModeled (.closed start (2 ^ 64 - 1) total) chunkSize = none := by
  simp [parseModeled]

end StorageHttpRange
