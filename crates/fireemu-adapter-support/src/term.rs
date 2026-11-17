//! Terminal colour for the diagnostics the servers print while they run.
//!
//! Colour is a presentation of a line, never part of it: unless colour is forced with
//! `CLICOLOR_FORCE` or `FORCE_COLOR` (which also colours redirected output), a stream that is not
//! a terminal, or whose environment asks for none, receives exactly the bytes it received before
//! colour existed, so a log file, a pipe, a CI transcript and every parser of this output are
//! unchanged. Records kept
//! for the Logging emulator and the Emulator UI are built from the plain text and never pass
//! through this module.
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
//! Text that already carries an escape sequence (a function's own colours) is passed through
//! unchanged.

use std::io::IsTerminal as _;
use std::sync::OnceLock;

/// The stream a line is written to; each is decided on its own, because one can be redirected
/// while the other is a terminal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stream {
    /// Standard output.
    Stdout,
    /// Standard error.
    Stderr,
}

/// Whether colour is used on a stream, from the environment and whether the stream is a terminal.
pub fn decide(env: &dyn Fn(&str) -> Option<String>, is_terminal: bool, windows: bool) -> bool {
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
#[must_use]
pub fn enabled(stream: Stream) -> bool {
    static STDOUT: OnceLock<bool> = OnceLock::new();
    static STDERR: OnceLock<bool> = OnceLock::new();
    let (cell, is_terminal) = match stream {
        Stream::Stdout => (&STDOUT, std::io::stdout().is_terminal()),
        Stream::Stderr => (&STDERR, std::io::stderr().is_terminal()),
    };
    *cell.get_or_init(|| decide(&|name| std::env::var(name).ok(), is_terminal, cfg!(windows)))
}

/// Resets every attribute.
pub const RESET: &str = "\x1b[0m";
/// Bold.
pub const BOLD: &str = "\x1b[1m";
/// Dim, for secondary information.
pub const DIM: &str = "\x1b[2m";
/// Red.
pub const RED: &str = "\x1b[31m";
/// Bold red, for errors.
pub const RED_BOLD: &str = "\x1b[1;31m";
/// Green, for success.
pub const GREEN: &str = "\x1b[32m";
/// Yellow.
pub const YELLOW: &str = "\x1b[33m";
/// Bold yellow, for warnings.
pub const YELLOW_BOLD: &str = "\x1b[1;33m";
/// Cyan, for names of services and functions.
pub const CYAN: &str = "\x1b[36m";

/// `text` in `style`, closed again; nothing for an empty text.
#[must_use]
pub fn wrap(style: &str, text: &str) -> String {
    if text.is_empty() {
        String::new()
    } else {
        format!("{style}{text}{RESET}")
    }
}

/// The severity of a diagnostic.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// An error: red.
    Error,
    /// A warning: yellow.
    Warn,
    /// Information: unstyled.
    Info,
    /// Debug or trace output: dim.
    Debug,
}

impl Level {
    /// The level a log severity name stands for (Cloud Logging and `firebase-functions` names).
    #[must_use]
    pub fn from_name(name: &str) -> Self {
        match name.to_ascii_lowercase().as_str() {
            "error" | "critical" | "alert" | "emergency" | "fatal" => Self::Error,
            "warn" | "warning" => Self::Warn,
            "debug" | "trace" => Self::Debug,
            _ => Self::Info,
        }
    }

    /// The style of the text of a line of this level; none for information.
    fn text_style(self) -> Option<&'static str> {
        match self {
            Self::Error => Some(RED),
            Self::Warn => Some(YELLOW),
            Self::Info => None,
            Self::Debug => Some(DIM),
        }
    }

    fn word_style(self) -> Option<&'static str> {
        match self {
            Self::Error => Some(RED_BOLD),
            Self::Warn => Some(YELLOW_BOLD),
            Self::Info => None,
            Self::Debug => Some(DIM),
        }
    }
}

