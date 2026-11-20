import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { okAsync, ResultAsync } from "neverthrow";
import { ClockPanel, FaultPlanPanel, SnapshotsPanel } from "./Runtime";
import { appState } from "../state";
import { waitFor } from "@solidjs/testing-library";
import * as control from "../api/control";

vi.mock("../api/control", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/control")>()),
  getFaultPlan: vi.fn(),
  freezeClock: vi.fn(),
  resumeClock: vi.fn(),
  listSnapshots: vi.fn(),
  restoreSnapshot: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(control.getFaultPlan).mockReturnValue(
    okAsync({ session: "default", plan: null, fired: [], counters: {} }),
  );
});
afterEach(cleanup);

describe("Fault plan recipes", () => {
  it("fills the draft with a retry plan", () => {
    const ui = render(() => <FaultPlanPanel />);
    fireEvent.change(ui.getByTestId("fault-recipe"), { target: { value: "retryEvent" } });
    fireEvent.input(ui.getByTestId("fault-recipe-function"), { target: { value: "worker" } });
    fireEvent.input(ui.getByTestId("fault-recipe-count"), { target: { value: "2" } });
    fireEvent.click(ui.getByTestId("fault-recipe-fill"));
    expect(
      JSON.parse((ui.container.querySelector("#fault-plan") as HTMLTextAreaElement).value),
    ).toEqual({
      seed: 1,
      rules: [1, 2].map((nth) => ({
        match: { operation: "functions.invoke", function: "worker", nth },
        action: { type: "returnError", code: "UNAVAILABLE" },
      })),
    });
  });
  it("shows invalid input without changing the draft", () => {
    const ui = render(() => <FaultPlanPanel />);
    const draft = ui.container.querySelector("#fault-plan") as HTMLTextAreaElement;
    const before = draft.value;
    fireEvent.click(ui.getByTestId("fault-recipe-fill"));
    expect(ui.getByRole("alert").textContent).toContain("function");
    expect(draft.value).toBe(before);
  });
  it("shows snippets only for a parseable plan", () => {
    const ui = render(() => <FaultPlanPanel />);
    const draft = ui.container.querySelector("#fault-plan") as HTMLTextAreaElement;
    expect(ui.getByTestId("fault-snippet-testing")).toBeTruthy();
    expect(ui.getByTestId("fault-snippet-control")).toBeTruthy();
    fireEvent.input(draft, { target: { value: "{" } });
    expect(ui.queryByTestId("fault-snippet-testing")).toBeNull();
    fireEvent.input(draft, { target: { value: '{"seed":1,"rules":[]}' } });
    expect(ui.getByTestId("fault-snippet-control")).toBeTruthy();
  });
});

