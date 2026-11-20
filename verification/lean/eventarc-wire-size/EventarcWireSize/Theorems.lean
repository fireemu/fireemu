import EventarcWireSize.Spec

namespace EWS

theorem zero_varint : varintLen 0 = 1 := by decide

theorem varint_positive (n : Nat) : 0 < varintLen n := by
  simp [varintLen]

theorem varint_monotone {a b : Nat} (h : a ≤ b) : varintLen a ≤ varintLen b := by
  have hlog : a.log2 ≤ b.log2 := by
    by_cases ha : a = 0
    · subst a
      simp
    · have hb : b ≠ 0 := by omega
      exact (Nat.le_log2 hb).2 (Nat.le_trans (Nat.log2_self_le ha) h)
  exact Nat.add_le_add_right (Nat.div_le_div_right hlog) 1

theorem field_strict_mono {a b : Nat} (h : a < b) : fieldLen a < fieldLen b := by
  have hv := varint_monotone (Nat.le_of_lt h)
  unfold fieldLen
  omega

theorem any_strict_mono {a b : Nat} (h : a < b) : anySize a < anySize b := by
  have hp := field_strict_mono h
  have hi : innerSize a < innerSize b := by
    unfold innerSize
    omega
  exact Nat.add_lt_add_left (field_strict_mono hi) _

theorem peer_adds_framed_event (payload peers : Nat) :
    requestSize payload (peers + 1) = requestSize payload peers + fieldLen (anySize 2) := by
  simp [requestSize, Nat.add_mul, Nat.add_assoc]

theorem count_precedes_size (r : Representation) (payload peers : Nat) (h : peers ≥ countLimit) :
    verdict r payload peers = .eventCount := by
  have excess : peers + 1 > countLimit := by omega
  simp [verdict, excess]

theorem exact_any_limit_is_delivered (r : Representation) (payload peers : Nat)
    (textual : r ≠ .binary) (count : peers < countLimit) (exactSize : anySize payload = eventLimit) :
    verdict r payload peers = .deliver := by
  have hc : ¬ peers + 1 > countLimit := by omega
  simp [verdict, hc, exactSize, textual]

theorem oversized_precedes_binary (payload peers : Nat) (count : peers < countLimit)
    (size : anySize payload > eventLimit) :
    verdict .binary payload peers = .eventSize := by
  have hc : ¬ peers + 1 > countLimit := by omega
  simp [verdict, hc, size]

end EWS
