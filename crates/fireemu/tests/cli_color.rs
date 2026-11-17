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
            coloured.contains("\x1b[2mFIRESTORE_EMULATOR_HOST="),
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
    ] {
        let plain = fireemu(&dir, args, &[]);
        let forced = fireemu(&dir, args, &[("CLICOLOR_FORCE", "1"), ("FORCE_COLOR", "1")]);
        assert_eq!(plain.stdout, forced.stdout, "{args:?}");
        assert_eq!(plain.stderr, forced.stderr, "{args:?}");
        assert_eq!(plain.status.code(), forced.status.code(), "{args:?}");
    }
}
