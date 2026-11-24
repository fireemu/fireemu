import { describe, expect, it } from "vitest";
import { analyzeLogLine } from "./logHighlight";

describe("logHighlight", () => {
  it("classifies plain text log lines by severity", () => {
    expect(analyzeLogLine("[INFO] server started").severity).toBe("info");
    expect(analyzeLogLine("WARN retrying request").severity).toBe("warn");
    expect(analyzeLogLine("ERROR boom: failed").severity).toBe("error");
    expect(analyzeLogLine("DEBUG payload=1").severity).toBe("debug");
    expect(analyzeLogLine("plain console output").severity).toBe("other");
  });

  it("extracts severity and pretty JSON from structured log lines", () => {
    const parsed = analyzeLogLine('fn: {"severity":"WARNING","msg":"slow query","ms":420}');
    expect(parsed.severity).toBe("warn");
    expect(parsed.jsonPayload).toContain('"ms": 420');
  });
});
