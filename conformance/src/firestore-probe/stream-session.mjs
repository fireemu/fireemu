import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { normalize, normalizeError } from "../normalize.mjs";
import { requireChildProductionAdmission } from "../fs-data-write-admission.mjs";
import { normalizeRecordedResponse } from "./production-normalization.mjs";

const require = createRequire(import.meta.url);
const { v1 } = require("@google-cloud/firestore");
const grpc = require("@grpc/grpc-js");

const SAVED_ID = "writes/write-stream-transaction";
const TRAILERS_ID = "writes/write-stream-terminal/trailing-metadata";
const HALF_CLOSE_ID = "writes/write-stream-terminal/half-close";
const RESPONSE_HALF_CLOSE_ID = "writes/write-stream-terminal/response-before-half-close";
const UNARY_EXACT_ID = "writes/limits/grpc-unary-request-bytes/10485760";
const UNARY_OVER_ID = "writes/limits/grpc-unary-request-bytes/10485761";
const UNARY_STRICT_LIMIT_ID = "writes/limits/grpc-unary-request-bytes/11534336";
const UNARY_STRICT_OVER_ID = "writes/limits/grpc-unary-request-bytes/11534337";
const UNARY_IDS = new Set([
  UNARY_EXACT_ID,
  UNARY_OVER_ID,
  UNARY_STRICT_LIMIT_ID,
  UNARY_STRICT_OVER_ID,
]);
const STREAM_EXACT_ID = "writes/limits/grpc-stream-request-bytes/10485760";
const STREAM_OVER_ID = "writes/limits/grpc-stream-request-bytes/10485761";
const SAVED_SOURCE = "spec/compatibility/broad-runs/fs-write-txn-dee737c14-production-result.json";
const SANDBOX_PROJECT = "fireemu-oracle-sbx";
const UNARY_BYTE_TARGETS = new Set([10_485_760, 10_485_761, 11_534_336, 11_534_337]);
const STREAM_BYTE_TARGETS = new Set([10_485_760, 10_485_761]);

export async function makeUnaryRequestByWireBytes(targetBytes) {
  if (!UNARY_BYTE_TARGETS.has(targetBytes)) throw new Error("unsupported unary byte target");
  const client = new v1.FirestoreClient({ projectId: SANDBOX_PROJECT });
  try {
    const name = `projects/${SANDBOX_PROJECT}/databases/(default)/documents/byteProbe/x`;
    const serialize = client._protos.google.firestore.v1.GetDocumentRequest.serialize;
    const request = { name, transaction: Buffer.alloc(targetBytes - 76) };
    const wireBytes = serialize(request).length;
    if (wireBytes !== targetBytes) throw new Error("unary request wire size differs");
    return { request, wireBytes };
  } finally {
    await client.close();
  }
}

export async function makeStreamRequestByWireBytes(targetBytes) {
  if (!STREAM_BYTE_TARGETS.has(targetBytes)) throw new Error("unsupported stream byte target");
  const client = new v1.FirestoreClient({ projectId: SANDBOX_PROJECT });
  try {
    const database = `projects/${SANDBOX_PROJECT}/databases/(default)`;
    const serialize = client._protos.google.firestore.v1.WriteRequest.serialize;
    const request = { database, streamToken: Buffer.alloc(targetBytes - 54) };
    const wireBytes = serialize(request).length;
    if (wireBytes !== targetBytes) throw new Error("stream request wire size differs");
    return { request, wireBytes };
  } finally {
    await client.close();
  }
}

const WRITE_STREAM_DELETE_PREFIX = "writes/limits/write-stream-delete/";
const WRITE_STREAM_DELETE_COUNTS = new Set([12_112, 12_113, 12_122]);
const WRITE_STREAM_DELETE_NAME = new RegExp(
  `^projects/${SANDBOX_PROJECT}/databases/\\(default\\)/documents/wlstream(\\d+)c+/d$`,
);
const WRITE_STREAM_UNARY_RPCS = 6;
// The in-recipe cleanup removes this many leading values in one transform before it deletes,
// leaving the document well under every route's delete boundary.
const WRITE_STREAM_SHRINK_VALUES = 1_024;

/**
 * A write-stream delete recipe seeds one document of `arrayCount` distinct integers with a
 * Commit, deletes it over the Write stream, reads it back, and removes anything left. The
 * document sits under a 1,000-byte relative name, the shape of the recorded delete boundary.
 */
