//! Colour for the human-facing text `fireemu` prints: the startup banner, the listener table, the
//! `error:`, `warning:` and `note:` lines and the shutdown lines.
//!
//! Colour is a presentation of a line, never part of it: a stream that is not a terminal, or
//! whose environment asks for none, receives exactly the bytes it received before colour existed,
//! so a log file, a pipe, a CI transcript and every parser of this output are unchanged.
//!
//! The decision follows the usual conventions, in this order:
//!
//! 1. `NO_COLOR` set to a non-empty value turns colour off (it wins over every force variable).
//! 2. `CLICOLOR_FORCE` or `FORCE_COLOR` set to a non-empty value other than `0` and `false` turns
//!    colour on, whether or not the stream is a terminal (and whatever `TERM` says).
//! 3. `TERM=dumb` and `CLICOLOR=0` turn colour off.
//! 4. Otherwise colour is on when the stream is a terminal. On Windows it is on only when the
//!    terminal is known to interpret ANSI sequences (`TERM` is set, as in Git Bash and other
//!    pty-based terminals, or `ANSICON` or `ConEmuANSI=ON` is set): the classic console needs a
//!    console mode this program does not set, so it would print the raw sequences. A Windows
//!    Terminal session that is not covered can opt in with `CLICOLOR_FORCE=1`.
//!
//! The palette is small: green for success, yellow for warnings and states that need attention,
//! red for errors, cyan for the names of services, bold for addresses and URLs, and dim for
//! secondary information (environment variable names, parenthetical remarks, services that are
//! not started).

use std::io::IsTerminal as _;
use std::sync::OnceLock;

use regex::Regex;

/// The stream a line is written to; each is decided on its own, because one can be redirected
/// while the other is a terminal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stream {
    Stdout,
    Stderr,
}

/// Whether colour is used on a stream, from the environment and whether the stream is a terminal.
pub(crate) fn decide(
    env: &dyn Fn(&str) -> Option<String>,
    is_terminal: bool,
    windows: bool,
) -> bool {
    let set = |name: &str| env(name).filter(|value| !value.is_empty());
    let forced = |name: &str| {
        set(name).is_some_and(|value| value != "0" && !value.eq_ignore_ascii_case("false"))
    };
    if set("NO_COLOR").is_some() {
        return false;
    }
    if forced("CLICOLOR_FORCE") || forced("FORCE_COLOR") {
        return true;
    }
    if set("TERM").is_some_and(|term| term == "dumb") || set("CLICOLOR").is_some_and(|v| v == "0") {
        return false;
    }
    if !is_terminal {
        return false;
    }
    !windows
        || set("TERM").is_some()
        || set("ANSICON").is_some()
        || set("ConEmuANSI").is_some_and(|value| value.eq_ignore_ascii_case("ON"))
}

/// Whether colour is used on `stream` in this process. Decided once per stream.
pub(crate) fn enabled(stream: Stream) -> bool {
    static STDOUT: OnceLock<bool> = OnceLock::new();
    static STDERR: OnceLock<bool> = OnceLock::new();
    let (cell, is_terminal) = match stream {
        Stream::Stdout => (&STDOUT, std::io::stdout().is_terminal()),
        Stream::Stderr => (&STDERR, std::io::stderr().is_terminal()),
    };
    *cell.get_or_init(|| decide(&|name| std::env::var(name).ok(), is_terminal, cfg!(windows)))
}

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const RED_BOLD: &str = "\x1b[1;31m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const YELLOW_BOLD: &str = "\x1b[1;33m";
const CYAN: &str = "\x1b[36m";

fn wrap(style: &str, text: &str) -> String {
    if text.is_empty() {
        String::new()
    } else {
        format!("{style}{text}{RESET}")
    }
}

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
    prefixed: Regex,
    row: Regex,
    token: Regex,
}

/// Paints one line (no newline in it). Removing the escape sequences from the result gives the
/// input back; a line of no known shape is returned as it is.
pub(crate) fn paint_line(line: &str) -> String {
    let patterns = patterns();
    if patterns.heading.is_match(line) {
        return wrap(BOLD, line);
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

/// Bold for addresses and URLs, dim for environment variable assignments and remarks in
/// parentheses.
fn paint_tokens(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    let mut last = 0;
    for found in patterns().token.captures_iter(text) {
        let whole = found.get(0).expect("whole match");
        out.push_str(&text[last..whole.start()]);
        let style = if found.name("url").is_some() || found.name("addr").is_some() {
            BOLD
        } else {
            DIM
        };
        out.push_str(&wrap(style, whole.as_str()));
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
