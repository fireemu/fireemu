export type LogSeverity = "error" | "warn" | "info" | "debug" | "other";

export type ParsedLogLine = {
  raw: string;
  severity: LogSeverity;
  jsonPayload?: string;
};

/** Classify a log line by severity and optionally detect an embedded JSON payload. */
export const analyzeLogLine = (line: string): ParsedLogLine => {
  const upper = line.toUpperCase();
  let severity: LogSeverity = "other";

  const trimmed = line.trim();
  const braceStart = trimmed.indexOf("{");
  let jsonPayload: string | undefined;

  if (braceStart >= 0 && trimmed.endsWith("}")) {
    const candidate = trimmed.slice(braceStart);
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        jsonPayload = JSON.stringify(parsed, null, 2);
        const rec = parsed as Record<string, unknown>;
        const rawSev = String(rec.severity ?? rec.level ?? "").toUpperCase();
        if (["ERROR", "CRITICAL", "ALERT", "EMERGENCY", "FATAL"].includes(rawSev)) {
          severity = "error";
        } else if (["WARN", "WARNING"].includes(rawSev)) {
          severity = "warn";
        } else if (["INFO", "NOTICE"].includes(rawSev)) {
          severity = "info";
        } else if (rawSev === "DEBUG") {
          severity = "debug";
        }
      }
    } catch {
      /* Not JSON; fall back to text heuristics. */
    }
  }

  if (severity === "other") {
    if (/\b(ERROR|FATAL|CRITICAL|EXCEPTION|UNHANDLED)\b/.test(upper) || /^E\s/.test(trimmed)) {
      severity = "error";
    } else if (/\b(WARN|WARNING)\b/.test(upper) || /^W\s/.test(trimmed)) {
      severity = "warn";
    } else if (/\bINFO\b/.test(upper) || /^I\s/.test(trimmed)) {
      severity = "info";
    } else if (/\bDEBUG\b/.test(upper) || /^D\s/.test(trimmed)) {
      severity = "debug";
    }
  }

  return jsonPayload !== undefined ? { raw: line, severity, jsonPayload } : { raw: line, severity };
};
