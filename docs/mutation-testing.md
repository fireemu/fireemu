# Local mutation testing

## Rust: targeted-mutation

Install the version used by the workspace campaign runner:

```bash
cargo install targeted-mutation --version '=0.11.0' --locked
```

Run mutation tests from an independent, credential-free checkout in a loopback-only sandbox. On a Fireemu development machine, use the local mutation sandbox and run its guard before executing mutants. Give direct invocations their own work directory. TMT sets both Cargo output directories inside it. Keep the paths outside the source checkout so reports and caches stay out of later scans.

| Scope | Command or option | When to use it |
| --- | --- | --- |
| Line, range or file | `cargo tmt -p <package> --lines src/file.rs:20-35` | Investigate a boundary or a reported survivor. Repeat `--lines` to include several locations. Use just the path for a whole file. Paths are relative to the package. |
| Change | `python3 tools/ci/targeted-mutation.py --package <package> --since <base> --output-dir <new-directory>` | Check a reviewed diff against its merge base. TMT uses standard Git diff prefixes even if the checkout configures a different prefix. Untracked sources can also enter the selection. |
| Package | `cargo tmt -p <package>` | Review all supported sites in a package. Use `--also-test <package>` for relevant adapter or property tests in another member. Check the fixture requirements before using the transitive `--dependents` option. |
| Several packages | `python3 tools/ci/targeted-mutation.py --package <package> --package <package> --output-dir <new-directory>` | Repeat a campaign over a group. Add `--since <base>` to apply a shared diff. |
| Workspace | `python3 tools/ci/targeted-mutation.py --workspace --output-dir <new-directory>` | Inventory every Cargo workspace member with its default features on the current platform. Add `--since <base>` for a workspace-wide diff. |

For example, in the sandboxed checkout:

```bash
export PROPTEST_RNG_SEED=0
cargo tmt --locked --work-dir "$MUTATION_OUTPUT/limits" -p fireemu-core-limits --lines src/evaluate.rs --json
python3 tools/ci/targeted-mutation.py --workspace --since "$(git merge-base origin/main HEAD)" --output-dir "$MUTATION_OUTPUT/change"
```

The campaign runner processes packages sequentially and reuses its own build directory. It keeps `<package>.json` and `<package>.log` for every attempt and writes `summary.json` at the end. A completed campaign exits `1` if any analysis fails, `2` if it reports findings or unstable predictions, `3` if a package reports no executed mutants for a nonempty analysis, and `0` otherwise. When several outcomes occur, `1` takes precedence over `2`, then `3`. Each parsed report contributes its site and mutant counts to the summary. A `no-sites` diff skips the build and baseline. Setup errors go to stderr and command-line usage errors emit no report. Inspect the reports for unreached, skipped, unevaluated and unbuilt mutants before drawing coverage conclusions. The batch run skips propagation tracing and selects ordinary tests for each package. It attempts every requested package even when an incompatible test prevents a report. Rerun a focused selection without `--no-effects` for that diagnosis. Reproduce changes against the ordinary test suite and add assertions for observable behavior before rerunning the selection.

The campaign runner passes `--no-config` so local `tmt.toml` files cannot change its test selection or build options. Direct invocations of `cargo tmt` discover these files unless you pass `--no-config`.

Tracing and mutant replay need the same test inputs. The campaign uses `PROPTEST_RNG_SEED=0` by default and records the effective seed. Rerun with a different explicit seed to sample more inputs. For a direct run, set the seed in the sandbox before calling `cargo tmt`. Use `--audit` on a focused selection to check for trace drift.

Since version 0.4.0, targeted-mutation can build selected test targets directly when Cargo can express the selection. Check `analysis.test_selection.build_scope` in the JSON report. It is `selected_targets` when Cargo received the narrow selection and `package_wide` when Cargo needed the package-wide build. Use `--include-test` for exact test names, `--include-ignored` for explicitly selected ignored tests, and `--test-wrapper tools/ci/nextest-private-tmpdir.sh` to give each selected test a private temporary directory.

For CLI tests that clear the child environment, use `--source-only` on a small source scope. Source rebuilds preserve the test's environment behavior. For example:

