"""Replay the production CRC32C oracle tests with the pinned software fallback."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class SoftwareFallbackTest(unittest.TestCase):
    def test_software_fallback_matches_production_bitwise_oracle(self):
        repository = Path(__file__).resolve().parents[3]
        common_dir = Path(subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            check=True, capture_output=True, text=True, cwd=repository,
        ).stdout.strip())
        metadata = json.loads(subprocess.run(
            ["cargo", "metadata", "--manifest-path", str(Path(__file__).with_name("Cargo.toml")),
             "--offline", "--locked", "--format-version", "1"],
            check=True, capture_output=True, text=True,
        ).stdout)
        dependency = next(package for package in metadata["packages"]
                          if package["name"] == "crc32c" and package["version"] == "0.6.9")
        output = repository / "target" / "codex-out"
        output.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="checksum-software-", dir=output) as directory:
            scratch = Path(directory)
            copied = scratch / "crc32c"
            shutil.copytree(Path(dependency["manifest_path"]).parent, copied)
            dispatch = copied / "src" / "lib.rs"
            source = dispatch.read_text(encoding="utf-8")
            # Simulate absent CPU features without changing the software implementation.
            for condition in ['is_x86_feature_detected!("sse4.2")',
                              'std::arch::is_aarch64_feature_detected!("crc")']:
                self.assertEqual(source.count(f"if {condition} {{"), 1)
                source = source.replace(f"if {condition} {{", f"if false && {condition} {{")
            dispatch.write_text(source, encoding="utf-8")
            shutil.copyfile(repository / "crates" / "fireemu-core-types" / "src" / "hash.rs",
                            scratch / "hash.rs")
            shutil.copyfile(repository / "Cargo.lock", scratch / "Cargo.lock")
            proptest = next(line.removeprefix("proptest = ") for line in
                            (repository / "Cargo.toml").read_text(encoding="utf-8").splitlines()
                            if line.startswith("proptest = "))
            (scratch / "Cargo.toml").write_text(
                '[package]\nname = "checksum-software-check"\nversion = "0.0.0"\n'
                'edition = "2021"\npublish = false\n[workspace]\n'
                '[lib]\npath = "hash.rs"\n'
                '[dependencies]\ncrc32c = { version = "=0.6.9", path = "crc32c" }\n'
                f'[dev-dependencies]\nproptest = {proptest}\n',
                encoding="utf-8",
            )
            subprocess.run(
                [str(common_dir.parent / "docs.local" / "tools" / "heavy-slot"),
                 "run", "--lane", "codex", "--", "cargo", "test", "--offline",
                 "--manifest-path", str(scratch / "Cargo.toml"),
                 "--target-dir", "target/checksum-software",
                 "--lib", "crc32c_update_tests"],
                check=True, cwd=repository,
                env={**os.environ, "RUSTC_WRAPPER": "", "CARGO_INCREMENTAL": "0"},
            )


if __name__ == "__main__":
    unittest.main()
