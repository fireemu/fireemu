import { API_TARGETS, createRefused, isDeleted } from "../remote-config-web/program.mjs";

const OPERATION = /^operations\/[A-Za-z0-9._-]+$/;
export const KEY_UID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const KEY_VALUE = /^AIza[A-Za-z0-9_-]{35}$/;

function answer(response) {
  if (
    response.status !== 200 ||
    !response.json ||
    typeof response.json !== "object" ||
    Array.isArray(response.json)
  )
    throw new Error("native key did not return a complete response");
  return response.json;
}

/** An ephemeral SDK-only key scoped to an observation pass and the exact sandbox project. */
export function nativeKeyControl({
  transport,
  urls,
  grants,
  number,
  name,
  pause,
  polls,
  beforeCreate,
}) {
  if (
    !/^[0-9]{6,18}$/.test(number) ||
    !/^[a-z][a-z0-9-]{1,48}$/.test(name) ||
    !Number.isSafeInteger(polls) ||
    polls < 1
  )
    throw new Error("invalid native key scope");
  const keyName = new RegExp(`^projects/${number}/locations/global/keys/[A-Za-z0-9_-]+$`);
  let state = "unseen";

  async function operation(initial, phase) {
    const id = initial.name;
    if (typeof id !== "string" || !OPERATION.test(id))
      throw new Error("native key operation locator invalid");
    let current = initial;
    grants.operations.add(id);
    try {
      for (let attempt = 0; attempt <= polls; attempt++) {
        if (current.done === true) {
          if (current.error || !current.response || typeof current.response !== "object")
            throw new Error("native key operation did not complete successfully");
          return current.response;
        }
        if (attempt === polls) break;
        await pause();
        current = answer(
          await transport.send(`native-key-${phase}-poll-${attempt + 1}`, urls.keysApi + id),
        );
        if (current.name !== id) throw new Error("native key operation changed identity");
      }
      throw new Error("native key operation did not finish within its budget");
    } finally {
      grants.operations.delete(id);
    }
  }

  async function create() {
    if (state !== "unseen") throw new Error("native key creation already attempted");
    const baseline = answer(await transport.send("native-key-baseline", urls.keysList));
    const keys = baseline.keys ?? [];
    if (
      baseline.nextPageToken ||
      !Array.isArray(keys) ||
      keys.some(
        (key) =>
          !key || typeof key.name !== "string" || (key.displayName === name && !isDeleted(key)),
      )
    )
      throw new Error("native key baseline incomplete or occupied");
    state = "create-pending";
    const first = await transport.send("native-key-create", urls.keysCreate, {
      method: "POST",
      beforeDispatch: beforeCreate,
      body: {
        displayName: name,
        restrictions: { apiTargets: API_TARGETS.map((service) => ({ service })) },
      },
      secret: true,
    });
    if (createRefused(first)) {
      state = "refused";
      throw new Error("native key creation refused");
    }
    const key = await operation(answer(first), "create");
    if (!keyName.test(key.name) || (key.displayName !== undefined && key.displayName !== name))
      throw new Error("native key create returned an unowned resource");
    grants.key = key.name;
    state = "created";
    const value = answer(
      await transport.send("native-key-value", `${urls.keysApi}${grants.key}/keyString`, {
        secret: true,
      }),
    );
    if (!KEY_VALUE.test(value.keyString) || (value.name !== undefined && value.name !== grants.key))
      throw new Error("native key value is unreadable");
    if (!KEY_UID.test(key.uid)) throw new Error("native key UID is unreadable");
    return { value: value.keyString, uid: key.uid };
  }

  async function remove() {
    if (!grants.key || state !== "created") return state === "refused" || state === "unseen";
    state = "delete-pending";
    const first = answer(
      await transport.send("native-key-delete", urls.keysApi + grants.key, { method: "DELETE" }),
    );
    const done = await operation(first, "delete");
    if (done.name !== grants.key) return false;
    const after = answer(await transport.send("native-key-after", urls.keysApi + grants.key));
    if (after.name !== grants.key || !isDeleted(after)) return false;
    state = "deleted";
    return true;
  }

  return { create, remove, closed: () => ["unseen", "refused", "deleted"].includes(state) };
}
