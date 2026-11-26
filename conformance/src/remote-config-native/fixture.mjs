import { nativePayload, nativeRequest } from "./wire.mjs";

const FID = /^[A-Za-z0-9_-]{22}$/;

/** A deterministic, loopback-only backend for the first run of both instrumented SDKs. */
export function nativeFixture({ platform, projectId, projectNumber, key, appId }) {
  const owner = { projectId, projectNumber, key, installations: new Set() };
  const operations = [];
  let version = 1;
  const authToken = { token: "fixture-installations-auth-token", expiresIn: "604800s" };

  function receive(request) {
    const route = nativeRequest({ ...request, platform }, owner);
    const refuse = { status: 400, body: { error: "fixture request refused" } };
    if (!route) return refuse;
    const { operation } = route;
    const body = nativePayload(request, route, platform);
    if (!body) return refuse;

    let result;
    switch (operation) {
      case "create": {
        if (body.appId !== appId || typeof body.fid !== "string" || !FID.test(body.fid))
          return refuse;
        owner.installations.add(body.fid);
        result = {
          status: 200,
          body: {
            name: `projects/${projectId}/installations/${body.fid}`,
            fid: body.fid,
            refreshToken: "fixture-installations-refresh",
            authToken,
          },
        };
        break;
      }
      case "token":
        result = { status: 200, body: authToken };
        break;
      case "delete":
        owner.installations.delete(route.fid);
        result = { status: 200, body: {} };
        break;
      default: {
        const iosFetch = platform === "ios" && operation === "fetch";
        const installation = iosFetch ? body.app_instance_id : body.appInstanceId;
        const app = iosFetch ? body.app_id : body.appId;
        if (app !== appId || !owner.installations.has(installation)) return refuse;
        if (operation === "realtime") {
          result = { status: 200, stream: true };
        } else {
          const etag = `fixture-${version}`;
          result = {
            status: 200,
            etag,
            body:
              request.etag === etag
                ? { state: "NO_CHANGE" }
                : {
                    state: "UPDATE",
                    entries: {
                      native_value: version === 1 ? "before" : "after",
                      native_tier: "gold",
                    },
                    templateVersion: String(version),
                  },
          };
        }
      }
    }
    operations.push({
      operation,
      encoding: request.encoding ?? "identity",
      requestBytes: request.wire.length,
      ...(operation === "fetch"
        ? { state: result.body.state, conditional: Boolean(request.etag) }
        : {}),
    });
    return result;
  }

  return {
    receive,
    publish: () => ({ latestTemplateVersionNumber: ++version }),
    summary: () => ({
      installations: owner.installations.size,
      operations: structuredClone(operations),
    }),
  };
}
