import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { routed } from "../test/router";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import Storage from "./Storage";
import { appState } from "../state";
import * as storage from "../api/storage";
import type { ApiError } from "../api/client";

vi.mock("../api/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/storage")>()),
  listBuckets: vi.fn(),
  listObjects: vi.fn(),
  getObject: vi.fn(),
  uploadObject: vi.fn(),
  downloadObject: vi.fn(),
}));

const info = (name: string, contentType = "text/plain", size = "5"): storage.ObjectInfo => ({
  name,
  bucket: "demo-a.appspot.com",
  size,
  contentType,
  generation: "1",
  metageneration: "1",
  timeCreated: "2026-08-29T12:00:00Z",
  updated: "2026-08-29T12:00:00Z",
});

const file = (name: string, body = "x") => new File([body], name, { type: "text/plain" });
const drop = (files: File[], types: string[] = ["Files"]) => ({ dataTransfer: { files, types } });

// jsdom's drag events drop `relatedTarget` from the init, so it is set on the event itself.
const leave = (zone: HTMLElement, to: Element) => {
  const event = createEvent.dragLeave(zone);
  Object.defineProperty(event, "relatedTarget", { value: to });
  fireEvent(zone, event);
};

const createObjectURL = vi.fn(() => "blob:preview");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  window.history.replaceState(null, "", "/storage/docs?bucket=demo-a.appspot.com");
  appState.setSessions([{ name: "default", project: "demo-a" }]);
  appState.setSession("default");
  vi.mocked(storage.listBuckets).mockImplementation(() =>
    okAsync({ buckets: [{ name: "demo-a.appspot.com", project: "demo-a", default: true }] }),
  );
  vi.mocked(storage.listObjects).mockImplementation(() => okAsync({ items: [], prefixes: [] }));
  vi.mocked(storage.uploadObject).mockImplementation((_bucket, name) => okAsync(info(name)));
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mount = () => render(routed([{ path: "/storage/*path", component: Storage }]));

it("uploads dropped files under the current prefix, in order, and lists them again", async () => {
  const ui = mount();
  const zone = await ui.findByTestId("upload-dropzone");
  await waitFor(() => expect(storage.listObjects).toHaveBeenCalledTimes(1));
  const event = fireEvent.drop(zone, drop([file("a.txt"), file("b.txt")]));
  // The default (navigating to the dropped file) is cancelled.
  expect(event).toBe(false);
  await waitFor(() => expect(storage.uploadObject).toHaveBeenCalledTimes(2));
  expect(vi.mocked(storage.uploadObject).mock.calls.map((call) => [call[0], call[1]])).toEqual([
    ["demo-a.appspot.com", "docs/a.txt"],
    ["demo-a.appspot.com", "docs/b.txt"],
  ]);
  await waitFor(() =>
    expect(ui.getByRole("status").textContent).toBe("Upload file: docs/a.txt, docs/b.txt"),
  );
  await waitFor(() => expect(storage.listObjects).toHaveBeenCalledTimes(2));
});

it("sends one file at a time and queues a drop made while a batch is running", async () => {
  const pending: ((value: storage.ObjectInfo) => void)[] = [];
  vi.mocked(storage.uploadObject).mockImplementation(() =>
    ResultAsync.fromSafePromise(
      new Promise<storage.ObjectInfo>((resolve) => {
        pending.push(resolve);
      }),
    ),
  );
  const ui = mount();
  const zone = await ui.findByTestId("upload-dropzone");
  fireEvent.drop(zone, drop([file("a.txt"), file("b.txt")]));
  await waitFor(() => expect(pending).toHaveLength(1));
  const button = ui.getByTestId("upload-button") as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe("Uploading");
  // A drop while busy cancels the browser's default and is queued, with a visible notice.
  expect(fireEvent.drop(zone, drop([file("c.txt")]))).toBe(false);
  await Promise.resolve();
  expect(storage.uploadObject).toHaveBeenCalledTimes(1);
  expect(ui.getAllByRole("status").map((e) => e.textContent)).toContain(
    "Upload in progress: 1 more file will be uploaded after it.",
  );
  pending[0]!(info("docs/a.txt"));
  await waitFor(() => expect(pending).toHaveLength(2));
  pending[1]!(info("docs/b.txt"));
  await waitFor(() => expect(pending).toHaveLength(3));
  pending[2]!(info("docs/c.txt"));
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(button.textContent).toBe("Upload file");
  expect(vi.mocked(storage.uploadObject).mock.calls.map((call) => call[1])).toEqual([
    "docs/a.txt",
    "docs/b.txt",
    "docs/c.txt",
  ]);
  await waitFor(() =>
    expect(ui.getByRole("status").textContent).toBe(
      "Upload file: docs/a.txt, docs/b.txt, docs/c.txt",
    ),
  );
});

