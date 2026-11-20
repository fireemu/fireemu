import AdapterTerminalPolicy

def main : IO Unit := do
  IO.println "# optOut|force|disable|os|tty|capability|color"
  for optOut in ["unset", "empty", "set"] do
    for force in ["none", "off", "cli", "force"] do
      for disable in ["none", "dumb", "zero"] do
        for os in ["posix", "windows"] do
          for tty in ["no", "yes"] do
            for hint in ["none", "term", "ansi", "conemu-on", "conemu-off"] do
              let ctx : AT.Context :=
                ⟨optOut == "set", force == "cli" || force == "force", disable != "none",
                  tty == "yes", os == "windows", ["term", "ansi", "conemu-on"].contains hint⟩
              IO.println s!"{optOut}|{force}|{disable}|{os}|{tty}|{hint}|{AT.color ctx}"
