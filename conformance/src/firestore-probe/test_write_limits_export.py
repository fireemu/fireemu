"""Batch 3 recipes: sizes are exact, informative and tied to the recorded fits."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

MODULE = Path(__file__).with_name("write_limits_export.py")
MANIFEST = Path(__file__).with_name("write-limits-set.json")
SINGLE_FIELD_REFUSED_FROM = 5_531
NAME_ENTRY_REFUSED_FROM = 4_645


def _module():
    spec = importlib.util.spec_from_file_location("write_limits_export", MODULE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _segments(relative: str) -> list[str]:
    return relative.split("/")


def test_the_fit_reproduces_the_two_recorded_create_charges() -> None:
    module = _module()
    assert module.create_charge_at_2000(7_184) == 29_650_337
    assert module.create_charge_at_2000(7_185) == 29_654_463
    assert module.create_charge_at_2000(7_184) < module.TRANSACTION_BYTES
    assert module.create_charge_at_2000(7_185) > module.TRANSACTION_BYTES


def test_budget_documents_hit_their_fraction_and_the_sums_straddle_the_budget() -> None:
    module = _module()
    budget = module.TRANSACTION_BYTES
    for variant, documents, fraction, route in module.BUDGET_VARIANTS:
        count = module.array_count_for_fraction(fraction)
        charge = module.create_charge_at_2000(count)
        assert abs(charge / budget - fraction) < 0.001, variant
        assert (documents * charge > budget) == (fraction * documents > 1.0), variant
        assert route in ("commit", "batch-write")
    sums = {v: n * f for v, n, f, _ in module.BUDGET_VARIANTS}
    assert sums["40x2"] < 1.0 < sums["55x2"] < sums["60x2"]
    assert sums["60x1"] < 1.0 and sums["40x3"] > 1.0


def test_every_budget_program_is_one_write_of_distinct_two_thousand_byte_names() -> None:
    module = _module()
    seen: set[str] = set()
    for program in module.build_programs():
        if "/commit-budget/" not in program["id"]:
            continue
        step = program["steps"][0]
        writes = step["body"]["writes"]
        names = [write["update"]["name"] for write in writes]
        assert len(names) == len(set(names))
        assert not seen & set(names)
        seen |= set(names)
        for name in names:
            relative = name.split("/documents/", 1)[1]
            assert module.name_size(_segments(relative)) == 2_017
            values = [
                v["integerValue"] for v in writes[0]["update"]["fields"]["a"]["arrayValue"]["values"]
            ]
            assert values == [str(i) for i in range(len(values))]
        assert step["path"].endswith((":commit", ":batchWrite"))


def test_composite_entries_are_exact_and_leave_single_field_entries_below_the_refusal() -> None:
    module = _module()
    for entry in (*module.COMPOSITE_HEAVY_ENTRIES, *module.COMPOSITE_LIGHT_ENTRIES):
        for second in (module.INDEXED_STRING_BYTES, module.LIGHT_SECOND_BYTES):
            try:
                relative, _ = module.composite_names(entry, second)
            except ValueError:
                continue
            document = _segments(relative)
            parent = document[:-2]
            assert document[-2] == "flt"
            values = module.indexed_value_bytes(1_500) + module.indexed_value_bytes(second)
            composite = module.name_size(document) + module.name_size(parent) + values + 32
            assert composite == entry
            assert module.name_size(document) < NAME_ENTRY_REFUSED_FROM
            # The larger string's own single-field entry (collection scope) must stay accepted.
            single = module.name_size(document) + module.name_size(parent) + 2 + 1_500 + 32
            if second == module.INDEXED_STRING_BYTES or entry in module.COMPOSITE_LIGHT_ENTRIES:
                assert single < SINGLE_FIELD_REFUSED_FROM, (entry, second)
            assert all(1 <= len(segment.encode()) <= 1_500 for segment in document)


def test_the_ladders_include_the_recorded_single_field_boundary_pair() -> None:
    module = _module()
    for ladder in (module.COMPOSITE_HEAVY_ENTRIES, module.COLLECTION_GROUP_ENTRIES):
        assert {5_529, 5_530, 5_531} <= set(ladder)
        assert list(ladder) == sorted(set(ladder))


def test_collection_group_entries_are_exact_and_stay_inside_the_name_cap() -> None:
    module = _module()
    for entry in module.COLLECTION_GROUP_ENTRIES:
        document = _segments(module.collection_group_name(entry))
        assert document[-2] == "items"
        total = module.name_size(document) + 2 + module.indexed_value_bytes(1_500) + 48
        assert total == entry
        assert module.name_size(document) < NAME_ENTRY_REFUSED_FROM
        assert all(1 <= len(segment.encode()) <= 1_500 for segment in document)
        assert not any(segment.startswith("__") for segment in document)


def test_bytes_cases_send_the_exact_text_on_each_method() -> None:
    module = _module()
    programs = {p["id"]: p for p in module.build_programs()}
    lf = programs["writes/limits/bytes-line-breaks/create/lf"]["steps"][0]
    assert lf["method"] == "POST" and "documentId=create-lf" in lf["path"]
    assert lf["body"]["fields"]["b"]["bytesValue"] == "QUJD\nQUJD"
    patch = programs["writes/limits/bytes-line-breaks/patch/crlf"]["steps"][0]
    assert patch["method"] == "PATCH"
    assert patch["body"]["fields"]["b"]["bytesValue"] == "QUJD\r\nQUJD"
    batch = programs["writes/limits/bytes-line-breaks/batch-write/cr"]["steps"][0]
    assert batch["path"].endswith(":batchWrite")
    assert batch["body"]["writes"][0]["update"]["fields"]["b"]["bytesValue"] == "QUJD\rQUJD"
    proto = programs["writes/limits/bytes-line-breaks/commit/control"]["steps"][0]
    assert proto["body"]["writes"][0]["update"]["fields"]["b"] == {"bytesValue": "QUJD"}
    named = programs["writes/limits/bytes-line-breaks/patch/proto-name"]["steps"][0]
    assert named["body"]["fields"]["b"] == {"bytes_value": "QUJD"}
    mime = programs["writes/limits/bytes-line-breaks/create/mime-76"]["steps"][0]
    first_line = mime["body"]["fields"]["b"]["bytesValue"].split("\r\n")[0]
    assert len(first_line) == 76
    mime_lf = programs["writes/limits/bytes-line-breaks/create/mime-76-lf"]["steps"][0]
    assert mime_lf["body"]["fields"]["b"]["bytesValue"].split("\n")[0] == first_line


def test_commit_is_only_a_cross_check_of_the_already_recorded_rows() -> None:
    module = _module()
    commit = {c for m, c, _ in module.base64_case_list() if m == "commit"}
    assert commit == set(module.BASE64_COMMIT_CASES)
    others = {m for m, _, _ in module.base64_case_list()}
    assert others == {"create", "patch", "batch-write", "commit"}


def test_every_request_addresses_the_sandbox_default_database_only() -> None:
    module = _module()
    corpus = module.build_corpus()
    for program in corpus["restPrograms"]:
        for step in program["steps"]:
            assert step["path"].startswith(f"/v1/{module.DOCS}")
            assert step["method"] in ("GET", "POST", "PATCH")
            assert "headers" not in step
            assert "fireemu-oracle-sbx/databases/(default)" in json.dumps(step) or "documents" in step["path"]
    ids = [p["id"] for p in corpus["restPrograms"]]
    assert len(ids) == len(set(ids))
    assert corpus["restRequestCount"] == sum(len(p["steps"]) for p in corpus["restPrograms"])


def test_stream_recipes_name_one_thousand_byte_documents_per_recorded_count() -> None:
    module = _module()
    recipes = module.build_stream_recipes()
    assert [r["arrayCount"] for r in recipes] == [12_112, 12_113, 12_122]
    for recipe in recipes:
        relative = recipe["documentName"].split("/documents/", 1)[1]
        assert len(relative.encode()) == 1_000
        assert recipe["maxFrames"] == 2 and recipe["maxUnaryRpcs"] == 6
        assert recipe["id"] == f"writes/limits/write-stream-delete/{recipe['arrayCount']}"
    # 12,122 is the largest count below the recorded create refusal at 12,124.
    assert max(r["arrayCount"] for r in recipes) < 12_124


def test_the_committed_set_manifest_equals_what_the_generator_builds() -> None:
    module = _module()
    assert json.loads(MANIFEST.read_text()) == json.loads(json.dumps(module.build_manifest()))


def test_the_manifest_covers_every_program_once_and_every_written_name() -> None:
    module = _module()
    manifest = module.build_manifest()
    grouped = [pid for ids in manifest["freezeGroups"].values() for pid in ids]
    assert sorted(grouped) == sorted(manifest["restIds"])
    assert set(manifest["streamOwnedNames"]) <= set(manifest["ownedNames"])
    assert manifest["ownedNames"] == sorted(set(manifest["ownedNames"]))
    for program in module.build_programs():
        for step in program["steps"]:
            for write in (step.get("body") or {}).get("writes", []):
                assert write["update"]["name"] in manifest["ownedNames"]
