import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { Route, Router } from "@solidjs/router";
import { okAsync } from "neverthrow";
import * as control from "../api/control";
import * as rc from "../api/remoteConfig";
import { appState } from "../state";
import RemoteConfig from "./RemoteConfig";

vi.mock("../api/remoteConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/remoteConfig")>()),
  getRemoteConfigTemplate: vi.fn(),
  validateRemoteConfigTemplate: vi.fn(),
  publishRemoteConfigTemplate: vi.fn(),
  listRemoteConfigVersions: vi.fn(),
  rollbackRemoteConfig: vi.fn(),
}));

vi.mock("../api/control", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/control")>()),
  publishRemoteConfigUpdate: vi.fn(),
}));

const SAMPLE = JSON.stringify(
  {
    parameters: {
      welcome_text: { valueType: "STRING", defaultValue: { value: "Hello" } },
    },
    version: { versionNumber: "2", updateType: "INCREMENTAL_UPDATE" },
  },
  null,
  2,
);

beforeEach(() => {
  appState.setSessions([{ name: "default", project: "demo-rc" }]);
  appState.setSession("default");
  appState.setConfig({ ...appState.config(), project: "demo-rc", remoteConfigEnabled: true });
  vi.mocked(rc.getRemoteConfigTemplate).mockImplementation(() =>
    okAsync({ status: 200, body: SAMPLE, etag: "etag-fireemu-2" }),
  );
  vi.mocked(rc.validateRemoteConfigTemplate).mockImplementation(() =>
    okAsync({ status: 200, body: SAMPLE, etag: "etag-fireemu-2-0" }),
  );
  vi.mocked(rc.publishRemoteConfigTemplate).mockImplementation(() =>
    okAsync({
      status: 200,
      body: JSON.stringify({ version: { versionNumber: "3" } }),
      etag: "etag-fireemu-3",
    }),
  );
  vi.mocked(rc.listRemoteConfigVersions).mockImplementation(() =>
    okAsync({
      versions: [
        { versionNumber: "2", updateType: "INCREMENTAL_UPDATE", description: "second" },
        { versionNumber: "1", updateType: "FORCED_UPDATE", description: "first" },
      ],
    }),
  );
  vi.mocked(rc.rollbackRemoteConfig).mockImplementation(() =>
    okAsync({ version: { versionNumber: "4", updateType: "ROLLBACK" } }),
  );
  vi.mocked(control.publishRemoteConfigUpdate).mockImplementation(() => okAsync({ delivered: 1 }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RemoteConfig page", () => {
  it("renders parameters, adds a quick parameter, validates, publishes and rolls back", async () => {
    const ui = render(() => (
      <Router>
        <Route path="*" component={() => <RemoteConfig />} />
      </Router>
    ));
    await waitFor(() => expect(ui.getByTestId("rc-params-table")).toBeTruthy());
    expect(ui.getByTestId("rc-params-table").textContent).toContain("welcome_text");
    expect(ui.getByTestId("rc-etag").textContent).toBe("etag-fireemu-2");

    fireEvent.input(ui.getByTestId("rc-quick-key"), { target: { value: "dark_banner" } });
    fireEvent.change(ui.getByTestId("rc-quick-type"), { target: { value: "BOOLEAN" } });
    fireEvent.input(ui.getByTestId("rc-quick-value"), { target: { value: "true" } });
    fireEvent.click(ui.getByTestId("rc-quick-add"));

    fireEvent.click(ui.getByTestId("rc-validate"));
    await waitFor(() => expect(rc.validateRemoteConfigTemplate).toHaveBeenCalled());

    fireEvent.click(ui.getByTestId("rc-publish"));
    await waitFor(() => expect(rc.publishRemoteConfigTemplate).toHaveBeenCalled());
    await waitFor(() => expect(ui.getByText(/Published version 3/)).toBeTruthy());

    fireEvent.click(ui.getByTestId("rc-tab-versions"));
    await waitFor(() => expect(ui.getByTestId("rc-version-1")).toBeTruthy());
    fireEvent.click(ui.getByTestId("rc-rollback-1"));
    fireEvent.click(ui.getByTestId("rc-rollback-1-confirm"));
    await waitFor(() => expect(rc.rollbackRemoteConfig).toHaveBeenCalledWith("demo-rc", "1"));

    fireEvent.click(ui.getByTestId("rc-tab-trigger"));
    fireEvent.click(ui.getByTestId("rc-trigger-send"));
    await waitFor(() => expect(control.publishRemoteConfigUpdate).toHaveBeenCalled());
  });

  it("refuses quick-add on invalid JSON without wiping draft and preserves conditionalValues on existing key", async () => {
    const withCond = JSON.stringify(
      {
        parameters: {
          welcome_text: {
            valueType: "STRING",
            defaultValue: { value: "Hello" },
            conditionalValues: { ios: { value: "Hi iOS" } },
          },
        },
        version: { versionNumber: "2" },
      },
      null,
      2,
    );
    vi.mocked(rc.getRemoteConfigTemplate).mockReturnValue(
      okAsync({ status: 200, body: withCond, etag: "etag-v2" }),
    );
    const ui = render(() => (
      <Router>
        <Route path="*" component={() => <RemoteConfig />} />
      </Router>
    ));
    await waitFor(() => expect(ui.getByTestId("rc-template-editor")).toBeTruthy());
    const editor = ui.getByTestId("rc-template-editor") as HTMLTextAreaElement;

    // Update existing key preserves conditionalValues.
    fireEvent.input(ui.getByTestId("rc-quick-key"), { target: { value: "welcome_text" } });
    fireEvent.input(ui.getByTestId("rc-quick-value"), { target: { value: "Updated" } });
    fireEvent.click(ui.getByTestId("rc-quick-add"));
    expect(JSON.parse(editor.value).parameters.welcome_text.conditionalValues).toEqual({
      ios: { value: "Hi iOS" },
    });

    // Invalid JSON draft is preserved when quick-add fails.
    fireEvent.input(editor, { target: { value: "{ invalid" } });
    fireEvent.input(ui.getByTestId("rc-quick-key"), { target: { value: "other" } });
    fireEvent.click(ui.getByTestId("rc-quick-add"));
    expect(editor.value).toBe("{ invalid");
    expect(ui.getByRole("alert")).toBeTruthy();

    // Null parameter entries in JSON draft do not crash the live preview table.
    fireEvent.input(editor, { target: { value: '{"parameters":{"bad":null}}' } });
    await waitFor(() => expect(ui.getByTestId("rc-params-table").textContent).toContain("bad"));

    // Discard draft restores the fetched server template.
    fireEvent.click(ui.getByTestId("rc-discard-draft"));
    await waitFor(() => expect(editor.value).toContain("welcome_text"));
  });

  describe("preconditions", () => {
    const UNPUBLISHED = { status: 200, body: "{}\n", etag: null };
    const PUBLISHED_B = {
      status: 200,
      etag: "etag-v1",
      body: JSON.stringify({
        parameters: { b: { defaultValue: { value: "remote" } } },
        version: { versionNumber: "1" },
      }),
    };
    const DRAFT_A = JSON.stringify({ parameters: { a: { defaultValue: { value: "local" } } } });
    const mountPage = () =>
      render(() => (
        <Router>
          <Route path="*" component={() => <RemoteConfig />} />
        </Router>
      ));
    const sentIfMatch = () => vi.mocked(rc.publishRemoteConfigTemplate).mock.calls.map((c) => c[2]);

    it("refuses to publish a draft started on an unpublished template once another client published", async () => {
      vi.mocked(rc.getRemoteConfigTemplate).mockReturnValueOnce(okAsync(UNPUBLISHED));
      const ui = mountPage();
      const editor = (await waitFor(() =>
        ui.getByTestId("rc-template-editor"),
      )) as HTMLTextAreaElement;
      fireEvent.input(editor, { target: { value: DRAFT_A } });
      vi.mocked(rc.getRemoteConfigTemplate).mockReturnValue(okAsync(PUBLISHED_B));
      fireEvent.click(ui.getByTestId("rc-publish"));
      await waitFor(() => expect(ui.getByRole("alert")).toBeTruthy());
      expect(rc.publishRemoteConfigTemplate).not.toHaveBeenCalled();
    });

    it("does not let a stale draft inherit the ETag a refresh loads", async () => {
      vi.mocked(rc.getRemoteConfigTemplate).mockReturnValueOnce(okAsync(UNPUBLISHED));
      const ui = mountPage();
      const editor = (await waitFor(() =>
        ui.getByTestId("rc-template-editor"),
      )) as HTMLTextAreaElement;
      fireEvent.input(editor, { target: { value: DRAFT_A } });
      vi.mocked(rc.getRemoteConfigTemplate).mockReturnValue(okAsync(PUBLISHED_B));
      fireEvent.click(ui.getByTestId("rc-refresh"));
      await waitFor(() => expect(ui.getByTestId("rc-etag").textContent).toBe("etag-v1"));
      expect(editor.value).toBe(DRAFT_A);
      fireEvent.click(ui.getByTestId("rc-publish"));
      await waitFor(() => expect(ui.getByRole("alert")).toBeTruthy());
      expect(rc.publishRemoteConfigTemplate).not.toHaveBeenCalled();
    });

    it("sends the draft's own base ETag, never the one a refresh loaded or a wildcard", async () => {
      const ui = mountPage();
      const editor = (await waitFor(() =>
        ui.getByTestId("rc-template-editor"),
      )) as HTMLTextAreaElement;
      fireEvent.input(editor, { target: { value: DRAFT_A } });
      vi.mocked(rc.getRemoteConfigTemplate).mockReturnValue(okAsync(PUBLISHED_B));
      fireEvent.click(ui.getByTestId("rc-refresh"));
      await waitFor(() => expect(ui.getByTestId("rc-etag").textContent).toBe("etag-v1"));
      fireEvent.click(ui.getByTestId("rc-publish"));
      await waitFor(() => expect(rc.publishRemoteConfigTemplate).toHaveBeenCalled());
      expect(sentIfMatch()).toEqual(["etag-fireemu-2"]);
    });

    it("publishes a first template when it is still unpublished at the moment of publishing", async () => {
      vi.mocked(rc.getRemoteConfigTemplate).mockReturnValue(okAsync(UNPUBLISHED));
      const ui = mountPage();
      const editor = (await waitFor(() =>
        ui.getByTestId("rc-template-editor"),
      )) as HTMLTextAreaElement;
      fireEvent.input(editor, { target: { value: DRAFT_A } });
      fireEvent.click(ui.getByTestId("rc-publish"));
      await waitFor(() => expect(rc.publishRemoteConfigTemplate).toHaveBeenCalled());
      expect(sentIfMatch()).toEqual(["*"]);
    });
  });
});
