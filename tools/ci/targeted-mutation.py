#!/usr/bin/env python3
"""Run targeted-mutation over Cargo workspace packages and retain per-package evidence."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

VERSION = "0.11.0"


def run_package(package, output, scope, env):
    command = [
        "cargo", "tmt", "--no-config", "--locked", "--json", "--no-effects",
        "--work-dir", str(output / "work"), "--package", package, *scope,
    ]
    report_path = output / f"{package}.json"
    log_path = output / f"{package}.log"
    result = {"package": package, "exit_code": None, "status": "error"}
    with report_path.open("w", encoding="utf-8") as report, log_path.open("w", encoding="utf-8") as log:
        try:
            code = subprocess.run(command, env=env, stdout=report, stderr=log, check=False).returncode
        except OSError as error:
            print(f"failed to start targeted-mutation: {error}", file=log)
            return result

    result["exit_code"] = code
    if code not in (0, 2, 3):
        return result
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        sites = report["sites"]
        mutants_run = report["mutants_run"]
        gaps = bool(report["findings"] or report["unstable"])
        if (
            report["package"] != package
            or type(sites) is not int or sites < 0
            or type(mutants_run) is not int or mutants_run < 0
        ):
            return result
    except (KeyError, TypeError, ValueError):
        return result

    evaluation = report.get("evaluation")
    if gaps:
        expected_code, status = 2, "gaps"
    elif evaluation == "no_sites" and sites == mutants_run == 0:
        expected_code, status = 0, "no-sites"
    elif evaluation == "no_mutants_executed" and mutants_run == 0:
        expected_code, status = 3, "no-mutants-executed"
    elif evaluation is None and mutants_run > 0:
        expected_code, status = 0, "no-gaps"
    elif evaluation == "partial" and mutants_run > 0:
        # No gap among the evaluated mutants, but some were not evaluated (for example source-only
        # mutants without --rebuild). The counts below say how many; this is not "no-gaps".
        expected_code, status = 0, "no-gaps-partial"
    else:
        return result
    # Since 0.9.0 the counts reconcile; a report whose counts do not add up is an error.
    if "mutants_survived" in report:
        try:
            breakdown = report["survivor_breakdown"]
            if (
                report["mutants_run"] != report["mutants_killed"] + report["mutants_survived"]
                or report["mutants_survived"] != sum(breakdown.values())
            ):
                return result
        except (KeyError, TypeError, AttributeError):
            return result
    if code == expected_code:
        result.update(status=status, sites=sites, mutants_run=mutants_run)
        if status == "no-gaps-partial":
            result["not_evaluated"] = {
                key: report[key]
                for key in ("mutants_not_built", "mutants_not_evaluated", "skipped_sites")
                if type(report.get(key)) is int and report[key] > 0
            }
    return result


def fail(message):
    print(f"targeted-mutation: {message}", file=sys.stderr)
    return 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--workspace", action="store_true", help="scan each Cargo workspace member")
    selection.add_argument("--package", action="append", help="scan a named member (repeatable)")
    parser.add_argument("--since", metavar="REV", help="restrict each analysis to changes since REV")
    parser.add_argument("--output-dir", required=True, type=Path, help="new directory for reports and the mutation build")
    options = parser.parse_args(argv)

    try:
        version = subprocess.run(["cargo", "tmt", "--version"], check=True, capture_output=True, text=True)
        if version.stdout.strip() != f"cargo-tmt {VERSION}":
            return fail(f"install targeted-mutation {VERSION} before running a campaign")
        metadata = subprocess.run(
            ["cargo", "metadata", "--no-deps", "--format-version", "1", "--locked"],
            check=True, stdout=subprocess.PIPE, text=True,
        )
        workspace = json.loads(metadata.stdout)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        return fail(f"Cargo workspace or targeted-mutation unavailable: {error}")

    members = set(workspace["workspace_members"])
    packages = [package["name"] for package in workspace["packages"] if package["id"] in members]
    selected = list(dict.fromkeys(options.package)) if options.package else packages
    unknown = set(selected).difference(packages)
    if unknown:
        parser.error(f"unknown workspace package(s): {', '.join(sorted(unknown))}")
    if not selected:
        parser.error("there are no Cargo workspace packages to scan")

    output = options.output_dir.resolve()
    seed = os.environ.get("PROPTEST_RNG_SEED") or "0"
    env = {**os.environ, "PROPTEST_RNG_SEED": seed}
    scope = ["--since", options.since] if options.since is not None else []

    try:
        for key in ("workspace_root", "target_directory", "build_directory"):
            protected = Path(workspace[key]).resolve()
            if output == protected or output in protected.parents or protected in output.parents:
                return fail(f"output directory overlaps Cargo's {key} ({protected})")
        output.mkdir(parents=True)
        marker = output / ".fireemu-mutation-output"
        marker.write_text(f"targeted-mutation {VERSION}\n", encoding="utf-8")
    except KeyError:
        return fail("Cargo metadata must report both target and build directories")
    except OSError as error:
        return fail(f"cannot create a new output directory: {error}")

    results = []
    for package in selected:
        print(f"targeted-mutation: {package}", flush=True)
        result = run_package(package, output, scope, env)
        results.append(result)
        print(f"targeted-mutation: {package}: {result['status']}", flush=True)
    summary = {
        "tool_version": VERSION,
        "since": options.since,
        "proptest_rng_seed": seed,
        "packages": results,
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    statuses = {result["status"] for result in results}
    for status, code in (("error", 1), ("gaps", 2), ("no-mutants-executed", 3)):
        if status in statuses:
            return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
