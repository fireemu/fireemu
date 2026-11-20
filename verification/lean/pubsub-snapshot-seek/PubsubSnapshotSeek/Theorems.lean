import PubsubSnapshotSeek.Spec

namespace SnapshotSeek

theorem captured_ack_stays_acknowledged (published checkpoint : Int) :
    available false true published checkpoint = false := by
  simp [available, afterBoundary]

theorem pending_capture_is_replayed (retained : Bool) (published checkpoint : Int) :
    available true retained published checkpoint = true := by
  simp [available]

theorem same_time_uncaptured_is_replayed (checkpoint : Int) :
    available false false checkpoint checkpoint = true := by
  simp [available, afterBoundary]

theorem earlier_uncaptured_is_not_replayed (published checkpoint : Int)
    (earlier : published < checkpoint) :
    available false false published checkpoint = false := by
  simp [available, afterBoundary, Int.not_le.mpr earlier]

theorem insertion_starts_before_first_new (isNew : α → Bool) (entry : α)
    (tail additional : List α) (starts : isNew entry = true) :
    insertBefore isNew additional (entry :: tail) = additional ++ entry :: tail := by
  simp [insertBefore, starts]

theorem no_additions_preserve_the_target (isNew : α → Bool) (target : List α) :
    insertBefore isNew [] target = target := by
  induction target with
  | nil => rfl
  | cons first rest ih =>
    cases next : isNew first <;> simp [insertBefore, next, ih]

end SnapshotSeek
