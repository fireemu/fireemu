import { createSignal, For, onCleanup, Show, type Component, type JSX } from "solid-js";
import { t } from "../i18n";
import { relativeTime } from "../lib/relativeTime";
import { createSubmitGuard } from "../lib/submitGuard";
import { appState } from "../state";
import {
  IconCopy,
  IconDanger,
  IconInfo,
  IconNeutral,
  IconPaused,
  IconSuccess,
  IconWarning,
} from "./icons";

/** The meaning a state carries. Frozen clock is info, queued and cancelled are neutral. */
export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "paused";

const TONE_ICON: Record<Tone, Component> = {
  success: IconSuccess,
  warning: IconWarning,
  danger: IconDanger,
  info: IconInfo,
  neutral: IconNeutral,
  paused: IconPaused,
};

/** The badge class for a tone ("paused" reads as info). */
export const toneBadgeClass = (tone: Tone): string =>
  `badge badge-${tone === "paused" ? "info" : tone}`;

/** A status pill: a label, a tone colour and a shape icon, so it never rests on colour alone. */
export const StatusBadge: Component<{
  tone: Tone;
  children: JSX.Element;
  testId?: string | undefined;
  title?: string | undefined;
  class?: string | undefined;
  "aria-hidden"?: boolean | "true" | "false" | undefined;
}> = (props) => {
  const icon = () => TONE_ICON[props.tone];
  return (
    <span
      class={`${toneBadgeClass(props.tone)}${props.class ? ` ${props.class}` : ""}`}
      data-tone={props.tone}
      data-testid={props.testId}
      title={props.title}
      aria-hidden={props["aria-hidden"]}
    >
      {icon()({})}
      {props.children}
    </span>
  );
};

/** An error line (hidden while empty). */
export const ErrorBanner: Component<{ message: string | null | undefined }> = (props) => (
  <Show when={props.message}>
    <div role="alert" class="callout callout-danger">
      <IconDanger />
      <span class="min-w-0 flex-1 break-words">{props.message}</span>
    </div>
  </Show>
);

/** A short success line. */
export const Notice: Component<{ message: string | null | undefined }> = (props) => (
  <Show when={props.message}>
    <div role="status" class="callout callout-success">
      <IconSuccess />
      <span class="min-w-0 flex-1 break-words">{props.message}</span>
    </div>
  </Show>
);

export const Section: Component<{
  title: string;
  actions?: JSX.Element;
  children: JSX.Element;
  /** An element id, for in-page jump links (the sticky header is allowed for). */
  id?: string | undefined;
}> = (props) => (
  <section class="card mb-4 scroll-mt-20" id={props.id}>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold tracking-tight">{props.title}</h2>
      <div class="flex min-w-0 max-w-full flex-wrap items-center gap-2">{props.actions}</div>
    </div>
    {props.children}
  </section>
);

/**
 * A button running an asynchronous action once at a time (synchronous re-entry guard plus
 * `disabled` while pending).
 */
export const AsyncButton: Component<{
  onClick: () => Promise<unknown>;
  class?: string | undefined;
  disabled?: boolean | undefined;
  children: JSX.Element;
  testId?: string | undefined;
}> = (props) => {
  const guard = createSubmitGuard();
  return (
    <button
      type="button"
      class={props.class ?? "btn"}
      disabled={props.disabled || guard.pending()}
      aria-busy={guard.pending()}
      data-testid={props.testId}
      onClick={() => void guard.run(props.onClick)}
    >
      {props.children}
    </button>
  );
};

/**
 * A destructive action in two clicks: the first shows the question with confirm / cancel
 * buttons inline (no browser dialog), the second runs it.
 */
export const ConfirmButton: Component<{
  label: string;
  question: string;
  /** What the action reaches (project, session, path, recursion, undo), for heavy actions. */
  details?: string | undefined;
  onConfirm: () => Promise<unknown>;
  class?: string | undefined;
  testId?: string | undefined;
}> = (props) => {
  const [asking, setAsking] = createSignal(false);
  return (
    <Show
      when={asking()}
      fallback={
        <button
          type="button"
          class={props.class ?? "btn btn-danger"}
          data-testid={props.testId}
          onClick={() => setAsking(true)}
        >
          {props.label}
        </button>
      }
    >
      <span
        class="inline-flex flex-wrap items-center gap-2 rounded-control border border-danger-line bg-danger-subtle px-2 py-1 text-sm"
        role="alertdialog"
      >
        <span>
          <span class="font-semibold">{props.question}</span>
          <Show when={props.details}>
            <span class="block text-xs text-secondary">{props.details}</span>
          </Show>
        </span>
        <AsyncButton
          class="btn btn-danger"
          testId={props.testId ? `${props.testId}-confirm` : undefined}
          onClick={async () => {
            await props.onConfirm();
            setAsking(false);
          }}
        >
          {t("app.confirm")}
        </AsyncButton>
        <button type="button" class="btn" onClick={() => setAsking(false)}>
          {t("app.cancel")}
        </button>
      </span>
    </Show>
  );
};

/**
 * A small copy button for a value shown next to it. A refused clipboard leaves the label
 * unchanged (the value stays selectable on the page), so it never claims a copy it did not make.
 */
