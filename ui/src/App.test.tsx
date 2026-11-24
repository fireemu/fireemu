import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { Router } from "@solidjs/router";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { App } from "./App";
import { appState } from "./state";
import { routes } from "./routes";
import * as control from "./api/control";

vi.mock("./api/control", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/control")>()),
  sessionInfo: vi.fn(),
  listSessions: vi.fn(),
  getFaultPlan: vi.fn(),
  clearFaultPlan: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(control.sessionInfo).mockImplementation(() =>
    okAsync({
      session: "default",
      edition: "standard",
      requireDemoPrefix: true,
      clock: { clock: "2026-08-29T12:00:00Z", backwardsSets: 0 },
    }),
  );
  vi.mocked(control.listSessions).mockImplementation(() =>
    okAsync({ sessions: [{ name: "default", project: "demo-a" }] }),
  );
  appState.setSessions([{ name: "default", project: "demo-a" }]);
  appState.setSession("default");
});
afterEach(cleanup);

it("links the Hosting page in the products navigation, after Functions", () => {
  const ui = render(() => <Router root={App}>{routes}</Router>);
  const links = [...ui.getByLabelText("Emulator products").querySelectorAll("a")];
  const names = links.map((a) => a.textContent);
  expect(names.indexOf("Hosting")).toBe(names.indexOf("Functions") + 1);
  expect(links[names.indexOf("Hosting")]!.getAttribute("href")).toBe("/hosting");
});

it("says in the header whether the clock is frozen or follows real time", () => {
  appState.setConfig({ ...appState.config(), clockMode: "frozen" });
  const frozen = render(() => <Router root={App}>{routes}</Router>);
  expect(frozen.getByTestId("clock-mode").textContent).toBe("Frozen");
  expect(frozen.getByTestId("clock-mode").title).toContain("stands still until advanced");
  expect(frozen.getByTestId("clock-mode").dataset.tone).toBe("paused");
  cleanup();
  appState.setConfig({ ...appState.config(), clockMode: "realtime" });
  const live = render(() => <Router root={App}>{routes}</Router>);
  expect(live.getByTestId("clock-mode").textContent).toBe("Real time");
  expect(live.getByTestId("clock-mode").title).toContain("wall clock");
  expect(live.getByTestId("clock-mode").dataset.tone).toBe("neutral");
  expect(live.getByTestId("context-bar").textContent).not.toContain("Frozen");
});

it("announces connection transitions without announcing each successful poll", async () => {
  const ui = render(() => <Router root={App}>{routes}</Router>);
  await waitFor(() =>
    expect(ui.getByTestId("connection-status").textContent).toContain("Control API responding"),
  );
  const status = ui.getByTestId("connection-status");
  const before = status.textContent;
  await appState.refreshClock();
  expect(status.textContent).toBe(before);
  vi.mocked(control.sessionInfo).mockReturnValueOnce(errAsync({ status: 0, message: "offline" }));
  await appState.refreshClock();
  expect(status.textContent).toContain("Control API not answering");
  expect(status.textContent).toContain("Last");
  await appState.refreshClock();
  expect(status.textContent).toContain("Control API responding");
});

it("ignores a clear-plan failure that arrives after switching to another session", async () => {
  vi.mocked(control.listSessions).mockImplementation(() =>
    okAsync({
      sessions: [
        { name: "default", project: "demo-a" },
        { name: "other", project: "demo-b" },
      ],
    }),
  );
  appState.setSessions([
    { name: "default", project: "demo-a" },
    { name: "other", project: "demo-b" },
  ]);
  vi.mocked(control.getFaultPlan).mockImplementation((session: string) =>
    okAsync({
      plan: session === "default" ? { rules: [{}] } : null,
      fired: [],
    } as never),
  );
  let rejectClear!: () => void;
  vi.mocked(control.clearFaultPlan).mockImplementation(() =>
    ResultAsync.fromPromise(
      new Promise<never>((_, bad) => {
        rejectClear = () => bad(new Error("clear failed"));
      }),
      () => ({ status: 500, message: "clear failed" }),
    ),
  );
  const ui = render(() => <Router root={App}>{routes}</Router>);
  await appState.refreshFaultSummary();
  await waitFor(() => expect(ui.getByTestId("header-fault-clear")).toBeTruthy());
  fireEvent.click(ui.getByTestId("header-fault-clear"));
  fireEvent.click(ui.getByTestId("header-fault-clear-confirm"));
  await waitFor(() => expect(control.clearFaultPlan).toHaveBeenCalledWith("default"));
  appState.setSession("other");
  await appState.refreshFaultSummary();
  await waitFor(() => expect(ui.queryByTestId("header-fault-indicator")).toBeNull());
  rejectClear();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(ui.queryByText("clear failed")).toBeNull();
});
