import { createEffect, createSignal, For, on, Show, type Component, type JSX } from "solid-js";
import { t } from "../i18n";
import { appState } from "../state";
import {
  AsyncButton,
  CopyButton,
  Field,
  Section,
  FetchState,
  StatusBadge,
} from "../components/common";
import { IconAuth, IconFirestore, IconFunctions, IconStorage } from "../components/icons";
import { functionsStatus, getRules, sessionResources } from "../api/control";
import { settle } from "../api/client";
import { appHref } from "../lib/hrefs";
import { overviewStats } from "../lib/overviewStats";
import { formatQuantity } from "../lib/resources";
import { createScopedFetch } from "../lib/rules-state";
import { snippetFor, type SnippetKind } from "../lib/sdkSnippets";

/** A block of text with a copy button (clipboard, or select-all when denied). */
const CopyBlock: Component<{ text: string; testId: string }> = (props) => {
  const [copied, setCopied] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal("");
  const [manualCopy, setManualCopy] = createSignal(false);
  let manualInput: HTMLTextAreaElement | undefined;
  const copy = async () => {
    setManualCopy(false);
    setCopied(false);
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      setCopyStatus(t("app.copied"));
    } catch {
      setCopyStatus(t("app.copyManually"));
      setManualCopy(true);
      queueMicrotask(() => {
        manualInput?.focus();
        manualInput?.select();
      });
    }
  };
  return (
    <div class="relative">
      <pre class="mono code-block pr-20 break-all whitespace-pre-wrap" data-testid={props.testId}>
        {props.text}
      </pre>
      <AsyncButton
        class="btn absolute top-2 right-2"
        onClick={copy}
        testId={`${props.testId}-copy`}
      >
        {copied() ? t("app.copied") : t("app.copy")}
      </AsyncButton>
      <p role="status" class="mt-1 text-sm" data-testid={`${props.testId}-copy-status`}>
        {copyStatus()}
      </p>
      <Show when={manualCopy()}>
        <textarea
          ref={(element) => {
            manualInput = element;
          }}
          class="input mono mt-2 w-full"
          readonly
          value={props.text}
          aria-label={t("app.copyManually")}
        />
      </Show>
    </div>
  );
};

const RulesStatus: Component<{ which: "firestore" | "storage" }> = (props) => {
  const info = createScopedFetch(
    () => JSON.stringify([appState.session(), appState.project()]),
    () => settle(getRules(props.which)),
  );
  return (
    <FetchState
      loading={info.loading() && info.data() === undefined}
      error={info.data() === undefined ? info.error() : null}
      stale={info.data() !== undefined ? info.error() : null}
      onRetry={info.refetch}
    >
      <Show when={info.loading()}>
        <span role="status">{t("rules.refreshing")}</span>
      </Show>
      <div class="flex flex-wrap items-center gap-2">
        <Show when={info.data()}>
          {(data) => (
            <StatusBadge tone={data().loaded ? "success" : "warning"}>
              {data().loaded ? t("rules.loaded") : t("rules.notLoaded")}
            </StatusBadge>
          )}
        </Show>
        <AsyncButton class="btn" onClick={info.refetch} testId={`overview-${props.which}-refresh`}>
          {t("rules.refresh")}
        </AsyncButton>
      </div>
    </FetchState>
  );
};

/** One figure of the summary row, linking to the page that owns it. */
const StatTile: Component<{
  id: string;
  href: string;
  label: string;
  icon: JSX.Element;
  /** `null` while unknown: shown as a dash, never as zero. */
  value: string | null;
  detail: string;
}> = (props) => (
  <a class="stat" href={appHref(props.href)} data-testid={`stat-${props.id}`}>
    <div class="flex items-center gap-2 text-xs font-semibold tracking-wide text-secondary uppercase [&>svg]:size-4 [&>svg]:shrink-0">
      {props.icon}
      {props.label}
    </div>
    <div class="stat-value mt-1" data-testid={`stat-${props.id}-value`}>
      <Show when={props.value !== null} fallback={<span title={t("app.unknown")}>—</span>}>
        {props.value}
      </Show>
    </div>
    <div class="text-xs text-secondary">{props.detail}</div>
  </a>
);

