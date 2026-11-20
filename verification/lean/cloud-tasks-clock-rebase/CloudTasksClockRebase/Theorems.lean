import CloudTasksClockRebase.Spec

namespace CTRebase

theorem equal_clocks (instant clock : Int) : translate instant clock clock = instant := by
  simp [translate]

theorem keep_ties (instant own other : Int) (h : distance instant other = distance instant own) :
    translate instant own other = instant := by
  simp [translate, h]

theorem keep_when_no_nearer (instant own other : Int) (h : distance instant own ≤ distance instant other) :
    translate instant own other = instant := by
  simp [translate, Int.not_lt.mpr h]

theorem clip_of_range {n : Int} (lo : lower ≤ n) (hi : n ≤ upper) : clip n = n := by
  unfold clip
  rw [Int.max_eq_right lo, Int.min_eq_right hi]

theorem delay_preserved (instant own other : Int) (near : distance instant other < distance instant own)
    (d1 : lower ≤ instant - other) (d2 : instant - other ≤ upper)
    (t1 : lower ≤ instant - other + own) (t2 : instant - other + own ≤ upper) :
    translate instant own other - own = instant - other := by
  rw [translate, ite_eq_left near, clip_of_range d1 d2, clip_of_range t1 t2]
  omega

theorem saturated_distances_can_tie :
    translate upper lower (lower + 1) = upper := by decide

end CTRebase
