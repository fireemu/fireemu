import FirestoreEdition

def capability : FE.Capability → String
  | .unsupported => "unsupported"
  | .preview => "preview"

def result : Except FE.Error FE.Flags → String
  | .error .invalidCombination => "invalid-combination"
  | .error .catalogMismatch => "catalog-mismatch"
  | .ok f => s!"ok:{f.core}:{f.pipeline}:{capability f.text}:{capability f.geospatial}"

def main : IO Unit := do
  IO.println "# edition|api|catalog|result"
  for edition in [FE.Edition.standard, .enterprise] do
    for api in [FE.API.native, .mongo] do
      for catalog in ["firestore-standard-v1", "firestore-enterprise-v1",
          "unrelated", "firestore-standardx-enterprise-v1"] do
        IO.println s!"{edition.label}|{api.label}|{catalog}|{result (FE.admit edition api catalog)}"
