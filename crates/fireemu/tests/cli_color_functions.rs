//! Colour in the Functions log lines on the terminal: the level decides the style, a function's own
//! escape sequences pass through, and the text underneath is the same either way.
//!
//! A real Node runner serves a small codebase, so the test needs the pinned conformance install
//! (`firebase-functions`) and is skipped without it.

mod scratch;

#[cfg(unix)]
#[path = "../../../tests/support/real_node.rs"]
mod real_node;

#[cfg(unix)]
mod functions_logs {
    use std::path::{Path, PathBuf};
    use std::process::{Command, Output, Stdio};

    use super::{real_node, scratch};

    const USER_COLOUR: &str = "\x1b[35muser colour\x1b[0m";

    fn sdk_modules() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../conformance/node_modules")
    }

    fn codebase(dir: &Path) {
        std::fs::write(
            dir.join("package.json"),
            r#"{"name":"c","main":"index.js"}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("index.js"),
            r#"const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
exports.hello = onRequest((req, res) => {
  logger.info("logger info line");
  logger.warn("logger warn line");
  logger.error("logger error line");
  logger.debug("logger debug line");
  console.log("\u001b[35muser colour\u001b[0m");
  res.send("ok");
});
"#,
        )
        .unwrap();
        std::os::unix::fs::symlink(
            std::fs::canonicalize(sdk_modules()).unwrap(),
            dir.join("node_modules"),
        )
        .unwrap();
    }

    fn run(source: &Path, force: bool) -> Output {
        let mut command = Command::new(env!("CARGO_BIN_EXE_fireemu"));
        real_node::use_real_node(&mut command);
        command
            .args([
                "exec",
                "--no-config-discovery",
                "--project",
                "demo-color",
                "--only",
                "functions",
                "--http-port",
                "0",
                "--functions-port",
                "0",
                "--hub-port",
                "0",
                "--logging-port",
                "0",
                "--ui-port",
                "0",
                "--functions",
                &source.display().to_string(),
                "--",
                "/bin/sh",
                "-c",
                "curl -s -m 20 \"http://$FIREEMU_FUNCTIONS_HOST/demo-color/us-central1/hello\" >/dev/null; sleep 1",
            ])
            .stdin(Stdio::null())
            .env("TERM", "xterm");
        for name in ["NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE", "FORCE_COLOR"] {
            command.env_remove(name);
        }
        if force {
            command.env("CLICOLOR_FORCE", "1");
        }
        command.output().unwrap()
    }

    fn strip_ansi(text: &str) -> String {
        let mut out = String::new();
        let mut chars = text.chars();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                for next in chars.by_ref() {
                    if next == 'm' {
                        break;
                    }
                }
            } else {
                out.push(c);
            }
        }
        out
    }

    fn function_lines(stderr: &[u8]) -> Vec<String> {
        // Sorted: the runner's stdout frames and its stderr lines are read by two tasks.
        let mut lines: Vec<String> = String::from_utf8(stderr.to_vec())
            .unwrap()
            .lines()
            .filter(|line| {
                // The log lines of the function only: the runner's own lifecycle lines at
                // shutdown race with the end of the command.
                let plain = strip_ansi(line);
                ["info", "warning", "error", "debug"]
                    .iter()
                    .any(|level| plain.starts_with(&format!("[functions:node] {level} ")))
            })
            .map(strip_ansi)
            .collect();
        lines.sort();
        lines
    }

    #[test]
    fn function_logs_are_coloured_by_level_only_when_forced() {
        if !sdk_modules().join("firebase-functions").exists() {
            eprintln!("skipped: conformance/node_modules is not installed");
            return;
        }
        let dir = scratch::Scratch::new("cli-color-fn", "logs");
        codebase(&dir);
        let plain = run(&dir, false);
        let stderr = String::from_utf8(plain.stderr.clone()).unwrap();
        // Off a terminal the bytes are what they were: no sequence but the function's own.
        assert_eq!(
            stderr.matches('\x1b').count(),
            USER_COLOUR.matches('\x1b').count(),
            "{stderr}"
        );
        assert!(
            stderr.contains(&format!("[functions:node] info {USER_COLOUR}\n")),
            "{stderr}"
        );
        assert!(
            stderr.contains("[functions:node] warning logger warn line\n"),
            "{stderr}"
        );
        assert!(
            stderr.contains("[functions:node] error Error: logger error line"),
            "{stderr}"
        );

        let forced = run(&dir, true);
        let coloured = String::from_utf8(forced.stderr.clone()).unwrap();
        assert!(
            coloured.contains("\x1b[2m[functions:node]\x1b[0m \x1b[1;33mwarning\x1b[0m"),
            "{coloured}"
        );
        assert!(coloured.contains("\x1b[1;31merror\x1b[0m"), "{coloured}");
        assert!(
            coloured.contains("\x1b[33mlogger warn line\x1b[0m"),
            "{coloured}"
        );
        assert!(
            coloured.contains("\x1b[31mError: logger error line"),
            "{coloured}"
        );
        // The function's own colour is passed through untouched.
        assert!(
            coloured.contains(&format!(" {USER_COLOUR}\n")),
            "{coloured}"
        );
        assert_eq!(
            function_lines(&forced.stderr),
            function_lines(&plain.stderr)
        );
        // Standard output carries no function log.
        assert!(plain.status.success() && forced.status.success());
    }
}