export function validateWriteStreamDeleteRecipe(recipe) {
  const count = recipe?.arrayCount;
  const match =
    typeof recipe?.documentName === "string"
      ? WRITE_STREAM_DELETE_NAME.exec(recipe.documentName)
      : null;
  if (
    recipe?.transport !== "grpc" ||
    recipe.action !== "write-stream-delete" ||
    !WRITE_STREAM_DELETE_COUNTS.has(count) ||
    recipe.id !== `${WRITE_STREAM_DELETE_PREFIX}${count}` ||
    recipe.maxFrames !== 2 ||
    recipe.maxUnaryRpcs !== WRITE_STREAM_UNARY_RPCS ||
    !match ||
    match[1] !== String(count) ||
    recipe.documentName.slice(recipe.documentName.indexOf("/documents/") + 11).length !== 1_000
  ) {
    throw new Error("unsupported write-stream delete recipe");
  }
  return recipe;
}

const isWriteStreamDelete = (recipe) => recipe?.id?.startsWith(WRITE_STREAM_DELETE_PREFIX);

/** The distinct integers 0..count-1 the recipe seeds. */
export function writeStreamDeleteValues(count) {
  return Array.from({ length: count }, (_, index) => ({ integerValue: String(index) }));
}

export function writeStreamSeedRequest(recipe) {
  validateWriteStreamDeleteRecipe(recipe);
  return {
    database: `projects/${SANDBOX_PROJECT}/databases/(default)`,
    writes: [
      {
        update: {
          name: recipe.documentName,
          fields: { a: { arrayValue: { values: writeStreamDeleteValues(recipe.arrayCount) } } },
        },
        currentDocument: { exists: false },
      },
    ],
  };
}

export function writeStreamDeleteFrame(recipe, streamToken) {
  validateWriteStreamDeleteRecipe(recipe);
  return { streamToken, writes: [{ delete: recipe.documentName }] };
}

export function writeStreamShrinkRequest(recipe) {
  validateWriteStreamDeleteRecipe(recipe);
  return {
    database: `projects/${SANDBOX_PROJECT}/databases/(default)`,
    writes: [
      {
        transform: {
          document: recipe.documentName,
          fieldTransforms: [
            {
              fieldPath: "a",
              removeAllFromArray: {
                values: writeStreamDeleteValues(
                  Math.min(WRITE_STREAM_SHRINK_VALUES, recipe.arrayCount),
                ),
              },
            },
          ],
        },
        currentDocument: { exists: true },
      },
    ],
  };
}

export function writeStreamCleanupDeleteRequest(recipe) {
  validateWriteStreamDeleteRecipe(recipe);
  return {
    database: `projects/${SANDBOX_PROJECT}/databases/(default)`,
    writes: [{ delete: recipe.documentName }],
  };
}

/** Counts every RPC of one recipe before it is sent; the seventh is refused. */
export function createUnaryRpcCounter(limit = WRITE_STREAM_UNARY_RPCS) {
  let used = 0;
  return {
    next() {
      if (used >= limit) throw new Error("write-stream delete RPC budget reached before the send");
      used += 1;
      return used;
    },
    get used() {
      return used;
    },
  };
}

const LIVE_SPECS = new Map([
  [TRAILERS_ID, { action: "invalid-empty-write-after-handshake", maxFrames: 2 }],
  [HALF_CLOSE_ID, { action: "half-close-after-handshake", maxFrames: 1 }],
  [RESPONSE_HALF_CLOSE_ID, { action: "empty-write-response-before-half-close", maxFrames: 2 }],
  [
    UNARY_EXACT_ID,
    { action: "get-document-transaction-bytes", maxFrames: 1, wireBytes: 10_485_760 },
  ],
  [
    UNARY_OVER_ID,
    { action: "get-document-transaction-bytes", maxFrames: 1, wireBytes: 10_485_761 },
  ],
  [
    UNARY_STRICT_LIMIT_ID,
    { action: "get-document-transaction-bytes", maxFrames: 1, wireBytes: 11_534_336 },
  ],
  [
    UNARY_STRICT_OVER_ID,
    { action: "get-document-transaction-bytes", maxFrames: 1, wireBytes: 11_534_337 },
  ],
  [STREAM_EXACT_ID, { action: "write-stream-token-bytes", maxFrames: 1, wireBytes: 10_485_760 }],
  [STREAM_OVER_ID, { action: "write-stream-token-bytes", maxFrames: 1, wireBytes: 10_485_761 }],
]);

