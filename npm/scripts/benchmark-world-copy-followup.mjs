import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { snapshotInputs, prepareGeneration, cloneSupport, copySupport } from '../fireemu/testing-snapshot.mjs';

function argument(name, fallback, maximum) {
  const prefix = `--${name}=`;
  const found = process.argv.find(value => value.startsWith(prefix));
  const value = found ? Number(found.slice(prefix.length)) : fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw Error(`${name} must be an integer in 1..${maximum}`);
  return value;
}

const fileCount = argument('files', 2_000, 10_000);
const bytesPerFile = argument('bytes', 1_024, 8_192);
const pairs = argument('pairs', 5, 8);
const outputArg = process.argv.find(value => value.startsWith('--output='));
const outputPath = outputArg?.slice('--output='.length);
const root = await mkdtemp(join(tmpdir(), 'fireemu-world-copy-bench-'));
const source = join(root, 'source');
const originalCloneSupport = { ...cloneSupport };
const originalCopyLimit = copySupport.maxConcurrentFiles;
const sourceBytes = Buffer.alloc(bytesPerFile, 0x61);

try {
  cloneSupport.file = false;
  cloneSupport.tree = false;
  await mkdir(source);
  for (let index = 0; index < 32; index++) await mkdir(join(source, `bucket-${String(index).padStart(2, '0')}`));
  for (let index = 0; index < fileCount; index++) {
    const bucket = join(source, `bucket-${String(index % 32).padStart(2, '0')}`);
    await writeFile(join(bucket, `file-${String(index).padStart(5, '0')}.dat`), sourceBytes);
  }
  const sourceHash = createHash('sha256');
  for (let index = 0; index < fileCount; index++) {
    const bucket = `bucket-${String(index % 32).padStart(2, '0')}`;
    const name = `file-${String(index).padStart(5, '0')}.dat`;
    sourceHash.update(`${bucket}/${name}\0`).update(sourceBytes);
  }
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const implementationHash = createHash('sha256').update(await readFile(new URL('../fireemu/testing-snapshot.mjs', import.meta.url))).digest('hex');
  const samples = [];

  const measure = async limit => {
    copySupport.maxConcurrentFiles = limit;
    if (copySupport.maxConcurrentFiles !== limit || cloneSupport.file || cloneSupport.tree) throw Error('benchmark copy mode does not match the requested portable pool');
    const world = join(root, `world-${samples.length}`);
    try {
      await mkdir(world, { mode: 0o700 });
      const snapshotStarted = performance.now();
      const snapshot = await snapshotInputs({ cwd: root, functionsSource: source, services: ['functions'], env: { NODE_PATH: '' } }, world);
      const snapshotElapsedMs = performance.now() - snapshotStarted;
      if (snapshot.stats.method !== 'copy') throw Error(`snapshot used ${snapshot.stats.method}, expected portable copy`);
      if (snapshot.stats.files !== fileCount + 1) throw Error(`expected ${fileCount + 1} owned files, observed ${snapshot.stats.files}`);
      if (snapshot.stats.bytes !== fileCount * bytesPerFile + Buffer.byteLength(JSON.stringify(snapshot.config))) throw Error(`unexpected byte total ${snapshot.stats.bytes}`);
      const generationStarted = performance.now();
      const generation = await prepareGeneration(snapshot, join(world, 'generation'));
      const generationElapsedMs = performance.now() - generationStarted;
      if (generation.stats.method !== 'copy') throw Error(`generation used ${generation.stats.method}, expected portable copy`);
      if (generation.stats.files !== fileCount + 1) throw Error(`expected ${fileCount + 1} generation files, observed ${generation.stats.files}`);
      if (generation.stats.bytes !== fileCount * bytesPerFile + (await stat(generation.configPath)).size) throw Error(`unexpected generation byte total ${generation.stats.bytes}`);
      samples.push({ pool: limit, snapshot: { elapsedMs: snapshotElapsedMs, stats: snapshot.stats }, generationCopy: { elapsedMs: generationElapsedMs, stats: generation.stats } });
    } finally {
      await rm(world, { recursive: true, force: true });
    }
  };

  // Alternate order to reduce drift from cache and background filesystem activity.
  for (let pair = 0; pair < pairs; pair++) {
    const order = pair % 2 === 0 ? [1, 4] : [4, 1];
    for (const limit of order) await measure(limit);
  }

  const report = {
    benchmark: 'world-copy-followup',
    sourceCommit,
    implementationHash,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    fileCount,
    bytesPerFile,
    sourceBytes: fileCount * bytesPerFile,
    sourceTreeHash: sourceHash.digest('hex'),
    samples,
    mediansMs: Object.fromEntries(['snapshot', 'generationCopy'].map(phase => [phase, Object.fromEntries([1, 4].map(limit => {
      const values = samples.filter(sample => sample.pool === limit).map(sample => sample[phase].elapsedMs).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      return [String(limit), median];
    }))])),
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, text, { flag: 'wx' });
  else process.stdout.write(text);
} finally {
  Object.assign(cloneSupport, originalCloneSupport);
  copySupport.maxConcurrentFiles = originalCopyLimit;
  await rm(root, { recursive: true, force: true });
}
