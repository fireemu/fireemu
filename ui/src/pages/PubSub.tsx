import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js";
import { errorOf, settle } from "../api/client";
import { createSubmitGuard } from "../lib/submitGuard";
import {
  acknowledgeSubscription,
  createPubSubSnapshot,
  createSubscription,
  createTopic,
  decodeBase64Utf8,
  deletePubSubSnapshot,
  deleteSubscription,
  deleteTopic,
  encodeBase64Utf8,
  listPubSubSnapshots,
  listSubscriptions,
  listTopics,
  publishToTopic,
  pullSubscription,
  seekSubscription,
  shortPubSubName,
  type PubSubReceivedMessage,
} from "../api/pubsub";
import { CodeEditorToolbar } from "../components/CodeEditorToolbar";
import {
  AsyncButton,
  ConfirmButton,
  CopyButton,
  ErrorBanner,
  FetchState,
  Notice,
  RelativeTime,
  Section,
  StatusBadge,
} from "../components/common";
import { t } from "../i18n";
import { appState } from "../state";

type PubSubTab = "topics" | "subscriptions" | "snapshots";

const PubSubScope: Component<{ project: string }> = (props) => {
  const project = () => props.project;
  const [tab, setTab] = createSignal<PubSubTab>("topics");
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);

  const [topicsRes, { refetch: refetchTopics }] = createResource(project, (p) =>
    settle(listTopics(p)),
  );
  const [subsRes, { refetch: refetchSubs }] = createResource(project, (p) =>
    settle(listSubscriptions(p)),
  );
  const [snapsRes, { refetch: refetchSnaps }] = createResource(project, (p) =>
    settle(listPubSubSnapshots(p)),
  );

  const topics = () => topicsRes()?.unwrapOr({ topics: [] }).topics ?? [];
  const subs = () => subsRes()?.unwrapOr({ subscriptions: [] }).subscriptions ?? [];
  const snaps = () => snapsRes()?.unwrapOr({ snapshots: [] }).snapshots ?? [];

  const unavailable = () =>
    topicsRes()?.match(
      () => false,
      (e) => e.status === 503,
    ) ?? false;

  const refreshAll = async () => {
    await Promise.all([refetchTopics(), refetchSubs(), refetchSnaps()]);
  };

  // Topic creation & publish
  const [newTopicId, setNewTopicId] = createSignal("");
  const [publishingTopic, setPublishingTopic] = createSignal<string | null>(null);
  const [pubPayload, setPubPayload] = createSignal('{"hello": "pubsub"}');
  const [pubAttrs, setPubAttrs] = createSignal("{}");
  const [pubOrderingKey, setPubOrderingKey] = createSignal("");

  const topicGuard = createSubmitGuard();
  const addTopic = () =>
    topicGuard.run(async () => {
      setError(null);
      setNotice(null);
      const id = newTopicId().trim();
      if (!id) return;
      const res = await createTopic(project(), id);
      res.match(
        () => {
          setNewTopicId("");
          setNotice(`${t("pubsub.createTopic")}: ${id}`);
          void refetchTopics();
        },
        (e) => setError(e.message),
      );
    });

  const publish = async (topicId: string) => {
    setError(null);
    setNotice(null);
    let attributes: Record<string, string> | undefined;
    if (pubAttrs().trim()) {
      try {
        const parsed: unknown = JSON.parse(pubAttrs());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setError(t("pubsub.attributesInvalid"));
          return;
        }
        attributes = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    const res = await publishToTopic(project(), topicId, {
      data: encodeBase64Utf8(pubPayload()),
      ...(attributes && Object.keys(attributes).length > 0 ? { attributes } : {}),
      ...(pubOrderingKey().trim() ? { orderingKey: pubOrderingKey().trim() } : {}),
    });
    res.match(
      (ok) => {
        setNotice(t("pubsub.published", { id: ok.messageIds.join(", ") }));
      },
      (e) => setError(e.message),
    );
  };

  // Subscription creation & pull
  const [newSubId, setNewSubId] = createSignal("");
  const [newSubTopic, setNewSubTopic] = createSignal("");
  const [ackDeadline, setAckDeadline] = createSignal("10");
  const [pushEndpoint, setPushEndpoint] = createSignal("");
  const [deadLetterTopic, setDeadLetterTopic] = createSignal("");
  const [maxAttempts, setMaxAttempts] = createSignal("5");
  const [filterExpr, setFilterExpr] = createSignal("");
  const [ordering, setOrdering] = createSignal(false);

  const [pullSubId, setPullSubId] = createSignal<string | null>(null);
  const [maxMessages, setMaxMessages] = createSignal("10");
  const [pulledState, setPulledState] = createSignal<{
    subId: string;
    messages: PubSubReceivedMessage[];
  } | null>(null);
  let pullRequestId = 0;
  const [seekTargetSnap, setSeekTargetSnap] = createSignal("");
  const [newSnapId, setNewSnapId] = createSignal("");
  const [newSnapSub, setNewSnapSub] = createSignal("");

  const effectiveSubTopic = createMemo(() => {
    const chosen = newSubTopic();
    if (chosen && topics().some((item) => item.name === chosen)) return chosen;
    return topics()[0]?.name ?? "";
  });
  const effectiveSnapSub = createMemo(() => {
    const chosen = newSnapSub();
    if (chosen && subs().some((item) => item.name === chosen)) return chosen;
    return subs()[0]?.name ?? "";
  });
  const effectiveSeekSnap = createMemo(() => {
    const chosen = seekTargetSnap();
    if (chosen && snaps().some((item) => item.name === chosen)) return chosen;
    return snaps()[0]?.name ?? "";
  });
  const pulled = createMemo(() => {
    const active = pullSubId();
    const state = pulledState();
    return active && state && state.subId === active ? state.messages : [];
  });

  const addSubscription = async () => {
    setError(null);
    setNotice(null);
    const id = newSubId().trim();
    const topic = effectiveSubTopic();
    if (!id || !topic) return;
    const ackRaw = ackDeadline().trim();
    const ack = ackRaw ? Number(ackRaw) : 10;
    if (!Number.isInteger(ack) || ack < 10 || ack > 600) {
      setError(t("pubsub.ackDeadlineInvalid"));
      return;
    }
    const hasDlq = deadLetterTopic().trim().length > 0;
    const attempts = Number(maxAttempts().trim());
    if (hasDlq && (!Number.isInteger(attempts) || attempts < 5 || attempts > 100)) {
      setError(t("pubsub.maxDeliveryInvalid"));
      return;
    }
    const res = await createSubscription(project(), id, {
      topic,
      ackDeadlineSeconds: ack,
      ...(pushEndpoint().trim() ? { pushConfig: { pushEndpoint: pushEndpoint().trim() } } : {}),
      ...(hasDlq
        ? {
            deadLetterPolicy: {
              deadLetterTopic: deadLetterTopic().trim().startsWith("projects/")
                ? deadLetterTopic().trim()
                : `projects/${project()}/topics/${deadLetterTopic().trim()}`,
              maxDeliveryAttempts: attempts,
            },
          }
        : {}),
      ...(filterExpr().trim() ? { filter: filterExpr().trim() } : {}),
      ...(ordering() ? { enableMessageOrdering: true } : {}),
    });
    res.match(
      () => {
        setNewSubId("");
        setPushEndpoint("");
        setDeadLetterTopic("");
        setFilterExpr("");
        setOrdering(false);
        setNotice(`${t("pubsub.createSubscription")}: ${id}`);
        void refetchSubs();
      },
      (e) => setError(e.message),
    );
  };

  const pullNow = async (subId: string) => {
    setError(null);
    setNotice(null);
    const reqId = ++pullRequestId;
    const max = Math.max(1, Math.min(100, Number(maxMessages()) || 10));
    const res = await pullSubscription(project(), subId, max);
    if (reqId !== pullRequestId || pullSubId() !== subId) return;
    res.match(
      (page) => {
        setPulledState({ subId, messages: page.receivedMessages ?? [] });
      },
      (e) => setError(e.message),
    );
  };

  const ackIds = async (subId: string, ids: string[]) => {
    if (ids.length === 0) return;
    setError(null);
    const res = await acknowledgeSubscription(project(), subId, ids);
    res.match(
      () => {
        setPulledState((prev) =>
          prev && prev.subId === subId
            ? { subId, messages: prev.messages.filter((m) => !ids.includes(m.ackId)) }
            : prev,
        );
        setNotice(t("pubsub.acked", { count: ids.length }));
      },
      (e) => setError(e.message),
    );
  };

  // Snapshot creation
  const addSnapshot = async () => {
    setError(null);
    setNotice(null);
    const id = newSnapId().trim();
    const sub = effectiveSnapSub();
    if (!id || !sub) return;
    const res = await createPubSubSnapshot(project(), id, sub);
    res.match(
      () => {
        setNewSnapId("");
        setNotice(`${t("pubsub.createSnapshot")}: ${id}`);
        void refetchSnaps();
      },
      (e) => setError(e.message),
    );
  };

  const psTabs: readonly PubSubTab[] = ["topics", "subscriptions", "snapshots"];
  const onTabKeyDown = (event: KeyboardEvent) => {
    const idx = psTabs.indexOf(tab());
    let next = -1;
    if (event.key === "ArrowRight") next = (idx + 1) % psTabs.length;
    else if (event.key === "ArrowLeft") next = (idx - 1 + psTabs.length) % psTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = psTabs.length - 1;
    if (next >= 0) {
      event.preventDefault();
      const target = psTabs[next]!;
      setTab(target);
      document.getElementById(`pubsub-tab-${target}`)?.focus();
    }
  };

  return (
    <div>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 class="page-title">{t("pubsub.title")}</h1>
        <AsyncButton class="btn" onClick={refreshAll} testId="pubsub-refresh">
          {t("app.refresh")}
        </AsyncButton>
      </div>
      <ErrorBanner message={error()} />
      <Notice message={notice()} />
      <Show
        when={!unavailable() && appState.config().pubsubEnabled !== false}
        fallback={
          <div class="callout callout-warning" data-testid="pubsub-unavailable">
            {t("pubsub.notRunning")}
          </div>
        }
      >
        <div
          class="mb-4 flex overflow-x-auto border-b border-line-subtle"
          role="tablist"
          aria-label={t("pubsub.title")}
          onKeyDown={onTabKeyDown}
        >
          <button
            type="button"
            role="tab"
            id="pubsub-tab-topics"
            class="tab shrink-0"
            aria-selected={tab() === "topics"}
            aria-controls="pubsub-tabpanel"
            tabIndex={tab() === "topics" ? 0 : -1}
            data-testid="pubsub-tab-topics"
            onClick={() => setTab("topics")}
          >
            {t("pubsub.topics")} ({topics().length})
          </button>
          <button
            type="button"
            role="tab"
            id="pubsub-tab-subscriptions"
            class="tab shrink-0"
            aria-selected={tab() === "subscriptions"}
            aria-controls="pubsub-tabpanel"
            tabIndex={tab() === "subscriptions" ? 0 : -1}
            data-testid="pubsub-tab-subscriptions"
            onClick={() => setTab("subscriptions")}
          >
            {t("pubsub.subscriptions")} ({subs().length})
          </button>
          <button
            type="button"
            role="tab"
            id="pubsub-tab-snapshots"
            class="tab shrink-0"
            aria-selected={tab() === "snapshots"}
            aria-controls="pubsub-tabpanel"
            tabIndex={tab() === "snapshots" ? 0 : -1}
            data-testid="pubsub-tab-snapshots"
            onClick={() => setTab("snapshots")}
          >
            {t("pubsub.snapshots")} ({snaps().length})
          </button>
        </div>

        <div id="pubsub-tabpanel" role="tabpanel" aria-labelledby={`pubsub-tab-${tab()}`}>
          <Show when={tab() === "topics"}>
            <Section title={t("pubsub.topics")}>
              <form
                class="mb-4 flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addTopic();
                }}
              >
                <label class="text-sm">
                  <span class="label">{t("pubsub.topicId")}</span>
                  <input
                    class="input mono w-64"
                    data-testid="pubsub-new-topic-id"
                    placeholder="orders-events"
                    value={newTopicId()}
                    onInput={(e) => setNewTopicId(e.currentTarget.value)}
                  />
                </label>
                <AsyncButton
                  class="btn btn-primary"
                  disabled={topicGuard.pending()}
                  onClick={addTopic}
                  testId="pubsub-create-topic"
                >
                  {t("pubsub.createTopic")}
                </AsyncButton>
              </form>
              <FetchState
                loading={topicsRes.loading && !topicsRes()}
                error={errorOf(topicsRes())}
                onRetry={async () => {
                  await refetchTopics();
                }}
                empty={topics().length === 0}
                emptyMessage={t("pubsub.noTopics")}
              >
                <div class="table-scroll">
                  <table class="table" data-testid="pubsub-topics-table">
                    <thead>
                      <tr>
                        <th>{t("pubsub.topicId")}</th>
                        <th>{t("pubsub.resourceName")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      <For each={topics()}>
                        {(topic) => {
                          const short = () => shortPubSubName(topic.name);
                          return (
                            <tr data-testid={`pubsub-topic-${short()}`}>
                              <td class="mono font-medium">{short()}</td>
                              <td class="mono text-secondary">
                                <span class="mr-2 break-all">{topic.name}</span>
                                <CopyButton value={topic.name} subject={topic.name} />
                              </td>
                              <td class="space-x-2 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  class="btn btn-sm btn-primary"
                                  data-testid={`pubsub-publish-open-${short()}`}
                                  onClick={() =>
                                    setPublishingTopic(
                                      publishingTopic() === short() ? null : short(),
                                    )
                                  }
                                >
                                  {t("pubsub.publish")}
                                </button>
                                <ConfirmButton
                                  class="btn btn-sm btn-danger"
                                  label={t("app.delete")}
                                  question={t("pubsub.deleteTopicConfirm", { topic: short() })}
                                  testId={`pubsub-delete-topic-${short()}`}
                                  onConfirm={async () => {
                                    const r = await deleteTopic(project(), short());
                                    r.match(
                                      () => {
                                        if (publishingTopic() === short()) setPublishingTopic(null);
                                        void refetchTopics();
                                      },
                                      (e) => setError(e.message),
                                    );
                                  }}
                                />
                              </td>
                            </tr>
                          );
                        }}
                      </For>
                    </tbody>
                  </table>
                </div>
              </FetchState>
            </Section>

            <Show when={publishingTopic()}>
              {(topicId) => (
                <Section
                  title={`${t("pubsub.publish")}: ${topicId()}`}
                  actions={
                    <button
                      type="button"
                      class="btn btn-sm"
                      onClick={() => setPublishingTopic(null)}
                    >
                      {t("app.close")}
                    </button>
                  }
                >
                  <div data-testid={`pubsub-publish-panel-${topicId()}`}>
                    <CodeEditorToolbar
                      value={pubPayload()}
                      onFormat={setPubPayload}
                      testId="pubsub-payload"
                    />
                    <label class="mb-2 block text-sm">
                      <span class="label">{t("pubsub.publishData")}</span>
                      <textarea
                        class="input mono h-28"
                        spellcheck={false}
                        data-testid="pubsub-publish-payload"
                        value={pubPayload()}
                        onInput={(e) => setPubPayload(e.currentTarget.value)}
                      />
                    </label>
                    <div class="grid gap-3 md:grid-cols-2">
                      <label class="block text-sm">
                        <span class="label">{t("pubsub.publishAttributes")}</span>
                        <input
                          class="input mono"
                          data-testid="pubsub-publish-attributes"
                          value={pubAttrs()}
                          onInput={(e) => setPubAttrs(e.currentTarget.value)}
                        />
                      </label>
                      <label class="block text-sm">
                        <span class="label">{t("pubsub.orderingKey")}</span>
                        <input
                          class="input mono"
                          data-testid="pubsub-publish-ordering"
                          value={pubOrderingKey()}
                          onInput={(e) => setPubOrderingKey(e.currentTarget.value)}
                        />
                      </label>
                    </div>
                    <div class="mt-3">
                      <AsyncButton
                        class="btn btn-primary"
                        testId="pubsub-publish-send"
                        onClick={() => publish(topicId())}
                      >
                        {t("pubsub.publishSend")}
                      </AsyncButton>
                    </div>
                  </div>
                </Section>
              )}
            </Show>
          </Show>

          <Show when={tab() === "subscriptions"}>
            <Section title={t("pubsub.createSubscription")}>
              <div class="grid gap-3 md:grid-cols-3">
                <label class="text-sm">
                  <span class="label">{t("pubsub.subscriptionId")}</span>
                  <input
                    class="input mono"
                    data-testid="pubsub-new-sub-id"
                    placeholder="orders-worker"
                    value={newSubId()}
                    onInput={(e) => setNewSubId(e.currentTarget.value)}
                  />
                </label>
                <label class="text-sm">
                  <span class="label">{t("pubsub.topicLabel")}</span>
                  <select
                    class="input mono"
                    data-testid="pubsub-new-sub-topic"
                    value={effectiveSubTopic()}
                    onChange={(e) => setNewSubTopic(e.currentTarget.value)}
                  >
                    <For each={topics()}>
                      {(topic) => <option value={topic.name}>{shortPubSubName(topic.name)}</option>}
                    </For>
                  </select>
                </label>
                <label class="text-sm">
                  <span class="label">{t("pubsub.ackDeadline")}</span>
                  <input
                    class="input mono"
                    type="number"
                    min="10"
                    max="600"
                    value={ackDeadline()}
                    onInput={(e) => setAckDeadline(e.currentTarget.value)}
                  />
                </label>
                <label class="text-sm">
                  <span class="label">{t("pubsub.pushEndpoint")}</span>
                  <input
                    class="input mono"
                    placeholder="http://127.0.0.1:8081/push"
                    value={pushEndpoint()}
                    onInput={(e) => setPushEndpoint(e.currentTarget.value)}
                  />
                </label>
                <label class="text-sm">
                  <span class="label">{t("pubsub.deadLetterTopic")}</span>
                  <input
                    class="input mono"
                    placeholder="dead-letters"
                    value={deadLetterTopic()}
                    onInput={(e) => setDeadLetterTopic(e.currentTarget.value)}
                  />
                </label>
                <label class="text-sm">
                  <span class="label">{t("pubsub.filter")}</span>
                  <input
                    class="input mono"
                    placeholder='attributes.type = "order"'
                    value={filterExpr()}
                    onInput={(e) => setFilterExpr(e.currentTarget.value)}
                  />
                </label>
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-4">
                <label class="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={ordering()}
                    onChange={(e) => setOrdering(e.currentTarget.checked)}
                  />
                  {t("pubsub.enableOrdering")}
                </label>
                <Show when={deadLetterTopic().trim().length > 0}>
                  <label class="flex items-center gap-2 text-sm">
                    <span class="label">{t("pubsub.maxDeliveryAttempts")}</span>
                    <input
                      class="input input-sm mono w-20"
                      type="number"
                      min="5"
                      max="100"
                      value={maxAttempts()}
                      onInput={(e) => setMaxAttempts(e.currentTarget.value)}
                    />
                  </label>
                </Show>
                <AsyncButton
                  class="btn btn-primary"
                  testId="pubsub-create-sub"
                  disabled={topics().length === 0}
                  onClick={addSubscription}
                >
                  {t("pubsub.createSubscription")}
                </AsyncButton>
              </div>
            </Section>

            <Section title={t("pubsub.subscriptions")}>
              <FetchState
                loading={subsRes.loading && !subsRes()}
                error={errorOf(subsRes())}
                onRetry={async () => {
                  await refetchSubs();
                }}
                empty={subs().length === 0}
                emptyMessage={t("pubsub.noSubscriptions")}
              >
                <div class="table-scroll">
                  <table class="table" data-testid="pubsub-subs-table">
                    <thead>
                      <tr>
                        <th>{t("pubsub.subscriptionId")}</th>
                        <th>{t("pubsub.topicLabel")}</th>
                        <th>{t("pubsub.mode")}</th>
                        <th>{t("pubsub.ackDeadline")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      <For each={subs()}>
                        {(sub) => {
                          const short = () => shortPubSubName(sub.name);
                          const isPush = () => Boolean(sub.pushConfig?.pushEndpoint);
                          return (
                            <tr data-testid={`pubsub-sub-${short()}`}>
                              <td class="mono font-medium">
                                <div>{short()}</div>
                                <Show when={sub.filter}>
                                  <div class="text-xs text-muted">
                                    {t("pubsub.filterPrefix", { value: sub.filter! })}
                                  </div>
                                </Show>
                                <Show when={sub.deadLetterPolicy?.deadLetterTopic}>
                                  <div class="text-xs text-muted">
                                    {t("pubsub.dlqPrefix", {
                                      value: `${shortPubSubName(sub.deadLetterPolicy!.deadLetterTopic!)} (${sub.deadLetterPolicy!.maxDeliveryAttempts ?? 5})`,
                                    })}
                                  </div>
                                </Show>
                              </td>
                              <td class="mono">{shortPubSubName(sub.topic)}</td>
                              <td>
                                <StatusBadge tone={isPush() ? "info" : "neutral"}>
                                  {isPush() ? t("pubsub.modePush") : t("pubsub.modePull")}
                                </StatusBadge>
                                <Show when={sub.pushConfig?.pushEndpoint}>
                                  {(ep) => <div class="mono mt-1 text-xs text-muted">{ep()}</div>}
                                </Show>
                              </td>
                              <td class="mono">{sub.ackDeadlineSeconds ?? 10}s</td>
                              <td class="space-x-2 text-right whitespace-nowrap">
                                <Show when={!isPush()}>
                                  <button
                                    type="button"
                                    class="btn btn-sm btn-primary"
                                    data-testid={`pubsub-pull-open-${short()}`}
                                    onClick={() => {
                                      pullRequestId += 1;
                                      setPullSubId(short());
                                      setPulledState(null);
                                    }}
                                  >
                                    {t("pubsub.pull")}
                                  </button>
                                </Show>
                                <ConfirmButton
                                  class="btn btn-sm btn-danger"
                                  label={t("app.delete")}
                                  question={t("pubsub.deleteSubscriptionConfirm", {
                                    subscription: short(),
                                  })}
                                  testId={`pubsub-delete-sub-${short()}`}
                                  onConfirm={async () => {
                                    const r = await deleteSubscription(project(), short());
                                    r.match(
                                      () => {
                                        if (pullSubId() === short()) setPullSubId(null);
                                        void refetchSubs();
                                      },
                                      (e) => setError(e.message),
                                    );
                                  }}
                                />
                              </td>
                            </tr>
                          );
                        }}
                      </For>
                    </tbody>
                  </table>
                </div>
              </FetchState>
            </Section>

            <Show when={pullSubId()}>
              {(subId) => (
                <Section
                  title={`${t("pubsub.pull")}: ${subId()}`}
                  actions={
                    <button type="button" class="btn btn-sm" onClick={() => setPullSubId(null)}>
                      {t("app.close")}
                    </button>
                  }
                >
                  <div class="mb-3 flex flex-wrap items-end gap-2">
                    <label class="text-sm">
                      <span class="label">{t("pubsub.maxMessages")}</span>
                      <input
                        class="input mono w-24"
                        type="number"
                        min="1"
                        max="100"
                        value={maxMessages()}
                        onInput={(e) => setMaxMessages(e.currentTarget.value)}
                      />
                    </label>
                    <AsyncButton
                      class="btn btn-primary"
                      testId="pubsub-pull-now"
                      onClick={() => pullNow(subId())}
                    >
                      {t("pubsub.pullNow")}
                    </AsyncButton>
                    <Show when={pulled().length > 0}>
                      <AsyncButton
                        class="btn"
                        testId="pubsub-ack-all"
                        onClick={() =>
                          ackIds(
                            subId(),
                            pulled().map((m) => m.ackId),
                          )
                        }
                      >
                        {t("pubsub.ackAll")} ({pulled().length})
                      </AsyncButton>
                    </Show>
                    <Show when={snaps().length > 0}>
                      <div class="ml-auto flex flex-wrap items-end gap-2">
                        <label class="text-sm">
                          <span class="label">{t("pubsub.seekSnapshot")}</span>
                          <select
                            class="input mono"
                            value={effectiveSeekSnap()}
                            onChange={(e) => setSeekTargetSnap(e.currentTarget.value)}
                          >
                            <For each={snaps()}>
                              {(snap) => (
                                <option value={snap.name}>{shortPubSubName(snap.name)}</option>
                              )}
                            </For>
                          </select>
                        </label>
                        <AsyncButton
                          class="btn"
                          testId="pubsub-seek"
                          onClick={async () => {
                            const target = effectiveSeekSnap();
                            if (!target) return;
                            const r = await seekSubscription(project(), subId(), target);
                            r.match(
                              () => {
                                pullRequestId += 1;
                                setPulledState(null);
                                setNotice(t("pubsub.seekDone", { subscription: subId() }));
                              },
                              (e) => setError(e.message),
                            );
                          }}
                        >
                          {t("pubsub.seek")}
                        </AsyncButton>
                      </div>
                    </Show>
                  </div>
                  <Show
                    when={pulled().length > 0}
                    fallback={<p class="text-sm text-muted">{t("pubsub.pulledNone")}</p>}
                  >
                    <div class="table-scroll">
                      <table class="table" data-testid="pubsub-pulled-table">
                        <thead>
                          <tr>
                            <th>{t("pubsub.messageId")}</th>
                            <th>{t("pubsub.payload")}</th>
                            <th>{t("pubsub.publishTime")}</th>
                            <th>{t("pubsub.deliveryAttempt")}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          <For each={pulled()}>
                            {(item) => (
                              <tr>
                                <td class="mono">{item.message.messageId ?? ""}</td>
                                <td>
                                  <pre class="code-block max-h-40 overflow-auto whitespace-pre-wrap break-all">
                                    {decodeBase64Utf8(item.message.data)}
                                  </pre>
                                  <Show
                                    when={
                                      item.message.attributes &&
                                      Object.keys(item.message.attributes).length > 0
                                    }
                                  >
                                    <div class="mono mt-1 text-xs text-muted">
                                      {JSON.stringify(item.message.attributes)}
                                    </div>
                                  </Show>
                                </td>
                                <td class="mono whitespace-nowrap">
                                  {item.message.publishTime ?? ""}
                                  <RelativeTime value={item.message.publishTime} />
                                </td>
                                <td class="mono">{item.deliveryAttempt ?? 1}</td>
                                <td class="text-right">
                                  <AsyncButton
                                    class="btn btn-sm"
                                    onClick={() => ackIds(subId(), [item.ackId])}
                                  >
                                    {t("pubsub.ack")}
                                  </AsyncButton>
                                </td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </Show>
                </Section>
              )}
            </Show>
          </Show>

          <Show when={tab() === "snapshots"}>
            <Section title={t("pubsub.snapshots")}>
              <div class="mb-4 flex flex-wrap items-end gap-2">
                <label class="text-sm">
                  <span class="label">{t("pubsub.snapshotId")}</span>
                  <input
                    class="input mono w-56"
                    data-testid="pubsub-new-snap-id"
                    placeholder="checkpoint-1"
                    value={newSnapId()}
                    onInput={(e) => setNewSnapId(e.currentTarget.value)}
                  />
                </label>
                <label class="text-sm">
                  <span class="label">{t("pubsub.subscriptionId")}</span>
                  <select
                    class="input mono"
                    value={effectiveSnapSub()}
                    onChange={(e) => setNewSnapSub(e.currentTarget.value)}
                  >
                    <For each={subs()}>
                      {(sub) => <option value={sub.name}>{shortPubSubName(sub.name)}</option>}
                    </For>
                  </select>
                </label>
                <AsyncButton
                  class="btn btn-primary"
                  testId="pubsub-create-snap"
                  disabled={subs().length === 0}
                  onClick={addSnapshot}
                >
                  {t("pubsub.createSnapshot")}
                </AsyncButton>
              </div>
              <FetchState
                loading={snapsRes.loading && !snapsRes()}
                error={errorOf(snapsRes())}
                onRetry={async () => {
                  await refetchSnaps();
                }}
                empty={snaps().length === 0}
                emptyMessage={t("pubsub.noSnapshots")}
              >
                <table class="table" data-testid="pubsub-snaps-table">
                  <thead>
                    <tr>
                      <th>{t("pubsub.snapshotId")}</th>
                      <th>{t("pubsub.topicLabel")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    <For each={snaps()}>
                      {(snap) => {
                        const short = () => shortPubSubName(snap.name);
                        return (
                          <tr>
                            <td class="mono font-medium">{short()}</td>
                            <td class="mono">{shortPubSubName(snap.topic)}</td>
                            <td class="text-right">
                              <ConfirmButton
                                class="btn btn-sm btn-danger"
                                label={t("app.delete")}
                                question={t("pubsub.deleteSnapshotConfirm", { snapshot: short() })}
                                onConfirm={async () => {
                                  const r = await deletePubSubSnapshot(project(), short());
                                  r.match(
                                    () => void refetchSnaps(),
                                    (e) => setError(e.message),
                                  );
                                }}
                              />
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </FetchState>
            </Section>
          </Show>
        </div>
      </Show>
    </div>
  );
};

const PubSub: Component = () => (
  <Show when={JSON.stringify([appState.session(), appState.project()])} keyed>
    {(_scope) => <PubSubScope project={appState.project()} />}
  </Show>
);

export default PubSub;
