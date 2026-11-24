import { useSearchParams } from "@solidjs/router";
import { readFunctionFilters, functionFiltersUrl, matchesFunction } from "../lib/functionsFilters";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  on,
  Show,
  untrack,
  type Component,
} from "solid-js";
import { t } from "../i18n";
import { FunctionsTimeline } from "../components/FunctionsTimeline";
import type { FunctionLog, FunctionsOverview } from "../api/functions";
import { appState } from "../state";
import {
  AsyncButton,
  CopyButton,
  ErrorBanner,
  FetchState,
  Notice,
  RelativeTime,
  Section,
  StatusBadge,
} from "../components/common";
import { CodeEditorToolbar } from "../components/CodeEditorToolbar";
import { listUsers, mintIdToken, type UserInfo } from "../api/auth";
import { awaitIdle, publishMessage, runSchedule, runTasks, setClock } from "../api/control";
import { errorOf, settle } from "../api/client";
import {
  enqueueTask,
  functionsOverview,
  invokeFunction,
  subscribeLogs,
  type FunctionInfo,
  type InvocationInfo,
  type InvokeResponse,
  type TriggerInfo,
} from "../api/functions";
import { buildCallableInvoke, buildEnqueue, buildRequestInvoke } from "../lib/invoke";
import { mergeFunctionLogs } from "../lib/functionsTimeline";
import { formatLogLine } from "../lib/logFormat";
import { analyzeLogLine } from "../lib/logHighlight";
import { matchesLog, type LevelFilter } from "../lib/logFilter";
import { runtimeLabel } from "../lib/functionRuntime";

type DrawerAction = { kind: "publish" | "invoke" | "enqueue"; key: string };

const functionTargetKey = (project: string, f: FunctionInfo): string =>
  JSON.stringify([appState.session(), project, f.region, f.name, f.trigger]);

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

const LEVEL_OPTIONS: { value: LevelFilter; key: Parameters<typeof t>[0] }[] = [
  { value: "all", key: "functions.levelAll" },
  { value: "debug", key: "functions.levelDebug" },
  { value: "info", key: "functions.levelInfo" },
  { value: "warn", key: "functions.levelWarn" },
  { value: "error", key: "functions.levelError" },
  { value: "other", key: "functions.levelOther" },
];

const MAX_LINES = 2000;
/**
 * Invocation rows kept in the browser. The server retains a bounded window too, so a
 * long-running session cannot grow either collection without limit.
 */
const MAX_INVOCATIONS = 500;

const describeTrigger = (trigger: TriggerInfo): string => {
  switch (trigger.kind) {
    case "http":
      return t("functions.triggerHttp", {
        kind: trigger.callable
          ? t("functions.triggerHttpCallable")
          : t("functions.triggerHttpRequest"),
      });
    case "firestore":
      return `${t("functions.triggerFirestore", { event: trigger.event.split(".").at(-1) ?? trigger.event, document: trigger.document })}${trigger.withAuthContext ? ` (${t("functions.withAuthContext")})` : ""}`;
    case "tasks":
      return t("functions.triggerTasks", {
        attempts: trigger.maxAttempts,
        concurrency: trigger.maxConcurrentDispatches,
      });
    case "eventarc":
      return t("functions.triggerEventarc", {
        event: trigger.event,
        channel: trigger.channel ?? t("functions.defaultChannel"),
        filters: JSON.stringify(trigger.filters),
      });
    case "blockingAuth":
      return t("functions.triggerBlockingAuth", { event: trigger.event });
    case "pubsub":
      return t("functions.triggerPubsub", { topic: trigger.topic });
    case "auth":
      return t("functions.triggerAuth", {
        event: trigger.event.split(".").at(-1) ?? trigger.event,
      });
    case "storage":
      return t("functions.triggerStorage", {
        event: trigger.event.split(".").at(-1) ?? trigger.event,
        bucket: trigger.bucket ?? t("functions.defaultBucket"),
      });
    case "schedule":
      return t("functions.triggerSchedule", {
        schedule: trigger.schedule,
        timeZone: trigger.timeZone ?? t("functions.utc"),
      });
    default:
      return t("functions.triggerUnknown", { kind: (trigger as { kind: string }).kind });
  }
};

