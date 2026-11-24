//! Server-template condition expressions: the structured form the Admin SDK reads from the
//! `serverRemoteConfig` data plane, and the strict profile's validation refusals.
//!
//! Every form here was recorded in production (RC-OBSERVE-V2-3, 2026-11-24, and the 2026-11-21
//! campaign): a `&&` chain of percent, custom-signal string, numeric and semantic-version atoms
//! becomes one `orCondition` holding one `andCondition` with the atoms in source order. Anything
//! else becomes an empty condition, which the Admin SDK evaluates as false.

use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq, Eq)]
enum Token {
    Ident(String),
    Str(String),
    Num(String),
    Punct(&'static str),
}

fn lex(expression: &str) -> Option<Vec<Token>> {
    // Production's grammar quotes with `'`; a double quote or a backslash was never recorded.
    if expression.contains(['\\', '"']) {
        return None;
    }
    let bytes = expression.as_bytes();
    let mut tokens = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let c = bytes[at];
        if matches!(c, b' ' | b'\t'..=b'\r') {
            at += 1;
        } else if c == b'\'' {
            let end = at + 1 + expression[at + 1..].find('\'')?;
            tokens.push(Token::Str(expression[at + 1..end].to_owned()));
            at = end + 1;
        } else if c.is_ascii_alphabetic() {
            let end = bytes[at..]
                .iter()
                .position(|b| !b.is_ascii_alphanumeric())
                .map_or(bytes.len(), |n| at + n);
            tokens.push(Token::Ident(expression[at..end].to_owned()));
            at = end;
        } else if c.is_ascii_digit() {
            let end = bytes[at..]
                .iter()
                .position(|b| !(b.is_ascii_digit() || *b == b'.'))
                .map_or(bytes.len(), |n| at + n);
            tokens.push(Token::Num(expression[at..end].to_owned()));
            at = end;
        } else {
            let punct = [
                "&&", "||", "<=", ">=", "==", "!=", "<", ">", "!", ".", "[", "]", "(", ")", ",",
            ]
            .into_iter()
            .find(|p| expression[at..].starts_with(p))?;
            tokens.push(Token::Punct(punct));
            at += punct.len();
        }
    }
    Some(tokens)
}

struct Parser {
    tokens: Vec<Token>,
    at: usize,
}

