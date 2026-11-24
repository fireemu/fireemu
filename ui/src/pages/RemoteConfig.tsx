import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js";
import { errorOf, settle } from "../api/client";
import { publishRemoteConfigUpdate } from "../api/control";
import {
  getRemoteConfigTemplate,
  listRemoteConfigVersions,
  publishRemoteConfigTemplate,
  rollbackRemoteConfig,
  validateRemoteConfigTemplate,
  type RemoteConfigTemplate,
} from "../api/remoteConfig";
import { CodeEditorToolbar, onCodeEditorKeyDown } from "../components/CodeEditorToolbar";
import {
  AsyncButton,
  ConfirmButton,
  CopyButton,
  ErrorBanner,
  FetchState,
  Field,
  Notice,
  RelativeTime,
  Section,
  StatusBadge,
} from "../components/common";
import { t } from "../i18n";
import { createLeaveGuard, LeavePrompt } from "../lib/unsaved";
import { appState } from "../state";

type RcTab = "template" | "versions" | "trigger";

const parseTemplate = (raw: string): RemoteConfigTemplate | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as RemoteConfigTemplate;
    }
  } catch {
    /* Invalid JSON is reported on validate/publish. */
  }
  return null;
};

const RemoteConfigScope: Component<{ project: string; isDefault: boolean }> = (props) => {
  const defaultProject = () => appState.config().project || props.project;
  const [tab, setTab] = createSignal<RcTab>("template");
  const [draft, setDraft] = createSignal<string | null>(null);
  const [draftBaseEtag, setDraftBaseEtag] = createSignal<string | null>(null);
  const [forcePublish, setForcePublish] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);

  // Quick parameter adder
  const [paramKey, setParamKey] = createSignal("");
  const [paramType, setParamType] = createSignal<"STRING" | "BOOLEAN" | "NUMBER" | "JSON">(
    "STRING",
  );
  const [paramVal, setParamVal] = createSignal("");

  // Synthetic onConfigUpdated trigger
  const [triggerBody, setTriggerBody] = createSignal(
    JSON.stringify(
      {
        versionNumber: 1,
        updateOrigin: "CONSOLE",
        updateType: "INCREMENTAL_UPDATE",
        description: "Local emulator trigger",
      },
      null,
      2,
    ),
  );

  const [tplRes, { refetch: refetchTpl }] = createResource(defaultProject, (p) =>
    settle(getRemoteConfigTemplate(p)),
  );
  const [versionsRes, { refetch: refetchVersions }] = createResource(defaultProject, (p) =>
    settle(listRemoteConfigVersions(p)),
  );

  const serverReply = () => tplRes()?.unwrapOr(null) ?? null;
  const serverSource = () => serverReply()?.body ?? "{}";
  const currentEtag = () => serverReply()?.etag ?? null;
  const source = () => draft() ?? serverSource();
  const dirty = () => draft() !== null && draft() !== serverSource();
  const guard = createLeaveGuard(dirty);

  const editDraft = (next: string) => {
    if (draft() === null) {
      setDraftBaseEtag(currentEtag());
    }
    setDraft(next);
  };

  const parsedServer = createMemo(() => parseTemplate(serverSource()));
  const parsedDraft = createMemo(() => parseTemplate(source()) ?? parsedServer());
  const parameters = createMemo(() => {
    const raw = parsedDraft()?.parameters;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    return Object.entries(raw).flatMap(([name, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [[name, {} as NonNullable<RemoteConfigTemplate["parameters"]>[string]] as const];
      }
      return [[name, value] as const];
    });
  });
  const conditions = createMemo(() => {
    const raw = parsedDraft()?.conditions;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (c): c is { name: string; expression: string } =>
        Boolean(c) &&
        typeof c === "object" &&
        typeof c.name === "string" &&
        typeof c.expression === "string",
    );
  });
  const versions = () => versionsRes()?.unwrapOr({ versions: [] }).versions ?? [];

  const unavailable = () =>
    tplRes()?.match(
      () => false,
      (e) => e.status === 503,
    ) ?? false;

  const refreshAll = async () => {
    await Promise.all([refetchTpl(), refetchVersions()]);
  };

  const resolveIfMatch = (): string | null => {
    if (forcePublish()) return "*";
    const base = draft() !== null ? (draftBaseEtag() ?? currentEtag()) : currentEtag();
    if (base) return base;
    // Unpublished empty template has no ETag yet; "*" creates version 1.
    if (!parsedServer()?.version?.versionNumber) return "*";
    return null;
  };

  const validate = async () => {
    setError(null);
    setNotice(null);
    const ifMatch = resolveIfMatch();
    if (!ifMatch) {
      setError(t("remoteConfig.etagMissing"));
      return;
    }
    const res = await validateRemoteConfigTemplate(defaultProject(), source(), ifMatch);
    res.match(
      () => setNotice(t("remoteConfig.validated")),
      (e) => setError(e.message),
    );
  };

  const publish = async () => {
    setError(null);
    setNotice(null);
    const ifMatch = resolveIfMatch();
    if (!ifMatch) {
      setError(t("remoteConfig.etagMissing"));
      return;
    }
    const res = await publishRemoteConfigTemplate(defaultProject(), source(), ifMatch);
    res.match(
      (reply) => {
        const next = parseTemplate(reply.body);
        setDraft(null);
        setDraftBaseEtag(null);
        setNotice(
          t("remoteConfig.published", {
            version: next?.version?.versionNumber ?? "?",
          }),
        );
        void refreshAll();
      },
      (e) => setError(e.message),
    );
  };

  const addQuickParameter = () => {
    const key = paramKey().trim();
    if (!key) return;
    setError(null);
    const current = parseTemplate(source());
    if (current === null) {
      setError(t("editor.invalidJson"));
      return;
    }
    const existing = current.parameters?.[key];
    const next: RemoteConfigTemplate = {
      ...current,
      parameters: {
        ...current.parameters,
        [key]: {
          ...existing,
          valueType: paramType(),
          defaultValue: { value: paramVal() },
        },
      },
    };
    editDraft(JSON.stringify(next, null, 2));
    setParamKey("");
    setParamVal("");
  };

  const rcTabs: readonly RcTab[] = ["template", "versions", "trigger"];
  const onTabKeyDown = (event: KeyboardEvent) => {
    const idx = rcTabs.indexOf(tab());
    let next = -1;
    if (event.key === "ArrowRight") next = (idx + 1) % rcTabs.length;
    else if (event.key === "ArrowLeft") next = (idx - 1 + rcTabs.length) % rcTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rcTabs.length - 1;
    if (next >= 0) {
      event.preventDefault();
      const target = rcTabs[next]!;
      setTab(target);
      document.getElementById(`rc-tab-${target}`)?.focus();
    }
  };

  const sendTrigger = async () => {
    setError(null);
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(triggerBody());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError(t("remoteConfig.triggerObjectOnly"));
      return;
    }
    const res = await publishRemoteConfigUpdate(
      appState.session(),
      parsed as Record<string, unknown>,
    );
    res.match(
      () => setNotice(t("remoteConfig.triggered")),
      (e) => setError(e.message),
    );
  };

  return (
    <div>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 class="page-title">{t("remoteConfig.title")}</h1>
        <AsyncButton class="btn" onClick={refreshAll} testId="rc-refresh">
          {t("app.refresh")}
        </AsyncButton>
      </div>
      <LeavePrompt guard={guard} subject={t("remoteConfig.title")} />
      <Show when={!props.isDefault}>
        <div class="callout callout-warning mb-4" data-testid="rc-session-mismatch">
          {t("remoteConfig.defaultOnly", { project: defaultProject() })}
        </div>
      </Show>
      <ErrorBanner message={error()} />
      <Notice message={notice()} />
      <Show
        when={!unavailable() && appState.config().remoteConfigEnabled !== false}
        fallback={
          <div class="callout callout-warning" data-testid="rc-unavailable">
            {t("remoteConfig.notAttached")}
          </div>
        }
      >
        <div
          class="mb-4 flex overflow-x-auto border-b border-line-subtle"
          role="tablist"
          aria-label={t("remoteConfig.title")}
          onKeyDown={onTabKeyDown}
        >
          <button
            type="button"
            role="tab"
            id="rc-tab-template"
            class="tab shrink-0"
            aria-selected={tab() === "template"}
            aria-controls="rc-tabpanel"
            tabIndex={tab() === "template" ? 0 : -1}
            data-testid="rc-tab-template"
            onClick={() => setTab("template")}
          >
            {t("remoteConfig.template")} ({parameters().length})
          </button>
          <button
            type="button"
            role="tab"
            id="rc-tab-versions"
            class="tab shrink-0"
            aria-selected={tab() === "versions"}
            aria-controls="rc-tabpanel"
            tabIndex={tab() === "versions" ? 0 : -1}
            data-testid="rc-tab-versions"
            onClick={() => setTab("versions")}
          >
            {t("remoteConfig.versions")} ({versions().length})
          </button>
          <button
            type="button"
            role="tab"
            id="rc-tab-trigger"
            class="tab shrink-0"
            aria-selected={tab() === "trigger"}
            aria-controls="rc-tabpanel"
            tabIndex={tab() === "trigger" ? 0 : -1}
            data-testid="rc-tab-trigger"
            onClick={() => setTab("trigger")}
          >
            {t("remoteConfig.triggerEvent")}
          </button>
        </div>

        <div id="rc-tabpanel" role="tabpanel" aria-labelledby={`rc-tab-${tab()}`}>
          <Show when={tab() === "template"}>
            <Section title={t("remoteConfig.template")}>
              <FetchState
                loading={tplRes.loading && !tplRes()}
                error={errorOf(tplRes())}
                onRetry={async () => {
                  await refetchTpl();
                }}
              >
                <div class="mb-4 grid gap-3 sm:grid-cols-2">
                  <Field label={t("remoteConfig.version")}>
                    <Show
                      when={parsedServer()?.version?.versionNumber}
                      fallback={
                        <StatusBadge tone="neutral">{t("remoteConfig.unpublished")}</StatusBadge>
                      }
                    >
                      {(ver) => (
                        <span class="mono" data-testid="rc-current-version">
                          v{ver()}
                          <Show when={parsedServer()?.version?.updateTime}>
                            {(at) => <RelativeTime value={at()} />}
                          </Show>
                        </span>
                      )}
                    </Show>
                    <Show when={dirty()}>
                      <StatusBadge tone="warning" class="ml-2">
                        {t("remoteConfig.draftTag")}
                      </StatusBadge>
                    </Show>
                  </Field>
                  <Field label={t("remoteConfig.etag")} mono>
                    <Show when={currentEtag()} fallback={<span class="text-muted">—</span>}>
                      {(tag) => (
                        <span class="inline-flex items-center gap-2">
                          <span data-testid="rc-etag">{tag()}</span>
                          <CopyButton value={tag()} subject={t("remoteConfig.etag")} />
                        </span>
                      )}
                    </Show>
                  </Field>
                </div>

                <div class="mb-4">
                  <h3 class="mb-2 font-semibold">{t("remoteConfig.parameters")}</h3>
                  <Show
                    when={parameters().length > 0}
                    fallback={
                      <p class="mb-3 text-sm text-muted">{t("remoteConfig.noParameters")}</p>
                    }
                  >
                    <div class="table-scroll mb-3">
                      <table class="table" data-testid="rc-params-table">
                        <thead>
                          <tr>
                            <th>{t("remoteConfig.parameterName")}</th>
                            <th>{t("remoteConfig.valueType")}</th>
                            <th>{t("remoteConfig.defaultValue")}</th>
                            <th>{t("remoteConfig.conditionalValues")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={parameters()}>
                            {([name, param]) => (
                              <tr>
                                <td class="mono font-medium">{name}</td>
                                <td>
                                  <span class="type-chip">{param.valueType ?? "STRING"}</span>
                                </td>
                                <td class="mono break-all">
                                  {param.defaultValue?.useInAppDefault
                                    ? t("remoteConfig.inAppDefault")
                                    : (param.defaultValue?.value ?? "")}
                                </td>
                                <td class="mono text-xs text-secondary">
                                  {Object.entries(
                                    param.conditionalValues &&
                                      typeof param.conditionalValues === "object" &&
                                      !Array.isArray(param.conditionalValues)
                                      ? param.conditionalValues
                                      : {},
                                  )
                                    .map(([cond, v]) => {
                                      const entry =
                                        v && typeof v === "object"
                                          ? (v as { value?: string; useInAppDefault?: boolean })
                                          : null;
                                      return `${cond}: ${entry?.useInAppDefault ? t("remoteConfig.inAppDefault") : (entry?.value ?? "")}`;
                                    })
                                    .join(", ") || "—"}
                                </td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </Show>

                  <div class="inset mb-4 p-3">
                    <div class="mb-2 text-sm font-semibold">{t("remoteConfig.addParameter")}</div>
                    <div class="flex flex-wrap items-end gap-2">
                      <label class="text-sm">
                        <span class="label">{t("remoteConfig.parameterName")}</span>
                        <input
                          class="input mono w-48"
                          data-testid="rc-quick-key"
                          placeholder="feature_banner"
                          disabled={!props.isDefault}
                          value={paramKey()}
                          onInput={(e) => setParamKey(e.currentTarget.value)}
                        />
                      </label>
                      <label class="text-sm">
                        <span class="label">{t("remoteConfig.valueType")}</span>
                        <select
                          class="input"
                          data-testid="rc-quick-type"
                          disabled={!props.isDefault}
                          value={paramType()}
                          onChange={(e) =>
                            setParamType(
                              e.currentTarget.value as "STRING" | "BOOLEAN" | "NUMBER" | "JSON",
                            )
                          }
                        >
                          <option value="STRING">STRING</option>
                          <option value="BOOLEAN">BOOLEAN</option>
                          <option value="NUMBER">NUMBER</option>
                          <option value="JSON">JSON</option>
                        </select>
                      </label>
                      <label class="min-w-48 flex-1 text-sm">
                        <span class="label">{t("remoteConfig.paramValue")}</span>
                        <input
                          class="input mono"
                          data-testid="rc-quick-value"
                          placeholder="true"
                          disabled={!props.isDefault}
                          value={paramVal()}
                          onInput={(e) => setParamVal(e.currentTarget.value)}
                        />
                      </label>
                      <button
                        type="button"
                        class="btn"
                        data-testid="rc-quick-add"
                        disabled={!props.isDefault || !paramKey().trim()}
                        onClick={addQuickParameter}
                      >
                        {t("remoteConfig.addParameter")}
                      </button>
                    </div>
                  </div>
                </div>

                <Show when={conditions().length > 0}>
                  <div class="mb-4">
                    <h3 class="mb-2 font-semibold">{t("remoteConfig.conditions")}</h3>
                    <table class="table" data-testid="rc-conditions-table">
                      <thead>
                        <tr>
                          <th>{t("remoteConfig.conditionName")}</th>
                          <th>{t("remoteConfig.expression")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={conditions()}>
                          {(c) => (
                            <tr>
                              <td class="mono font-medium">{c.name}</td>
                              <td class="mono">{c.expression}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>

                <label class="label" for="rc-template-json">
                  {t("remoteConfig.templateJson")}
                </label>
                <CodeEditorToolbar
                  value={source()}
                  disabled={!props.isDefault}
                  onFormat={(formatted) => editDraft(formatted)}
                  testId="rc-json"
                />
                <textarea
                  id="rc-template-json"
                  class="input mono h-72"
                  spellcheck={false}
                  data-testid="rc-template-editor"
                  disabled={!props.isDefault}
                  value={source()}
                  onInput={(e) => editDraft(e.currentTarget.value)}
                  onKeyDown={(e) =>
                    onCodeEditorKeyDown(e, () => {
                      if (!props.isDefault) return;
                      try {
                        editDraft(JSON.stringify(JSON.parse(source()), null, 2));
                      } catch {
                        /* Ignore invalid JSON on shortcut. */
                      }
                    })
                  }
                />
                <div class="mt-3 flex flex-wrap items-center gap-3">
                  <AsyncButton
                    class="btn btn-primary"
                    disabled={!props.isDefault}
                    testId="rc-publish"
                    onClick={publish}
                  >
                    {t("remoteConfig.publish")}
                  </AsyncButton>
                  <AsyncButton
                    class="btn"
                    disabled={!props.isDefault}
                    testId="rc-validate"
                    onClick={validate}
                  >
                    {t("remoteConfig.validate")}
                  </AsyncButton>
                  <Show when={dirty()}>
                    <button
                      type="button"
                      class="btn"
                      data-testid="rc-discard-draft"
                      onClick={() => {
                        setDraft(null);
                        setDraftBaseEtag(null);
                        setError(null);
                      }}
                    >
                      {t("remoteConfig.discardDraft")}
                    </button>
                  </Show>
                  <label class="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={forcePublish()}
                      disabled={!props.isDefault}
                      onChange={(e) => setForcePublish(e.currentTarget.checked)}
                    />
                    {t("remoteConfig.forcePublish")}
                  </label>
                </div>
              </FetchState>
            </Section>
          </Show>

          <Show when={tab() === "versions"}>
            <Section title={t("remoteConfig.versions")}>
              <FetchState
                loading={versionsRes.loading && !versionsRes()}
                error={errorOf(versionsRes())}
                onRetry={async () => {
                  await refetchVersions();
                }}
                empty={versions().length === 0}
                emptyMessage={t("remoteConfig.noVersions")}
              >
                <div class="table-scroll">
                  <table class="table" data-testid="rc-versions-table">
                    <thead>
                      <tr>
                        <th>{t("remoteConfig.versionNumber")}</th>
                        <th>{t("remoteConfig.updateType")}</th>
                        <th>{t("remoteConfig.updateTime")}</th>
                        <th>{t("remoteConfig.description")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      <For each={versions()}>
                        {(v) => (
                          <tr data-testid={`rc-version-${v.versionNumber}`}>
                            <td class="mono font-medium">v{v.versionNumber}</td>
                            <td>
                              <StatusBadge tone={v.updateType === "ROLLBACK" ? "warning" : "info"}>
                                {v.updateType ?? "UPDATE"}
                              </StatusBadge>
                            </td>
                            <td class="mono whitespace-nowrap">
                              {v.updateTime ?? ""}
                              <RelativeTime value={v.updateTime} />
                            </td>
                            <td>{v.description ?? "—"}</td>
                            <td class="text-right">
                              <ConfirmButton
                                class="btn btn-sm"
                                disabled={!props.isDefault}
                                label={t("remoteConfig.rollback")}
                                question={t("remoteConfig.rollbackConfirm", {
                                  version: v.versionNumber,
                                })}
                                testId={`rc-rollback-${v.versionNumber}`}
                                onConfirm={async () => {
                                  const res = await rollbackRemoteConfig(
                                    defaultProject(),
                                    v.versionNumber,
                                  );
                                  res.match(
                                    (rolled) => {
                                      setDraft(null);
                                      setNotice(
                                        t("remoteConfig.rolledBack", {
                                          source: v.versionNumber,
                                          version: rolled.version?.versionNumber ?? "?",
                                        }),
                                      );
                                      void refreshAll();
                                    },
                                    (e) => setError(e.message),
                                  );
                                }}
                              />
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </FetchState>
            </Section>
          </Show>

          <Show when={tab() === "trigger"}>
            <Section title={t("remoteConfig.triggerEvent")}>
              <p class="hint mb-3">{t("remoteConfig.triggerHint")}</p>
              <CodeEditorToolbar
                value={triggerBody()}
                disabled={!props.isDefault}
                onFormat={setTriggerBody}
                testId="rc-trigger"
              />
              <label class="label" for="rc-trigger-payload">
                {t("remoteConfig.triggerPayload")}
              </label>
              <textarea
                id="rc-trigger-payload"
                class="input mono h-40"
                spellcheck={false}
                data-testid="rc-trigger-payload"
                disabled={!props.isDefault}
                value={triggerBody()}
                onInput={(e) => setTriggerBody(e.currentTarget.value)}
              />
              <div class="mt-3">
                <AsyncButton
                  class="btn btn-primary"
                  disabled={!props.isDefault}
                  testId="rc-trigger-send"
                  onClick={sendTrigger}
                >
                  {t("remoteConfig.triggerSend")}
                </AsyncButton>
              </div>
            </Section>
          </Show>
        </div>
      </Show>
    </div>
  );
};

const RemoteConfig: Component = () => (
  <Show when={JSON.stringify([appState.session(), appState.project()])} keyed>
    {(_scope) => (
      <RemoteConfigScope
        project={appState.project()}
        isDefault={appState.session() === "default"}
      />
    )}
  </Show>
);

export default RemoteConfig;
