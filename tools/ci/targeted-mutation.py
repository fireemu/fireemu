#!/usr/bin/env python3
"""Run targeted-mutation over Cargo workspace packages and retain per-package evidence."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

VERSION = "0.1.0"
DIFF_CONFIG = {
    "diff.noprefix": "false",
    "diff.mnemonicPrefix": "false",
    "diff.srcPrefix": "a/",
    "diff.dstPrefix": "b/",
}


def run_package(package, output, scope, env):
    command = [
        "cargo", "tmt", "--locked", "--json", "--no-effects",
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
    if code not in (0, 2):
        return result
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        sites = report["sites"]
        gaps = bool(report["findings"] or report["unstable"])
        if report["package"] != package or gaps != (code == 2) or type(sites) is not int or sites < 0:
            return result
    except (KeyError, TypeError, ValueError):
        return result
    result["status"] = "gaps" if gaps else "no-gaps" if sites else "no-sites"
    result["sites"] = sites
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
    env = {**os.environ, "CARGO_BUILD_BUILD_DIR": str(output / "work" / "build")}
    scope = []
    if options.since is not None:
        scope = ["--since", options.since]
        # The 0.1.0 scope parser recognizes only the standard destination prefix.
        try:
            offset = int(env.get("GIT_CONFIG_COUNT") or "0")
            if offset < 0:
                raise ValueError
        except ValueError:
            return fail("GIT_CONFIG_COUNT must be a nonnegative integer")
        for index, (key, value) in enumerate(DIFF_CONFIG.items(), start=offset):
            env[f"GIT_CONFIG_KEY_{index}"] = key
            env[f"GIT_CONFIG_VALUE_{index}"] = value
        env["GIT_CONFIG_COUNT"] = str(offset + len(DIFF_CONFIG))

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
    summary = {"tool_version": VERSION, "since": options.since, "packages": results}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    statuses = {result["status"] for result in results}
    if "error" in statuses:
        return 1
    return 2 if "gaps" in statuses else 0


if __name__ == "__main__":
    raise SystemExit(main())
