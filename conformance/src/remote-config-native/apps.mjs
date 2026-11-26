import { createRefused } from "../remote-config-web/program.mjs";
import { KEY_UID } from "./key.mjs";

const MANAGEMENT = "https://firebase.googleapis.com/v1beta1";
const OPERATION = /^operations\/[A-Za-z0-9:_-]+(?:\/[A-Za-z0-9:_-]+)*$/;
const PLATFORMS = {
  android: ["androidApps", "packageName"],
  ios: ["iosApps", "bundleId"],
};

function success(response, label) {
  if (
    response.status !== 200 ||
    !response.json ||
    typeof response.json !== "object" ||
    Array.isArray(response.json) ||
    "error" in response.json
  )
    throw new Error(`${label}: no complete management response`);
  return response.json;
}

function sortedActive(body, appFormat) {
  const apps = Object.hasOwn(body, "apps") ? body.apps : [];
  if (
    Object.hasOwn(body, "nextPageToken") ||
    !Array.isArray(apps) ||
    !apps.every((entry) => typeof entry?.appId === "string" && appFormat.test(entry.appId))
  )
    throw new Error("native app list incomplete");
  const active = apps.map((app) => app.appId).toSorted();
  if (new Set(active).size !== active.length)
    throw new Error("native app list repeated an identity");
  return { apps, active };
}

/** One pass's app registry. Management operations can grant only paths received for this app. */
export function nativeAppRegistry({
  project,
  number,
  platform,
  bundle,
  name,
  send,
  pause,
  polls,
  beforeCreate,
}) {
  const variant = PLATFORMS[platform];
  if (
    !variant ||
    !/^[a-z][a-z0-9-]{3,29}$/.test(project) ||
    !/^[0-9]{6,18}$/.test(number) ||
    !/^[a-z0-9]+(?:\.[a-z0-9]+)+$/.test(bundle) ||
    !/^[a-z][a-z0-9-]{1,48}$/.test(name) ||
    !Number.isSafeInteger(polls) ||
    polls < 1
  )
    throw new Error("invalid native app scope");

  const [segment, bundleField] = variant;
  const collection = `${MANAGEMENT}/projects/${project}/${segment}`;
  const appFormat = new RegExp(`^1:${number}:${platform}:[a-f0-9]+$`);
  let baseline;
  let resource;
  let appId;
  let keyUid;
  let operation;
  let progress = "unobserved";

  function allow(url, method, { signed } = {}) {
    if (
      signed ||
      url.protocol !== "https:" ||
      url.host !== "firebase.googleapis.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
    if (method === "GET") return [collection, resource, operation].includes(url.href);
    if (method !== "POST") return false;
    return (
      (progress === "create-pending" && url.href === collection) ||
      (progress === "remove-pending" && resource !== undefined && url.href === resource + ":remove")
    );
  }

  function terminal(result) {
    if (
      result.error ||
      !result.response ||
      typeof result.response !== "object" ||
      Array.isArray(result.response)
    )
      throw new Error("native app operation unsuccessful");
    return result.response;
  }

  async function complete(initial, step) {
    if (initial.done === true) return terminal(initial);
    if (typeof initial.name !== "string" || !OPERATION.test(initial.name))
      throw new Error("native app operation locator invalid");
    let result = initial;
    const id = initial.name;
    operation = `${MANAGEMENT}/${id}`;
    try {
      for (let attempt = 0; attempt <= polls; attempt++) {
        if (result.done === true) return terminal(result);
        if (attempt === polls) break;
        await pause();
        result = success(await send(`${platform}-${step}-poll-${attempt + 1}`, operation), "poll");
        if (result.name !== id) throw new Error("native app operation read-back changed identity");
      }
      throw new Error("native app operation did not finish within its budget");
    } finally {
      operation = undefined;
    }
  }

  function owned(body) {
    const { appId: received, displayName, etag } = body;
    if (
      received !== appId ||
      body.apiKeyId !== keyUid ||
      displayName !== name ||
      body[bundleField] !== bundle ||
      typeof etag !== "string" ||
      !etag.length
    )
      throw new Error("native app ownership read-back failed");
    return body;
  }

  async function list(step) {
    return sortedActive(success(await send(`${platform}-${step}`, collection), "list"), appFormat);
  }

  async function inspect() {
    if (progress !== "unobserved") throw new Error("native app baseline already read");
    const before = await list("baseline");
    if (before.apps.some((entry) => entry[bundleField] === bundle || entry.displayName === name))
      throw new Error("native app registration would collide");
    baseline = before.active;
    progress = "baseline";
  }

  async function create(apiKeyId) {
    if (progress !== "baseline") throw new Error("native app create needs its verified baseline");
    if (!KEY_UID.test(apiKeyId)) throw new Error("native app key UID is unreadable");
    keyUid = apiKeyId;
    progress = "create-pending";
    const body = { [bundleField]: bundle, displayName: name, apiKeyId };
    const answer = await send(`${platform}-create`, collection, {
      method: "POST",
      body,
      beforeDispatch: beforeCreate,
    });
    if (createRefused(answer)) {
      progress = "refused";
      throw new Error("native app creation refused");
    }
    const first = success(answer, "create");
    const created = await complete(first, "create");
    if (
      !appFormat.test(created.appId) ||
      baseline.includes(created.appId) ||
      created.displayName !== name ||
      created[bundleField] !== bundle
    )
      throw new Error("native app create returned an unowned identity");
    appId = created.appId;
    resource = `${collection}/${appId}`;
    const confirmed = owned(success(await send(`${platform}-own`, resource), "own"));
    progress = "created";
    return confirmed;
  }

  async function remove() {
    if (progress === "refused") return;
    if (!resource || !["created", "create-pending"].includes(progress))
      throw new Error("native app removal has no owned registration");
    const current = owned(
      success(await send(`${platform}-cleanup-read`, resource), "cleanup read"),
    );
    progress = "remove-pending";
    const initial = success(
      await send(`${platform}-remove`, resource + ":remove", {
        method: "POST",
        body: { etag: current.etag },
      }),
      "remove",
    );
    const removed = await complete(initial, "remove");
    if (removed.appId !== undefined && removed.appId !== appId)
      throw new Error("native app operation returned another identity");
    if (removed.appId === appId && removed.state === "DELETED") owned(removed);
    else {
      const removedApp = owned(success(await send(`${platform}-tombstone`, resource), "tombstone"));
      if (removedApp.state !== "DELETED")
        throw new Error("native app removal did not confirm the owned tombstone");
    }
    const { active } = await list("baseline-after");
    if (active.length !== baseline.length || !active.every((id, index) => id === baseline[index]))
      throw new Error("native active app baseline was not restored");
    progress = "restored";
  }

  return {
    allow,
    inspect,
    create,
    remove,
    assertClosed() {
      if (!baseline) throw new Error("native app baseline unobserved");
      if (!["refused", "restored"].includes(progress))
        throw new Error("native app remains unsettled");
      return true;
    },
  };
}
