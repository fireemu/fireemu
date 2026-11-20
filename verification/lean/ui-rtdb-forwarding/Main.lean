import UiRtdbForwarding

open UIR

def endpoint : Endpoint :=
  ⟨"demo-app", [("named", "demo-app"), ("named-other", "other"),
    ("overridden-default-rtdb", "demo-app")]⟩

def sessions : Params := [("default", "demo-app")]

def baseQuery : String := "session=default&project=demo-app"
def named : String := baseQuery ++ "&namespace=named"

def targets : List (String × String) :=
  [("bare", baseQuery), ("named", named),
    ("scoped", named ++ "&path=%2Fnotes%2F%E6%97%A5%252F&query=orderBy%3D%2522%2524key%2522%26limitToFirst%3D2"),
    ("foreign", baseQuery ++ "&namespace=named-other"),
    ("badPath", named ++ "&path=%2Fnotes%2F%2Ftoday"),
    ("rulesPath", named ++ "&path=%2Fnotes"),
    ("malformedQuery", named ++ "&query=%2"),
    ("unsupportedQuery", named ++ "&query=projection%3D1"),
    ("badSession", "session=expired&project=demo-app&namespace=named")]

def methods : List String := ["GET", "PUT", "PATCH", "DELETE", "POST"]
def bodies : List (String × Nat) := [("empty", 0), ("present", 4), ("tooLarge", maxBody + 1)]

def row (labels : List String) (input : Input) : String :=
  let result := match prepare endpoint sessions input with
    | .ok plan => ["ok", plan.session, plan.project, plan.databaseName.getD "-", plan.target,
      toString plan.administrator]
    | .error e => ["err", toString e.code, e.message]
  String.intercalate "\t" (["route"] ++ labels ++ [input.query] ++ result)

def matrix : List String :=
  (actionKeys ++ ["unknown"]).flatMap fun action =>
    methods.flatMap fun method =>
      bodies.flatMap fun (body, size) =>
        targets.map fun (target, query) => row [action, method, body, target]
          ⟨action, method, query, size⟩

def querySpecial : List String :=
  [ "project=demo-app", "session=default", baseQuery ++ "&extra=ok",
    named ++ "&path=%FF", named ++ "&path=%00", named ++ "&p%61th=a&path=b",
    named ++ "&path=white%20space%2Bword", named ++ "&path=%2Fnotes%23todo",
    named ++ "&query=orderBy%3D1%26orderBy%3D2",
    named ++ "&query=print%3Dpretty%26shallow%3Dtrue",
    named ++ "&query=orderBy%3D%25FF", named ++ "&query=orderBy%3D%252",
    named ++ "&query=print%3Da%2Bb",
    baseQuery ++ "&namespace=overridden-default-rtdb",
    baseQuery ++ "&namespace=other-default-rtdb",
    baseQuery ++ "&namespace=UPPER", baseQuery ++ "&namespace=7--", named ++ "&path=x%26y"
  ]

def endpointRows : List String :=
  let binding := [("0.0.0.0:19000", false, 19000), ("[::]:19000", true, 19000),
    ("127.0.0.1:12345", false, 12345), ("[::1]:12345", true, 12345)]
  let loopbackRows := binding.map fun (address, v6, port) =>
    String.intercalate "\t" ["loopback", address, loopback v6 port]
  let instances := ["named", "named-other", "unknown", "demo-app-default-rtdb",
    "other-default-rtdb", "overridden-default-rtdb", "-default-rtdb"]
  let ownerRows := instances.map fun name =>
    String.intercalate "\t" ["owner", name, projectOf endpoint.configured endpoint.daemon name]
  loopbackRows ++ ownerRows

def main : IO Unit := do
  let extras := querySpecial.map (fun query =>
    row ["data", "GET", "empty", "curated"] ⟨"data", "GET", query, 0⟩)
  let rows := matrix ++ extras ++ endpointRows
  IO.println s!"# {rows.length} cases"
  rows.forM IO.println
