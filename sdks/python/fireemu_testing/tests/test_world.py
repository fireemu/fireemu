"""End-to-end tests for the Python fireemu_testing Test World wrapper."""

import os
import unittest
from pathlib import Path

from fireemu_testing import create_test_world

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_BINARY = Path(os.environ.get("FIREEMU_TEST_BINARY", REPO_ROOT / "target" / "debug" / "fireemu"))


@unittest.skipUnless(DEFAULT_BINARY.is_file(), "requires built fireemu binary")
class PythonTestWorldTests(unittest.TestCase):
    def test_state_rewind_checkpoints_and_clock(self):
        with create_test_world(
            binary_path=DEFAULT_BINARY,
            services=("firestore", "pubsub", "appcheck"),
        ) as world:
            self.assertIn("firestore", world.endpoints)
            self.assertIn("appcheck", world.endpoints)
            world.control("POST", "/v1/sessions/default/clock:freeze", {})
            world.clock.set("2026-06-01T00:00:00Z", allow_backwards=True)
            base_cp = world.checkpoint("base")
            base_clock = world.clock.get()["clock"]["clock"]

            world.clock.advance(15_000)
            cp = world.checkpoint()
            cp_clock = world.clock.get()["clock"]["clock"]
            self.assertNotEqual(cp_clock, base_clock)

            world.clock.advance(30_000)
            world.restore(cp)
            self.assertEqual(world.clock.get()["clock"]["clock"], cp_clock)

            world.delete_checkpoint(cp)
            world.restore(base_cp)
            self.assertEqual(world.clock.get()["clock"]["clock"], base_clock)
            world.reset_state()


if __name__ == "__main__":
    unittest.main()
