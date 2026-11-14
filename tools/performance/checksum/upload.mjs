import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createTestWorld } from '../../../npm/fireemu/testing.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const TEMP_ROOT = join(REPOSITORY_ROOT, 'target', `checksum-upload-worlds-${process.pid}`);
const DEFAULT_SIZES = [0, 7, 8, 64, 4096, 1024 * 1024, 30 * 1024 * 1024];
const SIZES = process.env.CHECKSUM_UPLOAD_SIZES
  ? process.env.CHECKSUM_UPLOAD_SIZES.split(',').map((value) => Number(value))
  : DEFAULT_SIZES;
const PAIRS = Number(process.env.CHECKSUM_UPLOAD_PAIRS ?? 5);
const REQUEST_TIMEOUT_MS = 180_000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function bitwiseCrc32c(bytes) {
  let state = 0xffff_ffff;
  for (const byte of bytes) {
    state ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      state = (state & 1) === 1 ? (state >>> 1) ^ 0x82f6_3b78 : state >>> 1;
    }
  }
  return (~state) >>> 0;
}

function digestValues(bytes) {
  const md5Hash = createHash('md5').update(bytes).digest('base64');
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(bitwiseCrc32c(bytes));
  return {
    md5Hash,
    crc32c: crc.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function fixture(size) {
  const bytes = Buffer.allocUnsafe(size);
  for (let index = 0; index < size; index++) bytes[index] = (index * 31 + 7) & 0xff;
  return Object.freeze({ size, bytes, ...digestValues(bytes) });
}

async function fileIdentity(path) {
  const absolute = await realpath(path);
  const metadata = await stat(absolute);
  assert.ok(metadata.isFile(), `binary is not a regular file: ${absolute}`);
  assert.notEqual(metadata.mode & 0o111, 0, `binary is not executable: ${absolute}`);
  return {
    path: absolute,
    bytes: metadata.size,
    sha256: createHash('sha256').update(await readFile(absolute)).digest('hex'),
  };
}

function verifyLoopback(world) {
  const endpoint = world.endpoints.storage;
  assert.ok(endpoint, 'storage endpoint is not available');
  assert.ok(LOOPBACK_HOSTS.has(endpoint.host), `storage endpoint must be loopback: ${endpoint.host}`);
  assert.ok(Number.isInteger(endpoint.port) && endpoint.port > 0, 'storage endpoint must use an assigned port');
  const origin = new URL(endpoint.url);
  assert.ok(LOOPBACK_HOSTS.has(origin.hostname), `storage origin must be loopback: ${origin.hostname}`);
  assert.equal(origin.protocol, 'http:');
  return origin;
}

async function startWorld(binaryPath, projectId, tempRoot) {
  const started = performance.now();
  const world = await createTestWorld({
    binaryPath,
    projectId,
    services: ['auth', 'firestore', 'storage'],
    config: { schemaVersion: 1, firestore: { edition: 'standard' } },
    clockStart: '2026-01-31T23:59:00Z',
    env: { NODE_PATH: '' },
    tempRoot,
  });
  try {
    const startupMs = performance.now() - started;
    const origin = verifyLoopback(world);
    const ready = JSON.parse(await readFile(join(world.directory, 'generation-1', 'ready.json'), 'utf8'));
    assert.ok(Number.isSafeInteger(ready.pid) && ready.pid > 1, 'test world has no owned process PID');
    return { world, origin, pid: ready.pid, startupMs };
  } catch (error) {
    try {
      await world.dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'test-world readiness failed and cleanup also failed');
    }
    throw error;
  }
}

function requestUrl(origin, path) {
  const url = new URL(path, origin);
  assert.ok(LOOPBACK_HOSTS.has(url.hostname), `refusing non-loopback request: ${url.origin}`);
  assert.equal(url.origin, origin.origin);
  return url;
}

function objectName(role, pairIndex, phase, size) {
  return `checksum-${role}-${pairIndex}-${phase}-${size}.bin`;
}

async function assertObjectMissing(worldState, name) {
  const bucket = `${worldState.world.projectId}.appspot.com`;
  const path = `/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`;
  const response = await fetch(requestUrl(worldState.origin, path), {
    headers: { authorization: 'Bearer owner' },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(
    response.status,
    404,
    `expected fresh object ${name} to be absent at ${worldState.origin.origin}, got HTTP ${response.status}: ${body.toString('utf8').slice(0, 512)}`,
  );
}

async function readResponse(response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${bytes.toString('utf8').slice(0, 1024)}`);
  }
  return bytes;
}

async function upload(worldState, role, pairIndex, item, timed, phase) {
  const name = objectName(role, pairIndex, phase, item.size);
  const bucket = `${worldState.world.projectId}.appspot.com`;
  const path = `/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}`;
  const url = requestUrl(worldState.origin, path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('storage upload timed out')), REQUEST_TIMEOUT_MS);
  const init = {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner',
      'content-type': 'application/octet-stream',
    },
    body: item.bytes,
    redirect: 'error',
    signal: controller.signal,
  };

  let response;
  let body;
  let elapsedMs;
  try {
    const started = performance.now();
    response = await fetch(url, init);
    body = await readResponse(response);
    if (timed) elapsedMs = performance.now() - started;
  } finally {
    clearTimeout(timer);
  }

  const metadata = JSON.parse(body.toString('utf8'));
  assert.equal(metadata.name, name);
  assert.equal(String(metadata.size), String(item.size));
  assert.equal(metadata.md5Hash, item.md5Hash, 'upload response MD5 does not match independent oracle');
  assert.equal(metadata.crc32c, item.crc32c, 'upload response CRC32C does not match independent bitwise oracle');
  return {
    role,
    pair: pairIndex + 1,
    size: item.size,
    name,
    elapsedMs,
    md5Hash: item.md5Hash,
    crc32c: item.crc32c,
    sha256: item.sha256,
    worldPid: worldState.pid,
    objectPath: `/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}`,
  };
}

async function verifyStored(worldState, record, item) {
  const headers = { authorization: 'Bearer owner' };
  const metadataResponse = await fetch(requestUrl(worldState.origin, record.objectPath), {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const storedMetadata = JSON.parse((await readResponse(metadataResponse)).toString('utf8'));
  assert.equal(storedMetadata.name, record.name);
  assert.equal(String(storedMetadata.size), String(item.size));
  assert.equal(storedMetadata.md5Hash, item.md5Hash, 'stored metadata MD5 does not match independent oracle');
  assert.equal(storedMetadata.crc32c, item.crc32c, 'stored metadata CRC32C does not match independent bitwise oracle');

  const mediaUrl = requestUrl(worldState.origin, `${record.objectPath}?alt=media`);
  const mediaResponse = await fetch(mediaUrl, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const storedBytes = await readResponse(mediaResponse);
  assert.ok(storedBytes.equals(item.bytes), 'stored media bytes differ from the upload fixture');
  assert.deepEqual(digestValues(storedBytes), {
    md5Hash: item.md5Hash,
    crc32c: item.crc32c,
    sha256: item.sha256,
  });
}

async function disposeWorlds(worlds) {
  const failures = [];
  for (const worldState of worlds.reverse()) {
    if (!worldState) continue;
    try {
      await worldState.world.dispose();
      await assert.rejects(stat(worldState.world.directory), { code: 'ENOENT' });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'one or more loopback test worlds did not dispose cleanly');
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.role}\t${row.size}`;
    const values = groups.get(key) ?? [];
    values.push(row.elapsedMs);
    groups.set(key, values);
  }
  const bySize = [];
  for (const size of SIZES) {
    const baseline = groups.get(`baseline\t${size}`);
    const candidate = groups.get(`candidate\t${size}`);
    assert.equal(baseline?.length, PAIRS);
    assert.equal(candidate?.length, PAIRS);
    const ratios = baseline.map((value, index) => candidate[index] / value);
    bySize.push({
      size,
      baselineMedianMs: median(baseline),
      baselineP95Ms: [...baseline].sort((a, b) => a - b)[Math.ceil(0.95 * baseline.length) - 1],
      candidateMedianMs: median(candidate),
      candidateP95Ms: [...candidate].sort((a, b) => a - b)[Math.ceil(0.95 * candidate.length) - 1],
      medianPairedCandidateOverBaseline: median(ratios),
      pairs: PAIRS,
    });
  }
  return bySize;
}

