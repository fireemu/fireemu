//! Bounded regular-expression evaluation for pipeline expressions.

use fireemu_core_firestore::pipeline_exec::{RegexError, RegexOperation, RegexResult, Unrecorded};

mod analysis;
#[cfg(test)]
mod matrix;
#[cfg(test)]
mod replay;
#[cfg(test)]
mod rewrite_tests;

const MAX_CACHED_PATTERN_BYTES: usize = 256;
const CACHED_PROGRAM_LIMIT: usize = 256 * 1024;
const CACHED_DFA_LIMIT: usize = 128 * 1024;
const PROGRAM_LIMIT: usize = 10 * 1024 * 1024;
const DFA_LIMIT: usize = 2 * 1024 * 1024;

struct CachedRegex {
    pattern: String,
    operation: RegexOperation,
    mode: Unrecorded,
    compiled: regex::Regex,
}

/// One lazy, bounded entry owned by an `ExecutePipeline` request.
#[derive(Default)]
pub(crate) struct RequestCache(Option<Box<CachedRegex>>);

thread_local! {
    static ACTIVE_CACHE: std::cell::RefCell<Option<RequestCache>> = const { std::cell::RefCell::new(None) };
}

struct CacheScope<'a> {
    owner: &'a mut RequestCache,
    previous: Option<RequestCache>,
}

impl Drop for CacheScope<'_> {
    fn drop(&mut self) {
        *self.owner = ACTIVE_CACHE
            .replace(self.previous.take())
            .expect("an active scope owns the request cache");
    }
}

impl RequestCache {
    /// Makes this request's entry available only during synchronous expression evaluation.
    pub(crate) fn scope<T>(&mut self, run: impl FnOnce() -> T) -> T {
        let _scope = CacheScope {
            previous: ACTIVE_CACHE.replace(Some(std::mem::take(self))),
            owner: self,
        };
        run()
    }

    fn resolve(
        &mut self,
        subject: &str,
        pattern: &str,
        operation: RegexOperation,
        mode: Unrecorded,
    ) -> Result<RegexResult, RegexError> {
        if let Some(entry) = self.0.as_ref().filter(|entry| {
            entry.pattern == pattern && entry.operation == operation && entry.mode == mode
        }) {
            return Ok(evaluate(&entry.compiled, subject, operation));
        }
        self.0 = None;
        let prepared = prepare_pattern(pattern, operation, mode)?;
        // Counted repeats can expand despite a short input. Compile these under the ordinary limits.
        if pattern.len() <= MAX_CACHED_PATTERN_BYTES && !pattern.contains('{') {
            match compile(&prepared, CACHED_PROGRAM_LIMIT, CACHED_DFA_LIMIT) {
                Ok(compiled) => {
                    let result = evaluate(&compiled, subject, operation);
                    self.0 = Some(Box::new(CachedRegex {
                        pattern: pattern.to_owned(),
                        operation,
                        mode,
                        compiled,
                    }));
                    return Ok(result);
                }
                // A pattern too large to retain can still run under the normal request limits.
                Err(RegexError::ResourceLimit) => {}
                Err(error) => return Err(error),
            }
        }
        compile(&prepared, PROGRAM_LIMIT, DFA_LIMIT)
            .map(|compiled| evaluate(&compiled, subject, operation))
    }
}

pub(crate) fn resolve(
    subject: &str,
    pattern: &str,
    operation: RegexOperation,
    mode: Unrecorded,
) -> Result<RegexResult, RegexError> {
    ACTIVE_CACHE.with_borrow_mut(|active| {
        if let Some(cache) = active {
            return cache.resolve(subject, pattern, operation, mode);
        }
        let prepared = prepare_pattern(pattern, operation, mode)?;
        compile(&prepared, PROGRAM_LIMIT, DFA_LIMIT)
            .map(|compiled| evaluate(&compiled, subject, operation))
    })
}

fn prepare_pattern(
    pattern: &str,
    operation: RegexOperation,
    mode: Unrecorded,
) -> Result<String, RegexError> {
    let analysis = analysis::analyze(pattern, mode)?;
    if matches!(operation, RegexOperation::Find | RegexOperation::FindAll)
        && analysis.capture_groups > 1
    {
        return Err(RegexError::TooManyCaptureGroups);
    }
    let pattern = analysis.pattern;
    let pattern = if operation == RegexOperation::Match {
        format!(r"\A(?:{pattern})\z")
    } else {
        pattern
    };
    Ok(pattern)
}

