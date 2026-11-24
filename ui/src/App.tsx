import { A, type RouteSectionProps } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  type Component,
} from "solid-js";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmButton, ErrorBanner, StatusBadge, type Tone } from "./components/common";
import { HeaderClock } from "./components/HeaderClock";
import { openCommandPalette, openShortcutHelp } from "./components/overlays";
import { Shortcuts } from "./components/Shortcuts";
import {
  IconAlerts,
  IconAppCheck,
  IconAuth,
  IconDatabase,
  IconFirestore,
  IconFunctions,
  IconHosting,
  IconOverview,
  IconPubSub,
  IconRemoteConfig,
  IconRules,
  IconRuntime,
  IconMenu,
  IconSearch,
  IconWarning,
  IconStorage,
} from "./components/icons";
import { clearFaultPlan } from "./api/control";
import { ThemeToggle } from "./components/ThemeToggle";
import { t, type MessageKey } from "./i18n";
import { requestScopeChange } from "./lib/unsaved";
import { appState } from "./state";

type NavItem = {
  href: string;
  key: MessageKey;
  icon: Component;
  keywords?: string;
  /** The second key of the `g` navigation shortcut. */
  go: string;
  /** Returns `false` when the daemon explicitly reported this service as unconfigured/inactive. */
  active?: () => boolean;
};

// The official Emulator Suite products, then the fireemu-only deterministic runtime controls,
// kept in a visually and semantically separate group so the two are never conflated.
const OFFICIAL_NAV: NavItem[] = [
  {
    href: "/",
    go: "o",
    key: "nav.overview",
    icon: IconOverview,
    keywords: "home status environment snippets",
  },
  {
    href: "/firestore",
    go: "f",
    key: "nav.firestore",
    icon: IconFirestore,
    keywords: "documents collections query ttl indexes",
  },
  {
    href: "/database",
    go: "d",
    key: "database.title",
    icon: IconDatabase,
    keywords: "rtdb realtime tree",
    active: () => appState.config().databaseEnabled !== false,
  },
  { href: "/auth", go: "a", key: "nav.auth", icon: IconAuth, keywords: "users sign-in codes mfa" },
  {
    href: "/storage",
    go: "s",
    key: "nav.storage",
    icon: IconStorage,
    keywords: "bucket objects files upload",
  },
  {
    href: "/functions",
    go: "n",
    key: "nav.functions",
    icon: IconFunctions,
    keywords: "logs triggers invoke schedule tasks pubsub",
    active: () => appState.config().functionsConfigured,
  },
  {
    href: "/hosting",
    go: "h",
    key: "nav.hosting",
    icon: IconHosting,
    keywords: "site rewrites",
    active: () => appState.config().hostingServed !== false,
  },
  {
    href: "/pubsub",
    go: "p",
    key: "nav.pubsub",
    icon: IconPubSub,
    keywords: "topics subscriptions messages publish pull snapshots dead letter",
    active: () => appState.config().pubsubEnabled !== false,
  },
  {
    href: "/remote-config",
    go: "m",
    key: "nav.remoteConfig",
    icon: IconRemoteConfig,
    keywords: "templates parameters conditions versions rollback",
    active: () => appState.config().remoteConfigEnabled !== false,
  },
  {
    href: "/alerts",
    go: "l",
    key: "nav.alerts",
    icon: IconAlerts,
    keywords: "crashlytics eventarc",
  },
  {
    href: "/rules",
    go: "r",
    key: "nav.rules",
    icon: IconRules,
    keywords: "security coverage requests",
  },
  {
    href: "/appcheck",
    go: "c",
    key: "nav.appCheck",
    icon: IconAppCheck,
    keywords: "tokens attestation",
    active: () => appState.config().appCheckEnabled,
  },
];
const RUNTIME_NAV: NavItem[] = [
  {
    href: "/runtime",
    go: "t",
    key: "nav.runtime",
    icon: IconRuntime,
    keywords: "clock snapshots fault sessions resources",
  },
];

