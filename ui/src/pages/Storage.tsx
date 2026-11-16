import { A, useNavigate, useParams, useSearchParams } from "@solidjs/router";
import {
  createEffect,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type Component,
} from "solid-js";
import { dragHasFiles, previewKind } from "../lib/storagePreview";
import { createSubmitGuard } from "../lib/submitGuard";
import { t } from "../i18n";
import { appState } from "../state";
import {
  AsyncButton,
  ConfirmButton,
  ErrorBanner,
  FetchState,
  Field,
  Notice,
  RelativeTime,
  Spinner,
} from "../components/common";
import { decodeSplat, storageHref } from "../lib/hrefs";
import { createPagedList } from "../lib/pagedList";
import {
  deleteObject,
  downloadObject,
  getObject,
  listBuckets,
  listObjects,
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
  let imageUrl: string | null = null;
  const release = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
  };
  onCleanup(release);
  const [content] = createResource(
    () =>
      kind() === "none"
        ? null
        : ([props.bucket, props.object.name, props.object.generation, kind()] as const),
    async ([bucket, name, , wanted]) => {
      const result = await downloadObject(bucket, name);
      release();
      if (result.isErr()) return { error: result.error.message, text: null, url: null };
      if (wanted === "text") {
        return { error: null, text: await result.value.blob.text(), url: null };
      }
      imageUrl = URL.createObjectURL(result.value.blob);
      return { error: null, text: null, url: imageUrl };
    },
  );
  return (
    <div data-testid="object-preview">
      <div class="label mb-1">{t("storage.preview")}</div>
      <Show when={kind() !== "none"} fallback={<p class="hint">{t("storage.previewNone")}</p>}>
        <Show when={content()} fallback={<Spinner />}>
          {(loaded) => (
            <>
              <ErrorBanner message={loaded().error} />
              <Show when={loaded().text !== null}>
                <pre
                  class="mono max-h-96 overflow-auto rounded-md bg-zinc-100 p-3 text-xs break-all whitespace-pre-wrap dark:bg-zinc-800"
                  data-testid="object-preview-text"
                >
                  {loaded().text}
                </pre>
              </Show>
              <Show when={loaded().url}>
                {(url) => (
                  <img
                    class="max-h-96 max-w-full rounded-md border border-zinc-200 bg-zinc-100 object-contain dark:border-zinc-700 dark:bg-zinc-800"
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
  const [meta] = createResource(
    () => [props.bucket, props.name] as const,
    ([b, n]) => settle(getObject(b, n)),
  );
  const [error, setError] = createSignal<string | null>(null);
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
  const m = () => meta()?.unwrapOr(null) ?? null;
  return (
    <div class="card mb-4" data-testid="object-detail">
      <div class="mb-2 flex items-center justify-between gap-2">
        <h3 class="mono font-semibold break-all">{props.name}</h3>
        <div class="flex gap-2">
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
              <Field label={t("storage.customMetadata")} mono>
                {JSON.stringify(o().metadata ?? {}, null, 2)}
              </Field>
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

  createEffect(
    on(
      () => [bucket(), prefix()] as const,
      () => void list.load(),
    ),
  );
  const link = (folder: string) => storageHref(folder, bucket());
  const uploadGuard = createSubmitGuard();
  const [dragging, setDragging] = createSignal(false);
  // One batch at a time, one file at a time, into the bucket and prefix shown when it began.
  // The first failure stops the batch and names the file; what was stored before it stays.
  const uploadFiles = (files: File[]): Promise<void | undefined> =>
    uploadGuard.run(async () => {
      if (files.length === 0) return;
      const targetBucket = bucket();
      const targetPrefix = prefix();
      setError(null);
      setNotice(null);
      const stored: string[] = [];
      for (const file of files) {
        const result = await uploadObject(targetBucket, `${targetPrefix}${file.name}`, file);
        if (result.isErr()) {
          setError(t("storage.uploadFailed", { name: file.name, message: result.error.message }));
          break;
        }
        stored.push(result.value.name);
      }
      if (stored.length > 0) {
        setNotice(`${t("storage.upload")}: ${stored.join(", ")}`);
        void list.refresh();
      }
    });
  const upload = async () => {
    const input = fileInput();
    await uploadFiles([...(input?.files ?? [])]);
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
    void uploadFiles([...(event.dataTransfer?.files ?? [])]);
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
        <span
          class="badge bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100"
          title={t("app.adminHint")}
        >
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
              <span class="text-zinc-400">/</span>
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
        classList={{ "ring-2 ring-amber-500": dragging() }}
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
          <div class="flex items-center gap-2">
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
              disabled={uploadGuard.pending()}
              aria-busy={uploadGuard.pending()}
              data-testid="upload-button"
              onClick={() => void upload()}
            >
              {uploadGuard.pending() ? t("storage.uploading") : t("storage.upload")}
            </button>
          </div>
        </div>
        <p class="mb-2 text-xs text-zinc-600 dark:text-zinc-400">
          {t("storage.uploadPrefix")} {t("storage.dropHint")}
        </p>
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
              <For each={folders()}>
                {(f) => (
                  <tr>
                    <td class="mono">
                      <A href={link(f)} class="link">
                        {f.slice(prefix().length)}
                      </A>
                    </td>
                    <td class="text-xs text-zinc-500">{t("storage.folder")}</td>
                    <td />
                    <td />
                  </tr>
                )}
              </For>
              <For each={objects()}>
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
