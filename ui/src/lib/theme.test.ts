import { expect, test } from "vitest";
import {
  THEME_STORAGE_KEY,
  nextPreference,
  parsePreference,
  readPreference,
  resolveTheme,
  writePreference,
  type ThemePreference,
} from "./theme";

type Stored = "missing" | "system" | "light" | "dark" | "garbage";
type Row = {
  stored: Stored;
  systemScheme: "light" | "dark";
  storage: "ok" | "throws";
  action: "read" | "cycle";
};

// The pairwise table generated from the theme model (stored value x OS scheme x storage
// availability x action), with the required rows seeded first.
const ROWS: Row[] = [
  { stored: "missing", systemScheme: "dark", storage: "ok", action: "read" },
  { stored: "missing", systemScheme: "light", storage: "ok", action: "read" },
  { stored: "dark", systemScheme: "light", storage: "ok", action: "read" },
  { stored: "light", systemScheme: "dark", storage: "ok", action: "cycle" },
  { stored: "missing", systemScheme: "dark", storage: "throws", action: "cycle" },
  { stored: "garbage", systemScheme: "dark", storage: "ok", action: "read" },
  { stored: "system", systemScheme: "dark", storage: "ok", action: "read" },
  { stored: "dark", systemScheme: "dark", storage: "ok", action: "cycle" },
  { stored: "garbage", systemScheme: "light", storage: "ok", action: "cycle" },
  { stored: "system", systemScheme: "light", storage: "ok", action: "cycle" },
  { stored: "light", systemScheme: "light", storage: "ok", action: "read" },
  { stored: "missing", systemScheme: "light", storage: "throws", action: "read" },
];

const storageFor = (row: Row) => {
  const values = new Map<string, string>();
  if (row.stored === "garbage") values.set(THEME_STORAGE_KEY, "sepia");
  else if (row.stored !== "missing") values.set(THEME_STORAGE_KEY, row.stored);
  return {
    values,
    getItem: (key: string): string | null => {
      if (row.storage === "throws") throw new Error("storage denied");
      return values.get(key) ?? null;
    },
    setItem: (key: string, value: string): void => {
      if (row.storage === "throws") throw new Error("storage denied");
      values.set(key, value);
    },
    removeItem: (key: string): void => {
      if (row.storage === "throws") throw new Error("storage denied");
      values.delete(key);
    },
  };
};

const expectedPreference = (stored: Stored): ThemePreference =>
  stored === "light" || stored === "dark" ? stored : "system";

const ORDER: ThemePreference[] = ["system", "light", "dark"];

test.each(ROWS)("stored=$stored os=$systemScheme storage=$storage action=$action", (row) => {
  const storage = storageFor(row);
  const preference = readPreference(storage);
  expect(preference).toBe(expectedPreference(row.stored));
  const explicit = preference === "system" ? row.systemScheme : preference;
  expect(resolveTheme(preference, row.systemScheme === "dark")).toBe(explicit);
  if (row.action === "cycle") {
    const next = nextPreference(preference);
    expect(next).toBe(ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]);
    const written = writePreference(storage, next);
    expect(written).toBe(row.storage === "ok");
    if (row.storage === "ok") {
      expect(readPreference(storage)).toBe(next);
      // "system" is the absence of a choice: nothing stays stored for it.
      expect(storage.values.has(THEME_STORAGE_KEY)).toBe(next !== "system");
    }
  }
});

test("the cycle visits every preference and returns to the start", () => {
  let preference: ThemePreference = "system";
  const seen: ThemePreference[] = [];
  for (let i = 0; i < 3; i += 1) {
    seen.push(preference);
    preference = nextPreference(preference);
  }
  expect(seen).toEqual(["system", "light", "dark"]);
  expect(preference).toBe("system");
});

test("the preference is kept under a key of its own", () => {
  expect(THEME_STORAGE_KEY).toBe("fireemu.ui.theme");
});

test("only the three exact names parse; everything else is the system default", () => {
  expect(parsePreference("light")).toBe("light");
  expect(parsePreference("dark")).toBe("dark");
  expect(parsePreference("system")).toBe("system");
  for (const raw of [null, "", "Dark", " dark", "LIGHT", "auto", "constructor", "__proto__"]) {
    expect(parsePreference(raw)).toBe("system");
  }
});

test("a missing storage object (private mode, no window) reads as system and refuses writes", () => {
  expect(readPreference(undefined)).toBe("system");
  expect(writePreference(undefined, "dark")).toBe(false);
});
