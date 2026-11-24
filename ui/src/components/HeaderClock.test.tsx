import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { okAsync } from "neverthrow";
import * as control from "../api/control";
import { appState } from "../state";
import { HeaderClock } from "./HeaderClock";

vi.mock("../api/control", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/control")>()),
  freezeClock: vi.fn(),
  resumeClock: vi.fn(),
  moveClock: vi.fn(),
}));

beforeEach(() => {
  appState.setSessions([{ name: "default", project: "demo-a" }]);
  appState.setSession("default");
  appState.setConfig({ ...appState.config(), clockMode: "realtime" });
  appState.setClockInfo({ clock: "2026-08-29T12:00:00Z", backwardsSets: 0, running: true });
  vi.mocked(control.freezeClock).mockImplementation(() =>
    okAsync({ clock: "2026-08-29T12:00:00Z", backwardsSets: 0, running: false }),
  );
  vi.mocked(control.moveClock).mockImplementation(() =>
    okAsync({ clock: "2026-08-29T13:00:00Z", backwardsSets: 0, running: false }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderClock = () =>
  render(() => (
    <Router>
      <Route path="*" component={() => <HeaderClock />} />
    </Router>
  ));

describe("HeaderClock", () => {
  it("opens the quick popover on click, freezes the clock and advances +1h", async () => {
    const ui = renderClock();
    expect(ui.queryByTestId("clock-popover")).toBeNull();
    fireEvent.click(ui.getByTestId("header-clock-trigger"));
    expect(ui.getByTestId("clock-popover")).toBeTruthy();

    fireEvent.click(ui.getByTestId("header-clock-toggle-mode"));
    await waitFor(() => expect(control.freezeClock).toHaveBeenCalledWith("default"));
    await waitFor(() => expect(ui.getByTestId("clock-mode").textContent).toBe("Frozen"));

    fireEvent.click(ui.getByTestId("header-clock-plus-1h"));
    await waitFor(() =>
      expect(control.moveClock).toHaveBeenCalledWith("default", {
        action: "advance",
        move: { seconds: 3600 },
      }),
    );
    await waitFor(() => expect(ui.getByTestId("clock").textContent).toBe("2026-08-29T13:00:00Z"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(ui.queryByTestId("clock-popover")).toBeNull();
  });
});
