import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { okAsync, ResultAsync } from "neverthrow";
import { ClockPanel, FaultPlanPanel } from "./Runtime";
import { appState } from "../state";
import { waitFor } from "@solidjs/testing-library";
import * as control from "../api/control";

vi.mock("../api/control", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/control")>()),
  getFaultPlan: vi.fn(),
  freezeClock: vi.fn(),
  resumeClock: vi.fn(),
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
