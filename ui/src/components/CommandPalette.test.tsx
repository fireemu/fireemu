import { flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { routed } from "../test/router";
import { useLocation } from "@solidjs/router";
import type { ParentComponent } from "solid-js";
import { appState } from "../state";
import { CommandPalette, openCommandPalette } from "./CommandPalette";
import { setShortcutHelpOpen, shortcutHelpOpen } from "./overlays";
import { cycleTheme, themePreference } from "./ThemeToggle";

const LINKS = [
  { href: "/", title: "Overview" },
  { href: "/firestore", title: "Firestore", keywords: "documents" },
  { href: "/functions", title: "Functions", keywords: "logs" },
];

const Shell: ParentComponent = (props) => {
  const location = useLocation();
  return (
    <div>
      <button type="button" data-testid="opener">
        opener
      </button>
      <output data-testid="where">{location.pathname + location.search}</output>
      <CommandPalette links={LINKS} />
      {props.children}
    </div>
  );
};

const mount = () =>
  render(routed([{ path: "*", component: () => null }], { root: Shell, base: "/ui" }));

const press = (target: Element | Window, key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key, ...init });

beforeEach(() => {
  // The daemon serves the app under /ui; links and navigation carry that base.
  window.history.replaceState(null, "", "/ui/");
  appState.setSessions([
    { name: "default", project: "demo-a" },
    { name: "other", project: "demo-b" },
  ]);
  appState.setSession("default");
  flush();
});
afterEach(() => {
  // Leave the module-level palette closed for the next test.
  const input = document.querySelector('[data-testid="command-palette-input"]');
  if (input) press(input, "Escape");
  cleanup();
  while (themePreference() !== "system") {
    cycleTheme();
    flush();
  }
  vi.restoreAllMocks();
});

const options = (ui: ReturnType<typeof mount>) =>
  [...ui.container.querySelectorAll('[role="option"]')].map((o) => o.textContent);
const selectedOption = (ui: ReturnType<typeof mount>) =>
  ui.container.querySelector('[role="option"][aria-selected="true"]')?.textContent;

it("is closed until Ctrl+K or Cmd+K, and the same key closes it again", () => {
  const ui = mount();
  expect(ui.queryByTestId("command-palette")).toBeNull();
  press(window, "k");
  expect(ui.queryByTestId("command-palette")).toBeNull();
  press(window, "k", { ctrlKey: true, altKey: true });
  expect(ui.queryByTestId("command-palette")).toBeNull();
  press(window, "k", { ctrlKey: true });
  expect(ui.getByTestId("command-palette")).toBeTruthy();
  press(window, "K", { metaKey: true });
  expect(ui.queryByTestId("command-palette")).toBeNull();
  press(window, "k", { metaKey: true });
  expect(ui.getByTestId("command-palette")).toBeTruthy();
});