const PublishForm: Component<{ topic: string; onDone: (count: number) => void }> = (props) => {
  const [message, setMessage] = createSignal('{"hello": "world"}');
  const [attributes, setAttributes] = createSignal("{}");
  const [error, setError] = createSignal<string | null>(null);
  const publish = async () => {
    setError(null);
    let attrs: unknown;
    try {
      attrs = JSON.parse(attributes() || "{}");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    let json: unknown;
    let data: string | undefined;
    try {
      json = JSON.parse(message());
    } catch {
      data = btoa(unescape(encodeURIComponent(message())));
    }
    const body =
      data !== undefined
        ? { data, attributes: attrs as Record<string, string> }
        : { json, attributes: attrs as Record<string, string> };
    const r = await publishMessage(appState.session(), props.topic, body);
    r.match(
      (res) => props.onDone(res.messageIds.length),
      (e) => setError(e.message),
    );
  };
  return (
    <div class="mt-2 inset p-3" data-testid={`publish-${props.topic}`}>
      <ErrorBanner message={error()} />
      <CodeEditorToolbar value={message()} onFormat={setMessage} />
      <label class="block text-sm">
        <span class="label">{t("functions.message")}</span>
        <textarea
          class="input mono h-24"
          value={message()}
          onInput={(e) => setMessage(e.currentTarget.value)}
        />
      </label>
      <label class="mt-2 block text-sm">
        <span class="label">{t("functions.attributes")}</span>
        <input
          class="input mono"
          value={attributes()}
          onInput={(e) => setAttributes(e.currentTarget.value)}
        />
      </label>
      <AsyncButton
        class="btn btn-primary mt-3"
        onClick={publish}
        testId={`publish-${props.topic}-send`}
      >
        {t("functions.publish")}
      </AsyncButton>
    </div>
  );
};

/** Renders the response of a forwarded invocation: the status line, headers and body. */
const InvokeResult: Component<{ response: InvokeResponse }> = (props) => (
  <div class="mt-2 text-sm" data-testid="invoke-result">
    <div class="label">
      {t("functions.invokeStatus", {
        status: props.response.status,
        ms: props.response.durationMs,
      })}
    </div>
    <Show when={props.response.truncated}>
      <p class="text-xs text-warning">
        {t("functions.invokeTruncated", { bytes: props.response.bodyLength })}
      </p>
    </Show>
    <Show when={props.response.headers.length > 0}>
      <pre class="mono mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-xs text-muted">
        {props.response.headers.map(([name, value]) => `${name}: ${value}`).join("\n")}
      </pre>
    </Show>
    <pre
      class="mono mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all console p-2"
      data-testid="invoke-response-body"
    >
      {props.response.bodyEncoding === "base64"
        ? `(base64) ${props.response.body ?? ""}`
        : (props.response.body ?? "")}
    </pre>
  </div>
);

type InvokeHistoryEntry = {
  id: number;
  label: string;
  data: string;
  authToken: string;
  appCheckToken: string;
  method: string;
  path: string;
  query: string;
  headers: string;
  body: string;
  status?: number;
};

/** Invokes an HTTP or callable function, showing the response the port returns. */
const InvokeForm: Component<{
  f: FunctionInfo;
  project?: string;
  functionsAddr?: string | null;
  onError: (m: string) => void;
}> = (props) => {
  const callable = () => props.f.trigger.kind === "http" && props.f.trigger.callable;
  const [data, setData] = createSignal('{"a": 1, "b": 2}');
  const [authToken, setAuthToken] = createSignal("");
  const [appCheckToken, setAppCheckToken] = createSignal("");
  const [authUsers, setAuthUsers] = createSignal<UserInfo[] | null>(null);
  const [pickedUid, setPickedUid] = createSignal("");
  const [tokenExchanging, setTokenExchanging] = createSignal(false);
  let tokenExchangeSeq = 0;
  const [method, setMethod] = createSignal("POST");
  const [path, setPath] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [headers, setHeaders] = createSignal("");
  const [body, setBody] = createSignal("");
  const [response, setResponse] = createSignal<InvokeResponse | null>(null);
  const [history, setHistory] = createSignal<InvokeHistoryEntry[]>([]);
  let nextHistoryId = 1;

  const loadAuthUsers = async () => {
    if (authUsers() !== null) return;
    const project = props.project ?? appState.project();
    const r = await listUsers(project);
    r.match(
      (page) => setAuthUsers(page.users ?? []),
      () => setAuthUsers([]),
    );
  };

  const curlCommand = () => {
    const addr = props.functionsAddr ?? appState.config().functionsAddr ?? "127.0.0.1:5001";
    const project = props.project ?? appState.project();
    const base = `http://${addr}/${project}/${props.f.region}/${props.f.name}`;
    if (callable()) {
      const parts = [
        "curl",
        "-X",
        "POST",
        shellQuote(base),
        "-H",
        shellQuote("Content-Type: application/json"),
      ];
      if (authToken().trim()) {
        parts.push("-H", shellQuote(`Authorization: Bearer ${authToken().trim()}`));
      }
      if (appCheckToken().trim()) {
        parts.push("-H", shellQuote(`X-Firebase-AppCheck: ${appCheckToken().trim()}`));
      }
      let wrapped = `{"data":${data().trim() || "{}"}}`;
      try {
        wrapped = JSON.stringify({ data: JSON.parse(data()) });
      } catch {
        /* keep raw fallback */
      }
      parts.push("-d", shellQuote(wrapped));
      return parts.join(" ");
    }
    const suffix = path().trim() ? `/${path().trim().replace(/^\/+/, "")}` : "";
    const qs = query().trim() ? `?${query().trim().replace(/^\?+/, "")}` : "";
    const parts = ["curl", "-X", method(), shellQuote(`${base}${suffix}${qs}`)];
    for (const line of headers().split("\n")) {
      const trimmed = line.trim();
      if (trimmed) parts.push("-H", shellQuote(trimmed));
    }
    if (body() && method() !== "GET") {
      parts.push("-d", shellQuote(body()));
    }
    return parts.join(" ");
  };

  const send = async () => {
    props.onError("");
    const built = callable()
      ? buildCallableInvoke({
          data: data(),
          authToken: authToken(),
          appCheckToken: appCheckToken(),
        })
      : buildRequestInvoke({
          method: method(),
          path: path(),
          query: query(),
          headers: headers(),
          body: body(),
        });
    if (built.isErr()) {
      props.onError(built.error);
      return;
    }
    const entry: InvokeHistoryEntry = {
      id: nextHistoryId++,
      label: callable() ? data().slice(0, 40) : `${method()} /${path()}`,
      data: data(),
      authToken: authToken(),
      appCheckToken: appCheckToken(),
      method: method(),
      path: path(),
      query: query(),
      headers: headers(),
      body: body(),
    };
    const r = await invokeFunction(props.f.name, built.value);
    r.match(
      (res) => {
        setResponse(res);
        setHistory((prev) => [{ ...entry, status: res.status }, ...prev].slice(0, 5));
      },
      (e) => props.onError(e.message),
    );
  };

  return (
    <div class="mt-2 inset p-3" data-testid={`invoke-${props.f.name}`}>
      <Show
        when={callable()}
        fallback={
          <>
            <label class="block text-sm">
              <span class="label">{t("functions.invokeMethod")}</span>
              <select
                class="input"
                data-testid={`invoke-${props.f.name}-method`}
                value={method()}
                onInput={(e) => setMethod(e.currentTarget.value)}
              >
                <For each={["GET", "POST", "PUT", "PATCH", "DELETE"]}>
                  {(m) => <option value={m}>{m}</option>}
                </For>
              </select>
            </label>
            <label class="mt-2 block text-sm">
              <span class="label">{t("functions.invokePath")}</span>
              <input
                class="input mono"
                value={path()}
                onInput={(e) => setPath(e.currentTarget.value)}
              />
            </label>
            <label class="mt-2 block text-sm">
              <span class="label">{t("functions.invokeQuery")}</span>
              <input
                class="input mono"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
            </label>
            <label class="mt-2 block text-sm">
              <span class="label">{t("functions.invokeHeaders")}</span>
              <textarea
                class="input mono h-16"
                value={headers()}
                onInput={(e) => setHeaders(e.currentTarget.value)}
              />
            </label>
            <label class="mt-2 block text-sm">
              <span class="label">{t("functions.invokeBody")}</span>
              <textarea
                class="input mono h-20"
                value={body()}
                onInput={(e) => setBody(e.currentTarget.value)}
              />
            </label>
          </>
        }
      >
        <CodeEditorToolbar value={data()} onFormat={setData} />
        <label class="block text-sm">
          <span class="label">{t("functions.invokeData")}</span>
          <textarea
            class="input mono h-24"
            data-testid={`invoke-${props.f.name}-data`}
            value={data()}
            onInput={(e) => setData(e.currentTarget.value)}
          />
        </label>
        <label class="mt-2 block text-sm">
          <span class="label">{t("functions.invokePickUser")}</span>
          <select
            class="input"
            data-testid="invoke-user-picker"
            value={pickedUid()}
            onFocus={() => void loadAuthUsers()}
            onClick={() => void loadAuthUsers()}
            onChange={(e) => {
              const uid = e.currentTarget.value;
              const seq = ++tokenExchangeSeq;
              setPickedUid(uid);
              setAuthToken("");
              if (!uid) {
                setTokenExchanging(false);
                return;
              }
              setTokenExchanging(true);
              const project = props.project ?? appState.project();
              void mintIdToken(project, uid).match(
                (res) => {
                  if (seq !== tokenExchangeSeq) return;
                  setTokenExchanging(false);
                  setAuthToken(res.idToken);
                },
                (err) => {
                  if (seq !== tokenExchangeSeq) return;
                  setTokenExchanging(false);
                  setAuthToken("");
                  props.onError(err.message);
                },
              );
            }}
          >
            <option value="">{t("functions.invokeManualToken")}</option>
            <For each={authUsers() ?? []}>
              {(u) => (
                <option value={u.localId}>
                  {u.email ? `${u.email} (${u.localId})` : u.localId}
                </option>
              )}
            </For>
          </select>
        </label>
        <label class="mt-2 block text-sm">
          <span class="label">{t("functions.invokeAuthToken")}</span>
          <input
            class="input mono"
            value={authToken()}
            onInput={(e) => {
              tokenExchangeSeq += 1;
              setTokenExchanging(false);
              setPickedUid("");
              setAuthToken(e.currentTarget.value);
            }}
          />
        </label>
        <label class="mt-2 block text-sm">
          <span class="label">{t("functions.invokeAppCheckToken")}</span>
          <input
            class="input mono"
            value={appCheckToken()}
            onInput={(e) => setAppCheckToken(e.currentTarget.value)}
          />
        </label>
      </Show>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <AsyncButton
          class="btn btn-primary"
          disabled={tokenExchanging()}
          onClick={send}
          testId={`invoke-${props.f.name}-send`}
        >
          {t("functions.invokeSend")}
        </AsyncButton>
        <CopyButton
          value={curlCommand()}
          subject={t("functions.invokeCopyCurl")}
          testId="invoke-copy-curl"
        />
      </div>
      <Show when={response()}>{(res) => <InvokeResult response={res()} />}</Show>
      <Show when={history().length > 0}>
        <div class="mt-3 border-t border-line-subtle pt-2">
          <div class="label">{t("functions.invokeHistory")}</div>
          <ul class="space-y-1 text-xs">
            <For each={history()}>
              {(item) => (
                <li class="flex items-center justify-between gap-2">
                  <span class="mono truncate">
                    {item.status !== undefined ? `[${item.status}] ` : ""}
                    {item.label}
                  </span>
                  <button
                    type="button"
                    class="btn btn-sm"
                    onClick={() => {
                      setData(item.data);
                      setAuthToken(item.authToken);
                      setAppCheckToken(item.appCheckToken);
                      setMethod(item.method);
                      setPath(item.path);
                      setQuery(item.query);
                      setHeaders(item.headers);
                      setBody(item.body);
                    }}
                  >
                    {t("functions.invokeReplay")}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
};

/** Enqueues a Cloud Task onto an onTaskDispatched queue. */
const EnqueueForm: Component<{
  f: FunctionInfo;
  onDone: () => void;
  onError: (m: string) => void;
}> = (props) => {
  const [data, setData] = createSignal('{"id": "1", "n": 1}');
  const [id, setId] = createSignal("");
  const [scheduleTime, setScheduleTime] = createSignal("");
  const enqueue = async () => {
    const built = buildEnqueue({ data: data(), id: id(), scheduleTime: scheduleTime() });
    if (built.isErr()) {
      props.onError(built.error);
      return;
    }
    const r = await enqueueTask(props.f.name, built.value);
    r.match(
      () => props.onDone(),
      (e) => props.onError(e.message),
    );
  };
  return (
    <div class="mt-2 inset p-3" data-testid={`enqueue-${props.f.name}`}>
      <CodeEditorToolbar value={data()} onFormat={setData} />
      <label class="block text-sm">
        <span class="label">{t("functions.enqueueData")}</span>
        <textarea
          class="input mono h-24"
          data-testid={`enqueue-${props.f.name}-data`}
          value={data()}
          onInput={(e) => setData(e.currentTarget.value)}
        />
      </label>
      <label class="mt-1 block text-sm">
        <span class="label">{t("functions.enqueueId")}</span>
        <input class="input mono" value={id()} onInput={(e) => setId(e.currentTarget.value)} />
      </label>
      <label class="mt-1 block text-sm">
        <span class="label">{t("functions.enqueueScheduleTime")}</span>
        <input
          class="input mono"
          data-testid={`enqueue-${props.f.name}-schedule`}
          placeholder="2026-01-01T00:00:00Z"
          value={scheduleTime()}
          onInput={(e) => setScheduleTime(e.currentTarget.value)}
        />
      </label>
      <AsyncButton
        class="btn btn-primary mt-2"
        onClick={enqueue}
        testId={`enqueue-${props.f.name}-send`}
      >
        {t("functions.enqueueSend")}
      </AsyncButton>
    </div>
  );
};

const FunctionRow: Component<{
  f: FunctionInfo;
  targetKey: string;
  project: string;
  functionsAddr: string | null;
  /** Whether the selected session is the one the functions belong to; actions are disabled otherwise. */
  active: boolean;
  /** Filtered out by the search box: kept mounted (an open form survives) but not shown. */
  hidden?: boolean | undefined;
  onOpenAction?: ((action: DrawerAction) => void) | undefined;
  onNotice: (m: string) => void;
  onError: (m: string) => void;
  onRefresh: () => Promise<void>;
}> = (props) => {
  const [publishing, setPublishing] = createSignal(false);
  const [invoking, setInvoking] = createSignal(false);
  const [enqueuing, setEnqueuing] = createSignal(false);
  const trigger = () => props.f.trigger;
  const openOrToggle = (kind: DrawerAction["kind"], fallback: () => void) => {
    if (props.onOpenAction) props.onOpenAction({ kind, key: props.targetKey });
    else fallback();
  };
  return (
    <tr data-testid={`function-row-${props.f.name}`} hidden={props.hidden}>
      <td class="mono font-medium">{props.f.name}</td>
      <td class="mono text-xs whitespace-nowrap">{props.f.region}</td>
      <td class="whitespace-nowrap" data-testid={`function-runtime-${props.f.name}`}>
        {props.f.runtime ? runtimeLabel(props.f.runtime) : "-"}
      </td>
      <td class="text-xs">
        {describeTrigger(trigger())}
        <Show
          when={
            ![
              "http",
              "firestore",
              "pubsub",
              "auth",
              "storage",
              "schedule",
              "tasks",
              "eventarc",
              "blockingAuth",
            ].includes(trigger().kind)
          }
        >
          <details>
            <summary>{t("functions.triggerDetails")}</summary>
            <pre class="whitespace-pre-wrap break-all">{JSON.stringify(trigger(), null, 2)}</pre>
          </details>
        </Show>
        <Show when={trigger().kind === "http" && appState.config().functionsAddr}>
          <div class="mono text-muted">
            http://{appState.config().functionsAddr}/{props.project}/{props.f.region}/{props.f.name}
          </div>
        </Show>
        <Show when={!props.onOpenAction && publishing() && trigger().kind === "pubsub"}>
          <PublishForm
            topic={(trigger() as { topic: string }).topic}
            onDone={(count) => {
              setPublishing(false);
              props.onNotice(t("functions.published", { count }));
            }}
          />
        </Show>
        <Show when={!props.onOpenAction && invoking() && trigger().kind === "http"}>
          <InvokeForm
            f={props.f}
            project={props.project}
            functionsAddr={props.functionsAddr}
            onError={props.onError}
          />
        </Show>
        <Show when={!props.onOpenAction && enqueuing() && trigger().kind === "tasks"}>
          <EnqueueForm
            f={props.f}
            onDone={() => {
              setEnqueuing(false);
              props.onNotice(t("functions.enqueued", { name: props.f.name }));
            }}
            onError={props.onError}
          />
        </Show>
        <Show when={trigger().kind === "tasks" && (props.f.pendingTaskCount ?? 0) > 0}>
          <div class="mt-1" data-testid={`pending-tasks-${props.f.name}`}>
            <div class="text-muted">
              {t("functions.pendingTasks", { count: props.f.pendingTaskCount ?? 0 })}
            </div>
            <For each={props.f.pendingTasks ?? []}>
              {(task) => (
                <div class="flex items-center gap-2" data-testid={`pending-task-${task.id}`}>
                  <span class="mono">{task.id}</span>
                  <Show when={task.scheduleTime}>
                    {(due) => (
                      <span class="mono text-muted">
                        {t("functions.pendingTaskDue", { time: due() })}
                      </span>
                    )}
                  </Show>
                  <Show
                    when={!task.runNow}
                    fallback={<span class="text-muted">{t("functions.pendingTaskReleased")}</span>}
                  >
                    <AsyncButton
                      class="btn"
                      disabled={!props.active}
                      testId={`run-task-${props.f.name}-${task.id}`}
                      onClick={async () => {
                        const r = await runTasks(appState.session(), props.f.name, task.id);
                        await r.match(
                          async (released) => {
                            props.onNotice(
                              t("functions.ranTasks", {
                                count: released.released,
                                name: props.f.name,
                              }),
                            );
                            await props.onRefresh();
                          },
                          async (e) => props.onError(e.message),
                        );
                      }}
                    >
                      {t("functions.runTask")}
                    </AsyncButton>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={trigger().kind === "schedule" && props.f.nextRun}>
          {(nextRun) => (
            <div class="mono text-xs text-muted" data-testid={`next-run-${props.f.name}`}>
              {t("functions.nextRun")}: {nextRun()}
              <RelativeTime value={nextRun()} />
            </div>
          )}
        </Show>
      </td>
      <td class="text-xs">{props.f.timeoutSeconds}s</td>
      <td class="text-xs">{props.f.retry ? t("app.yes") : t("app.no")}</td>
      <td class="text-xs">{props.f.concurrency}</td>
      <td class="sticky-actions w-0 text-right">
        <div class="flex flex-col items-end gap-1 [&>.btn]:text-xs">
          <Show when={trigger().kind === "schedule"}>
            <AsyncButton
              class="btn"
              disabled={!props.active}
              testId={`run-${props.f.name}`}
              onClick={async () => {
                const r = await runSchedule(appState.session(), props.f.name);
                r.match(
                  () => props.onNotice(`${t("functions.runNow")}: ${props.f.name}`),
                  (e) => props.onError(e.message),
                );
              }}
            >
              {t("functions.runNow")}
            </AsyncButton>
            <Show when={props.f.nextRun}>
              {(nextRun) => (
                <AsyncButton
                  class="btn"
                  disabled={!props.active || appState.clockGuard.pending()}
                  testId={`advance-to-next-${props.f.name}`}
                  ariaLabel={t("functions.advanceToNextRun")}
                  title={t("functions.advanceToNextRun")}
                  onClick={() =>
                    appState.clockGuard.run(async () => {
                      const r = await setClock(appState.session(), nextRun(), false);
                      await r.match(
                        async (c) => {
                          appState.applyClockMutation(c);
                          props.onNotice(t("functions.advancedToNextRun", { instant: nextRun() }));
                          await props.onRefresh();
                        },
                        async (e) => props.onError(e.message),
                      );
                    })
                  }
                >
                  {t("functions.advanceShort")}
                </AsyncButton>
              )}
            </Show>
          </Show>
          <Show when={trigger().kind === "pubsub"}>
            <button
              type="button"
              class="btn"
              disabled={!props.active}
              data-testid={`publish-${props.f.name}`}
              onClick={() => openOrToggle("publish", () => setPublishing(!publishing()))}
            >
              {t("functions.publish")}
            </button>
          </Show>
          <Show when={trigger().kind === "http"}>
            <Show
              when={props.functionsAddr}
              fallback={
                <span class="text-xs text-muted" title={t("functions.invokeUnavailable")}>
                  {t("functions.invokeUnavailable")}
                </span>
              }
            >
              <button
                type="button"
                class="btn"
                disabled={!props.active}
                data-testid={`invoke-${props.f.name}-toggle`}
                onClick={() => openOrToggle("invoke", () => setInvoking(!invoking()))}
              >
                {t("functions.invoke")}
              </button>
            </Show>
          </Show>
          <Show when={trigger().kind === "tasks" && (props.f.pendingTaskCount ?? 0) > 0}>
            <AsyncButton
              class="btn"
              disabled={!props.active}
              testId={`run-${props.f.name}`}
              onClick={async () => {
                const r = await runTasks(appState.session(), props.f.name);
                await r.match(
                  async (released) => {
                    props.onNotice(
                      t("functions.ranTasks", { count: released.released, name: props.f.name }),
                    );
                    await props.onRefresh();
                  },
                  async (e) => props.onError(e.message),
                );
              }}
            >
              {t("functions.runWaitingTasks")}
            </AsyncButton>
          </Show>
          <Show when={trigger().kind === "tasks"}>
            <button
              type="button"
              class="btn"
              disabled={!props.active}
              data-testid={`enqueue-${props.f.name}-toggle`}
              onClick={() => openOrToggle("enqueue", () => setEnqueuing(!enqueuing()))}
            >
              {t("functions.enqueue")}
            </button>
          </Show>
        </div>
      </td>
    </tr>
  );
};

export const FunctionRows: Component<{
  functions: FunctionInfo[];
  project: string;
  functionsAddr?: string | null;
  /** Whether the selected session owns the functions; actions are disabled otherwise. */
  active?: boolean;
  onOpenAction?: ((action: DrawerAction) => void) | undefined;
  onNotice: (m: string) => void;
  onError: (m: string) => void;
  onRefresh?: () => Promise<void>;
  /** The search box text; rows that do not match are hidden, not unmounted. */
  filter?: string | undefined;
}> = (props) => {
  // Refreshed objects describe the same target. Keep its form mounted until that target changes.
  // `nextRun` is deliberately excluded so advancing the clock updates a row without discarding
  // an open invoke or enqueue form.
  const byTarget = createMemo(
    () => new Map(props.functions.map((f) => [functionTargetKey(props.project, f), f])),
  );
  return (
    <For each={[...byTarget().keys()]}>
      {(key) => (
        <FunctionRow
          f={byTarget().get(key)!}
          targetKey={key}
          project={props.project}
          functionsAddr={props.functionsAddr ?? null}
          active={props.active ?? true}
          onOpenAction={props.onOpenAction}
          hidden={
            !matchesFunction(
              byTarget().get(key)!,
              describeTrigger(byTarget().get(key)!.trigger),
              props.filter ?? "",
            )
          }
          onNotice={props.onNotice}
          onError={props.onError}
          onRefresh={props.onRefresh ?? (async () => {})}
        />
      )}
    </For>
  );
};

const Functions: Component = () => {
  const [registeredFilter, setRegisteredFilter] = createSignal("");
  const [drawer, setDrawer] = createSignal<DrawerAction | null>(null);
  const [drawerError, setDrawerError] = createSignal<string | null>(null);
  let drawerOpener: HTMLElement | null = null;
  let drawerCloseBtn: HTMLButtonElement | undefined;
  const [structuredLogs, setStructuredLogs] = createSignal(false);
  const [overview, { refetch }] = createResource(() => settle(functionsOverview()));
  // This global overview belongs to the Functions owner, independently of the top bar.
  const [lastOverview, setLastOverview] = createSignal<FunctionsOverview | null>(null);
  createEffect(() => {
    overview()?.match(
      (value) => setLastOverview(value),
      () => {},
    );
  });
  const status = overview;
  const refetchStatus = refetch;
  const [logRecords, setLogRecords] = createSignal<FunctionLog[]>([]);
  const [logGaps, setLogGaps] = createSignal(false);
  const [streamProject, setStreamProject] = createSignal<string>();
  const [streamRevision, setStreamRevision] = createSignal(0);
  const [lines, setLines] = createSignal<string[]>([]);
  const [invocations, setInvocations] = createSignal<InvocationInfo[]>([]);
  const [truncated, setTruncated] = createSignal(false);
  const [connected, setConnected] = createSignal(false);
  const [connecting, setConnecting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const configured = () => o()?.configured ?? false;
  const [logBox, setLogBox] = createSignal<HTMLPreElement>();
  // Follow the tail only while the reader is at the tail; otherwise count what arrived.
  const [following, setFollowing] = createSignal(true);
  const [unseen, setUnseen] = createSignal(0);
  const atBottom = (box: HTMLPreElement) => box.scrollHeight - box.scrollTop - box.clientHeight < 8;
  const jumpToEnd = () => {
    const box = logBox();
    if (box) box.scrollTop = box.scrollHeight;
    setFollowing(true);
    setUnseen(0);
  };
  const [logLevel, setLogLevel] = createSignal<LevelFilter>("all");
  const [logText, setLogText] = createSignal("");
  const [fnFilter, setFnFilter] = createSignal("");
  const [filterSearch, setFilterSearch] = useSearchParams();
  if (
    typeof filterSearch.event === "string" &&
    typeof filterSearch.eventFunction === "string" &&
    typeof filterSearch.eventSession === "string" &&
    typeof filterSearch.eventProject === "string"
  ) {
    appState.setSession(filterSearch.eventSession);
  }
  const [includeSearch, setIncludeSearch] = createSignal(false);
  let filterScope: string | undefined;
  createEffect(
    on(
      () => [
        filterSearch.event,
        filterSearch.eventFunction,
        filterSearch.eventSession,
        filterSearch.eventProject,
      ],
      ([event, fn, session, project]) => {
        if (
          typeof event !== "string" ||
          typeof fn !== "string" ||
          typeof session !== "string" ||
          typeof project !== "string"
        )
          return;
        if (untrack(appState.session) !== session) {
          appState.setSession(session);
          filterScope = JSON.stringify([session, untrack(appState.project)]);
        }
      },
      { defer: true },
    ),
  );
  const localSearchMemory = new Map<string, string>();
  const localSearchKey = () =>
    `fireemu.functionSearch.${JSON.stringify([appState.session(), appState.project()])}`;
  createEffect(() => {
    const currentFunction = filterSearch.function;
    const currentLevel = filterSearch.level;
    const currentQuery = filterSearch.q;
    const scope = JSON.stringify([appState.session(), appState.project()]);
    if (filterScope !== undefined && filterScope !== scope) {
      filterScope = scope;
      setFnFilter("");
      setLogLevel("all");
      setLogText("");
      setIncludeSearch(false);
      setFilterSearch(
        {
          function: undefined,
          level: undefined,
          q: undefined,
          event: undefined,
          eventFunction: undefined,
          eventSession: undefined,
          eventProject: undefined,
        },
        { replace: true },
      );
      return;
    }
    filterScope = scope;
    const restored = readFunctionFilters(
      new URLSearchParams({
        function: typeof currentFunction === "string" ? currentFunction : "",
        level: typeof currentLevel === "string" ? currentLevel : "all",
        q: typeof currentQuery === "string" ? currentQuery : "",
      }),
    );
    setFnFilter(restored.function);
    setLogLevel(restored.level);
    let local = localSearchMemory.get(localSearchKey()) ?? "";
    try {
      local =
        localSearchMemory.get(localSearchKey()) ?? sessionStorage.getItem(localSearchKey()) ?? "";
    } catch {
      /* Storage is optional. */
    }
    setLogText(typeof currentQuery === "string" ? restored.text : local);
    setIncludeSearch(false);
  });
  const editLogText = (text: string) => {
    localSearchMemory.set(localSearchKey(), text);
    try {
      sessionStorage.setItem(localSearchKey(), text);
    } catch {
      /* Storage is optional. */
    }
    if (filterSearch.q !== undefined) setFilterSearch({ q: undefined }, { replace: true });
    setLogText(text);
  };
  const shareFilters = async () => {
    setNotice(null);
    const url = functionFiltersUrl(
      window.location.href,
      { function: fnFilter(), level: logLevel(), text: logText() },
      includeSearch(),
    );
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t("functions.shareCopied"));
    } catch {
      setError(t("functions.shareFailed"));
    }
  };

  const filteredLines = createMemo(() =>
    lines().filter((line) => matchesLog(line, { level: logLevel(), text: logText() })),
  );
  // Formatting is presentation only: the filters and the counts work on the lines as sent.
  const [formatJson, setFormatJson] = createSignal(false);
  const filteredLogOutput = createMemo(() =>
    (formatJson() ? filteredLines().map(formatLogLine) : filteredLines()).join("\n"),
  );
  const filteredInvocations = (): InvocationInfo[] => {
    const name = fnFilter();
    return name === ""
      ? scopedInvocations()
      : scopedInvocations().filter((r) => r.function === name);
  };
  /** Function names to offer in the filter: the registered ones plus any seen in invocations. */
  const functionNames = (): string[] => {
    const names = new Set<string>((o()?.functions ?? []).map((f) => f.name));
    for (const r of scopedInvocations()) {
      names.add(r.function);
    }
    return [...names].toSorted();
  };

  const keepRecent = (records: InvocationInfo[]): InvocationInfo[] => {
    setTruncated(records.length > MAX_INVOCATIONS);
    return records.slice(-MAX_INVOCATIONS);
  };

  // Keep the tail in view after every render that changes the lines (or mounts the box).
  createEffect(() => {
    const box = logBox();
    void filteredLines();
    if (box && following()) box.scrollTop = box.scrollHeight;
  });

  const ownerProject = createMemo(() =>
    lastOverview()?.configured ? lastOverview()?.project : undefined,
  );
  let subscribedProject: string | undefined;
  createEffect(() => {
    const project = ownerProject();
    void streamRevision();
    if (!project) return;
    if (project !== subscribedProject) {
      setLines([]);
      setInvocations([]);
      setLogRecords([]);
      setLogGaps(false);
    }
    subscribedProject = project;
    setConnected(false);
    setConnecting(true);
    let disposed = false;
    const stop = subscribeLogs(
      (e) => {
        if (disposed || (e.project && o()?.project && e.project !== o()?.project)) return;
        if (e.kind === "snapshot") {
          setStreamProject(e.project);
          setLogRecords((records) => mergeFunctionLogs(records, e.logRecords, MAX_LINES));
          setLogGaps(
            (gaps) =>
              gaps ||
              e.logRecords.length > MAX_LINES ||
              e.logScopes.some((scope) => scope.truncated || scope.replaced),
          );
          setLines(e.logs.slice(-MAX_LINES));
          setInvocations(keepRecent(e.invocations));
        } else if (e.kind === "logState") {
          if (e.logScopes.some((scope) => scope.truncated || scope.replaced)) setLogGaps(true);
        } else if (e.kind === "log") {
          if (e.record) {
            setLogRecords((records) => {
              if (records.length >= MAX_LINES) setLogGaps(true);
              return mergeFunctionLogs(records, [e.record!], MAX_LINES);
            });
            if (e.record.truncated) setLogGaps(true);
          }
          setLines((l) => [...l, e.line].slice(-MAX_LINES));
          if (!following()) setUnseen((n) => n + 1);
        } else if (e.kind === "resync") {
          // The server could not answer this connection's cursor (a reset, or records that
          // fell out of its retention window): replace the list rather than append a gap.
          setInvocations(keepRecent(e.invocations));
          void refetchStatus();
        } else {
          setInvocations((i) => keepRecent([...i, e.record]));
          void refetchStatus();
        }
        setConnected(true);
        setConnecting(false);
      },
      () => {
        if (!disposed) {
          setConnected(false);
          setConnecting(false);
          setLogGaps(true);
        }
      },
    );
    onCleanup(() => {
      disposed = true;
      stop();
    });
  });
  onMount(() => {
    const timer = window.setInterval(() => void refetchStatus(), 3000);
    onCleanup(() => window.clearInterval(timer));
  });

  const o = () => lastOverview();
  const s = () => o()?.status ?? null;
  const scopedRecords = () =>
    !streamProject() || streamProject() === o()?.project ? logRecords() : [];
  const scopedInvocations = () =>
    !streamProject() || streamProject() === o()?.project ? invocations() : [];
  // The functions belong to one project's session. Actions are enabled only when the selected
  // session still exists and its project is the functions' project. Matching the real selected
  // session (not `appState.project()`, which falls back to the default project when the
  // selection has been deleted) keeps actions disabled after that session is removed elsewhere,
  // rather than silently re-enabling them against the default project.
  const active = () => {
    const owner = o();
    if (!owner?.configured || owner.project === undefined) {
      return false;
    }
    const selected = appState.sessions().find((sess) => sess.name === appState.session());
    return selected !== undefined && selected.project === owner.project;
  };
  const drawerFunction = createMemo(() => {
    const activeDrawer = drawer();
    if (!activeDrawer) return null;
    const proj = o()?.project ?? appState.project();
    return (
      (o()?.functions ?? []).find((f) => functionTargetKey(proj, f) === activeDrawer.key) ?? null
    );
  });
  const closeDrawer = (restoreFocus = false) => {
    setDrawer(null);
    setDrawerError(null);
    if (restoreFocus && drawerOpener?.isConnected) {
      drawerOpener.focus();
    }
    drawerOpener = null;
  };
  const toggleDrawer = (action: DrawerAction) => {
    setDrawerError(null);
    setDrawer((current) => {
      if (current && current.kind === action.kind && current.key === action.key) {
        return null;
      }
      if (document.activeElement instanceof HTMLElement) {
        drawerOpener = document.activeElement;
      }
      return action;
    });
  };
  const openDrawerKey = createMemo(() =>
    drawer() && drawerFunction() ? `${drawer()!.kind}:${drawer()!.key}` : null,
  );
  createEffect(
    on(openDrawerKey, (key) => {
      if (!key) return;
      queueMicrotask(() => drawerCloseBtn?.focus());
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDrawer(true);
        }
      };
      window.addEventListener("keydown", onKeyDown);
      onCleanup(() => window.removeEventListener("keydown", onKeyDown));
    }),
  );
  return (
    <div>
      <h1 class="page-title mb-4">{t("functions.title")}</h1>
      <ErrorBanner message={error() ?? (o() ? errorOf(overview()) : null)} />
      <Notice message={notice()} />
      <Show when={fnFilter() && o() && !functionNames().includes(fnFilter())}>
        <p role="status">{t("functions.unknownFilter", { name: fnFilter() })}</p>
      </Show>
      <FetchState
        loading={overview.loading && !o()}
        error={o() ? null : errorOf(overview())}
        onRetry={async () => {
          await refetch();
        }}
      >
        <Show
          when={configured()}
          fallback={<p class="card text-sm text-muted">{t("functions.notConfigured")}</p>}
        >
          <Show when={!active()}>
            <div
              role="status"
              data-testid="functions-session-mismatch"
              class="callout callout-warning mb-4"
            >
              {t("functions.sessionMismatch", {
                session: o()?.session ?? "",
                project: o()?.project ?? "",
              })}
            </div>
          </Show>
          <Section
            title={t("functions.registered")}
            actions={
              <>
                <label class="flex items-center gap-2 text-sm">
                  <span class="sr-only">{t("functions.searchRegistered")}</span>
                  <input
                    class="input w-80 max-w-full"
                    type="search"
                    placeholder={t("functions.searchRegistered")}
                    value={registeredFilter()}
                    onInput={(e) => setRegisteredFilter(e.currentTarget.value)}
                    data-testid="function-search"
                  />
                </label>
                <span
                  class="text-xs whitespace-nowrap text-secondary"
                  data-testid="function-search-count"
                >
                  {t("functions.searchCount", {
                    shown: (o()?.functions ?? []).filter((f) =>
                      matchesFunction(f, describeTrigger(f.trigger), registeredFilter()),
                    ).length,
                    total: (o()?.functions ?? []).length,
                  })}
                </span>
                <AsyncButton
                  class="btn"
                  onClick={async () => {
                    await refetch();
                  }}
                >
                  {t("app.refresh")}
                </AsyncButton>
              </>
            }
          >
            <p
              class="mono mb-2 truncate text-xs text-muted"
              title={o()?.source ?? ""}
              data-testid="functions-source"
            >
              {o()?.source ?? ""}
            </p>
            <div
              class={
                openDrawerKey()
                  ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start"
                  : ""
              }
            >
              <div class="table-scroll min-w-0">
                <table class="table" data-testid="function-table">
                  <thead>
                    <tr>
                      <th>{t("functions.name")}</th>
                      <th>{t("functions.region")}</th>
                      <th>{t("functions.runtime")}</th>
                      <th>{t("functions.trigger")}</th>
                      <th>{t("functions.timeout")}</th>
                      <th>{t("functions.retry")}</th>
                      <th>{t("functions.concurrency")}</th>
                      <th class="sticky-actions">
                        <span class="sr-only">{t("functions.actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <FunctionRows
                      functions={o()?.functions ?? []}
                      project={o()?.project ?? appState.project()}
                      functionsAddr={o()?.functionsAddr ?? null}
                      active={active()}
                      filter={registeredFilter()}
                      onOpenAction={toggleDrawer}
                      onNotice={setNotice}
                      onError={setError}
                      onRefresh={async () => {
                        await refetch();
                      }}
                    />
                  </tbody>
                </table>
              </div>
              <Show when={openDrawerKey()} keyed>
                {(_drawerKey) => {
                  const action = drawer()!;
                  const fnInfo = drawerFunction()!;
                  return (
                    <aside
                      role="region"
                      aria-label={`${t("functions.drawerTitle")}: ${fnInfo.name}`}
                      class="card border-line bg-surface shadow-sm"
                      data-testid="functions-drawer"
                    >
                      <div class="mb-3 flex items-center justify-between gap-2 border-b border-line-subtle pb-2">
                        <div class="min-w-0">
                          <div class="text-xs uppercase tracking-wide text-muted">
                            {t("functions.drawerTitle")}
                          </div>
                          <h3 class="mono truncate font-semibold">{fnInfo.name}</h3>
                        </div>
                        <button
                          ref={(el) => {
                            drawerCloseBtn = el;
                          }}
                          type="button"
                          class="btn btn-sm"
                          data-testid="functions-drawer-close"
                          onClick={() => closeDrawer(true)}
                        >
                          {t("app.close")}
                        </button>
                      </div>
                      <ErrorBanner message={drawerError()} />
                      <Show when={action.kind === "publish" && fnInfo.trigger.kind === "pubsub"}>
                        <PublishForm
                          topic={(fnInfo.trigger as { topic: string }).topic}
                          onDone={(count) => {
                            closeDrawer(true);
                            setNotice(t("functions.published", { count }));
                          }}
                        />
                      </Show>
                      <Show when={action.kind === "invoke" && fnInfo.trigger.kind === "http"}>
                        <InvokeForm
                          f={fnInfo}
                          project={o()?.project ?? appState.project()}
                          functionsAddr={o()?.functionsAddr ?? null}
                          onError={(m) => setDrawerError(m || null)}
                        />
                      </Show>
                      <Show when={action.kind === "enqueue" && fnInfo.trigger.kind === "tasks"}>
                        <EnqueueForm
                          f={fnInfo}
                          onDone={() => {
                            closeDrawer(true);
                            setNotice(t("functions.enqueued", { name: fnInfo.name }));
                          }}
                          onError={(m) => setDrawerError(m || null)}
                        />
                      </Show>
                    </aside>
                  );
                }}
              </Show>
            </div>
          </Section>
          <FunctionsTimeline
            project={o()?.project ?? ""}
            session={o()?.session ?? ""}
            causality={s()?.causality}
            codebases={s()?.codebases ?? []}
            invocations={scopedInvocations()}
            logs={scopedRecords()}
            logGaps={logGaps()}
            stale={!!errorOf(overview())}
            linkSession={appState.session()}
            linkedEvent={
              filterSearch.eventSession === appState.session() &&
              filterSearch.eventProject === o()?.project &&
              typeof filterSearch.event === "string"
                ? filterSearch.event
                : undefined
            }
            linkedFunction={
              filterSearch.eventSession === appState.session() &&
              filterSearch.eventProject === o()?.project &&
              typeof filterSearch.eventFunction === "string"
                ? filterSearch.eventFunction
                : undefined
            }
            onSelectEvent={(event, fn) =>
              setFilterSearch({
                event: event || undefined,
                eventFunction: fn || undefined,
                eventSession: event ? appState.session() : undefined,
                eventProject: event ? o()?.project : undefined,
              })
            }
          />
          <div class="grid gap-4 xl:grid-cols-2">
            <Section
              title={t("functions.status")}
              actions={
                <AsyncButton
                  class="btn"
                  testId="await-idle"
                  onClick={async () => {
                    const owner = o();
                    if (!owner?.session) return;
                    const r = await awaitIdle(owner.session, 30);
                    if (o()?.project !== owner.project || o()?.session !== owner.session) return;
                    r.match(
                      (res) => setNotice(res.idle ? t("functions.idle") : t("functions.notIdle")),
                      (e) => setError(e.message),
                    );
                    void refetchStatus();
                  }}
                >
                  {t("functions.awaitIdle")}
                </AsyncButton>
              }
            >
              <FetchState
                loading={status.loading && !s()}
                error={s() ? null : errorOf(status())}
                onRetry={async () => {
                  await refetchStatus();
                }}
              >
                <Show when={s()}>
                  {(st) => (
                    <>
                      <dl
                        class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm"
                        data-testid="function-status"
                      >
                        <dt class="label">{t("functions.pending")}</dt>
                        <dd>{st().pending}</dd>
                        <dt class="label">{t("functions.running")}</dt>
                        <dd>{st().running}</dd>
                        <dt class="label">{t("functions.retryWaiting")}</dt>
                        <dd>{st().retryWaiting}</dd>
                        <dt class="label">{t("functions.succeeded")}</dt>
                        <dd data-testid="succeeded-count">{st().succeeded}</dd>
                        <dt class="label">{t("functions.deadLettered")}</dt>
                        <dd>{st().deadLettered}</dd>
                        <dt class="label">{t("functions.runnerAlive")}</dt>
                        <dd>{st().runnerAlive ? t("app.yes") : t("app.no")}</dd>
                        <dt class="label">{t("functions.authEventsPending")}</dt>
                        <dd data-testid="status-auth-events-pending">
                          {st().authEventsPending ?? 0}
                        </dd>
                        <dt class="label">{t("functions.tasksInFlight")}</dt>
                        <dd data-testid="status-tasks-in-flight">{st().tasksInFlight ?? 0}</dd>
                        <dt class="label">{t("functions.catchUpPending")}</dt>
                        <dd data-testid="status-catch-up-pending">
                          {st().catchUpPending ? t("app.yes") : t("app.no")}
                        </dd>
                        <dt class="label">{t("functions.overlapRejected")}</dt>
                        <dd data-testid="status-overlap-rejected">{st().overlapRejected}</dd>
                      </dl>
                      <Show when={(st().codebases?.length ?? 0) > 0}>
                        <ul class="mt-3 text-sm" data-testid="codebase-list">
                          <For each={st().codebases}>
                            {(codebase) => {
                              const runtime = () =>
                                o()?.codebases?.find((c) => c.codebase === codebase.codebase);
                              return (
                                <li data-testid={`codebase-status-${codebase.codebase}`}>
                                  {codebase.codebase}{" "}
                                  <Show when={runtime()}>
                                    {(value) => <>{runtimeLabel(value())} </>}
                                  </Show>
                                  {codebase.runnerAlive
                                    ? t("functions.codebaseRunning")
                                    : t("functions.codebaseStopped")}
                                </li>
                              );
                            }}
                          </For>
                        </ul>
                      </Show>
                      <Show when={(st().ignored?.length ?? 0) > 0}>
                        <div data-testid="ignored-exports" class="mt-3 text-sm">
                          <h3 class="font-semibold">{t("functions.ignoredExports")}</h3>
                          <For each={st().ignored}>
                            {(entry) => (
                              <p>
                                {entry.name} {entry.triggerType} {entry.region} {entry.reason}
                              </p>
                            )}
                          </For>
                        </div>
                      </Show>
                    </>
                  )}
                </Show>
              </FetchState>
            </Section>
            <Section
              title={t("functions.invocations")}
              actions={
                <label class="text-sm">
                  <span class="sr-only">{t("functions.filterFunction")}</span>
                  <select
                    class="input"
                    data-testid="invocation-function-filter"
                    value={fnFilter()}
                    onInput={(e) =>
                      setFilterSearch({ function: e.currentTarget.value || undefined })
                    }
                  >
                    <option value="">{t("functions.allFunctions")}</option>
                    <Show when={fnFilter() && !functionNames().includes(fnFilter())}>
                      <option value={fnFilter()}>{fnFilter()}</option>
                    </Show>
                    <For each={functionNames()}>
                      {(name) => <option value={name}>{name}</option>}
                    </For>
                  </select>
                </label>
              }
            >
              <Show
                when={invocations().length > 0}
                fallback={<p class="text-sm text-muted">{t("functions.noInvocations")}</p>}
              >
                <Show when={truncated()}>
                  <p class="mb-1 text-xs text-muted" data-testid="invocations-truncated">
                    {t("functions.invocationsTruncated", { count: MAX_INVOCATIONS })}
                  </p>
                </Show>
                <Show
                  when={filteredInvocations().length > 0}
                  fallback={
                    <p class="text-sm text-muted" data-testid="invocations-no-match">
                      {t("functions.noMatchingInvocations")}
                    </p>
                  }
                >
                  <div class="max-h-64 overflow-auto">
                    <table class="table" data-testid="invocation-table">
                      <thead>
                        <tr>
                          <th>{t("functions.eventId")}</th>
                          <th>{t("functions.name")}</th>
                          <th>{t("functions.attempt")}</th>
                          <th>{t("functions.outcome")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={filteredInvocations().toReversed()}>
                          {(r) => (
                            <tr>
                              <td class="mono text-xs">{r.eventId}</td>
                              <td class="mono">{r.function}</td>
                              <td>{r.attempt}</td>
                              <td class="mono text-xs">{r.outcome}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </Show>
            </Section>
          </div>
          <Section
            title={t("functions.logs")}
            actions={
              <>
                <label class="text-sm">
                  <span class="sr-only">{t("functions.filterLevel")}</span>
                  <select
                    class="input"
                    data-testid="log-level-filter"
                    value={logLevel()}
                    onInput={(e) =>
                      setFilterSearch({
                        level: e.currentTarget.value === "all" ? undefined : e.currentTarget.value,
                      })
                    }
                  >
                    <For each={LEVEL_OPTIONS}>
                      {(opt) => <option value={opt.value}>{t(opt.key)}</option>}
                    </For>
                  </select>
                </label>
                <label class="text-sm">
                  <span class="sr-only">{t("functions.filterText")}</span>
                  <input
                    class="input w-40"
                    data-testid="log-text-filter"
                    placeholder={t("functions.filterTextPlaceholder")}
                    value={logText()}
                    onInput={(e) => editLogText(e.currentTarget.value)}
                  />
                </label>
                <label class="flex items-center gap-1 text-sm whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={formatJson()}
                    onChange={(e) => setFormatJson(e.currentTarget.checked)}
                    data-testid="log-format-json"
                  />
                  {t("functions.formatJson")}
                </label>
                <label class="flex items-center gap-1 text-sm whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={structuredLogs()}
                    onChange={(e) => setStructuredLogs(e.currentTarget.checked)}
                    data-testid="log-structured-toggle"
                  />
                  {t("functions.logsColorized")}
                </label>
                <label class="flex items-center gap-1 text-sm whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={includeSearch()}
                    onChange={(e) => setIncludeSearch(e.currentTarget.checked)}
                  />
                  {t("functions.includeSearch")}
                </label>
                <AsyncButton class="btn" onClick={shareFilters}>
                  {t("functions.shareFilters")}
                </AsyncButton>
                <StatusBadge tone={connected() ? "success" : "neutral"}>
                  {connected() ? t("firestore.live") : t("firestore.liveOff")}
                </StatusBadge>
                <Show when={!connected() && !connecting()}>
                  <button
                    type="button"
                    class="btn"
                    data-testid="logs-reconnect"
                    onClick={() => setStreamRevision((revision) => revision + 1)}
                  >
                    {t("app.retry")}
                  </button>
                </Show>
                <button
                  type="button"
                  class="btn"
                  onClick={() => {
                    setLines([]);
                    setLogRecords([]);
                    setLogGaps(true);
                  }}
                >
                  {t("functions.clearLogs")}
                </button>
              </>
            }
          >
            <div class="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span data-testid="log-count">
                {t("functions.logsFilteredCount", {
                  shown: filteredLines().length,
                  total: lines().length,
                })}
              </span>
              <Show
                when={following()}
                fallback={
                  <button type="button" class="btn" data-testid="log-jump" onClick={jumpToEnd}>
                    {unseen() > 0
                      ? t("functions.logsNewLines", { count: unseen() })
                      : t("functions.logsJumpToEnd")}
                  </button>
                }
              >
                <span data-testid="log-following">{t("functions.logsFollowing")}</span>
              </Show>
            </div>
            <Show
              when={structuredLogs() && filteredLines().length > 0}
              fallback={
                <pre
                  ref={setLogBox}
                  class="mono h-72 overflow-auto whitespace-pre-wrap console"
                  data-testid="function-logs"
                  onScroll={(e) => {
                    const box = e.currentTarget;
                    if (atBottom(box)) {
                      setFollowing(true);
                      setUnseen(0);
                    } else {
                      setFollowing(false);
                    }
                  }}
                >
                  <Show
                    when={filteredLines().length > 0}
                    fallback={
                      lines().length > 0 ? t("functions.noMatchingLogs") : t("functions.noLogs")
                    }
                  >
                    {filteredLogOutput()}
                  </Show>
                </pre>
              }
            >
              <div class="mono h-72 space-y-1 overflow-auto console" data-testid="function-logs">
                <For each={filteredLines()}>
                  {(line) => {
                    const parsed = analyzeLogLine(line);
                    return (
                      <div
                        class="rounded px-1.5 py-0.5"
                        classList={{
                          "bg-danger-subtle text-danger": parsed.severity === "error",
                          "bg-warning-subtle text-warning": parsed.severity === "warn",
                          "text-info": parsed.severity === "info",
                          "text-muted": parsed.severity === "debug",
                        }}
                      >
                        <Show
                          when={parsed.jsonPayload}
                          fallback={<div class="whitespace-pre-wrap break-all">{parsed.raw}</div>}
                        >
                          {(pretty) => (
                            <details>
                              <summary class="cursor-pointer whitespace-pre-wrap break-all">
                                {parsed.raw}
                              </summary>
                              <pre class="mt-1 overflow-auto rounded bg-surface p-2 text-xs text-ink">
                                {pretty()}
                              </pre>
                            </details>
                          )}
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Section>
        </Show>
      </FetchState>
    </div>
  );
};

export default Functions;
