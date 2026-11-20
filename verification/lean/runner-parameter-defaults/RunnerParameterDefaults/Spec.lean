import Std

namespace RunnerParameterDefaults

abbrev Env := List (String × String)

def lookup (env : Env) (name : String) : Option String :=
  (env.find? (fun entry => entry.1 == name)).map Prod.snd

/-- Static defaults are their serialized values. References read the environment accumulated so far. -/
inductive Default where
  | absent
  | unsupported
  | thrown
  | serialized (text : String)
  | reference (name : String)
  deriving Repr

def Default.evaluate (env : Env) : Default → Option String
  | .serialized text => some text
  | .reference name => lookup env name
  | .absent | .unsupported | .thrown => none

structure Declaration where
  name : String
  secret : Bool := false
  value : Default := .absent
  deriving Repr

structure Result where
  env : Env
  missing : List String := []
  assigned : List String := []
  evaluated : List String := []
  deriving Repr, DecidableEq

def step (result : Result) (decl : Declaration) : Result :=
  if decl.name.isEmpty || decl.secret || (lookup result.env decl.name).isSome then result
  else
    let evaluated := result.evaluated ++ [decl.name]
    match decl.value.evaluate result.env with
    | none => { result with missing := result.missing ++ [decl.name], evaluated }
    | some text =>
      { result with env := (decl.name, text) :: result.env,
                    assigned := result.assigned ++ [decl.name], evaluated }

def run (env : Env) (declarations : List Declaration) : Result :=
  declarations.foldl step { env }

end RunnerParameterDefaults
