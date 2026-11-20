import FirestoreProtoValues.Spec

namespace FirestoreProtoValues

theorem valid_timestamp_iff (seconds nanos : Int) :
    timestamp seconds nanos = .same ↔
      0 ≤ nanos ∧ nanos < nanosPerSecond ∧ minSeconds ≤ seconds ∧ seconds ≤ maxSeconds := by
  by_cases neg : nanos < 0
  · simp [timestamp, neg]
    omega
  by_cases big : nanosPerSecond ≤ nanos
  · simp [timestamp, neg, big]
    omega
  by_cases time : minSeconds ≤ seconds ∧ seconds ≤ maxSeconds
  · simp [timestamp, neg, big, time]
    omega
  · simp [timestamp, neg, big, time]

theorem negative_nanos_precede_seconds_range (seconds nanos : Int) (negative : nanos < 0) :
    timestamp seconds nanos = .negativeNanos := by
  simp [timestamp, negative]

theorem nonfinite_latitude_is_invalid (longitude : Option Int) :
    geo none longitude = .badGeo := by
  simp [geo, inRange]

theorem container_boundary : container 20 = .same ∧ container 21 = .depth := by decide

theorem map_marker_must_be_exact (p : Payload) (e : Extra) :
    mapVerdict .other p e ≠ .vector := by
  cases p <;> cases e <;> decide

theorem vector_has_no_additional_fields (m : Marker) (p : Payload) (e : Extra)
    (h : mapVerdict m p e = .vector) : e = .absent := by
  cases m <;> cases p <;> cases e <;> simp [mapVerdict] at h ⊢

theorem vector_rejects_nonnumeric_member :
    mapVerdict .exact .bad .absent = .badVector := by decide

theorem reserved_name_is_reported_before_type (m : Marker) (p : Payload) :
    mapVerdict m p .name = .reservedName := rfl

theorem recognize_empty_vector : mapVerdict .exact .empty .absent = .vector := by decide

theorem missing_marker_decodes_an_ordinary_map (p : Payload) :
    mapVerdict .absent p .ordinary = .map := by simp [mapVerdict]

end FirestoreProtoValues
