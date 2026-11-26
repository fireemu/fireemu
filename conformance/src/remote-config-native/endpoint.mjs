import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { pipeline } from "node:stream/promises";

import { MAX_NATIVE_REQUEST_BYTES } from "./wire.mjs";

const HOST = {
  fetch: "firebaseremoteconfig.googleapis.com",
  realtime: "firebaseremoteconfigrealtime.googleapis.com",
  installations: "firebaseinstallations.googleapis.com",
};
const TARGET = {
  fetch: /^\/v1\/projects\/[A-Za-z0-9-]+\/namespaces\/firebase:fetch(?:\?key=[A-Za-z0-9_-]+)?$/,
  realtime:
    /^\/v1\/projects\/[A-Za-z0-9-]+\/namespaces\/firebase:streamFetchInvalidations(?:\?key=[A-Za-z0-9_-]+)?$/,
  create: /^\/v1\/projects\/[A-Za-z0-9-]+\/installations\/?$/,
  token: /^\/v1\/projects\/[A-Za-z0-9-]+\/installations\/[A-Za-z0-9_-]{22}\/authTokens:generate$/,
  delete: /^\/v1\/projects\/[A-Za-z0-9-]+\/installations\/[A-Za-z0-9_-]{22}\/?$/,
};
const validPort = (port) => Number.isSafeInteger(port) && port > 0 && port <= 65_535;
const loopback = (address) => {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(address ?? "");
  if (!match || !validPort(Number(match[1]))) throw new Error("expected literal loopback endpoint");
  return Number(match[1]);
};

/** A second boundary after nativeSession, with no proxy hosts or arbitrary destinations. */
export function nativeDestination({ kind, remoteConfig, installations }) {
  if (kind !== "local" && kind !== "oracle") throw new Error("unknown native transport mode");
  const local = kind === "local";
  const rcPort = local ? loopback(remoteConfig) : undefined;
  const fisPort = local ? loopback(installations) : undefined;
  return ({ service, operation, method, path, headers, wire }) => {
    const config = operation === "fetch" || operation === "realtime";
    if (
      (config ? service !== operation : service !== "installations") ||
      (operation === "delete" ? method !== "DELETE" : method !== "POST") ||
      !Object.hasOwn(TARGET, operation) ||
      !TARGET[operation].test(path)
    )
      return null;
    return {
      protocol: local ? "http:" : "https:",
      hostname: local ? "127.0.0.1" : HOST[service],
      port: config ? rcPort : fisPort,
      method,
      path,
      headers,
      wire,
    };
  };
}

export function nativeDispatch(destination, timeoutMs) {
  return (ticket) => {
    const dest = destination(ticket);
    if (!dest) throw new Error("invalid reserved SDK target");
    const { wire, ...options } = dest;
    return new Promise((resolve, reject) => {
      const request = (dest.protocol === "https:" ? httpsRequest : httpRequest)(
        {
          ...options,
          signal: ticket.signal,
          agent: false,
        },
        (res) => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: res,
            abort: () => res.destroy(),
          });
        },
      );
      request.setTimeout(timeoutMs, () =>
        request.destroy(new Error("native request deadline exceeded")),
      );
      request.once("error", reject);
      request.end(wire);
    });
  };
}

async function receive(relay, req, res) {
  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_NATIVE_REQUEST_BYTES) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  const answer = await relay({
    target: req.url,
    method: req.method,
    headers: req.headers,
    wire: Buffer.concat(chunks, bytes),
    signal: controller.signal,
  });
  res.writeHead(answer.status, answer.headers);
  res.flushHeaders();
  await pipeline(answer.body, res);
}

/** Bind a caller-claimed port on loopback and own every connection until close. */
export async function openNativeListener(relay, port) {
  if (!validPort(port)) throw new Error("native listener needs a claimed port");
  const sockets = new Set();
  const pending = new Set();
  const server = createServer({ requestTimeout: 20_000, headersTimeout: 10_000 }, (req, res) => {
    const work = receive(relay, req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end();
    });
    pending.add(work);
    work.then(() => pending.delete(work));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const listening = once(server, "listening");
  server.listen(port, "127.0.0.1");
  await listening;
  return {
    async close() {
      const closed = once(server, "close");
      server.close();
      for (const socket of sockets) socket.destroy();
      await closed;
      await Promise.all(pending);
    },
  };
}
