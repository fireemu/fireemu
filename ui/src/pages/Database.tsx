import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Component,
} from "solid-js";
import { useParams } from "@solidjs/router";
import { appState } from "../state";
import { t } from "../i18n";
import {
  AsyncButton,
  ConfirmButton,
  ErrorBanner,
  FetchState,
  Notice,
  Section,
} from "../components/common";
import { CodeEditorToolbar } from "../components/CodeEditorToolbar";
import { createLeaveGuard, LeavePrompt, requestScopeChange } from "../lib/unsaved";
import { createScopedFetch } from "../lib/rules-state";
import { parseRtdbTree, rtdbBreadcrumbs } from "../lib/rtdbTree";
import { settle, type TextReply } from "../api/client";
import {
  databaseInstances,
  databaseRead,
  databaseWrite,
  databaseRules,
  databaseSaveRules,
  databaseProbe,
  type DataMethod,
  type DatabaseScope,
} from "../api/database";

type DatabaseTab = "all" | "data" | "rules" | "probe";

const Editor: Component<{
  scope: DatabaseScope;
  path: string;
  onNavigatePath: (nextPath: string) => void;
}> = (props) => {
  const key = () => JSON.stringify([props.scope, props.path]);
  const data = createScopedFetch(key, () => settle(databaseRead(props.scope, props.path)));
  const rules = createScopedFetch(key, () => settle(databaseRules(props.scope)));
  const [tab, setTab] = createSignal<DatabaseTab>("all");
  const [draft, setDraft] = createSignal<string | null>(null);
  const [rulesDraft, setRulesDraft] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal(false);
  const [method, setMethod] = createSignal<DataMethod>("GET");
  const [query, setQuery] = createSignal("");
  const [probeSource, setProbeSource] = createSignal("null");
  const [probe, setProbe] = createSignal<TextReply>();
  let revision = 0;
  let rulesRevision = 0;
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  const dirty = () =>
    (draft() !== null && draft() !== data.data()?.body) ||
    (rulesDraft() !== null && rulesDraft() !== rules.data()?.body);
  const guard = createLeaveGuard(dirty);
  const source = () => draft() ?? data.data()?.body ?? "null";
  const rulesSource = () => rulesDraft() ?? rules.data()?.body ?? "{}";
  const tree = createMemo(() => parseRtdbTree(data.data()?.body ?? "null", props.path));
  const mutate = async (which: "data" | "rules", operation: DataMethod) => {
    if (pending()) return;
    const submitted = which === "rules" ? rulesSource() : source();
    const atRevision = which === "rules" ? rulesRevision : revision;
    setError(null);
    setNotice(null);
    if (which === "data" && operation !== "DELETE") {
      try {
        JSON.parse(submitted);
      } catch {
        setError(t("database.invalidJson"));
        return;
      }
    }
    setPending(true);
    const result = await (which === "rules"
      ? databaseSaveRules(props.scope, submitted)
      : databaseWrite(
          props.scope,
          props.path,
          operation,
          operation === "DELETE" ? undefined : submitted,
        ));
    if (!alive) return;
    setPending(false);
    result.match(
      (reply) => {
        if (which === "rules") {
          rules.replace({ ...reply, body: submitted });
          if (atRevision === rulesRevision) setRulesDraft(null);
          void rules.refetch();
        } else {
          if (operation !== "PATCH") {
            data.replace(reply);
            if (atRevision === revision) setDraft(null);
            void data.refetch();
          } else {
            void data.refetch().then(() => {
              if (alive && !data.error() && atRevision === revision) setDraft(null);
            });
          }
        }
        setNotice(t(which === "rules" ? "database.rulesSaved" : "database.saved"));
      },
      (failure) => setError(failure.status === 0 ? t("database.unknownOutcome") : failure.message),
    );
  };
  const run = async () => {
    const response = await databaseProbe(
      props.scope,
      props.path,
      method(),
      query(),
      method() === "PUT" || method() === "PATCH" ? probeSource() : undefined,
    );
    if (!alive) return;
    response.match(setProbe, (failure) => {
      setProbe(undefined);
      setError(failure.message);
    });
  };
  const tabs: readonly [DatabaseTab, string][] = [
    ["all", t("database.viewAll")],
    ["data", t("database.data")],
    ["rules", t("database.rules")],
    ["probe", t("database.requests")],
  ];
  const onTabKeyDown = (event: KeyboardEvent) => {
    const idx = tabs.findIndex(([id]) => id === tab());
    let next = -1;
    if (event.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next >= 0) {
      event.preventDefault();
      const targetId = tabs[next]![0];
      setTab(targetId);
      document.getElementById(`database-tab-${targetId}`)?.focus();
    }
  };
  return (
    <>
      <LeavePrompt guard={guard} subject={t("database.draft")} />
      <ErrorBanner message={error()} />
      <Notice message={notice()} />
      <div
        class="my-3 flex overflow-x-auto border-b border-line-subtle"
        role="tablist"
        aria-label={t("database.title")}
        onKeyDown={onTabKeyDown}
      >
        <For each={tabs}>
          {([id, label]) => (
            <button
              type="button"
              role="tab"
              id={`database-tab-${id}`}
              class="tab shrink-0"
              aria-selected={tab() === id}
              aria-controls="database-tabpanel"
              tabIndex={tab() === id ? 0 : -1}
              data-testid={`database-tab-${id}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          )}
        </For>
      </div>
      <div id="database-tabpanel" role="tabpanel" aria-labelledby={`database-tab-${tab()}`}>
        <Show when={tab() === "all" || tab() === "data"}>
          <Section title={t("database.data")}>
            <p class="mb-2 text-sm text-secondary">{t("database.adminHint")}</p>
            <FetchState
              loading={data.loading() && data.data() === undefined}
              error={data.data() === undefined ? data.error() : null}
              stale={data.data() !== undefined ? data.error() : null}
              onRetry={data.refetch}
            >
              <Show when={data.loading()}>
                <p role="status">{t("database.refreshing")}</p>
              </Show>
              <Show when={tree()}>
                {(summary) => (
                  <div class="inset mb-3 p-3" data-testid="database-tree">
                    <div class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                      {t("database.tree")}
                    </div>
                    <Show
                      when={summary().entries.length > 0}
                      fallback={<p class="text-sm text-muted">{t("database.treeEmpty")}</p>}
                    >
                      <ul class="space-y-1 text-sm">
                        <For each={summary().entries}>
                          {(entry) => (
                            <li class="flex flex-wrap items-baseline gap-2 rounded px-1.5 py-1 hover:bg-hover">
                              <button
                                type="button"
                                class="link mono font-medium"
                                aria-label={t("database.openChild", { path: entry.path })}
                                data-testid={`database-tree-child-${entry.key}`}
                                onClick={() => props.onNavigatePath(entry.path)}
                              >
                                {entry.key}
                              </button>
                              <span class="type-chip">{entry.kind}</span>
                              <span class="mono break-all text-secondary">{entry.preview}</span>
                            </li>
                          )}
                        </For>
                      </ul>
                      <Show when={summary().truncated > 0}>
                        <p class="mt-2 text-xs text-muted">
                          {t("database.treeTruncated", { count: summary().truncated })}
                        </p>
                      </Show>
                    </Show>
                  </div>
                )}
              </Show>
              <CodeEditorToolbar
                value={source()}
                onFormat={(formatted) => {
                  revision++;
                  setDraft(formatted);
                }}
                testId="database-data-format"
              />
              <label class="label" for="database-source">
                {t("database.json")}
              </label>
              <textarea
                id="database-source"
                class="input mono h-56"
                spellcheck={false}
                value={source()}
                onInput={(event) => {
                  revision++;
                  setDraft(event.currentTarget.value);
                }}
              />
              <div class="mt-2 flex flex-wrap gap-2">
                <AsyncButton
                  disabled={pending()}
                  onClick={data.refetch}
                  testId="database-data-refresh"
                >
                  {t("app.refresh")}
                </AsyncButton>
                <AsyncButton
                  disabled={pending()}
                  onClick={() => mutate("data", "PUT")}
                  testId="database-save"
                >
                  {t("database.replace")}
                </AsyncButton>
                <AsyncButton
                  disabled={pending()}
                  onClick={() => mutate("data", "PATCH")}
                  testId="database-patch"
                >
                  {t("database.patch")}
                </AsyncButton>
                <ConfirmButton
                  label={t("app.delete")}
                  question={t("database.deleteConfirm")}
                  onConfirm={() => mutate("data", "DELETE")}
                  testId="database-delete"
                />
              </div>
            </FetchState>
          </Section>
        </Show>
        <Show when={tab() === "all" || tab() === "rules"}>
          <Section title={t("database.rules")}>
            <FetchState
              loading={rules.loading() && rules.data() === undefined}
              error={rules.data() === undefined ? rules.error() : null}
              stale={rules.data() !== undefined ? rules.error() : null}
              onRetry={rules.refetch}
            >
              <CodeEditorToolbar
                value={rulesSource()}
                onFormat={(formatted) => {
                  rulesRevision++;
                  setRulesDraft(formatted);
                }}
                testId="database-rules-format"
              />
              <label class="label" for="database-rules">
                {t("database.rulesSource")}
              </label>
              <textarea
                id="database-rules"
                class="input mono h-48"
                spellcheck={false}
                value={rulesSource()}
                onInput={(event) => {
                  rulesRevision++;
                  setRulesDraft(event.currentTarget.value);
                }}
              />
              <div class="mt-2 flex gap-2">
                <AsyncButton
                  disabled={pending()}
                  onClick={rules.refetch}
                  testId="database-rules-refresh"
                >
                  {t("app.refresh")}
                </AsyncButton>
                <AsyncButton
                  disabled={pending()}
                  onClick={() => mutate("rules", "PUT")}
                  testId="database-rules-save"
                >
                  {t("database.replaceRules")}
                </AsyncButton>
              </div>
            </FetchState>
          </Section>
        </Show>
        <Show when={tab() === "all" || tab() === "probe"}>
          <Section title={t("database.requests")}>
            <p class="mb-2 text-sm text-secondary">{t("database.anonymousHint")}</p>
            <div class="mb-2 grid gap-3 sm:grid-cols-2">
              <div>
                <label class="label" for="database-method">
                  {t("database.method")}
                </label>
                <select
                  id="database-method"
                  class="input"
                  value={method()}
                  onChange={(event) => setMethod(event.currentTarget.value as DataMethod)}
                >
                  <For each={["GET", "PUT", "PATCH", "DELETE"] as const}>
                    {(value) => <option>{value}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class="label" for="database-query">
                  {t("database.query")}
                </label>
                <input
                  id="database-query"
                  class="input mono"
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
              </div>
            </div>
            <CodeEditorToolbar
              value={probeSource()}
              onFormat={setProbeSource}
              testId="database-probe-format"
            />
            <label class="label" for="database-request-source">
              {t("database.requestBody")}
            </label>
            <textarea
              id="database-request-source"
              class="input mono h-24"
              value={probeSource()}
              onInput={(event) => setProbeSource(event.currentTarget.value)}
            />
            <div class="mt-2">
              <AsyncButton onClick={run} testId="database-request-run">
                {t("database.run")}
              </AsyncButton>
            </div>
            <Show when={probe()}>
              {(response) => (
                <div class="mt-3" data-testid="database-response">
                  <p role="status" class="text-sm font-medium">
                    HTTP {response().status}
                  </p>
                  <Show when={response().etag}>
                    <p class="mono text-xs text-muted">ETag: {response().etag}</p>
                  </Show>
                  <pre class="code-block mono mt-1 whitespace-pre-wrap">{response().body}</pre>
                </div>
              )}
            </Show>
          </Section>
        </Show>
      </div>
    </>
  );
};

const Scope: Component<{ session: string; project: string; initialPath: string }> = (props) => {
  const instances = createScopedFetch(
    () => JSON.stringify([props.session, props.project]),
    () => settle(databaseInstances(props.session, props.project)),
  );
  const [namespace, setNamespace] = createSignal("");
  const [path, setPath] = createSignal(props.initialPath || "/");
  const [pathDraft, setPathDraft] = createSignal(path());
  const navigateToPath = (nextPath: string) => {
    requestScopeChange(() => {
      setPath(nextPath);
      setPathDraft(nextPath);
    });
  };
  createEffect(() => {
    const names = instances.data()?.instances ?? [];
    if (!names.some((item) => item.name === namespace())) setNamespace(names[0]?.name ?? "");
  });
  return (
    <FetchState
      loading={instances.loading() && instances.data() === undefined}
      error={instances.error()}
      onRetry={instances.refetch}
      empty={instances.data()?.instances.length === 0}
      emptyMessage={t("database.noInstances")}
    >
      <div class="card mb-4 space-y-3">
        <div class="grid gap-3 md:grid-cols-2">
          <div>
            <label class="label" for="database-instance">
              {t("database.instance")}
            </label>
            <select
              id="database-instance"
              class="input"
              value={namespace()}
              onChange={(event) => {
                const next = event.currentTarget.value;
                event.currentTarget.value = namespace();
                requestScopeChange(() => setNamespace(next));
              }}
            >
              <For each={instances.data()?.instances ?? []}>
                {(instance) => <option value={instance.name}>{instance.name}</option>}
              </For>
            </select>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              requestScopeChange(() => setPath(pathDraft()));
            }}
          >
            <label class="label" for="database-path">
              {t("database.path")}
            </label>
            <div class="flex gap-2">
              <input
                id="database-path"
                class="input mono flex-1"
                value={pathDraft()}
                onInput={(event) => setPathDraft(event.currentTarget.value)}
              />
              <button type="submit" class="btn">
                {t("database.open")}
              </button>
            </div>
          </form>
        </div>
        <nav
          class="mono flex flex-wrap items-center gap-1 text-sm"
          aria-label={t("database.tree")}
          data-testid="database-breadcrumbs"
        >
          <For each={rtdbBreadcrumbs(path(), t("database.treeRoot"))}>
            {(crumb, i) => (
              <>
                <Show when={i() > 0}>
                  <span class="text-muted">/</span>
                </Show>
                <button type="button" class="link" onClick={() => navigateToPath(crumb.path)}>
                  {crumb.label}
                </button>
              </>
            )}
          </For>
        </nav>
      </div>
      <Show when={namespace() && JSON.stringify([namespace(), path()])} keyed>
        {(target) => {
          const [selected, location] = JSON.parse(target) as [string, string];
          return (
            <Editor
              scope={{ session: props.session, project: props.project, namespace: selected }}
              path={location}
              onNavigatePath={navigateToPath}
            />
          );
        }}
      </Show>
    </FetchState>
  );
};
const Database: Component = () => {
  const params = useParams();
  const current = () =>
    appState
      .sessions()
      .find(
        (session) => session.name === appState.session() && session.project === appState.project(),
      );
  const scope = () =>
    current() && JSON.stringify([appState.session(), appState.project(), params.path ?? ""]);
  return (
    <div>
      <h1 class="page-title mb-4">{t("database.title")}</h1>
      <Show when={scope()} keyed fallback={<p role="alert">{t("database.sessionMissing")}</p>}>
        {(key) => {
          const [session, project, initialPath] = JSON.parse(key) as [string, string, string];
          return <Scope session={session} project={project} initialPath={initialPath} />;
        }}
      </Show>
    </div>
  );
};
export default Database;
