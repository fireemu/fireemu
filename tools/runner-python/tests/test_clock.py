"""Unit tests for the Python Functions runner virtual clock."""

import datetime
import json
import time
import unittest

from fireemu_runner.clock import RuntimeClock, from_environment


class RuntimeClockTests(unittest.TestCase):
    def test_virtual_clock_patches_time_and_datetime_and_updates_on_clock_set(self):
        # 2026-06-01T00:00:00Z = 1780272000s
        base_sec = 1780272000
        clock = from_environment(
            {
                "FIREEMU_CLOCK_JSON": json.dumps(
                    {
                        "date": "virtual",
                        "instantNanos": str(base_sec * 1_000_000_000),
                        "elapsedNanos": "0",
                        "following": False,
                        "revision": "1",
                    }
                )
            }
        )
        clock.install()
        try:
            self.assertEqual(time.time_ns(), base_sec * 1_000_000_000)
            self.assertAlmostEqual(time.time(), float(base_sec), places=6)
            now = datetime.datetime.now(datetime.timezone.utc)
            self.assertEqual((now.year, now.month, now.day), (2026, 6, 1))

            # Advance by 1 day via clock:set frame
            next_sec = base_sec + 86400
            status = clock.update(
                {
                    "type": "clock:set",
                    "revision": "2",
                    "instantNanos": str(next_sec * 1_000_000_000),
                    "elapsedNanos": str(86400 * 1_000_000_000),
                    "following": False,
                }
            )
            self.assertEqual(status["instantNanos"], str(next_sec * 1_000_000_000))
            now2 = datetime.datetime.now(datetime.timezone.utc)
            self.assertEqual((now2.year, now2.month, now2.day), (2026, 6, 2))

            # Stale revision is rejected
            with self.assertRaises(ValueError):
                clock.update(
                    {
                        "type": "clock:set",
                        "revision": "1",
                        "instantNanos": str(base_sec * 1_000_000_000),
                        "elapsedNanos": "0",
                        "following": False,
                    }
                )
        finally:
            clock.uninstall()

    def test_real_policy_does_not_patch_clock(self):
        clock = RuntimeClock({"date": "real"})
        clock.install()
        self.assertFalse(clock._installed)


if __name__ == "__main__":
    unittest.main()
