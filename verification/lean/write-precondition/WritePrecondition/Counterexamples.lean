import WritePrecondition.Theorems

namespace WP

theorem missing_updates_without_precondition_upsert :
    stage 11000 none ⟨.replace (some 7), .none⟩ = .ok (some ⟨11000, some 7⟩) ∧
    stage 11000 none ⟨.patch (some 7), .none⟩ = .ok (some ⟨11000, some 7⟩) ∧
    stage 11000 none ⟨.emptyMask, .none⟩ = .ok (some ⟨11000, none⟩) ∧
    stage 11000 none ⟨.replace (some 7), .exists true⟩ = .error .notFound ∧
    stage 11000 none ⟨.patch (some 7), .exists true⟩ = .error .notFound ∧
    stage 11000 none ⟨.emptyMask, .exists true⟩ = .error .notFound := ⟨rfl, rfl, rfl, rfl, rfl, rfl⟩

theorem no_op_can_retry_with_unchanged_time :
    stage 11000 (some ⟨10000, some 7⟩) ⟨.replace (some 7), .none⟩ =
      .ok (some ⟨10000, some 7⟩) ∧
    stage 12000 (some ⟨10000, some 7⟩) ⟨.replace (some 7), .updateTime 10000⟩ =
      .ok (some ⟨10000, some 7⟩) := ⟨rfl, rfl⟩

theorem changed_fields_advance_past_imported_time (commitTime now : Int) (doc : Document)
    (write : Write) (value : Option Int)
    (changed : body write.op doc.value = (.store false, value))
    (accepted : checkPrecondition write.precondition (some doc.time) = none) :
    ∃ t, doc.time < t ∧
      stage (nextCommitTime (some (importClock commitTime (some doc))) now) (some doc) write =
        .ok (some ⟨t, value⟩) := by
  refine ⟨nextCommitTime (some (importClock commitTime (some doc))) now, ?_, ?_⟩
  · simp only [nextCommitTime, importClock, documentTime, Option.map_some, Option.getD_some]
    by_cases h : now - now % 1000 ≤ max commitTime doc.time <;> simp [h] <;> omega
  · simp [stage, changed, documentTime, step, accepted, Except.map]

theorem delete_can_change_existence_without_a_retry_time :
    step 11000 (some 10000) .none .delete = .ok none ∧
    step 12000 none (.updateTime 10000) .delete = .error .failedPrecondition := ⟨rfl, rfl⟩

theorem submicrosecond_precondition_is_not_truncated :
    checkPrecondition (.updateTime 10001) (some 10000) = some .failedPrecondition ∧
    checkPrecondition (.updateTime 10001) (some 10001) = none := by decide

end WP
