import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { okAsync, ResultAsync } from "neverthrow";
import * as auth from "../api/auth";
import * as fn from "../api/functions";
import type { FunctionInfo } from "../api/functions";
import { appState } from "../state";
import { InvokeForm } from "./Functions";

vi.mock("../api/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/auth")>()),
  listUsers: vi.fn(),
  mintIdToken: vi.fn(),
}));
vi.mock("../api/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/functions")>()),
  invokeFunction: vi.fn(),
}));

const callable: FunctionInfo = {
  name: "greet",
  region: "us-central1",
  entryPoint: "greet",
  trigger: { kind: "http", callable: true },
  timeoutSeconds: 60,
  retry: false,
  concurrency: 1,
};

type Mint = { uid: string; resolve: (token: string) => void; reject: () => void };
let mints: Mint[] = [];
const onError = vi.fn();

// A mint the test settles by hand, so late and out-of-order answers can be replayed.
const deferredMint = (_project: string, uid: string) => {
  let resolve!: (token: string) => void;
  let reject!: () => void;
  const promise = new Promise<{ idToken: string; expiresIn: string; localId: string }>(
    (ok, bad) => {
      resolve = (token) => ok({ idToken: token, expiresIn: "3600", localId: uid });
      reject = () => bad(new Error("mint failed"));
    },
  );
  mints.push({ uid, resolve, reject });
  return ResultAsync.fromPromise(promise, () => ({ message: "mint failed", status: 500 }));
};

const sentAuthorization = () => {
  const calls = vi.mocked(fn.invokeFunction).mock.calls;
  const last = calls[calls.length - 1];
  return last?.[1].headers?.["authorization"];
};

type Mounted = ReturnType<typeof render>;
const send = (ui: Mounted) => ui.getByTestId("invoke-greet-send") as HTMLButtonElement;
const picker = (ui: Mounted) => ui.getByTestId("invoke-user-picker") as HTMLSelectElement;

const mount = () => {
  const ui = render(() => <InvokeForm f={callable} project="demo-app" onError={onError} />);
  fireEvent.focus(picker(ui));
  return ui;
};

const pick = async (ui: Mounted, uid: string) => {
  await waitFor(() => expect(picker(ui).querySelector(`option[value="${uid}"]`)).toBeTruthy());
  fireEvent.change(picker(ui), { target: { value: uid } });
};

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  mints = [];
  appState.setSessions([{ name: "default", project: "demo-app" }]);
  appState.setSession("default");
  vi.mocked(auth.listUsers).mockReturnValue(
    okAsync({ users: [{ localId: "alice" }, { localId: "bob" }] }) as never,
  );
  vi.mocked(auth.mintIdToken).mockImplementation(deferredMint as never);
  vi.mocked(fn.invokeFunction).mockReturnValue(
    okAsync({ status: 200, headers: [], body: "{}" }) as never,
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Functions invoke identity", () => {
  it("uses the token of the last selected user when an earlier mint resolves late", async () => {
    const ui = mount();
    await pick(ui, "alice");
    await pick(ui, "bob");
    mints[1]!.resolve("tok-bob");
    mints[0]!.resolve("tok-alice");
    await settle();
    await waitFor(() => expect(send(ui).disabled).toBe(false));
    fireEvent.click(send(ui));
    await waitFor(() => expect(fn.invokeFunction).toHaveBeenCalled());
    expect(sentAuthorization()).toBe("Bearer tok-bob");
  });

  it("keeps Send disabled after a failed mint and never sends an empty token", async () => {
    const ui = mount();
    await pick(ui, "bob");
    mints[0]!.reject();
    await waitFor(() => expect(onError).toHaveBeenCalledWith("mint failed"));
    expect(picker(ui).value).toBe("bob");
    expect(send(ui).disabled).toBe(true);
    fireEvent.click(send(ui));
    await settle();
    expect(fn.invokeFunction).not.toHaveBeenCalled();
  });

  it("drops a late mint after switching to the manual option", async () => {
    const ui = mount();
    await pick(ui, "alice");
    fireEvent.change(picker(ui), { target: { value: "" } });
    mints[0]!.resolve("tok-alice");
    await settle();
    expect(send(ui).disabled).toBe(false);
    fireEvent.click(send(ui));
    await waitFor(() => expect(fn.invokeFunction).toHaveBeenCalled());
    expect(sentAuthorization()).toBeUndefined();
  });

  it("makes a history replay show the replayed identity and send a token minted for it", async () => {
    const ui = mount();
    await pick(ui, "alice");
    mints[0]!.resolve("tok-alice");
    await waitFor(() => expect(send(ui).disabled).toBe(false));
    fireEvent.click(send(ui));
    await waitFor(() => expect(fn.invokeFunction).toHaveBeenCalledTimes(1));
    await pick(ui, "bob");
    mints[1]!.resolve("tok-bob");
    await waitFor(() => expect(send(ui).disabled).toBe(false));
    fireEvent.click(ui.getByText("Load"));
    expect(picker(ui).value).toBe("alice");
    // The replay mints again for the shown identity, and Send waits for that token.
    expect(send(ui).disabled).toBe(true);
    mints[2]!.resolve("tok-alice-2");
    await waitFor(() => expect(send(ui).disabled).toBe(false));
    fireEvent.click(send(ui));
    await waitFor(() => expect(fn.invokeFunction).toHaveBeenCalledTimes(2));
    expect(sentAuthorization()).toBe("Bearer tok-alice-2");
  });

  it("replays a manual-token entry as a manual identity", async () => {
    const ui = mount();
    fireEvent.input(ui.getByLabelText("ID token (optional)"), { target: { value: "manual" } });
    fireEvent.click(send(ui));
    await waitFor(() => expect(fn.invokeFunction).toHaveBeenCalledTimes(1));
    await pick(ui, "bob");
    mints[0]!.resolve("tok-bob");
    await waitFor(() => expect(send(ui).disabled).toBe(false));
    fireEvent.click(ui.getByText("Load"));
    expect(picker(ui).value).toBe("");
    fireEvent.click(send(ui));
    await waitFor(() => expect(fn.invokeFunction).toHaveBeenCalledTimes(2));
    expect(sentAuthorization()).toBe("Bearer manual");
  });
});
