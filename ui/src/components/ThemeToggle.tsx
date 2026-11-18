import { Match, Switch, type Component } from "solid-js";
import { createLatestSignal } from "../lib/latestSignal";
import { t } from "../i18n";
import {
  nextPreference,
  readPreference,
  writePreference,
  type ThemePreference,
} from "../lib/theme";
import { IconMonitor, IconMoon, IconSun } from "./icons";

// Reading `localStorage` itself can throw (blocked site data); that reads as no storage.
const storage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const mark = (preference: ThemePreference): void => {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
};

// Cycling reads the preference it may have written in the same tick (two clicks before a render),
// so it reads the last written value rather than the committed one.
const [preference, setPreference, peekPreference] = createLatestSignal<ThemePreference>(
  readPreference(storage()),
);
mark(preference());

/** The current theme preference (reactive). */
export const themePreference = preference;

/** Moves to the next preference, remembers it and marks the document. */
export const cycleTheme = (): void => {
  const next = nextPreference(peekPreference());
  writePreference(storage(), next);
  setPreference(next);
  mark(next);
};

export const themeLabel = (value: ThemePreference): string => {
  switch (value) {
    case "light":
      return t("theme.light");
    case "dark":
      return t("theme.dark");
    default:
      return t("theme.system");
  }
};

/** One button cycling system, light, dark; its label names the current choice. */
export const ThemeToggle: Component = () => (
  <button
    type="button"
    class="nav-link w-full"
    data-testid="theme-toggle"
    title={t("theme.hint")}
    onClick={cycleTheme}
  >
    <Switch fallback={<IconMonitor />}>
      <Match when={preference() === "light"}>
        <IconSun />
      </Match>
      <Match when={preference() === "dark"}>
        <IconMoon />
      </Match>
    </Switch>
    <span>{t("theme.label", { theme: themeLabel(preference()) })}</span>
  </button>
);