it("a queued drop goes to the bucket and prefix shown when it was dropped", async () => {
  const pending: ((value: storage.ObjectInfo) => void)[] = [];
  vi.mocked(storage.uploadObject).mockImplementation(() =>
    ResultAsync.fromSafePromise(
      new Promise<storage.ObjectInfo>((resolve) => {
        pending.push(resolve);
      }),
    ),
  );
  const ui = mount();
  const zone = await ui.findByTestId("upload-dropzone");
  fireEvent.drop(zone, drop([file("a.txt")]));
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.drop(zone, drop([file("b.txt"), file("c.txt")]));
  expect(ui.getAllByRole("status").map((e) => e.textContent)).toContain(
    "Upload in progress: 2 more files will be uploaded after it.",
  );
  pending[0]!(info("docs/a.txt"));
  await waitFor(() => expect(pending).toHaveLength(2));
  pending[1]!(info("docs/b.txt"));
  await waitFor(() => expect(pending).toHaveLength(3));
  pending[2]!(info("docs/c.txt"));
  await waitFor(() => expect(storage.listObjects).toHaveBeenCalledTimes(2));
  expect(vi.mocked(storage.uploadObject).mock.calls.map((call) => [call[0], call[1]])).toEqual([
    ["demo-a.appspot.com", "docs/a.txt"],
    ["demo-a.appspot.com", "docs/b.txt"],
    ["demo-a.appspot.com", "docs/c.txt"],
  ]);
});

it("a failure in the first batch keeps its message and still uploads the queued batch", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(storage.uploadObject).mockImplementation((_bucket, name) =>
    name === "docs/a.txt"
      ? ResultAsync.fromSafePromise(gate).andThen(() =>
          errAsync<storage.ObjectInfo, ApiError>({ status: 500, message: "boom" }),
        )
      : okAsync(info(name)),
  );
  const ui = mount();
  const zone = await ui.findByTestId("upload-dropzone");
  fireEvent.drop(zone, drop([file("a.txt")]));
  await waitFor(() => expect(storage.uploadObject).toHaveBeenCalledTimes(1));
  fireEvent.drop(zone, drop([file("b.txt")]));
  release();
  await waitFor(() => expect(storage.uploadObject).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(ui.getByRole("status").textContent).toBe("Upload file: docs/b.txt"));
  expect(ui.getByRole("alert").textContent).toBe("Could not upload a.txt: boom");
});

it("stops at the first failure, names the file and keeps what was stored before it", async () => {
  vi.mocked(storage.uploadObject).mockImplementation((_bucket, name) =>
    name.endsWith("b.txt")
      ? errAsync<storage.ObjectInfo, ApiError>({ status: 413, message: "too large" })
      : okAsync(info(name)),
  );
  const ui = mount();
  const zone = await ui.findByTestId("upload-dropzone");
  fireEvent.drop(zone, drop([file("a.txt"), file("b.txt"), file("c.txt")]));
  await waitFor(() =>
    expect(ui.getByRole("alert").textContent).toBe("Could not upload b.txt: too large"),
  );
  expect(storage.uploadObject).toHaveBeenCalledTimes(2);
  expect(ui.getByRole("status").textContent).toBe("Upload file: docs/a.txt");
});

it("a failure of the first file stores nothing and does not refresh the list", async () => {
  vi.mocked(storage.uploadObject).mockImplementation(() =>
    errAsync<storage.ObjectInfo, ApiError>({ status: 500, message: "boom" }),
  );
  const ui = mount();
  const zone = await ui.findByTestId("upload-dropzone");
  await waitFor(() => expect(storage.listObjects).toHaveBeenCalledTimes(1));
  fireEvent.drop(zone, drop([file("a.txt")]));
  await waitFor(() => expect(ui.getByRole("alert").textContent).toContain("a.txt: boom"));
  expect(ui.queryByRole("status")).toBeNull();
  expect(storage.listObjects).toHaveBeenCalledTimes(1);
});

it("does not accept a drag that carries no files", async () => {
  const ui = mount();
  const zone = await ui.findByTestId("upload-dropzone");
  const text = drop([], ["text/plain"]);
  expect(fireEvent.dragOver(zone, text)).toBe(true);
  expect(zone.dataset.dragging).toBeUndefined();
  expect(fireEvent.drop(zone, text)).toBe(true);
  // A file drag whose list is empty (a folder on some browsers) uploads nothing.
  fireEvent.drop(zone, drop([]));
  await Promise.resolve();
  expect(storage.uploadObject).not.toHaveBeenCalled();
  expect(ui.queryByRole("alert")).toBeNull();
});

