// The colour theme: an explicit light or dark choice, or "system" (follow the OS). The
// stylesheet follows the OS by itself, so "system" stores nothing and marks nothing.

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "fireemu.ui.theme";

type ReadableStorage = { getItem: (key: string) => string | null };
type WritableStorage = {
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

/** The preference a stored string names; anything but an exact name is "system". */
export const parsePreference = (raw: string | null): ThemePreference =>
  raw === "light" || raw === "dark" ? raw : "system";

/** The theme actually shown for a preference on an OS that prefers dark (or not). */
export const resolveTheme = (preference: ThemePreference, systemDark: boolean): Theme =>
  preference === "system" ? (systemDark ? "dark" : "light") : preference;

/** The toggle order: system, light, dark, and around again. */
export const nextPreference = (preference: ThemePreference): ThemePreference => {
  switch (preference) {
    case "system":
      return "light";
    case "light":
      return "dark";
    default:
      return "system";
  }
};

/** The stored preference; a storage that is absent or refuses access reads as "system". */
export const readPreference = (storage: ReadableStorage | undefined): ThemePreference => {
  try {
    return parsePreference(storage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch {
    return "system";
  }
};

/** Stores the preference (nothing for "system"); false when the storage refused it. */
export const writePreference = (
  storage: WritableStorage | undefined,
  preference: ThemePreference,
): boolean => {
  if (!storage) return false;
  try {
    if (preference === "system") storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
};
