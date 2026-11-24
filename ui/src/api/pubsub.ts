import type { ResultAsync } from "neverthrow";
import { request, type ApiError, type Json } from "./client";

export type PubSubTopic = {
  name: string;
  labels?: Record<string, string>;
};

export type PubSubSubscription = {
  name: string;
  topic: string;
  ackDeadlineSeconds?: number;
  pushConfig?: { pushEndpoint?: string };
  deadLetterPolicy?: { deadLetterTopic?: string; maxDeliveryAttempts?: number };
  filter?: string;
  enableMessageOrdering?: boolean;
};

export type PubSubSnapshot = {
  name: string;
  topic: string;
  expireTime?: string;
};

export type PubSubReceivedMessage = {
  ackId: string;
  deliveryAttempt?: number;
  message: {
    data?: string;
    attributes?: Record<string, string>;
    messageId?: string;
    publishTime?: string;
    orderingKey?: string;
  };
};

const projectBase = (project: string) => `pubsub/v1/projects/${encodeURIComponent(project)}`;

/** Extracts the short resource ID from `projects/{p}/{collection}/{id}`. */
export const shortPubSubName = (full: string): string => full.slice(full.lastIndexOf("/") + 1);

/** Encodes a UTF-8 string into standard Base64. */
export const encodeBase64Utf8 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

/** Decodes Base64 payload bytes into UTF-8 text (falling back to raw base64 on error). */
export const decodeBase64Utf8 = (encoded: string | undefined): string => {
  if (!encoded) return "";
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return encoded;
  }
};

const encodePubSubId = (id: string): string =>
  encodeURIComponent(id).replace(/%2B/gi, "+").replace(/%7E/gi, "~").replace(/%25/gi, "%");

export const listTopics = (project: string): ResultAsync<{ topics?: PubSubTopic[] }, ApiError> =>
  request("GET", `${projectBase(project)}/topics?pageSize=200`);

export const createTopic = (project: string, topicId: string): ResultAsync<PubSubTopic, ApiError> =>
  request("PUT", `${projectBase(project)}/topics/${encodePubSubId(topicId)}`, {});

export const deleteTopic = (project: string, topicId: string): ResultAsync<Json, ApiError> =>
  request("DELETE", `${projectBase(project)}/topics/${encodePubSubId(topicId)}`);

export const publishToTopic = (
  project: string,
  topicId: string,
  message: { data: string; attributes?: Record<string, string>; orderingKey?: string },
): ResultAsync<{ messageIds: string[] }, ApiError> =>
  request("POST", `${projectBase(project)}/topics/${encodePubSubId(topicId)}:publish`, {
    messages: [message],
  });

export const listSubscriptions = (
  project: string,
): ResultAsync<{ subscriptions?: PubSubSubscription[] }, ApiError> =>
  request("GET", `${projectBase(project)}/subscriptions?pageSize=200`);

export const createSubscription = (
  project: string,
  subscriptionId: string,
  body: {
    topic: string;
    ackDeadlineSeconds?: number;
    pushConfig?: { pushEndpoint: string };
    deadLetterPolicy?: { deadLetterTopic: string; maxDeliveryAttempts: number };
    filter?: string;
    enableMessageOrdering?: boolean;
  },
): ResultAsync<PubSubSubscription, ApiError> =>
  request("PUT", `${projectBase(project)}/subscriptions/${encodePubSubId(subscriptionId)}`, body);

export const deleteSubscription = (
  project: string,
  subscriptionId: string,
): ResultAsync<Json, ApiError> =>
  request("DELETE", `${projectBase(project)}/subscriptions/${encodePubSubId(subscriptionId)}`);

export const pullSubscription = (
  project: string,
  subscriptionId: string,
  maxMessages: number,
): ResultAsync<{ receivedMessages?: PubSubReceivedMessage[] }, ApiError> =>
  request("POST", `${projectBase(project)}/subscriptions/${encodePubSubId(subscriptionId)}:pull`, {
    maxMessages,
    returnImmediately: true,
  });

export const acknowledgeSubscription = (
  project: string,
  subscriptionId: string,
  ackIds: string[],
): ResultAsync<Json, ApiError> =>
  request(
    "POST",
    `${projectBase(project)}/subscriptions/${encodePubSubId(subscriptionId)}:acknowledge`,
    { ackIds },
  );

export const seekSubscription = (
  project: string,
  subscriptionId: string,
  snapshot: string,
): ResultAsync<Json, ApiError> =>
  request("POST", `${projectBase(project)}/subscriptions/${encodePubSubId(subscriptionId)}:seek`, {
    snapshot,
  });

export const listPubSubSnapshots = (
  project: string,
): ResultAsync<{ snapshots?: PubSubSnapshot[] }, ApiError> =>
  request("GET", `${projectBase(project)}/snapshots?pageSize=200`);

export const createPubSubSnapshot = (
  project: string,
  snapshotId: string,
  subscription: string,
): ResultAsync<PubSubSnapshot, ApiError> =>
  request("PUT", `${projectBase(project)}/snapshots/${encodePubSubId(snapshotId)}`, {
    subscription,
  });

export const deletePubSubSnapshot = (
  project: string,
  snapshotId: string,
): ResultAsync<Json, ApiError> =>
  request("DELETE", `${projectBase(project)}/snapshots/${encodePubSubId(snapshotId)}`);
