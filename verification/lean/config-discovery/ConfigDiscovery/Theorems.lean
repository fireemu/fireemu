import ConfigDiscovery.Spec

namespace ConfigDiscovery

theorem working_directory_refuses_every_candidate (tree : Tree)
    (unsafeDirectory : tree.workingWritable = true) :
    discover tree = .skip "/suite/near/work" := by
  simp [discover, unsafeDirectory]

theorem two_local_canonical_files_are_ambiguous (tree : Tree)
    (safe : tree.workingWritable = false) (toml : tree.toml.present = true)
    (json : tree.json.present = true) : discover tree = .ambiguous := by
  simp [discover, safe, toml, json]

theorem working_canonical_precedes_firebase (tree : Tree)
    (safe : tree.workingWritable = false) (toml : tree.toml.present = true)
    (json : tree.json.present = false) :
    discover tree = conclude true "fireemu.toml" tree.toml := by
  simp [discover, safe, toml, json]

theorem nearest_trusted_firebase_is_chosen (tree : Tree)
    (safe : tree.workingWritable = false) (toml : tree.toml.present = false)
    (json : tree.json.present = false) (localAbsent : tree.localFirebase.present = false)
    (nearPresent : tree.nearFirebase.present = true) (nearSafe : tree.nearWritable = false) :
    discover tree = conclude false "/suite/near/firebase.json" tree.nearFirebase := by
  simp [discover, safe, toml, json, localAbsent, nearPresent, nearSafe]

end ConfigDiscovery
