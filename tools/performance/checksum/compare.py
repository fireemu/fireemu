#!/usr/bin/env python3
"""Check checksum equality and print selected candidate speedup ratios."""

import csv
import sys


def main(path):
    rows = {}
    with open(path, newline="", encoding="utf-8") as stream:
        for row in csv.DictReader(stream, delimiter="\t"):
            key = (row["backend"], row["workload"], int(row["bytes"]), row["partition"])
            rows[key] = row

    dimensions = sorted({key[1:] for key in rows})
    for workload, size, partition in dimensions:
        values = [rows[(backend, workload, size, partition)] for backend in sorted({key[0] for key in rows})]
        checksums = {(row["crc32c"], row["md5_hex"]) for row in values}
        if len(checksums) != 1:
            raise SystemExit(f"checksum disagreement: workload={workload} size={size} partition={partition}: {checksums}")

    selected = [64, 4096, 1_048_576, 30 * 1_048_576]
    print("workload\tbytes\tpartition\tbackend\tpath\tmedian_ns_per_op\tp95_ns_per_op\tspeedup_vs_scalar\tcrc32c\tmd5_hex")
    for workload in ["crc32c", "object_digests"]:
        partitions = ["one_shot", "chunks_997"]
        for partition in partitions:
            for size in selected:
                baseline = rows[("scalar-slicing-by-8", workload, size, partition)]
                base_median = float(baseline["median_ns_per_op"])
                for backend in sorted({key[0] for key in rows}):
                    row = rows[(backend, workload, size, partition)]
                    median = float(row["median_ns_per_op"])
                    speedup = base_median / median if median else 0
                    print("\t".join((workload, str(size), partition, backend, row["path"], row["median_ns_per_op"], row["p95_ns_per_op"], f"{speedup:.3f}", row["crc32c"], row["md5_hex"])))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: compare.py SUMMARY_TSV")
    main(sys.argv[1])
