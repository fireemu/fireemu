import { afterEach, expect, test } from "vitest";
import { trapTab } from "./focusTrap";

afterEach(() => {
  document.body.innerHTML = "";
});

const setup = (inner: string) => {
  document.body.innerHTML = `<button id="outside">out</button><div id="dialog">${inner}</div>`;
  return document.getElementById("dialog")!;
};
const tab = (dialog: HTMLElement, shift = false) => {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, cancelable: true });
  trapTab(event, dialog);
  return event;
};

test("Tab from the last element wraps to the first, Shift+Tab from the first to the last", () => {
  const dialog = setup('<button id="a">a</button><input id="b"><button id="c">c</button>');
  document.getElementById("c")!.focus();
  expect(tab(dialog).defaultPrevented).toBe(true);
  expect(document.activeElement?.id).toBe("a");
  expect(tab(dialog, true).defaultPrevented).toBe(true);
  expect(document.activeElement?.id).toBe("c");
});

test("Tab in the middle is left to the browser", () => {
  const dialog = setup('<button id="a">a</button><input id="b"><button id="c">c</button>');
  document.getElementById("b")!.focus();
  expect(tab(dialog).defaultPrevented).toBe(false);
  expect(tab(dialog, true).defaultPrevented).toBe(false);
  expect(document.activeElement?.id).toBe("b");
});

test("a single focusable element keeps focus on both directions", () => {
  const dialog = setup('<input id="only"><li>not focusable</li>');
  document.getElementById("only")!.focus();
  expect(tab(dialog).defaultPrevented).toBe(true);
  expect(document.activeElement?.id).toBe("only");
  expect(tab(dialog, true).defaultPrevented).toBe(true);
  expect(document.activeElement?.id).toBe("only");
});

test("focus outside the dialog is brought back in", () => {
  const dialog = setup('<button id="a">a</button><button id="c">c</button>');
  document.getElementById("outside")!.focus();
  expect(tab(dialog).defaultPrevented).toBe(true);
  expect(document.activeElement?.id).toBe("a");
  document.getElementById("outside")!.focus();
  tab(dialog, true);
  expect(document.activeElement?.id).toBe("c");
});

test("disabled, hidden-input and tabindex=-1 elements are skipped", () => {
  const dialog = setup(
    '<button id="a">a</button><button id="d" disabled>d</button><input type="hidden"><span tabindex="-1" id="s"></span><a id="l" href="#x">l</a><span tabindex="0" id="z">z</span>',
  );
  document.getElementById("z")!.focus();
  tab(dialog);
  expect(document.activeElement?.id).toBe("a");
  tab(dialog, true);
  expect(document.activeElement?.id).toBe("z");
});

test("with nothing focusable the key is swallowed and focus stays", () => {
  const dialog = setup("<p>text</p>");
  document.getElementById("outside")!.focus();
  expect(tab(dialog).defaultPrevented).toBe(true);
});

test("elements with tabindex=-1 or hidden at either end are not wrap targets", () => {
  const dialog = setup(
    '<button id="h1" hidden>h</button><span tabindex="-1" id="n1">n</span><button id="a">a</button><button id="c">c</button><span tabindex="-1" id="n2">n</span><button id="h2" hidden>h</button>',
  );
  document.getElementById("c")!.focus();
  expect(tab(dialog).defaultPrevented).toBe(true);
  expect(document.activeElement?.id).toBe("a");
  expect(tab(dialog, true).defaultPrevented).toBe(true);
  expect(document.activeElement?.id).toBe("c");
});

test("other keys and modified Tab are ignored", () => {
  const dialog = setup('<button id="a">a</button>');
  document.getElementById("a")!.focus();
  const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
  trapTab(enter, dialog);
  expect(enter.defaultPrevented).toBe(false);
  const ctrl = new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, cancelable: true });
  trapTab(ctrl, dialog);
  expect(ctrl.defaultPrevented).toBe(false);
});
