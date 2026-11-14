#!/usr/bin/env python3
"""Summarize raw sample TSV while retaining medians, p95, and maxima."""

import csv
import math
import statistics
import sys
from collections import defaultdict


def percentile(values, fraction):
    ordered = sorted(values)
    index = max(0, math.ceil(fraction * len(ordered)) - 1)
    return ordered[index]


def main(path):
    groups = defaultdict(list)
    identities = {}
    with open(path, newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        for row in reader:
            if row["record_type"] != "sample":
                continue
            key = (row["backend"], row["path"], row["workload"], row["bytes"], row["partition"])
            groups[key].append(int(row["nanoseconds"]) / int(row["iterations"]))
            identities[key] = (row["crc32c"], row["md5_hex"])
    print("backend\tpath\tworkload\tbytes\tpartition\tsamples\tmedian_ns_per_op\tp95_ns_per_op\tmax_ns_per_op\tcrc32c\tmd5_hex")
    for key, values in sorted(groups.items()):
        crc, md5 = identities[key]
        print("\t".join(map(str, (*key, len(values), f"{statistics.median(values):.1f}", f"{percentile(values, 0.95):.1f}", f"{max(values):.1f}", crc, md5))))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: measure.py RAW_SAMPLES_TSV")
    main(sys.argv[1])
