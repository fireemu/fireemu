//! Colour for the human-facing text `fireemu` prints: the startup banner, the listener table, the
//! `error:`, `warning:` and `note:` lines and the shutdown lines.
//!
//! Colour is a presentation of a line, never part of it: unless colour is forced with
//! `CLICOLOR_FORCE` or `FORCE_COLOR` (which also colours redirected output), a stream that is not
//! a terminal, or whose environment asks for none, receives exactly the bytes it received before
//! colour existed, so a log file, a pipe, a CI transcript and every parser of this output are
//! unchanged.
//!
//! Whether colour is used is decided in [`fireemu_adapter_support::term`] (shared with the
//! servers' own diagnostics): `NO_COLOR` turns it off and wins over everything,
//! `CLICOLOR_FORCE` and `FORCE_COLOR` turn it on, `TERM=dumb` and `CLICOLOR=0` turn it off, and
//! otherwise a terminal gets it (on Windows only a terminal known to interpret ANSI sequences).
//!
//! The palette is small: green for success, yellow for warnings and states that need attention,
//! red for errors, cyan for the names of services, bold for addresses and URLs, and dim for
//! secondary information (environment variable names, parenthetical remarks, services that are
//! not started).

use std::sync::OnceLock;

pub(crate) use fireemu_adapter_support::term::Stream;
use fireemu_adapter_support::term::{
    enabled, wrap, BOLD, CYAN, DIM, GREEN, RED_BOLD, YELLOW, YELLOW_BOLD,
};

use regex::Regex;

/// The line as it is written to `stream`: painted when colour is on there, otherwise unchanged.
/// `text` may hold several lines.
pub(crate) fn paint(stream: Stream, text: &str) -> String {
    if enabled(stream) {
        paint_always(text)
    } else {
        text.to_owned()
    }
}

/// Paints every line of `text`, whatever the environment says.
pub(crate) fn paint_always(text: &str) -> String {
    text.split('\n')
        .map(paint_line)
        .collect::<Vec<_>>()
        .join("\n")
}

fn patterns() -> &'static Patterns {
    static PATTERNS: OnceLock<Patterns> = OnceLock::new();
    PATTERNS.get_or_init(|| Patterns {
        heading: Regex::new(r"^fireemu (up|exec)$").expect("heading pattern"),
        tag: Regex::new(r"^\[[A-Za-z0-9:_.-]+\]").expect("tag pattern"),
        prefixed: Regex::new(r"^(\s*)(error|warning|note):(.*)$").expect("prefix pattern"),
        row: Regex::new(r"^ {2}([A-Za-z][A-Za-z0-9 .\[\]_-]*?(?: \([^)]*\))?):( +)(.*)$")
            .expect("row pattern"),
        token: Regex::new(
            r"(?x)
            (?P<url>https?://[^\s)]+)
            | (?P<addr>\b\d{1,3}(?:\.\d{1,3}){3}:\d+\b|\[[0-9A-Fa-f:]+\]:\d+|\blocalhost:\d+\b)
            | (?P<env>\b[A-Z][A-Z0-9_]*=[^\s)]+)
            | (?P<remark>\([^)]*\))",
        )
        .expect("token pattern"),
    })
}

struct Patterns {
    heading: Regex,
    tag: Regex,
    prefixed: Regex,
    row: Regex,
    token: Regex,
}

/// Paints one line (no newline in it). Removing the escape sequences from the result gives the
/// input back; a line of no known shape is returned as it is.
pub(crate) fn paint_line(line: &str) -> String {
    let patterns = patterns();
    if line.contains('\x1b') {
        return line.to_owned();
    }
    if patterns.heading.is_match(line) {
        return wrap(BOLD, line);
    }
    if let Some(tag) = patterns.tag.find(line) {
        return format!("{}{}", wrap(DIM, tag.as_str()), &line[tag.end()..]);
    }
    if let Some(caps) = patterns.prefixed.captures(line) {
        let label = format!("{}:", &caps[2]);
        let style = match &caps[2] {
            "error" => RED_BOLD,
            "warning" => YELLOW_BOLD,
            _ => DIM,
        };
        return format!("{}{}{}", &caps[1], wrap(style, &label), &caps[3]);
    }
    if let Some(rest) = line.strip_prefix("  ") {
        if rest == "running command" {
            return format!("  {}", wrap(GREEN, rest));
        }
        if rest.starts_with("shutting down") {
            return format!("  {}", wrap(DIM, rest));
        }
    }
    if line == "shutting down" || line.starts_with("shutting down (") {
        return wrap(DIM, line);
    }
    if let Some(rest) = line.strip_prefix("exported ") {
        return format!("{} {rest}", wrap(GREEN, "exported"));
    }
    if line.starts_with("    ") && !line.trim().is_empty() {
        return wrap(DIM, line);
    }
    if let Some(caps) = patterns.row.captures(line) {
        let (label, gap, rest) = (&caps[1], &caps[2], &caps[3]);
        return format!("  {}", paint_row(label, gap, rest));
    }
    line.to_owned()
}

/// The row `  <label>:<gap><rest>` without its two-space indent.
fn paint_row(label: &str, gap: &str, rest: &str) -> String {
    if ["not selected", "not started", "not configured"]
        .iter()
        .any(|state| rest.starts_with(state))
    {
        return wrap(DIM, &format!("{label}:{gap}{rest}"));
    }
    if rest.starts_with("disabled") {
        return wrap(YELLOW, &format!("{label}:{gap}{rest}"));
    }
    let rest = if rest.starts_with("none loaded") {
        wrap(YELLOW, rest)
    } else {
        paint_tokens(rest)
    };
    format!("{}:{gap}{rest}", wrap(CYAN, label))
}

/// Bold for addresses and URLs, dim for the names of environment variable assignments (never
/// their values) and for remarks in
/// parentheses.
fn paint_tokens(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    let mut last = 0;
    for found in patterns().token.captures_iter(text) {
        let whole = found.get(0).expect("whole match");
        out.push_str(&text[last..whole.start()]);
        if found.name("env").is_some() {
            // `NAME=value`: only the name is styled, and the reset comes before the `=`, so the text after
            // it is the plain value. The value is read by scripts and tests
            // (`FIREBASE_AUTH_EMULATOR_HOST=([^\s]+)`) and must not end in an escape sequence.
            let text = whole.as_str();
            let (name, value) = text.split_at(text.find('=').unwrap_or(text.len()));
            out.push_str(&wrap(DIM, name));
            out.push_str(value);
        } else {
            let style = if found.name("url").is_some() || found.name("addr").is_some() {
                BOLD
            } else {
                DIM
            };
            out.push_str(&wrap(style, whole.as_str()));
        }
        last = whole.end();
    }
    out.push_str(&text[last..]);
    out
}

/// `println!` whose line is painted when stdout takes colour. The text written otherwise is
/// exactly what `println!` writes.
macro_rules! outln {
    ($($arg:tt)*) => {
        println!("{}", $crate::term::paint($crate::term::Stream::Stdout, &format!($($arg)*)))
    };
}

/// `eprintln!` whose line is painted when stderr takes colour.
macro_rules! errln {
    ($($arg:tt)*) => {
        eprintln!("{}", $crate::term::paint($crate::term::Stream::Stderr, &format!($($arg)*)))
    };
}

pub(crate) use {errln, outln};

#[cfg(test)]
mod tests;
