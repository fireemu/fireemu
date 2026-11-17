"""Recipes for the Batch 3 write-limit observations (FS-5, FS-6, FS-7 and REST base64 breaks).

Every recipe is an input, never a stored production expectation. They address only the
disposable sandbox project's `(default)` database and are selected by the `writelimits`
recording set of the FS-DATA-WRITE sandbox runner.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from sandbox_expansion import (  # noqa: E402
    BATCH_WRITE,
    COMMIT,
    DOCS,
    _commit_program,
    _field_update,
    _readback,
    index_sum_name_of_length,
)

ROOT_URL = f"/v1/{DOCS}"

# The create budget as strict models it (`crates/fireemu-core-firestore/src/index_usage.rs`),
# and the line the recorded 2,000-byte-name pair fits: 7,184 distinct integers are charged
# 29,650,337 bytes and 7,185 are charged 29,654,463.
TRANSACTION_BYTES = 29_652_400
CHARGE_PER_ELEMENT_AT_2000 = 4_126
CHARGE_FIXED_AT_2000 = 29_650_337 - 7_184 * CHARGE_PER_ELEMENT_AT_2000

# FS-6: documents under the recorded 2,000-byte name, sized as a fraction of the budget.
BUDGET_VARIANTS = (
    # (variant, documents, fraction of the budget per document, route)
    ("40x2", 2, 0.40, "commit"),
    ("55x2", 2, 0.55, "commit"),
    ("60x2", 2, 0.60, "commit"),
    ("40x3", 3, 0.40, "commit"),
    ("60x1", 1, 0.60, "commit"),
    ("batch-60x2", 2, 0.60, "batch-write"),
)

# FS-7: documented-formula entry sizes (`size.rs::index_entry_size`) of the ladders.
COMPOSITE_HEAVY_ENTRIES = (
    4_500,
    5_000,
    5_200,
    5_400,
    5_500,
    5_529,
    5_530,
    5_531,
    5_600,
    5_800,
    6_000,
    6_500,
    7_000,
)
# The light variant stays at or under 5,629: above it the 1,500-byte field's own single-field
# entry is already past the recorded 5,530 refusal, which says nothing about composites.
COMPOSITE_LIGHT_ENTRIES = (5_300, 5_500, 5_600)
COLLECTION_GROUP_ENTRIES = (4_500, 5_000, 5_500, 5_529, 5_530, 5_531, 5_700, 6_000, 6_190)
INDEXED_STRING_BYTES = 1_500
LIGHT_SECOND_BYTES = 100

# FS-5: the recorded DELETE boundary counts and one count far above every route's boundary.
WRITE_STREAM_DELETE_COUNTS = (12_112, 12_113, 12_122)
STREAM_COLLECTION_BYTES = 998

def _mime(separator: str) -> str:
    """66 bytes as base64 broken after 76 characters, the MIME line length."""
    encoded = base64.b64encode(bytes(range(65, 65 + 66))).decode()
    return encoded[:76] + separator + encoded[76:]


# REST bytesValue breaks: the recorded commit cases, now on the other write methods.
BASE64_CASES = (
    ("control", "QUJD"),
    ("lf", "QUJD\nQUJD"),
    ("cr", "QUJD\rQUJD"),
    ("crlf", "QUJD\r\nQUJD"),
    ("mime-76", _mime("\r\n")),
    ("mime-76-lf", _mime("\n")),
    ("mixed-plus-underscore", "+_AA"),
    ("mixed-minus-slash", "-/AA"),
    ("proto-name", "QUJD"),
)
BASE64_METHODS = ("create", "patch", "batch-write", "commit")
# The commit rows already recorded elsewhere stay as a cross-check on this harness only.
BASE64_COMMIT_CASES = ("control", "lf", "mixed-plus-underscore")


def name_size(segments: list[str]) -> int:
    """`size.rs::document_name_size`: the sum of segment sizes plus 16."""
    return sum(len(segment.encode()) + 1 for segment in segments) + 16


def indexed_value_bytes(length: int) -> int:
    """`size.rs::indexed_value_size` of a string: its size, capped at 1,500."""
    return min(length + 1, 1_500)


def array_count_for_fraction(fraction: float) -> int:
    """Distinct integers under the 2,000-byte name whose create charge is `fraction` of the budget."""
    return round(
        (fraction * TRANSACTION_BYTES - CHARGE_FIXED_AT_2000) / CHARGE_PER_ELEMENT_AT_2000
    )


def create_charge_at_2000(count: int) -> int:
    return CHARGE_FIXED_AT_2000 + count * CHARGE_PER_ELEMENT_AT_2000


def _budget_document_name(variant: str, index: int) -> str:
    return f"{DOCS}/{index_sum_name_of_length(2000, f'wb{variant}{index}'.replace('-', ''))}"


def _budget_write(name: str, count: int) -> dict[str, Any]:
    values = [{"integerValue": str(item)} for item in range(count)]
    return _field_update(name, {"a": {"arrayValue": {"values": values}}})


def _budget_program(
    variant: str, documents: int, fraction: float, route: str
) -> dict[str, Any]:
    count = array_count_for_fraction(fraction)
    names = [_budget_document_name(variant, index) for index in range(documents)]
    writes = [_budget_write(name, count) for name in names]
    if route == "commit":
        program = _commit_program(f"writes/limits/commit-budget/{variant}", writes, names)
    else:
        program = {
            "id": f"writes/limits/commit-budget/{variant}",
            "area": "writes",
            "steps": [
                {
                    "id": "write",
                    "method": "POST",
                    "path": BATCH_WRITE,
                    "body": {"writes": writes},
                },
                _readback(names),
            ],
        }
    return program


def composite_names(entry: int, second_bytes: int) -> tuple[str, int]:
    """`c1/d1/flt/id` whose composite collection-scope entry is exactly `entry` documented bytes.

    The two indexed strings are 1,500 and `second_bytes` bytes. The entry is the document name,
    its parent's name, both indexed values and 32.
    """
    values = indexed_value_bytes(INDEXED_STRING_BYTES) + indexed_value_bytes(second_bytes)
    wanted = entry - values - 32
    id_bytes = 600
    if (wanted - 37 - id_bytes) % 2:
        id_bytes += 1
    parent_segments = (wanted - 37 - id_bytes) // 2
    first = (parent_segments - 2 + 1) // 2
    second = parent_segments - 2 - first
    tag = f"p{entry}{second_bytes}"
    if not (len(tag) <= first <= 1_500 and 1 <= second <= 1_500):
        raise ValueError(f"cannot form a composite entry of {entry} bytes")
    parent = [tag.ljust(first, "x"), "y" * second]
    document = [*parent, "flt", f"i{entry}".ljust(id_bytes, "z")]
    total = name_size(document) + name_size(parent)
    if total != wanted:
        raise ValueError("composite name fixture size")
    return "/".join(document), entry


def collection_group_name(entry: int) -> str:
    """`c1/d1/c2/d2/items/id` whose collection-group single-field entry is `entry` documented bytes.

    The entry is the document name, the field name `n` and its 1,500-byte indexed value, and 48.
    """
    wanted = entry - 2 - indexed_value_bytes(INDEXED_STRING_BYTES) - 48
    id_bytes = 300
    # name = sum(len + 1 of 4 parent segments) + 6 (`items`) + (id + 1) + 16
    parent_bytes = wanted - 16 - 6 - (id_bytes + 1) - 4
    lengths = [parent_bytes // 4 + (index < parent_bytes % 4) for index in range(4)]
    tag = f"g{entry}"
    if not (len(tag) <= lengths[0] and all(length <= 1_500 for length in lengths)):
        raise ValueError(f"cannot form a collection-group entry of {entry} bytes")
    parent = [tag.ljust(lengths[0], "x"), *("y" * length for length in lengths[1:])]
    document = [*parent, "items", f"i{entry}".ljust(id_bytes, "z")]
    if name_size(document) != wanted:
        raise ValueError("collection-group name fixture size")
    return "/".join(document)


def _composite_program(entry: int, light: bool) -> dict[str, Any]:
    second = LIGHT_SECOND_BYTES if light else INDEXED_STRING_BYTES
    relative, _ = composite_names(entry, second)
    name = f"{DOCS}/{relative}"
    write = _field_update(
        name,
        {
            "s": {"stringValue": "s" * INDEXED_STRING_BYTES},
            "n": {"stringValue": "n" * second},
        },
    )
    kind = "light" if light else "heavy"
    return _commit_program(f"writes/limits/composite-entry/{kind}/{entry}", [write], [name])


def _collection_group_program(entry: int) -> dict[str, Any]:
    name = f"{DOCS}/{collection_group_name(entry)}"
    write = _field_update(name, {"n": {"stringValue": "n" * INDEXED_STRING_BYTES}})
    return _commit_program(f"writes/limits/collection-group-entry/{entry}", [write], [name])


def base64_document(method: str, case: str) -> str:
    return f"{DOCS}/wlbase64/{method}-{case}"


def _base64_fields(case: str, text: str) -> dict[str, Any]:
    key = "bytes_value" if case == "proto-name" else "bytesValue"
    return {"b": {key: text}}


def _base64_program(method: str, case: str, text: str) -> dict[str, Any]:
    name = base64_document(method, case)
    fields = _base64_fields(case, text)
    relative = f"wlbase64/{method}-{case}"
    if method == "create":
        step = {
            "id": "write",
            "method": "POST",
            "path": f"{ROOT_URL}/wlbase64?documentId={method}-{case}",
            "body": {"fields": fields},
        }
    elif method == "patch":
        step = {
            "id": "write",
            "method": "PATCH",
            "path": f"{ROOT_URL}/{relative}",
            "body": {"fields": fields},
        }
    elif method == "batch-write":
        step = {
            "id": "write",
            "method": "POST",
            "path": BATCH_WRITE,
            "body": {"writes": [{"update": {"name": name, "fields": fields}}]},
        }
    else:
        step = {
            "id": "write",
            "method": "POST",
            "path": COMMIT,
            "body": {"writes": [{"update": {"name": name, "fields": fields}}]},
        }
    return {
        "id": f"writes/limits/bytes-line-breaks/{method}/{case}",
        "area": "writes",
        "steps": [step, _readback([name])],
    }


def stream_document_name(count: int) -> str:
    collection = f"wlstream{count}".ljust(STREAM_COLLECTION_BYTES, "c")
    return f"{DOCS}/{collection}/d"


def build_stream_recipes() -> list[dict[str, Any]]:
    return [
        {
            "id": f"writes/limits/write-stream-delete/{count}",
            "transport": "grpc",
            "action": "write-stream-delete",
            "arrayCount": count,
            "documentName": stream_document_name(count),
            "maxFrames": 2,
            "maxUnaryRpcs": 6,
        }
        for count in WRITE_STREAM_DELETE_COUNTS
    ]


def base64_case_list() -> list[tuple[str, str, str]]:
    cases: list[tuple[str, str, str]] = []
    for method in BASE64_METHODS:
        for case, text in BASE64_CASES:
            if method == "commit" and case not in BASE64_COMMIT_CASES:
                continue
            cases.append((method, case, text))
    return cases


def build_programs() -> list[dict[str, Any]]:
    programs = [_budget_program(*variant) for variant in BUDGET_VARIANTS]
    programs.extend(_composite_program(entry, False) for entry in COMPOSITE_HEAVY_ENTRIES)
    programs.extend(_composite_program(entry, True) for entry in COMPOSITE_LIGHT_ENTRIES)
    programs.extend(_collection_group_program(entry) for entry in COLLECTION_GROUP_ENTRIES)
    programs.extend(_base64_program(*case) for case in base64_case_list())
    return programs


def build_corpus() -> dict[str, Any]:
    programs = build_programs()
    ids = [program["id"] for program in programs]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate write-limits program ID")
    streams = build_stream_recipes()
    return {
        "schemaVersion": 1,
        "restPrograms": programs,
        "streamRecipes": streams,
        "restRequestCount": sum(len(program["steps"]) for program in programs),
    }


def _rest_written_names(programs: list[dict[str, Any]]) -> set[str]:
    names: set[str] = set()
    for program in programs:
        for step in program["steps"]:
            body = step.get("body") or {}
            for write in body.get("writes", []):
                names.add(write["update"]["name"])
    for method, case, _ in base64_case_list():
        if method in ("create", "patch"):
            names.add(base64_document(method, case))
    return names


def build_manifest() -> dict[str, Any]:
    """The pinned shape of the `writelimits` recording set; the runner reads it from disk."""
    corpus = build_corpus()
    programs = corpus["restPrograms"]
    stream_names = sorted(recipe["documentName"] for recipe in corpus["streamRecipes"])
    rest_names = _rest_written_names(programs)
    groups = {
        "budget": [p["id"] for p in programs if "/commit-budget/" in p["id"]],
        "composite": [p["id"] for p in programs if "/composite-entry/" in p["id"]],
        "collection-group": [
            p["id"] for p in programs if "/collection-group-entry/" in p["id"]
        ],
        "base64": [p["id"] for p in programs if "/bytes-line-breaks/" in p["id"]],
        "write-stream": [],
    }
    return {
        "schemaVersion": 1,
        "restIds": [p["id"] for p in programs],
        "streamIds": [recipe["id"] for recipe in corpus["streamRecipes"]],
        "ownedNames": sorted(rest_names | set(stream_names)),
        "streamOwnedNames": stream_names,
        "restRequestCount": corpus["restRequestCount"],
        "freezeGroups": groups,
    }


if __name__ == "__main__":
    if "--manifest" in sys.argv:
        json.dump(build_manifest(), sys.stdout, indent=1, sort_keys=True)
        sys.stdout.write("\n")
        raise SystemExit(0)
    json.dump(build_corpus(), sys.stdout, separators=(",", ":"))
