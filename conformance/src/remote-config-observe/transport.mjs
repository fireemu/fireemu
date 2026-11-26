// Bounded, journaled HTTP transport for the Remote Config observation. Every request is journaled
// before it is sent; every answer is persisted with its byte length and sha256 before the caller
// sees it. A status below 200, a 3xx, a 5xx, a transport error, a timeout and an unreadable body are
// unknown: the journal says so and the call throws Unknown, which the caller never settles by a later
// absence.
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class Unknown extends Error {
  constructor(caseId, reason) {
    super(`${caseId}: unknown answer (${reason})`);
    this.caseId = caseId;
  }
}

export class Transport {
  /**
   * @param {object} o
   * @param {string} o.out run directory (exists)
   * @param {(url: URL, method: string) => boolean} o.allow the closed set of permitted requests
   * @param {() => Promise<string>|string} o.token bearer token source (never journaled)
   * @param {number} o.maxRequests hard request cap of the run
   * @param {number} o.timeoutMs per request
   * @param {typeof fetch} [o.fetchImpl]
   * @param {string} [o.userProject] x-goog-user-project for Google APIs
   * @param {(text: string) => string} [o.redact] masks known secret values in a body before it is
   *   first written (the body file and its digest are of the masked bytes)
   */
  constructor({
    out,
    allow,
    token,
    maxRequests,
    timeoutMs,
    fetchImpl = fetch,
    userProject,
    redact,
  }) {
    Object.assign(this, {
      out,
      allow,
      token,
      maxRequests,
      timeoutMs,
      fetchImpl,
      userProject,
      redact,
    });
    this.count = 0;
    this.unknown = [];
  }

  journal(row) {
    appendFileSync(
      join(this.out, "journal.jsonl"),
      JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n",
    );
  }

  /**
   * @returns {Promise<{status: number, etag: string|null, json: any, bytes: number, text: string}>}
   */
  async send(
    caseId,
    url,
    {
      method = "GET",
      body,
      ifMatch,
      signed = false,
      raw,
      contentLengthRange = false,
      credentials = true,
      gzip = true,
      ifNoneMatch,
      textBody = false,
      textErrorStatuses = [],
      notModified = false,
      secret = false,
      beforeDispatch,
    } = {},
  ) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(caseId)) throw new Error(`invalid case id ${caseId}`);
    const target = new URL(url);
    if (!this.allow(target, method, { signed }))
      throw new Error(`${caseId}: request not permitted`);
    if (this.count >= this.maxRequests) throw new Error(`${caseId}: request cap reached`);
    // Reserve the slot before the first await (RC-CLOSURE-A ruling 7 item 3).
    const seq = ++this.count;
    // `gzip: false` asks for identity, `credentials: false` sends no Authorization (the recorded
    // unauthenticated read), `textBody: true` keeps a 2xx body that is not JSON (a defaults file),
    // `notModified: true` takes a 304 as an answer (the conditional read).
    const headers = gzip ? { "accept-encoding": "gzip" } : { "accept-encoding": "identity" };
    if (!signed && credentials) {
      headers.authorization = `Bearer ${await this.token()}`;
      if (this.userProject) headers["x-goog-user-project"] = this.userProject;
    }
    let payload;
    if (raw !== undefined) {
      payload = raw;
      headers["content-type"] = "application/zip";
      // Chosen by the caller from the request's role (the Gen1 upload), never from the URL.
      if (contentLengthRange) headers["x-goog-content-length-range"] = "0,104857600";
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["content-type"] = "application/json";
    }
    if (ifMatch !== undefined) headers["if-match"] = ifMatch;
    if (ifNoneMatch !== undefined) headers["if-none-match"] = ifNoneMatch;
    // A signed URL's query is a credential: journal the path only.
    const shown = signed ? `${target.origin}${target.pathname}` : target.href;
    // A journaled copy of a header value is masked as a body is (RC-CLOSURE-B ruling 20); the
    // request itself keeps the original value.
    const masked = (value) =>
      typeof value === "string" && this.redact ? this.redact(value) : value;
    // Authentication may have yielded to a stop signal. Check again without yielding before
    // the fetch. A refused dispatch still consumes its reserved slot.
    beforeDispatch?.();
    this.journal({
      seq,
      case: caseId,
      phase: "before-send",
      method,
      url: shown,
      ifMatch: masked(ifMatch),
      ...(credentials ? {} : { credentials: false }),
      ...(gzip ? {} : { gzip: false }),
      ...(ifNoneMatch === undefined ? {} : { ifNoneMatch: masked(ifNoneMatch) }),
    });
    let response;
    let bytes;
    try {
      response = await this.fetchImpl(target, {
        method,
        headers,
        body: payload,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      // The status is known when the headers arrive, before the body is read (ruling 20).
      this.onStatus?.(caseId, response.status);
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      return this.fail(seq, caseId, `transport: ${error?.name ?? "error"}`, response?.status);
    }
    // `secret: true` (an API key's value): the body is neither persisted nor digested; the journal
    // keeps its status and length only, and the caller holds the value in memory.
    const file = secret ? null : `${String(seq).padStart(3, "0")}-${caseId}.body`;
    // A known secret in a body is masked before the first write (RC-CLOSURE-B ruling 19 item 2).
    let persisted = bytes;
    if (file && this.redact) {
      const text = bytes.toString("utf8");
      const masked = this.redact(text);
      if (masked !== text) persisted = Buffer.from(masked, "utf8");
    }
    if (file) writeFileSync(join(this.out, file), persisted);
    const etag = response.headers.get("etag");
    // A secret answer's row is the closed set {seq, case, phase, status, bytes, file, secret}: no
    // header value of it is journaled (an ETag, a content type or an encoding can carry anything).
    this.journal(
      secret
        ? {
            seq,
            case: caseId,
            phase: "response-persisted",
            status: response.status,
            bytes: bytes.length,
            file,
            secret: true,
          }
        : {
            seq,
            case: caseId,
            phase: "response-persisted",
            status: response.status,
            bytes: bytes.length,
            sha256: createHash("sha256").update(persisted).digest("hex"),
            ...(persisted === bytes ? {} : { redacted: true }),
            etag: masked(etag),
            contentType: masked(response.headers.get("content-type")),
            contentEncoding: masked(response.headers.get("content-encoding")),
            file,
          },
    );
    const status = response.status;
    // `notModified: true` (a conditional read) takes a 304 as a complete answer with no body.
    if (notModified && status === 304)
      return { status, etag, json: null, bytes: bytes.length, text: "" };
    if (status < 200 || (status >= 300 && status < 400) || status >= 500)
      return this.fail(seq, caseId, `status ${status}`, status);
    const text = bytes.toString("utf8");
    // An empty body reads as {} (the recorded unpublished client template is `200 {}`); a body
    // that is not JSON is unknown. Signed uploads answer XML or nothing and are not parsed.
    let json = {};
    if (text.length && !signed) {
      try {
        json = JSON.parse(text);
      } catch {
        if (!(textBody && ((status >= 200 && status < 300) || textErrorStatuses.includes(status))))
          return this.fail(seq, caseId, "unreadable body", status);
        json = null;
      }
    }
    return { status, etag, json, bytes: bytes.length, text };
  }

  fail(seq, caseId, reason, status) {
    this.journal({ seq, case: caseId, phase: "unknown", reason, status: status ?? null });
    this.unknown.push(caseId);
    throw new Unknown(caseId, reason);
  }
}
