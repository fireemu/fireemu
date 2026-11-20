import AdapterAcceptBackoff

open AA

def render : Classification → String
  | .connection => "connection"
  | .resources => "resources"
  | .fatal => "fatal"

def main : IO Unit := do
  IO.println "# tag|input|result"
  for kind in ["aborted", "reset", "refused", "interrupted", "down", "network", "host",
      "memory", "blocked", "permission", "other"] do
    IO.println s!"error|{kind}|{render (portable kind)}"
  for n in List.range 65 ++ [2147483648, 4294967295] do
    IO.println s!"delay|{n}|{backoff n}"
