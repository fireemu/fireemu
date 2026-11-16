import { useNavigate } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type Component,
} from "solid-js";
import { t } from "../i18n";
import {
  filterCommands,
  moveSelection,
  pathCommand,
  type PaletteCommand,
} from "../lib/commandPalette";
import { trapTab } from "../lib/focusTrap";
import { dotenvSnippet } from "../lib/sdkSnippets";
import { requestScopeChange } from "../lib/unsaved";
import { appState } from "../state";
import { IconSearch } from "./icons";
import { openCommandPalette, openShortcutHelp, paletteOpen, setPaletteOpen } from "./overlays";
import { cycleTheme, themeLabel, themePreference } from "./ThemeToggle";

const open = paletteOpen;
const setOpen = setPaletteOpen;

export { openCommandPalette };

export type PaletteLink = { href: string; title: string; keywords?: string };

/**
 * A keyboard-first launcher: pages, a Firestore path typed with a slash, sessions and a few
 * actions. It starts no request of its own; a navigation goes through the router, so a page's
 * unsaved-draft guard still decides.
 */
export const CommandPalette: Component<{ links: PaletteLink[] }> = (props) => {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let opener: Element | null = null;
  let input: HTMLInputElement | undefined;

  const commands = createMemo<PaletteCommand[]>(() => [
    ...props.links.map((link): PaletteCommand => ({
      id: `go:${link.href}`,
      title: link.title,
      group: t("palette.groupGo"),
      href: link.href,
      ...(link.keywords ? { keywords: link.keywords } : {}),
    })),
    ...appState
      .sessions()
      .filter((s) => s.name !== appState.session())
      .map((s): PaletteCommand => ({
        id: `session:${s.name}`,
        title: t("palette.switchSession", { session: s.name, project: s.project }),
        group: t("palette.groupSession"),
        action: `session:${s.name}`,
      })),
    {
      id: "theme",
      title: t("palette.switchTheme", { theme: themeLabel(themePreference()) }),
      group: t("palette.groupActions"),
      keywords: "dark light appearance",
      action: "theme",
    },
    {
      id: "copy-env",
      title: t("palette.copyEnv"),
      group: t("palette.groupActions"),
      keywords: "dotenv environment FIRESTORE_EMULATOR_HOST",
      action: "copy-env",
    },
    {
      id: "shortcuts",
      title: t("palette.showShortcuts"),
      group: t("palette.groupActions"),
      keywords: "keys help hotkeys",
      action: "shortcuts",
    },
  ]);

  const results = createMemo<PaletteCommand[]>(() => {
    const path = pathCommand(
      query(),
      (p) => t("palette.openPath", { path: p }),
      t("palette.groupFirestore"),
    );
    const matched = filterCommands(commands(), query());
    return path ? [path, ...matched] : matched;
  });
  // A new query always starts from the best match.
  createEffect(on(query, () => setSelected(0), { defer: true }));

  const close = () => {
    setOpen(false);
    setQuery("");
    if (opener instanceof HTMLElement) opener.focus();
    opener = null;
  };

  const run = (command: PaletteCommand | undefined) => {
    if (!command) return;
    close();
    if (command.href !== undefined) {
      navigate(command.href);
      return;
    }
    const action = command.action ?? "";
    if (action === "theme") cycleTheme();
    else if (action === "shortcuts") openShortcutHelp();
    else if (action === "copy-env") {
      const config = appState.config();
      void navigator.clipboard
        ?.writeText(dotenvSnippet({ ...config, project: appState.project() }))
        .catch(() => undefined);
    } else if (action.startsWith("session:")) {
      const name = action.slice("session:".length);
      requestScopeChange(() => {
        appState.setSession(name);
        void appState.refreshClock();
      });
    }
  };

  const onGlobalKey = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (open()) close();
      else openCommandPalette();
    }
  };
  onMount(() => {
    window.addEventListener("keydown", onGlobalKey);
    onCleanup(() => window.removeEventListener("keydown", onGlobalKey));
  });
  createEffect(
    on(open, (isOpen) => {
      if (!isOpen) return;
      opener = document.activeElement;
      queueMicrotask(() => input?.focus());
    }),
  );

  const onKeyDown = (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    trapTab(event, event.currentTarget);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected(moveSelection(selected(), 1, results().length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(moveSelection(selected(), -1, results().length));
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      run(results()[selected()]);
    }
  };

  return (
    <Show when={open()}>
      <div
        class="fixed inset-0 z-50 flex items-start justify-center overlay p-4 pt-[12vh]"
        data-testid="command-palette-backdrop"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("palette.title")}
          class="w-full max-w-xl overflow-hidden dialog"
          data-testid="command-palette"
          onKeyDown={onKeyDown}
        >
          {/* The combobox input draws no outline of its own (the dialog clips it); its row shows
              keyboard focus with an inset focus-ring outline instead. */}
          <div class="flex items-center gap-2 border-b border-line-subtle px-3 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-focus [&>svg]:size-4 [&>svg]:text-muted">
            <IconSearch />
            <input
              ref={(element) => {
                input = element;
              }}
              class="mono w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-activedescendant={
                results().length > 0 ? `command-palette-option-${selected()}` : undefined
              }
              aria-label={t("palette.title")}
              placeholder={t("palette.placeholder")}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              data-testid="command-palette-input"
            />
            <span class="kbd">Esc</span>
          </div>
          <ul
            id="command-palette-list"
            role="listbox"
            aria-label={t("palette.title")}
            class="max-h-[50vh] overflow-y-auto p-1"
          >
            <For each={results()}>
              {(command, index) => (
                <li
                  id={`command-palette-option-${index()}`}
                  role="option"
                  aria-selected={index() === selected()}
                  class="flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-selected aria-selected:text-on-selected"
                  onMouseMove={() => setSelected(index())}
                  onClick={() => run(command)}
                >
                  <span class="min-w-0 break-all">{command.title}</span>
                  <span class="shrink-0 text-xs text-muted">{command.group}</span>
                </li>
              )}
            </For>
            <Show when={results().length === 0}>
              <li class="px-3 py-6 text-center text-sm text-muted" role="presentation">
                {t("palette.empty")}
              </li>
            </Show>
          </ul>
          <div class="flex flex-wrap gap-x-4 gap-y-1 border-t border-line-subtle px-3 py-2 text-xs text-muted">
            <span>
              <span class="kbd">↑</span> <span class="kbd">↓</span> {t("palette.hintMove")}
            </span>
            <span>
              <span class="kbd">Enter</span> {t("palette.hintRun")}
            </span>
            <span>{t("palette.hintPath")}</span>
          </div>
        </div>
      </div>
    </Show>
  );
};
