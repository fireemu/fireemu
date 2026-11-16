import { expect, test } from "vitest";
import {
  GO_TIMEOUT_MS,
  IDLE,
  stepShortcut,
  type ShortcutAction,
  type ShortcutState,
} from "./shortcuts";

const GO = { f: "/firestore", t: "/runtime" };
const NOW = 100_000;

type Row = {
  pending: "none" | "fresh" | "expired";
  key: "g" | "goKey" | "otherLetter" | "question" | "slash";
  target: "page" | "editable";
  modifier: "none" | "ctrl" | "meta" | "alt";
};

// The pairwise table of the shortcut model (pending `g` x key x focus target x modifier),
// required rows first.
const ROWS: Row[] = [
  { pending: "none", key: "g", target: "page", modifier: "none" },
  { pending: "fresh", key: "goKey", target: "page", modifier: "none" },
  { pending: "none", key: "question", target: "page", modifier: "none" },
  { pending: "none", key: "slash", target: "page", modifier: "none" },
  { pending: "fresh", key: "goKey", target: "editable", modifier: "none" },
  { pending: "expired", key: "goKey", target: "page", modifier: "none" },
  { pending: "fresh", key: "goKey", target: "page", modifier: "ctrl" },
  { pending: "none", key: "question", target: "editable", modifier: "none" },
  { pending: "fresh", key: "otherLetter", target: "page", modifier: "none" },
  { pending: "expired", key: "g", target: "editable", modifier: "ctrl" },
  { pending: "fresh", key: "g", target: "page", modifier: "meta" },
  { pending: "expired", key: "otherLetter", target: "editable", modifier: "alt" },
  { pending: "none", key: "otherLetter", target: "page", modifier: "ctrl" },
  { pending: "expired", key: "question", target: "editable", modifier: "meta" },
  { pending: "fresh", key: "question", target: "editable", modifier: "ctrl" },
  { pending: "none", key: "goKey", target: "page", modifier: "alt" },
  { pending: "fresh", key: "slash", target: "editable", modifier: "alt" },
  { pending: "none", key: "goKey", target: "editable", modifier: "meta" },
  { pending: "expired", key: "slash", target: "editable", modifier: "meta" },
  { pending: "fresh", key: "question", target: "page", modifier: "alt" },
  { pending: "fresh", key: "otherLetter", target: "editable", modifier: "meta" },
  { pending: "fresh", key: "slash", target: "page", modifier: "ctrl" },
  { pending: "fresh", key: "g", target: "editable", modifier: "alt" },
];

const KEYS: Record<Row["key"], string> = {
  g: "g",
  goKey: "f",
  otherLetter: "x",
  question: "?",
  slash: "/",
};

const expected = (row: Row): { action: ShortcutAction; pendingAfter: boolean } => {
  // Typing, or a modified key, is never a shortcut and abandons a started sequence.
  if (row.target === "editable" || row.modifier !== "none") {
    return { action: { kind: "none" }, pendingAfter: false };
  }
  if (row.pending === "fresh") {
    return {
      action: row.key === "goKey" ? { kind: "go", href: "/firestore" } : { kind: "none" },
      pendingAfter: false,
    };
  }
  switch (row.key) {
    case "g":
      return { action: { kind: "none" }, pendingAfter: true };
    case "question":
      return { action: { kind: "help" }, pendingAfter: false };
    case "slash":
      return { action: { kind: "palette" }, pendingAfter: false };
    default:
      return { action: { kind: "none" }, pendingAfter: false };
  }
};

test.each(ROWS)("pending=$pending key=$key target=$target modifier=$modifier", (row) => {
  const state: ShortcutState =
    row.pending === "none"
      ? IDLE
      : { goSince: row.pending === "fresh" ? NOW - GO_TIMEOUT_MS : NOW - GO_TIMEOUT_MS - 1 };
  const result = stepShortcut(
    state,
    {
      key: KEYS[row.key],
      ctrl: row.modifier === "ctrl",
      meta: row.modifier === "meta",
      alt: row.modifier === "alt",
      editable: row.target === "editable",
      time: NOW,
    },
    GO,
  );
  const want = expected(row);
  expect(result.action).toEqual(want.action);
  expect(result.state.goSince !== null).toBe(want.pendingAfter);
  if (want.pendingAfter) expect(result.state.goSince).toBe(NOW);
});

const press = (state: ShortcutState, key: string, time: number) =>
  stepShortcut(state, { key, ctrl: false, meta: false, alt: false, editable: false, time }, GO);

test("g then a page key navigates once; the next key starts over", () => {
  const first = press(IDLE, "g", 0);
  expect(first.action).toEqual({ kind: "none" });
  const second = press(first.state, "t", 200);
  expect(second.action).toEqual({ kind: "go", href: "/runtime" });
  expect(second.state).toEqual(IDLE);
  expect(press(second.state, "t", 300).action).toEqual({ kind: "none" });
});

test("the sequence lasts exactly the timeout and no longer", () => {
  const started = press(IDLE, "g", 1_000).state;
  expect(press(started, "f", 1_000 + GO_TIMEOUT_MS).action).toEqual({
    kind: "go",
    href: "/firestore",
  });
  expect(press(started, "f", 1_001 + GO_TIMEOUT_MS).action).toEqual({ kind: "none" });
  // After an expired g, another g starts a new sequence rather than being swallowed.
  const restarted = press(started, "g", 5_000 + GO_TIMEOUT_MS);
  expect(restarted.state.goSince).toBe(5_000 + GO_TIMEOUT_MS);
  expect(press(restarted.state, "f", 5_100 + GO_TIMEOUT_MS).action.kind).toBe("go");
});

test("within a sequence only page keys act: g g, g ? and g / do nothing", () => {
  for (const key of ["g", "?", "/", "x", "Enter", "F", "T"]) {
    const result = press(press(IDLE, "g", 0).state, key, 10);
    expect(result.action, key).toEqual({ kind: "none" });
    expect(result.state, key).toEqual(IDLE);
  }
});

test("keys are case-sensitive and inherited names are not pages", () => {
  expect(press(IDLE, "G", 0).state).toEqual(IDLE);
  const started = press(IDLE, "g", 0).state;
  for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    expect(press(started, key, 1).action, key).toEqual({ kind: "none" });
  }
});
