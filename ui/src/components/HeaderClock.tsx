import { A } from "@solidjs/router";
import { createEffect, createSignal, For, on, onCleanup, Show, type Component } from "solid-js";
import { freezeClock, moveClock, resumeClock } from "../api/control";
import { t, type MessageKey } from "../i18n";
import { appState } from "../state";
import { AsyncButton, ErrorBanner, StatusBadge } from "./common";

const QUICK_MOVES: { id: string; seconds: number; label: MessageKey }[] = [
  { id: "1m", seconds: 60, label: "header.clockPlus1m" },
  { id: "15m", seconds: 900, label: "header.clockPlus15m" },
  { id: "1h", seconds: 3600, label: "header.clockPlus1h" },
  { id: "1d", seconds: 86400, label: "header.clockPlus1d" },
];

/**
 * Interactive virtual clock control in the top context bar.
 * Preserves `data-testid="clock"` and `data-testid="clock-mode"` while opening an on-demand
 * popover for freeze/resume, quick advances and real-time sync using the shared `clockGuard`.
 */
export const HeaderClock: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let container: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let closeButton: HTMLButtonElement | undefined;
  const guard = appState.clockGuard;
  const frozen = () => appState.clockMode() === "frozen";

  const close = (restoreFocus = false) => {
    setOpen(false);
    setError(null);
    if (restoreFocus) trigger?.focus();
  };

  createEffect(
    on(open, (isOpen) => {
      if (!isOpen) return;
      queueMicrotask(() => closeButton?.focus());
      const onPointerDown = (event: PointerEvent) => {
        if (container && event.target instanceof Node && !container.contains(event.target)) {
          close(false);
        }
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(true);
        }
      };
      window.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("keydown", onKeyDown);
      onCleanup(() => {
        window.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("keydown", onKeyDown);
      });
    }),
  );

  const toggleMode = () =>
    guard.run(async () => {
      setError(null);
      appState.invalidatePolls();
      const result = await (frozen()
        ? resumeClock(appState.session(), false, false)
        : freezeClock(appState.session()));
      result.match(
        (info) => appState.applyClockMutation(info),
        (err) => setError(err.message),
      );
    });

  const advanceBy = (seconds: number) =>
    guard.run(async () => {
      setError(null);
      appState.invalidatePolls();
      const result = await moveClock(appState.session(), {
        action: "advance",
        move: { seconds },
      });
      result.match(
        (info) => appState.applyClockMutation(info),
        (err) => setError(err.message),
      );
    });

  const syncRealTime = () =>
    guard.run(async () => {
      setError(null);
      appState.invalidatePolls();
      const result = await resumeClock(appState.session(), true, true);
      result.match(
        (info) => appState.applyClockMutation(info),
        (err) => setError(err.message),
      );
    });

  return (
    <div
      ref={(el) => {
        container = el;
      }}
      class="relative inline-flex min-w-0 max-w-full items-center gap-1.5"
    >
      <span class="label">{t("overview.clock")}</span>
      <button
        ref={(el) => {
          trigger = el;
        }}
        type="button"
        class="inline-flex items-center gap-1.5 rounded-control px-1.5 py-0.5 text-left transition-colors hover:bg-hover"
        aria-haspopup="dialog"
        aria-expanded={open()}
        title={t("header.clockOpen")}
        data-testid="header-clock-trigger"
        onClick={() => setOpen((was) => !was)}
      >
        <span class="mono whitespace-nowrap" data-testid="clock" title={appState.clock()}>
          {appState.clock().replace(/\.\d+Z$/, "Z")}
        </span>
        <StatusBadge
          tone={frozen() ? "paused" : "neutral"}
          testId="clock-mode"
          title={frozen() ? t("overview.clockFrozen") : t("overview.clockRealtime")}
        >
          {frozen() ? t("header.clockFrozen") : t("header.clockRealtime")}
        </StatusBadge>
      </button>
      <Show when={open()}>
        <div
          role="dialog"
          aria-label={t("header.clockControls")}
          data-testid="clock-popover"
          class="dialog absolute top-full right-0 z-30 mt-1.5 w-80 max-w-[90vw] p-3 text-sm sm:right-auto sm:left-0"
        >
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="font-semibold text-content">{t("header.clockControls")}</span>
            <button
              ref={(el) => {
                closeButton = el;
              }}
              type="button"
              class="btn btn-sm"
              onClick={() => close(true)}
            >
              {t("app.close")}
            </button>
          </div>
          <p class="mono mb-2 text-xs text-muted" data-testid="clock-full-precision">
            {appState.clock()}
          </p>
          <ErrorBanner message={error()} />
          <div class="mb-2.5 flex flex-wrap gap-1.5">
            <AsyncButton
              class="btn btn-sm btn-primary"
              disabled={guard.pending()}
              testId="header-clock-toggle-mode"
              onClick={toggleMode}
            >
              {frozen() ? t("runtime.resume") : t("runtime.freeze")}
            </AsyncButton>
            <AsyncButton
              class="btn btn-sm"
              disabled={guard.pending()}
              testId="header-clock-sync"
              onClick={syncRealTime}
            >
              {t("runtime.syncToRealTime")}
            </AsyncButton>
          </div>
          <div class="mb-2.5 grid grid-cols-2 gap-1.5">
            <For each={QUICK_MOVES}>
              {(preset) => (
                <AsyncButton
                  class="btn btn-sm"
                  disabled={guard.pending()}
                  testId={`header-clock-plus-${preset.id}`}
                  onClick={() => advanceBy(preset.seconds)}
                >
                  {t(preset.label)}
                </AsyncButton>
              )}
            </For>
          </div>
          <div class="border-t border-line-subtle pt-2 text-xs">
            <A href="/runtime" class="link" onClick={() => close(false)}>
              {t("header.clockFullControls")}
            </A>
          </div>
        </div>
      </Show>
    </div>
  );
};
