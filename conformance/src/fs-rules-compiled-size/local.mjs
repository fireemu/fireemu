// Local half of the FS-9 observation: load each ladder source into a loopback fireemu daemon
// through its control route (PUT /v1/rules) and record accepted or refused with the message.
import { maskText } from "./session.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_MESSAGE = 1000;

export function rulesUrlFor(controlUrl) {
  const base = new URL(controlUrl);
  if (base.protocol !== "http:" || !LOOPBACK_HOSTS.has(base.hostname)) {
    throw new Error("the local half only talks to a loopback daemon");
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/rules`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

const clip = (text) => {
  const masked = maskText(text);
  return masked.length > MAX_MESSAGE
    ? `${masked.slice(0, MAX_MESSAGE)}...[truncated, ${masked.length} chars]`
    : masked;
};

export async function runLocal({ fetchImpl, controlUrl, token, rungs, timeoutMs = 120_000 }) {
  const url = rulesUrlFor(controlUrl);
  const headers = {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const call = async (method, body) => {
    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: response.status, text: await response.text() };
    } catch (error) {
      return { status: null, text: String(error?.name ?? "error") };
    }
  };
  const rows = [];
  for (const rung of rungs) {
    const started = performance.now();
    const res = await call("PUT", { source: rung.source });
    rows.push({
      id: rung.id,
      kind: rung.kind,
      byteLength: rung.byteLength,
      leafCount: rung.leafCount,
      status: res.status,
      accepted: res.status !== null && res.status >= 200 && res.status < 300,
      message: res.status !== null && res.status >= 200 && res.status < 300 ? null : clip(res.text),
      millis: Math.round(performance.now() - started),
    });
  }
  const reset = await call("DELETE");
  return { rows, resetStatus: reset.status };
}