/**
 * A recording may carry any non-empty subset of the live recipes (delta-v3 records one).
 * Each recipe must still match its fixed action, frame count and wire size.
 */
export function validateLiveStreamSubset(recipes) {
  if (!Array.isArray(recipes)) throw new Error("unsupported stream recipe subset");
  const live = [];
  const seen = new Set();
  for (const recipe of recipes) {
    if (isWriteStreamDelete(recipe)) {
      if (seen.has(recipe.id)) throw new Error("unsupported stream recipe subset");
      validateWriteStreamDeleteRecipe(recipe);
      seen.add(recipe.id);
      live.push(recipe);
      continue;
    }
    if (recipe?.id === SAVED_ID) {
      if (recipe.transport !== "saved-reference" || recipe.source !== SAVED_SOURCE) {
        throw new Error("unsupported stream recipe subset");
      }
      continue;
    }
    const spec = LIVE_SPECS.get(recipe?.id);
    if (
      !spec ||
      seen.has(recipe.id) ||
      recipe.transport !== "grpc" ||
      recipe.action !== spec.action ||
      recipe.maxFrames !== spec.maxFrames ||
      (spec.wireBytes !== undefined && recipe.wireBytes !== spec.wireBytes)
    ) {
      throw new Error("unsupported stream recipe subset");
    }
    seen.add(recipe.id);
    live.push(recipe);
  }
  if (live.length === 0) throw new Error("unsupported stream recipe subset");
  return live;
}

/**
 * The full corpus must carry the saved reference and every live recipe exactly once, each on its
 * fixed action, frame count and wire size. Live recipes are returned in their fixed order.
 */
export function validateStreamRecipes(recipes) {
  if (!Array.isArray(recipes) || recipes.length !== LIVE_SPECS.size + 1) {
    throw new Error("unsupported stream recipe set");
  }
  const byId = new Map(recipes.map((recipe) => [recipe?.id, recipe]));
  const saved = byId.get(SAVED_ID);
  if (
    byId.size !== recipes.length ||
    saved?.transport !== "saved-reference" ||
    saved?.source !== SAVED_SOURCE
  ) {
    throw new Error("unsupported stream recipe");
  }
  const live = [];
  for (const [id, spec] of LIVE_SPECS) {
    const recipe = byId.get(id);
    if (
      recipe?.transport !== "grpc" ||
      recipe.action !== spec.action ||
      recipe.maxFrames !== spec.maxFrames ||
      recipe.wireBytes !== spec.wireBytes
    ) {
      throw new Error("unsupported stream recipe");
    }
    live.push(recipe);
  }
  return { live, saved };
}

export function shouldHalfCloseAfterResponse(recipe, responseCount) {
  return recipe.id === RESPONSE_HALF_CLOSE_ID ? responseCount === 2 : responseCount === 1;
}

export function responseGatedDeadlineIsIndeterminate(recipe, status, responseCount) {
  return recipe.id === RESPONSE_HALF_CLOSE_ID && status?.code === 4 && responseCount < 2;
}

function opaqueShape(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value.length > 0 ? "nonempty-bytes" : "empty-bytes";
  }
  if (typeof value === "string") return value.length > 0 ? "nonempty-string" : "empty-string";
  return normalize(value);
}

/** Opaque stream credentials are not comparable or safe to save verbatim. */
export function projectStreamResponse(response) {
  if (!response || typeof response !== "object") throw new Error("invalid stream response");
  const { streamId, streamToken, ...rest } = response;
  return maskWriteResponseTimes({
    ...(streamId === undefined ? {} : { streamId: opaqueShape(streamId) }),
    ...(streamToken === undefined ? {} : { streamToken: opaqueShape(streamToken) }),
    ...normalize(rest),
  });
}

/**
 * A Write response's commit and update times are instants of the run, not shapes: they are kept
 * as "timestamp" when present and null when absent, so two recordings can agree.
 */
export function maskWriteResponseTimes(projected) {
  const masked = { ...projected };
  if (masked.commitTime) masked.commitTime = "timestamp";
  if (Array.isArray(masked.writeResults)) {
    masked.writeResults = masked.writeResults.map((result) =>
      result?.updateTime ? { ...result, updateTime: "timestamp" } : result,
    );
  }
  return masked;
}

