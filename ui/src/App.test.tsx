import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { routed } from "./test/router";
import { errAsync, okAsync } from "neverthrow";
import { App } from "./App";
import { appState } from "./state";
import { routes } from "./routes";
import * as control from "./api/control";

vi.mock("./api/control", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/control")>()),
  sessionInfo: vi.fn(),
  listSessions: vi.fn(),
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
  const ui = render(routed(routes, { root: App }));
  const links = [...ui.getByLabelText("Emulator products").querySelectorAll("a")];
  const names = links.map((a) => a.textContent);
  expect(names.indexOf("Hosting")).toBe(names.indexOf("Functions") + 1);
  expect(links[names.indexOf("Hosting")]!.getAttribute("href")).toBe("/ui/hosting");
});

it("says in the header whether the clock is frozen or follows real time", () => {
  appState.setConfig({ ...appState.config(), clockMode: "frozen" });
  const frozen = render(routed(routes, { root: App }));
  expect(frozen.getByTestId("clock-mode").textContent).toBe("Frozen");
  expect(frozen.getByTestId("clock-mode").title).toContain("stands still until advanced");
  expect(frozen.getByTestId("clock-mode").dataset.tone).toBe("paused");
  cleanup();
  appState.setConfig({ ...appState.config(), clockMode: "realtime" });
  const live = render(routed(routes, { root: App }));
  expect(live.getByTestId("clock-mode").textContent).toBe("Real time");
  expect(live.getByTestId("clock-mode").title).toContain("wall clock");
  expect(live.getByTestId("clock-mode").dataset.tone).toBe("neutral");
  expect(live.getByTestId("context-bar").textContent).not.toContain("Frozen");
});

it("announces connection transitions without announcing each successful poll", async () => {
  const ui = render(routed(routes, { root: App }));
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

it("marks the navigation entry of the section shown, by path and whatever the query", async () => {
  const current = async (url: string) => {
    window.history.replaceState(null, "", url);
    const ui = render(routed(routes, { root: App, base: "/ui" }));
    const nav = [...ui.getByLabelText("Emulator products").querySelectorAll("a")];
    await waitFor(() => expect(nav.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 0));
    const marked = nav.filter((a) => a.getAttribute("aria-current") === "page");
    cleanup();
    return marked.map((a) => a.textContent);
  };
  // As Solid Router 1's links did: the section's own path, the query ignored, and a page
  // inside a section (a Firestore document) leaves the entry unmarked.
  expect(await current("/ui/auth?tab=users")).toEqual(["Authentication"]);
  expect(await current("/ui/firestore?db=(default)")).toEqual(["Firestore"]);
  expect(await current("/ui/")).toEqual(["Overview"]);
  expect(await current("/ui/firestore/cities/tokyo")).toEqual([]);
  window.history.replaceState(null, "", "/");
});
