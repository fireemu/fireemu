import { createSignal } from "solid-js";

// The two app-wide overlays. Their open state lives here so each can tell whether the other
// is showing, and so a button anywhere can open them.
const [paletteOpen, setPaletteOpen] = createSignal(false);
const [shortcutHelpOpen, setShortcutHelpOpen] = createSignal(false);

export { paletteOpen, setPaletteOpen, shortcutHelpOpen, setShortcutHelpOpen };

/** Opens the command palette (closing the shortcut list if it is showing). */
export const openCommandPalette = (): void => {
  setShortcutHelpOpen(false);
  setPaletteOpen(true);
};

/** Opens the keyboard shortcut list (closing the palette if it is showing). */
export const openShortcutHelp = (): void => {
  setPaletteOpen(false);
  setShortcutHelpOpen(true);
};