export const CopyButton: Component<{
  value: string;
  /** What is copied, for the accessible name ("Copy Firestore address"). */
  subject: string;
  testId?: string | undefined;
}> = (props) => {
  const [copied, setCopied] = createSignal(false);
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
    } catch {
      return;
    }
    setCopied(true);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      class="link inline-flex shrink-0 items-center gap-1 text-xs [&>svg]:size-3.5"
      aria-label={t("app.copySubject", { subject: props.subject })}
      data-testid={props.testId}
      onClick={() => void copy()}
    >
      {copied() ? <IconSuccess /> : <IconCopy />}
      <span aria-live="polite">{copied() ? t("app.copied") : t("app.copy")}</span>
    </button>
  );
};

/**
 * Jump links to the sections of a long page. They scroll and move focus; the URL is left
 * alone (a hash would be read as a route).
 */
export const SectionNav: Component<{
  label: string;
  sections: { id: string; title: string }[];
}> = (props) => (
  <nav class="mb-4 flex flex-wrap gap-2" aria-label={props.label} data-testid="section-nav">
    <For each={props.sections}>
      {(section) => (
        <button
          type="button"
          class="btn btn-sm rounded-full"
          onClick={() => {
            const target = document.getElementById(section.id);
            if (!target) return;
            target.scrollIntoView?.({ behavior: "smooth", block: "start" });
            target.setAttribute("tabindex", "-1");
            target.focus({ preventScroll: true });
          }}
        >
          {section.title}
        </button>
      )}
    </For>
  </nav>
);

/**
 * How far an instant is from the session's virtual clock ("3 min ago", "in 2 h"), shown after
 * the instant itself. Emulator timestamps are stamped by that clock, so the wall clock would
 * give the wrong distance. Renders nothing for a missing or unparsable value or clock.
 */
export const RelativeTime: Component<{ value: string | undefined }> = (props) => {
  const text = () => (props.value ? relativeTime(props.value, appState.clock()) : null);
  return (
    <Show when={text()}>
      {(distance) => (
        <span
          class="ml-1 font-sans text-xs whitespace-nowrap text-secondary"
          data-testid="relative-time"
        >
          ({distance()})
        </span>
      )}
    </Show>
  );
};

/** A key / value row for detail views. */
export const Field: Component<{ label: string; children: JSX.Element; mono?: boolean }> = (
  props,
) => (
  <div class="mb-2">
    <div class="label">{props.label}</div>
    <div class={props.mono ? "mono break-all" : "text-sm break-words"}>{props.children}</div>
  </div>
);

/**
 * A read-only value with a copy button. The value is rendered from the signal it is given
 * and is never written anywhere else: the caller owns its lifetime.
 */
export const CopyField: Component<{
  label: string;
  value: string;
  testId?: string | undefined;
}> = (props) => {
  const [copied, setCopied] = createSignal(false);
  const [field, setField] = createSignal<HTMLInputElement | undefined>();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
    } catch {
      // No clipboard permission (or no clipboard at all): select the text so the reader can
      // copy it by hand rather than losing a value that is shown exactly once.
      field()?.select();
    }
    setCopied(true);
  };
  return (
    <div class="mb-2">
      <label class="label" for={props.testId}>
        {props.label}
      </label>
      <div class="flex items-center gap-2">
        <input
          id={props.testId}
          ref={setField}
          class="input mono"
          readOnly
          value={props.value}
          data-testid={props.testId}
          onFocus={(e) => e.currentTarget.select()}
        />
        <AsyncButton onClick={copy} testId={props.testId ? `${props.testId}-copy` : undefined}>
          {copied() ? <IconSuccess /> : <IconCopy />}
          {copied() ? t("app.copied") : t("app.copy")}
        </AsyncButton>
      </div>
    </div>
  );
};

/**
 * The state of a fetched list or record, told apart so a failure never reads as "empty":
 * loading (nothing shown yet), failed (with retry), stale (an older successful read is shown
 * because the latest refresh failed), empty, or the content.
 */
export const FetchState: Component<{
  loading: boolean;
  error?: string | null | undefined;
  stale?: string | null | undefined;
  onRetry?: (() => Promise<unknown>) | undefined;
  empty?: boolean | undefined;
  emptyMessage?: string | undefined;
  children: JSX.Element;
}> = (props) => (
  <Show
    when={!props.error}
    fallback={
      <div role="alert" data-testid="fetch-error" class="callout callout-danger items-center">
        <IconDanger />
        <span class="font-semibold">{t("app.fetchFailed")}</span>
        <span class="break-all">{props.error}</span>
        <Show when={props.onRetry}>
          {(retry) => (
            <AsyncButton class="btn" onClick={retry()} testId="fetch-retry">
              {t("app.retry")}
            </AsyncButton>
          )}
        </Show>
      </div>
    }
  >
    <Show when={!props.loading} fallback={<Spinner />}>
      <Show when={props.stale}>
        <div role="status" data-testid="fetch-stale" class="callout callout-warning items-center">
          <IconWarning />
          <span class="font-semibold">{t("app.fetchStale")}</span>
          <span class="break-all">{props.stale}</span>
          <Show when={props.onRetry}>
            {(retry) => (
              <AsyncButton class="btn" onClick={retry()}>
                {t("app.retry")}
              </AsyncButton>
            )}
          </Show>
        </div>
      </Show>
      <Show
        when={!props.empty}
        fallback={<p class="text-sm text-muted">{props.emptyMessage ?? t("app.none")}</p>}
      >
        {props.children}
      </Show>
    </Show>
  </Show>
);

export const Spinner: Component = () => (
  <span class="text-sm text-muted" role="status">
    {t("app.loading")}
  </span>
);