async function main() {
  const baselinePath = process.env.FIREEMU_BASELINE_BINARY;
  const candidatePath = process.env.FIREEMU_CANDIDATE_BINARY;
  assert.ok(baselinePath, 'set FIREEMU_BASELINE_BINARY to the frozen baseline binary');
  assert.ok(candidatePath, 'set FIREEMU_CANDIDATE_BINARY to the integrated candidate binary');
  const binaries = {
    baseline: await fileIdentity(baselinePath),
    candidate: await fileIdentity(candidatePath),
  };
  assert.ok(Number.isSafeInteger(PAIRS) && PAIRS > 0 && PAIRS <= 5, 'CHECKSUM_UPLOAD_PAIRS must be an integer from 1 through 5');
  assert.ok(SIZES.length > 0 && SIZES.every((size) => Number.isSafeInteger(size) && size >= 0), 'CHECKSUM_UPLOAD_SIZES must be a comma-separated list of nonnegative byte sizes');
  for (const role of ['baseline', 'candidate']) {
    const expectedHash = process.env[`FIREEMU_${role.toUpperCase()}_SHA256`];
    assert.ok(expectedHash, `set FIREEMU_${role.toUpperCase()}_SHA256 from the binary build receipt`);
    assert.equal(binaries[role].sha256, expectedHash, `${role} binary does not match its build receipt`);
  }
  assert.notEqual(binaries.baseline.sha256, binaries.candidate.sha256, 'baseline and candidate binaries must differ');
  const fixtures = SIZES.map(fixture);
  const warmup = fixture(64);
  const results = [];
  const startup = [];
  await mkdir(TEMP_ROOT, { recursive: true });

  try {
    for (let pairIndex = 0; pairIndex < PAIRS; pairIndex++) {
      const worlds = [];
      const pairRoles = pairIndex % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
      const pairWorlds = {};
      const pairObjects = [];
      try {
        for (const role of pairRoles) {
          const state = await startWorld(
            binaries[role].path,
            `demo-crc-${role}-${pairIndex + 1}`,
            TEMP_ROOT,
          );
          worlds.push(state);
          pairWorlds[role] = state;
          startup.push({ pair: pairIndex + 1, role, pid: state.pid, origin: state.origin.origin, port: Number(state.origin.port), startupMs: state.startupMs });
        }

        assert.notEqual(pairWorlds.baseline.pid, pairWorlds.candidate.pid, 'paired test worlds must be distinct processes');
        assert.notEqual(pairWorlds.baseline.origin.origin, pairWorlds.candidate.origin.origin, 'paired test worlds must use distinct live loopback endpoints');
        for (const role of pairRoles) {
          await assertObjectMissing(pairWorlds[role], objectName(role, pairIndex, 'warmup', warmup.size));
          await upload(pairWorlds[role], role, pairIndex, warmup, false, 'warmup');
        }

        for (const item of fixtures) {
          for (const role of pairRoles) {
            const row = await upload(pairWorlds[role], role, pairIndex, item, true, 'measure');
            results.push(row);
            pairObjects.push({ state: pairWorlds[role], row, item });
          }
        }

        for (const stored of pairObjects) await verifyStored(stored.state, stored.row, stored.item);
      } finally {
        await disposeWorlds(worlds);
      }
    }
  } finally {
    await rm(TEMP_ROOT, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    method: `${PAIRS} fresh paired test-world process pairs; alternating backend start/upload order; startup and warm-up excluded`,
    loopbackOnly: true,
    binaries,
    fixtures: fixtures.map(({ size, md5Hash, crc32c, sha256 }) => ({ size, md5Hash, crc32c, sha256 })),
    startup,
    results,
    summary: summarize(results),
    worldsDisposed: PAIRS * 2,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