```bash
cargo tmt --locked --work-dir "$MUTATION_OUTPUT/cli" -p fireemu --lines src/plan.rs:318 \
  --test-target plan --include-test an_unknown_allowed_name_is_a_usage_error --source-only --json
```

Use `--git-index` for tests that read the Git index and `--copy-fixture conformance/node_modules` after installing the pinned SDK dependencies. TMT's index snapshot supports tracked-file queries. Tests that require version history, nextest scheduling or process-leak detection, or verification of checked-in source digests still use their standard verification routes. For a focused package, add `--doc` for its doctests or `--rebuild` for mutants that need individual compilation. Use separate runs for feature sets and supported operating systems.

| Test suite | Mutation and verification route |
| --- | --- |
| Default unit and integration tests with tracked fixtures | Package or workspace targeted-mutation. Use explicit cross-package tests when the assertions live in a dependent crate. |
| Selected Git- or SDK-dependent tests | Focused targeted-mutation run with `--git-index`, explicitly copied fixtures and an isolated test selection. Use the existing Git and SDK setup in cargo-mutants/nextest for the full suite. |
| Platform-specific or feature-specific Rust tests | Run on the corresponding platform or with the corresponding Cargo features. |
| Loom, Kani and Quint | Use their dedicated configurations and workflows. |
| UI, Python runner and external SDK conformance | Use the existing targeted-mutation UI commands, mutmut and language-specific CI and conformance commands. |

Since 0.9.0 the JSON report's counts reconcile (`mutants_run = mutants_killed + mutants_survived`, with a `survivor_breakdown`), and `evaluation` is `partial` when some mutants were not evaluated, for example source-only mutants without `--rebuild`. The wrapper reports that as `no-gaps-partial` with the counts under `not_evaluated` in `summary.json`; it is not the same claim as `no-gaps`, so state the counts in a checklist. A report whose counts do not add up is an error.

## Rust: bounded campaigns

The repository enables `gitignore = true` in `.cargo/mutants.toml` so mutation sandboxes do not copy ignored worktrees, dependencies, or local evidence. Keep `--gitignore true` explicit when using `--no-config` or an alternate configuration. Do not use `--in-place` in a shared checkout.

With cargo-mutants 27.1.0, `--re` and `--exclude-re` do not filter struct-literal field deletions from expressions using `..Default::default()`. Use a reviewed `--in-diff` selection, which filters every mutation genre after discovery. A file or function regex alone does not bound a focused campaign.

Create the selection from the intended change (replace `<base>` and `<crate>` with the reviewed revision and package):

```bash
mkdir -p docs.local/mutation
git diff --no-ext-diff --unified=0 <base> -- crates/ > docs.local/mutation/selection.diff
cargo mutants --gitignore true --in-diff docs.local/mutation/selection.diff -p <crate> --list --json > docs.local/mutation/selected.json
```

Inspect `selected.json` before execution: require a nonempty list, confirm every file, source span and mutation genre, and check that the chosen tests cover every listed obligation. A zero-mutant run is not evidence. If selecting unchanged validation branches, create a separate virtual diff and label it **selection artifact, not a production patch**; review its added-line positions against the current source.

Then run the same selection and package with the intended tests:

```bash
cargo mutants --gitignore true --in-diff docs.local/mutation/selection.diff -p <crate> --output docs.local/mutation -- --profile pr
```

Retain the tool version, source commit, selection diff, reviewed list, test arguments and results together. Re-list after changing source, selection or tool versions. Missed unrelated mutants from a regex-only run do not establish that their full relevant test suites are inadequate.

## Rust: scheduled runs on GitHub

`heavy-verification.yml` runs mutation testing on a schedule, on the default branch only. All three runs reuse the manual `mutants` job (shards, `--sharding slice`, the `mutants-summary` merge); they only choose what to mutate.

| Run | When | What is mutated | A missed mutant |
| --- | --- | --- | --- |
| nightly | every day, 03:23 UTC | the Rust diff from the head of the last successful scheduled nightly (else the commit of 24 hours ago) to the head of the default branch, 8 shards | fails the run on a new survivor in a critical file |
| weekly | Saturdays, 04:41 UTC | one line of `tools/ci/mutation-weekly.txt`: line `ISO week mod number of lines`, 16 shards | is reported only (the run passes) |
| critical | Monday, Wednesday and Friday, 05:17 UTC | the functions and files of `tools/ci/mutation-critical.txt`, selected by the regex that `tools/ci/critical-selection.py --regex` prints (about 500 mutants when written), 16 shards | fails the run on a new survivor in a critical file |

