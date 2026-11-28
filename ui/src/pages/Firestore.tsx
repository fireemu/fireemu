import DatabasePicker from "../components/DatabasePicker";
import { A, useNavigate, useParams, useSearchParams } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  on,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
  type Component,
} from "solid-js";
import { createStore, produce, type SetStoreFunction } from "solid-js/store";
import { t } from "../i18n";
import { appState } from "../state";
import {
  AsyncButton,
  ConfirmButton,
  CopyButton,
  ErrorBanner,
  FetchState,
  Notice,
  RelativeTime,
  StatusBadge,
} from "../components/common";
import { ValueTree } from "../components/ValueTree";
import { buildValueTree, type ValueNode } from "../lib/valueTree";
import { CodeEditorToolbar } from "../components/CodeEditorToolbar";
import FirestoreQuery from "../components/FirestoreQuery";
import {
  clearMissingIndexes,
  loadMissingIndexes,
  type MissingIndexReports,
} from "../api/firestoreQuery";
import { fsFieldsToPlainJson, plainJsonToFsFields } from "../lib/firestoreJson";
import { defaultQuery, encodeSharedQuery, type QueryValueType } from "../lib/firestoreQuery";
import { decodeSplat, firestoreHref, referenceHref } from "../lib/hrefs";
import { createPagedList } from "../lib/pagedList";
import {
  affectedFirestoreViews,
  createLiveUpdateScheduler,
  createRowReadGuard,
  drainPendingRowUpdates,
  parseFirestoreWatchEvent,
} from "../lib/firestoreLiveUpdates";
import { selectReloadDocument } from "../lib/reloadedDocument";
import { createLeaveGuard, LeavePrompt } from "../lib/unsaved";
import { settle, subscribe } from "../api/client";
import { expireFirestoreListeners, sweepFirestoreTtl } from "../api/control";
import {
  createDocument,
  deleteCollection,
  deleteDocument,
  documentsRoot,
  getDocument,
  listCollectionIds,
  listDocuments,
  updateDocument,
} from "../api/firestore";
import {
  applyFieldDiff,
  defaultText,
  diffFields,
  FIELD_TYPES,
  isDocumentPath,
  lastSegment,
  parentPath,
  parseFields,
  relativePath,
  summarize,
  toEditable,
  type EditableField,
  type FieldType,
  type FsDocument,
  type FsValue,
} from "../lib/firestoreValue";

const typeLabel = (type: FieldType): string => {
  switch (type) {
    case "string":
      return t("firestore.typeString");
    case "number":
      return t("firestore.typeNumber");
    case "boolean":
      return t("firestore.typeBoolean");
    case "null":
      return t("firestore.typeNull");
    case "timestamp":
      return t("firestore.typeTimestamp");
    case "geopoint":
      return t("firestore.typeGeopoint");
    case "reference":
      return t("firestore.typeReference");
    case "array":
      return t("firestore.typeArray");
    case "map":
      return t("firestore.typeMap");
    case "bytes":
      return t("firestore.typeBytes");
  }
};

const hint = (type: FieldType): string => {
  switch (type) {
    case "number":
      return t("firestore.hintNumber");
    case "boolean":
      return t("firestore.hintBoolean");
    case "timestamp":
      return t("firestore.hintTimestamp");
    case "geopoint":
      return t("firestore.hintGeopoint");
    case "reference":
      return t("firestore.hintReference");
    case "array":
      return t("firestore.hintArray");
    case "map":
      return t("firestore.hintMap");
    case "bytes":
      return t("firestore.hintBytes");
    default:
      return "";
  }
};

/**
 * The rows of a field editor as a store. A store keeps every row's identity across edits, so
 * `<For>` updates the input in place instead of replacing the row (which would drop focus, the
 * caret and any IME composition on every keystroke).
 */
export const createFieldsStore = (
  initial: EditableField[],
): [EditableField[], SetStoreFunction<EditableField[]>] => createStore<EditableField[]>(initial);

