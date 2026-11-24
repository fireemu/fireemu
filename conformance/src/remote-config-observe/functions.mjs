// Cloud Functions Gen1 and Gen2 deployment and removal of the two disposable handlers, by the direct
// REST calls the 2026-11-21 campaign recorded (no API enablement, no IAM change), and the Cloud
// Logging read of what they received. Production only; one deploy at a time.
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { REGION } from "./plan.mjs";
import { Unknown } from "./transport.mjs";

export const GCF = "https://cloudfunctions.googleapis.com";
export const LOGGING = "https://logging.googleapis.com/v2/entries:list";
export const STORAGE = "https://storage.googleapis.com/storage/v1/";
export const EVENTARC = "https://eventarc.googleapis.com/v1/";
export const RUN = "https://run.googleapis.com/v2/";
export const POLLS = 40;
export const POLL_MS = 7000;

const HANDLER = new URL("./function/index.cjs", import.meta.url);
const PACKAGE = {
  name: "fireemu-remote-config-observe",
  private: true,
  version: "0.0.0",
  main: "index.js",
  engines: { node: "22" },
  dependencies: { "@google-cloud/functions-framework": "3.5.0" },
};

/** A stored (uncompressed) zip of the handler and its package.json. */
export function sourceArchive() {
  const files = [
    ["package.json", Buffer.from(JSON.stringify(PACKAGE))],
    ["index.js", readFileSync(HANDLER)],
  ];
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0021, 12); // DOS date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Functions {
  /**
   * @param {object} o
   * @param {import("./transport.mjs").Transport} o.transport
   * @param {string} o.project
   * @param {string} o.number the project number (private; only compared, never journaled by us)
   * @param {ReturnType<typeof import("./plan.mjs").names>} o.names
   * @param {string} o.runId
   * @param {(ms: number) => Promise<void>} [o.wait]
   */
  constructor({ transport, project, number, names, runId, grants = newGrants(), wait = sleep }) {
    Object.assign(this, { t: transport, project, number, names, runId, grants, wait });
    this.parent = `projects/${project}/locations/${REGION}`;
    // Per generation: created = create operation read done without error and function ACTIVE;
    // pending = create sent but not settled; refused = create answered a complete 4xx (no
    // operation); open = reasons the run cannot settle in-run.
    this.state = { 1: {}, 2: {} };
    this.source2 = null;
    this.open = [];
  }

  url(generation) {
    return `${GCF}/v${generation}/${this.parent}/functions/${this.names[`gen${generation}`]}`;
  }

  config(generation, upload) {
    const base = {
      name: `${this.parent}/functions/${this.names[`gen${generation}`]}`,
      description: "Disposable Fireemu Remote Config observation",
      labels: this.names.label,
    };
    const env = { FIREEMU_RC_OBSERVE_RUN: this.runId };
    if (generation === 1)
      return {
        ...base,
        runtime: "nodejs22",
        entryPoint: "rcObserveV1",
        sourceUploadUrl: upload,
        availableMemoryMb: 128,
        timeout: "15s",
        environmentVariables: env,
        eventTrigger: {
          eventType: "google.firebase.remoteconfig.update",
          resource: `projects/${this.project}`,
          service: "firebaseremoteconfig.googleapis.com",
        },
      };
    return {
      ...base,
      buildConfig: {
        runtime: "nodejs22",
        entryPoint: "rcObserveV2",
        source: { storageSource: upload },
      },
      serviceConfig: {
        availableMemory: "256M",
        timeoutSeconds: 15,
        maxInstanceCount: 1,
        environmentVariables: env,
      },
      eventTrigger: {
        triggerRegion: "global",
        eventType: "google.firebase.remoteconfig.remoteConfig.v1.updated",
        retryPolicy: "RETRY_POLICY_DO_NOT_RETRY",
      },
    };
  }

  async upload(generation) {
    const g = await this.t.send(
      `gen${generation}-upload-url`,
      `${GCF}/v${generation}/${this.parent}/functions:generateUploadUrl`,
      { method: "POST", body: {} },
    );
    if (g.status !== 200 || typeof g.json.uploadUrl !== "string")
      throw new Error(`gen${generation} upload url refused`);
    const signed = new URL(g.json.uploadUrl);
    if (signed.protocol !== "https:" || signed.host !== "storage.googleapis.com")
      throw new Error("unexpected upload host");
    let target = g.json.uploadUrl;
    if (generation === 1) {
      // Recorded 2026-11-21: `/uploads-<digits>.<region>.cloudfunctions.appspot.com/<uuid>.zip`
      // with a V2 signature (GoogleAccessId, Expires, Signature).
      const [, bucket, object] = decodeURIComponent(signed.pathname).split("/");
      if (
        !/^[a-z0-9][a-z0-9._-]{5,150}$/.test(bucket ?? "") ||
        !/^[A-Za-z0-9_-]+\.zip$/.test(object ?? "")
      )
        throw new Error("unexpected Gen1 upload locator");
    } else {
      const storage = g.json.storageSource ?? {};
      const bucket = `gcf-v2-uploads-${this.number}.${REGION}.cloudfunctions.appspot.com`;
      if (storage.bucket !== bucket || typeof storage.object !== "string" || !storage.object)
        throw new Error("upload bucket outside the sandbox");
      if (decodeURIComponent(signed.pathname) !== `/${bucket}/${storage.object}`)
        throw new Error("signed URL does not match the source object");
      this.source2 = { ...storage };
      this.grants.source = { ...storage };
      target = storage;
    }
    this.grants.signed.add(g.json.uploadUrl);
    // The Gen1 upload sends the length-range header, as the one recorded successful Gen1 upload
    // did (2026-11-21); the Gen2 upload sends none, as recorded.
    const put = await this.t.send(`gen${generation}-upload`, g.json.uploadUrl, {
      method: "PUT",
      raw: sourceArchive(),
      signed: true,
      contentLengthRange: generation === 1,
    });
    if (put.status !== 200) throw new Error(`gen${generation} source upload refused`);
    return target;
  }

  async operation(generation, name, prefix) {
    const pattern =
      generation === 1
        ? /^operations\/[A-Za-z0-9_.-]+$/
        : new RegExp(
            `^projects/(${this.project}|${this.number})/locations/${REGION}/operations/[A-Za-z0-9_-]+$`,
          );
    if (!pattern.test(name ?? "")) throw new Error(`${prefix}: unexpected operation name`);
    for (let i = 0; i < POLLS; i += 1) {
      const op = await this.t.send(`${prefix}-poll-${i}`, `${GCF}/v${generation}/${name}`);
      if (op.status !== 200 || op.json.name !== name) throw new Error(`${prefix}: operation read`);
      if (op.json.done) return op.json;
      await this.wait(POLL_MS);
    }
    return null; // not done within the budget: the caller records it open
  }

  /** Deploys one generation; returns true only when ACTIVE with our label. */
  async deploy(generation) {
    const s = this.state[generation];
    const upload = await this.upload(generation);
    let url = `${GCF}/v${generation}/${this.parent}/functions`;
    if (generation === 2) url += `?functionId=${this.names.gen2}`;
    s.pending = true;
    s.attempted = true;
    const created = await this.t.send(`gen${generation}-create`, url, {
      method: "POST",
      body: this.config(generation, upload),
    });
    if (created.status !== 200) {
      s.pending = false;
      s.refused = created.status; // a complete 4xx and no operation: nothing was created
      return false;
    }
    const done = await this.operation(generation, created.json.name, `gen${generation}-create`);
    if (!done) return false; // stays pending: cleanup reads it, an absence never settles it
    s.pending = false;
    if (done.error) {
      s.failed = true; // a failed create may still leave a function: cleanup reads it
      return false;
    }
    const read = await this.t.send(`gen${generation}-active`, this.url(generation));
    const status = generation === 1 ? read.json.status : read.json.state;
    if (
      read.status !== 200 ||
      status !== "ACTIVE" ||
      read.json.labels?.["fireemu-rc-observe"] !== this.runId
    )
      throw new Error(`gen${generation} did not become ACTIVE with the run label`);
    s.created = true;
    if (generation === 2) this.manage(s, read.json);
    return true;
  }

  /** Records and grants the Gen2 trigger and service a function read names (first read wins). */
  manage(s, fn) {
    if (s.managed?.length) return;
    const keys = [fn.eventTrigger?.trigger, fn.serviceConfig?.service].filter(Boolean);
    const scope = new RegExp(
      `^projects/(${this.project}|${this.number})/locations/(global|${REGION})/(triggers|services)/[A-Za-z0-9_.-]+$`,
    );
    // A name outside the expected shape is never granted or read; it is an open item for A2, and
    // the function itself is still deleted (ruling 2, item 5).
    for (const key of keys)
      if (!scope.test(key))
        this.open.push(
          `gen2: managed name outside the expected shape (${key.includes("/triggers/") ? "trigger" : "service"}); not read`,
        );
    s.managed = keys.filter((key) => scope.test(key));
    for (const key of s.managed) this.grants.managed.add(key);
  }

  /** Removes one generation if this run attempted it. Never re-sends an unknown DELETE. */
  async remove(generation) {
    const s = this.state[generation];
    if (!s.attempted) return;
    const tag = `gen${generation}`;
    const read = await this.t.send(`${tag}-cleanup-read`, this.url(generation));
    if (read.status === 404) {
      // A create refused with a complete 4xx created nothing: its 404 is the expected read.
      // Neither an unconfirmed create nor a confirmed one settles on an absence in the run.
      if (!s.refused)
        this.open.push(`${tag}: absent before the run's own DELETE (A2 read settles it)`);
      return;
    }
    if (read.status !== 200 || read.json.labels?.["fireemu-rc-observe"] !== this.runId)
      throw new Error(`${tag}: cleanup would touch an unowned function`);
    // A Gen2 create that never read ACTIVE names its trigger and service here.
    if (generation === 2) this.manage(s, read.json);
    let deleted;
    try {
      deleted = await this.t.send(`${tag}-delete`, this.url(generation), { method: "DELETE" });
    } catch (error) {
      if (error instanceof Unknown) {
        this.open.push(`${tag}: DELETE unknown (sticky; A2 read settles it)`);
        return;
      }
      throw error;
    }
    if (deleted.status !== 200) {
      this.open.push(`${tag}: DELETE answered ${deleted.status}`);
      return;
    }
    const done = await this.operation(generation, deleted.json.name, `${tag}-delete`);
    if (!done || done.error) {
      this.open.push(`${tag}: delete operation not done without error`);
      return;
    }
    const after = await this.t.send(`${tag}-after-delete`, this.url(generation));
    if (after.status !== 404) this.open.push(`${tag}: still readable after its own DELETE`);
    for (const [i, key] of (s.managed ?? []).entries()) {
      const origin = key.includes("/triggers/") ? EVENTARC : RUN;
      let gone = false;
      for (let n = 0; n < 4 && !gone; n += 1) {
        if (n) await this.wait(5000);
        gone = (await this.t.send(`${tag}-managed-${i}-${n}`, origin + key)).status === 404;
      }
      if (!gone) this.open.push(`${tag}: managed ${key.split("/")[4]} still readable`);
    }
  }

  /** Deletes the Gen2 source object this run uploaded (generation-matched). */
  async removeSource() {
    if (!this.source2) return;
    const object = `${STORAGE}b/${this.source2.bucket}/o/${encodeURIComponent(this.source2.object)}`;
    const read = await this.t.send("gen2-source-read", object);
    if (read.status === 404) return; // GCF consumed it; nothing of ours to delete
    if (read.status !== 200 || !read.json.generation) throw new Error("source object unreadable");
    const deleted = await this.t.send(
      "gen2-source-delete",
      `${object}?ifGenerationMatch=${read.json.generation}`,
      {
        method: "DELETE",
      },
    );
    if (![200, 204].includes(deleted.status))
      this.open.push(`gen2 source DELETE answered ${deleted.status}`);
    else if ((await this.t.send("gen2-source-after", object)).status !== 404)
      this.open.push("gen2 source still readable after its own DELETE");
  }

  /**
   * Every handler row this run's marker logged since `since`, oldest first, from the run's two
   * function resources only (build logs, which also name the run, are excluded). `truncated` means
   * the page did not hold every matching entry.
   */
  async logs(caseId, since) {
    const filter = `timestamp >= "${since}" AND jsonPayload.fireemuRcObserve="${this.runId}" AND (resource.labels.function_name="${this.names.gen1}" OR resource.labels.service_name="${this.names.gen2}")`;
    const r = await this.t.send(caseId, LOGGING, {
      method: "POST",
      body: {
        resourceNames: [`projects/${this.project}`],
        filter,
        orderBy: "timestamp asc",
        pageSize: 200,
      },
    });
    if (r.status !== 200) throw new Error(`${caseId}: log read refused`);
    return {
      rows: logRows(r.json.entries ?? [], this.runId),
      truncated: Boolean(r.json.nextPageToken),
    };
  }
}

/** The requests a run may make beyond its fixed paths, granted as the provider names them. */
export function newGrants() {
  return { signed: new Set(), source: null, managed: new Set(), pageTokens: new Set() };
}

/** Handler rows from Cloud Logging entries (jsonPayload, as recorded; a textPayload is parsed too). */
export function logRows(entries, runId) {
  const rows = [];
  for (const entry of entries) {
    let payload = entry.jsonPayload;
    if (!payload && typeof entry.textPayload === "string") {
      try {
        payload = JSON.parse(entry.textPayload);
      } catch {
        continue;
      }
    }
    if (payload?.fireemuRcObserve === runId)
      rows.push({
        ...payload,
        logTimestamp: entry.timestamp ?? null,
        insertId: entry.insertId ?? null,
      });
  }
  return rows;
}
