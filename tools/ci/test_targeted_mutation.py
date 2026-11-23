"""Contract tests for the workspace targeted-mutation campaign."""

import csv
from contextlib import redirect_stderr, redirect_stdout
import io
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "targeted_mutation", Path(__file__).with_name("targeted-mutation.py")
)
campaign = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(campaign)

PACKAGES = ["core", "adapter"]
METADATA = {
    "workspace_root": "/checkout",
    "target_directory": "/checkout/target",
    "build_directory": "/normal/build",
    "workspace_members": ["path+core", "path+adapter"],
    "packages": [
        {"id": "path+core", "name": "core"},
        {"id": "path+adapter", "name": "adapter"},
        {"id": "path+foreign", "name": "foreign"},
    ],
}
OUTCOMES = {
    "clean": (0, {"sites": 4, "mutants_run": 5, "findings": [], "unstable": []}, "no-gaps"),
    "findings": (2, {"sites": 4, "mutants_run": 5, "findings": [{}], "unstable": []}, "gaps"),
    "failure": (1, None, "error"),
    "empty": (
        0, {"sites": 0, "mutants_run": 0, "evaluation": "no_sites", "findings": [], "unstable": []},
        "no-sites",
    ),
    "unexecuted": (
        3, {"sites": 4, "mutants_run": 0, "evaluation": "no_mutants_executed", "findings": [], "unstable": []},
        "no-mutants-executed",
    ),
    "skipped": (
        3,
        {
            "sites": 0, "mutants_run": 0, "evaluation": "no_mutants_executed",
            "skipped": [{}], "findings": [], "unstable": [],
        },
        "no-mutants-executed",
    ),
    "unstable": (2, {"sites": 4, "mutants_run": 5, "findings": [], "unstable": [{}]}, "gaps"),
    "invalid-unexecuted": (3, {"sites": 4, "mutants_run": 0, "findings": [], "unstable": []}, "error"),
    "invalid": (2, None, "error"),
    "launch-error": (None, None, "error"),
}
DEFAULT_ROWS = [
    {"Selection": "workspace", "Source": "full", "Result": "failure", "Position": "first"},
    {"Selection": "packages", "Source": "diff", "Result": "findings", "Position": "last"},
    {"Selection": "workspace", "Source": "diff", "Result": "empty", "Position": "last"},
    {"Selection": "packages", "Source": "full", "Result": "unexecuted", "Position": "last"},
]


