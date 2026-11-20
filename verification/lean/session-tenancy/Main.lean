import SessionTenancy

open ST

def main : IO Unit := do
  IO.println "# baseline|keyPolicy|proposal|result|after|removed|afterRemoval"
  for (baseLabel, registrations) in baselines do
    for (keyLabel, keys) in keyPolicies do
      let initial : ST.State := ⟨"demo-default", keys, registrations⟩
      for (proposalLabel, proposal) in proposals do
        let (result, after) := register initial proposal
        let (removed, afterRemoval) := unregister after proposal.name
        IO.println s!"{baseLabel}|{keyLabel}|{proposalLabel}|{result.getD "accepted"}|{snapshot after}|{removed}|{snapshot afterRemoval}"
