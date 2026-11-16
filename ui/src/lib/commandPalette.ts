// The command palette's pure part: what a query matches and in which order. Nothing here
// touches the DOM or the router.
import { firestoreHref } from "./hrefs";

export type PaletteCommand = {
  id: string;
  title: string;
  /** The section heading the command is listed under. */
  group: string;
  /** Extra words the query may match (never shown). */
  keywords?: string;
  /** An in-app route to open; commands without one carry an action id instead. */
  href?: string;
  action?: string;
};

/** Higher is better; `null` is no match. */
const EXACT_PREFIX = 400;
const WORD_PREFIX = 300;
const SUBSTRING = 200;
const SUBSEQUENCE = 100;

const isSubsequence = (needle: string, haystack: string): boolean => {
  let at = 0;
  for (const ch of haystack) {
    if (ch === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return false;
};

const scoreText = (query: string, text: string): number | null => {
  if (text.startsWith(query)) return EXACT_PREFIX;
  if (text.split(/[\s/._-]+/).some((word) => word.startsWith(query))) return WORD_PREFIX;
  if (text.includes(query)) return SUBSTRING;
  if (isSubsequence(query, text)) return SUBSEQUENCE;
  return null;
};

/**
 * How well `query` matches a command: a title match outranks the same kind of match in the
 * keywords. Matching ignores case and surrounding whitespace.
 */
export const matchScore = (query: string, command: PaletteCommand): number | null => {
  // An empty query is a prefix of every title, so everything matches equally.
  const q = query.trim().toLowerCase();
  const title = scoreText(q, command.title.toLowerCase());
  const keywords = command.keywords ? scoreText(q, command.keywords.toLowerCase()) : null;
  // Keywords never use the loose subsequence match: it would surface unrelated commands.
  const keywordScore = (keywords ?? 0) > SUBSEQUENCE ? keywords! - 50 : null;
  if (title === null) return keywordScore;
  return Math.max(title, keywordScore ?? 0);
};

/** The commands matching `query`, best first; equal scores keep their declared order. */
export const filterCommands = (
  commands: readonly PaletteCommand[],
  query: string,
): PaletteCommand[] =>
  commands
    .map((command) => ({ command, score: matchScore(query, command) }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
    // The sort is stable, so equal scores stay in declared order.
    .toSorted((a, b) => b.score - a.score)
    .map((entry) => entry.command);

/**
 * A query that names a Firestore path (`users/alice`, `/users`) as a command opening it in
 * the default database; `null` for anything without a slash or without a segment.
 */
export const pathCommand = (
  query: string,
  title: (path: string) => string,
  group: string,
): PaletteCommand | null => {
  const trimmed = query.trim();
  if (!trimmed.includes("/")) return null;
  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const path = segments.join("/");
  return {
    id: `firestore-path:${path}`,
    title: title(path),
    group,
    href: firestoreHref(path, "(default)"),
  };
};

/** The index `delta` steps from `current` among `count` rows, wrapping at both ends. */
export const moveSelection = (current: number, delta: number, count: number): number => {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
};
