import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { validateTreeContents, validateConfigOwner } from './benchmark-world-copy-integrity.mjs';

function record(bytes) {
  return { type: 'file', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function treeFixture(t, stage) {
  const root = await mkdtemp(join(tmpdir(), `fireemu-world-copy-integrity-${stage}-`));
  const destination = join(root, 'functions');
  const bucket = join(destination, 'bucket-00');
  await mkdir(bucket, { recursive: true });
  const first = Buffer.from('file-00000001-data');
  const second = Buffer.from('file-00000002-data');
  await writeFile(join(bucket, 'first.bin'), first);
  await writeFile(join(bucket, 'second.bin'), second);
  const expected = {
    'bucket-00': { type: 'directory' },
    'bucket-00/first.bin': record(first),
    'bucket-00/second.bin': record(second),
  };
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, destination, bucket, first, second, expected };
}

for (const stage of ['snapshot', 'generation']) {
  test(`${stage} integrity validation detects transposed fixture payloads`, async t => {
    const fixture = await treeFixture(t, stage);
    const summary = await validateTreeContents(fixture.destination, fixture.expected, stage);
    assert.equal(summary.files, 2);
    assert.equal(summary.directories, 1);
    await writeFile(join(fixture.bucket, 'first.bin'), fixture.second);
    await writeFile(join(fixture.bucket, 'second.bin'), fixture.first);
    await assert.rejects(validateTreeContents(fixture.destination, fixture.expected, stage), /content mismatch.*first.bin/i);
  });

  test(`${stage} integrity validation rejects missing and extra paths`, async t => {
    const fixture = await treeFixture(t, stage);
    await rm(join(fixture.bucket, 'first.bin'));
    await assert.rejects(validateTreeContents(fixture.destination, fixture.expected, stage), /missing=.*first.bin/i);
    await writeFile(join(fixture.bucket, 'first.bin'), fixture.first);
    await writeFile(join(fixture.bucket, 'unexpected.bin'), 'unexpected');
    await assert.rejects(validateTreeContents(fixture.destination, fixture.expected, stage), /extra=.*unexpected.bin/i);
  });
}

for (const stage of ['snapshot', 'generation']) {
  test(`${stage} configuration paths stay within their copy owner`, async t => {
    const root = await mkdtemp(join(tmpdir(), `fireemu-world-copy-config-${stage}-`));
    const owner = join(root, stage === 'snapshot' ? 'baseline' : 'generation', 'inputs');
    const source = join(owner, 'functions-0', 'source');
    const other = join(root, 'other', 'functions');
    const configPath = join(owner, 'fireemu.json');
    const externalConfig = join(root, 'other', 'fireemu.json');
    await mkdir(source, { recursive: true });
    await mkdir(other, { recursive: true });
    await writeFile(configPath, JSON.stringify({ functions: { source } }));
    await writeFile(externalConfig, JSON.stringify({ functions: { source } }));
    t.after(() => rm(root, { recursive: true, force: true }));

    const valid = await validateConfigOwner(configPath, owner, source, stage);
    assert.equal(valid.sourcePath, relative(owner, source));
    await assert.rejects(validateConfigOwner(externalConfig, owner, source, stage), /config path escapes .* owner/i);
    await writeFile(configPath, JSON.stringify({ functions: { source: other } }));
    await assert.rejects(validateConfigOwner(configPath, owner, source, stage), /functions source escapes .* owner/i);
  });
}