/** The summary row: what each product holds for the selected session. */
const Stats: Component = () => {
  const scope = () => JSON.stringify([appState.session(), appState.project()]);
  const resources = createScopedFetch(scope, () => settle(sessionResources(appState.session())));
  const functions = createScopedFetch(scope, () => settle(functionsStatus(appState.session())));
  // Follow the header's poll: the figures refresh when the daemon last answered.
  createEffect(
    on(
      appState.lastConnectedAt,
      () => {
        void resources.refetch();
        if (appState.config().functionsConfigured) void functions.refetch();
      },
      { defer: true },
    ),
  );
  const stats = () => {
    const report = resources.data();
    return report ? overviewStats(report) : null;
  };
  const count = (value: number | null | undefined): string | null =>
    value === null || value === undefined ? null : String(value);
  const configured = () => appState.config().functionsConfigured;
  return (
    <div
      class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
      role="group"
      aria-label={t("overview.statsLabel")}
      data-testid="overview-stats"
    >
      <StatTile
        id="firestore"
        href="/firestore"
        label={t("nav.firestore")}
        icon={<IconFirestore />}
        value={
          stats()?.firestoreLiveBytes === null || stats()?.firestoreLiveBytes === undefined
            ? null
            : formatQuantity(stats()!.firestoreLiveBytes!, "bytes")
        }
        detail={[
          t("overview.statLiveData"),
          ...(stats()?.firestoreDatabases === null || stats()?.firestoreDatabases === undefined
            ? []
            : [
                stats()!.firestoreDatabases === 1
                  ? t("overview.statDatabase")
                  : t("overview.statDatabases", { count: stats()!.firestoreDatabases! }),
              ]),
        ].join(" · ")}
      />
      <StatTile
        id="auth"
        href="/auth"
        label={t("nav.auth")}
        icon={<IconAuth />}
        value={count(stats()?.authUsers)}
        detail={t("overview.statUsers")}
      />
      <StatTile
        id="storage"
        href="/storage"
        label={t("nav.storage")}
        icon={<IconStorage />}
        value={count(stats()?.storageObjects)}
        detail={t("overview.statObjects", {
          bytes:
            stats()?.storageBytes === null || stats()?.storageBytes === undefined
              ? "—"
              : formatQuantity(stats()!.storageBytes!, "bytes"),
        })}
      />
      <StatTile
        id="functions"
        href="/functions"
        label={t("nav.functions")}
        icon={<IconFunctions />}
        value={configured() ? count(functions.data()?.functions.length) : null}
        detail={
          !configured()
            ? t("overview.statNotConfigured")
            : (functions.data()?.running ?? 0) > 0
              ? t("overview.statFunctionsRunning", { running: functions.data()!.running })
              : t("overview.statFunctions")
        }
      />
    </div>
  );
};

/** An address with its copy button. */
const Address: Component<{ label: string; value: string; note?: string | null | undefined }> = (
  props,
) => (
  <div class="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-line-subtle py-1.5 last:border-b-0 ">
    <span class="text-sm text-secondary">{props.label}</span>
    <span class="flex min-w-0 items-baseline gap-2">
      <span class="mono min-w-0 break-all">
        {props.value}
        <Show when={props.note}>
          <span class="text-secondary"> ({props.note})</span>
        </Show>
      </span>
      <CopyButton value={props.value} subject={props.label} />
    </span>
  </div>
);

const SNIPPET_KINDS: { kind: SnippetKind; label: () => string }[] = [
  { kind: "dotenv", label: () => t("overview.envDotenv") },
  { kind: "shell", label: () => t("overview.envShell") },
  { kind: "web", label: () => t("overview.envWeb") },
  { kind: "admin", label: () => t("overview.envAdmin") },
];
const SNIPPET_TEST_ID: Record<SnippetKind, string> = {
  dotenv: "env-dotenv",
  shell: "env-shell",
  web: "env-web",
  admin: "env-admin",
};

