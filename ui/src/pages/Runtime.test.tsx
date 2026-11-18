import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { okAsync } from "neverthrow";
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
    expect(ui.getByTestId("toggle-clock-mode").textContent).toContain("Resume");
    fireEvent.click(ui.getByTestId("toggle-clock-mode"));
    await waitFor(() =>
      expect(ui.getByTestId("runtime-clock-mode").textContent).toContain("Running"),
    );
    expect(control.resumeClock).toHaveBeenLastCalledWith("default", false, false);
    fireEvent.click(ui.getByTestId("sync-clock"));
    await waitFor(() => expect(appState.clock()).toBe("2026-11-18T00:00:00Z"));
    expect(control.resumeClock).toHaveBeenLastCalledWith("default", true, false);
  });
});
