import { MAX_NATIVE_REQUEST_BYTES, nativeRequestBody } from "./wire.mjs";

const CONNECTION_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
const REFUSED = Object.freeze({ status: 400, headers: {}, body: [] });
const BAD_RESPONSE = Object.freeze({ status: 502, headers: {}, body: [] });

function endToEnd(headers) {
  const hops = new Set(CONNECTION_HEADERS);
  for (const name of String(headers.connection ?? "").split(","))
    hops.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !hops.has(name)));
}

function chunksOf(response) {
  return typeof response.body === "function" ? response.body() : response.body;
}

async function boundedResponse(response) {
  let length = 0;
  const chunks = [];
  for await (const chunk of chunksOf(response)) {
    length += chunk.length;
    if (length > MAX_NATIVE_REQUEST_BYTES) throw new Error("native response exceeds byte limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

function createdInstallation(bytes, encoding) {
  const { decoded } = nativeRequestBody(bytes, encoding);
  return JSON.parse(decoded.toString("utf8"));
}

async function* streaming(response, capture, signal, finish) {
  let bytes = 0;
  let complete = false;
  const chunks = [];
  const chunkLengths = [];
  try {
    for await (const chunk of chunksOf(response)) {
      bytes += chunk.length;
      if (capture) {
        if (bytes > MAX_NATIVE_REQUEST_BYTES)
          throw new Error("native stream exceeds capture limit");
        chunks.push(chunk);
        chunkLengths.push(chunk.length);
      }
      yield chunk;
    }
    complete = true;
  } finally {
    const termination = complete
      ? "upstream-end"
      : signal?.aborted
        ? "client-disconnect"
        : "upstream-error";
    finish(bytes, complete, termination, chunks, chunkLengths);
  }
}

/**
 * Relay a reserved SDK exchange through the caller's bounded transport. Request bytes and
 * forwarded response chunks are unchanged. Telemetry here contains no URL, credentials or bodies.
 */
export function nativeRelay({ session, dispatch, record, capture }) {
  return async function relay(request) {
    const incoming = endToEnd(request.headers);
    const ticket = session.reserve({
      ...request,
      apiKey: incoming["x-goog-api-key"],
      encoding: incoming["content-encoding"],
      authorization: incoming.authorization,
      installationAuth: incoming["x-goog-firebase-installations-auth"],
    });
    if (!ticket) return REFUSED;

    const stamp = { operation: ticket.operation, sequence: ticket.sequence };
    const requestHeaders = incoming;
    delete requestHeaders.host;
    requestHeaders["content-length"] = String(ticket.wire.length);
    let response;
    let bytes;
    let json;
    try {
      record({
        ...stamp,
        phase: "request",
        requestBytes: ticket.wire.length,
        ...capture?.request({ ...ticket, headers: requestHeaders }),
      });
      response = await dispatch({
        ...ticket,
        method: request.method,
        headers: requestHeaders,
        signal: request.signal,
      });
      session.noteStatus(response.status);
      const redirected = response.status >= 300 && response.status < 400;
      if (!redirected && (ticket.operation !== "realtime" || response.status !== 200)) {
        bytes = await boundedResponse(response);
        if (
          (ticket.operation === "create" || ticket.operation === "token") &&
          response.status === 200
        )
          json = createdInstallation(bytes, response.headers["content-encoding"]);
      }
    } catch {
      response?.abort?.();
      session.settle(ticket, { status: null });
      record({ ...stamp, phase: "incomplete", status: response?.status ?? null });
      return BAD_RESPONSE;
    }

    if (response.status >= 300 && response.status < 400) {
      response.abort?.();
      session.settle(ticket, { status: response.status });
      record({ ...stamp, phase: "blocked-redirect", status: response.status });
      return BAD_RESPONSE;
    }
    const headers = endToEnd(response.headers);
    if (bytes === undefined) {
      return {
        status: response.status,
        headers,
        body: streaming(
          response,
          capture,
          request.signal,
          (responseBytes, complete, termination, chunks, chunkLengths) => {
            session.settle(ticket, { status: response.status });
            if (responseBytes === 0 || termination === "upstream-error") session.noteStatus(null);
            let projection;
            try {
              if (capture && responseBytes > MAX_NATIVE_REQUEST_BYTES)
                throw new Error("native stream exceeds capture limit");
              projection = capture?.stream({ wire: Buffer.concat(chunks), headers, chunkLengths });
            } catch {
              session.noteStatus(null);
              record({ ...stamp, phase: "capture-error", status: response.status, responseBytes });
              return;
            }
            record({
              ...stamp,
              phase: "stream",
              status: response.status,
              responseBytes,
              complete,
              termination,
              ...projection,
            });
          },
        ),
      };
    }
    session.settle(ticket, { status: response.status, json });
    let projection;
    try {
      projection = capture?.response({ ...ticket, status: response.status, wire: bytes, headers });
    } catch {
      session.noteStatus(null);
      record({
        ...stamp,
        phase: "capture-error",
        status: response.status,
        responseBytes: bytes.length,
      });
    }
    if (!capture || projection)
      record({
        ...stamp,
        phase: "response",
        status: response.status,
        responseBytes: bytes.length,
        ...projection,
      });
    return { status: response.status, headers, body: [bytes] };
  };
}
