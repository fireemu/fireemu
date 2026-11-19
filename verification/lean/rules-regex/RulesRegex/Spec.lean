namespace RR

abbrev Word := List Char
abbrev Language := Word → Prop

def Cat (P Q : Language) (w : Word) := ∃ u v, w = u ++ v ∧ P u ∧ Q v

/-- Empty factors can be dropped from any finite star factorization. -/
inductive Star (P : Language) : Language where
  | nil : Star P []
  | cons : P (c :: u) → Star P v → Star P ((c :: u) ++ v)

inductive RE where
  | zero | eps | atom (accepts : Char → Bool)
  | alt (p q : RE) | seq (p q : RE) | star (p : RE)

def lang : RE → Language
  | .zero => fun _ => False
  | .eps => fun w => w = []
  | .atom f => fun w => ∃ c, w = [c] ∧ f c = true
  | .alt p q => fun w => lang p w ∨ lang q w
  | .seq p q => Cat (lang p) (lang q)
  | .star p => Star (lang p)

def nullable : RE → Bool
  | .zero | .atom _ => false
  | .eps | .star _ => true
  | .alt p q => nullable p || nullable q
  | .seq p q => nullable p && nullable q

/-- Simplify the left operand to avoid carrying dead branches across derivatives. -/
def join : RE → RE → RE
  | .zero, q => q
  | p, q => .alt p q

def cat : RE → RE → RE
  | .zero, _ => .zero
  | .eps, q => q
  | p, q => .seq p q

def deriv (c : Char) : RE → RE
  | .zero | .eps => .zero
  | .atom f => if f c then .eps else .zero
  | .alt p q => join (deriv c p) (deriv c q)
  | .seq p q =>
    let left := cat (deriv c p) q
    if nullable p then join left (deriv c q) else left
  | .star p => cat (deriv c p) (.star p)

/-- Count the actual recursive derivative transitions. -/
def run (r : RE) : Word → RE × Nat
  | [] => (r, 0)
  | c :: w => let (q, n) := run (deriv c r) w; (q, n + 1)

def «matches» (r : RE) (w : Word) := nullable (run r w).1

/-- Prepend exactly n factors to a tail expression. -/
def copies (r : RE) : Nat → RE → RE
  | 0, tail => tail
  | n+1, tail => .seq r (copies r n tail)

/-- Up to n factors, with the empty alternative at each level. -/
def optionalCopies (r : RE) : Nat → RE
  | 0 => .eps
  | n+1 => .alt .eps (.seq r (optionalCopies r n))

def expand (r : RE) (lo : Nat) (hi : Option Nat) : RE :=
  copies r lo (hi.elim (.star r) (fun n => optionalCopies r (n - lo)))

end RR