it("marks the card while files are dragged over it and clears the mark on leave or drop", async () => {
  const ui = mount();
  const zone = await ui.findByTestId("upload-dropzone");
  expect(fireEvent.dragOver(zone, drop([file("a.txt")]))).toBe(false);
  expect(zone.dataset.dragging).toBe("true");
  // Moving onto a child of the card is not leaving it.
  leave(zone, ui.getByTestId("upload-button"));
  expect(zone.dataset.dragging).toBe("true");
  leave(zone, document.body);
  expect(zone.dataset.dragging).toBeUndefined();
  fireEvent.dragOver(zone, drop([file("a.txt")]));
  fireEvent.dragLeave(zone, {});
  expect(zone.dataset.dragging).toBeUndefined();
  fireEvent.dragOver(zone, drop([file("a.txt")]));
  fireEvent.drop(zone, drop([file("a.txt")]));
  expect(zone.dataset.dragging).toBeUndefined();
});

it("the file picker uploads every selected file and is cleared afterwards", async () => {
  const ui = mount();
  const input = (await ui.findByTestId("upload-input")) as HTMLInputElement;
  expect(input.multiple).toBe(true);
  Object.defineProperty(input, "files", {
    value: [file("one.txt"), file("two.txt")],
    configurable: true,
  });
  let cleared = false;
  Object.defineProperty(input, "value", {
    set: (value: string) => {
      cleared = value === "";
    },
    get: () => "",
    configurable: true,
  });
  fireEvent.click(ui.getByTestId("upload-button"));
  await waitFor(() => expect(storage.uploadObject).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(cleared).toBe(true));
  expect(vi.mocked(storage.uploadObject).mock.calls.map((call) => call[1])).toEqual([
    "docs/one.txt",
    "docs/two.txt",
  ]);
});

const openObject = async (object: storage.ObjectInfo) => {
  vi.mocked(storage.listObjects).mockImplementation(() => okAsync({ items: [object] }));
  vi.mocked(storage.getObject).mockImplementation(() => okAsync(object));
  const ui = mount();
  fireEvent.click(await ui.findByRole("button", { name: object.name.split("/").at(-1)! }));
  await ui.findByTestId("object-preview");
  return ui;
};

it("previews text-like content as text, never as markup", async () => {
  const body = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  vi.mocked(storage.downloadObject).mockImplementation(() =>
    okAsync({ blob: new Blob([body], { type: "text/html" }), contentType: "text/html" }),
  );
  const ui = await openObject(info("docs/page.html", "text/html; charset=utf-8", "55"));
  const text = await ui.findByTestId("object-preview-text");
  expect(text.textContent).toBe(body);
  expect(text.querySelector("img, script")).toBeNull();
  expect(ui.queryByTestId("object-preview-image")).toBeNull();
  expect(storage.downloadObject).toHaveBeenCalledWith("demo-a.appspot.com", "docs/page.html");
});

it("previews an image through an object URL and releases it when the detail closes", async () => {
  vi.mocked(storage.downloadObject).mockImplementation(() =>
    okAsync({ blob: new Blob(["png"], { type: "image/png" }), contentType: "image/png" }),
  );
  const ui = await openObject(info("docs/logo.png", "image/png", "3"));
  const image = (await ui.findByTestId("object-preview-image")) as HTMLImageElement;
  expect(image.getAttribute("src")).toBe("blob:preview");
  expect(image.alt).toBe("Preview of docs/logo.png");
  expect(ui.queryByTestId("object-preview-text")).toBeNull();
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  expect(revokeObjectURL).not.toHaveBeenCalled();
  fireEvent.click(ui.getByText("Close"));
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});

it("downloads nothing for a type or size it does not preview, and says why", async () => {
  const ui = await openObject(info("docs/archive.zip", "application/zip", "3"));
  expect(ui.getByTestId("object-preview").textContent).toContain("No inline preview");
  expect(storage.downloadObject).not.toHaveBeenCalled();
  cleanup();
  const large = await openObject(info("docs/big.txt", "text/plain", String(256 * 1024 + 1)));
  expect(large.getByTestId("object-preview").textContent).toContain("No inline preview");
  expect(storage.downloadObject).not.toHaveBeenCalled();
});

it("reports a preview that could not be loaded", async () => {
  vi.mocked(storage.downloadObject).mockImplementation(() =>
    errAsync({ status: 404, message: "gone" }),
  );
  const ui = await openObject(info("docs/note.txt"));
  await waitFor(() =>
    expect(ui.getByTestId("object-preview").querySelector('[role="alert"]')?.textContent).toBe(
      "gone",
    ),
  );
  expect(ui.queryByTestId("object-preview-text")).toBeNull();
  expect(ui.queryByTestId("object-preview-image")).toBeNull();
});

