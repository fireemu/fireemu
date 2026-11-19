import Rfc3339Time.Theorems

namespace RfcTime

private theorem digit_sound (ch : Char) (n : Nat) (h : digitValue ch = some n) :
    n < 10 ∧ ch = Char.ofNat (48 + n) := by
  unfold digitValue at h
  split at h
  · injection h with he
    have hc : ch.toNat = 48 + n := by omega
    exact ⟨by omega, by rw [← hc, Char.ofNat_toNat]⟩
  · contradiction

private theorem digit_complete (n : Nat) (h : n < 10) :
    digitValue (Char.ofNat (48 + n)) = some n := by
  have hv : (48 + n).isValidChar := by
    exact Or.inl (by omega)
  have hc : (Char.ofNat (48 + n)).toNat = 48 + n := by
    simp [Char.ofNat, hv, Char.ofNatAux] <;> omega
  simp [digitValue, hc, show 48 ≤ 48 + n by omega, show 48 + n < 58 by omega]

private theorem decimal_cons (w hi lo : Nat) (hlo : lo < 10 ^ w) :
    decimal (w + 1) (hi * 10 ^ w + lo) = Char.ofNat (48 + hi) :: decimal w lo := by
  have hp : 0 < 10 ^ w := Nat.pow_pos (by decide)
  rw [Nat.add_comm (hi * 10 ^ w) lo]
  simp [decimal, Nat.add_mul_div_right _ _ hp, Nat.div_eq_of_lt hlo, Nat.mod_eq_of_lt hlo]

private theorem readDigits_complete (e : String) (w n : Nat) (rest : List Char) (p : Nat)
    (hn : n < 10 ^ w) :
    readDigits e w ⟨decimal w n ++ rest, p⟩ = .ok (n, ⟨rest, p + w⟩) := by
  induction w generalizing n p with
  | zero =>
    have : n = 0 := by simp at hn; omega
    subst n
    simp [decimal, readDigits]
  | succ w ih =>
    have hp : 0 < 10 ^ w := Nat.pow_pos (by decide)
    have hi : n / 10 ^ w < 10 := by
      apply (Nat.div_lt_iff_lt_mul hp).2
      simpa [Nat.pow_succ, Nat.mul_comm] using hn
    have hl := Nat.mod_lt n hp
    simp only [decimal, List.cons_append, readDigits, digit_complete _ hi]
    rw [ih _ _ hl]
    simp [Bind.bind, Except.bind, Pure.pure, Except.pure, Nat.mul_comm (n / 10 ^ w),
      Nat.mod_add_div, Nat.add_comm (10^w * (n / 10^w)), Nat.add_assoc, Nat.add_comm 1 w]

