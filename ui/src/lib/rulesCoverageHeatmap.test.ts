import { describe, expect, it } from "vitest";
import { buildCoverageHeatmap } from "./rulesCoverageHeatmap";

describe("rulesCoverageHeatmap", () => {
  it("classifies lines as none, covered, partial, or unreached", () => {
    const source = [
      "rules_version = '2';",
      "allow read: if request.auth != null;",
      "allow write: if false;",
      "allow delete: if request.auth.uid == 'admin';",
    ].join("\n");

    const lines = buildCoverageHeatmap(source, [
      {
        sourcePosition: { line: 2, column: 16, currentOffset: 30, endOffset: 50 },
        values: [
          { value: { boolValue: true }, count: 2 },
          { value: { boolValue: false }, count: 1 },
        ],
      },
      {
        sourcePosition: { line: 3, column: 17, currentOffset: 60, endOffset: 65 },
        values: [{ value: { boolValue: false }, count: 3 }],
      },
      {
        sourcePosition: { line: 4, column: 18, currentOffset: 70, endOffset: 95 },
        values: [],
      },
    ]);

    expect(lines.map((l) => [l.lineNumber, l.state, l.hitCount])).toEqual([
      [1, "none", 0],
      [2, "covered", 3],
      [3, "partial", 3],
      [4, "unreached", 0],
    ]);
  });

  it("handles true-only booleans, non-boolean expressions, mixed unreached siblings, and max hit counts", () => {
    const source = ["line 1", "line 2", "line 3", "line 4"].join("\n");
    const lines = buildCoverageHeatmap(source, [
      {
        sourcePosition: { line: 1, column: 1, currentOffset: 0, endOffset: 5 },
        values: [{ value: { boolValue: true }, count: 2 }],
      },
      {
        sourcePosition: { line: 2, column: 1, currentOffset: 7, endOffset: 12 },
        values: [{ value: { stringValue: "uid-1" }, count: 1 }],
        children: [
          {
            sourcePosition: { line: 2, column: 6, currentOffset: 12, endOffset: 14 },
            values: [{ value: { intValue: "42" }, count: 4 }],
          },
          {
            sourcePosition: { line: 2, column: 9, currentOffset: 15, endOffset: 16 },
            values: [{ value: { stringValue: "small" }, count: 2 }],
          },
        ],
      },
      {
        sourcePosition: { line: 3, column: 1, currentOffset: 17, endOffset: 22 },
        values: [{ value: { stringValue: "hit" }, count: 1 }],
        children: [
          {
            sourcePosition: { line: 3, column: 5, currentOffset: 21, endOffset: 22 },
          },
        ],
      },
    ]);
    expect(lines.map((l) => [l.lineNumber, l.state, l.hitCount])).toEqual([
      [1, "partial", 2],
      [2, "covered", 4],
      [3, "partial", 1],
      [4, "none", 0],
    ]);
  });
});
