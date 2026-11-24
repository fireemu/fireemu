import type { CoverageNode } from "../api/control";

export type LineCoverageState = "none" | "covered" | "partial" | "unreached";

export type HeatmapLine = {
  lineNumber: number;
  text: string;
  state: LineCoverageState;
  hitCount: number;
};

/**
 * Compute per-line coverage states from a Firestore rules coverage tree.
 * - "covered": every expression on the line was reached, and boolean expressions saw both true/false (or non-bool hit).
 * - "partial": at least one expression was reached, and either another on the line is unreached or a boolean expression only saw one branch.
 * - "unreached": expressions exist on the line, none were reached.
 * - "none": no coverage expressions on this line.
 */
export const buildCoverageHeatmap = (source: string, report: CoverageNode[]): HeatmapLine[] => {
  const byLine = new Map<
    number,
    { reached: number; unreached: number; singleBoolBranch: boolean; hits: number }
  >();

  const walk = (nodes: CoverageNode[]) => {
    for (const node of nodes) {
      const line = node.sourcePosition.line;
      let stats = byLine.get(line);
      if (!stats) {
        stats = { reached: 0, unreached: 0, singleBoolBranch: false, hits: 0 };
        byLine.set(line, stats);
      }
      const values = node.values ?? [];
      if (values.length === 0) {
        stats.unreached += 1;
      } else {
        stats.reached += 1;
        let hasTrue = false;
        let hasFalse = false;
        let allBool = true;
        for (const v of values) {
          stats.hits += v.count;
          if (v.value.boolValue === true) hasTrue = true;
          else if (v.value.boolValue === false) hasFalse = true;
          else allBool = false;
        }
        if (allBool && !(hasTrue && hasFalse)) {
          stats.singleBoolBranch = true;
        }
      }
      if (node.children) walk(node.children);
    }
  };

  walk(report);

  return source.split(/\r?\n/).map((text, index) => {
    const lineNumber = index + 1;
    const stats = byLine.get(lineNumber);
    if (!stats) return { lineNumber, text, state: "none", hitCount: 0 };
    if (stats.reached === 0) return { lineNumber, text, state: "unreached", hitCount: 0 };
    if (stats.unreached > 0 || stats.singleBoolBranch) {
      return { lineNumber, text, state: "partial", hitCount: stats.hits };
    }
    return { lineNumber, text, state: "covered", hitCount: stats.hits };
  });
};
