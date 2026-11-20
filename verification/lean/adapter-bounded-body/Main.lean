import AdapterBoundedBody

open AB

def fixture (a b : Nat) (layout : String) : List (String × Frame) :=
  let first := (s!"a{a}", Frame.data (List.replicate a 'a'))
  let second := (s!"b{b}", Frame.data (List.replicate b 'b'))
  let trailers := ("t", Frame.trailers)
  let refused := ("e", Frame.transportError)
  match layout with
  | "plain" => [first, second]
  | "trail-first" => [trailers, first, second]
  | "trail-middle" => [first, trailers, second]
  | "error-first" => [refused, first, second]
  | "error-middle" => [first, refused, second]
  | _ => [first, second, refused]

def main : IO Unit := do
  IO.println "# budget|first|second|layout|frames|result|reads"
  for budget in [0, 1, 2, 5, 6] do
    for first in [0, 1, 2, 3, 6] do
      for second in [0, 1, 2, 3, 6] do
        for layout in ["plain", "trail-first", "trail-middle", "error-first", "error-middle", "error-last"] do
          let frames := fixture first second layout
          let (result, reads) := collect (frames.map Prod.snd) budget
          let output := match result with
            | .ok bytes => "ok:" ++ String.ofList bytes
            | .error .large => "large"
            | .error .read => "read"
          let input := String.intercalate "," (frames.map Prod.fst)
          IO.println s!"{budget}|{first}|{second}|{layout}|{input}|{output}|{reads}"
