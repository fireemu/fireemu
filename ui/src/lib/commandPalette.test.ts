import { expect, test } from "vitest";
import {
  filterCommands,
  matchScore,
  moveSelection,
  pathCommand,
  type PaletteCommand,
} from "./commandPalette";

const COMMANDS: PaletteCommand[] = [
  { id: "overview", title: "Overview", group: "Go to", href: "/" },
  {
    id: "firestore",
    title: "Firestore",
    group: "Go to",
    href: "/firestore",
    keywords: "documents",
  },
  { id: "database", title: "Realtime Database", group: "Go to", href: "/database" },
  { id: "auth", title: "Authentication", group: "Go to", href: "/auth", keywords: "users sign-in" },
  { id: "storage", title: "Storage", group: "Go to", href: "/storage", keywords: "bucket files" },
  { id: "functions", title: "Functions", group: "Go to", href: "/functions", keywords: "logs" },
  { id: "theme", title: "Switch theme", group: "Actions", action: "theme" },
];

const ids = (query: string) => filterCommands(COMMANDS, query).map((c) => c.id);

test("an empty or blank query lists every command in declared order", () => {
  expect(ids("")).toEqual(COMMANDS.map((c) => c.id));
  expect(ids("   ")).toEqual(COMMANDS.map((c) => c.id));
});

test("a title prefix outranks a later-word prefix, a substring and a subsequence", () => {
  // "f": Firestore and Functions start with it; "bucket files" has a word starting with it.
  expect(ids("f")).toEqual(["firestore", "functions", "storage"]);
  // "data": a word prefix of "Realtime Database" only.
  expect(ids("data")).toEqual(["database"]);
  // "tor": a substring of "Firestore" and "Storage" (declared order kept on the tie).
  expect(ids("tor")).toEqual(["firestore", "storage"]);
  // "fns": a subsequence of "functions" only.
  expect(ids("fns")).toEqual(["functions"]);
});

test("the four kinds of match are strictly ordered", () => {
  const command: PaletteCommand = { id: "x", title: "alpha beta", group: "g" };
  const prefix = matchScore("alp", command);
  const word = matchScore("bet", command);
  const substring = matchScore("lph", command);
  const subsequence = matchScore("aba", command);
  expect(prefix).not.toBeNull();
  expect(prefix!).toBeGreaterThan(word!);
  expect(word!).toBeGreaterThan(substring!);
  expect(substring!).toBeGreaterThan(subsequence!);
  expect(subsequence!).toBeGreaterThan(0);
  expect(matchScore("zzz", command)).toBeNull();
});

test("keywords match below the same kind of title match and never by subsequence", () => {
  expect(ids("users")).toEqual(["auth"]);
  expect(ids("logs")).toEqual(["functions"]);
  const titled: PaletteCommand = { id: "a", title: "logs", group: "g" };
  const keyworded: PaletteCommand = { id: "b", title: "zzz", group: "g", keywords: "logs" };
  expect(matchScore("logs", titled)!).toBeGreaterThan(matchScore("logs", keyworded)!);
  // "ugn" is a subsequence of "users sign-in" but that must not surface Authentication.
  expect(ids("ugn")).toEqual([]);
  // A weak title match still wins over no keyword match at all.
  expect(matchScore("fns", COMMANDS[5]!)).not.toBeNull();
});

test("matching ignores case and surrounding whitespace", () => {
  expect(ids("  FIRE ")).toEqual(["firestore"]);
});

test("every result contains the query as a subsequence of its title or keywords", () => {
  const alphabet = "abcdefghilmnorstuv";
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (let round = 0; round < 500; round += 1) {
    const length = 1 + (next() % 3);
    let query = "";
    for (let i = 0; i < length; i += 1) query += alphabet[next() % alphabet.length];
    const results = filterCommands(COMMANDS, query);
    const scores = results.map((c) => matchScore(query, c)!);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    for (const command of results) {
      const text = `${command.title} ${command.keywords ?? ""}`.toLowerCase();
      let at = 0;
      for (const ch of text) if (ch === query[at]) at += 1;
      expect(at).toBe(query.length);
    }
    // Nothing that matches is dropped.
    expect(results.length).toBe(COMMANDS.filter((c) => matchScore(query, c) !== null).length);
  }
});

test("a query with a slash offers the Firestore path, every segment percent-encoded", () => {
  const title = (path: string) => `Open ${path}`;
  expect(pathCommand("users/alice", title, "Firestore")).toEqual({
    id: "firestore-path:users/alice",
    title: "Open users/alice",
    group: "Firestore",
    href: "/firestore/users/alice?db=(default)",
  });
  expect(pathCommand(" /users/ ", title, "g")?.href).toBe("/firestore/users?db=(default)");
  expect(pathCommand("a b/c#d?e", title, "g")?.href).toBe(
    "/firestore/a%20b/c%23d%3Fe?db=(default)",
  );
  expect(pathCommand("users", title, "g")).toBeNull();
  expect(pathCommand("/", title, "g")).toBeNull();
  expect(pathCommand("", title, "g")).toBeNull();
});

test("the selection wraps at both ends and stays at zero for an empty list", () => {
  expect(moveSelection(0, 1, 3)).toBe(1);
  expect(moveSelection(2, 1, 3)).toBe(0);
  expect(moveSelection(0, -1, 3)).toBe(2);
  expect(moveSelection(1, -1, 3)).toBe(0);
  expect(moveSelection(5, 1, 0)).toBe(0);
  expect(moveSelection(0, -1, 0)).toBe(0);
  expect(moveSelection(0, 1, 1)).toBe(0);
});
