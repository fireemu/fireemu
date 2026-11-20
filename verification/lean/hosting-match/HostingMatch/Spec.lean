import Std

namespace HostingMatch

structure Rule where
  glob : String := ""
  source : String := ""
  regexLiteral : String := ""
  deriving Repr, DecidableEq

/-- Interior slash runs collapse; leading and trailing empty components are retained. -/
def components (text : String) : List String :=
  match text.splitOn "/" with
  | [] => []
  | first :: rest =>
    match rest.reverse with
    | [] => [first]
    | last :: middle => first :: ((middle.reverse.filter (! ·.isEmpty)) ++ [last])

/-- A literal or an entire-component asterisk. The latter can consume an empty component in
the production matching profile. -/
def segment (prod : Bool) (pattern value : String) : Bool :=
  if !prod && value.startsWith "." && !pattern.startsWith "." then false
  else if pattern == "*" then prod || !value.isEmpty
  else pattern == value

def matchComponents (prod : Bool) : List String → List String → Bool
  | [], parts => parts == [] || parts == [""]
  | pattern :: tail, parts =>
    if pattern == "**" then
      let prefixLen := (parts.takeWhile (fun value => prod || !value.startsWith ".")).length
      (List.range (prefixLen + 1)).any (fun n => matchComponents prod tail (parts.drop n))
    else
      match parts with
      | [] => false
      | value :: rest => segment prod pattern value && matchComponents prod tail rest

def glob (prod : Bool) (pattern path : String) : Bool :=
  if pattern.isEmpty || pattern.startsWith "#" then false
  else
    let negations := (pattern.toList.takeWhile (· == '!')).length
    let core := String.ofList (pattern.toList.drop negations)
    matchComponents prod (components core) (components path) != (negations % 2 == 1)

/-- Anchored literal regexes are represented by their literal body. -/
def admitsRule (prod : Bool) (rule : Rule) (path : String) : Bool :=
  if !rule.glob.isEmpty then glob prod rule.glob path
  else if !rule.source.isEmpty then glob prod rule.source path
  else !rule.regexLiteral.isEmpty && rule.regexLiteral == path

def firstIndex (p : α → Bool) : List α → Option Nat
  | [] => none
  | x :: rest => if p x then some 0 else (firstIndex p rest).map Nat.succ

def firstRule (prod : Bool) (path : String) (rules : List Rule) : Option Nat :=
  firstIndex (fun rule => admitsRule prod rule path) rules

end HostingMatch