export function projectStreamStatus(status) {
  const normalized = normalizeError(status);
  const trailers = normalized.trailers?.map((trailer) =>
    trailer.key === "x-debug-tracking-id" && trailer.kind === "ascii"
      ? { ...trailer, value: trailer.value ? "nonempty-volatile-id" : "empty-volatile-id" }
      : trailer,
  );
  return {
    code: status.code,
    details: normalized.details ?? null,
    ...(trailers === undefined ? {} : { trailers }),
  };
}

export function validateStreamTarget({ target, projectId, host, port }) {
  if (projectId !== SANDBOX_PROJECT) throw new Error("stream must address the sandbox project");
  if (target === "production") {
    if (host !== undefined || port !== undefined)
      throw new Error("production stream endpoint is fixed");
    return { host: "firestore.googleapis.com", port: 443, tls: true };
  }
  if (target === "local") {
    if (!new Set(["127.0.0.1", "::1", "localhost"]).has(host)) {
      throw new Error("local stream requires loopback host");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("local stream port is invalid");
    }
    return { host, port, tls: false };
  }
  throw new Error("unknown stream target");
}

export function terminalComplete({ status, sawEnd, sawClose, sentFrames, expectedFrames }) {
  return Boolean(status && (sawEnd || sawClose) && sentFrames === expectedFrames);
}

async function runUnaryRequestByteRecipe(recipe, { connection, projectId, token }) {
  const { request, wireBytes } = await makeUnaryRequestByWireBytes(recipe.wireBytes);
  const client = new v1.FirestoreClient({
    servicePath: connection.host,
    port: connection.port,
    projectId,
    sslCreds: connection.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
    fallback: false,
  });
  try {
    let result;
    try {
      const [response] = await client.getDocument(request, {
        deadline: new Date(Date.now() + 30_000),
        retry: { retryCodes: [] },
        otherArgs: { headers: { authorization: `Bearer ${token}` } },
      });
      result = {
        sentFrames: 1,
        wireBytes,
        status: { code: 0, details: "", trailers: [] },
        response: normalize(response),
      };
    } catch (error) {
      if (error?.code === 4) throw new Error("indeterminate: unary client deadline");
      const status = projectStreamStatus(error);
      result = { sentFrames: 1, wireBytes, status };
    }
    const recorded = normalizeRecordedResponse(result, {
      project: SANDBOX_PROJECT,
      recordProject: "demo-firestore-probe",
      scope: "error",
    });
    if (
      JSON.stringify(recorded).includes(token) ||
      JSON.stringify(recorded).includes(SANDBOX_PROJECT)
    ) {
      throw new Error("unary recording contains private identity or credential");
    }
    return recorded;
  } finally {
    await client.close();
  }
}

const unaryStatus = (error) => (error ? projectStreamStatus(error) : { code: 0, details: "" });

/**
 * Seed, delete over the Write stream, read back and clean up, all through one gRPC client.
 * The recorded rows are the seed's status, every stream event, and the read-back; the cleanup
 * is not an observation, but a cleanup that fails fails the recipe.
 */
