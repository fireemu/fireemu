import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { errAsync, okAsync } from "neverthrow";
import * as pubsub from "../api/pubsub";
import { appState } from "../state";
import PubSub from "./PubSub";

vi.mock("../api/pubsub", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/pubsub")>()),
  listTopics: vi.fn(),
  createTopic: vi.fn(),
  publishToTopic: vi.fn(),
  listSubscriptions: vi.fn(),
  pullSubscription: vi.fn(),
  acknowledgeSubscription: vi.fn(),
  listPubSubSnapshots: vi.fn(),
}));

beforeEach(() => {
  appState.setSessions([{ name: "default", project: "demo-ps" }]);
  appState.setSession("default");
  appState.setConfig({ ...appState.config(), project: "demo-ps", pubsubEnabled: true });
  vi.mocked(pubsub.listTopics).mockImplementation(() =>
    okAsync({ topics: [{ name: "projects/demo-ps/topics/orders" }] }),
  );
  vi.mocked(pubsub.listSubscriptions).mockImplementation(() =>
    okAsync({
      subscriptions: [
        {
          name: "projects/demo-ps/subscriptions/worker",
          topic: "projects/demo-ps/topics/orders",
          ackDeadlineSeconds: 30,
        },
      ],
    }),
  );
  vi.mocked(pubsub.listPubSubSnapshots).mockImplementation(() => okAsync({ snapshots: [] }));
  vi.mocked(pubsub.createTopic).mockImplementation(() =>
    okAsync({ name: "projects/demo-ps/topics/billing" }),
  );
  vi.mocked(pubsub.publishToTopic).mockImplementation(() => okAsync({ messageIds: ["msg-42"] }));
  vi.mocked(pubsub.pullSubscription).mockImplementation(() =>
    okAsync({
      receivedMessages: [
        {
          ackId: "ack-1",
          deliveryAttempt: 1,
          message: {
            messageId: "msg-42",
            data: pubsub.encodeBase64Utf8('{"ok":true}'),
          },
        },
      ],
    }),
  );
  vi.mocked(pubsub.acknowledgeSubscription).mockImplementation(() => okAsync({}));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PubSub page", () => {
  it("lists topics, publishes a message, pulls and acknowledges on a subscription", async () => {
    const ui = render(() => <PubSub />);
    await waitFor(() => expect(ui.getByTestId("pubsub-topic-orders")).toBeTruthy());

    fireEvent.input(ui.getByTestId("pubsub-new-topic-id"), { target: { value: "billing" } });
    fireEvent.click(ui.getByTestId("pubsub-create-topic"));
    await waitFor(() => expect(pubsub.createTopic).toHaveBeenCalledWith("demo-ps", "billing"));

    fireEvent.click(ui.getByTestId("pubsub-publish-open-orders"));
    fireEvent.click(ui.getByTestId("pubsub-publish-send"));
    await waitFor(() => expect(pubsub.publishToTopic).toHaveBeenCalled());
    await waitFor(() => expect(ui.getByText(/Published message msg-42/)).toBeTruthy());

    fireEvent.click(ui.getByTestId("pubsub-tab-subscriptions"));
    await waitFor(() => expect(ui.getByTestId("pubsub-sub-worker")).toBeTruthy());
    fireEvent.click(ui.getByTestId("pubsub-pull-open-worker"));
    fireEvent.click(ui.getByTestId("pubsub-pull-now"));
    await waitFor(() => expect(ui.getByTestId("pubsub-pulled-table")).toBeTruthy());
    expect(ui.getByTestId("pubsub-pulled-table").textContent).toContain('{"ok":true}');

    fireEvent.click(ui.getByTestId("pubsub-ack-all"));
    await waitFor(() =>
      expect(pubsub.acknowledgeSubscription).toHaveBeenCalledWith("demo-ps", "worker", ["ack-1"]),
    );
  });

  it("shows unavailable state when Pub/Sub returns 503", async () => {
    vi.mocked(pubsub.listTopics).mockImplementation(() =>
      errAsync({ status: 503, message: "UNAVAILABLE" }),
    );
    const ui = render(() => <PubSub />);
    await waitFor(() => expect(ui.getByTestId("pubsub-unavailable")).toBeTruthy());
  });

  it("rejects out-of-range ackDeadlineSeconds with an error instead of silently clamping", async () => {
    const ui = render(() => <PubSub />);
    await waitFor(() => expect(ui.getByTestId("pubsub-topic-orders")).toBeTruthy());
    fireEvent.click(ui.getByTestId("pubsub-tab-subscriptions"));
    await waitFor(() => expect(ui.getByTestId("pubsub-new-sub-id")).toBeTruthy());

    fireEvent.input(ui.getByTestId("pubsub-new-sub-id"), { target: { value: "bad-sub" } });
    const ackInput = ui.getByLabelText("Ack deadline (seconds)") as HTMLInputElement;
    fireEvent.input(ackInput, { target: { value: "5" } });
    fireEvent.click(ui.getByTestId("pubsub-create-sub"));
    await waitFor(() => expect(ui.getByRole("alert").textContent).toContain("10 and 600"));
  });
});
