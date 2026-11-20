"""Replay Lean source-slice expectations in the slicer and the in-memory frame reader."""

import io
import json
from pathlib import Path
import unittest

from fireemu_runner.framing import raw_event_data, read_frame


CORPUS = Path(__file__).with_name("fixtures") / "lean-python-runner-event-data.corpus"


def unpack(encoded):
    return bytes.fromhex(encoded).decode("utf-8")


class LeanEventDataTests(unittest.TestCase):
    def test_source_selection_matches_lean(self):
        lines = CORPUS.read_text(encoding="ascii").splitlines()
        self.assertEqual(lines[0], "# seam|kind|outer|inner|boundary|input-hex|expected-hex-or-dash")
        sliced, framed = 0, 0
        seen = set()
        for row in lines[1:]:
            seam, kind, outer, inner, boundary, encoded, expected = row.split("|")
            text = unpack(encoded)
            want = None if expected == "-" else unpack(expected)
            case = (seam, kind, outer, inner, boundary)
            with self.subTest(case=case):
                self.assertNotIn(case, seen)
                seen.add(case)
                if seam == "slice":
                    sliced += 1
                    self.assertEqual(raw_event_data(text), want)
                elif seam == "frame":
                    framed += 1
                    payload = bytes.fromhex(encoded)
                    source = io.BytesIO(str(len(payload)).encode("ascii") + b"\n" + payload)
                    actual = read_frame(source)
                    if want is None:
                        self.assertNotIn("rawEventData", actual)
                    else:
                        self.assertEqual(actual["rawEventData"], want)
                    self.assertEqual(actual["event"], json.loads(text)["event"])
                    self.assertIsNone(read_frame(source))
                else:
                    self.fail(f"unexpected seam {seam!r}")
        self.assertEqual((sliced, framed), (420, 100))


if __name__ == "__main__":
    unittest.main()
