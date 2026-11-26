import { API_TARGETS, createRefused, isDeleted } from "../remote-config-web/program.mjs";

const OPERATION = /^operations\/[A-Za-z0-9._-]+$/;
export const KEY_UID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const KEY_VALUE = /^AIza[A-Za-z0-9_-]{35}$/;

function answer(response) {
  if (
    response.status !== 200 ||
    !response.json ||
    typeof response.json !== "object" ||
    Array.isArray(response.json) ||
    "error" in response.json
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
  let baselineNames;

  async function activeKeys(phase) {
    const current = answer(await transport.send(phase, urls.keysList));
    const keys = Object.hasOwn(current, "keys") ? current.keys : [];
    if (
      Object.hasOwn(current, "nextPageToken") ||
      !Array.isArray(keys) ||
      keys.some((key) => !keyName.test(key?.name) || isDeleted(key))
    )
      throw new Error("native active key listing is incomplete");
    const names = keys.map((key) => key.name).toSorted();
    if (new Set(names).size !== names.length)
      throw new Error("native active key listing repeats an identity");
    return { keys, names };
  }

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
          await transport.send(`native-key-${phase}-poll-${attempt + 1}`, urls.keysApi + id, {
            secret: true,
          }),
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
    const listing = await activeKeys("native-key-baseline");
    if (listing.keys.some((key) => key.displayName === name))
      throw new Error("native key baseline is occupied");
    baselineNames = listing.names;
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
    if (baselineNames.includes(key.name))
      throw new Error("native key create returned a preexisting resource");
    grants.key = key.name;
    const verified = answer(
      await transport.send("native-key-owned", urls.keysApi + grants.key, { secret: true }),
    );
    if (
      verified.name !== grants.key ||
      verified.displayName !== name ||
      !KEY_UID.test(verified.uid) ||
      (key.uid !== undefined && verified.uid !== key.uid) ||
      isDeleted(verified)
    )
      throw new Error("native managed key ownership read-back failed");
    state = "created";
    const targets = verified.restrictions?.apiTargets;
    if (
      !Array.isArray(targets) ||
      targets.length !== API_TARGETS.length ||
      !API_TARGETS.every((service) =>
        targets.some((target) => target?.service === service && !target.methods?.length),
      ) ||
      Object.keys(verified.restrictions).some((entry) => entry !== "apiTargets")
    )
      throw new Error("native managed key API restrictions changed");
    const value = answer(
      await transport.send("native-key-value", `${urls.keysApi}${grants.key}/keyString`, {
        secret: true,
      }),
    );
    if (!KEY_VALUE.test(value.keyString) || (value.name !== undefined && value.name !== grants.key))
      throw new Error("native key value is unreadable");
    return { value: value.keyString, uid: verified.uid };
  }

  async function remove() {
    if (!grants.key || state !== "created") return state === "refused" || state === "unseen";
    state = "delete-pending";
    const first = answer(
      await transport.send("native-key-delete", urls.keysApi + grants.key, {
        method: "DELETE",
        secret: true,
      }),
    );
    const done = await operation(first, "delete");
    if (done.name !== grants.key) return false;
    const after = answer(
      await transport.send("native-key-after", urls.keysApi + grants.key, { secret: true }),
    );
    if (after.name !== grants.key || !isDeleted(after)) return false;
    const { names } = await activeKeys("native-key-baseline-after");
    if (
      names.length !== baselineNames.length ||
      names.some((item, index) => item !== baselineNames[index])
    )
      return false;
    state = "deleted";
    return true;
  }

  return { create, remove, closed: () => ["unseen", "refused", "deleted"].includes(state) };
}
