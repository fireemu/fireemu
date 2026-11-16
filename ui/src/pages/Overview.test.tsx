import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor, fireEvent } from "@solidjs/testing-library";
import { errAsync, okAsync } from "neverthrow";
import Overview from "./Overview";
import { appState } from "../state";
import * as control from "../api/control";

vi.mock("../api/control", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/control")>()),
  getRules: vi.fn(),
  sessionResources: vi.fn(),
  functionsStatus: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(control.getRules).mockImplementation(() => okAsync({ loaded: true, source: "" }));
  vi.mocked(control.sessionResources).mockImplementation(() =>
    errAsync({ status: 503, message: "unavailable" }),
  );
  vi.mocked(control.functionsStatus).mockImplementation(() =>
    errAsync({ status: 503, message: "unavailable" }),
  );
  appState.setSessions([{ name: "default", project: "demo-a" }]);
  appState.setSession("default");
});
afterEach(cleanup);

describe("Overview", () => {
  it("lists the Host names the emulators answer: the built-in names, the configured ones and the flag", async () => {
    appState.setConfig({
      ...appState.config(),
      clockMode: "realtime",
      hosts: {
        allowed: ["ci.example", ".svc.cluster.local"],
        allowNonLoopbackHosts: true,
        defaultNames: ["localhost"],
        defaultSuffixes: [".localhost", ".internal"],
      },
    });
    const view = render(() => <Overview />);
    await waitFor(() => expect(view.getAllByText("Loaded").length).toBeGreaterThan(0));
    const hosts = view.getByTestId("host-names").textContent ?? "";
    for (const name of [
      "ci.example",
      ".svc.cluster.local",
      "localhost",
      ".localhost",
      ".internal",
    ]) {
      expect(hosts, name).toContain(name);
    }
    expect(hosts).toContain("IP address");
    expect(view.getByTestId("host-names-single-label").textContent).toBe("yes");
    expect(view.queryByTestId("host-names-open")).toBeNull();
  });

  it("warns when every Host is answered and says so when nothing was added", async () => {
    appState.setConfig({
      ...appState.config(),
      hosts: {
        allowed: ["*"],
        allowNonLoopbackHosts: false,
        defaultNames: ["localhost"],
        defaultSuffixes: [],
      },
    });
    const open = render(() => <Overview />);
    await waitFor(() => expect(open.getAllByText("Loaded").length).toBeGreaterThan(0));
    expect(open.getByTestId("host-names-open")).toBeTruthy();
    expect(open.getByTestId("host-names-single-label").textContent).toBe("no");
    cleanup();
    appState.setConfig({
      ...appState.config(),
      hosts: {
        allowed: [],
        allowNonLoopbackHosts: false,
        defaultNames: ["localhost"],
        defaultSuffixes: [],
      },
    });
    const none = render(() => <Overview />);
    await waitFor(() => expect(none.getAllByText("Loaded").length).toBeGreaterThan(0));
    expect(none.queryByTestId("host-names-open")).toBeNull();
    expect(none.getByTestId("host-names-none").textContent).toContain("none");
  });

  it("says whether the virtual clock stands still or follows real time", async () => {
    appState.setConfig({ ...appState.config(), clockMode: "frozen" });
    const frozen = render(() => <Overview />);
    await waitFor(() => expect(frozen.getAllByText("Loaded").length).toBeGreaterThan(0));
    expect(frozen.getByTestId("overview-clock-mode").textContent).toContain("frozen");
    cleanup();
    appState.setConfig({ ...appState.config(), clockMode: "realtime" });
    const live = render(() => <Overview />);
    await waitFor(() => expect(live.getAllByText("Loaded").length).toBeGreaterThan(0));
    expect(live.getByTestId("overview-clock-mode").textContent).toContain("real time");
  });

  it("shows the project, the services, the rules, the sessions and the SDK environment", async () => {
    const view = render(() => <Overview />);
    await waitFor(() => expect(view.getAllByText("Loaded").length).toBeGreaterThan(0));
    for (const heading of [
      "Project",
      "Services",
      "Security Rules",
      "Sessions",
      "Environment for SDKs",
    ]) {
      expect(view.getAllByText(heading).length, heading).toBeGreaterThan(0);
    }
    expect(view.getByTestId("env-dotenv").textContent).toContain("GOOGLE_CLOUD_PROJECT=demo-a");
    // One snippet format is shown at a time; the tabs switch it.
    expect(view.queryByTestId("env-shell")).toBeNull();
    fireEvent.click(view.getByTestId("env-shell-tab"));
    expect(view.getByTestId("env-shell").textContent).toContain(
      "export GOOGLE_CLOUD_PROJECT=demo-a",
    );
    expect(view.queryByTestId("env-dotenv")).toBeNull();
    fireEvent.click(view.getByTestId("env-web-tab"));
    expect(view.getByTestId("env-web").textContent).toContain('projectId: "demo-a"');
    fireEvent.click(view.getByTestId("env-admin-tab"));
    expect(view.getByTestId("env-admin").textContent).toContain(
      'initializeApp({ projectId: "demo-a" })',
    );
    expect(view.getByTestId("env-admin-tab").getAttribute("aria-selected")).toBe("true");
    expect(view.getByTestId("env-web-tab").getAttribute("aria-selected")).toBe("false");
  });

  it("moves between snippet formats with the arrow keys, wrapping at both ends", async () => {
    const view = render(() => <Overview />);
    const tab = (id: string) => view.getByTestId(`${id}-tab`);
    tab("env-dotenv").focus();
    fireEvent.keyDown(tab("env-dotenv"), { key: "ArrowLeft" });
    expect(tab("env-admin").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("env-admin"));
    expect(tab("env-admin").tabIndex).toBe(0);
    expect(tab("env-dotenv").tabIndex).toBe(-1);
    fireEvent.keyDown(tab("env-admin"), { key: "ArrowRight" });
    expect(tab("env-dotenv").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("env-dotenv"), { key: "ArrowRight" });
    expect(tab("env-shell").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("env-shell"), { key: "Enter" });
    expect(tab("env-shell").getAttribute("aria-selected")).toBe("true");
  });

  it("shows what each product holds, linking to its page, and a dash for what is unknown", async () => {
    appState.setConfig({ ...appState.config(), functionsConfigured: true });
    vi.mocked(control.sessionResources).mockImplementation(() =>
      okAsync({
        schemaVersion: 1,
        session: "default",
        project: "demo-a",
        complete: true,
        rootBudget: 100,
        errors: [],
        services: [
          {
            service: "firestore",
            refusals: [],
            roots: {
              total: 1,
              truncated: false,
              items: [
                {
                  kind: "database",
                  id: "demo-a/(default)",
                  count: 6,
                  bytes: 9,
                  outstanding: false,
                },
              ],
            },
            gauges: [
              {
                id: "history.live_document_bytes",
                measure: "logical",
                unit: "bytes",
                current: 2048,
                limit: null,
                reclaimable: 0,
              },
            ],
          },
          {
            service: "auth",
            refusals: [],
            roots: { total: 0, truncated: false, items: [] },
            gauges: [
              {
                id: "users.count",
                measure: "logical",
                unit: "count",
                current: 0,
                limit: null,
                reclaimable: 0,
              },
            ],
          },
        ],
      }),
    );
    vi.mocked(control.functionsStatus).mockImplementation(() =>
      okAsync({
        pending: 0,
        running: 2,
        retryWaiting: 0,
        succeeded: 0,
        deadLettered: 0,
        catchUpPending: false,
        overlapRejected: 0,
        runnerAlive: true,
        epoch: 1,
        functions: ["a", "b", "c"],
      }),
    );
    const view = render(() => <Overview />);
    await waitFor(() =>
      expect(view.getByTestId("stat-firestore-value").textContent).toBe("2.00 KiB"),
    );
    expect(view.getByTestId("stat-firestore").textContent).toContain("1 database");
    expect(view.getByTestId("stat-firestore").getAttribute("href")).toBe("/ui/firestore");
    // A real zero is a zero; a figure the report lacks is a dash.
    expect(view.getByTestId("stat-auth-value").textContent).toBe("0");
    expect(view.getByTestId("stat-storage-value").textContent).toBe("—");
    expect(view.getByTestId("stat-storage").textContent).toContain("objects, —");
    await waitFor(() => expect(view.getByTestId("stat-functions-value").textContent).toBe("3"));
    expect(view.getByTestId("stat-functions").textContent).toContain("2 running");
    expect(view.getByTestId("stat-functions").getAttribute("href")).toBe("/ui/functions");
  });

  it("says Functions is not configured instead of counting, and shows dashes when the report fails", async () => {
    appState.setConfig({ ...appState.config(), functionsConfigured: false });
    vi.mocked(control.sessionResources).mockImplementation(() =>
      errAsync({ status: 503, message: "unavailable" }),
    );
    const view = render(() => <Overview />);
    await waitFor(() => expect(control.sessionResources).toHaveBeenCalled());
    expect(view.getByTestId("stat-functions-value").textContent).toBe("—");
    expect(view.getByTestId("stat-functions").textContent).toContain("not configured");
    for (const id of ["firestore", "auth", "storage"]) {
      expect(view.getByTestId(`stat-${id}-value`).textContent).toBe("—");
    }
  });

  it("offers a copy button for every service address", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    appState.setConfig({ ...appState.config(), firestoreAddr: "127.0.0.1:8080" });
    const view = render(() => <Overview />);
    const button = view.getByLabelText("Copy Firestore (gRPC + REST)");
    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toBe("Copied"));
    expect(writeText).toHaveBeenCalledWith("127.0.0.1:8080");
  });

  it("a refused clipboard never claims a copy", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const view = render(() => <Overview />);
    const button = view.getByLabelText("Copy Firestore (gRPC + REST)");
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await Promise.resolve();
    expect(button.textContent).toBe("Copy");
  });

  it("carries no product scope table and no compatibility or scope label", async () => {
    const view = render(() => <Overview />);
    await waitFor(() => expect(view.getAllByText("Loaded").length).toBeGreaterThan(0));
    expect(view.queryByTestId("product-scope")).toBeNull();
    expect(view.container.querySelectorAll("[data-testid^='scope-']").length).toBe(0);
    expect(view.container.querySelectorAll("[data-status]").length).toBe(0);
    const text = view.container.textContent ?? "";
    for (const word of [
      "Product scope",
      "supported",
      "deferred",
      "not planned",
      "Realtime Database",
      "Extensions",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });
});

for (const accepted of [true, false])
  it(`reports clipboard success truthfully: ${accepted}`, async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: accepted
          ? vi.fn().mockResolvedValue(undefined)
          : vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    const view = render(() => <Overview />);
    fireEvent.click(view.getByTestId("env-dotenv-copy"));
    await waitFor(() =>
      expect(view.getByTestId("env-dotenv-copy-status").textContent).toContain(
        accepted ? "Copied" : "Copy manually",
      ),
    );
    if (!accepted) expect(view.getByTestId("env-dotenv-copy").textContent).not.toBe("Copied");
  });

it("offers keyboard-selectable manual text when clipboard and selection APIs are unavailable", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  const selection = vi.spyOn(window, "getSelection").mockReturnValue(null);
  const view = render(() => <Overview />);
  fireEvent.click(view.getByTestId("env-dotenv-copy"));
  const field = await view.findByRole("textbox");
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect((field as HTMLTextAreaElement).selectionEnd).toBe(
    (field as HTMLTextAreaElement).value.length,
  );
  selection.mockRestore();
});