private theorem readDigits_sound (e : String) (w : Nat) (c r : Cursor) (n : Nat)
    (h : readDigits e w c = .ok (n, r)) :
    n < 10 ^ w ∧ c.input = decimal w n ++ r.input ∧ r.pos = c.pos + w := by
  induction w generalizing c r n with
  | zero =>
    simp only [readDigits, Except.ok.injEq, Prod.mk.injEq] at h
    obtain ⟨rfl, rfl⟩ := h
    simp [decimal]
  | succ w ih =>
    obtain ⟨input, p⟩ := c
    cases input with
    | nil => simp [readDigits, throw] at h
    | cons ch tail =>
      cases hd : digitValue ch with
      | none => simp [readDigits, hd, throw] at h
      | some hi =>
        obtain ⟨hhi, hch⟩ := digit_sound ch hi hd
        cases hr : readDigits e w ⟨tail, p + 1⟩ with
        | error err => simp [readDigits, hd, hr, Bind.bind, Except.bind] at h
        | ok res =>
          obtain ⟨lo, next⟩ := res
          have ⟨hlo, htail, hp⟩ := ih _ _ _ hr
          simp only [readDigits, hd, hr, Bind.bind, Except.bind, Pure.pure, Except.pure,
            Except.ok.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl⟩ := h
          dsimp only at htail
          rw [decimal_cons w hi lo hlo]
          refine ⟨?_, by simp [hch, htail], by dsimp at hp ⊢; omega⟩
          rw [Nat.pow_succ]
          have hmul := Nat.mul_le_mul_right (10 ^ w) (show hi + 1 ≤ 10 by omega)
          rw [Nat.add_mul, Nat.one_mul, Nat.mul_comm 10] at hmul
          omega

private theorem bind_ok_iff (a : Except ParseError α) (f : α → Except ParseError β) (b : β) :
    (a >>= f) = .ok b ↔ ∃ x, a = .ok x ∧ f x = .ok b := by
  cases a <;> simp [Bind.bind, Except.bind]

private theorem expect_ok_iff (chars : List Char) (e : String) (c r : Cursor) :
    expect chars e c = .ok r ↔
      ∃ ch, ch ∈ chars ∧ c.input = ch :: r.input ∧ r.pos = c.pos + 1 := by
  obtain ⟨input, p⟩ := c
  obtain ⟨rest, q⟩ := r
  cases input with
  | nil => simp [expect]
  | cons ch tail =>
    by_cases hch : ch ∈ chars <;> simp [expect, hch, Cursor.mk.injEq] <;> grind

private theorem readDigits_ok_iff (e : String) (w : Nat) (c r : Cursor) (n : Nat) :
    readDigits e w c = .ok (n, r) ↔
      n < 10 ^ w ∧ c.input = decimal w n ++ r.input ∧ r.pos = c.pos + w := by
  constructor
  · exact readDigits_sound e w c r n
  · rintro ⟨hn, hi, hp⟩
    cases c
    cases r
    dsimp only at hi hp
    subst_vars
    exact readDigits_complete e w n _ _ hn

private def DateTime.Widths (t : DateTime) : Prop :=
  t.year < 10000 ∧ t.month < 100 ∧ t.day < 100 ∧ t.hour < 100 ∧ t.minute < 100 ∧ t.second < 100

private theorem expect_complete (ch : Char) (allowed : List Char) (e : String)
    (r : List Char) (p : Nat) (h : ch ∈ allowed) :
    expect allowed e ⟨ch :: r, p⟩ = .ok ⟨r, p + 1⟩ := by simp [expect, h]

private theorem readDateTime_complete (t : DateTime) (sep : Char)
    (rest : List Char) (p : Nat) (hw : t.Widths) (hs : sep ∈ ['T', 't']) :
    readDateTime ⟨dateTimeText t sep ++ rest, p⟩ = .ok (t, ⟨rest, p + 19⟩) := by
  obtain ⟨hy, hm, hd, hh, hmin, hsec⟩ := hw
  have hDash : '-' ∈ ['-'] := by decide
  have hColon : ':' ∈ [':'] := by decide
  cases t
  simp only [dateTimeText, List.append_assoc, List.cons_append, List.nil_append,
    readDateTime, readDigits_complete _ 4 _ _ _ hy, readDigits_complete _ 2 _ _ _ hm,
    readDigits_complete _ 2 _ _ _ hd, readDigits_complete _ 2 _ _ _ hh,
    readDigits_complete _ 2 _ _ _ hmin, readDigits_complete _ 2 _ _ _ hsec,
    expect_complete _ _ _ _ _ hs, expect_complete _ _ _ _ _ hDash,
    expect_complete _ _ _ _ _ hColon, Bind.bind, Except.bind, Pure.pure, Except.pure]

private theorem readDateTime_sound (c r : Cursor) (t : DateTime)
    (h : readDateTime c = .ok (t, r)) :
    t.Widths ∧ ∃ sep, sep ∈ ['T', 't'] ∧ c.input = dateTimeText t sep ++ r.input := by
  simp only [readDateTime, bind_ok_iff, Prod.exists, readDigits_ok_iff, expect_ok_iff,
    Pure.pure, Except.pure, Except.ok.injEq, Prod.mk.injEq] at h
  obtain ⟨y, _, ⟨hy, hyText, _⟩, _, ⟨dash₁, hs₁, hs₁Text, _⟩,
    m, _, ⟨hm, hmText, _⟩, _, ⟨dash₂, hs₂, hs₂Text, _⟩,
    d, _, ⟨hd, hdText, _⟩, _, ⟨sep, hs, hsText, _⟩,
    hour, _, ⟨hh, hhText, _⟩, _, ⟨colon₁, hc₁, hc₁Text, _⟩,
    minute, _, ⟨hmin, hminText, _⟩, _, ⟨colon₂, hc₂, hc₂Text, _⟩,
    second, _, ⟨hsec, hsecText, _⟩, rfl, rfl⟩ := h
  simp only [List.mem_singleton] at hs₁ hs₂ hc₁ hc₂
  refine ⟨⟨hy, hm, hd, hh, hmin, hsec⟩, sep, hs, ?_⟩
  rw [hyText, hs₁Text, hmText, hs₂Text, hdText, hsText,
    hhText, hc₁Text, hminText, hc₂Text, hsecText, hs₁, hs₂, hc₁, hc₂]
  simp [dateTimeText, List.append_assoc]

private theorem valid_widths (t : DateTime) (h : t.Valid) : t.Widths := by
  obtain ⟨hy, ⟨_, hm, _, hd⟩, hh, hmin, hsec⟩ := h
  have := daysInMonth_bound t.year t.month
  exact ⟨hy, by omega, by omega, by omega, by omega, by omega⟩

private theorem validate_ok_iff (t : DateTime) (hy : t.year < 10000) :
    validate t = .ok () ↔ t.Valid := by
  simp only [validate, Bind.bind, Except.bind, Pure.pure, Except.pure, throw,
    DateTime.Valid, ValidDate]
  split <;> (try split) <;> (try split) <;> (try split) <;> (try split) <;>
    simp_all <;> omega

/-- A fractional digit uses one unit of precision and contributes its decimal place value. -/
inductive FractionRun : Nat → List Char → Nat → Nat → List Char → Prop
  | stop (w : Nat) (rest : List Char) (h : rest.head?.bind digitValue = none) :
      FractionRun w rest 0 0 rest
  | digit (w hi lo count : Nat) (tail rest : List Char) (h : hi < 10)
      (run : FractionRun w tail lo count rest) :
      FractionRun (w + 1) (Char.ofNat (48 + hi) :: tail)
        (hi * 10 ^ w + lo) (count + 1) rest

private theorem fraction_run_sound (w : Nat) (c r : Cursor) (n count : Nat)
    (h : fractionDigits w c = .ok (n, count, r)) :
    FractionRun w c.input n count r.input := by
  induction w generalizing c r n count with
  | zero =>
    obtain ⟨input, p⟩ := c
    cases input with
    | nil =>
      simp only [fractionDigits, Except.ok.injEq, Prod.mk.injEq] at h
      obtain ⟨rfl, rfl, rfl⟩ := h
      exact .stop 0 [] rfl
    | cons ch tail =>
      cases hd : digitValue ch with
      | some hi => simp [fractionDigits, hd] at h
      | none =>
        simp only [fractionDigits, hd, Except.ok.injEq, Prod.mk.injEq] at h
        obtain ⟨rfl, rfl, rfl⟩ := h
        exact .stop 0 _ (by simpa)
  | succ w ih =>
    obtain ⟨input, p⟩ := c
    cases input with
    | nil =>
      simp only [fractionDigits, Except.ok.injEq, Prod.mk.injEq] at h
      obtain ⟨rfl, rfl, rfl⟩ := h
      exact .stop (w + 1) [] rfl
    | cons ch tail =>
      cases hd : digitValue ch with
      | none =>
        simp only [fractionDigits, hd, Except.ok.injEq, Prod.mk.injEq] at h
        obtain ⟨rfl, rfl, rfl⟩ := h
        exact .stop (w + 1) _ (by simpa)
      | some hi =>
        cases hr : fractionDigits w ⟨tail, p + 1⟩ with
        | error err => simp [fractionDigits, hd, hr, Bind.bind, Except.bind] at h
        | ok result =>
          obtain ⟨lo, k, next⟩ := result
          simp only [fractionDigits, hd, hr, Bind.bind, Except.bind, Pure.pure, Except.pure,
            Except.ok.injEq, Prod.mk.injEq] at h
          obtain ⟨rfl, rfl, rfl⟩ := h
          obtain ⟨hhi, rfl⟩ := digit_sound ch hi hd
          exact .digit w hi lo k tail next.input hhi (ih _ _ _ _ hr)

private theorem fraction_run_complete (w : Nat) (input : List Char) (n count : Nat)
    (rest : List Char) (p : Nat) (h : FractionRun w input n count rest) :
    fractionDigits w ⟨input, p⟩ = .ok (n, count, ⟨rest, p + count⟩) := by
  induction h generalizing p with
  | stop w rest hn =>
    cases rest with
    | nil => rw [fractionDigits]; rfl
    | cons ch tail =>
      have hd : digitValue ch = none := hn
      simp [fractionDigits, hd]
  | digit w hi lo count tail rest hh _ ih =>
    simp [fractionDigits, digit_complete hi hh, ih, Bind.bind, Except.bind, Pure.pure,
      Except.pure, Nat.add_assoc, Nat.add_comm 1 count]

private theorem fraction_run_decimal (w n : Nat) (rest : List Char)
    (hn : n < 10 ^ w) (hr : rest.head?.bind digitValue = none) :
    FractionRun w (decimal w n ++ rest) n w rest := by
  induction w generalizing n with
  | zero =>
    have : n = 0 := by simpa using hn
    subst n
    exact .stop 0 rest hr
  | succ w ih =>
    have hp : 0 < 10 ^ w := Nat.pow_pos (by decide)
    have hi : n / 10 ^ w < 10 := by
      apply (Nat.div_lt_iff_lt_mul hp).2
      simpa [Nat.pow_succ, Nat.mul_comm] using hn
    have hh := FractionRun.digit w (n / 10 ^ w) (n % 10 ^ w) w
      (decimal w (n % 10 ^ w) ++ rest) rest hi (ih _ (Nat.mod_lt _ hp))
    have hn' : n / 10 ^ w * 10 ^ w + n % 10 ^ w = n := by
      simpa [Nat.mul_comm, Nat.add_comm] using Nat.mod_add_div n (10 ^ w)
    rwa [hn'] at hh

/-- No fraction, or a dot followed by one to nine ASCII decimal digits. -/
inductive FractionSpelling : List Char → Nat → List Char → Prop
  | absent (rest : List Char) (h : rest.head? ≠ some '.') : FractionSpelling rest 0 rest
  | present (input rest : List Char) (n count : Nat) (h : count ≠ 0)
      (run : FractionRun 9 input n count rest) : FractionSpelling ('.' :: input) n rest

private theorem readFraction_sound (c r : Cursor) (n : Nat)
    (h : readFraction c = .ok (n, r)) : FractionSpelling c.input n r.input := by
  obtain ⟨input, p⟩ := c
  cases input with
  | nil =>
    simp [readFraction, Pure.pure, Except.pure] at h
    obtain ⟨rfl, rfl⟩ := h
    exact .absent [] (by simp)
  | cons ch tail =>
    by_cases hc : ch = '.'
    · subst ch
      cases hf : fractionDigits 9 ⟨tail, p + 1⟩ with
      | error e => simp [readFraction, hf, Bind.bind, Except.bind] at h
      | ok value =>
        obtain ⟨val, count, next⟩ := value
        by_cases hn : count = 0
        · simp [readFraction, hf, hn, Bind.bind, Except.bind, throw] at h
        · simp [readFraction, hf, hn, Bind.bind, Except.bind, Pure.pure, Except.pure] at h
          obtain ⟨rfl, rfl⟩ := h
          exact .present _ _ _ _ hn (fraction_run_sound _ _ _ _ _ hf)
    · simp [readFraction, hc, Pure.pure, Except.pure] at h
      obtain ⟨rfl, rfl⟩ := h
      exact .absent _ (by simpa)

private theorem readFraction_complete (input : List Char) (n : Nat) (rest : List Char)
    (p : Nat) (h : FractionSpelling input n rest) :
    ∃ q, readFraction ⟨input, p⟩ = .ok (n, ⟨rest, q⟩) := by
  cases h with
  | absent _ hn =>
    refine ⟨p, ?_⟩
    cases input with
    | nil => rfl
    | cons ch tail =>
      have hc : ch ≠ '.' := by simpa using hn
      simp [readFraction, hc, Pure.pure, Except.pure]
  | present input rest n count hn run =>
    exact ⟨p + 1 + count, by
      simp [readFraction, fraction_run_complete _ _ _ _ _ (p + 1) run, hn,
        Bind.bind, Except.bind, Pure.pure, Except.pure]⟩

/-- A UTC designator or a signed pair of two-digit fields with a colon. -/
inductive ZoneSpelling : List Char → Int → List Char → Prop
  | utc (ch : Char) (rest : List Char) (h : ch = 'Z' ∨ ch = 'z') :
      ZoneSpelling (ch :: rest) 0 rest
  | numeric (sign : Char) (h m : Nat) (rest : List Char)
      (hs : sign = '+' ∨ sign = '-') (hh : h < 24) (hm : m < 60) :
      ZoneSpelling (sign :: (decimal 2 h ++ ':' :: (decimal 2 m ++ rest)))
        (if sign = '+' then (h : Int) * 3600 + (m : Int) * 60
         else -((h : Int) * 3600 + (m : Int) * 60)) rest

private theorem readZone_sound (c r : Cursor) (offset : Int)
    (h : readZone c = .ok (offset, r)) : ZoneSpelling c.input offset r.input := by
  obtain ⟨input, p⟩ := c
  cases input with
  | nil => simp [readZone, throw] at h
  | cons ch tail =>
    by_cases hc : ch = 'Z' ∨ ch = 'z'
    · simp [readZone, hc, Pure.pure, Except.pure] at h
      obtain ⟨rfl, rfl⟩ := h
      exact .utc ch tail hc
    · by_cases hs : ch = '+' ∨ ch = '-'
      · simp only [readZone, hc, hs, ite_false, ite_true, bind_ok_iff, Prod.exists,
          readDigits_ok_iff, expect_ok_iff] at h
        obtain ⟨hour, _, ⟨_, ht, _⟩, _, ⟨colon, hcolon, hct, _⟩,
          minute, next, ⟨_, hmt, _⟩, h⟩ := h
        simp only [List.mem_singleton] at hcolon
        change tail = _ at ht
        by_cases hb : hour > 23 ∨ minute > 59
        · simp [hb, Bind.bind, Except.bind, throw] at h
        · simp [hb, Pure.pure, Except.pure] at h
          obtain ⟨rfl, rfl⟩ := h
          rw [ht, hct, hmt, hcolon]
          exact .numeric ch hour minute next.input hs (by omega) (by omega)
      · simp [readZone, hc, hs, throw] at h

private theorem readZone_complete (input : List Char) (offset : Int) (rest : List Char)
    (p : Nat) (h : ZoneSpelling input offset rest) :
    ∃ q, readZone ⟨input, p⟩ = .ok (offset, ⟨rest, q⟩) := by
  cases h with
  | utc ch rest hc =>
    exact ⟨p + 1, by simp [readZone, hc, Pure.pure, Except.pure]⟩
  | numeric sign h m rest hs hh hm =>
    have hn : ¬ (sign = 'Z' ∨ sign = 'z') := by
      rcases hs with rfl | rfl <;> decide
    have hcolon : ':' ∈ [':'] := by decide
    have hh' : h < 10 ^ 2 := by omega
    have hm' : m < 10 ^ 2 := by omega
    have hb : ¬ (h > 23 ∨ m > 59) := by omega
    exact ⟨p + 6, by
      simp [readZone, hn, hs, expect_complete _ _ _ _ _ hcolon,
        readDigits_complete _ 2 _ _ _ hh', readDigits_complete _ 2 _ _ _ hm',
        hb, Bind.bind, Except.bind, Pure.pure, Except.pure]⟩

/-- The accepted text and its UTC meaning, given by the grammar and Gregorian fields. -/
def Denotes (text : List Char) (instant : Int) : Prop :=
  ∃ t : DateTime, ∃ sep suffix remainder fraction offset,
    t.Valid ∧ sep ∈ ['T', 't'] ∧ text = dateTimeText t sep ++ suffix ∧
    FractionSpelling suffix fraction remainder ∧ ZoneSpelling remainder offset [] ∧
    instant = denote t fraction offset

theorem parse_accepts_exactly_grammar (text : List Char) (instant : Int) :
    parse text = .ok instant ↔ Denotes text instant := by
  constructor
  · intro h
    simp only [parse, bind_ok_iff, Prod.exists] at h
    obtain ⟨t, c₁, ht, fraction, c₂, hf, offset, c₃, hz, h⟩ := h
    obtain ⟨hw, sep, hs, hText⟩ := readDateTime_sound _ _ _ ht
    have hEnd : c₃.input = [] := by
      cases he : c₃.input with
      | nil => rfl
      | cons ch tail => simp [he, Bind.bind, Except.bind, throw] at h
    simp only [hEnd, List.isEmpty_nil, Bool.not_true, Bool.false_eq_true, ite_false,
      Pure.pure, Except.pure] at h
    have hValid : validate t = .ok () := by
      cases hv : validate t with
      | ok v => cases v; rfl
      | error e => simp [hv, Bind.bind, Except.bind] at h
    simp [hValid, Bind.bind, Except.bind] at h
    have zone := readZone_sound _ _ _ hz
    rw [hEnd] at zone
    exact ⟨t, sep, c₁.input, c₂.input, fraction, offset,
      (validate_ok_iff t hw.1).mp hValid, hs, hText, readFraction_sound _ _ _ hf, zone, h.symm⟩
  · rintro ⟨t, sep, suffix, remainder, fraction, offset, hv, hs, rfl, hf, hz, rfl⟩
    obtain ⟨p, hp⟩ := readFraction_complete _ _ _ 19 hf
    obtain ⟨q, hq⟩ := readZone_complete _ _ _ p hz
    simp [parse, readDateTime_complete _ _ _ _ (valid_widths t hv) hs, hp, hq,
      (validate_ok_iff t hv.1).mpr hv, Bind.bind, Except.bind, Pure.pure, Except.pure]

theorem equivalent_texts_parse_equal (x y : List Char) (n : Int)
    (hx : Denotes x n) (hy : Denotes y n) : parse x = parse y := by
  rw [(parse_accepts_exactly_grammar x n).mpr hx, (parse_accepts_exactly_grammar y n).mpr hy]

theorem parse_rfc3339_accepts_exactly_grammar (text : String) (n : Int) :
    parseRfc3339 text = .ok n ↔ Denotes text.toList n :=
  parse_accepts_exactly_grammar text.toList n

theorem equivalent_rfc3339_texts_parse_equal (x y : String) (n : Int)
    (hx : Denotes x.toList n) (hy : Denotes y.toList n) :
    parseRfc3339 x = parseRfc3339 y :=
  equivalent_texts_parse_equal x.toList y.toList n hx hy

private theorem canonical_denotes (t : DateTime) (n : Nat)
    (ht : t.Valid) (hn : n < 10 ^ 9) :
    Denotes (dateTimeText t 'T' ++ (if n = 0 then [] else '.' :: decimal 9 n) ++ ['Z'])
      (denote t n 0) := by
  have hs : 'T' ∈ ['T', 't'] := by decide
  have hz : ZoneSpelling ['Z'] 0 [] := .utc 'Z' [] (.inl rfl)
  rw [List.append_assoc]
  by_cases h : n = 0
  · subst n
    exact ⟨t, 'T', ['Z'], ['Z'], 0, 0, ht, hs, rfl, .absent _ (by decide), hz, rfl⟩
  · have hf := fraction_run_decimal 9 n ['Z'] hn (by decide)
    refine ⟨t, 'T', ('.' :: decimal 9 n) ++ ['Z'], ['Z'], n, 0, ht, hs, ?_, ?_, hz, rfl⟩
    · simp [h]
    · exact .present _ _ _ 9 (by decide) hf

def utcYear (instant : Int) : Int :=
  (civilFromDays (instant / nanosPerSecond / secondsPerDay)).1

def Representable (instant : Int) : Prop := 0 ≤ utcYear instant ∧ utcYear instant ≤ 9999

private theorem year_boundary (days year : Int) :
    year ≤ (civilFromDays days).1 ↔ daysFromCivil year 1 1 ≤ days := by
  obtain ⟨y, m, d, hc⟩ : ∃ y m d, civilFromDays days = (y, m, d) := ⟨_, _, _, rfl⟩
  have hv := civil_from_days_valid days
  have hn := days_from_civil_civil_from_days days
  rw [hc] at hv hn ⊢
  change ValidDate y m d at hv
  change daysFromCivil y m d = days at hn
  change year ≤ y ↔ _
  have first : ValidDate year 1 1 := by simp [ValidDate, daysInMonth]
  constructor
  · intro h
    by_cases he : (year, 1, 1) = (y, m, d)
    · simp only [Prod.mk.injEq] at he
      obtain ⟨rfl, rfl, rfl⟩ := he
      omega
    · have hlt : CalendarLt (year, 1, 1) (y, m, d) := by
        have hm := hv.1
        have hd := hv.2.2.1
        simp only [CalendarLt, Prod.mk.injEq] at he ⊢
        omega
      have := days_from_civil_strict_mono year 1 1 y m d first hv hlt
      omega
  · intro h
    by_cases hle : year ≤ y
    · exact hle
    · have hlt : CalendarLt (y, m, d) (year, 1, 1) := Or.inl (by dsimp; omega)
      have := days_from_civil_strict_mono y m d year 1 1 hv first hlt
      omega

theorem representable_iff_nanos (instant : Int) :
    Representable instant ↔ -62167219200000000000 ≤ instant ∧ instant < 253402300800000000000 := by
  have hlo := year_boundary (instant / nanosPerSecond / secondsPerDay) 0
  have hhi := year_boundary (instant / nanosPerSecond / secondsPerDay) 10000
  change 0 ≤ utcYear instant ↔ -719528 ≤ instant / nanosPerSecond / secondsPerDay at hlo
  change 10000 ≤ utcYear instant ↔ 2932897 ≤ instant / nanosPerSecond / secondsPerDay at hhi
  unfold Representable
  unfold nanosPerSecond secondsPerDay at hlo hhi
  omega

theorem format_then_parse (instant : Int) (hin : Representable instant) :
    (formatRfc3339 instant).map parseRfc3339 = .ok (.ok instant) := by
  let secs := instant / nanosPerSecond
  let days := secs / secondsPerDay
  let sod := secs % secondsPerDay
  let fraction := (instant % nanosPerSecond).toNat
  obtain ⟨y, m, d, hc⟩ : ∃ y m d, civilFromDays days = (y, m, d) := by
    exact ⟨_, _, _, rfl⟩
  have hc' : civilFromDays (instant / nanosPerSecond / secondsPerDay) = (y, m, d) := hc
  have hy : 0 ≤ y ∧ y ≤ 9999 := by
    simpa only [Representable, utcYear, hc', Prod.fst] using hin
  have hd := civil_from_days_valid days
  have hn := days_from_civil_civil_from_days days
  rw [hc] at hd hn
  change ValidDate y m d at hd
  change daysFromCivil y m d = days at hn
  let t : DateTime := ⟨y.toNat, m.toNat, d.toNat, (sod / 3600).toNat,
    (sod % 3600 / 60).toNat, (sod % 60).toNat⟩
  have hsod : 0 ≤ sod ∧ sod < 86400 := by dsimp [sod, secondsPerDay]; omega
  have hfr : fraction < 10 ^ 9 := by dsimp [fraction, nanosPerSecond]; omega
  have ey : (y.toNat : Int) = y := Int.toNat_of_nonneg hy.1
  have em : (m.toNat : Int) = m := Int.toNat_of_nonneg (by have := hd.1; omega)
  have ed : (d.toNat : Int) = d := Int.toNat_of_nonneg (by have := hd.2.2.1; omega)
  have ht : t.Valid := by
    refine ⟨by dsimp [t]; omega, ?_, ?_, ?_, ?_⟩
    · simpa only [t, ey, em, ed] using hd
    · dsimp [t]; omega
    · dsimp [t]; omega
    · dsimp [t]; omega
  have hInstant : denote t fraction 0 = instant := by
    unfold denote
    dsimp only [t]
    rw [ey, em, ed, hn]
    dsimp [days, fraction, secs, sod, nanosPerSecond, secondsPerDay]
    omega
  have hp := (parse_accepts_exactly_grammar _ _).mpr (canonical_denotes t fraction ht hfr)
  rw [hInstant] at hp
  have hformat : format instant =
      .ok (dateTimeText t 'T' ++ (if fraction = 0 then [] else '.' :: decimal 9 fraction) ++ ['Z']) := by
    simp [format, hc', hy, t, sod, secs, fraction]
  simpa [formatRfc3339, hformat, parseRfc3339, Except.map] using
    congrArg (Except.ok (ε := Int)) hp

theorem parsed_in_range_formats (text : String) (n : Int)
    (h : parseRfc3339 text = .ok n) (hin : Representable n) :
    ∃ canonical, formatRfc3339 n = .ok canonical ∧ parseRfc3339 canonical = parseRfc3339 text := by
  have hr := format_then_parse n hin
  cases hf : formatRfc3339 n with
  | error e => simp [hf, Except.map] at hr
  | ok canonical => exact ⟨canonical, rfl, by simpa [hf, Except.map, h] using hr⟩

theorem format_error_iff (instant year : Int) :
    formatRfc3339 instant = .error year ↔
      ¬ Representable instant ∧ year = utcYear instant := by
  let days := instant / nanosPerSecond / secondsPerDay
  obtain ⟨y, m, d, hc⟩ : ∃ y m d, civilFromDays days = (y, m, d) := by
    exact ⟨_, _, _, rfl⟩
  have hc' : civilFromDays (instant / nanosPerSecond / secondsPerDay) = (y, m, d) := hc
  by_cases h : 0 ≤ y ∧ y ≤ 9999 <;>
    simp [formatRfc3339, format, Representable, utcYear, hc', h, Except.map, eq_comm]

theorem offset_crosses_below_four_digit_utc_year :
    parseRfc3339 "0000-01-01T00:00:00+00:01" = .ok (-62167219260000000000) ∧
    formatRfc3339 (-62167219260000000000) = .error (-1) := by constructor <;> rfl

theorem offset_crosses_above_four_digit_utc_year :
    parseRfc3339 "9999-12-31T23:59:59-00:01" = .ok 253402300859000000000 ∧
    formatRfc3339 253402300859000000000 = .error 10000 := by constructor <;> rfl

theorem leap_second_refused :
    parseRfc3339 "2016-12-31T23:59:60Z" = .error ⟨17, "second 00-59"⟩ := by rfl

end RfcTime
