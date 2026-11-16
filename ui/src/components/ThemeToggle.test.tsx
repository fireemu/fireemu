import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { THEME_STORAGE_KEY } from "../lib/theme";
import { ThemeToggle, cycleTheme, themePreference } from "./ThemeToggle";

afterEach(() => {
  cleanup();
  while (themePreference() !== "system") cycleTheme();
});

it("starts on the system theme with no mark on the document and nothing stored", () => {
  const ui = render(() => <ThemeToggle />);
  expect(themePreference()).toBe("system");
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(ui.getByTestId("theme-toggle").textContent).toBe("Theme: System");
});

it("cycles light, dark and back to system, marking and storing only explicit choices", () => {
  const ui = render(() => <ThemeToggle />);
  const button = ui.getByTestId("theme-toggle");
  fireEvent.click(button);
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  expect(button.textContent).toBe("Theme: Light");
  fireEvent.click(button);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  expect(button.textContent).toBe("Theme: Dark");
  fireEvent.click(button);
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(button.textContent).toBe("Theme: System");
});