impl Parser {
    fn next(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.at).cloned();
        self.at += 1;
        token
    }

    fn punct(&mut self, expected: &str) -> Option<()> {
        matches!(self.next()?, Token::Punct(p) if p == expected).then_some(())
    }

    fn ident(&mut self, expected: &str) -> Option<()> {
        matches!(self.next()?, Token::Ident(name) if name == expected).then_some(())
    }

    fn string(&mut self) -> Option<String> {
        match self.next()? {
            Token::Str(text) => Some(text),
            _ => None,
        }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at)
    }

    /// `app.customSignal['key']`, returning the key.
    fn signal(&mut self) -> Option<String> {
        self.ident("app")?;
        self.punct(".")?;
        self.ident("customSignal")?;
        self.punct("[")?;
        let key = self.string()?;
        self.punct("]")?;
        Some(key)
    }

    fn comparison(&mut self) -> Option<&'static str> {
        match self.next()? {
            Token::Punct(op @ ("<" | "<=" | "==" | "!=" | ">" | ">=")) => Some(op),
            _ => None,
        }
    }

    fn atom(&mut self) -> Option<Value> {
        match self.peek()? {
            Token::Ident(name) if name == "percent" => self.percent(),
            Token::Ident(name) if name == "version" => {
                self.next();
                self.punct("(")?;
                let key = self.signal()?;
                self.punct(")")?;
                let operator = match self.comparison()? {
                    "<" => "SEMANTIC_VERSION_LESS_THAN",
                    "<=" => "SEMANTIC_VERSION_LESS_EQUAL",
                    "==" => "SEMANTIC_VERSION_EQUAL",
                    "!=" => "SEMANTIC_VERSION_NOT_EQUAL",
                    ">" => "SEMANTIC_VERSION_GREATER_THAN",
                    _ => "SEMANTIC_VERSION_GREATER_EQUAL",
                };
                let target = self.string()?;
                plain_version(&target).then(|| signal_atom(operator, &key, &[target]))
            }
            // Anything else must be a custom signal (`signal` checks for `app`).
            _ => {
                let key = self.signal()?;
                if self.peek() == Some(&Token::Punct(".")) {
                    self.next();
                    let operator = match self.next()? {
                        Token::Ident(method) => match method.as_str() {
                            "exactlyMatches" => "STRING_EXACTLY_MATCHES",
                            "contains" => "STRING_CONTAINS",
                            "notContains" => "STRING_DOES_NOT_CONTAIN",
                            "matches" => "STRING_CONTAINS_REGEX",
                            _ => return None,
                        },
                        _ => return None,
                    };
                    self.punct("(")?;
                    self.punct("[")?;
                    let mut values = vec![self.string()?];
                    loop {
                        match self.next()? {
                            Token::Punct("]") => break,
                            Token::Punct(",") => values.push(self.string()?),
                            _ => return None,
                        }
                    }
                    self.punct(")")?;
                    // A regex target is converted only in the plain recorded form (`^ab$`): one the
                    // SDK's `new RegExp` always compiles and every dialect reads alike (ruling 5).
                    if operator == "STRING_CONTAINS_REGEX" && !values.iter().all(|v| plain_regex(v))
                    {
                        return None;
                    }
                    Some(signal_atom(operator, &key, &values))
                } else {
                    let operator = match self.comparison()? {
                        "<" => "NUMERIC_LESS_THAN",
                        "<=" => "NUMERIC_LESS_EQUAL",
                        "==" => "NUMERIC_EQUAL",
                        "!=" => "NUMERIC_NOT_EQUAL",
                        ">" => "NUMERIC_GREATER_THAN",
                        _ => "NUMERIC_GREATER_EQUAL",
                    };
                    // Recorded with an integer target only ("5"); other numerals stay unrecorded.
                    match self.next()? {
                        Token::Num(number) if number.bytes().all(|b| b.is_ascii_digit()) => {
                            Some(signal_atom(operator, &key, &[number]))
                        }
                        _ => None,
                    }
                }
            }
        }
    }

    /// `percent('seed') <= n`, `percent('seed') > n`, `percent('seed') between a and b`, and the
    /// unseeded `percent <= n`, the four recorded forms.
    fn percent(&mut self) -> Option<Value> {
        self.ident("percent")?;
        let seed = if self.peek() == Some(&Token::Punct("(")) {
            self.next();
            let seed = self.string()?;
            self.punct(")")?;
            Some(seed)
        } else {
            None
        };
        let mut atom = match self.next()? {
            Token::Punct("<=") => {
                json!({"percentOperator": "LESS_OR_EQUAL", "microPercent": self.micro()?})
            }
            Token::Punct(">") if seed.is_some() => {
                json!({"percentOperator": "GREATER_THAN", "microPercent": self.micro()?})
            }
            Token::Ident(word) if word == "between" && seed.is_some() => {
                let lower = self.micro()?;
                self.ident("and")?;
                let upper = self.micro()?;
                if lower > upper {
                    return None;
                }
                json!({"percentOperator": "BETWEEN", "microPercentRange": {
                    "microPercentLowerBound": lower,
                    "microPercentUpperBound": upper
                }})
            }
            _ => return None,
        };
        if let Some(seed) = seed {
            atom["seed"] = json!(seed);
        }
        Some(json!({ "percent": atom }))
    }

    /// A percentage from 0 to 100 with up to six decimals, in micro-percent.
    fn micro(&mut self) -> Option<u32> {
        let Token::Num(number) = self.next()? else {
            return None;
        };
        let (whole, fraction) = number.split_once('.').unwrap_or((&number, "0"));
        // An empty or dotted fraction ("5.", "5.1.2") fails to parse below.
        if fraction.len() > 6 {
            return None;
        }
        let scale = (fraction.len()..6).fold(1, |scale, _| scale * 10);
        // Checked, so that a large whole part is refused rather than wrapped.
        let micro = whole
            .parse::<u32>()
            .ok()?
            .checked_mul(1_000_000)?
            .checked_add(fraction.parse::<u32>().ok()? * scale)?;
        (micro <= 100_000_000).then_some(micro)
    }
}

