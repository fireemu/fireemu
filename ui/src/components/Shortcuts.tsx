import { useNavigate } from "@solidjs/router";
import { createEffect, For, on, onCleanup, onMount, Show, type Component } from "solid-js";
import { t } from "../i18n";
import { trapTab } from "../lib/focusTrap";
import { IDLE, stepShortcut, type ShortcutState } from "../lib/shortcuts";
import {
  openCommandPalette,
  openShortcutHelp,
  paletteOpen,
  setShortcutHelpOpen,
  shortcutHelpOpen,
} from "./overlays";

export type PageShortcut = { key: string; href: string; title: string };

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  (target.matches("input, textarea, select") ||
    target.closest("[contenteditable]:not([contenteditable='false'])") !== null);

/**
 * Single-key shortcuts (`?`, `/`, `g` then a page key) and the dialog that lists them. Nothing
 * fires while a field has focus, with a modifier held, or while an overlay is open.
 */
export const Shortcuts: Component<{ pages: PageShortcut[]; paletteKeys: string }> = (props) => {
  const navigate = useNavigate();
  let state: ShortcutState = IDLE;
  let opener: Element | null = null;
  let closeButton: HTMLButtonElement | undefined;

  const close = () => {
    setShortcutHelpOpen(false);
    if (opener instanceof HTMLElement) opener.focus();
    opener = null;
  };

  const onKey = (event: KeyboardEvent) => {
    if (paletteOpen() || shortcutHelpOpen()) {
      state = IDLE;
      return;
    }
    const goKeys = Object.fromEntries(props.pages.map((page) => [page.key, page.href]));
    const result = stepShortcut(
      state,
      {
        key: event.key,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        editable: isEditable(event.target),
        time: event.timeStamp,
      },
      goKeys,
    );
    state = result.state;
    const action = result.action;
    if (action.kind === "none") return;
    // The key has been used: it must not also be typed into whatever takes focus next.
    event.preventDefault();
    if (action.kind === "help") openShortcutHelp();
    else if (action.kind === "palette") openCommandPalette();
    else navigate(action.href);
  };
  onMount(() => {
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });
  createEffect(
    on(shortcutHelpOpen, (isOpen) => {
      if (!isOpen) return;
      opener = document.activeElement;
      queueMicrotask(() => closeButton?.focus());
    }),
  );

  return (
    <Show when={shortcutHelpOpen()}>
      <div
        class="fixed inset-0 z-50 flex items-start justify-center overlay p-4 pt-[12vh]"
        data-testid="shortcut-help-backdrop"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcut-help-title"
          class="max-h-[76vh] w-full max-w-lg overflow-y-auto dialog p-4"
          data-testid="shortcut-help"
          onKeyDown={(event) => {
            trapTab(event, event.currentTarget);
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 id="shortcut-help-title" class="text-base font-semibold tracking-tight">
              {t("shortcuts.title")}
            </h2>
            <button
              type="button"
              class="btn"
              ref={(element) => {
                closeButton = element;
              }}
              onClick={close}
            >
              {t("app.close")}
            </button>
          </div>
          <table class="table" data-testid="shortcut-list">
            <tbody>
              <tr>
                <td class="whitespace-nowrap">
                  <span class="kbd">{props.paletteKeys}</span> {t("shortcuts.or")}{" "}
                  <span class="kbd">/</span>
                </td>
                <td>{t("shortcuts.palette")}</td>
              </tr>
              <tr>
                <td>
                  <span class="kbd">?</span>
                </td>
                <td>{t("shortcuts.help")}</td>
              </tr>
              <tr>
                <td>
                  <span class="kbd">Esc</span>
                </td>
                <td>{t("shortcuts.close")}</td>
              </tr>
              <For each={props.pages}>
                {(page) => (
                  <tr>
                    <td class="whitespace-nowrap">
                      <span class="kbd">g</span> <span class="kbd">{page.key}</span>
                    </td>
                    <td>{t("shortcuts.goTo", { page: page.title })}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <p class="hint mt-3 text-xs">{t("shortcuts.note")}</p>
        </div>
      </div>
    </Show>
  );
};
