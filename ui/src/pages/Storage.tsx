import { A, useNavigate, useParams, useSearchParams } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type Component,
} from "solid-js";
import { dragHasFiles, previewKind } from "../lib/storagePreview";
import { createPreviewUrls } from "../lib/previewUrls";
import { createUploadQueue } from "../lib/uploadQueue";
import { t } from "../i18n";
import { appState } from "../state";
import {
  AsyncButton,
  ConfirmButton,
  CopyButton,
  ErrorBanner,
  FetchState,
  Field,
  Notice,
  RelativeTime,
  Spinner,
} from "../components/common";
import { CodeEditorToolbar } from "../components/CodeEditorToolbar";
import { decodeSplat, storageHref } from "../lib/hrefs";
import { createPagedList } from "../lib/pagedList";
import {
  deleteObject,
  downloadObject,
  getObject,
  listBuckets,
  listObjects,
  objectDownloadUrl,
  patchObjectMetadata,
  uploadObject,
  type ObjectInfo,
} from "../api/storage";
import { errorOf, settle } from "../api/client";

const formatSize = (size: string): string => {
  const n = Number(size);
  if (!Number.isFinite(n)) return size;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
};

/**
 * An inline look at an object: images through `<img>`, text-like content as text. The kind
 * comes from the declared content type and size; the bytes are never rendered as HTML.
 */
