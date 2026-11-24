import { err, ok } from "neverthrow";

// Timeouts, unreached edits, extraction diagnostics, and runner errors must not count as kills.
export const assessSanity = (report) => {
  if (!report || typeof report !== "object") {
    return err("Missing targeted-mutation report.");
  }
  if (report.evaluation !== "evaluated") {
    return err(`Mutation run did not complete cleanly: evaluation=${String(report.evaluation)}.`);
  }
  if (report.baseline?.status !== "passed") {
    return err(`Baseline suite did not pass: status=${String(report.baseline?.status)}.`);
  }
  if (Array.isArray(report.extraction) && report.extraction.some((e) => e.path === "diagnostic")) {
    return err("Source extraction reported a diagnostic error.");
  }
  const mutants = Array.isArray(report.mutants) ? report.mutants : [];
  if (mutants.length === 0) return err("No mutants executed; a dry run is insufficient.");
  const unexpected = mutants.filter((mutant) => mutant.status !== "killed");
  if (unexpected.length > 0) {
    return err(
      `Sanity mutants were not killed: ${unexpected.map((mutant) => mutant.status).join(", ")}`,
    );
  }
  return ok(mutants.length);
};
