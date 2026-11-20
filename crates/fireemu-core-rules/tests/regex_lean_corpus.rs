//! Replay the derivative specification in verification/lean/rules-regex through the public API.

use fireemu_core_rules::regex::Regex;
use proptest::prelude::*;

const CORPUS: &str = include_str!("fixtures/lean-rules-regex.corpus");

fn decode(hex: &str) -> String {
    assert!(hex.is_ascii() && hex.len() % 2 == 0);
    let bytes = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex byte"))
        .collect();
    String::from_utf8(bytes).expect("UTF-8")
}

#[test]
fn full_matches_agree_with_the_lean_corpus() {
    let mut lines = CORPUS.lines();
    let declared: usize = lines
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .and_then(|line| line.strip_suffix(" cases"))
        .expect("case count header")
        .parse()
        .expect("numeric count");
    let mut count = 0;
    for line in lines {
        count += 1;
        let mut fields = line.split('\t');
        let verdict = fields.next().unwrap();
        let pattern = decode(fields.next().expect("pattern"));
        let subject = decode(fields.next().expect("subject"));
        assert!(fields.next().is_none(), "extra field in case {count}");
        let actual = Regex::new(&pattern);
        match verdict {
            "refuse" => assert!(actual.is_err(), "case {count}: compiled {pattern:?}"),
            "match" | "miss" => assert_eq!(
                actual
                    .unwrap_or_else(|e| panic!("case {count}: {pattern:?}: {e}"))
                    .is_full_match(&subject),
                Ok(verdict == "match"),
                "case {count}: {pattern:?} on {subject:?}"
            ),
            _ => panic!("case {count}: unknown verdict {verdict}"),
        }
    }
    assert_eq!(count, declared);
    assert!(count >= 200);
}

#[test]
fn nesting_preflight_respects_class_boundaries() {
    for (pattern, matching, missing) in [
        ("[^^]", "a", "^"),
        ("[^]]", "a", "]"),
        ("[]^]", "^", "a"),
        ("[^^][](((((((((]", "a(", "^("),
    ] {
        let regex = Regex::new(pattern).unwrap_or_else(|e| panic!("{pattern:?}: {e}"));
        assert_eq!(regex.is_full_match(matching), Ok(true), "{pattern:?}");
        assert_eq!(regex.is_full_match(missing), Ok(false), "{pattern:?}");
    }

    for (pattern, error) in [
        ("[^^](", "unterminated group"),
        ("(((((((((a)))))))))", "pattern nesting too deep"),
        ("[^^](((((((((a)))))))))", "pattern nesting too deep"),
    ] {
        assert_eq!(Regex::new(pattern).unwrap_err().0, error, "{pattern:?}");
    }
}

proptest! {
    /// RR.matches_iff and RR.nullable_iff for a concatenation of Unicode literal factors.
    #[test]
    fn concatenation_matches_its_denotation(
        left in "[a-cé]{0,4}", right in "[a-cé]{0,4}", text in "[a-cé]{0,9}",
    ) {
        let word = format!("{left}{right}");
        let pattern = Regex::new(&format!("({left})({right})")).unwrap();
        prop_assert_eq!(pattern.is_full_match("").unwrap(), word.is_empty());
        prop_assert!(pattern.is_full_match(&word).unwrap());
        prop_assert_eq!(pattern.is_full_match(&text).unwrap(), text == word);
    }

    /// RR.deriv_iff: the possible first scalars of (ab|🦀)* leave three distinct residuals.
    #[test]
    fn consuming_a_scalar_matches_the_residual(
        c in prop::sample::select(vec!['a', 'b', '🦀', '\n']),
        words in prop::collection::vec(prop::sample::select(vec!["ab", "🦀", "a", "b"]), 0..7),
    ) {
        let suffix = words.concat();
        let r = Regex::new("(ab|🦀)*").unwrap();
        let residual = match c {
            'a' => Regex::new("b(ab|🦀)*").unwrap().is_full_match(&suffix).unwrap(),
            '🦀' => r.is_full_match(&suffix).unwrap(),
            _ => false,
        };
        let whole = format!("{c}{suffix}");
        prop_assert_eq!(r.is_full_match(&whole).unwrap(), residual);
    }

    /// RR.bounded_expansion and RR.open_expansion on accepted bounds, including zero.
    #[test]
    fn repetition_matches_its_expansion(
        lo in 0usize..4, extra in 0usize..4, count in 0usize..9, other in any::<bool>(),
    ) {
        let subject = format!("{}{}", "é".repeat(count), if other { "x" } else { "" });
        let hi = lo + extra;
        let required = "é".repeat(lo);
        for (pattern, expanded, in_range) in [
            (format!("é{{{lo}}}"), required.clone(), count == lo),
            (format!("é{{{lo},{hi}}}"), format!("{required}{}", "é?".repeat(extra)), (lo..=hi).contains(&count)),
            (format!("é{{{lo},}}"), format!("{required}é*"), count >= lo),
        ] {
            let actual = Regex::new(&pattern).unwrap().is_full_match(&subject).unwrap();
            prop_assert_eq!(actual, !other && in_range);
            prop_assert_eq!(actual, Regex::new(&expanded).unwrap().is_full_match(&subject).unwrap());
        }
    }
}
