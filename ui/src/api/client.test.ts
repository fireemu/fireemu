import { afterEach, describe, expect, it, vi } from "vitest";
import { parseApiError, parseSse, requestText } from "./client";

describe("API errors", () => {
  it("retains a Google RPC status for conflict handling", () => {
    expect(
      parseApiError(400, {
        error: { code: 400, status: "FAILED_PRECONDITION", message: "update time changed" },
      }),
    ).toEqual({ status: 400, code: "FAILED_PRECONDITION", message: "update time changed" });
  });
});

describe("server-sent event parsing", () => {
  it("returns complete events and keeps the remainder", () => {
    const { events, rest } = parseSse(
      'event: ready\ndata: {"a":1}\n\n: keep-alive\n\nevent: commit\ndata: {"b":2}\n\nevent: partial\ndata: {',
    );
    expect(events).toEqual([
      { event: "ready", data: '{"a":1}' },
      { event: "commit", data: '{"b":2}' },
    ]);
    expect(rest).toBe("event: partial\ndata: {");
  });

  it("joins multi-line data and defaults the event name", () => {
    const { events } = parseSse("data: one\ndata: two\n\n");
    expect(events).toEqual([{ event: "message", data: "one\ntwo" }]);
  });
});

describe("server-sent event edge cases", () => {
  it("skips an empty leading block and keeps parsing", () => {
    expect(parseSse("\n\ndata: x\n\n").events).toEqual([{ event: "message", data: "x" }]);
  });

  it("reads a data line with no value and one with no colon as empty data", () => {
    expect(parseSse("data:\n\n").events).toEqual([{ event: "message", data: "" }]);
    expect(parseSse("data\n\n").events).toEqual([{ event: "message", data: "" }]);
  });

  it("strips exactly one leading space of a value", () => {
    expect(parseSse("data:a b\n\n").events[0]?.data).toBe("a b");
    expect(parseSse("data:  two\n\n").events[0]?.data).toBe(" two");
  });

  it("ignores fields other than event and data", () => {
    expect(parseSse("id: 1\nretry: 5\ndata: x\n\n").events).toEqual([
      { event: "message", data: "x" },
    ]);
    expect(parseSse("id: 1\n\n").events).toEqual([]);
  });
});

describe("requestText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards extraHeaders and returns status, body, and etag", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { etag: "etag-v1" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await requestText("PUT", "remoteconfig/v1/t", '{"a":1}', false, {
      "if-match": "etag-v0",
    });
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toEqual({ status: 200, body: '{"ok":true}', etag: "etag-v1" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["if-match"]).toBe("etag-v0");
  });

  it("rejects non-2xx with extracted JSON, plain text, or HTTP status unless inspectErrors is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"message":"stale etag"}}', { status: 412 })),
    );
    const jsonErr = await requestText("PUT", "remoteconfig/v1/t", "{}");
    expect(jsonErr.isErr()).toBe(true);
    expect(jsonErr._unsafeUnwrapErr()).toEqual({ status: 412, message: "stale etag" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{}}', { status: 500 })),
    );
    const fallbackJson = await requestText("GET", "remoteconfig/v1/t");
    expect(fallbackJson.isErr()).toBe(true);
    expect(fallbackJson._unsafeUnwrapErr()).toEqual({ status: 500, message: '{"error":{}}' });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    const emptyErr = await requestText("GET", "remoteconfig/v1/t");
    expect(emptyErr.isErr()).toBe(true);
    expect(emptyErr._unsafeUnwrapErr()).toEqual({ status: 503, message: "HTTP 503" });

    const inspected = await requestText("GET", "remoteconfig/v1/t", undefined, true);
    expect(inspected.isOk()).toBe(true);
    expect(inspected._unsafeUnwrap()).toEqual({ status: 503, body: "", etag: null });
  });
});
