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
});