it("does not preview SVG, and downloads nothing for it", async () => {
  const ui = await openObject(info("docs/logo.svg", "image/svg+xml", "40"));
  expect(ui.getByTestId("object-preview").textContent).toContain("No inline preview");
  expect(ui.queryByTestId("object-preview-image")).toBeNull();
  expect(ui.queryByTestId("object-preview-text")).toBeNull();
  expect(storage.downloadObject).not.toHaveBeenCalled();
  expect(createObjectURL).not.toHaveBeenCalled();
});

it("an older preview download that resolves last neither replaces nor revokes the shown image", async () => {
  const a = info("docs/a.png", "image/png", "3");
  const b = info("docs/b.png", "image/png", "3");
  vi.mocked(storage.listObjects).mockImplementation(() => okAsync({ items: [a, b] }));
  vi.mocked(storage.getObject).mockImplementation((_bucket, name) =>
    okAsync(name === a.name ? a : b),
  );
  let releaseA!: () => void;
  const slow = new Promise<void>((resolve) => (releaseA = resolve));
  vi.mocked(storage.downloadObject).mockImplementation((_bucket, name) =>
    name === a.name
      ? ResultAsync.fromSafePromise(slow).map(() => ({
          blob: new Blob(["a"], { type: "image/png" }),
          contentType: "image/png",
        }))
      : okAsync({ blob: new Blob(["b"], { type: "image/png" }), contentType: "image/png" }),
  );
  let n = 0;
  createObjectURL.mockImplementation(() => `blob:${(n += 1)}`);
  const ui = mount();
  fireEvent.click(await ui.findByRole("button", { name: "a.png" }));
  await waitFor(() => expect(storage.downloadObject).toHaveBeenCalledTimes(1));
  fireEvent.click(ui.getByRole("button", { name: "b.png" }));
  const image = (await ui.findByTestId("object-preview-image")) as HTMLImageElement;
  await waitFor(() => expect(image.alt).toBe("Preview of docs/b.png"));
  const shown = image.getAttribute("src");
  releaseA();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ui.getByTestId("object-preview-image").getAttribute("src")).toBe(shown);
  expect(revokeObjectURL).not.toHaveBeenCalledWith(shown);
  // The stale download created no URL that would never be revoked.
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  fireEvent.click(ui.getByText("Close"));
  expect(revokeObjectURL.mock.calls).toEqual([[shown]]);
  createObjectURL.mockImplementation(() => "blob:preview");
});

it("an older text preview that resolves last does not revoke the image shown after it", async () => {
  const note = info("docs/note.txt", "text/plain", "1");
  const pic = info("docs/pic.png", "image/png", "3");
  vi.mocked(storage.listObjects).mockImplementation(() => okAsync({ items: [note, pic] }));
  vi.mocked(storage.getObject).mockImplementation((_bucket, name) =>
    okAsync(name === note.name ? note : pic),
  );
  let releaseText!: () => void;
  const slow = new Promise<void>((resolve) => (releaseText = resolve));
  vi.mocked(storage.downloadObject).mockImplementation((_bucket, name) =>
    name === note.name
      ? ResultAsync.fromSafePromise(slow).map(() => ({
          blob: new Blob(["t"], { type: "text/plain" }),
          contentType: "text/plain",
        }))
      : okAsync({ blob: new Blob(["p"], { type: "image/png" }), contentType: "image/png" }),
  );
  const ui = mount();
  fireEvent.click(await ui.findByRole("button", { name: "note.txt" }));
  await waitFor(() => expect(storage.downloadObject).toHaveBeenCalledTimes(1));
  fireEvent.click(ui.getByRole("button", { name: "pic.png" }));
  await ui.findByTestId("object-preview-image");
  releaseText();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(ui.getByTestId("object-preview-image").getAttribute("src")).toBe("blob:preview");
});

it("a new upload clears the failure message of the previous one", async () => {
  vi.mocked(storage.uploadObject).mockImplementation((_bucket, name) =>
    name === "docs/bad.txt"
      ? errAsync<storage.ObjectInfo, ApiError>({ status: 500, message: "boom" })
      : okAsync(info(name)),
  );
  const ui = mount();
  const zone = await ui.findByTestId("upload-dropzone");
  fireEvent.drop(zone, drop([file("bad.txt")]));
  await waitFor(() =>
    expect(ui.getByRole("alert").textContent).toBe("Could not upload bad.txt: boom"),
  );
  await waitFor(() =>
    expect((ui.getByTestId("upload-button") as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.drop(zone, drop([file("good.txt")]));
  await waitFor(() =>
    expect(ui.getAllByRole("status").map((e) => e.textContent)).toContain(
      "Upload file: docs/good.txt",
    ),
  );
  expect(ui.queryByRole("alert")).toBeNull();
});
