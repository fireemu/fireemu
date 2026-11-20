//! Replays terminal color policy with synthetic environment and TTY information.

use fireemu_adapter_support::term::decide;
use std::collections::BTreeMap;

#[test]
fn terminal_color_precedence_matches_lean() {
    let mut rows = include_str!("fixtures/lean-adapter-terminal-policy.corpus").lines();
    assert_eq!(
        rows.next(),
        Some("# optOut|force|disable|os|tty|capability|color")
    );
    let mut count = 0;
    for row in rows {
        let fields: Vec<_> = row.split('|').collect();
        let [opt_out, force, disable, os, tty, capability, color]: [&str; 7] =
            fields.try_into().unwrap();
        let mut env = BTreeMap::new();
        match opt_out {
            "empty" => {
                env.insert("NO_COLOR", "");
            }
            "set" => {
                env.insert("NO_COLOR", "0");
            }
            "unset" => {}
            _ => panic!("{row}"),
        }
        match force {
            "off" => {
                env.insert("CLICOLOR_FORCE", "FaLsE");
                env.insert("FORCE_COLOR", "0");
            }
            "cli" => {
                env.insert("CLICOLOR_FORCE", "1");
            }
            "force" => {
                env.insert("FORCE_COLOR", "anything");
            }
            "none" => {}
            _ => panic!("{row}"),
        }
        match capability {
            "term" => {
                env.insert("TERM", "xterm-256color");
            }
            "ansi" => {
                env.insert("ANSICON", "yes");
            }
            "conemu-on" => {
                env.insert("ConEmuANSI", "oN");
            }
            "conemu-off" => {
                env.insert("ConEmuANSI", "off");
            }
            "none" => {}
            _ => panic!("{row}"),
        }
        match disable {
            "dumb" => {
                env.insert("TERM", "dumb");
            }
            "zero" => {
                env.insert("CLICOLOR", "0");
            }
            "none" => {}
            _ => panic!("{row}"),
        }
        assert_eq!(
            decide(
                &|key| env.get(key).map(|value| (*value).to_owned()),
                tty == "yes",
                os == "windows"
            ),
            color.parse::<bool>().unwrap(),
            "{row}"
        );
        count += 1;
    }
    assert_eq!(count, 720);
}