const Overview: Component = () => {
  const config = appState.config;
  const [snippet, setSnippet] = createSignal<SnippetKind>("dotenv");
  // The snippets are for the selected session's project: what the header shows is what an
  // SDK pointed here talks to. The daemon's own default project is shown separately.
  const snippetText = (kind: SnippetKind) =>
    snippetFor(kind, { ...config(), project: appState.project() });
  const onTabKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = SNIPPET_KINDS.findIndex((entry) => entry.kind === snippet());
    const next = SNIPPET_KINDS[(at + step + SNIPPET_KINDS.length) % SNIPPET_KINDS.length]!;
    setSnippet(next.kind);
    document.getElementById(`snippet-tab-${next.kind}`)?.focus();
  };
  return (
    <div>
      <h1 class="page-title mb-4">{t("overview.title")}</h1>
      <Show when={!config().uiBundled}>
        <div class="mb-4 rounded-control border border-warning-line bg-warning-subtle p-3 text-sm">
          {t("app.notBundled")}
        </div>
      </Show>
      <Stats />
      <Section title={t("overview.envVars")}>
        <p class="hint mb-2">
          {t("overview.envVarsFor", { session: appState.session(), project: appState.project() })}
        </p>
        <div
          class="mb-3 flex flex-wrap border-b border-line-subtle"
          role="tablist"
          aria-label={t("overview.envTabs")}
          onKeyDown={onTabKey}
        >
          <For each={SNIPPET_KINDS}>
            {(entry) => (
              <button
                type="button"
                role="tab"
                id={`snippet-tab-${entry.kind}`}
                class="tab"
                aria-selected={snippet() === entry.kind}
                aria-controls="snippet-panel"
                tabIndex={snippet() === entry.kind ? 0 : -1}
                data-testid={`${SNIPPET_TEST_ID[entry.kind]}-tab`}
                onClick={() => setSnippet(entry.kind)}
              >
                {entry.label()}
              </button>
            )}
          </For>
        </div>
        <div id="snippet-panel" role="tabpanel" aria-labelledby={`snippet-tab-${snippet()}`}>
          <For each={SNIPPET_KINDS.filter((entry) => entry.kind === snippet())}>
            {(entry) => (
              <CopyBlock text={snippetText(entry.kind)} testId={SNIPPET_TEST_ID[entry.kind]} />
            )}
          </For>
        </div>
      </Section>
      <div class="grid gap-x-4 md:grid-cols-2">
        <Section title={t("overview.services")}>
          <Address label={t("overview.firestore")} value={config().firestoreAddr} />
          <Address label={t("overview.auth")} value={config().httpAddr} />
          <Address label={t("overview.storage")} value={config().storageAddr} />
          <Show
            when={config().functionsAddr}
            fallback={<Field label={t("overview.functions")}>{t("overview.functionsNone")}</Field>}
          >
            {(addr) => (
              <Address
                label={t("overview.functions")}
                value={addr()}
                note={config().functionsSource}
              />
            )}
          </Show>
          <Address label={t("overview.control")} value={`http://${config().httpAddr}/v1/`} />
          <Address label={t("overview.ui")} value={`http://${config().uiAddr}/ui`} />
        </Section>
        <Section title={t("overview.project")}>
          <div class="grid grid-cols-2 gap-x-4">
            <Field label={t("overview.selectedSession")} mono>
              {appState.session()}
            </Field>
            <Field label={t("overview.project")} mono>
              {appState.project()}
            </Field>
            <Show when={appState.project() !== config().project}>
              <Field label={t("overview.daemonProject")} mono>
                {config().project}
              </Field>
            </Show>
            <Field label={t("overview.edition")}>{config().edition}</Field>
            <Field label={t("overview.version")} mono>
              {config().version}
            </Field>
          </div>
          <Field label={t("overview.clock")} mono>
            <span data-testid="overview-clock">{appState.clock()}</span>{" "}
            <StatusBadge
              tone={config().clockMode === "frozen" ? "paused" : "neutral"}
              testId="overview-clock-mode"
              class="font-sans whitespace-normal"
            >
              {config().clockMode === "frozen"
                ? t("overview.clockFrozen")
                : t("overview.clockRealtime")}
            </StatusBadge>
          </Field>
        </Section>
        <Section
          title={t("overview.rules")}
          actions={
            <a class="link text-sm" href={appHref("/rules")}>
              {t("overview.rulesOpen")}
            </a>
          }
        >
          <Field label={t("overview.rules")}>
            {config().rulesEnforced ? t("overview.rulesEnforced") : t("overview.rulesDisabled")}
          </Field>
          <Field label={t("overview.rulesFirestore")}>
            <RulesStatus which="firestore" />
          </Field>
          <Field label={t("overview.rulesStorage")}>
            <RulesStatus which="storage" />
          </Field>
        </Section>
        <Section title={t("overview.sessions")}>
          <table class="table">
            <thead>
              <tr>
                <th>{t("overview.session")}</th>
                <th>{t("overview.project")}</th>
              </tr>
            </thead>
            <tbody>
              <For each={appState.sessions()}>
                {(s) => (
                  <tr>
                    <td class="mono">{s.name}</td>
                    <td class="mono">{s.project}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Section>
      </div>
      <Section title={t("overview.hostNames")}>
        <div data-testid="host-names">
          <p class="hint mb-2">{t("overview.hostNamesHint")}</p>
          <Field label={t("overview.hostNamesAlways")}>
            <span class="mono">
              {[...config().hosts.defaultNames, ...config().hosts.defaultSuffixes].join(", ")}
            </span>
            {", "}
            {t("overview.hostNamesAnyIp")}
          </Field>
          <Field label={t("overview.hostNamesAdded")}>
            <Show
              when={config().hosts.allowed.length > 0}
              fallback={<p data-testid="host-names-none">{t("overview.hostNamesNone")}</p>}
            >
              <span class="mono">{config().hosts.allowed.join(", ")}</span>
            </Show>
          </Field>
          <Field label={t("overview.hostNamesSingleLabel")}>
            <span data-testid="host-names-single-label">
              {config().hosts.allowNonLoopbackHosts ? t("app.yes") : t("app.no")}
            </span>
          </Field>
          <Show when={config().hosts.allowed.includes("*")}>
            <div
              data-testid="host-names-open"
              class="mt-2 rounded-control border border-warning-line bg-warning-subtle p-3 text-sm"
            >
              {t("overview.hostNamesOpen")}
            </div>
          </Show>
        </div>
      </Section>
    </div>
  );
};

export default Overview;
