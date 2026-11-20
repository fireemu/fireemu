import RulesRegex

/-!
The count header is followed by three tab-separated fields per case:
`match|miss|refuse`, pattern UTF-8 hex, subject UTF-8 hex. Empty fields encode empty strings.
Refusal concerns compilation and is independent of the subject.
-/

open RR

def hex (s : String) := String.ofList <| s.toUTF8.data.toList.flatMap fun b =>
  let digits := "0123456789abcdef".toList
  [digits[b.toNat / 16]!, digits[b.toNat % 16]!]

def times (n : Nat) (c : Char) := String.ofList (List.replicate n c)

/-- Each accepted source carries a positive witness and a negative one edit away.
The printer checks both before publishing any rows. -/
def examples : List (String × String × String) :=
  let thousand := times 1000 'a'
  let limitClass := "[" ++ times 1023 'é' ++ "]"
  [("", "", "a"), ("a", "a", "b"), ("é", "é", "e"), ("🦀", "🦀", ""),
   (".", "🦀", "\n"), ("[ab]", "b", "c"), ("[a-cx-z]", "b", "d"),
   ("[^a-c]", "\n", "a"), ("[α-γ]", "β", "δ"), ("[]-]", "]", "a"),
   ("ab", "ab", "b"), ("a|bc", "bc", "b"), ("(a)", "a", ""),
   ("a*", "aa", "ab"), ("a+", "aa", "ab"), ("a?", "", "b"),
   ("a{2}", "aa", "a"), ("a{2,}", "aaa", "aba"), ("a{2,3}", "aaa", "aaaa"),
   ("|", "", "a"), ("|a", "a", "b"), ("a|", "", "b"), ("a||b", "", "c"),
   ("(a*)*", "aaa", "aba"), ("(a|aa)*", "aaaa", "aaba"),
   ("((.)b)+", "éb", "éa"), ("(([a-c]|[^x])b)?", "ab", "ax"),
   ("((ab)*)+", "abab", "aba"), ("((a?)b){2}", "abb", "ab"),
   ("((a|)b){1,}", "bb", "bc"), ("((ab){1,2})?", "abab", "aba"),
   ("(a*){2}", "", "b"), ("(){2,}", "", "a"), ("(a|b)c", "bc", "b"),
   ("a{0}", "", "a"), ("a{0,}", "a", "b"), ("a{0,0}", "", "a"),
   ("a{1}", "a", ""), ("a{1,}", "a", ""), ("a{1,1}", "a", "aa"),
   ("a{1000}", thousand, thousand ++ "a"), ("a{1000,}", thousand, times 999 'a'),
   ("a{999,1000}", thousand, thousand ++ "a"), ("a{0,1000}", thousand, thousand ++ "a"),
   ("a{b}", "a{b}", "a{}"), ("{2}", "{2}", "{}"), ("a\\*", "a*", "aa"),
   ("((((((((a))))))))", "a", "b"), ("[^^][]" ++ times 8 '(' ++ "]", "a(", "^("),
   ("[^^][]" ++ times 9 '(' ++ "]", "a(", "^("), (limitClass, "é", "e")]

def refused : List String :=
  ["*", "+a", "a**", "[", "[]", "[z-a]", "(", "a)", "(?=a)", "\\1",
   "a{1", "a{2,1}", "a{1001}", "a{1001,}", "a{0,1001}", "a{18446744073709551616}",
   "(((((((((a)))))))))", "[" ++ times 1023 'é' ++ "a]"]

def main : IO Unit := do
  let probes := ["", "a", "b", "aa", "ab", "aaa", "é", "🦀", "\n", "\r", times 64 'x']
  let mut rows := #[]
  for (source, yes, no) in examples do
    let some r := compile source | throw (IO.userError s!"unexpected refusal: {source}")
    unless RR.matches r yes.toList && !RR.matches r no.toList do
      throw (IO.userError s!"invalid witness pair for {source}")
    for text in (yes :: no :: probes).eraseDups do
      let verdict := if RR.matches r text.toList then "match" else "miss"
      rows := rows.push s!"{verdict}\t{hex source}\t{hex text}"
  for source in refused do
    if (compile source).isSome then throw (IO.userError s!"expected refusal: {source}")
    for text in probes do
      rows := rows.push s!"refuse\t{hex source}\t{hex text}"
  IO.println s!"# {rows.size} cases"
  for row in rows do IO.println row
