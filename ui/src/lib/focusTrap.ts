// Keeps Tab and Shift+Tab inside a modal dialog: from the last focusable element Tab goes to the
// first, from the first Shift+Tab goes to the last, and focus that has left the dialog is
// brought back. Call it from the dialog's keydown handler.

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");

const focusables = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0 && !element.hidden,
  );

export const trapTab = (event: KeyboardEvent, container: HTMLElement): void => {
  if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
  const items = focusables(container);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0]!;
  const last = items.at(-1)!;
  const active = document.activeElement;
  const inside = active instanceof Node && container.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    event.preventDefault();
    first.focus();
  }
};