async function runWriteStreamDeleteRecipe(recipe, { connection, projectId, token }) {
  validateWriteStreamDeleteRecipe(recipe);
  const counter = createUnaryRpcCounter();
  const client = new v1.FirestoreClient({
    servicePath: connection.host,
    port: connection.port,
    projectId,
    sslCreds: connection.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
    fallback: false,
  });
  const options = () => ({
    deadline: new Date(Date.now() + 30_000),
    retry: { retryCodes: [] },
    otherArgs: { headers: { authorization: `Bearer ${token}` } },
  });
  const unary = async (method, request) => {
    counter.next();
    try {
      const [response] = await client[method](request, options());
      return { response };
    } catch (error) {
      if (error?.code === 4) {
        throw new Error(`indeterminate: ${method} client deadline`, { cause: error });
      }
      return { error };
    }
  };
  const readBack = async () => {
    const { response, error } = await unary("getDocument", { name: recipe.documentName });
    if (error && error.code !== 5) throw new Error(`write-stream read-back failed: ${error.code}`);
    return {
      found: !error,
      status: unaryStatus(error),
      arrayCount: response?.fields?.a?.arrayValue?.values?.length ?? 0,
    };
  };
  try {
    const events = [];
    const seed = await unary("commit", writeStreamSeedRequest(recipe));
    if (seed.error) throw new Error(`write-stream seed was refused: ${seed.error.code}`);
    events.push({ type: "seed", status: unaryStatus(undefined) });
    counter.next();
    const stream = await new Promise((resolve, reject) => {
      const call = client.write(options());
      const frames = { sent: 0 };
      let status;
      let sawEnd = false;
      let sawClose = false;
      let responses = 0;
      let grace;
      const timer = setTimeout(
        () => finish(new Error("indeterminate: write-stream delete timeout")),
        31_000,
      );
      function finish(error) {
        clearTimeout(timer);
        clearTimeout(grace);
        if (error) {
          call.destroy(error);
          return reject(error);
        }
        return resolve({ status, frames: frames.sent });
      }
      const maybeFinish = () => {
        if (status && (sawEnd || sawClose) && !grace) grace = setTimeout(() => finish(), 100);
      };
      call.on("data", (response) => {
        events.push({ type: "data", value: projectStreamResponse(response) });
        responses += 1;
        if (responses === 1) {
          call.write(writeStreamDeleteFrame(recipe, response.streamToken));
          frames.sent += 1;
        } else {
          call.end();
        }
      });
      call.on("status", (value) => {
        status = projectStreamStatus(value);
        events.push({ type: "status", value: status });
        maybeFinish();
      });
      call.on("error", (error) =>
        events.push({ type: "error", value: projectStreamStatus(error) }),
      );
      call.on("end", () => {
        sawEnd = true;
        events.push({ type: "end" });
        maybeFinish();
      });
      call.on("close", () => {
        sawClose = true;
        events.push({ type: "close" });
        maybeFinish();
      });
      call.write({ database: `projects/${projectId}/databases/(default)` });
      frames.sent += 1;
    });
    if (stream.status?.code === 4) throw new Error("indeterminate: write-stream client deadline");
    const read = await readBack();
    events.push({
      type: "readback",
      found: read.found,
      arrayCount: read.arrayCount,
      status: read.status,
    });
    if (read.found) {
      const shrink = await unary("commit", writeStreamShrinkRequest(recipe));
      if (shrink.error) throw new Error(`write-stream cleanup shrink failed: ${shrink.error.code}`);
      const removal = await unary("commit", writeStreamCleanupDeleteRequest(recipe));
      if (removal.error)
        throw new Error(`write-stream cleanup delete failed: ${removal.error.code}`);
      if ((await readBack()).found) throw new Error("write-stream cleanup left the document");
    }
    const recorded = normalizeRecordedResponse(
      { status: stream.status, sentFrames: stream.frames, events },
      { project: SANDBOX_PROJECT, recordProject: "demo-firestore-probe", scope: "error" },
    );
    if (
      JSON.stringify(recorded).includes(token) ||
      JSON.stringify(recorded).includes(SANDBOX_PROJECT)
    ) {
      throw new Error("write-stream delete recording contains private identity or credential");
    }
    return recorded;
  } finally {
    await client.close();
  }
}