/** The frame: sidebar navigation, a status bar with the clock, the routed page. */
export const App: Component<RouteSectionProps> = (props) => {
  const [navigationOpen, setNavigationOpen] = createSignal(false);
  const [faultError, setFaultError] = createSignal<string | null>(null);
  createEffect(() => {
    void appState.session();
    if (appState.faultSummary().rules === 0) setFaultError(null);
  });
  createEffect(
    on(appState.session, () => {
      setFaultError(null);
    }),
  );
  onMount(() => {
    void appState.refreshClock();
    const timer = window.setInterval(() => void appState.refreshClock(), 5000);
    onCleanup(() => window.clearInterval(timer));
  });
  const connectionTone = (): Tone => {
    switch (appState.connected()) {
      case true:
        return "success";
      case false:
        return "danger";
      default:
        return "neutral";
    }
  };
  const connectionLabel = () => {
    switch (appState.connected()) {
      case true:
        return t("header.connected");
      case false:
        return t("header.disconnected");
      default:
        return t("header.connecting");
    }
  };
  const announcement = createMemo(
    on(appState.connected, () => ({
      label: connectionLabel(),
      time: untrack(appState.lastConnectedAt),
    })),
  );
  const paletteLinks = () =>
    [...OFFICIAL_NAV, ...RUNTIME_NAV].map((item) =>
      item.keywords
        ? { href: item.href, title: t(item.key), keywords: item.keywords }
        : { href: item.href, title: t(item.key) },
    );
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
  return (
    <div class="flex min-h-screen flex-col md:flex-row">
      <CommandPalette links={paletteLinks()} />
      <Shortcuts
        pages={[...OFFICIAL_NAV, ...RUNTIME_NAV].map((item) => ({
          key: item.go,
          href: item.href,
          title: t(item.key),
        }))}
        paletteKeys={shortcut}
      />
      <button
        type="button"
        class="btn m-3 self-start md:hidden"
        aria-controls="console-navigation"
        aria-expanded={navigationOpen()}
        onClick={() => setNavigationOpen(!navigationOpen())}
      >
        <IconMenu />
        {t("nav.toggle")}
      </button>
      <aside
        id="console-navigation"
        class={`${navigationOpen() ? "flex" : "hidden"} shrink-0 flex-col border-r border-line-subtle bg-sidebar p-3 md:sticky md:top-0 md:flex md:h-screen md:w-48 md:overflow-y-auto lg:w-56 `}
      >
        <div class="mb-3 flex items-baseline gap-2 px-3">
          <div class="text-lg font-bold tracking-tight">
            <span class="text-accent">fire</span>emu
          </div>
          <div class="text-xs text-muted">{t("app.subtitle")}</div>
        </div>
        <button
          type="button"
          class="input mb-3 flex items-center gap-2 text-left text-muted [&>svg]:size-4 [&>svg]:shrink-0"
          data-testid="command-palette-open"
          onClick={openCommandPalette}
        >
          <IconSearch />
          <span class="flex-1 truncate">{t("palette.open")}</span>
          <span class="kbd">{shortcut}</span>
        </button>
        <nav class="space-y-0.5" aria-label={t("nav.sectionOfficial")}>
          <For each={OFFICIAL_NAV}>
            {(item) => {
              const inactive = () => item.active !== undefined && !item.active();
              return (
                <A
                  href={item.href}
                  class="nav-link"
                  classList={{ "opacity-80": inactive() }}
                  title={inactive() ? `${t(item.key)} (${t("app.inactive")})` : undefined}
                  aria-description={inactive() ? t("app.inactive") : undefined}
                  onClick={() => setNavigationOpen(false)}
                  end={item.href === "/"}
                >
                  <item.icon />
                  {t(item.key)}
                </A>
              );
            }}
          </For>
        </nav>
        <div class="mt-5 mb-1 px-3 text-xs font-semibold tracking-wide text-muted uppercase">
          {t("nav.sectionRuntime")}
        </div>
        <nav class="space-y-0.5" aria-label={t("nav.sectionRuntime")}>
          <For each={RUNTIME_NAV}>
            {(item) => (
              <A
                href={item.href}
                class="nav-link"
                onClick={() => setNavigationOpen(false)}
                end={false}
              >
                <item.icon />
                {t(item.key)}
              </A>
            )}
          </For>
        </nav>
        <div class="mt-auto pt-4">
          <button
            type="button"
            class="nav-link w-full"
            data-testid="shortcut-help-open"
            onClick={openShortcutHelp}
          >
            <span class="kbd">?</span>
            <span>{t("shortcuts.open")}</span>
          </button>
          <ThemeToggle />
          <Show when={appState.config().version}>
            {(version) => <div class="mono px-3 pt-1 text-xs text-muted">v{version()}</div>}
          </Show>
        </div>
      </aside>
      <div class="flex min-w-0 flex-1 flex-col">
        {/* Where every action lands: the target the pages act on, and whether the daemon answers. */}
        <header
          class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 border-b border-line-subtle bg-surface/95 px-4 py-2.5 text-sm backdrop-blur lg:px-6"
          data-testid="context-bar"
        >
          {/* Two groups that wrap as units: where actions land, and whether the daemon answers. */}
          <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
            {/* The scope label shows on wide screens only; screen readers always get it. */}
            <span class="sr-only font-semibold text-secondary 2xl:not-sr-only">
              {t("header.local")}
            </span>
            <label class="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
              <span class="label">{t("overview.session")}</span>
              <select
                class="input input-sm mono min-w-0 max-w-full w-auto"
                data-testid="session-select"
                value={appState.session()}
                onChange={(e) => {
                  const next = e.currentTarget.value;
                  e.currentTarget.value = appState.session();
                  requestScopeChange(() => {
                    appState.setSession(next);
                    void appState.refreshClock();
                  });
                }}
              >
                <For each={appState.sessions().map((s) => s.name)}>
                  {(name) => (
                    <option value={name} selected={name === appState.session()}>
                      {name}
                    </option>
                  )}
                </For>
              </select>
            </label>
            <span class="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
              <span class="label">{t("overview.project")}</span>
              <span class="mono break-all" data-testid="header-project">
                {appState.project()}
              </span>
            </span>
            <HeaderClock />
            <Show when={appState.faultSummary().rules > 0}>
              <span
                class="inline-flex flex-wrap items-center gap-1.5"
                data-testid="header-fault-indicator"
              >
                <A href="/runtime" class="no-underline">
                  <StatusBadge tone="warning" testId="header-fault-badge">
                    {t("header.faultActive", {
                      rules: appState.faultSummary().rules,
                      fired: appState.faultSummary().fired,
                    })}
                  </StatusBadge>
                </A>
                <ConfirmButton
                  class="btn btn-sm"
                  label={t("header.faultClear")}
                  question={t("header.faultClearConfirm", { session: appState.session() })}
                  testId="header-fault-clear"
                  onConfirm={async () => {
                    setFaultError(null);
                    const res = await clearFaultPlan(appState.session());
                    await res.match(
                      async () => appState.refreshFaultSummary(),
                      async (e) => setFaultError(e.message),
                    );
                  }}
                />
              </span>
            </Show>
            <Show when={faultError()}>{(msg) => <ErrorBanner message={msg()} />}</Show>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span role="status" class="sr-only" data-testid="connection-status">
              {announcement().label} {t("header.controlHint")}{" "}
              {announcement().time && t("header.lastSuccess", { time: announcement().time! })}
            </span>
            <StatusBadge aria-hidden="true" tone={connectionTone()} testId="connection-badge">
              {connectionLabel()}
            </StatusBadge>
            <Show when={appState.lastConnectedAt()}>
              {(time) => (
                <span
                  class="text-xs whitespace-nowrap text-muted"
                  title={`${time()} · ${t("header.controlHint")}`}
                  aria-hidden="true"
                  data-testid="control-last-success"
                >
                  {/* The time of day is enough at a glance; the full instant is in the title. */}
                  {t("header.lastSuccess", { time: `${time().slice(11, 19)}Z` })}
                </span>
              )}
            </Show>
          </div>
        </header>
        <main class="mx-auto w-full max-w-[1600px] min-w-0 flex-1 p-4 lg:p-6">
          <Show when={!appState.config().controlToken}>
            <div class="callout callout-warning mb-4">
              <IconWarning />
              <span class="min-w-0 flex-1">{t("app.tokenMissing")}</span>
            </div>
          </Show>
          {props.children}
        </main>
      </div>
    </div>
  );
};
