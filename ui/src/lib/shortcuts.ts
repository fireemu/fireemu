// Single-key shortcuts as a small state machine: `?` (help), `/` (palette) and `g` followed
// by a page key. Pure; the component feeds it key events and performs the action.

export type ShortcutState = { goSince: number | null };
export const IDLE: ShortcutState = { goSince: null };

/** How long after `g` the page key is still accepted. */
export const GO_TIMEOUT_MS = 1500;

export type ShortcutKey = {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  /** The event came from a text field, a select or editable content. */
  editable: boolean;
  /** A monotonic time in milliseconds. */
  time: number;
};

export type ShortcutAction =
  | { kind: "none" }
  | { kind: "help" }
  | { kind: "palette" }
  | { kind: "go"; href: string };

const NONE: ShortcutAction = { kind: "none" };

/**
 * The next state and what to do for one key press. `goKeys` maps the second key of a `g`
 * sequence to a route. Typing in a field, or holding Ctrl, Meta or Alt, is never a shortcut.
 */
export const stepShortcut = (
  state: ShortcutState,
  event: ShortcutKey,
  goKeys: Readonly<Record<string, string>>,
): { state: ShortcutState; action: ShortcutAction } => {
  if (event.editable || event.ctrl || event.meta || event.alt) {
    return { state: IDLE, action: NONE };
  }
  if (state.goSince !== null && event.time - state.goSince <= GO_TIMEOUT_MS) {
    const href = Object.hasOwn(goKeys, event.key) ? goKeys[event.key] : undefined;
    return { state: IDLE, action: href === undefined ? NONE : { kind: "go", href } };
  }
  switch (event.key) {
    case "g":
      return { state: { goSince: event.time }, action: NONE };
    case "?":
      return { state: IDLE, action: { kind: "help" } };
    case "/":
      return { state: IDLE, action: { kind: "palette" } };
    default:
      return { state: IDLE, action: NONE };
  }
};
