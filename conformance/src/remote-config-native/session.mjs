import { nativePayload, nativeRequest } from "./wire.mjs";

const FID = /^[A-Za-z0-9_-]{22}$/;

export function nativeBudget(cap, cleanupReserve) {
  if (
    !Number.isSafeInteger(cap) ||
    !Number.isSafeInteger(cleanupReserve) ||
    cleanupReserve < 1 ||
    cleanupReserve >= cap
  ) {
    throw new RangeError("invalid native request budget");
  }
  let used = 0;
  let stopped = false;
  return {
    reserve(cleanup) {
      if (used >= cap || (!cleanup && (stopped || used >= cap - cleanupReserve))) return null;
      return ++used;
    },
    stop: () => {
      stopped = true;
    },
    used: () => used,
    stopped: () => stopped,
  };
}

function confirmedCreate(body, fid) {
  return (
    body?.fid === fid &&
    typeof body.refreshToken === "string" &&
    body.refreshToken.length > 0 &&
    typeof body.authToken?.token === "string" &&
    body.authToken.token.length > 0
  );
}

const succeeded = (status) => Number.isInteger(status) && status >= 200 && status < 300;

/** In-memory ownership and count admission for one fresh app in a pass. */
export function nativeSession({ platform, projectId, projectNumber, key, appId, budget }) {
  const owner = { projectId, projectNumber, key, installations: new Set() };
  const states = new Map();
  const credentials = new Map();
  const reservations = new Set();

  function reserve(request) {
    const route = nativeRequest({ ...request, platform }, owner);
    if (!route) return null;
    const body = nativePayload(request, route, platform);
    if (!body) return null;

    const { operation } = route;
    let fid = route.fid;
    if (operation === "create") {
      fid = body.fid;
      if (body.appId !== appId || typeof fid !== "string" || !FID.test(fid) || states.size !== 0)
        return null;
    } else if (route.service !== "installations") {
      const iosFetch = platform === "ios" && operation === "fetch";
      fid = iosFetch ? body.app_instance_id : body.appInstanceId;
      const requestApp = iosFetch ? body.app_id : body.appId;
      if (requestApp !== appId || !owner.installations.has(fid)) return null;
      const { issued } = credentials.get(fid);
      if (!issued.has(request.installationAuth)) return null;
      if (operation === "fetch") {
        const token = iosFetch ? body.app_instance_id_token : body.appInstanceIdToken;
        if (token !== request.installationAuth) return null;
      } else {
        const version = body.lastKnownVersionNumber;
        const versionValid = typeof version === "string" && /^(?:0|[1-9]\d{0,18})$/.test(version);
        if (body.project !== projectNumber || body.namespace !== "firebase" || !versionValid)
          return null;
      }
    } else if (request.authorization !== `FIS_v2 ${credentials.get(fid)?.refresh}`) {
      return null;
    }

    const sequence = budget.reserve(operation === "delete");
    if (sequence === null) return null;
    if (operation === "create") states.set(fid, "create-pending");
    if (operation === "delete") {
      owner.installations.delete(fid);
      states.set(fid, "delete-pending");
    }
    const ticket = Object.freeze({ ...route, fid, sequence, wire: request.wire });
    reservations.add(ticket);
    return ticket;
  }

  function settle(ticket, { status, json }) {
    if (!reservations.delete(ticket)) throw new Error("unknown native request reservation");
    const ok = noteStatus(status);

    const { operation, fid } = ticket;
    if (operation === "create") {
      if (ok && confirmedCreate(json, fid)) {
        owner.installations.add(fid);
        credentials.set(fid, {
          refresh: json.refreshToken,
          issued: new Set([json.authToken.token]),
        });
        states.set(fid, "registered");
      } else {
        budget.stop();
        states.set(fid, "unknown");
      }
    } else if (operation === "delete") {
      states.set(fid, ok ? "deleted" : "unknown");
    } else if (operation === "token" && ok) {
      if (typeof json?.token !== "string" || json.token.length === 0) budget.stop();
      else credentials.get(fid).issued.add(json.token);
    }
  }

  function noteStatus(status) {
    const ok = succeeded(status);
    if (!ok) budget.stop();
    return ok;
  }

  return {
    reserve,
    settle,
    noteStatus,
    canClose: () =>
      reservations.size === 0 && [...states.values()].every((state) => state === "deleted"),
  };
}