describe("Clock mode", () => {
  it("shows the mode, freezes and resumes, and syncs to real time", async () => {
    appState.setConfig({ ...appState.config(), clockMode: "realtime" });
    vi.mocked(control.freezeClock).mockReturnValue(
      okAsync({ clock: "2026-01-01T00:00:05Z", backwardsSets: 0, running: false }),
    );
    vi.mocked(control.resumeClock).mockImplementation((_session, sync) =>
      okAsync({
        clock: sync ? "2026-11-18T00:00:00Z" : "2026-01-01T00:00:05Z",
        backwardsSets: 0,
        running: true,
      }),
    );
    const ui = render(() => <ClockPanel />);
    expect(ui.getByTestId("runtime-clock-mode").textContent).toContain("Running");
    fireEvent.click(ui.getByTestId("toggle-clock-mode"));
    await waitFor(() =>
      expect(ui.getByTestId("runtime-clock-mode").textContent).toContain("Frozen"),
    );
    expect(control.freezeClock).toHaveBeenCalledWith("default");
    expect(appState.clock()).toBe("2026-01-01T00:00:05Z");
    await waitFor(() =>
      expect((ui.getByTestId("toggle-clock-mode") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(ui.getByTestId("toggle-clock-mode").textContent).toContain("Resume");
    fireEvent.click(ui.getByTestId("toggle-clock-mode"));
    await waitFor(() =>
      expect(ui.getByTestId("runtime-clock-mode").textContent).toContain("Running"),
    );
    await waitFor(() =>
      expect((ui.getByTestId("toggle-clock-mode") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(control.resumeClock).toHaveBeenLastCalledWith("default", false, false);
    fireEvent.click(ui.getByTestId("sync-clock"));
    await waitFor(() => expect(appState.clock()).toBe("2026-11-18T00:00:00Z"));
    expect(control.resumeClock).toHaveBeenLastCalledWith("default", true, false);
  });
});

describe("Clock controls", () => {
  it("run one at a time", async () => {
    appState.setConfig({ ...appState.config(), clockMode: "realtime" });
    appState.applyClockMutation({ clock: "2026-01-01T00:00:00Z", backwardsSets: 0, running: true });
    let finish!: () => void;
    vi.mocked(control.freezeClock).mockReturnValue(
      ResultAsync.fromSafePromise(
        new Promise<control.ClockInfo>((r) => {
          finish = () => r({ clock: "2026-01-01T00:00:05Z", backwardsSets: 0, running: false });
        }),
      ),
    );
    vi.mocked(control.resumeClock).mockClear();
    const ui = render(() => <ClockPanel />);
    fireEvent.click(ui.getByTestId("toggle-clock-mode"));
    fireEvent.click(ui.getByTestId("sync-clock"));
    expect(control.resumeClock).not.toHaveBeenCalled();
    expect((ui.getByTestId("sync-clock") as HTMLButtonElement).disabled).toBe(true);
    finish();
    await waitFor(() =>
      expect((ui.getByTestId("sync-clock") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(ui.getByTestId("runtime-clock-mode").textContent).toContain("Frozen");
  });
});

describe("Clock controls across navigation", () => {
  it("keep one mutation at a time when the panel is left and opened again", async () => {
    appState.applyClockMutation({ clock: "2026-01-01T00:00:00Z", backwardsSets: 0, running: true });
    let finish!: () => void;
    vi.mocked(control.freezeClock).mockReturnValue(
      ResultAsync.fromSafePromise(
        new Promise<control.ClockInfo>((r) => {
          finish = () => r({ clock: "2026-01-01T00:00:05Z", backwardsSets: 0, running: false });
        }),
      ),
    );
    vi.mocked(control.resumeClock).mockClear();
    const first = render(() => <ClockPanel />);
    fireEvent.click(first.getByTestId("toggle-clock-mode"));
    first.unmount();
    const second = render(() => <ClockPanel />);
    expect((second.getByTestId("sync-clock") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(second.getByTestId("sync-clock"));
    expect(control.resumeClock).not.toHaveBeenCalled();
    finish();
    await waitFor(() =>
      expect((second.getByTestId("sync-clock") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(second.getByTestId("runtime-clock-mode").textContent).toContain("Frozen");
  });
});

describe("Snapshot restore", () => {
  it("is disabled until a clock mutation in flight has answered", async () => {
    appState.applyClockMutation({ clock: "2026-01-01T00:00:00Z", backwardsSets: 0, running: true });
    vi.mocked(control.listSnapshots).mockReturnValue(
      okAsync({ snapshots: [{ name: "seed", clock: "2025-01-01T00:00:00Z", parts: 1 }] }),
    );
    vi.mocked(control.restoreSnapshot).mockReturnValue(okAsync({ restored: true }));
    let finish!: () => void;
    vi.mocked(control.freezeClock).mockReturnValue(
      ResultAsync.fromSafePromise(
        new Promise<control.ClockInfo>((r) => {
          finish = () => r({ clock: "2026-01-01T00:00:05Z", backwardsSets: 0, running: false });
        }),
      ),
    );
    const clock = render(() => <ClockPanel />);
    const snapshots = render(() => <SnapshotsPanel />);
    fireEvent.click(clock.getByTestId("toggle-clock-mode"));
    const restore = (await snapshots.findByTestId("snapshot-restore-seed")) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    fireEvent.click(restore);
    expect(snapshots.queryByTestId("snapshot-restore-seed-confirm")).toBeNull();
    expect(control.restoreSnapshot).not.toHaveBeenCalled();
    finish();
    await waitFor(() =>
      expect((clock.getByTestId("sync-clock") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(snapshots.getByTestId("snapshot-restore-seed"));
    fireEvent.click(snapshots.getByTestId("snapshot-restore-seed-confirm"));
    await waitFor(() => expect(control.restoreSnapshot).toHaveBeenCalledWith("default", "seed"));
  });
  it("keeps an open question but disables its confirmation while a clock mutation is in flight", async () => {
    appState.applyClockMutation({ clock: "2026-01-01T00:00:00Z", backwardsSets: 0, running: true });
    vi.mocked(control.listSnapshots).mockReturnValue(
      okAsync({ snapshots: [{ name: "seed", clock: "2025-01-01T00:00:00Z", parts: 1 }] }),
    );
    vi.mocked(control.restoreSnapshot).mockClear();
    vi.mocked(control.restoreSnapshot).mockReturnValue(okAsync({ restored: true }));
    let finish!: () => void;
    vi.mocked(control.freezeClock).mockReturnValue(
      ResultAsync.fromSafePromise(
        new Promise<control.ClockInfo>((r) => {
          finish = () => r({ clock: "2026-01-01T00:00:05Z", backwardsSets: 0, running: false });
        }),
      ),
    );
    const clock = render(() => <ClockPanel />);
    const snapshots = render(() => <SnapshotsPanel />);
    // The question is open before the freeze starts; it is named by its question.
    fireEvent.click(await snapshots.findByTestId("snapshot-restore-seed"));
    expect(
      snapshots.getByRole("alertdialog", { name: /seed/ }).getAttribute("aria-labelledby"),
    ).toBeTruthy();
    fireEvent.click(clock.getByTestId("toggle-clock-mode"));
    const confirm = snapshots.getByTestId("snapshot-restore-seed-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    await Promise.resolve();
    expect(control.restoreSnapshot).not.toHaveBeenCalled();
    // The question stays open, so the restore is one click away once the freeze answered.
    finish();
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(control.restoreSnapshot).toHaveBeenCalledWith("default", "seed"));
    // With the question closed, the restore button itself is disabled while the guard is busy.
    let finishAgain!: () => void;
    vi.mocked(control.resumeClock).mockReturnValue(
      ResultAsync.fromSafePromise(
        new Promise<control.ClockInfo>((r) => {
          finishAgain = () => r({ clock: "2026-01-01T00:00:05Z", backwardsSets: 0, running: true });
        }),
      ),
    );
    await waitFor(() =>
      expect((clock.getByTestId("toggle-clock-mode") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(clock.getByTestId("toggle-clock-mode"));
    const restore = snapshots.getByTestId("snapshot-restore-seed") as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    // The shared guard is free again for the next test.
    finishAgain();
    await waitFor(() => expect(restore.disabled).toBe(false));
  });
  it("blocks the next clock mutation while its response is open", async () => {
    appState.applyClockMutation({ clock: "2026-01-01T00:00:00Z", backwardsSets: 0, running: true });
    vi.mocked(control.listSnapshots).mockReturnValue(
      okAsync({ snapshots: [{ name: "seed", clock: "2025-01-01T00:00:00Z", parts: 1 }] }),
    );
    let finish!: () => void;
    vi.mocked(control.restoreSnapshot).mockReturnValue(
      ResultAsync.fromSafePromise(
        new Promise<{ restored: boolean }>((r) => {
          finish = () => r({ restored: true });
        }),
      ),
    );
    vi.mocked(control.freezeClock).mockClear();
    vi.mocked(control.resumeClock).mockClear();
    vi.mocked(control.freezeClock).mockReturnValue(
      okAsync({ clock: "2026-01-01T00:00:05Z", backwardsSets: 0, running: false }),
    );
    const clock = render(() => <ClockPanel />);
    const snapshots = render(() => <SnapshotsPanel />);
    fireEvent.click(await snapshots.findByTestId("snapshot-restore-seed"));
    fireEvent.click(snapshots.getByTestId("snapshot-restore-seed-confirm"));
    await waitFor(() => expect(control.restoreSnapshot).toHaveBeenCalledWith("default", "seed"));
    expect((clock.getByTestId("toggle-clock-mode") as HTMLButtonElement).disabled).toBe(true);
    expect((clock.getByTestId("sync-clock") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(clock.getByTestId("toggle-clock-mode"));
    fireEvent.click(clock.getByTestId("sync-clock"));
    await Promise.resolve();
    expect(control.freezeClock).not.toHaveBeenCalled();
    expect(control.resumeClock).not.toHaveBeenCalled();
    finish();
    await waitFor(() =>
      expect((clock.getByTestId("toggle-clock-mode") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(clock.getByTestId("toggle-clock-mode"));
    await waitFor(() => expect(control.freezeClock).toHaveBeenCalledWith("default"));
  });
});
