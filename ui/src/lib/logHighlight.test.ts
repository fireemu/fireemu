import { describe, expect, it } from "vitest";
import { analyzeLogLine } from "./logHighlight";

describe("logHighlight", () => {
  it("classifies plain text log lines by severity and honors prefix anchors", () => {
    const info = analyzeLogLine("[INFO] server started");
    expect(info.severity).toBe("info");
    expect(info.jsonPayload).toBeUndefined();
    expect(analyzeLogLine("WARN retrying request").severity).toBe("warn");
    expect(analyzeLogLine("ERROR boom: failed").severity).toBe("error");
    expect(analyzeLogLine("DEBUG payload=1").severity).toBe("debug");
    expect(analyzeLogLine("plain console output").severity).toBe("other");
    // Short prefix markers match only at the start of the line.
    expect(analyzeLogLine("E failed to connect").severity).toBe("error");
    expect(analyzeLogLine("W slow response").severity).toBe("warn");
    expect(analyzeLogLine("I ready").severity).toBe("info");
    expect(analyzeLogLine("D trace").severity).toBe("debug");
    expect(analyzeLogLine("prefix E mid-line").severity).toBe("other");
    expect(analyzeLogLine("prefix W mid-line").severity).toBe("other");
    expect(analyzeLogLine("prefix I mid-line").severity).toBe("other");
    expect(analyzeLogLine("prefix D mid-line").severity).toBe("other");
    // Braces that do not form a trailing JSON object stay plain text.
    expect(analyzeLogLine("hello { not-json } trailing").jsonPayload).toBeUndefined();
    expect(analyzeLogLine("only opening { brace").jsonPayload).toBeUndefined();
  });

  it("extracts severity and pretty JSON from structured log lines", () => {
    const parsed = analyzeLogLine('fn: {"severity":"WARNING","msg":"slow query","ms":420}');
    expect(parsed.severity).toBe("warn");
    expect(parsed.jsonPayload).toContain('"ms": 420');

    // Pure JSON starting at column 0 and nested `{` uses first `{`.
    const nested = analyzeLogLine('{"severity":"INFO","meta":{"nested":1}}');
    expect(nested.severity).toBe("info");
    expect(nested.jsonPayload).toContain('"nested": 1');

    // All severity levels and `level` fallback, plus empty severity object.
    for (const sev of ["ERROR", "CRITICAL", "ALERT", "EMERGENCY", "FATAL"]) {
      expect(analyzeLogLine(JSON.stringify({ severity: sev, msg: "x" })).severity).toBe("error");
    }
    expect(analyzeLogLine(JSON.stringify({ severity: "WARN", msg: "x" })).severity).toBe("warn");
    expect(analyzeLogLine(JSON.stringify({ severity: "NOTICE", msg: "x" })).severity).toBe("info");
    expect(analyzeLogLine(JSON.stringify({ level: "debug", msg: "x" })).severity).toBe("debug");
    const noSev = analyzeLogLine(JSON.stringify({ msg: "neutral" }));
    expect(noSev.severity).toBe("other");
    expect(noSev.jsonPayload).toContain('"msg": "neutral"');
    // JSON severity overrides words inside the message body.
    expect(analyzeLogLine('{"severity":"INFO","msg":"ERROR recovered"}').severity).toBe("info");
  });
});
