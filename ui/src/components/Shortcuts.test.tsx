import { flush } from "solid-js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { routed } from "../test/router";
import { useLocation } from "@solidjs/router";
import type { ParentComponent } from "solid-js";
import { CommandPalette } from "./CommandPalette";
import { paletteOpen, setPaletteOpen, setShortcutHelpOpen, shortcutHelpOpen } from "./overlays";
import { Shortcuts } from "./Shortcuts";

const PAGES = [
  { key: "o", href: "/", title: "Overview" },
  { key: "f", href: "/firestore", title: "Firestore" },
  { key: "t", href: "/runtime", title: "Runtime" },
];

const Shell: ParentComponent = (props) => {
  const location = useLocation();
  return (
    <div>
      <button type="button" data-testid="opener">
        opener
      </button>
      <input data-testid="field" />
      <textarea data-testid="area" />
      <select data-testid="choice">
        <option>one</option>
      </select>
      <div contenteditable="true" data-testid="rich">
        <span data-testid="rich-child">text</span>
      </div>
      <div contenteditable="false" data-testid="not-rich" tabindex={0} />
      <output data-testid="where">{location.pathname}</output>
      <CommandPalette links={[]} />
      <Shortcuts pages={PAGES} paletteKeys="Ctrl K" />
      {props.children}
    </div>
  );
};

const mount = () =>
  render(routed([{ path: "*", component: () => null }], { root: Shell, base: "/ui" }));

// jsdom stamps every event with the current time; the sequence tests set it explicitly.
const press = (
  target: Element | Document,
  key: string,
  init: KeyboardEventInit = {},
  at?: number,
) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  if (at !== undefined) Object.defineProperty(event, "timeStamp", { value: at });
  target.dispatchEvent(event);
  flush();
  return event;
};

beforeEach(() => {
  // The daemon serves the app under /ui; links and navigation carry that base.
  window.history.replaceState(null, "", "/ui/");
});
afterEach(() => {
  setShortcutHelpOpen(false);
  setPaletteOpen(false);
  flush();
  cleanup();
});

it("g then a page key navigates through the router", async () => {
  const ui = mount();
  press(document.body, "g", {}, 1000);
  const second = press(document.body, "f", {}, 1200);
  expect(second.defaultPrevented).toBe(true);
  await waitFor(() => expect(ui.getByTestId("where").textContent).toBe("/ui/firestore"));
  press(document.body, "g", {}, 2000);
  press(document.body, "t", {}, 2100);
  await waitFor(() => expect(ui.getByTestId("where").textContent).toBe("/ui/runtime"));
});

it("a page key without g, after the timeout, or after an unknown key does nothing", () => {
  const ui = mount();
  expect(press(document.body, "f", {}, 0).defaultPrevented).toBe(false);
  press(document.body, "g", {}, 1000);
  press(document.body, "f", {}, 2501);
  press(document.body, "g", {}, 5000);
  press(document.body, "x", {}, 5100);
  press(document.body, "f", {}, 5200);
  expect(ui.getByTestId("where").textContent).toBe("/ui/");
});

it("? opens the list, which names every shortcut, and Escape returns focus", async () => {
  const ui = mount();
  const opener = ui.getByTestId("opener");
  opener.focus();
  const event = press(opener, "?");
  expect(event.defaultPrevented).toBe(true);
  const dialog = await ui.findByTestId("shortcut-help");
  await waitFor(() => expect(document.activeElement?.textContent).toBe("Close"));
  const rows = [...ui.getByTestId("shortcut-list").querySelectorAll("tr")].map(
    (row) => row.textContent,
  );
  expect(rows).toEqual([
    "Ctrl K or /Open the command palette",
    "?Show this list",
    "EscClose the palette or this list",
    "g oGo to Overview",
    "g fGo to Firestore",
    "g tGo to Runtime",
  ]);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(ui.queryByTestId("shortcut-help")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("the backdrop and the Close button close the list; a click inside does not", async () => {
  const ui = mount();
  press(document.body, "?");
  const dialog = await ui.findByTestId("shortcut-help");
  fireEvent.click(dialog);
  expect(ui.getByTestId("shortcut-help")).toBeTruthy();
  fireEvent.click(ui.getByTestId("shortcut-help-backdrop"));
  expect(ui.queryByTestId("shortcut-help")).toBeNull();
  press(document.body, "?");
  await ui.findByTestId("shortcut-help");
  fireEvent.click(ui.getByText("Close"));
  expect(ui.queryByTestId("shortcut-help")).toBeNull();
});

it("/ opens the command palette without typing the slash into it", async () => {
  const ui = mount();
  const event = press(document.body, "/");
  expect(event.defaultPrevented).toBe(true);
  const input = (await ui.findByTestId("command-palette-input")) as HTMLInputElement;
  expect(input.value).toBe("");
  expect(paletteOpen()).toBe(true);
});

it("nothing fires while typing in a field, a select or editable content", () => {
  const ui = mount();
  for (const id of ["field", "area", "choice", "rich", "rich-child"]) {
    const target = ui.getByTestId(id);
    expect(press(target, "?").defaultPrevented, id).toBe(false);
    expect(press(target, "/").defaultPrevented, id).toBe(false);
    press(target, "g", {}, 100);
    press(target, "f", {}, 200);
    expect(shortcutHelpOpen(), id).toBe(false);
    expect(paletteOpen(), id).toBe(false);
  }
  expect(ui.getByTestId("where").textContent).toBe("/ui/");
  // contenteditable="false" is not a text field.
  press(ui.getByTestId("not-rich"), "?");
  expect(shortcutHelpOpen()).toBe(true);
});

it("typing between g and the page key abandons the sequence", () => {
  const ui = mount();
  press(document.body, "g", {}, 100);
  press(ui.getByTestId("field"), "a", {}, 150);
  press(document.body, "f", {}, 200);
  expect(ui.getByTestId("where").textContent).toBe("/ui/");
});

it("a modifier makes the key not a shortcut", () => {
  const ui = mount();
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    expect(press(document.body, "?", init).defaultPrevented).toBe(false);
    press(document.body, "g", init, 100);
    press(document.body, "f", {}, 200);
  }
  expect(shortcutHelpOpen()).toBe(false);
  expect(ui.getByTestId("where").textContent).toBe("/ui/");
});

it("shortcuts are off while an overlay is open, and a started sequence does not survive it", async () => {
  const ui = mount();
  press(document.body, "g", {}, 100);
  setPaletteOpen(true);
  flush();
  await ui.findByTestId("command-palette-input");
  press(document.body, "?", {}, 150);
  expect(shortcutHelpOpen()).toBe(false);
  setPaletteOpen(false);
  flush();
  press(document.body, "f", {}, 200);
  expect(ui.getByTestId("where").textContent).toBe("/ui/");
  setShortcutHelpOpen(true);
  flush();
  press(document.body, "g", {}, 300);
  press(document.body, "f", {}, 350);
  expect(press(document.body, "/", {}, 400).defaultPrevented).toBe(false);
  expect(paletteOpen()).toBe(false);
  expect(ui.getByTestId("where").textContent).toBe("/ui/");
});

it("opening one overlay closes the other", async () => {
  const { openCommandPalette, openShortcutHelp } = await import("./overlays");
  mount();
  openCommandPalette();
  openShortcutHelp();
  flush();
  expect(paletteOpen()).toBe(false);
  expect(shortcutHelpOpen()).toBe(true);
  openCommandPalette();
  flush();
  expect(paletteOpen()).toBe(true);
  expect(shortcutHelpOpen()).toBe(false);
});
