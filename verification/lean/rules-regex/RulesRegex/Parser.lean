import RulesRegex.Spec

namespace RR

def literal (c : Char) : RE := .atom (· == c)
def dot : RE := .atom (· != '\n')

/-- Quoted punctuation and space are literals in the scoped grammar. -/
def quoted (c : Char) : Bool :=
  c == ' ' || ('!' ≤ c && c ≤ '/') || (':' ≤ c && c ≤ '@') ||
  ('[' ≤ c && c ≤ '`') || ('{' ≤ c && c ≤ '~')

def member : Word → Option (Char × Word)
  | '\\' :: c :: rest => if quoted c then some (c, rest) else none
  | '\\' :: [] | [] => none
  | c :: rest => some (c, rest)

/-- The first closing bracket is a member. A final hyphen is a literal. -/
def classRanges : Nat → Word → List (Char × Char) → Option (List (Char × Char) × Word)
  | 0, _, _ => none
  | fuel+1, cs, ranges => do
    if let ']' :: rest := cs then
      if !ranges.isEmpty then return (ranges, rest)
    let (lo, rest) ← member cs
    if let '-' :: hi :: tail := rest then
      if hi != ']' then
        let (endChar, tail) ← member (hi :: tail)
        guard (lo ≤ endChar)
        return ← classRanges fuel tail ((lo, endChar) :: ranges)
    classRanges fuel rest ((lo, lo) :: ranges)

def decimal (cs : Word) : Word × Word := cs.span Char.isDigit

def validBounds (lo : Nat) (hi : Option Nat) : Bool :=
  lo ≤ 1000 && hi.all (fun n => lo ≤ n && n ≤ 1000)

def repeatBounds (cs : Word) : Option (Nat × Option Nat × Word) := do
  let (digits, rest) := decimal cs
  let lo ← (String.ofList digits).toNat?
  let (hi, rest) ← match rest with
    | ',' :: tail => do
      let (more, rest) := decimal tail
      pure ((String.ofList more).toNat?, rest)
    | rest => pure (some lo, rest)
  let '}' :: rest := rest | none
  guard (validBounds lo hi)
  return (lo, hi, rest)

def quantify (r : RE) (cs : Word) : Option (RE × Word) := do
  let (lo, hi, rest) ← match cs with
    | '*' :: rest => pure (0, none, rest)
    | '+' :: rest => pure (1, none, rest)
    | '?' :: rest => pure (0, some 1, rest)
    | '{' :: d :: rest => if d.isDigit then repeatBounds (d :: rest) else return (r, cs)
    | _ => return (r, cs)
  let rest := match rest with | '?' :: tail => tail | other => other
  return (expand r lo hi, rest)

/-- Each group saves the completed alternatives and the current concatenation. -/
structure Frame where
  branches : RE := .zero
  branch : RE := .eps

def Frame.finish (f : Frame) := join f.branches f.branch

/-- One unit of fuel per parser iteration. Every recursive call consumes at least one source character. -/
def parse : Nat → Word → Frame → List Frame → Option RE
  | 0, _, _, _ => none
  | _+1, [], f, stack => if stack.isEmpty then some f.finish else none
  | fuel+1, c :: cs, f, stack => do
    if c == '(' then
      guard (stack.length < 8)
      return ← parse fuel cs {} (f :: stack)
    if c == '|' then
      return ← parse fuel cs { branches := f.finish } stack
    let (r, rest, frame, parents) ← match c with
      | ')' => do
        let parent :: parents := stack | none
        pure (f.finish, cs, parent, parents)
      | '[' => do
        let (neg, body) := match cs with | '^' :: tail => (true, tail) | _ => (false, cs)
        let (ranges, rest) ← classRanges (body.length + 1) body []
        let cls := RE.atom fun x => ranges.any (fun (lo, hi) => lo ≤ x && x ≤ hi) != neg
        pure (cls, rest, f, stack)
      | '\\' => do
        let d :: rest := cs | none
        guard (quoted d)
        pure (literal d, rest, f, stack)
      | '*' | '+' | '?' | '^' | '$' => none
      | _ => pure (if c == '.' then dot else literal c, cs, f, stack)
    let (q, rest) ← quantify r rest
    parse fuel rest { frame with branch := cat frame.branch q } parents

/-- The separate nesting scan keeps its first-member flag across each leading caret.
Its unmatched closing-parenthesis decrement saturates at zero. -/
def nestingOK : Word → Nat → Bool → Bool → Bool
  | [], _, _, _ => true
  | '\\' :: _ :: rest, depth, inside, _ => nestingOK rest depth inside false
  | c :: cs, depth, inside, first =>
    if inside then
      if first && c == '^' then nestingOK cs depth true true
      else nestingOK cs depth (first || c != ']') false
    else if c == '(' then depth < 8 && nestingOK cs (depth + 1) false false
    else if c == ')' then nestingOK cs (depth - 1) false false
    else nestingOK cs depth (c == '[') (c == '[')

def compile (source : String) : Option RE :=
  if source.utf8ByteSize ≤ 2048 && nestingOK source.toList 0 false false then
    parse (source.length + 1) source.toList {} []
  else none

theorem compile_of_guards (s : String) (size : s.utf8ByteSize ≤ 2048)
    (depth : nestingOK s.toList 0 false false = true) :
    compile s = parse (s.length + 1) s.toList {} [] := by simp [compile, size, depth]

/-- A repeated caret can put the preflight scan and class parser at different brackets. -/
theorem class_preflight_refusal :
    let cs := ['[', '^', '^', ']', '[', ']'] ++ List.replicate 9 '(' ++ [']']
    nestingOK cs 0 false false = false ∧ (parse (cs.length + 1) cs {} []).isSome = true := by
  decide

/-- At the parser boundary an inverted range is refused before natural subtraction in expand. -/
theorem inverted_bounds_refused :
    validBounds 2 (some 1) = false ∧
    «matches» (expand (literal 'a') 2 (some 1)) ['a', 'a'] = true := by decide

end RR
