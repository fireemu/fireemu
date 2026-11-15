import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vm from 'node:vm';

test('upload cleanup preserves a colliding unowned directory and the startup error', async () => {
  if (!vm.SourceTextModule) {
    execFileSync(process.execPath, ['--experimental-vm-modules', '--test', fileURLToPath(import.meta.url)], {
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      timeout: 30_000,
    });
    return;
  }
  const { createContext, SourceTextModule, SyntheticModule } = vm;
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  await mkdir(join(repository, 'target', 'codex-out'), { recursive: true });
  const scratch = await mkdtemp(join(repository, 'target', 'codex-out', 'upload-ownership-'));
  try {
    const stale = join(scratch, 'target', `checksum-upload-worlds-${process.pid}`);
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, 'unrelated.txt'), 'preserve me');
    const harnessPath = join(scratch, 'tools', 'performance', 'checksum', 'upload.mjs');
    await mkdir(dirname(harnessPath), { recursive: true });
    const source = await readFile(new URL('./upload.mjs', import.meta.url), 'utf8');
    await writeFile(harnessPath, source);
    const env = { CHECKSUM_UPLOAD_PAIRS: '1', CHECKSUM_UPLOAD_SIZES: '0' };
    for (const role of ['BASELINE', 'CANDIDATE']) {
      const binary = join(scratch, role);
      await writeFile(binary, role, { mode: 0o700 });
      env[`FIREEMU_${role}_BINARY`] = binary;
      env[`FIREEMU_${role}_SHA256`] = createHash('sha256').update(role).digest('hex');
    }
    let errorOutput = '';
    let tempRoot;
    const startupError = new Error('owned startup failure');
    const fakeProcess = {
      pid: process.pid,
      env,
      stderr: { write: (value) => { errorOutput += value; } },
      stdout: { write: () => assert.fail('a failed run must not report success') },
    };
    const context = createContext({ assert, process: fakeProcess, Buffer, URL });
    const module = new SourceTextModule(source.replace('main().catch(', 'await main().catch('), {
      context,
      initializeImportMeta: (meta) => { meta.url = pathToFileURL(harnessPath).href; },
    });
    await module.link(async (specifier) => {
      const exports = specifier.startsWith('node:') ? await import(specifier) : {
        createTestWorld: async (options) => {
          tempRoot = options.tempRoot;
          await writeFile(join(tempRoot, 'owned.txt'), 'owned by this run');
          throw startupError;
        },
      };
      return new SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      }, { context });
    });
    await module.evaluate();
    assert.equal(fakeProcess.exitCode, 1);
    assert.equal(errorOutput, `${startupError.stack}\n`);
    assert.ok(tempRoot, 'startup must reach the owned root');
    assert.equal(await readFile(join(stale, 'unrelated.txt'), 'utf8'), 'preserve me');
    assert.notEqual(tempRoot, stale);
    assert.equal(dirname(tempRoot), join(scratch, 'target'));
    await assert.rejects(stat(tempRoot), { code: 'ENOENT' });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