fn styled(style: Option<&str>, text: &str) -> String {
    style.map_or_else(|| text.to_owned(), |style| wrap(style, text))
}

/// `text` in `style`, one line at a time, so that no style spans a line break. The lines after the
/// first (a stack trace, the rest of a multi-line message) are dim, so that the first line stands
/// out. Text that holds an escape sequence of its own is returned as it is.
fn styled_lines(style: Option<&str>, text: &str) -> String {
    if style.is_none() || text.contains('\x1b') {
        return text.to_owned();
    }
    text.split('\n')
        .enumerate()
        .map(|(index, line)| {
            let style = if index == 0 || style == Some(DIM) {
                style
            } else {
                Some(DIM)
            };
            styled(style, line)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// A function log line `<tag> <level> [<invocation>] <message>`, painted whatever the
/// environment says. The tag and the invocation are dim, the level word and the message follow
/// the level.
#[must_use]
pub fn log_line_always(tag: &str, level: &str, invocation: Option<&str>, message: &str) -> String {
    let severity = Level::from_name(level);
    let mut out = format!(
        "{} {}",
        wrap(DIM, tag),
        styled(severity.word_style(), level)
    );
    if let Some(id) = invocation {
        out.push(' ');
        out.push_str(&wrap(DIM, id));
    }
    out.push(' ');
    out.push_str(&styled_lines(severity.text_style(), message));
    out
}

/// The same line as [`log_line_always`] when colour is on for stderr, the plain
/// `<tag> <level> [<invocation>] <message>` otherwise.
#[must_use]
pub fn log_line(tag: &str, level: &str, invocation: Option<&str>, message: &str) -> String {
    if enabled(Stream::Stderr) {
        log_line_always(tag, level, invocation, message)
    } else {
        invocation.map_or_else(
            || format!("{tag} {level} {message}"),
            |id| format!("{tag} {level} {id} {message}"),
        )
    }
}

/// `<tag> <line>` where the line is a function's own output with no level: only the tag is
/// painted, the output is never touched.
#[must_use]
pub fn raw_line(tag: &str, line: &str) -> String {
    if enabled(Stream::Stderr) {
        format!("{} {line}", wrap(DIM, tag))
    } else {
        format!("{tag} {line}")
    }
}

/// A diagnostic line of `level`, painted whatever the environment says: a leading `[tag]` is dim,
/// a leading `error:`, `warning:` or `note:` is red, yellow or dim, and the rest follows the
/// level.
#[must_use]
pub fn tagged_line_always(level: Level, line: &str) -> String {
    if line.contains('\x1b') {
        return line.to_owned();
    }
    if line.starts_with('[') {
        if let Some(end) = line.find(']') {
            let (tag, rest) = line.split_at(end + 1);
            return format!(
                "{}{}",
                wrap(DIM, tag),
                styled_lines(level.text_style(), rest)
            );
        }
    }
    for (prefix, style) in [
        ("error:", RED_BOLD),
        ("warning:", YELLOW_BOLD),
        ("note:", DIM),
    ] {
        if let Some(rest) = line.strip_prefix(prefix) {
            return format!(
                "{}{}",
                wrap(style, prefix),
                styled_lines(level.text_style(), rest)
            );
        }
    }
    styled_lines(level.text_style(), line)
}

/// [`tagged_line_always`] when colour is on for stderr, the line itself otherwise.
#[must_use]
pub fn tagged_line(level: Level, line: &str) -> String {
    if enabled(Stream::Stderr) {
        tagged_line_always(level, line)
    } else {
        line.to_owned()
    }
}

/// `eprintln!` of a diagnostic line of a level, painted when stderr takes colour. The text
/// written otherwise is exactly what `eprintln!` writes.
#[macro_export]
macro_rules! eprintln_at {
    ($level:expr, $($arg:tt)*) => {
        eprintln!("{}", $crate::term::tagged_line($level, &format!($($arg)*)))
    };
}

#[cfg(test)]
mod tests;