const ObjectPreview: Component<{ bucket: string; object: ObjectInfo }> = (props) => {
  const kind = () => previewKind(props.object.contentType, Number(props.object.size));
  const [prettyJson, setPrettyJson] = createSignal(false);
  // Fetches can overlap; only the latest may show its image or revoke the one shown.
  const urls = createPreviewUrls();
  onCleanup(urls.dispose);
  const [content] = createResource(
    () =>
      kind() === "none"
        ? null
        : ([props.bucket, props.object.name, props.object.generation, kind()] as const),
    async ([bucket, name, , wanted]) => {
      const token = urls.begin();
      const result = await downloadObject(bucket, name);
      if (result.isErr()) {
        urls.adopt(token, null);
        return {
          error: result.error.message,
          text: null,
          pretty: null as string | null,
          url: null,
        };
      }
      if (wanted === "text") {
        const text = await result.value.blob.text();
        let pretty: string | null = null;
        try {
          pretty = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          pretty = null;
        }
        urls.adopt(token, null);
        return { error: null, text, pretty, url: null };
      }
      return {
        error: null,
        text: null,
        pretty: null as string | null,
        url: urls.adopt(token, result.value.blob),
      };
    },
  );
  return (
    <div data-testid="object-preview">
      <div class="mb-1 flex items-center justify-between gap-2">
        <div class="label">{t("storage.preview")}</div>
        <Show when={content()?.pretty !== null && content()?.pretty !== undefined}>
          <button
            type="button"
            class="btn btn-sm"
            classList={{ "btn-primary": prettyJson() }}
            data-testid="object-preview-pretty"
            onClick={() => setPrettyJson(!prettyJson())}
          >
            {t("storage.formatJsonPreview")}
          </button>
        </Show>
      </div>
      <Show when={kind() !== "none"} fallback={<p class="hint">{t("storage.previewNone")}</p>}>
        <Show when={content()} fallback={<Spinner />}>
          {(loaded) => (
            <>
              <ErrorBanner message={loaded().error} />
              <Show when={loaded().text !== null}>
                <pre
                  class="mono max-h-96 overflow-auto code-block break-all whitespace-pre-wrap"
                  data-testid="object-preview-text"
                >
                  {prettyJson() && loaded().pretty !== null ? loaded().pretty : loaded().text}
                </pre>
              </Show>
              <Show when={loaded().url}>
                {(url) => (
                  <img
                    class="max-h-96 max-w-full rounded-control border border-line-subtle bg-sunken object-contain"
                    src={url()}
                    alt={t("storage.previewAlt", { name: props.object.name })}
                    data-testid="object-preview-image"
                  />
                )}
              </Show>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
};

const ObjectDetail: Component<{
  bucket: string;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}> = (props) => {
  const [meta, { refetch }] = createResource(
    () => [props.bucket, props.name] as const,
    ([b, n]) => settle(getObject(b, n)),
  );
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [editingMeta, setEditingMeta] = createSignal(false);
  const [metaDraft, setMetaDraft] = createSignal("{}");
  const download = async () => {
    const r = await downloadObject(props.bucket, props.name);
    r.match(
      ({ blob }) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = props.name.split("/").at(-1) ?? props.name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      (e) => setError(e.message),
    );
  };
  const saveMetadata = async () => {
    setError(null);
    setNotice(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(metaDraft() || "{}");
    } catch {
      setError(t("storage.metadataInvalid"));
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError(t("storage.metadataInvalid"));
      return;
    }
    const clean: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string") {
        setError(t("storage.metadataInvalid"));
        return;
      }
      clean[k] = v;
    }
    for (const existingKey of Object.keys(m()?.metadata ?? {})) {
      if (!Object.hasOwn(clean, existingKey)) {
        clean[existingKey] = null;
      }
    }
    const r = await patchObjectMetadata(props.bucket, props.name, clean);
    r.match(
      () => {
        setEditingMeta(false);
        setNotice(t("storage.metadataSaved"));
        void refetch();
      },
      (e) => setError(e.message),
    );
  };
  const m = () => meta()?.unwrapOr(null) ?? null;
  return (
    <div class="card mb-4" data-testid="object-detail">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 class="mono font-semibold break-all">{props.name}</h3>
        <div class="flex flex-wrap gap-2">
          <CopyButton
            value={objectDownloadUrl(appState.config().storageAddr, props.bucket, props.name)}
            subject={t("storage.copyUrl")}
            testId="object-copy-url"
          />
          <AsyncButton class="btn" onClick={download} testId="object-download">
            {t("storage.download")}
          </AsyncButton>
          <ConfirmButton
            label={t("storage.deleteObject")}
            question={t("storage.deleteObjectConfirm", { name: props.name })}
            testId="object-delete"
            onConfirm={async () => {
              const r = await deleteObject(props.bucket, props.name);
              r.match(
                () => props.onDeleted(),
                (e) => setError(e.message),
              );
            }}
          />
          <button type="button" class="btn" onClick={props.onClose}>
            {t("app.close")}
          </button>
        </div>
      </div>
      <ErrorBanner message={error() ?? errorOf(meta())} />
      <Notice message={notice()} />
      <Show when={m()} fallback={<Spinner />}>
        {(o) => (
          <div class="grid gap-2 md:grid-cols-2">
            <Field label={t("storage.size")}>{formatSize(o().size)}</Field>
            <Field label={t("storage.contentType")} mono>
              {o().contentType}
            </Field>
            <Field label={t("storage.updated")} mono>
              {o().updated}
              <RelativeTime value={o().updated} />
            </Field>
            <Field label={t("storage.generation")} mono>
              {o().generation} / {o().metageneration}
            </Field>
            <Field label={t("storage.md5")} mono>
              {o().md5Hash ?? ""}
            </Field>
            <Field label={t("storage.crc32c")} mono>
              {o().crc32c ?? ""}
            </Field>
            <div class="md:col-span-2">
              <div class="mb-1 flex items-center justify-between gap-2">
                <div class="label">{t("storage.customMetadata")}</div>
                <button
                  type="button"
                  class="btn btn-sm"
                  data-testid="object-edit-metadata"
                  onClick={() => {
                    setMetaDraft(JSON.stringify(o().metadata ?? {}, null, 2));
                    setEditingMeta(!editingMeta());
                  }}
                >
                  {editingMeta() ? t("app.cancel") : t("storage.editMetadata")}
                </button>
              </div>
              <Show
                when={editingMeta()}
                fallback={
                  <pre class="mono code-block text-xs">
                    {JSON.stringify(o().metadata ?? {}, null, 2)}
                  </pre>
                }
              >
                <CodeEditorToolbar value={metaDraft()} onFormat={setMetaDraft} />
                <textarea
                  class="input mono h-28"
                  data-testid="object-metadata-editor"
                  spellcheck={false}
                  value={metaDraft()}
                  onInput={(e) => setMetaDraft(e.currentTarget.value)}
                />
                <div class="mt-2">
                  <AsyncButton
                    class="btn btn-primary"
                    testId="object-metadata-save"
                    onClick={saveMetadata}
                  >
                    {t("app.save")}
                  </AsyncButton>
                </div>
              </Show>
            </div>
            <div class="md:col-span-2">
              <ObjectPreview bucket={props.bucket} object={o()} />
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

const Storage: Component = () => {
  const params = useParams<{ path?: string }>();
  const [search, setSearch] = useSearchParams<{ bucket?: string }>();
  const navigate = useNavigate();
  // The buckets of the selected session's project; the default one first.
  const [buckets] = createResource(
    () => appState.project(),
    (project) => settle(listBuckets(project)),
  );
  const bucketList = () => buckets()?.unwrapOr({ buckets: [] }).buckets ?? [];
  const bucket = () =>
    (typeof search.bucket === "string" && search.bucket) || `${appState.project()}.appspot.com`;
  const prefix = () => {
    const p = decodeSplat(params.path).join("/");
    return p ? `${p}/` : "";
  };
  // Folders and objects share one listing: a row is either a prefix or an object.
  type Entry = { kind: "folder"; name: string } | { kind: "object"; object: ObjectInfo };
  const list = createPagedList<Entry>((token) =>
    listObjects(bucket(), prefix(), token).map((page) => ({
      items: [
        ...(page.prefixes ?? []).map((name): Entry => ({ kind: "folder", name })),
        ...(page.items ?? []).map((object): Entry => ({ kind: "object", object })),
      ],
      nextToken: page.nextPageToken,
    })),
  );
  const folders = () => list.items().flatMap((e) => (e.kind === "folder" ? [e.name] : []));
  const objects = () => list.items().flatMap((e) => (e.kind === "object" ? [e.object] : []));
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [fileInput, setFileInput] = createSignal<HTMLInputElement>();
  const [uploadSubpath, setUploadSubpath] = createSignal("");
  const [objectFilter, setObjectFilter] = createSignal("");
  const filteredFolders = createMemo(() => {
    const q = objectFilter().trim().toLowerCase();
    return q ? folders().filter((f) => f.toLowerCase().includes(q)) : folders();
  });
  const filteredObjects = createMemo(() => {
    const q = objectFilter().trim().toLowerCase();
    return q ? objects().filter((o) => o.name.toLowerCase().includes(q)) : objects();
  });

  createEffect(
    on(
      () => [bucket(), prefix()] as const,
      () => void list.load(),
    ),
  );
  const link = (folder: string) => storageHref(folder, bucket());
  const [dragging, setDragging] = createSignal(false);
  // One batch at a time, one file at a time, into the bucket and prefix shown when the batch was
  // added. A batch added while another runs waits for it. The first failure stops its batch and
  // names the file; what was stored before it stays, and the queued batches still run.
  let stored: string[] = [];
  const uploads = createUploadQueue<{ bucket: string; prefix: string; files: File[] }>({
    onStart: () => {
      stored = [];
      setError(null);
      setNotice(null);
    },
    run: async ({ bucket: targetBucket, prefix: targetPrefix, files }) => {
      const before = stored.length;
      for (const file of files) {
        const result = await uploadObject(targetBucket, `${targetPrefix}${file.name}`, file);
        if (result.isErr()) {
          setError(t("storage.uploadFailed", { name: file.name, message: result.error.message }));
          break;
        }
        stored.push(result.value.name);
      }
      if (stored.length > before) {
        setNotice(`${t("storage.upload")}: ${stored.join(", ")}`);
        void list.refresh();
      }
    },
  });
  const uploadFiles = (files: File[]): void => {
    if (files.length === 0) return;
    const extra = uploadSubpath()
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)
      .join("/");
    const targetPrefix = extra ? `${prefix()}${extra}/` : prefix();
    const job = { bucket: bucket(), prefix: targetPrefix, files };
    if (uploads.add(job) === "queued") {
      const count = files.length;
      setNotice(t(count === 1 ? "storage.uploadQueuedOne" : "storage.uploadQueued", { count }));
    }
  };
  const upload = () => {
    const input = fileInput();
    uploadFiles([...(input?.files ?? [])]);
    if (input) input.value = "";
  };
  const onDragOver = (event: DragEvent) => {
    if (!dragHasFiles(event.dataTransfer?.types)) return;
    // Accepting the drag is what makes the browser deliver the drop here.
    event.preventDefault();
    setDragging(true);
  };
  const onDrop = (event: DragEvent) => {
    setDragging(false);
    if (!dragHasFiles(event.dataTransfer?.types)) return;
    // Without this the browser would navigate away to show the dropped file.
    event.preventDefault();
    uploadFiles([...(event.dataTransfer?.files ?? [])]);
  };
  return (
    <div>
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <h1 class="page-title">{t("storage.title")}</h1>
        <label class="flex items-center gap-1 text-sm">
          <span class="label">{t("storage.bucket")}</span>
          <select
            class="input mono w-72"
            data-testid="bucket-select"
            value={bucket()}
            onChange={(e) => {
              setSearch({ bucket: e.currentTarget.value });
              navigate(storageHref("", e.currentTarget.value));
            }}
          >
            <For each={bucketList()}>{(b) => <option value={b.name}>{b.name}</option>}</For>
          </select>
        </label>
        <ErrorBanner message={errorOf(buckets())} />
        <span class="badge badge-accent" title={t("app.adminHint")}>
          {t("app.admin")}
        </span>
      </div>
      <nav class="mono mb-3 flex flex-wrap items-center gap-1" aria-label={t("storage.path")}>
        <A href={storageHref("", bucket())} class="link">
          {bucket()}
        </A>
        <For each={prefix().split("/").filter(Boolean)}>
          {(s, i) => (
            <>
              <span class="text-muted">/</span>
              <A
                href={link(
                  prefix()
                    .split("/")
                    .filter(Boolean)
                    .slice(0, i() + 1)
                    .join("/"),
                )}
                class="link"
              >
                {s}
              </A>
            </>
          )}
        </For>
      </nav>
      <div
        class="card transition-shadow"
        classList={{ "ring-2 ring-selection-indicator": dragging() }}
        data-testid="upload-dropzone"
        data-dragging={dragging() ? "true" : undefined}
        onDragOver={onDragOver}
        onDragLeave={(event) => {
          // Moving between children fires dragleave too; only leaving the card ends the drag.
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            setDragging(false);
          }
        }}
        onDrop={onDrop}
      >
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-base font-semibold">{t("storage.objects")}</h2>
          <div class="flex flex-wrap items-center gap-2">
            <input
              class="input mono w-44"
              data-testid="upload-subpath"
              placeholder={t("storage.uploadSubpath")}
              aria-label={t("storage.uploadSubpath")}
              value={uploadSubpath()}
              onInput={(e) => setUploadSubpath(e.currentTarget.value)}
            />
            <input
              ref={setFileInput}
              type="file"
              multiple
              class="file-input"
              data-testid="upload-input"
              aria-label={t("storage.upload")}
            />
            <button
              type="button"
              class="btn btn-primary"
              disabled={uploads.pending()}
              aria-busy={uploads.pending()}
              data-testid="upload-button"
              onClick={upload}
            >
              {uploads.pending() ? t("storage.uploading") : t("storage.upload")}
            </button>
          </div>
        </div>
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs text-secondary">
            {t("storage.uploadPrefix")}. {t("storage.dropHint")}
          </p>
          <input
            class="input w-64 max-w-full"
            data-testid="storage-filter"
            placeholder={t("storage.filterObjects")}
            aria-label={t("storage.filterObjects")}
            value={objectFilter()}
            onInput={(e) => setObjectFilter(e.currentTarget.value)}
          />
        </div>
        <ErrorBanner message={error()} />
        <Notice message={notice()} />
        <Show when={selected()}>
          {(name) => (
            <ObjectDetail
              bucket={bucket()}
              name={name()}
              onClose={() => setSelected(null)}
              onDeleted={() => {
                setSelected(null);
                void list.refresh();
              }}
            />
          )}
        </Show>
        <FetchState
          loading={list.loading()}
          error={list.error()}
          stale={list.stale()}
          onRetry={list.refresh}
          empty={list.items().length === 0}
          emptyMessage={t("storage.noObjects")}
        >
          <table class="table" data-testid="object-table">
            <thead>
              <tr>
                <th>{t("storage.name")}</th>
                <th>{t("storage.size")}</th>
                <th>{t("storage.contentType")}</th>
                <th>{t("storage.updated")}</th>
              </tr>
            </thead>
            <tbody>
              <For each={filteredFolders()}>
                {(f) => (
                  <tr>
                    <td class="mono">
                      <A href={link(f)} class="link">
                        {f.slice(prefix().length)}
                      </A>
                    </td>
                    <td class="text-xs text-muted">{t("storage.folder")}</td>
                    <td />
                    <td />
                  </tr>
                )}
              </For>
              <For each={filteredObjects()}>
                {(o) => (
                  <tr data-testid={`object-row-${o.name}`}>
                    <td class="mono">
                      <button type="button" class="link" onClick={() => setSelected(o.name)}>
                        {o.name.slice(prefix().length)}
                      </button>
                    </td>
                    <td>{formatSize(o.size)}</td>
                    <td class="mono text-xs">{o.contentType}</td>
                    <td class="mono text-xs whitespace-nowrap">
                      {o.updated}
                      <RelativeTime value={o.updated} />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={list.nextToken()}>
            <AsyncButton class="btn mt-2" onClick={list.more}>
              {t("storage.more")}
            </AsyncButton>
          </Show>
        </FetchState>
      </div>
    </div>
  );
};

export default Storage;
