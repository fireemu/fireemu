import { performance } from "node:perf_hooks";

function parse(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function verifiedReconnect(first, second, { version }) {
  return (
    first?.status === 200 &&
    Number.isFinite(first.disconnectedAt) &&
    first.ended === "error:AbortError" &&
    first.finishedAt >= first.disconnectedAt &&
    second?.n > first.n &&
    second.at >= first.finishedAt &&
    String(parse(second.requestBody)?.lastKnownVersionNumber) === version
  );
}

export function streamWindow(entry, sampledAt) {
  const answered = Number.isFinite(entry.answeredAt);
  const finished = Number.isFinite(entry.finishedAt);
  const limit = entry.finishedAt ?? sampledAt;
  return {
    preHeadersMs: (entry.answeredAt ?? limit) - entry.at,
    preHeadersCensored: !answered && !finished,
    postHeadersMs: answered ? limit - entry.answeredAt : null,
    postHeadersCensored: answered ? !finished : null,
    terminal: entry.ended ?? entry.error ?? null,
  };
}

export const PRODUCTION_WINDOWS = {
  headerMs: 75_000,
  reopenMs: 30_000,
  lifetimeMs: 10 * 60_000,
};

const stream = (row) => row.path.endsWith(":streamFetchInvalidations");
const isFetch = (row) => row.path.endsWith(":fetch");
const versionInReply = (row) => String(parse(row.responseBody)?.templateVersion);
const untilFound = async (client, until, select, ms) => {
  let found;
  await until(async () => {
    found = select(await client.wire());
    return found !== undefined;
  }, ms);
  return found;
};

export async function runRealtimeFollowup({
  client,
  gate,
  until,
  writeVersion,
  timing,
  windows = PRODUCTION_WINDOWS,
  now = () => performance.now(),
}) {
  const read = async (n) => (await client.wire()).find((entry) => entry.n === n);
  await gate();
  await client.call("listen");
  const first = await untilFound(client, until, (rows) => rows.find(stream), timing.streamOpenMs);
  if (!first) throw new Error("initial SDK stream did not dispatch");
  const idle = await untilFound(
    client,
    until,
    (rows) => rows.find((row) => row.n === first.n && row.status !== null),
    windows.headerMs,
  );
  const idleWindow = streamWindow(idle ?? (await read(first.n)), await client.call("sampleTime"));
  const warmed = await writeVersion("x-warm", "warm");
  const warmFetch = await untilFound(
    client,
    until,
    (rows) => rows.find((row) => isFetch(row) && versionInReply(row) === warmed),
    timing.updateWindowMs,
  );
  const warmStream = await read(first.n);
  if (!warmFetch || warmStream?.status !== 200 || !warmStream.chunks?.length || warmStream.ended)
    throw new Error("first stream did not establish");
  const activated = await client.call("activateOnly");
  if (!activated.activated) throw new Error("warm template was not activated");
  await gate();
  if (!(await client.call("abortRealtime", first.n)))
    throw new Error("first stream was not disconnected");

  const second = await untilFound(
    client,
    until,
    (rows) => {
      const closed = rows.find((row) => row.n === first.n);
      return rows.find((row) => stream(row) && verifiedReconnect(closed, row, { version: warmed }));
    },
    windows.reopenMs,
  );
  if (!second) throw new Error("no confirmed new SDK HTTP stream in the reopen window");

  const beforeBurst = now();
  const burst1 = await writeVersion("x-burst-1", "burst-one");
  const between = now();
  const burst2 = await writeVersion("x-burst-2", "burst-two");
  const afterBurst = now();
  const burstFetch = await untilFound(
    client,
    until,
    (rows) => rows.find((row) => isFetch(row) && versionInReply(row) === burst2),
    timing.updateWindowMs,
  );
  if (!burstFetch || (await read(second.n))?.status !== 200)
    throw new Error("burst final fetch or reopened stream not confirmed");
  const final = await client.call("activateOnly");
  if (!final.activated || final.values.fireemu_message?.value !== "burst-two-premium")
    throw new Error("the final burst value was not activated");

  const terminated = await untilFound(
    client,
    until,
    (rows) => rows.find((row) => row.n === second.n && row.ended),
    windows.lifetimeMs,
  );
  const closed = await read(first.n);
  const resumed = terminated ?? (await read(second.n));
  const lifetime = streamWindow(resumed, await client.call("sampleTime"));
  return {
    idleWindow,
    first: {
      n: first.n,
      status: closed.status,
      ended: closed.ended,
      disconnectedAt: closed.disconnectedAt,
    },
    reopened: { n: resumed.n, status: resumed.status, requestVersion: warmed },
    burst: {
      versions: [burst1, burst2],
      firstStepMs: Math.round(between - beforeBurst),
      secondStepMs: Math.round(afterBurst - between),
      final,
    },
    lifetime,
  };
}

const CORS_RESPONSES = [
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-allow-credentials",
  "access-control-max-age",
  "vary",
];

export async function probePreflights({ project, key, port, localBase = null, fetchImpl = fetch }) {
  const local = localBase ? new URL(localBase) : null;
  if (
    (local &&
      (local.protocol !== "http:" ||
        local.hostname !== "127.0.0.1" ||
        !local.port ||
        local.username ||
        local.password ||
        local.search ||
        local.hash ||
        project !== "demo-rc-web")) ||
    (!local && project !== "fireemu-oracle-query") ||
    typeof key !== "string" ||
    !key ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error("unexpected preflight destination");
  const kinds = [
    ["fetch", "firebaseremoteconfig.googleapis.com", "content-encoding,content-type,if-none-match"],
    [
      "streamFetchInvalidations",
      "firebaseremoteconfigrealtime.googleapis.com",
      "content-encoding,content-type,x-goog-api-key,x-goog-firebase-installations-auth",
    ],
  ];
  const results = [];
  for (const [name, host, headers] of kinds) {
    const path = `/v1/projects/${project}/namespaces/firebase:${name}`;
    const url = new URL(path, local ?? "https://" + host);
    url.searchParams.set("key", key);
    const reply = await fetchImpl(url, {
      method: "OPTIONS",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        origin: "http://localhost:" + port,
        "access-control-request-method": "POST",
        "access-control-request-headers": headers,
      },
    });
    const saved = Object.fromEntries(
      CORS_RESPONSES.flatMap((header) => {
        const value = reply.headers.get(header);
        return value === null
          ? []
          : [
              [
                header,
                value
                  .replaceAll(key, "API_KEY")
                  .replace(/AIza[A-Za-z0-9_-]{35}|ya29\.[\w-]+/g, "CREDENTIAL"),
              ],
            ];
      }),
    );
    await reply.body?.cancel();
    if (![200, 204, 400, 404, 405].includes(reply.status))
      throw new Error(name + " preflight returned unexpected status " + reply.status);
    results.push({
      name,
      method: "OPTIONS",
      status: reply.status,
      sentHeaders: headers,
      headers: saved,
    });
  }
  return results;
}
