// Pretty-printing of structured function log lines. A line is `"{level} [{id}] {message}"`
// or raw stderr; when the message is a JSON object or array it can be shown indented.

/** Lines longer than this are left alone: formatting them would dominate the view. */
export const MAX_FORMAT_LENGTH = 64 * 1024;

/**
 * The line with its trailing JSON object or array pretty-printed under the prefix; the line
 * itself when it carries no such JSON (plain text, a JSON scalar, invalid JSON) or is too long.
 */
export const formatLogLine = (line: string): string => {
  if (line.length > MAX_FORMAT_LENGTH) return line;
  const trimmed = line.trimEnd();
  const last = trimmed.at(-1);
  if (last !== "}" && last !== "]") return line;
  const open = last === "}" ? "{" : "[";
  // The JSON starts at one of the opening brackets; try each, outermost first.
  for (let at = trimmed.indexOf(open); at !== -1; at = trimmed.indexOf(open, at + 1)) {
    const prefix = trimmed.slice(0, at);
    if (prefix !== "" && !/\s$/.test(prefix)) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed.slice(at));
    } catch {
      continue;
    }
    const pretty = JSON.stringify(value, null, 2);
    const head = prefix.trimEnd();
    return head === "" ? pretty : `${head}\n${pretty}`;
  }
  return line;
};
