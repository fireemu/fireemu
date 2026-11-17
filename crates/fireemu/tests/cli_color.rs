//! Colour in the human-facing output: none unless the environment asks for it, and the text
//! underneath is the same either way. The child runs with a piped stdout and stderr, so only the
//! force variables can switch colour on; a terminal is covered by the unit tests of the decision.

mod scratch;

use std::process::{Command, Output, Stdio};

const ESC: &str = "\x1b[";

fn fireemu(cwd: &std::path::Path, args: &[&str], env: &[(&str, &str)]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_fireemu"));
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("TERM", "xterm");
    for name in ["NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE", "FORCE_COLOR"] {
        cmd.env_remove(name);
    }
    for (name, value) in env {
        cmd.env(name, value);
    }
    cmd.output().unwrap()
}

fn exec(cwd: &std::path::Path, env: &[(&str, &str)]) -> Output {
    fireemu(
        cwd,
        &[
            "exec",
            "--no-config-discovery",
            "--project",
            "demo-color",
            "--only",
            "firestore,auth",
            "--firestore-port",
            "0",
            "--http-port",
            "0",
            "--hub-port",
            "0",
            "--logging-port",
            "0",
            "--",
            "true",
        ],
        env,
    )
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

/// The text with every number replaced, so two runs on different ports and clocks compare.
fn shape(text: &str) -> String {
    let mut out = String::new();
    let mut in_number = false;
    for c in text.chars() {
        if c.is_ascii_digit() {
            if !in_number {
                out.push('N');
            }
            in_number = true;
        } else {
            in_number = false;
            out.push(c);
        }
    }
    out
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[test]
fn output_to_a_pipe_has_no_escape_sequences() {
    let dir = scratch::Scratch::new("cli-color", "pipe");
    let out = exec(&dir, &[]);
    assert!(out.status.success(), "{out:?}");
    let stdout = text(&out.stdout);
    assert!(stdout.starts_with("fireemu exec\n"), "{stdout}");
    assert!(stdout.contains("\n  running command\n"), "{stdout}");
    assert!(!stdout.contains('\x1b') && !text(&out.stderr).contains('\x1b'));
}

#[test]
fn a_force_variable_colours_the_banner_and_only_adds_escape_sequences() {
    let dir = scratch::Scratch::new("cli-color", "force");
    let plain = text(&exec(&dir, &[]).stdout);
    for variable in ["CLICOLOR_FORCE", "FORCE_COLOR"] {
        let coloured = text(&exec(&dir, &[(variable, "1")]).stdout);
        assert!(
            coloured.starts_with("\x1b[1mfireemu exec\x1b[0m\n"),
            "{coloured}"
        );
        assert!(
            coloured.contains("\x1b[36mfirestore (gRPC + REST)\x1b[0m:"),
            "{coloured}"
        );
        assert!(
            coloured.contains("\x1b[2mFIRESTORE_EMULATOR_HOST\x1b[0m="),
            "{coloured}"
        );
        assert!(
            coloured.contains("\n  \x1b[32mrunning command\x1b[0m\n"),
            "{coloured}"
        );
        assert_eq!(shape(&strip_ansi(&coloured)), shape(&plain), "{variable}");
    }
}

#[test]
fn no_color_beats_a_force_variable() {
    let dir = scratch::Scratch::new("cli-color", "no-color");
    let out = exec(
        &dir,
        &[
            ("NO_COLOR", "1"),
            ("FORCE_COLOR", "1"),
            ("CLICOLOR_FORCE", "1"),
        ],
    );
    assert!(!text(&out.stdout).contains(ESC) && !text(&out.stderr).contains(ESC));
}

#[test]
fn a_usage_error_is_red_only_when_forced() {
    let dir = scratch::Scratch::new("cli-color", "usage");
    let plain = fireemu(&dir, &["exec", "--bogus"], &[]);
    let stderr = text(&plain.stderr);
    assert_eq!(plain.status.code(), Some(2));
    assert!(stderr.starts_with("error: "), "{stderr}");
    let forced = fireemu(&dir, &["exec", "--bogus"], &[("CLICOLOR_FORCE", "1")]);
    let coloured = text(&forced.stderr);
    assert!(
        coloured.starts_with("\x1b[1;31merror:\x1b[0m "),
        "{coloured}"
    );
    assert_eq!(strip_ansi(&coloured), stderr);
    assert_eq!(text(&forced.stdout), text(&plain.stdout));
}

#[test]
fn machine_readable_output_is_identical_when_colour_is_forced() {
    let dir = scratch::Scratch::new("cli-color", "machine");
    for args in [
        &["--version"][..],
        &["capabilities"][..],
        &["config", "show", "--json"][..],
        &["config", "lint", "--json"][..],
        &[
            "up",
            "--no-config-discovery",
            "--only",
            "firestore",
            "--plan",
        ][..],
        &[
            "up",
            "--no-config-discovery",
            "--only",
            "firestore",
            "--plan",
            "--json",
        ][..],
    ] {
        let plain = fireemu(&dir, args, &[]);
        let forced = fireemu(&dir, args, &[("CLICOLOR_FORCE", "1"), ("FORCE_COLOR", "1")]);
        assert_eq!(plain.stdout, forced.stdout, "{args:?}");
        assert_eq!(plain.stderr, forced.stderr, "{args:?}");
        assert_eq!(plain.status.code(), forced.status.code(), "{args:?}");
    }
}

#[test]
fn the_logging_line_says_the_port_was_set_to_zero() {
    let dir = scratch::Scratch::new("cli-color", "logging");
    let stdout = text(&exec(&dir, &[]).stdout);
    assert!(
        stdout.contains("\n  logging:          disabled (emulators.logging / daemon.loggingPort / --logging-port set to 0)\n"),
        "{stdout}"
    );
}

#[test]
fn a_failing_plan_keeps_its_diagnostics_plain_when_colour_is_forced() {
    let dir = scratch::Scratch::new("cli-color", "plan");
    let args = [
        "up",
        "--no-config-discovery",
        "--only",
        "firestore",
        "--plan",
        "--deny-inherited-emulator-env",
    ];
    let env = [("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")];
    let plain = fireemu(&dir, &args, &env);
    assert_eq!(plain.status.code(), Some(1), "{plain:?}");
    let forced = fireemu(
        &dir,
        &args,
        &[env[0], ("FORCE_COLOR", "1"), ("CLICOLOR_FORCE", "1")],
    );
    assert_eq!(plain.stdout, forced.stdout);
    assert_eq!(plain.stderr, forced.stderr);
    assert_eq!(plain.status.code(), forced.status.code());
    assert!(!text(&forced.stderr).contains('\x1b'));
}

#[test]
fn a_forced_banner_keeps_every_environment_value_free_of_escape_sequences() {
    let dir = scratch::Scratch::new("cli-color", "env-values");
    let stdout = text(&exec(&dir, &[("FORCE_COLOR", "1")]).stdout);
    assert!(stdout.contains(ESC), "{stdout}");
    for name in ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"] {
        // The value is read up to the next space, as the npm launcher test and scripts do.
        let name_at = stdout.find(name).unwrap();
        let at = name_at + stdout[name_at..].find('=').unwrap() + 1;
        let value: String = stdout[at..]
            .chars()
            .take_while(|c| !c.is_whitespace())
            .collect();
        assert!(
            value.parse::<std::net::SocketAddr>().is_ok(),
            "{name}: {value:?}"
        );
    }
}

/// Each stream decides on its own: with one of them a terminal and the other redirected to a file,
/// only the terminal is coloured. A terminal comes from `script(1)`, which gives the command a pty.
#[cfg(unix)]
mod mixed_streams {
    use super::{scratch, text, ESC};
    use std::process::{Command, Stdio};

    const BIN: &str = env!("CARGO_BIN_EXE_fireemu");

    /// The output of `sh -c <command>` under a pty; `None` when `script` gives no terminal here.
    fn under_pty(command: &str) -> Option<String> {
        let mut script = Command::new("script");
        if cfg!(target_os = "macos") {
            script.args(["-q", "/dev/null", "sh", "-c", command]);
        } else {
            script.args(["-qec", command, "/dev/null"]);
        }
        let out = script
            .env("TERM", "xterm")
            .env_remove("NO_COLOR")
            .env_remove("CLICOLOR")
            .env_remove("CLICOLOR_FORCE")
            .env_remove("FORCE_COLOR")
            .stdin(Stdio::null())
            .output()
            .ok()?;
        Some(text(&out.stdout))
    }

    fn have_pty() -> bool {
        under_pty("[ -t 1 ] && [ -t 2 ] && echo both-terminals")
            .is_some_and(|out| out.contains("both-terminals"))
    }

    fn run_args() -> String {
        format!(
            "'{BIN}' exec --no-config-discovery --project demo-color --only firestore,auth --firestore-port 0 --http-port 0 --hub-port 0 --logging-port 0 -- true"
        )
    }

    #[test]
    fn stdout_to_a_file_and_stderr_a_terminal_colours_only_stderr() {
        if !have_pty() {
            eprintln!("skipped: script(1) gives no terminal here");
            return;
        }
        let dir = scratch::Scratch::new("cli-color", "mixed-a");
        let out = dir.join("stdout.txt");
        let tty = under_pty(&format!("'{BIN}' exec --bogus > '{}'", out.display())).unwrap();
        assert!(tty.contains("\x1b[1;31merror:\x1b[0m"), "{tty:?}");
        assert!(!std::fs::read_to_string(&out).unwrap().contains(ESC));
        let tty = under_pty(&format!("{} > '{}'", run_args(), out.display())).unwrap();
        let file = std::fs::read_to_string(&out).unwrap();
        assert!(file.starts_with("fireemu exec\n"), "{file}");
        assert!(!file.contains(ESC), "{file}");
        assert!(!tty.contains("fireemu exec"), "{tty:?}");
    }

    #[test]
    fn stderr_to_a_file_and_stdout_a_terminal_colours_only_stdout() {
        if !have_pty() {
            eprintln!("skipped: script(1) gives no terminal here");
            return;
        }
        let dir = scratch::Scratch::new("cli-color", "mixed-b");
        let err = dir.join("stderr.txt");
        let tty = under_pty(&format!("{} 2> '{}'", run_args(), err.display())).unwrap();
        assert!(tty.contains("\x1b[1mfireemu exec\x1b[0m"), "{tty:?}");
        assert!(!std::fs::read_to_string(&err).unwrap().contains(ESC));
        let tty = under_pty(&format!("'{BIN}' exec --bogus 2> '{}'", err.display())).unwrap();
        let file = std::fs::read_to_string(&err).unwrap();
        assert!(file.starts_with("error: "), "{file}");
        assert!(!file.contains(ESC) && !tty.contains(ESC), "{file} {tty:?}");
    }
}