/// A version the Admin SDK compares as the recorded `1.2.3`: one to five dot-separated runs of
/// ASCII digits (its `compareSemanticVersions` splits on `.`, reads each part as a number and
/// accepts at most five parts).
fn plain_version(target: &str) -> bool {
    let parts: Vec<_> = target.split('.').collect();
    parts.len() <= 5
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
}

/// A regular expression of the plain recorded form: an optional `^`, letters, digits, `_`, `-`,
/// space and `.`, and an optional `$`.
fn plain_regex(target: &str) -> bool {
    let body = target.strip_prefix('^').unwrap_or(target);
    let body = body.strip_suffix('$').unwrap_or(body);
    body.bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b' ' | b'.'))
}

fn signal_atom(operator: &str, key: &str, values: &[String]) -> Value {
    json!({"customSignal": {
        "customSignalOperator": operator,
        "customSignalKey": key,
        "targetCustomSignalValues": values
    }})
}

/// The atoms of a recorded `&&` chain, or `None` when `tokens` is not one.
fn chain(tokens: &[Token]) -> Option<Vec<Value>> {
    let mut parser = Parser {
        tokens: tokens.to_vec(),
        at: 0,
    };
    let mut atoms = vec![parser.atom()?];
    while parser.peek().is_some() {
        parser.punct("&&")?;
        atoms.push(parser.atom()?);
    }
    Some(atoms)
}

/// The structured condition for `expression`, or `{}` when the form was never recorded.
pub(crate) fn structured(expression: &str) -> Value {
    lex(expression).as_deref().and_then(chain).map_or_else(
        || json!({}),
        |atoms| json!({"orCondition": {"conditions": [{"andCondition": {"conditions": atoms}}]}}),
    )
}

/// The strict profile's refusal of a server condition, with production's recorded message
/// (RC-OBSERVE-V2-3 seq 54-57), for the recorded shapes only: `a || b` whose two operands are each
/// a recorded atom or chain, `!(a)` around one, and the whole literal `true` or `false`. Any other
/// text (an empty operand, a third term, a nested position) keeps the earlier answer: accepted and
/// served as `{}` (ruling 5).
pub(crate) fn strict_refusal(name: &str, expression: &str) -> Option<String> {
    let tokens = lex(expression)?;
    if let Some(at) = tokens.iter().position(|token| *token == Token::Punct("||")) {
        return (chain(&tokens[..at]).is_some() && chain(&tokens[at + 1..]).is_some()).then(|| {
            format!(
                "[VALIDATION_ERROR]: Expected exactly one term in OR condition for condition with name [{name}], found 2"
            )
        });
    }
    let atom = match tokens.as_slice() {
        [Token::Punct("!"), Token::Punct("("), inner @ .., Token::Punct(")")]
            if chain(inner).is_some() =>
        {
            "NOT"
        }
        [Token::Ident(word)] if word == "true" => "ALWAYS_TRUE",
        [Token::Ident(word)] if word == "false" => "ALWAYS_FALSE",
        _ => return None,
    };
    Some(format!(
        "[VALIDATION_ERROR]: CONDITION_ATOMS_FAIL_VALIDATION Validation error: {atom} condition is not allowed here @ {name}.OR[0].AND[0].{atom}"
    ))
}