- The critical run selects by name, not by `--file`: a measurement showed `cargo mutants --list --file <glob>` listing the whole package, while `--re` filtered. A scoped entry (`<path> @ <function> ...`) selects only the mutants inside those functions. The weekly run selects its line's files the same way: `tools/ci/rotation-selection.py` turns the line and the package's files from the commit under test into a regex, and the run passes `-p <package> --re <regex>`. The regex carries exclusions, because cargo-mutants has no lookaround. Like the critical run, `--re` also keeps struct field deletions of the same package outside the line's files, so a weekly run mutates a few more mutants than its files hold (this week's line: 1658 listed, 38 of them field deletions).
- A nightly whose diff holds no `.rs` file mutates nothing and passes. A failed nightly keeps its base, so its survivors stay in the diff until they are killed or accepted; cancelled and skipped runs also leave the base unchanged.
- In `tools/ci/mutation-survivors.txt`, a survivor key is its file and replacement without the line and column (`<file>: <replacement>`). Accept a survivor by adding its key with a reason comment above it to that file and committing it; accepted keys never fail a run, and a key that no longer appears is harmless.
- The weekly rotation walks the whole workspace in about one turn per year. A package too big for the 360-minute shard limit is split by file over several lines; the last line of a split package excludes the files of the other lines, so a new file is still mutated by it. The runners are Linux, so a file compiled for macOS only is excluded on its line and a macOS-only package is left out (its mutants would all read as missed). Add a new crate to the file, and regenerate the counts in the comments with `cargo mutants --list -p <package> --file <glob>`.
- Results are in the run's step summary (the `mutants-summary` job) and in the `mutants-summary` artifact (`summary/summary.md` and the per-shard outcomes). The run title says `heavy-verification scheduled nightly`, `weekly` or `critical`.
- Try these modes by hand from a pushed branch: `gh workflow run heavy-verification.yml --ref <branch> -f job=nightly -f ref=<branch>` (or `-f job=weekly -f package=<package>` to take that package's first line). A dispatch never runs from the default branch, and a nightly dispatch takes its base the same way as the scheduled one.
- Safety: only `schedule` and `workflow_dispatch` start the workflow (never `pull_request` or `pull_request_target`), the token is `contents: read`, there are no secrets, no job saves a cache, and one scheduled run goes at a time. `scripts/heavy-verification-contract.rb` pins all of this.
- GitHub starts a schedule only from the default branch, so nothing runs until the workflow is merged there. GitHub also disables scheduled workflows of a repository without activity for 60 days; a push or a manual run re-enables them.

## UI: targeted-mutation

Run `pnpm -C ui mutation:sanity` before trusting a UI mutation campaign. It runs `targeted-mutation` against the scope-transition guard selected by an exact source anchor in `src/lib/unsaved.tsx`, and requires a clean evaluated run where every selected mutant is killed. A missing or ambiguous anchor, empty selection, survivor, unreached edit, timeout, extraction diagnostic, or runner error fails the command. Results are written to `ui/test-results/mutation-sanity.json`; the exit status is checked against the current in-memory report, not an old file.

The sanity command deliberately exercises a small known behavior-changing slice. It does not claim mutation coverage for the whole UI. Run `pnpm -C ui mutation` for the configured `src/lib` and core `src/api` selection, or pass arguments through for a focused campaign, for example:

```sh
pnpm -C ui mutation -- src/lib/firestoreJson.ts --test src/lib/firestoreJson.test.ts --suggest-assertions
pnpm -C ui mutation -- --since "$(git merge-base origin/main HEAD)" --undo-changes
pnpm -C ui mutation -- src/lib/rtdbTree.ts --test src/lib/rtdbTree.test.ts --mutators full
```

The UI pins `targeted-mutation` 0.7.0 in `ui/package.json` and `ui/pnpm-lock.yaml`. Rerun `pnpm -C ui mutation:sanity` after Vitest or dependency upgrades.