/** Run one fixed terminal probe, or one write-stream delete, using the real gRPC client. */
export async function runStreamRecipe(recipe, { target, projectId, host, port, token }) {
  const connection = validateStreamTarget({ target, projectId, host, port });
  if (typeof token !== "string" || token.length === 0) throw new Error("stream bearer is required");
  if (isWriteStreamDelete(recipe)) {
    return runWriteStreamDeleteRecipe(recipe, { connection, projectId, token });
  }
  if (UNARY_IDS.has(recipe?.id)) {
    return runUnaryRequestByteRecipe(recipe, { connection, projectId, token });
  }
  const requestByteStream = [STREAM_EXACT_ID, STREAM_OVER_ID].includes(recipe?.id);
  if (
    ![TRAILERS_ID, HALF_CLOSE_ID, RESPONSE_HALF_CLOSE_ID].includes(recipe?.id) &&
    !requestByteStream
  )
    throw new Error("unsupported live stream recipe");
  const byteRequest = requestByteStream
    ? await makeStreamRequestByWireBytes(recipe.wireBytes)
    : undefined;
  const client = new v1.FirestoreClient({
    servicePath: connection.host,
    port: connection.port,
    projectId,
    sslCreds: connection.tls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
    fallback: false,
  });
  const call = client.write({
    deadline: new Date(Date.now() + 30_000),
    retry: { retryCodes: [] },
    otherArgs: { headers: { authorization: `Bearer ${token}` } },
  });
  return await new Promise((resolve, reject) => {
    const events = [];
    let status;
    let sentFrames = 0;
    let sawClose = false;
    let sawEnd = false;
    let responseCount = 0;
    let settled = false;
    let grace;
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `stream terminal timeout after ${events.map((event) => event.type).join(",")}; sent=${sentFrames}`,
          ),
        ),
      31_000,
    );
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      if (error) call.destroy(error);
      client.close();
      if (error) return reject(error);
      if (
        !terminalComplete({
          status,
          sawEnd,
          sawClose,
          sentFrames,
          expectedFrames: recipe.maxFrames,
        })
      ) {
        return reject(new Error("incomplete gRPC terminal observation"));
      }
      if (responseGatedDeadlineIsIndeterminate(recipe, status, responseCount)) {
        return reject(new Error("indeterminate: client deadline before the gated stream response"));
      }
      if (requestByteStream && status.code === 4) {
        return reject(new Error("indeterminate: request-byte stream client deadline"));
      }
      const recorded = normalizeRecordedResponse(
        {
          status,
          sentFrames,
          events,
          ...(byteRequest ? { wireBytes: byteRequest.wireBytes } : {}),
        },
        {
          project: SANDBOX_PROJECT,
          recordProject: "demo-firestore-probe",
          scope: "error",
        },
      );
      if (
        JSON.stringify(recorded).includes(token) ||
        JSON.stringify(recorded).includes(SANDBOX_PROJECT)
      ) {
        return reject(new Error("stream recording contains private identity or credential"));
      }
      return resolve(recorded);
    }
    function maybeFinish() {
      if (
        terminalComplete({
          status,
          sawEnd,
          sawClose,
          sentFrames,
          expectedFrames: recipe.maxFrames,
        }) &&
        !grace
      ) {
        grace = setTimeout(() => finish(), 100);
      }
    }
    try {
      call.on("data", (response) => {
        events.push({ type: "data", value: projectStreamResponse(response) });
        responseCount += 1;
        if (responseCount === 1 && recipe.id !== HALF_CLOSE_ID && !requestByteStream) {
          call.write({ streamToken: response.streamToken, writes: [{}] });
          sentFrames += 1;
        }
        if (shouldHalfCloseAfterResponse(recipe, responseCount)) {
          if (recipe.id === RESPONSE_HALF_CLOSE_ID) {
            events.push({ type: "half-close-after-response", responseCount });
          }
          call.end();
        }
      });
      call.on("status", (value) => {
        status = projectStreamStatus(value);
        events.push({ type: "status", value: status });
        maybeFinish();
      });
      call.on("error", (error) => {
        events.push({ type: "error", value: projectStreamStatus(error) });
      });
      call.on("end", () => {
        sawEnd = true;
        events.push({ type: "end" });
        maybeFinish();
      });
      call.on("close", () => {
        sawClose = true;
        events.push({ type: "close" });
        maybeFinish();
      });
      call.write(byteRequest?.request ?? { database: `projects/${projectId}/databases/(default)` });
      sentFrames += 1;
      if (requestByteStream) call.end();
    } catch (error) {
      finish(error);
    }
  });
}

async function main() {
  const input = process.env.FIRESTORE_STREAM_CORPUS;
  const output = process.env.FIRESTORE_STREAM_OUT;
  const target = process.env.FIRESTORE_STREAM_TARGET;
  const token = process.env.FIRESTORE_STREAM_TOKEN;
  if (!input || !output || !target || !token) throw new Error("stream session inputs are required");
  requireChildProductionAdmission({
    production: target === "production",
    env: process.env,
    runId: process.env.FIRESTORE_STREAM_RUN_ID,
  });
  const corpus = JSON.parse(await readFile(input, "utf8"));
  const live = validateLiveStreamSubset(corpus.streamRecipes);
  const options = {
    target,
    projectId: SANDBOX_PROJECT,
    host: process.env.FIRESTORE_STREAM_HOST,
    port:
      process.env.FIRESTORE_STREAM_PORT === undefined
        ? undefined
        : Number(process.env.FIRESTORE_STREAM_PORT),
    token,
  };
  const results = {};
  for (const recipe of live) results[recipe.id] = await runStreamRecipe(recipe, options);
  await writeFile(output, `${JSON.stringify(results, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