/** The typed field editor: a name, a type and a value per row. */
export const FieldsEditor: Component<{
  fields: EditableField[];
  setFields: SetStoreFunction<EditableField[]>;
  disabled?: boolean;
}> = (props) => {
  const update = (index: number, patch: Partial<EditableField>) => props.setFields(index, patch);
  const remove = (index: number) => props.setFields(produce((rows) => void rows.splice(index, 1)));
  return (
    <div>
      <table class="table">
        <thead>
          <tr>
            <th>{t("firestore.fieldName")}</th>
            <th>{t("firestore.fieldType")}</th>
            <th>{t("firestore.fieldValue")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <For each={props.fields}>
            {(f, i) => (
              <tr>
                <td>
                  <input
                    class="input mono"
                    aria-label={t("firestore.fieldName")}
                    disabled={props.disabled}
                    value={f.name}
                    onInput={(e) => update(i(), { name: e.currentTarget.value })}
                  />
                </td>
                <td>
                  <select
                    class="input"
                    aria-label={t("firestore.fieldType")}
                    disabled={props.disabled}
                    value={f.type}
                    onChange={(e) => {
                      const type = e.currentTarget.value as FieldType;
                      update(i(), {
                        type,
                        text: defaultText(type),
                        original: undefined,
                        dirty: true,
                        numberKind: undefined,
                      });
                    }}
                  >
                    <For each={FIELD_TYPES}>
                      {(ty) => <option value={ty}>{typeLabel(ty)}</option>}
                    </For>
                  </select>
                </td>
                <td>
                  <Show
                    when={f.type === "array" || f.type === "map"}
                    fallback={
                      <div class="flex flex-wrap items-center gap-1.5">
                        <input
                          class="input mono min-w-36 flex-1"
                          aria-label={t("firestore.fieldValue")}
                          placeholder={hint(f.type)}
                          disabled={props.disabled || f.type === "null"}
                          value={f.text}
                          onInput={(e) => update(i(), { text: e.currentTarget.value, dirty: true })}
                        />
                        <Show when={f.type === "boolean"}>
                          <button
                            type="button"
                            class="btn btn-sm"
                            disabled={props.disabled}
                            onClick={() => update(i(), { text: "true", dirty: true })}
                          >
                            true
                          </button>
                          <button
                            type="button"
                            class="btn btn-sm"
                            disabled={props.disabled}
                            onClick={() => update(i(), { text: "false", dirty: true })}
                          >
                            false
                          </button>
                        </Show>
                        <Show when={f.type === "timestamp"}>
                          <button
                            type="button"
                            class="btn btn-sm"
                            data-testid="field-timestamp-now"
                            disabled={props.disabled}
                            onClick={() =>
                              update(i(), {
                                text: appState.clock() || new Date().toISOString(),
                                dirty: true,
                              })
                            }
                          >
                            {t("firestore.insertClockNow")}
                          </button>
                        </Show>
                      </div>
                    }
                  >
                    <textarea
                      class="input mono h-20"
                      aria-label={t("firestore.fieldValue")}
                      disabled={props.disabled}
                      placeholder={hint(f.type)}
                      value={f.text}
                      onInput={(e) => update(i(), { text: e.currentTarget.value, dirty: true })}
                    />
                  </Show>
                </td>
                <td>
                  <button
                    type="button"
                    class="btn"
                    disabled={props.disabled}
                    onClick={() => remove(i())}
                  >
                    {t("app.delete")}
                  </button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <button
        type="button"
        class="btn mt-2"
        data-testid="add-field"
        disabled={props.disabled}
        onClick={() =>
          props.setFields(produce((rows) => void rows.push({ name: "", type: "string", text: "" })))
        }
      >
        {t("firestore.addField")}
      </button>
    </div>
  );
};

const Breadcrumbs: Component<{ path: string; db: string }> = (props) => {
  const segments = () => props.path.split("/").filter(Boolean);
  const link = (index: number) =>
    firestoreHref(
      segments()
        .slice(0, index + 1)
        .join("/"),
      props.db,
    );
  return (
    <nav class="mono mb-3 flex flex-wrap items-center gap-1" aria-label={t("firestore.title")}>
      <A href={firestoreHref("", props.db)} class="link">
        {t("firestore.root")}
      </A>
      <For each={segments()}>
        {(s, i) => (
          <>
            <span class="text-muted">/</span>
            <A href={link(i())} class="link">
              {s}
            </A>
          </>
        )}
      </For>
    </nav>
  );
};

/** The collection IDs under a parent, paged (the API answers 300 at a time). */
const CollectionList: Component<{
  root: string;
  parent: string;
  db: string;
  version: number;
  testId: string;
  activeId?: string | undefined;
  asButtons?: boolean | undefined;
}> = (props) => {
  const navigate = useNavigate();
  const list = createPagedList((token) =>
    listCollectionIds(props.root, props.parent, token).map((page) => ({
      items: page.collectionIds ?? [],
      nextToken: page.nextPageToken,
    })),
  );
  createEffect(
    on(
      () => [props.root, props.parent] as const,
      () => void list.load(),
    ),
  );
  createEffect(
    on(
      () => props.version,
      () => void list.refresh(),
      { defer: true },
    ),
  );
  return (
    <FetchState
      loading={list.loading()}
      error={list.error()}
      stale={list.stale()}
      onRetry={list.refresh}
      empty={list.items().length === 0}
      emptyMessage={t("firestore.noCollections")}
    >
      <ul class="mono space-y-1" data-testid={props.testId}>
        <For each={list.items()}>
          {(id) => {
            const href = () => firestoreHref(props.parent ? `${props.parent}/${id}` : id, props.db);
            return (
              <li>
                <Show
                  when={props.asButtons}
                  fallback={
                    <A href={href()} class="link">
                      {id}
                    </A>
                  }
                >
                  <button
                    type="button"
                    class="link w-full truncate text-left"
                    classList={{ "font-semibold text-accent": props.activeId === id }}
                    aria-current={props.activeId === id ? "page" : undefined}
                    onClick={() => navigate(href())}
                  >
                    {id}
                  </button>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
      <Show when={list.nextToken()}>
        <AsyncButton class="btn mt-2" onClick={list.more}>
          {t("firestore.more")}
        </AsyncButton>
      </Show>
    </FetchState>
  );
};

/** New document form (collection known; ID optional). */
const NewDocumentForm: Component<{
  root: string;
  collection: string;
  onDone: (path: string) => void;
  onCancel: () => void;
}> = (props) => {
  const [id, setId] = createSignal("");
  const [fields, setFields] = createFieldsStore([{ name: "", type: "string", text: "" }]);
  const [mode, setMode] = createSignal<"fields" | "json">("fields");
  const [jsonText, setJsonText] = createSignal("{\n  \n}");
  const [error, setError] = createSignal<string | null>(null);
  const switchMode = (next: "fields" | "json") => {
    setError(null);
    if (next === mode()) return;
    if (next === "json") {
      const parsed = parseFields(
        fields.filter((f) => f.name || f.text),
        props.root,
      );
      if (parsed.isOk()) {
        setJsonText(JSON.stringify(fsFieldsToPlainJson(parsed.value), null, 2));
      }
      setMode("json");
    } else {
      const parsed = plainJsonToFsFields(jsonText());
      if (parsed.isErr()) {
        setError(parsed.error);
        return;
      }
      const editable = toEditable(parsed.value);
      setFields(editable.length > 0 ? editable : [{ name: "", type: "string", text: "" }]);
      setMode("fields");
    }
  };
  const save = async () => {
    setError(null);
    let body: Record<string, FsValue>;
    if (mode() === "json") {
      const parsed = plainJsonToFsFields(jsonText());
      if (parsed.isErr()) {
        setError(parsed.error);
        return;
      }
      body = parsed.value;
    } else {
      const parsed = parseFields(
        fields.filter((f) => f.name || f.text),
        props.root,
      );
      if (parsed.isErr()) {
        setError(
          t("firestore.invalidValue", { field: parsed.error.field, message: parsed.error.message }),
        );
        return;
      }
      body = parsed.value;
    }
    const r = await createDocument(props.root, props.collection, id().trim(), body);
    r.match(
      (doc) => props.onDone(relativePath(doc.name)),
      (e) => setError(e.message),
    );
  };
  return (
    <div class="card mb-4" data-testid="new-document">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold">{t("firestore.addDocument")}</h3>
        <div class="flex gap-1">
          <button
            type="button"
            class="btn btn-sm"
            classList={{ "btn-primary": mode() === "fields" }}
            data-testid="new-doc-mode-fields"
            onClick={() => switchMode("fields")}
          >
            {t("firestore.fieldsEditor")}
          </button>
          <button
            type="button"
            class="btn btn-sm"
            classList={{ "btn-primary": mode() === "json" }}
            data-testid="new-doc-mode-json"
            onClick={() => switchMode("json")}
          >
            {t("firestore.jsonEditor")}
          </button>
        </div>
      </div>
      <ErrorBanner message={error()} />
      <label class="mb-2 block text-sm">
        <span class="label">{t("firestore.documentId")}</span>
        <input
          class="input mono"
          data-testid="new-document-id"
          placeholder={t("firestore.documentIdAuto")}
          value={id()}
          onInput={(e) => setId(e.currentTarget.value)}
        />
      </label>
      <Show
        when={mode() === "json"}
        fallback={<FieldsEditor fields={fields} setFields={setFields} />}
      >
        <p class="mb-2 text-xs text-muted">{t("firestore.jsonEditorHint")}</p>
        <CodeEditorToolbar value={jsonText()} onFormat={setJsonText} />
        <textarea
          class="input mono h-48"
          data-testid="new-doc-json"
          spellcheck={false}
          value={jsonText()}
          onInput={(e) => setJsonText(e.currentTarget.value)}
        />
      </Show>
      <div class="mt-3 flex gap-2">
        <AsyncButton class="btn btn-primary" onClick={save} testId="new-document-save">
          {t("app.save")}
        </AsyncButton>
        <button type="button" class="btn" onClick={props.onCancel}>
          {t("app.cancel")}
        </button>
      </div>
    </div>
  );
};

/** New collection under `parent` (root or a document): a collection ID and a first document. */
const NewCollectionForm: Component<{
  root: string;
  parent: string;
  onDone: (path: string) => void;
  onCancel: () => void;
}> = (props) => {
  const [collection, setCollection] = createSignal("");
  const [id, setId] = createSignal("");
  const [fields, setFields] = createFieldsStore([{ name: "", type: "string", text: "" }]);
  const [error, setError] = createSignal<string | null>(null);
  const save = async () => {
    setError(null);
    const cid = collection().trim();
    if (!cid || cid.includes("/")) {
      setError(
        t("firestore.invalidValue", {
          field: t("firestore.collectionId"),
          message: t("firestore.emptyFieldName"),
        }),
      );
      return;
    }
    const parsed = parseFields(
      fields.filter((f) => f.name || f.text),
      props.root,
    );
    if (parsed.isErr()) {
      setError(
        t("firestore.invalidValue", { field: parsed.error.field, message: parsed.error.message }),
      );
      return;
    }
    const path = props.parent ? `${props.parent}/${cid}` : cid;
    const r = await createDocument(props.root, path, id().trim(), parsed.value);
    r.match(
      (doc) => props.onDone(relativePath(doc.name)),
      (e) => setError(e.message),
    );
  };
  return (
    <div class="card mb-4" data-testid="new-collection">
      <h3 class="mb-2 font-semibold">{t("firestore.addCollection")}</h3>
      <ErrorBanner message={error()} />
      <label class="mb-2 block text-sm">
        <span class="label">{t("firestore.collectionId")}</span>
        <input
          class="input mono"
          data-testid="new-collection-id"
          value={collection()}
          onInput={(e) => setCollection(e.currentTarget.value)}
        />
      </label>
      <label class="mb-2 block text-sm">
        <span class="label">{t("firestore.documentId")}</span>
        <input
          class="input mono"
          data-testid="new-collection-doc-id"
          placeholder={t("firestore.documentIdAuto")}
          value={id()}
          onInput={(e) => setId(e.currentTarget.value)}
        />
      </label>
      <FieldsEditor fields={fields} setFields={setFields} />
      <div class="mt-3 flex gap-2">
        <AsyncButton class="btn btn-primary" onClick={save} testId="new-collection-save">
          {t("app.save")}
        </AsyncButton>
        <button type="button" class="btn" onClick={props.onCancel}>
          {t("app.cancel")}
        </button>
      </div>
    </div>
  );
};

/** A document: fields (view or edit), subcollections, delete. */
const DocumentView: Component<{
  root: string;
  path: string;
  db: string;
  version: number;
  subcollectionVersion: number;
  onDeleted: () => void;
}> = (props) => {
  const navigate = useNavigate();
  let readGeneration = 0;
  const readGenerations = new WeakMap<object, number>();
  const [doc, { refetch, mutate }] = createResource(
    () => [props.root, props.path, props.version] as const,
    async ([root, path]) => {
      const generation = ++readGeneration;
      const result = await settle(getDocument(root, path));
      readGenerations.set(result, generation);
      return result;
    },
  );
  const [editing, setEditing] = createSignal(false);
  const [editMode, setEditMode] = createSignal<"fields" | "json">("fields");
  const [jsonDraft, setJsonDraft] = createSignal("{}");
  const [jsonBaseline, setJsonBaseline] = createSignal<Record<string, FsValue>>({});
  const [fields, setFields] = createFieldsStore([]);
  const [duplicating, setDuplicating] = createSignal(false);
  const [duplicateId, setDuplicateId] = createSignal("");
  const [editSession, setEditSession] = createSignal<{
    root: string;
    path: string;
    fields: Record<string, FsValue>;
    updateTime: string;
    generation: number;
  } | null>(null);
  const [conflict, setConflict] = createSignal(false);
  const [editBusy, setEditBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [showJson, setShowJson] = createSignal(false);
  const [newCollection, setNewCollection] = createSignal(false);
  const current = createMemo<FsDocument | null>((previous) => {
    const result = doc();
    const name = `${props.root}/${props.path}`;
    if (result?.isOk()) return result.value.name === name ? result.value : null;
    const session = editSession();
    // A failed refresh must not remove an active editor or its last successful document.
    // Actual deletion and scope changes still clear the displayed document.
    return result?.isErr() &&
      result.error.status !== 404 &&
      editing() &&
      session?.root === props.root &&
      session.path === props.path &&
      previous?.name === name
      ? previous
      : null;
  }, null);
  const loadError = () =>
    doc()?.match(
      () => null,
      (e) => (e.status === 404 ? null : e.message),
    ) ?? null;
  const parsedCurrentEdit = (root: string, original?: Record<string, FsValue>) =>
    editMode() === "json"
      ? plainJsonToFsFields(jsonDraft(), jsonBaseline() ?? original).mapErr((message) => ({
          field: "JSON",
          message,
        }))
      : parseFields(fields, root);
  const guard = createLeaveGuard(() => {
    const session = editSession();
    if (!editing() || !session) return false;
    const parsed = parsedCurrentEdit(session.root, session.fields);
    return parsed.isErr() || diffFields(session.fields, parsed.value).fieldPaths.length > 0;
  });
  const missing = () =>
    doc()?.match(
      () => false,
      (e) => e.status === 404,
    ) ?? false;
  let editGeneration = 0;
  let editOperation = 0;
  createEffect(() => {
    void props.root;
    void props.path;
    editGeneration += 1;
    editOperation += 1;
    setEditing(false);
    setEditMode("fields");
    setDuplicating(false);
    setEditSession(null);
    setConflict(false);
    setEditBusy(false);
  });
  const startEdit = () => {
    const selected = current();
    if (!selected?.updateTime) return;
    const original = selected.fields ?? {};
    editGeneration += 1;
    editOperation += 1;
    setFields(toEditable(original));
    setJsonBaseline(original);
    setJsonDraft(JSON.stringify(fsFieldsToPlainJson(original), null, 2));
    setEditMode("fields");
    setEditSession({
      root: props.root,
      path: props.path,
      fields: original,
      updateTime: selected.updateTime,
      generation: editGeneration,
    });
    setConflict(false);
    setEditing(true);
  };
  const switchEditMode = (next: "fields" | "json") => {
    setError(null);
    const session = editSession();
    if (!session || next === editMode()) return;
    if (next === "json") {
      const parsed = parseFields(fields, session.root);
      if (parsed.isErr()) {
        setError(
          t("firestore.invalidValue", { field: parsed.error.field, message: parsed.error.message }),
        );
        return;
      }
      setJsonBaseline(parsed.value);
      setJsonDraft(JSON.stringify(fsFieldsToPlainJson(parsed.value), null, 2));
      setEditMode("json");
    } else {
      const parsed = plainJsonToFsFields(jsonDraft(), jsonBaseline());
      if (parsed.isErr()) {
        setError(parsed.error);
        return;
      }
      setFields(toEditable(parsed.value));
      setEditMode("fields");
    }
  };
  const save = async () => {
    if (editBusy()) return;
    setError(null);
    const session = editSession();
    if (!session) return;
    const parsed = parsedCurrentEdit(session.root, session.fields);
    if (parsed.isErr()) {
      setError(
        editMode() === "json"
          ? parsed.error.message
          : t("firestore.invalidValue", {
              field: parsed.error.field,
              message: parsed.error.message,
            }),
      );
      return;
    }
    const changes = diffFields(session.fields, parsed.value);
    if (changes.fieldPaths.length === 0) {
      setEditing(false);
      setEditSession(null);
      return;
    }
    const operation = ++editOperation;
    setEditBusy(true);
    const r = await updateDocument(
      session.root,
      session.path,
      changes.fields,
      changes.fieldPaths,
      session.updateTime,
    );
    const staleSession =
      editSession()?.generation !== session.generation ||
      editOperation !== operation ||
      props.root !== session.root ||
      props.path !== session.path;
    if (staleSession) return;
    setEditBusy(false);
    r.match(
      () => {
        setEditing(false);
        setEditSession(null);
        if (props.root === session.root && props.path === session.path) void refetch();
      },
      (e) => {
        if (e.code === "FAILED_PRECONDITION") {
          setConflict(true);
          setError(t("firestore.editConflict"));
        } else {
          setError(e.message);
        }
      },
    );
  };
  const reloadForReapply = async () => {
    if (editBusy()) return;
    const session = editSession();
    if (!session || props.root !== session.root || props.path !== session.path) return;
    const parsedDraft = parsedCurrentEdit(session.root, session.fields);
    if (parsedDraft.isErr()) return;
    const draftChanges = diffFields(session.fields, parsedDraft.value);
    const operation = ++editOperation;
    const reloadGeneration = ++readGeneration;
    setEditBusy(true);
    const reloaded = await getDocument(session.root, session.path);
    if (
      editSession()?.generation !== session.generation ||
      editOperation !== operation ||
      props.root !== session.root ||
      props.path !== session.path
    )
      return;
    setEditBusy(false);
    // A live refresh can supersede the view resource while this read is pending.
    // Rebase from this operation's response, not the resource's previously rendered value.
    if (reloaded.isErr()) {
      setError(
        reloaded.error.status === 404 ? t("firestore.editConflictDeleted") : reloaded.error.message,
      );
      return;
    }
    const observed = doc();
    const observedGeneration = observed ? (readGenerations.get(observed) ?? 0) : 0;
    if (
      observedGeneration > reloadGeneration &&
      observed?.isErr() &&
      observed.error.status === 404
    ) {
      setError(t("firestore.editConflictDeleted"));
      return;
    }
    // Publication order alone cannot distinguish an older read held across this operation.
    // Read issuance also permits an authoritative restore to decrease updateTime.
    const selected = selectReloadDocument(
      { document: reloaded.value, generation: reloadGeneration },
      observed?.isOk() ? { document: observed.value, generation: observedGeneration } : null,
    );
    if (selected.isErr()) {
      setError(t("firestore.editConflict"));
      return;
    }
    const latest = selected.value;
    const published = reloaded.map(() => latest);
    readGenerations.set(published, Math.max(reloadGeneration, observedGeneration));
    mutate(published);
    // Supersede older pending view reads, then converge to the current server state.
    // Ordering is local to this reload so a later snapshot restore can still move time back.
    void refetch();
    setEditSession({
      ...session,
      fields: latest.fields ?? {},
      updateTime: latest.updateTime!,
    });
    const merged = applyFieldDiff(latest.fields ?? {}, draftChanges);
    setFields(toEditable(merged));
    setJsonBaseline(merged);
    setJsonDraft(JSON.stringify(fsFieldsToPlainJson(merged), null, 2));
    setConflict(false);
    setError(null);
    setNotice(t("firestore.draftReapplied"));
  };
  const duplicateDocument = async () => {
    const selected = current();
    if (!selected) return;
    setError(null);
    const col = parentPath(props.path);
    const r = await createDocument(props.root, col, duplicateId().trim(), selected.fields ?? {});
    r.match(
      (created) => {
        setDuplicating(false);
        navigate(firestoreHref(relativePath(created.name), props.db));
      },
      (e) => setError(e.message),
    );
  };
  const filterByFieldValue = (fieldPath: string, node: ValueNode) => {
    const col = parentPath(props.path);
    if (!col) return;
    let qType: QueryValueType = "string";
    let text = node.preview;
    if (node.type === "number") {
      qType = node.numberKind === "integer" ? "integer" : "double";
    } else if (node.type === "boolean") {
      qType = "boolean";
    } else if (node.type === "null") {
      qType = "null";
      text = "";
    } else if (node.type === "timestamp") {
      qType = "timestamp";
    } else if (node.type === "geopoint") {
      qType = "geopoint";
    } else if (node.type === "reference") {
      qType = "reference";
      text = node.reference ?? node.preview;
    } else if (node.type === "bytes") {
      qType = "bytes";
    }
    const queryDraft = {
      ...defaultQuery(),
      filters: [{ field: fieldPath, op: "EQUAL" as const, type: qType, text }],
    };
    const base = firestoreHref(col, props.db);
    const sep = base.includes("?") ? "&" : "?";
    navigate(`${base}${sep}query=${encodeURIComponent(encodeSharedQuery(queryDraft))}`);
  };
  const remove = async () => {
    const r = await deleteDocument(props.root, props.path);
    r.match(
      () => props.onDeleted(),
      (e) => setError(e.message),
    );
  };
  const fieldRows = () => Object.entries(current()?.fields ?? {}) as [string, FsValue][];
  return (
    <div data-testid="document-view">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-0 flex-wrap items-baseline gap-2">
          <h2 class="mono text-base font-semibold break-all">{lastSegment(props.path)}</h2>
          <CopyButton
            value={props.path}
            subject={t("firestore.documentPath")}
            testId="document-copy-path"
          />
        </div>
        <div class="flex flex-wrap items-start gap-2">
          <Show when={!editing()}>
            <button type="button" class="btn" data-testid="document-edit" onClick={startEdit}>
              {t("firestore.edit")}
            </button>
          </Show>
          <Show when={current()}>
            <CopyButton
              value={JSON.stringify(fsFieldsToPlainJson(current()?.fields), null, 2)}
              subject={t("firestore.copyJson")}
              testId="document-copy-json"
            />
            <button
              type="button"
              class="btn"
              data-testid="document-duplicate"
              onClick={() => {
                setDuplicateId(`${lastSegment(props.path)}-copy`);
                setDuplicating(!duplicating());
              }}
            >
              {t("firestore.duplicateDocument")}
            </button>
          </Show>
          <button type="button" class="btn" onClick={() => setShowJson(!showJson())}>
            {t("firestore.jsonView")}
          </button>
          <ConfirmButton
            label={t("firestore.deleteDocument")}
            question={t("firestore.deleteDocumentConfirm", { path: props.path })}
            details={t("firestore.deleteDocumentDetails", {
              project: appState.project(),
              db: props.db,
            })}
            onConfirm={remove}
            testId="document-delete"
          />
        </div>
      </div>
      <Show when={duplicating()}>
        <div class="inset mb-3 flex flex-wrap items-end gap-2 p-3" data-testid="duplicate-form">
          <label class="flex-1 text-sm">
            <span class="label">{t("firestore.documentId")}</span>
            <input
              class="input mono"
              data-testid="duplicate-document-id"
              placeholder={t("firestore.documentIdAuto")}
              value={duplicateId()}
              onInput={(e) => setDuplicateId(e.currentTarget.value)}
            />
          </label>
          <AsyncButton
            class="btn btn-primary"
            testId="duplicate-document-save"
            onClick={duplicateDocument}
          >
            {t("firestore.duplicateDocument")}
          </AsyncButton>
          <button type="button" class="btn" onClick={() => setDuplicating(false)}>
            {t("app.cancel")}
          </button>
        </div>
      </Show>
      <LeavePrompt guard={guard} subject={t("firestore.editorSubject", { path: props.path })} />
      <ErrorBanner message={error()} />
      <Notice message={notice()} />
      <FetchState
        loading={doc.loading && !current()}
        error={current() ? null : loadError()}
        stale={current() ? loadError() : null}
        onRetry={async () => {
          await refetch();
        }}
      >
        <Show when={missing()}>
          <p class="mb-3 text-sm text-muted">{t("firestore.missing")}</p>
        </Show>
        <Show when={current()}>
          {(d) => (
            <div class="mb-3 flex flex-wrap gap-x-4 text-xs text-secondary">
              <span class="whitespace-nowrap">
                {t("firestore.createTime")}: <span class="mono">{d().createTime}</span>
                <RelativeTime value={d().createTime} />
              </span>{" "}
              <span class="whitespace-nowrap">
                {t("firestore.updateTime")}: <span class="mono">{d().updateTime}</span>
                <RelativeTime value={d().updateTime} />
              </span>
            </div>
          )}
        </Show>
        <Show
          when={editing()}
          fallback={
            <Show
              when={fieldRows().length > 0}
              fallback={<p class="text-sm text-muted">{t("firestore.noFields")}</p>}
            >
              <ValueTree
                nodes={buildValueTree(current()?.fields)}
                typeLabel={typeLabel}
                referenceHref={(reference) => referenceHref(reference, props.root, props.db)}
                showCopyActions
                onFilterValue={filterByFieldValue}
                testId="document-fields"
              />
            </Show>
          }
        >
          <div class="mb-2 flex gap-1">
            <button
              type="button"
              class="btn btn-sm"
              classList={{ "btn-primary": editMode() === "fields" }}
              data-testid="doc-edit-mode-fields"
              disabled={editBusy()}
              onClick={() => switchEditMode("fields")}
            >
              {t("firestore.fieldsEditor")}
            </button>
            <button
              type="button"
              class="btn btn-sm"
              classList={{ "btn-primary": editMode() === "json" }}
              data-testid="doc-edit-mode-json"
              disabled={editBusy()}
              onClick={() => switchEditMode("json")}
            >
              {t("firestore.jsonEditor")}
            </button>
          </div>
          <Show
            when={editMode() === "json"}
            fallback={<FieldsEditor fields={fields} setFields={setFields} disabled={editBusy()} />}
          >
            <p class="mb-2 text-xs text-muted">{t("firestore.jsonEditorHint")}</p>
            <CodeEditorToolbar value={jsonDraft()} onFormat={setJsonDraft} />
            <textarea
              class="input mono h-64"
              data-testid="document-json-editor"
              spellcheck={false}
              disabled={editBusy()}
              value={jsonDraft()}
              onInput={(e) => setJsonDraft(e.currentTarget.value)}
            />
          </Show>
          <Show when={conflict()}>
            <button
              type="button"
              class="btn mt-2"
              data-testid="document-reload-draft"
              disabled={editBusy()}
              onClick={reloadForReapply}
            >
              {t("firestore.reloadDraft")}
            </button>
          </Show>
          <div class="mt-3 flex gap-2">
            <AsyncButton
              class="btn btn-primary"
              disabled={editBusy()}
              onClick={save}
              testId="document-save"
            >
              {t("app.save")}
            </AsyncButton>
            <button
              type="button"
              class="btn"
              onClick={() => {
                editGeneration += 1;
                editOperation += 1;
                setEditing(false);
                setEditSession(null);
                setConflict(false);
                setEditBusy(false);
              }}
            >
              {t("app.cancel")}
            </button>
          </div>
        </Show>
        <Show when={showJson()}>
          <pre class="mono mt-3 whitespace-pre-wrap code-block text-[0.8125rem]">
            {JSON.stringify(current()?.fields ?? {}, null, 2)}
          </pre>
        </Show>
      </FetchState>
      <div class="mt-4">
        <div class="mb-2 flex items-center justify-between">
          <h3 class="font-semibold">{t("firestore.subcollections")}</h3>
          <button
            type="button"
            class="btn"
            data-testid="start-subcollection"
            onClick={() => setNewCollection(true)}
          >
            {t("firestore.addCollection")}
          </button>
        </div>
        <Show when={newCollection()}>
          <NewCollectionForm
            root={props.root}
            parent={props.path}
            onDone={(path) => {
              setNewCollection(false);
              setNotice(null);
              navigate(firestoreHref(path, props.db));
            }}
            onCancel={() => setNewCollection(false)}
          />
        </Show>
        <CollectionList
          root={props.root}
          parent={props.path}
          db={props.db}
          version={props.subcollectionVersion}
          testId="subcollection-list"
        />
      </div>
    </div>
  );
};

/** A collection: its documents (paged), add document, delete collection. */
const CollectionView: Component<{
  root: string;
  path: string;
  db: string;
  version: number;
  rowUpdates: string[];
  onDeleted: () => void;
}> = (props) => {
  const navigate = useNavigate();
  const rowReadGuard = createRowReadGuard();
  const list = createPagedList(
    (token) => {
      // A membership read supersedes row reads issued before its first page.
      if (!token) rowReadGuard.invalidate();
      return listDocuments(props.root, props.path, token).map((page) => ({
        items: page.documents ?? [],
        nextToken: page.nextPageToken,
      }));
    },
    (document) => document.name,
  );
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [adding, setAdding] = createSignal(false);
  const [deleting, setDeleting] = createSignal<number | null>(null);
  const [columnsInput, setColumnsInput] = createSignal("");
  const pinnedColumns = createMemo(() =>
    columnsInput()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5),
  );
  const [pendingRowRevision, setPendingRowRevision] = createSignal(0);
  const pendingRowUpdates = new Set<string>();
  const load = async () => {
    pendingRowUpdates.clear();
    rowReadGuard.invalidate();
    await list.load();
  };
  const refresh = async () => {
    await list.refresh();
  };
  createEffect(
    on(
      () => [props.root, props.path] as const,
      () => void load(),
    ),
  );
  createEffect(
    on(
      () => props.rowUpdates,
      (ids) => {
        ids.forEach((id) => pendingRowUpdates.add(id));
        setPendingRowRevision((revision) => revision + 1);
      },
      { defer: true },
    ),
  );
  createEffect(() => {
    pendingRowRevision();
    const prefix = `${props.root}/${props.path}/`;
    const ready = drainPendingRowUpdates(
      pendingRowUpdates,
      new Set(list.items().map((document) => document.name.slice(prefix.length))),
      list.loading() || list.refreshing(),
      Boolean(list.nextToken()),
    );
    for (const id of ready) {
      const ticket = rowReadGuard.issue(id);
      void getDocument(props.root, `${props.path}/${id}`).match(
        (document) => {
          if (rowReadGuard.isCurrent(id, ticket)) {
            const displayed = list.items().find((item) => item.name === document.name);
            if (!displayed) return;
            if (!displayed.updateTime || !document.updateTime) {
              void refresh();
              return;
            }
            // Compare whole seconds and nanoseconds separately, including differing precision.
            const readSeconds = Date.parse(document.updateTime.replace(/\.\d+/, ""));
            const displayedSeconds = Date.parse(displayed.updateTime.replace(/\.\d+/, ""));
            if (!Number.isFinite(readSeconds) || !Number.isFinite(displayedSeconds)) {
              void refresh();
              return;
            }
            const readNanos = Number(
              document.updateTime.match(/\.(\d+)/)?.[1]?.padEnd(9, "0") ?? 0,
            );
            const displayedNanos = Number(
              displayed.updateTime.match(/\.(\d+)/)?.[1]?.padEnd(9, "0") ?? 0,
            );
            if (
              !(
                readSeconds > displayedSeconds ||
                (readSeconds === displayedSeconds && readNanos >= displayedNanos)
              )
            )
              return;
            list.updateItem(document);
            rowReadGuard.markApplied(id, ticket);
          }
        },
        (readError) => {
          if (!rowReadGuard.isCurrent(id, ticket)) return;
          if (readError.status === 404) void refresh();
          else list.reportStale(readError.message);
        },
      );
    }
  });
  // Collection membership changes re-read loaded pages without dropping pagination progress.
  createEffect(
    on(
      () => props.version,
      () => void refresh(),
      { defer: true },
    ),
  );
  const remove = async () => {
    setError(null);
    setDeleting(0);
    const r = await deleteCollection(props.root, props.path, setDeleting);
    const done = deleting() ?? 0;
    setDeleting(null);
    r.match(
      (count) => {
        setNotice(t("firestore.deleted", { count }));
        props.onDeleted();
      },
      (e) => setError(t("firestore.deletePartial", { count: done, message: e.message })),
    );
  };
  return (
    <div data-testid="collection-view">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex min-w-0 flex-wrap items-baseline gap-2">
          <h2 class="mono text-base font-semibold break-all">{lastSegment(props.path)}</h2>
          <CopyButton
            value={props.path}
            subject={t("firestore.documentPath")}
            testId="document-copy-path"
          />
        </div>
        <div class="flex flex-wrap items-start gap-2">
          <button
            type="button"
            class="btn btn-primary"
            data-testid="add-document"
            onClick={() => setAdding(true)}
          >
            {t("firestore.addDocument")}
          </button>
          <ConfirmButton
            label={t("firestore.deleteCollection")}
            question={t("firestore.deleteCollectionConfirm", { path: props.path })}
            details={t("firestore.deleteCollectionDetails", {
              project: appState.project(),
              db: props.db,
            })}
            onConfirm={remove}
            testId="collection-delete"
          />
        </div>
      </div>
      <Show when={deleting() !== null}>
        <p class="mb-3 text-sm" role="status" data-testid="collection-delete-progress">
          {t("firestore.deleting", { count: deleting() ?? 0 })}
        </p>
      </Show>
      <ErrorBanner message={error()} />
      <Notice message={notice()} />
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-base font-semibold">{t("firestore.documents")}</h3>
        <input
          class="input mono w-96 max-w-full"
          data-testid="preview-columns-input"
          aria-label={t("firestore.pinColumn")}
          placeholder={t("firestore.pinColumn")}
          value={columnsInput()}
          onInput={(e) => setColumnsInput(e.currentTarget.value)}
        />
      </div>
      <Show when={adding()}>
        <NewDocumentForm
          root={props.root}
          collection={props.path}
          onDone={(path) => {
            setAdding(false);
            navigate(firestoreHref(path, props.db));
          }}
          onCancel={() => setAdding(false)}
        />
      </Show>
      <FetchState
        loading={list.loading()}
        error={list.error()}
        stale={list.stale()}
        onRetry={refresh}
        empty={list.items().length === 0}
        emptyMessage={t("firestore.noDocuments")}
      >
        <table class="table" data-testid="document-list">
          <thead>
            <tr>
              <th>{t("firestore.documentId")}</th>
              <For each={pinnedColumns()}>{(col) => <th class="mono">{col}</th>}</For>
              <th>{t("firestore.fields")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={list.items()}>
              {(d) => (
                <tr>
                  <td class="mono">
                    <A href={firestoreHref(relativePath(d.name), props.db)} class="link">
                      {lastSegment(d.name)}
                    </A>
                    <Show when={!d.createTime && !d.fields}>
                      <span class="ml-2 text-xs text-muted">({t("firestore.missing")})</span>
                    </Show>
                  </td>
                  <For each={pinnedColumns()}>
                    {(col) => {
                      const val = () => d.fields?.[col];
                      return (
                        <td class="mono break-words [overflow-wrap:anywhere] text-secondary">
                          {val() ? summarize(val()!) : "—"}
                        </td>
                      );
                    }}
                  </For>
                  <td class="mono break-words [overflow-wrap:anywhere] text-secondary">
                    {Object.entries(d.fields ?? {})
                      .slice(0, 4)
                      .map(([k, v]) => `${k}: ${summarize(v)}`)
                      .join(", ")}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={list.nextToken()}>
          <AsyncButton class="btn mt-2" onClick={list.more}>
            {t("firestore.more")}
          </AsyncButton>
        </Show>
      </FetchState>
      <FirestoreQuery root={props.root} collection={props.path} db={props.db} />
    </div>
  );
};

/** The root: collections and "start collection". */
const RootView: Component<{ root: string; db: string; version: number }> = (props) => {
  const navigate = useNavigate();
  const [adding, setAdding] = createSignal(false);
  return (
    <div data-testid="root-view">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-base font-semibold">{t("firestore.collections")}</h2>
        <button
          type="button"
          class="btn btn-primary"
          data-testid="start-collection"
          onClick={() => setAdding(true)}
        >
          {t("firestore.addCollection")}
        </button>
      </div>
      <Show when={adding()}>
        <NewCollectionForm
          root={props.root}
          parent=""
          onDone={(path) => {
            setAdding(false);
            navigate(firestoreHref(path, props.db));
          }}
          onCancel={() => setAdding(false)}
        />
      </Show>
      <CollectionList
        root={props.root}
        parent=""
        db={props.db}
        version={props.version}
        testId="collection-list"
      />
    </div>
  );
};

const Firestore: Component = () => {
  const params = useParams<{ path?: string }>();
  const [search, setSearch] = useSearchParams<{ db?: string }>();
  const navigate = useNavigate();
  const db = () => (typeof search.db === "string" && search.db ? search.db : "(default)");
  const path = () => decodeSplat(params.path).join("/");
  const root = () => documentsRoot(appState.project(), db());
  const [collectionVersion, setCollectionVersion] = createSignal(0);
  const [documentVersion, setDocumentVersion] = createSignal(0);
  const [subcollectionVersion, setSubcollectionVersion] = createSignal(0);
  const [rowUpdates, setRowUpdates] = createSignal<string[]>([]);
  const [live, setLive] = createSignal(false);

  // Live updates refresh only views touched by the commit paths.
  createEffect(() => {
    const project = appState.project();
    const database = db();
    const route = path();
    let documentTimer: number | undefined;
    let pending = {
      collection: false,
      subcollections: false,
      full: false,
      updatedRows: new Set<string>(),
    };
    const scheduler = createLiveUpdateScheduler(() => {
      const current = pending;
      pending = {
        collection: false,
        subcollections: false,
        full: false,
        updatedRows: new Set<string>(),
      };
      if (current.collection || current.full) setCollectionVersion((v) => v + 1);
      if (current.subcollections || current.full) setSubcollectionVersion((v) => v + 1);
      if (current.updatedRows.size > 0) setRowUpdates([...current.updatedRows]);
    }, 150);
    const stop = subscribe(
      `firestore/watch?project=${encodeURIComponent(project)}&database=${encodeURIComponent(database)}`,
      (event) => {
        if (event.event === "ready") {
          setLive(true);
        } else {
          const parsed = parseFirestoreWatchEvent(event);
          const affected = affectedFirestoreViews(parsed, root(), route);
          // Keep the editor's authoritative reads on the original delayed invalidation path.
          if (
            isDocumentPath(route) &&
            (parsed.kind === "commit" || affected.full) &&
            documentTimer === undefined
          ) {
            documentTimer = window.setTimeout(() => {
              documentTimer = undefined;
              setDocumentVersion((v) => v + 1);
            }, 150);
          }
          // A restore starts a new row epoch even inside an active coalescing window.
          if (parsed.kind === "reset") {
            pending.collection = false;
            pending.subcollections = false;
            pending.full = false;
            pending.updatedRows.clear();
            setCollectionVersion((v) => v + 1);
            setSubcollectionVersion((v) => v + 1);
            return;
          }
          pending.collection ||= affected.collection;
          pending.subcollections ||= affected.subcollections;
          pending.full ||= affected.full;
          for (const id of affected.updatedRows) pending.updatedRows.add(id);
          if (
            affected.full ||
            affected.collection ||
            affected.subcollections ||
            affected.updatedRows.length > 0
          )
            scheduler.notify();
        }
      },
      () => setLive(false),
    );
    onCleanup(() => {
      stop();
      scheduler.dispose();
      if (documentTimer !== undefined) window.clearTimeout(documentTimer);
    });
  });

  const up = () => navigate(firestoreHref(parentPath(path()), db()));
  const [jump, setJump] = createSignal("");
  const [toolNotice, setToolNotice] = createSignal<string | null>(null);
  const [toolError, setToolError] = createSignal<string | null>(null);
  const goTo = () => {
    const target = jump().split("/").filter(Boolean).join("/");
    navigate(firestoreHref(target, db()));
    setJump("");
  };
  const runTtlSweep = async () => {
    setToolNotice(null);
    setToolError(null);
    const r = await sweepFirestoreTtl(appState.session());
    r.match(
      (res) => {
        setToolNotice(t("firestore.ttlSwept", { count: res.deletedDocumentCount }));
        setCollectionVersion((v) => v + 1);
      },
      (e) => setToolError(e.message),
    );
  };
  const runExpireListeners = async () => {
    setToolNotice(null);
    setToolError(null);
    const r = await expireFirestoreListeners();
    r.match(
      (res) => setToolNotice(t("firestore.listenersExpired", { count: res.expired })),
      (e) => setToolError(e.message),
    );
  };
  return (
    <div>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="page-title">{t("firestore.title")}</h1>
          <DatabasePicker
            project={appState.project()}
            session={appState.session()}
            database={db()}
            onSelect={(name) => setSearch({ db: name })}
          />
          <span class="text-sm text-muted">
            {t("firestore.project")}: <span class="mono">{appState.project()}</span>
          </span>
          <span class="badge badge-accent" title={t("app.adminHint")} data-testid="admin-badge">
            {t("app.admin")}
          </span>
          <StatusBadge tone={live() ? "success" : "neutral"} testId="live-badge">
            {live() ? t("firestore.live") : t("firestore.liveOff")}
          </StatusBadge>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <AsyncButton class="btn btn-sm" testId="firestore-ttl-sweep" onClick={runTtlSweep}>
            {t("firestore.ttlSweep")}
          </AsyncButton>
          <AsyncButton
            class="btn btn-sm"
            testId="firestore-expire-listeners"
            onClick={runExpireListeners}
          >
            {t("firestore.expireListeners")}
          </AsyncButton>
        </div>
      </div>
      <ErrorBanner message={toolError()} />
      <Notice message={toolNotice()} />
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <Breadcrumbs path={path()} db={db()} />
        <form
          class="mb-3 flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            goTo();
          }}
        >
          <input
            class="input mono w-80 max-w-full sm:w-96"
            data-testid="path-jump"
            placeholder={t("firestore.goToPlaceholder")}
            aria-label={t("firestore.goTo")}
            value={jump()}
            onInput={(e) => setJump(e.currentTarget.value)}
          />
          <button type="submit" class="btn">
            {t("firestore.goTo")}
          </button>
        </form>
      </div>
      <div class={path() !== "" ? "xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-4" : ""}>
        <Show when={path() !== ""}>
          <aside class="card mb-4 hidden xl:mb-0 xl:block" aria-label={t("firestore.collections")}>
            <h2 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {t("firestore.collections")}
            </h2>
            <CollectionList
              root={root()}
              parent=""
              db={db()}
              version={collectionVersion()}
              activeId={path().split("/")[0]}
              asButtons
              testId="collections-rail"
            />
          </aside>
        </Show>
        <div class="card min-w-0">
          <Show
            when={path() !== ""}
            fallback={<RootView root={root()} db={db()} version={collectionVersion()} />}
          >
            <Show
              when={isDocumentPath(path())}
              fallback={
                <CollectionView
                  root={root()}
                  path={path()}
                  db={db()}
                  version={collectionVersion()}
                  rowUpdates={rowUpdates()}
                  onDeleted={up}
                />
              }
            >
              <DocumentView
                root={root()}
                path={path()}
                db={db()}
                version={documentVersion()}
                subcollectionVersion={subcollectionVersion()}
                onDeleted={up}
              />
            </Show>
          </Show>
        </div>
      </div>
      <PageMissingIndexes session={appState.session()} root={root()} />
    </div>
  );
};

const PageMissingIndexes: Component<{ session: string; root: string }> = (props) => {
  const [reports, setReports] = createSignal<MissingIndexReports | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let requestSeq = 0;

  createEffect(
    on(
      () => [props.session, props.root] as const,
      () => {
        requestSeq += 1;
        setReports(null);
        setError(null);
        setLoading(false);
      },
      { defer: true },
    ),
  );

  const load = async () => {
    const seq = ++requestSeq;
    setLoading(true);
    setError(null);
    const result = await loadMissingIndexes(props.session, props.root);
    if (seq !== requestSeq) return;
    setLoading(false);
    result.match(
      (data) => setReports(data),
      (err) => setError(err.message),
    );
  };

  const clear = async () => {
    const seq = ++requestSeq;
    setError(null);
    const result = await clearMissingIndexes(props.session);
    if (seq !== requestSeq) return;
    result.match(
      () => {
        setReports({
          dropped: 0,
          truncated: false,
          missingIndexes: [],
          indexesJson: { indexes: [], fieldOverrides: [] },
        });
      },
      (err) => setError(err.message),
    );
  };

  const indexesJsonText = (value: MissingIndexReports): string => {
    const dbName = props.root.replace(/\/documents$/, "");
    const payload = value.indexesJson[dbName] ?? {
      indexes: value.missingIndexes.map((entry) => entry.index),
      fieldOverrides: [],
    };
    return JSON.stringify(payload, null, 2);
  };

  return (
    <details class="card mt-4" data-testid="firestore-missing-indexes-panel">
      <summary
        class="cursor-pointer font-semibold text-sm"
        onClick={() => {
          if (reports() === null && !loading()) void load();
        }}
      >
        {t("firestore.queryIndexes")}
        <Show when={reports() && reports()!.missingIndexes.length > 0}>
          {" "}
          ({reports()!.missingIndexes.length})
        </Show>
      </summary>
      <p class="my-2 text-xs text-muted">{t("firestore.queryIndexHint")}</p>
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" class="btn btn-sm" disabled={loading()} onClick={() => void load()}>
          {t("firestore.queryLoadIndexes")}
        </button>
        <AsyncButton class="btn btn-sm" testId="firestore-clear-indexes" onClick={clear}>
          {t("firestore.queryClearIndexes")}
        </AsyncButton>
        <Show when={reports() && reports()!.missingIndexes.length > 0}>
          <CopyButton
            value={indexesJsonText(reports()!)}
            subject={t("firestore.queryCopyIndexes")}
            testId="firestore-copy-indexes"
          />
        </Show>
      </div>
      <Show when={loading()}>
        <p role="status">{t("app.loading")}</p>
      </Show>
      <ErrorBanner message={error()} />
      <Show when={reports()}>
        {(value) => (
          <>
            <Show when={value().truncated}>
              <p role="status" class="my-2 text-sm">
                {t("firestore.queryIndexTruncated", { count: value().dropped })}
              </p>
            </Show>
            <Show when={value().missingIndexes.length === 0}>
              <p class="text-sm text-muted">{t("firestore.queryIndexEmpty")}</p>
            </Show>
            <For each={value().missingIndexes}>
              {(entry) => (
                <div class="my-2">
                  <p class="text-sm">{entry.message}</p>
                  <pre class="mono max-h-48 overflow-auto rounded-control border border-line-subtle bg-sunken p-2 text-xs">
                    {JSON.stringify(entry.index, null, 2)}
                  </pre>
                </div>
              )}
            </For>
          </>
        )}
      </Show>
    </details>
  );
};

export default Firestore;
