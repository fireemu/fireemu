import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { MemoryRouter, Route } from "@solidjs/router";
import Auth, { CODE_POLL_MS } from "./Auth";
import * as auth from "../api/auth";
import type { OobCodeInfo } from "../api/auth";

vi.mock("../api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/auth")>()),
  listUsers: vi.fn(),
  listOobCodes: vi.fn(),
  listVerificationCodes: vi.fn(),
  listTotpCodes: vi.fn(),
}));

const mount = () =>
  render(() => (
    <MemoryRouter>
      <Route path="/" component={Auth} />
    </MemoryRouter>
  ));

const verify: OobCodeInfo = {
  email: "person@example.com",
  requestType: "VERIFY_EMAIL",
  oobCode: "code-1",
  oobLink: "http://127.0.0.1:9099/emulator/action?mode=verifyEmail&oobCode=code-1",
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(auth.listUsers)
    .mockReset()
    .mockReturnValue(okAsync({ users: [] }));
  vi.mocked(auth.listOobCodes)
    .mockReset()
    .mockReturnValue(okAsync({ oobCodes: [] }));
  vi.mocked(auth.listVerificationCodes)
    .mockReset()
    .mockReturnValue(okAsync({ verificationCodes: [] }));
  vi.mocked(auth.listTotpCodes)
    .mockReset()
    .mockReturnValue(okAsync({ totpCodes: [] }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Auth codes", () => {
  it("shows the current TOTP code of each factor and refreshes it", async () => {
    const ui = mount();
    await waitFor(() => expect(ui.getByText("No TOTP factors or enrollments")).toBeTruthy());
    vi.mocked(auth.listTotpCodes).mockReturnValue(
      okAsync({
        totpCodes: [
          {
            uid: "user-1",
            mfaEnrollmentId: "factor-1",
            displayName: "laptop",
            code: "012345",
            secondsRemaining: 17,
          },
          { uid: "user-2", pendingEnrollment: true, code: "999000", secondsRemaining: 4 },
        ],
      }),
    );
    await vi.advanceTimersByTimeAsync(CODE_POLL_MS);
    await waitFor(() => expect(ui.getByTestId("totp-table")).toBeTruthy());
    expect(ui.getByText("012345")).toBeTruthy();
    expect(ui.getByText("17s")).toBeTruthy();
    expect(ui.getByText("laptop")).toBeTruthy();
    expect(ui.getByText("Enrollment in progress")).toBeTruthy();
    vi.mocked(auth.listTotpCodes).mockReturnValue(
      okAsync({
        totpCodes: [
          {
            uid: "user-1",
            mfaEnrollmentId: "factor-1",
            code: "543210",
            secondsRemaining: 30,
          },
        ],
      }),
    );
    await vi.advanceTimersByTimeAsync(CODE_POLL_MS);
    await waitFor(() => expect(ui.getByText("543210")).toBeTruthy());
  });

  it("shows another failure as an error, not as the reveal being off", async () => {
    vi.mocked(auth.listTotpCodes).mockReturnValue(errAsync({ status: 500, message: "INTERNAL" }));
    const ui = mount();
    await waitFor(() => expect(ui.getByTestId("totp-error").textContent).toContain("INTERNAL"));
    expect(ui.queryByTestId("totp-off")).toBeNull();
  });

  it("says the reveal is off when the route is absent", async () => {
    vi.mocked(auth.listTotpCodes).mockReturnValue(errAsync({ status: 404, message: "Not Found" }));
    const ui = mount();
    await waitFor(() => expect(ui.getByTestId("totp-off")).toBeTruthy());
  });

  // User report (0.54.0): a person following a flow in another tab (TOTP enrollment needs a
  // verified email) had to reload the page to see the code the flow had just issued.
  it("shows a code issued after the page opened without a reload", async () => {
    const ui = mount();
    await waitFor(() => expect(ui.getByText("No pending email action codes")).toBeTruthy());
    expect(ui.getByTestId("auth-codes-hint")).toBeTruthy();
    vi.mocked(auth.listOobCodes).mockReturnValue(okAsync({ oobCodes: [verify] }));
    await vi.advanceTimersByTimeAsync(CODE_POLL_MS);
    await waitFor(() => expect(ui.getByTestId("oob-table")).toBeTruthy());
    const link = ui.getByText("code-1") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(verify.oobLink);
  });

  it("keeps the table on screen while it refreshes", async () => {
    vi.mocked(auth.listOobCodes).mockReturnValue(okAsync({ oobCodes: [verify] }));
    const ui = mount();
    await waitFor(() => expect(ui.getByTestId("oob-table")).toBeTruthy());
    // The next read never answers: the table stays, no spinner replaces it.
    vi.mocked(auth.listOobCodes).mockReturnValue(
      new ResultAsync(new Promise(() => {})) as ReturnType<typeof auth.listOobCodes>,
    );
    await vi.advanceTimersByTimeAsync(CODE_POLL_MS);
    expect(ui.getByTestId("oob-table")).toBeTruthy();
  });

  it("stops polling once the page is left", async () => {
    const ui = mount();
    await waitFor(() => expect(auth.listOobCodes).toHaveBeenCalled());
    ui.unmount();
    const calls = vi.mocked(auth.listOobCodes).mock.calls.length;
    await vi.advanceTimersByTimeAsync(CODE_POLL_MS * 3);
    expect(vi.mocked(auth.listOobCodes).mock.calls.length).toBe(calls);
  });

  it("does not start another read while one is still pending", async () => {
    const ui = mount();
    await waitFor(() => expect(ui.getByText("No pending email action codes")).toBeTruthy());
    vi.mocked(auth.listOobCodes).mockReturnValue(
      new ResultAsync(new Promise(() => {})) as ReturnType<typeof auth.listOobCodes>,
    );
    const before = vi.mocked(auth.listOobCodes).mock.calls.length;
    await vi.advanceTimersByTimeAsync(CODE_POLL_MS * 3);
    expect(vi.mocked(auth.listOobCodes).mock.calls.length).toBe(before + 1);
  });

  it("pauses while the tab is hidden", async () => {
    const ui = mount();
    await waitFor(() => expect(auth.listOobCodes).toHaveBeenCalled());
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const before = vi.mocked(auth.listOobCodes).mock.calls.length;
    await vi.advanceTimersByTimeAsync(CODE_POLL_MS * 3);
    expect(vi.mocked(auth.listOobCodes).mock.calls.length).toBe(before);
    hidden.mockRestore();
    await vi.advanceTimersByTimeAsync(CODE_POLL_MS);
    expect(vi.mocked(auth.listOobCodes).mock.calls.length).toBe(before + 1);
    ui.unmount();
  });
});
