# Python JSON duplicate members

Python runner bodies preserve the first insertion slot of a decoded key and use its final value, including when literal and escaped key spellings decode to the same name. The compact layout exposes insertion slots, while Pub/Sub and Storage apply their respective sort orders after decoding. Numeric values retain the final exact lexeme.

The model separates decoded keys from their source spelling. The theorems show that replacement preserves key order, an absent key is appended, lookup returns the latest value, and an update to a distinct key leaves the other lookup unchanged. The fixtures replay all three layouts after the production Python decoder, using both known Cloud Storage names and Unicode unranked keys.

```sh
lake build
lake exe corpus > ../../../tools/runner-python/tests/fixtures/lean-python-runner-duplicate-members.corpus
```

From the repository root run `PYTHONPATH=tools/runner-python python3 -m unittest discover -s tools/runner-python/tests -p test_lean_duplicate_members.py`.