it("focuses the input when opened and returns focus to the opener on Escape", async () => {
  const ui = mount();
  const opener = ui.getByTestId("opener");
  opener.focus();
  openCommandPalette();
  flush();
  const input = await ui.findByTestId("command-palette-input");
  await waitFor(() => expect(document.activeElement).toBe(input));
  press(input, "Escape");
  expect(ui.queryByTestId("command-palette")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("lists pages, the other sessions and the actions, and filters as the query changes", async () => {
  const ui = mount();
  openCommandPalette();
  flush();
  const input = await ui.findByTestId("command-palette-input");
  expect(options(ui)).toEqual([
    "OverviewGo to",
    "FirestoreGo to",
    "FunctionsGo to",
    "Switch to session other (demo-b)Session",
    "Switch theme (now: System)Action",
    "Copy the .env lines for the selected sessionAction",
    "Show keyboard shortcutsAction",
  ]);
  fireEvent.input(input, { target: { value: "logs" } });
  expect(options(ui)).toEqual(["FunctionsGo to"]);
  fireEvent.input(input, { target: { value: "zzzz" } });
  expect(options(ui)).toEqual([]);
  expect(ui.getByTestId("command-palette").textContent).toContain("Nothing matches");
});

it("moves the selection with the arrows, wrapping, and resets it for a new query", async () => {
  const ui = mount();
  openCommandPalette();
  flush();
  const input = await ui.findByTestId("command-palette-input");
  expect(selectedOption(ui)).toBe("OverviewGo to");
  expect(input.getAttribute("aria-activedescendant")).toBe("command-palette-option-0");
  press(input, "ArrowDown");
  expect(selectedOption(ui)).toBe("FirestoreGo to");
  expect(input.getAttribute("aria-activedescendant")).toBe("command-palette-option-1");
  press(input, "ArrowUp");
  press(input, "ArrowUp");
  expect(selectedOption(ui)).toBe("Show keyboard shortcutsAction");
  press(input, "ArrowDown");
  expect(selectedOption(ui)).toBe("OverviewGo to");
  press(input, "ArrowDown");
  fireEvent.input(input, { target: { value: "f" } });
  await waitFor(() => expect(selectedOption(ui)).toBe("FirestoreGo to"));
});

it("Enter opens the highlighted page through the router and closes the palette", async () => {
  const ui = mount();
  openCommandPalette();
  flush();
  const input = await ui.findByTestId("command-palette-input");
  fireEvent.input(input, { target: { value: "func" } });
  press(input, "Enter");
  await waitFor(() => expect(ui.getByTestId("where").textContent).toBe("/ui/functions"));
  expect(ui.queryByTestId("command-palette")).toBeNull();
  // The next opening starts from an empty query.
  openCommandPalette();
  flush();
  expect(((await ui.findByTestId("command-palette-input")) as HTMLInputElement).value).toBe("");
});

it("a query with a slash offers the Firestore path first, encoded", async () => {
  const ui = mount();
  openCommandPalette();
  flush();
  const input = await ui.findByTestId("command-palette-input");
  fireEvent.input(input, { target: { value: "users/a b" } });
  expect(options(ui)[0]).toBe("Open users/a b in FirestoreFirestore");
  press(input, "Enter");
  await waitFor(() =>
    expect(ui.getByTestId("where").textContent).toBe("/ui/firestore/users/a%20b?db=(default)"),
  );
});

it("Enter during IME composition does not run a command", async () => {
  const ui = mount();
  openCommandPalette();
  flush();
  const input = await ui.findByTestId("command-palette-input");
  press(input, "ArrowDown");
  press(input, "Enter", { isComposing: true });
  expect(ui.getByTestId("command-palette")).toBeTruthy();
  expect(ui.getByTestId("where").textContent).toBe("/ui/");
});

it("clicking a row runs it; clicking the backdrop only closes", async () => {
  const ui = mount();
  openCommandPalette();
  flush();
  await ui.findByTestId("command-palette-input");
  fireEvent.click(ui.getByTestId("command-palette"));
  expect(ui.getByTestId("command-palette")).toBeTruthy();
  fireEvent.click(ui.getByTestId("command-palette-backdrop"));
  expect(ui.queryByTestId("command-palette")).toBeNull();
  expect(ui.getByTestId("where").textContent).toBe("/ui/");
  openCommandPalette();
  flush();
  await ui.findByTestId("command-palette-input");
  fireEvent.click(ui.getByText("Firestore"));
  await waitFor(() => expect(ui.getByTestId("where").textContent).toBe("/ui/firestore"));
});

it("the theme action cycles the theme and the session action switches the session", async () => {
  const ui = mount();
  openCommandPalette();
  flush();
  let input = await ui.findByTestId("command-palette-input");
  fireEvent.input(input, { target: { value: "theme" } });
  press(input, "Enter");
  expect(themePreference()).toBe("light");
  const refresh = vi.spyOn(appState, "refreshClock").mockResolvedValue();
  openCommandPalette();
  flush();
  input = await ui.findByTestId("command-palette-input");
  fireEvent.input(input, { target: { value: "session other" } });
  expect(options(ui)).toEqual(["Switch to session other (demo-b)Session"]);
  press(input, "Enter");
  expect(appState.session()).toBe("other");
  expect(refresh).toHaveBeenCalledTimes(1);
  // The selected session is not offered as a target.
  openCommandPalette();
  flush();
  await ui.findByTestId("command-palette-input");
  expect(options(ui).some((o) => o?.includes("session other"))).toBe(false);
  expect(options(ui).some((o) => o?.includes("session default"))).toBe(true);
});

it("the copy action writes the .env lines of the selected session's project", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  appState.setConfig({
    ...appState.config(),
    firestoreAddr: "127.0.0.1:8080",
    httpAddr: "127.0.0.1:9099",
    storageAddr: "127.0.0.1:9199",
    functionsAddr: null,
  });
  flush();
  const ui = mount();
  openCommandPalette();
  flush();
  const input = await ui.findByTestId("command-palette-input");
  fireEvent.input(input, { target: { value: "dotenv" } });
  press(input, "Enter");
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0]![0]).toContain("GOOGLE_CLOUD_PROJECT=demo-a");
  expect(writeText.mock.calls[0]![0]).toContain("FIRESTORE_EMULATOR_HOST=127.0.0.1:8080");
});

it("the shortcuts action closes the palette and opens the shortcut list", async () => {
  const ui = mount();
  openCommandPalette();
  flush();
  const input = await ui.findByTestId("command-palette-input");
  fireEvent.input(input, { target: { value: "hotkeys" } });
  expect(options(ui)).toEqual(["Show keyboard shortcutsAction"]);
  press(input, "Enter");
  expect(ui.queryByTestId("command-palette")).toBeNull();
  expect(shortcutHelpOpen()).toBe(true);
  setShortcutHelpOpen(false);
  flush();
});
