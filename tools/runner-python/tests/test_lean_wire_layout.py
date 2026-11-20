"""Replay the Lean runner wire-layout corpus through the Python JSON writer."""

from pathlib import Path
import unittest

from fireemu_runner import bodies


CORPUS = Path(__file__).with_name("fixtures") / "lean-python-runner-wire-layout.corpus"
WRITERS = {
    "compact": bodies.compact,
    "pubsub": bodies.pubsub_layout,
    "storage": bodies.storage_layout,
}


def unpack(text):
    return bytes.fromhex(text).decode("utf-8")


class LeanWireLayoutTests(unittest.TestCase):
    def test_layout_and_number_lexemes_match_lean(self):
        lines = CORPUS.read_text(encoding="ascii").splitlines()
        self.assertEqual(lines[0], "# id|layout|number|shape|order|input-hex|output-hex")
        self.assertEqual(len(lines[1:]), 180)
        seen = set()
        for row in lines[1:]:
            name, layout, number, shape, order, raw, expected = row.split("|")
            with self.subTest(case=name):
                self.assertEqual(name, "/".join((layout, number, shape, order)))
                self.assertNotIn(name, seen)
                seen.add(name)
                written = WRITERS[layout](bodies.parse_keeping_numbers(unpack(raw)))
                self.assertEqual(written.encode("utf-8"), bytes.fromhex(expected))


if __name__ == "__main__":
    unittest.main()
