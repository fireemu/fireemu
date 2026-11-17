use proptest::prelude::*;

use super::{paint_always, paint_line};

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

const RESET: &str = "\x1b[0m";

#[test]
fn the_heading_is_bold() {
    assert_eq!(
        paint_line("fireemu up"),
        format!("\x1b[1mfireemu up{RESET}")
    );
    assert_eq!(
        paint_line("fireemu exec"),
        format!("\x1b[1mfireemu exec{RESET}")
    );
}

#[test]
fn error_warning_and_note_prefixes_are_red_yellow_and_dim() {
    assert_eq!(
        paint_line("error: bind failed"),
        format!("\x1b[1;31merror:{RESET} bind failed")
    );
    assert_eq!(
        paint_line("warning: slow"),
        format!("\x1b[1;33mwarning:{RESET} slow")
    );
    assert_eq!(
        paint_line("note: reloaded"),
        format!("\x1b[2mnote:{RESET} reloaded")
    );
    assert_eq!(
        paint_line("  note: indented"),
        format!("  \x1b[2mnote:{RESET} indented")
    );
}

#[test]
fn a_listener_row_has_a_cyan_name_a_bold_address_and_a_dim_variable() {
    assert_eq!(
        paint_line("  auth (REST):      127.0.0.1:9099   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099"),
        format!(
            "  \x1b[36mauth (REST){RESET}:      \x1b[1m127.0.0.1:9099{RESET}   \x1b[2mFIREBASE_AUTH_EMULATOR_HOST{RESET}=127.0.0.1:9099"
        )
    );
}

#[test]
fn a_url_is_bold_and_a_remark_in_parentheses_is_dim() {
    assert_eq!(
        paint_line("  control API:      http://127.0.0.1:1/v1/  (health: /health/live)"),
        format!(
            "  \x1b[36mcontrol API{RESET}:      \x1b[1mhttp://127.0.0.1:1/v1/{RESET}  \x1b[2m(health: /health/live){RESET}"
        )
    );
}

#[test]
fn a_service_that_is_not_started_is_dim_and_a_disabled_one_is_yellow() {
    let dim = "  tasks:            not started (requires a Functions codebase)";
    assert_eq!(paint_line(dim), format!("  \x1b[2m{}{RESET}", &dim[2..]));
    let off =
        "  emulator hub:     disabled (cannot bind 127.0.0.1:0; choose one with --hub-port <n>)";
    assert_eq!(paint_line(off), format!("  \x1b[33m{}{RESET}", &off[2..]));
}

#[test]
fn rules_that_are_not_loaded_are_yellow() {
    assert_eq!(
        paint_line("  firestore rules:  none loaded, so every client request is refused"),
        format!(
            "  \x1b[36mfirestore rules{RESET}:  \x1b[33mnone loaded, so every client request is refused{RESET}"
        )
    );
}

#[test]
fn development_defaults_are_dim() {
    let line = "    auth.mfa.state: ENABLED (default)";
    assert_eq!(paint_line(line), format!("\x1b[2m{line}{RESET}"));
}

#[test]
fn ready_and_shutdown_lines() {
    assert_eq!(
        paint_line("  running command"),
        format!("  \x1b[32mrunning command{RESET}")
    );
    assert_eq!(
        paint_line("shutting down"),
        format!("\x1b[2mshutting down{RESET}")
    );
    assert_eq!(
        paint_line("shutting down (SIGTERM)"),
        format!("\x1b[2mshutting down (SIGTERM){RESET}")
    );
    assert_eq!(
        paint_line("exported to /tmp/x"),
        format!("\x1b[32mexported{RESET} to /tmp/x")
    );
}

#[test]
fn an_environment_assignment_keeps_its_value_free_of_escape_sequences() {
    // Scripts read `NAME=value` up to the next space; the value never ends in a reset.
    let painted = paint_line(
        "  storage (HTTP):   127.0.0.1:1   FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:1   STORAGE_EMULATOR_HOST=http://127.0.0.1:1",
    );
    for name in ["FIREBASE_STORAGE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST"] {
        let name_at = painted.find(name).unwrap();
        let at = name_at + painted[name_at..].find('=').unwrap() + 1;
        let value: String = painted[at..]
            .chars()
            .take_while(|c| !c.is_whitespace())
            .collect();
        assert!(!value.contains('\x1b'), "{name}: {value:?}");
    }
    assert!(painted.ends_with("http://127.0.0.1:1"), "{painted:?}");
}

#[test]
fn a_bracketed_source_tag_is_dim() {
    assert_eq!(
        paint_line("[firestore] text search uses fireemu-lexical-v1"),
        format!("\x1b[2m[firestore]{RESET} text search uses fireemu-lexical-v1")
    );
}

#[test]
fn a_line_with_its_own_escape_sequences_is_unchanged() {
    let line = "  auth:             \x1b[35mcoloured\x1b[0m http://127.0.0.1:1";
    assert_eq!(paint_line(line), line);
}

#[test]
fn text_of_no_known_shape_is_unchanged() {
    for line in [
        "",
        "plain text",
        "{\"json\": true}",
        "usage: fireemu init",
        "  indented prose, no label",
    ] {
        assert_eq!(paint_line(line), line);
    }
}

#[test]
fn every_line_of_a_multi_line_text_is_painted_on_its_own() {
    let text = "  app check modes:  auth=x\n  app check callables: the trusted protocol";
    let painted = paint_always(text);
    assert_eq!(painted.lines().count(), 2);
    assert!(painted.lines().all(|line| line.contains("\x1b[36m")));
    assert_eq!(strip_ansi(&painted), text);
}

proptest! {
    #[test]
    fn painting_only_adds_escape_sequences(line in "[ -~]{0,80}") {
        let painted = paint_line(&line);
        prop_assert_eq!(strip_ansi(&painted), line);
    }

    #[test]
    fn painting_a_banner_shaped_line_only_adds_escape_sequences(
        label in "[a-z][a-z .]{0,12}( \\((HTTP|gRPC \\+ REST|WS)\\))?",
        gap in " {1,8}",
        value in "(127\\.0\\.0\\.1:[0-9]{2,5}|http://[a-z0-9.:/]{1,20}|none loaded[ -~]{0,20}|disabled[ -~]{0,20}|[A-Z_]{3,9}=[a-z0-9]{1,6}|[ -~]{0,30})",
    ) {
        let line = format!("  {label}:{gap}{value}");
        prop_assert_eq!(strip_ansi(&paint_line(&line)), line);
    }

    #[test]
    fn an_environment_value_never_holds_an_escape_sequence(
        name in "[A-Z][A-Z0-9_]{2,12}",
        value in "[a-z0-9.:/]{1,24}",
        before in "[a-z]{0,6}",
    ) {
        let line = format!("  svc ({before}):  {name}={value}  (note)");
        let painted = paint_line(&line);
        let name_at = painted.find(&name).unwrap();
        let at = name_at + painted[name_at..].find('=').unwrap() + 1;
        let read: String = painted[at..].chars().take_while(|c| !c.is_whitespace()).collect();
        prop_assert_eq!(read, value);
    }

    #[test]
    fn a_painted_line_stays_one_line(line in "[ -~]{0,80}") {
        prop_assert!(!paint_line(&line).contains('\n'));
    }
}