class CampaignTest(unittest.TestCase):
    def run_campaign(self, output, selection, scope, outcomes, *, seed=None):
        output = output.resolve()
        launched = []
        environment = {
            "CARGO_BUILD_BUILD_DIR": "/normal/build",
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "diff.noprefix",
            "GIT_CONFIG_VALUE_0": "true",
        }
        if seed is not None:
            environment["PROPTEST_RNG_SEED"] = seed

        def cargo(args, **kwargs):
            if args[1] == "metadata":
                return subprocess.CompletedProcess(args, 0, json.dumps(METADATA))
            if args == ["cargo", "tmt", "--version"]:
                return subprocess.CompletedProcess(args, 0, "cargo-tmt 0.6.0\n")
            package = args[args.index("--package") + 1]
            launched.append(package)
            self.assertEqual(kwargs["env"]["PROPTEST_RNG_SEED"], seed or "0")
            self.assertIn("--locked", args)
            self.assertIn("--json", args)
            self.assertEqual(Path(args[args.index("--work-dir") + 1]), output / "work")
            self.assertEqual(kwargs["env"]["CARGO_BUILD_BUILD_DIR"], "/normal/build")
            if scope:
                self.assertEqual(args[-2:], scope)
                self.assertEqual(kwargs["env"]["GIT_CONFIG_VALUE_0"], "true")
                self.assertEqual(kwargs["env"]["GIT_CONFIG_COUNT"], "1")
            else:
                self.assertNotIn("--since", args)
            code, report, _ = OUTCOMES[outcomes[package]]
            if code is None:
                raise OSError("could not start cargo")
            if report is not None:
                kwargs["stdout"].write(json.dumps({"package": package, **report}))
            if code == 1:
                kwargs["stderr"].write("baseline failed\n")
            return subprocess.CompletedProcess(args, code)

        with (
            redirect_stdout(io.StringIO()),
            redirect_stderr(io.StringIO()),
            patch.object(campaign.subprocess, "run", side_effect=cargo),
            patch.dict(os.environ, environment, clear=True),
        ):
            code = campaign.main([*selection, *scope, "--output-dir", str(output)])
        return code, launched

    def test_campaign_matrix(self):
        rows = DEFAULT_ROWS
        if path := os.environ.get("FIREEMU_TARGETED_MUTATION_PICT"):
            with open(path, newline="", encoding="utf-8") as table:
                rows = list(csv.DictReader(table, delimiter="\t"))
        self.assertTrue(rows)

        for row in rows:
            with self.subTest(**row), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "results"
                selection = ["--workspace"]
                if row["Selection"] == "packages":
                    selection = ["--package", "core", "--package", "adapter", "--package", "core"]
                scope = ["--since", "review-base"] if row["Source"] == "diff" else []
                selected = "core" if row["Position"] == "first" else "adapter"
                outcomes = dict.fromkeys(PACKAGES, "clean")
                outcomes[selected] = row["Result"]
                expected_code, _, _ = OUTCOMES[row["Result"]]
                code, launched = self.run_campaign(output, selection, scope, outcomes)
                self.assertEqual(code, expected_code)
                self.assertEqual(launched, PACKAGES)
                summary = json.loads((output / "summary.json").read_text())
                self.assertEqual(summary["tool_version"], "0.6.0")
                self.assertEqual(summary["since"], "review-base" if scope else None)
                for result in summary["packages"]:
                    report = OUTCOMES[outcomes[result["package"]]][1]
                    if report is not None:
                        self.assertEqual(result["mutants_run"], report["mutants_run"])
                self.assertEqual(
                    [result["status"] for result in summary["packages"]],
                    [OUTCOMES[outcomes[package]][2] for package in PACKAGES],
                )
                for package in PACKAGES:
                    self.assertTrue((output / f"{package}.json").is_file())
                    self.assertTrue((output / f"{package}.log").is_file())
                self.assertTrue((output / ".fireemu-mutation-output").is_file())

    def test_explicit_property_test_seed_is_preserved_and_recorded(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "results"
            code, launched = self.run_campaign(
                output, ["--package", "core"], [], {"core": "clean"}, seed="1234"
            )
            self.assertEqual(code, 0)
            self.assertEqual(launched, ["core"])
            summary = json.loads((output / "summary.json").read_text())
            self.assertEqual(summary["proptest_rng_seed"], "1234")

    def test_execution_failure_takes_precedence_over_findings(self):
        with tempfile.TemporaryDirectory() as directory:
            code, launched = self.run_campaign(
                Path(directory) / "results", ["--workspace"], [],
                {"core": "findings", "adapter": "invalid"},
            )
        self.assertEqual(code, 1)
        self.assertEqual(launched, PACKAGES)

    def test_no_mutants_outcome_precedence_and_report_validation(self):
        cases = [
            ("empty", 3),
            ("findings", 2),
            ("unstable", 2),
            ("failure", 1),
            ("invalid-unexecuted", 1),
        ]
        for second, expected in cases:
            with self.subTest(second=second), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "results"
                code, launched = self.run_campaign(
                    output, ["--workspace"], [], {"core": "skipped", "adapter": second},
                )
                self.assertEqual(code, expected)
                self.assertEqual(launched, PACKAGES)
                summary = json.loads((output / "summary.json").read_text())
                self.assertEqual(summary["packages"][0]["status"], "no-mutants-executed")

    def test_launch_error_preserves_later_package_results(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "results"
            code, launched = self.run_campaign(
                output, ["--workspace"], [], {"core": "launch-error", "adapter": "clean"}
            )
            self.assertEqual(code, 1)
            self.assertEqual(launched, PACKAGES)
            self.assertIn("could not start cargo", (output / "core.log").read_text())
            summary = json.loads((output / "summary.json").read_text())
            self.assertIsNone(summary["packages"][0]["exit_code"])
            self.assertEqual(summary["packages"][1]["status"], "no-gaps")

    def test_missing_or_wrong_tool_is_an_execution_failure(self):
        for tool in [FileNotFoundError("cargo"), subprocess.CompletedProcess([], 0, "cargo-tmt 0.2.0")]:
            with self.subTest(tool=tool), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "results"
                with (
                    redirect_stderr(io.StringIO()),
                    patch.object(campaign.subprocess, "run", side_effect=[tool]),
                ):
                    self.assertEqual(campaign.main(["--workspace", "--output-dir", str(output)]), 1)
                self.assertFalse(output.exists())

    def test_mutation_output_cannot_share_normal_build_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory).resolve() / "results"
            with patch.dict(METADATA, {"build_directory": str(output / "work" / "target")}):
                self.assertEqual(self.run_campaign(output, ["--workspace"], [], {}), (1, []))
            self.assertFalse(output.exists())

    def test_unknown_package_and_existing_output_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "results"
            with self.assertRaises(SystemExit):
                self.run_campaign(output, ["--package", "foreign"], [], {})
            self.assertFalse(output.exists())
            output.mkdir()
            marker = output / "summary.json"
            marker.write_text("previous report")
            self.assertEqual(self.run_campaign(output, ["--workspace"], [], {}), (1, []))
            self.assertEqual(marker.read_text(), "previous report")


if __name__ == "__main__":
    unittest.main()