fn compile(
    pattern: &str,
    program_limit: usize,
    dfa_limit: usize,
) -> Result<regex::Regex, RegexError> {
    regex::RegexBuilder::new(pattern)
        .size_limit(program_limit)
        .dfa_size_limit(dfa_limit)
        .build()
        .map_err(|error| match error {
            regex::Error::Syntax(_) => RegexError::InvalidSyntax,
            _ => RegexError::ResourceLimit,
        })
}

fn evaluate(compiled: &regex::Regex, subject: &str, operation: RegexOperation) -> RegexResult {
    match operation {
        RegexOperation::Contains | RegexOperation::Match => {
            RegexResult::Boolean(compiled.is_match(subject))
        }
        RegexOperation::Find => {
            RegexResult::Match(compiled.captures(subject).and_then(|captures| {
                captures
                    .get(usize::from(captures.len() > 1))
                    .map(|value| value.as_str().to_owned())
            }))
        }
        RegexOperation::FindAll => RegexResult::Matches(
            compiled
                .captures_iter(subject)
                .map(|captures| {
                    captures
                        .get(usize::from(captures.len() > 1))
                        .map(|value| value.as_str().to_owned())
                })
                .collect(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::resolve;
    use fireemu_core_firestore::field_path::FieldPath;
    use fireemu_core_firestore::pipeline_exec::{
        Eval, EvalError, Expr, Placement, Row, RuntimeContext, Unrecorded,
    };
    use fireemu_core_firestore::value::Value;
    use proptest::prelude::*;
    use std::collections::BTreeMap;

    #[test]
    fn request_caches_restore_on_nested_scopes_unwinding_and_thread_switches() {
        use super::{RegexOperation, RegexResult, RequestCache, ACTIVE_CACHE};
        let mut outer = RequestCache::default();
        let mut inner = RequestCache::default();
        let mode = Unrecorded::OfficialEmulator;

        outer.scope(|| {
            assert_eq!(
                resolve("aa", "a", RegexOperation::Contains, mode),
                Ok(RegexResult::Boolean(true)),
            );
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                inner.scope(|| {
                    assert_eq!(
                        resolve("bb", "b", RegexOperation::Match, mode),
                        Ok(RegexResult::Boolean(false)),
                    );
                    panic!("exercise scope restoration");
                });
            }));
            assert!(result.is_err());
            ACTIVE_CACHE.with_borrow(|cache| {
                let Some(ref entry) = cache.as_ref().unwrap().0 else {
                    panic!("the outer cache must be restored");
                };
                assert_eq!(entry.pattern, "a");
            });
        });
        assert!(ACTIVE_CACHE.with_borrow(Option::is_none));
        assert_eq!(outer.0.as_ref().unwrap().pattern, "a");
        assert_eq!(inner.0.as_ref().unwrap().pattern, "b");

        let outer = std::thread::spawn(move || {
            assert!(ACTIVE_CACHE.with_borrow(Option::is_none));
            outer.scope(|| {
                assert_eq!(
                    resolve("aa", "a", RegexOperation::Match, mode),
                    Ok(RegexResult::Boolean(false)),
                );
            });
            assert!(ACTIVE_CACHE.with_borrow(Option::is_none));
            outer
        })
        .join()
        .unwrap();
        assert_eq!(outer.0.as_ref().unwrap().operation, RegexOperation::Match);
    }

    #[test]
    fn request_cache_does_not_retain_errors_or_programs_over_its_budget() {
        use super::{
            compile, prepare_pattern, RegexError, RegexOperation, RequestCache, CACHED_DFA_LIMIT,
            CACHED_PROGRAM_LIMIT,
        };
        let mut cache = RequestCache::default();
        let operation = RegexOperation::Contains;
        let mode = Unrecorded::OfficialEmulator;
        let large = "a{16384}";
        let prepared = prepare_pattern(large, operation, mode).unwrap();
        assert!(matches!(
            compile(&prepared, CACHED_PROGRAM_LIMIT, CACHED_DFA_LIMIT),
            Err(RegexError::ResourceLimit)
        ));
        let expected = resolve("a", large, operation, mode);
        assert!(expected.is_ok());
        assert_eq!(
            cache.scope(|| resolve("a", large, operation, mode)),
            expected
        );
        assert!(cache.0.is_none());
        let expected = resolve("a", "(", operation, mode);
        assert_eq!(cache.scope(|| resolve("a", "(", operation, mode)), expected);
        assert!(cache.0.is_none());
    }

    fn text(value: &str) -> Eval {
        Eval::Value(Value::String(value.to_owned()))
    }
    fn int(value: i64) -> Eval {
        Eval::Value(Value::Integer(value))
    }
    fn null() -> Eval {
        Eval::Value(Value::Null)
    }
    fn array(values: Vec<Value>) -> Eval {
        Eval::Value(Value::Array(values))
    }
    fn is_unobserved(value: &Eval) -> bool {
        matches!(value, Eval::Error(EvalError::Unobserved { .. }))
    }
    fn wrong(function: &'static str, expected: &'static str, got: &'static str) -> Eval {
        Eval::Error(EvalError::WrongType {
            function,
            expected,
            got,
        })
    }
    fn invalid(message: &str) -> Eval {
        Eval::Error(EvalError::Invalid(message.to_owned()))
    }
    fn call_in(name: &str, args: &[Eval], mode: Unrecorded) -> Eval {
        let args = args
            .iter()
            .map(|arg| match arg {
                Eval::Value(value) => Expr::Constant(value.clone()),
                Eval::Absent => Expr::Field(FieldPath::parse("missing").unwrap()),
                Eval::Error(_) => panic!("unexpected test input error"),
            })
            .collect();
        Expr::call(name, args, Placement::Value)
            .unwrap()
            .eval_in_with_runtime(
                &Row::derived(BTreeMap::new()),
                mode,
                RuntimeContext {
                    regex_resolver: Some(resolve),
                    ..RuntimeContext::default()
                },
            )
    }
    fn strict(name: &str, args: &[Eval]) -> Eval {
        call_in(name, args, Unrecorded::Refuse)
    }
    fn emulator(name: &str, args: &[Eval]) -> Eval {
        call_in(name, args, Unrecorded::OfficialEmulator)
    }
    fn both(name: &str, args: &[Eval]) -> Eval {
        let (a, b) = (strict(name, args), emulator(name, args));
        assert_eq!(format!("{a:?}"), format!("{b:?}"), "{name} {args:?}");
        a
    }
    #[test]
    #[allow(clippy::too_many_lines)]
    fn regex_recorded_production_cases() {
        let subject = text("Hello World");
        let yes = Eval::Value(Value::Boolean(true));
        let no = Eval::Value(Value::Boolean(false));
        let strings = |items: &[&str]| {
            array(
                items
                    .iter()
                    .map(|s| Value::String((*s).to_owned()))
                    .collect(),
            )
        };
        for (name, args, expected) in [
            (
                "regex_contains",
                vec![subject.clone(), text("o W")],
                yes.clone(),
            ),
            (
                "regex_contains",
                vec![subject.clone(), text("xyz")],
                no.clone(),
            ),
            (
                "regex_contains",
                vec![subject.clone(), text("^Hello")],
                yes.clone(),
            ),
            (
                "regex_contains",
                vec![subject.clone(), text("^World")],
                no.clone(),
            ),
            (
                "regex_contains",
                vec![subject.clone(), text("hello")],
                no.clone(),
            ),
            (
                "regex_contains",
                vec![subject.clone(), text("(?i)hello")],
                yes.clone(),
            ),
            (
                "regex_contains",
                vec![subject.clone(), text("")],
                yes.clone(),
            ),
            (
                "regex_contains",
                vec![text("héllo ☃😀"), text("☃")],
                yes.clone(),
            ),
            (
                "regex_match",
                vec![subject.clone(), text("H.*d")],
                yes.clone(),
            ),
            (
                "regex_match",
                vec![subject.clone(), text("o W")],
                no.clone(),
            ),
            (
                "regex_match",
                vec![subject.clone(), text("^Hello World$")],
                yes.clone(),
            ),
            ("regex_match", vec![text(""), text("")], yes.clone()),
            ("regex_find", vec![subject.clone(), text("o")], text("o")),
            ("regex_find", vec![subject.clone(), text("xyz")], null()),
            (
                "regex_find",
                vec![subject.clone(), text("(W)orld")],
                text("W"),
            ),
            ("regex_find", vec![subject.clone(), text("x*")], text("")),
            (
                "regex_find_all",
                vec![subject.clone(), text("o")],
                strings(&["o", "o"]),
            ),
            (
                "regex_find_all",
                vec![subject.clone(), text("xyz")],
                strings(&[]),
            ),
            (
                "regex_find_all",
                vec![text("aaa"), text("aa")],
                strings(&["aa"]),
            ),
            (
                "regex_find_all",
                vec![text("abc"), text("x*")],
                strings(&["", "", "", ""]),
            ),
        ] {
            assert_eq!(both(name, &args), expected, "{name} {args:?}");
        }
        assert_eq!(
            both("regex_match", &[subject.clone(), text("[")]),
            invalid("Unsupported regex syntax.")
        );
        for name in [
            "regex_contains",
            "regex_match",
            "regex_find",
            "regex_find_all",
        ] {
            assert_eq!(
                both(name, &[subject.clone(), text("(")]),
                invalid("Unsupported regex syntax.")
            );
            assert_eq!(both(name, &[null(), text("a")]), null());
            assert_eq!(both(name, &[Eval::Absent, text("a")]), null());
            assert_eq!(
                both(name, &[int(1), text("a")]),
                wrong(name, "String", "LONG")
            );
            assert_eq!(both(name, &[subject.clone(), null()]), null());
            assert_eq!(
                both(name, &[subject.clone(), int(1)]),
                wrong(name, "String or Regex", "LONG")
            );
            for (n, verb) in [(0, "were"), (1, "was")] {
                let result = match name {
                    "regex_contains" | "regex_match" => "boolean",
                    "regex_find" => "string?",
                    _ => "array[string?]",
                };
                let args = vec![Expr::Constant(Value::Null); n];
                let signature =
                    format!("{name}[T: string | regex](search_space: string, regexp: T): {result}");
                assert_eq!(
                    Expr::call(name, args, Placement::Value)
                        .unwrap_err()
                        .to_string(),
                    format!(
                    "The function '{signature}' takes [2..2] argument(s), but {n} {verb} provided."
                )
                );
            }
        }
    }

    #[test]
    fn regex_pict_generated_cases() {
        let cases = [
            ("contains", "text", "match", "strict"),
            ("match", "text", "match", "strict"),
            ("find", "text", "match", "strict"),
            ("find_all", "text", "match", "strict"),
            ("contains", "null", "match", "strict"),
            ("contains", "text", "invalid", "strict"),
            ("match", "null", "empty", "emulator"),
            ("find_all", "absent", "match", "emulator"),
            ("match", "empty", "no_match", "emulator"),
            ("match", "empty", "invalid", "emulator"),
            ("find", "empty", "null", "emulator"),
            ("find", "empty", "invalid", "strict"),
            ("contains", "text", "wrong", "emulator"),
            ("contains", "absent", "empty", "strict"),
            ("find_all", "text", "empty", "strict"),
            ("find_all", "empty", "wrong", "strict"),
            ("contains", "empty", "match", "emulator"),
            ("find_all", "wrong", "no_match", "strict"),
            ("find", "wrong", "empty", "emulator"),
            ("find_all", "empty", "empty", "emulator"),
            ("find", "null", "no_match", "strict"),
            ("find", "text", "wrong", "emulator"),
            ("find_all", "null", "null", "strict"),
            ("contains", "text", "no_match", "strict"),
            ("contains", "wrong", "match", "strict"),
            ("find_all", "text", "invalid", "emulator"),
            ("match", "absent", "null", "emulator"),
            ("contains", "text", "null", "strict"),
            ("match", "wrong", "match", "emulator"),
            ("find", "absent", "no_match", "emulator"),
            ("match", "empty", "wrong", "strict"),
        ];
        for (function, subject, pattern, profile) in cases {
            let name = match function {
                "contains" => "regex_contains",
                "match" => "regex_match",
                "find" => "regex_find",
                _ => "regex_find_all",
            };
            let input = match subject {
                "text" => text("abc"),
                "empty" => text(""),
                "null" => null(),
                "absent" => Eval::Absent,
                "wrong" => int(1),
                _ => unreachable!(),
            };
            let pattern_arg = match pattern {
                "match" => text("b"),
                "no_match" => text("z"),
                "empty" => text(""),
                "invalid" => text("("),
                "null" => null(),
                "wrong" => int(1),
                _ => unreachable!(),
            };
            let expected = if subject == "wrong" {
                wrong(name, "String", "LONG")
            } else if pattern == "wrong" {
                wrong(name, "String or Regex", "LONG")
            } else if subject == "null" || subject == "absent" || pattern == "null" {
                null()
            } else if pattern == "invalid" {
                invalid("Unsupported regex syntax.")
            } else {
                let matches = pattern == "empty" || (pattern == "match" && subject == "text");
                let full = pattern == "empty" && subject == "empty";
                match function {
                    "contains" => Eval::Value(Value::Boolean(matches)),
                    "match" => Eval::Value(Value::Boolean(full)),
                    "find" if !matches => null(),
                    "find" => text(if pattern == "empty" { "" } else { "b" }),
                    "find_all" if !matches => array(vec![]),
                    "find_all" if pattern == "empty" => {
                        array(vec![
                            Value::String(String::new());
                            if subject == "empty" { 1 } else { 4 }
                        ])
                    }
                    "find_all" => array(vec![Value::String("b".to_owned())]),
                    _ => unreachable!(),
                }
            };
            let got = if profile == "strict" {
                strict(name, &[input, pattern_arg])
            } else {
                emulator(name, &[input, pattern_arg])
            };
            assert_eq!(got, expected, "{function} {subject} {pattern} {profile}");
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(64))]
        #[test]
        fn regex_contains_and_match_agree_with_literal_reference(prefix in "[a-z]{0,8}", suffix in "[a-z]{0,8}") {
            let subject = format!("{prefix}Q{suffix}");
            prop_assert_eq!(strict("regex_contains", &[text(&subject), text("Q")]), Eval::Value(Value::Boolean(true)));
            prop_assert_eq!(strict("regex_match", &[text(&subject), text("Q")]), Eval::Value(Value::Boolean(prefix.is_empty() && suffix.is_empty())));
            prop_assert_eq!(strict("regex_find_all", &[text(&subject), text("Q")]), array(vec![Value::String("Q".to_owned())]));
        }
    }

    #[test]
    fn regex_strict_guards_known_re2_differences() {
        for (subject, pattern) in [
            ("ab", "(?x)a b"),
            ("a", "[a&&b]"),
            ("α", r"\p{Greek}"),
            ("a", r"\Qabc\E"),
            ("a", r"\C"),
            ("a", "(?R)^a$"),
            ("a", "[a--b]"),
            ("a", "[a~~b]"),
            ("a", "[a[b]]"),
            ("a", "a{2}"),
        ] {
            assert!(
                is_unobserved(&strict("regex_contains", &[text(subject), text(pattern)])),
                "{subject:?} {pattern:?}"
            );
        }
        assert_eq!(
            strict("regex_contains", &[text("☃"), text("☃")]),
            Eval::Value(Value::Boolean(true))
        );
        assert_eq!(
            strict("regex_contains", &[text(r"\d"), text(r"\\d")]),
            Eval::Value(Value::Boolean(true))
        );
        for (subject, pattern) in [
            ("[", r"\["),
            ("{", r"\{"),
            ("?", r"\?"),
            ("a", "[a-z]"),
            ("z", "[^a]"),
            ("a&&b", "a&&b"),
            (r"\s", r"\\s"),
        ] {
            assert_eq!(
                strict("regex_contains", &[text(subject), text(pattern)]),
                Eval::Value(Value::Boolean(true)),
                "{pattern}"
            );
        }
        assert_eq!(
            strict("regex_contains", &[text("Hello"), text("(?i)hello")]),
            Eval::Value(Value::Boolean(true))
        );
    }
    #[test]
    fn like_wildcards_escapes_and_dynamic_pattern() {
        for (subject, pattern, expected) in [
            ("apricot", "%ap%", true),
            ("berry", "%ap%", false),
            ("abc", "a_c", true),
            ("ac", "a_c", false),
            ("a%c", r"a\%c", true),
            ("abc", r"a\%c", false),
            ("a.c", "a.c", true),
            ("abc", "a.c", false),
        ] {
            for mode in [Unrecorded::Refuse, Unrecorded::OfficialEmulator] {
                let expression = Expr::call(
                    "like",
                    vec![
                        Expr::Field(FieldPath::parse("subject").unwrap()),
                        Expr::Field(FieldPath::parse("pattern").unwrap()),
                    ],
                    Placement::Value,
                )
                .unwrap();
                let row = Row::derived(BTreeMap::from([
                    ("subject".to_owned(), Value::String(subject.to_owned())),
                    ("pattern".to_owned(), Value::String(pattern.to_owned())),
                ]));
                let actual = expression.eval_in_with_runtime(
                    &row,
                    mode,
                    RuntimeContext {
                        regex_resolver: Some(resolve),
                        ..RuntimeContext::default()
                    },
                );
                assert_eq!(
                    actual,
                    Eval::Value(Value::Boolean(expected)),
                    "{subject:?} {pattern:?} {mode:?}"
                );
            }
        }
    }
    proptest! {
        #[test]
        fn like_without_wildcards_matches_literal_equality(subject in "[a-z]{0,12}", pattern in "[a-z]{0,12}") {
            prop_assert_eq!(both("like", &[text(&subject), text(&pattern)]), Eval::Value(Value::Boolean(subject == pattern)));
        }
    }
}
