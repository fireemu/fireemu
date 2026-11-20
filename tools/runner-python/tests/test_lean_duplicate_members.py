"""Compare duplicate member resolution to the Lean reference through the body layouts."""

from pathlib import Path
import unittest

from fireemu_runner import bodies


CORPUS = Path(__file__).with_name("fixtures") / "lean-python-runner-duplicate-members.corpus"
LAYOUTS = {"compact": bodies.compact, "pubsub": bodies.pubsub_layout, "storage": bodies.storage_layout}


class LeanDuplicateMemberTests(unittest.TestCase):
    def test_key_aliases_keep_the_first_slot_and_last_lexeme(self):
        heading, *rows = CORPUS.read_text(encoding="ascii").splitlines()
        self.assertEqual(heading, "# shape|alias|repeat|layout|input-hex|output-hex")
        self.assertEqual(len(rows), 144)
        for row in rows:
            shape, alias, repeat, layout, raw, expected = row.split("|")
            with self.subTest(shape=shape, alias=alias, repeat=repeat, layout=layout):
                value = bodies.parse_keeping_numbers(bytes.fromhex(raw).decode("utf-8"))
                self.assertEqual(LAYOUTS[layout](value).encode("utf-8"), bytes.fromhex(expected))
