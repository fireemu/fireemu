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
   */
  constructor({ out, allow, token, maxRequests, timeoutMs, fetchImpl = fetch, userProject }) {
    Object.assign(this, { out, allow, token, maxRequests, timeoutMs, fetchImpl, userProject });
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
  async send(caseId, url, { method = "GET", body, ifMatch, signed = false, raw } = {}) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(caseId)) throw new Error(`invalid case id ${caseId}`);
    const target = new URL(url);
    if (!this.allow(target, method, { signed }))
      throw new Error(`${caseId}: request not permitted`);
    if (this.count >= this.maxRequests) throw new Error(`${caseId}: request cap reached`);
    const headers = { "accept-encoding": "gzip" };
    if (!signed) {
      headers.authorization = `Bearer ${await this.token()}`;
      if (this.userProject) headers["x-goog-user-project"] = this.userProject;
    }
    let payload;
    if (raw !== undefined) {
      payload = raw;
      headers["content-type"] = "application/zip";
      if (signed && target.pathname.includes("gcf-upload"))
        headers["x-goog-content-length-range"] = "0,104857600";
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["content-type"] = "application/json";
    }
    if (ifMatch !== undefined) headers["if-match"] = ifMatch;
    this.count += 1;
    const seq = this.count;
    // A signed URL's query is a credential: journal the path only.
    const shown = signed ? `${target.origin}${target.pathname}` : target.href;
    this.journal({ seq, case: caseId, phase: "before-send", method, url: shown, ifMatch });
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
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      return this.fail(seq, caseId, `transport: ${error?.name ?? "error"}`, response?.status);
    }
    const file = `${String(seq).padStart(3, "0")}-${caseId}.body`;
    writeFileSync(join(this.out, file), bytes);
    const etag = response.headers.get("etag");
    const contentType = response.headers.get("content-type");
    this.journal({
      seq,
      case: caseId,
      phase: "response-persisted",
      status: response.status,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      etag,
      contentType,
      contentEncoding: response.headers.get("content-encoding"),
      file,
    });
    const status = response.status;
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
        return this.fail(seq, caseId, "unreadable body", status);
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
