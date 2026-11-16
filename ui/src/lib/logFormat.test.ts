import { expect, test } from "vitest";
import { formatLogLine, MAX_FORMAT_LENGTH } from "./logFormat";

test("a JSON object after the level prefix is printed indented under the prefix", () => {
  expect(formatLogLine('info {"user":"a","n":1}')).toBe('info\n{\n  "user": "a",\n  "n": 1\n}');
  expect(formatLogLine('warn 7f3a {"nested":{"ok":true}}  ')).toBe(
    'warn 7f3a\n{\n  "nested": {\n    "ok": true\n  }\n}',
  );
});

test("a bare JSON line and a JSON array are formatted too", () => {
  expect(formatLogLine('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  expect(formatLogLine("error [1,2]")).toBe("error\n[\n  1,\n  2\n]");
  expect(formatLogLine("{}")).toBe("{}");
});

test("the outermost JSON wins, and brackets inside the prefix text are skipped", () => {
  expect(formatLogLine('info saved {draft} {"id":1}')).toBe('info saved {draft}\n{\n  "id": 1\n}');
  expect(formatLogLine('info {"a":{"b":1}}')).toBe('info\n{\n  "a": {\n    "b": 1\n  }\n}');
  // An opening bracket glued to a word is not where a JSON value starts.
  expect(formatLogLine('info x{"a":1}')).toBe('info x{"a":1}');
});

test("plain text, scalars and invalid JSON are returned unchanged", () => {
  for (const line of [
    "",
    "info plain message",
    "info 42",
    'info "quoted"',
    "info true",
    "info {not json}",
    "info {",
    'info {"a":1',
    "info ]",
    "at Object.<anonymous> (index.js:2:27)",
    '  {"a":1} trailing words',
  ]) {
    expect(formatLogLine(line), line).toBe(line);
  }
});

test("a line over the size limit is left alone, one at the limit is formatted", () => {
  const pad = (length: number) => `{"k":"${"x".repeat(length - 8)}"}`;
  const atLimit = pad(MAX_FORMAT_LENGTH);
  expect(atLimit.length).toBe(MAX_FORMAT_LENGTH);
  expect(formatLogLine(atLimit)).not.toBe(atLimit);
  const over = pad(MAX_FORMAT_LENGTH + 1);
  expect(formatLogLine(over)).toBe(over);
});

test("formatting keeps every value: the formatted JSON parses back to the same data", () => {
  const value = { text: 'line\nbreak "quoted" </script>', list: [null, 1.5, { deep: [] }] };
  const formatted = formatLogLine(`debug ${JSON.stringify(value)}`);
  expect(formatted.startsWith("debug\n")).toBe(true);
  expect(JSON.parse(formatted.slice("debug\n".length))).toEqual(value);
});
