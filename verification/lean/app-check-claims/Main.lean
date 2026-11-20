import AppCheckClaims

open AppCheckClaims

private def instants : List (String × Int) :=
  [ ("minimum", -(2 ^ 127)), ("below", i64Min * second - 1),
    ("first", i64Min * second), ("before_epoch", -1), ("epoch", 0),
    ("second_edge", second - 1), ("second", second), ("ordinary", 1788004860123456789),
    ("max_minus", (i64Max - 1) * second + 123), ("last", (i64Max + 1) * second - 1),
    ("above", (i64Max + 1) * second), ("maximum", 2 ^ 127 - 1) ]

private def ttls : List (String × Int) :=
  [("min", i64Min), ("negative", -10), ("zero", 0), ("one", 1),
    ("configured_min", 1800), ("default", 3600), ("configured_max", 604800), ("max", i64Max)]

private def apps : List (String × App) :=
  [("first", ⟨"demo-first", "42", "app-alpha", 0x10⟩),
    ("second", ⟨"demo-second", "123456789", "app-beta", 2 ^ 128 - 1⟩)]

private def credentials : List (String × String × Credential) :=
  [("bypass", "none", .bypass), ("missing", "none", .missing),
    ("valid", "none", .valid "app-alpha")] ++
  (["malformed", "algorithm", "key", "signature", "future", "expired",
    "issuer", "audience", "unknown_app", "disabled", "project", "epoch"].map
      fun detail => ("invalid", detail, .invalid detail))

def main : IO Unit := do
  let mut rows := #[]
  for (timeName, instant) in instants do
    for (ttlName, ttl) in ttls do
      for (appName, app) in apps do
        let iat := unixSeconds instant
        let exp := expiry iat ttl
        let lifetime := reportedLifetime iat exp
        let audience := " ".intercalate (audiences app)
        rows := rows.push s!"issue {timeName} {ttlName} {appName} {instant} {ttl} {iat} {exp} {lifetime} {issuer app} {audience} {app.id} {epochText app.epoch}"
  let modes : List (String × Mode) := [("off", .off), ("unenforced", .unenforced), ("enforced", .enforced)]
  for (modeName, mode) in modes do
    for (shape, detail, credential) in credentials do
      let refused := denial mode credential
      let allowed := if refused.isSome then "no" else "yes"
      let reason := match refused with
        | .none => "-"
        | .some .required => "APP_CHECK_REQUIRED"
        | .some .invalid => "APP_CHECK_INVALID"
      let visible := if (exposedIdentity mode credential).isSome then "yes" else "no"
      rows := rows.push s!"admission {modeName} {shape} {detail} {allowed} {reason} {visible}"
  for ttl in [i64Min, 0, 1799, 1800, 3600, 604799, 604800, 604801, i64Max] do
    let result := if validConfiguredTtl ttl then "accepted" else "invalid"
    rows := rows.push s!"config {ttl} {result}"
  IO.println s!"# cases {rows.size}"
  for row in rows do IO.println row
