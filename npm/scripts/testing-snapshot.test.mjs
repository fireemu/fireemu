import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink, readlink, realpath, readdir, open, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join, dirname, delimiter, relative, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay, setImmediate } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs, { constants as fsConstants } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import fsp from 'node:fs/promises';
import test from 'node:test';
import { snapshotInputs, prepareGeneration, readRegularFile, removeSnapshotTree, cloneSupport } from '../fireemu/testing-snapshot.mjs';
import { createTestWorld } from '../fireemu/testing.mjs';

const exec = promisify(execFile);
const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';

// Full order-3 PICT table for read-only location × links × first removal attempt.
for (const readOnly of ['None', 'Root', 'Leaf']) {
  for (const link of ['NoLink', 'External']) {
    for (const failure of ['Actual', 'Permission', 'Other']) {
      test(`snapshot removal repairs only permission failures: ${readOnly} / ${link} / ${failure}`, { skip: process.platform === 'win32' }, async t => {
        const root = await realpath(await mkdtemp(join(tmpdir(), 'fireemu-world-remove-')));
        t.after(() => removeSnapshotTree(root));
        const owned = join(root, 'owned'), leaf = join(owned, 'leaf'), external = join(root, 'external');
        await mkdir(leaf, { recursive: true });
        await mkdir(external, { mode: 0o750 });
        const mode = (await stat(external)).mode & 0o777;
        await writeFile(join(leaf, 'data'), 'owned');
        await writeFile(join(external, 'data'), 'outside');
        if (link === 'External') await symlink(external, join(owned, 'link'), directoryLink);
        if (readOnly === 'Root') await chmod(owned, 0o500);
        if (readOnly === 'Leaf') await chmod(leaf, 0o500);
        const error = Object.assign(new Error('first removal attempt'), { code: failure === 'Permission' ? 'EACCES' : 'EIO' });
        let attempts = 0, repairs = 0;
        const originalRemove = fsp.rm, originalChmod = fsp.chmod;
        const remove = t.mock.method(fsp, 'rm', (path, ...args) => {
          if (path === owned && ++attempts === 1 && failure !== 'Actual') return Promise.reject(error);
          return originalRemove(path, ...args);
        });
        const repair = t.mock.method(fsp, 'chmod', (path, ...args) => {
          if (path === owned || path === leaf) repairs++;
          return originalChmod(path, ...args);
        });
        syncBuiltinESMExports();
        try {
          if (failure === 'Other') {
            await assert.rejects(removeSnapshotTree(owned), reason => reason === error);
            assert.equal(attempts, 1);
            assert.equal(repairs, 0);
          } else {
            await removeSnapshotTree(owned);
            const needsRepair = failure === 'Permission' || (readOnly !== 'None' && process.getuid?.() !== 0);
            assert.equal(attempts, needsRepair ? 2 : 1);
            assert.equal(repairs > 0, needsRepair);
            await assert.rejects(stat(owned), { code: 'ENOENT' });
          }
          assert.equal((await stat(external)).mode & 0o777, mode);
          assert.equal(await readFile(join(external, 'data'), 'utf8'), 'outside');
        } finally {
          remove.mock.restore();
          repair.mock.restore();
          syncBuiltinESMExports();
        }
      });
    }
  }
}

test('permission recovery continues after a different directory has already disappeared', { skip: process.platform === 'win32' }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fireemu-world-remove-partial-')));
  t.after(() => removeSnapshotTree(root));
  const owned = join(root, 'owned'), first = join(owned, 'first'), last = join(owned, 'last');
  await mkdir(first, { recursive: true });
  await mkdir(last);
  await writeFile(join(last, 'data'), 'owned');
  await chmod(last, 0o500);
  const originalChmod = fsp.chmod, originalReaddir = fsp.readdir;
  const repair = t.mock.method(fsp, 'chmod', async (path, ...args) => {
    if (path === first) await rm(first, { recursive: true, force: true });
    return originalChmod(path, ...args);
  });
  const list = t.mock.method(fsp, 'readdir', async (path, ...args) => {
    const entries = await originalReaddir(path, ...args);
    return path === owned ? entries.sort((a,b) => a.name.localeCompare(b.name)) : entries;
  });
  const originalRemove = fsp.rm;
  let attempt = 0;
  const remove = t.mock.method(fsp, 'rm', (path, ...args) => {
    if (path === owned && ++attempt === 1) return Promise.reject(Object.assign(Error('permission denied'), { code: 'EACCES' }));
    return originalRemove(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    await removeSnapshotTree(owned);
    assert.equal(attempt, 2);
    await assert.rejects(stat(owned), { code: 'ENOENT' });
  } finally {
    repair.mock.restore();
    list.mock.restore();
    remove.mock.restore();
    syncBuiltinESMExports();
  }
});

// Full order-3 PICT table for tree depth × leaf kind × capture or portable generation.
for (const depth of ['Flat', 'Nested']) {
  for (const leaf of ['File', 'Link']) {
    for (const stage of ['Snapshot', 'Generation']) {
      test(`portable copy creates a visited leaf parent once: ${depth} / ${leaf} / ${stage}`, { skip: process.platform === 'win32' && leaf === 'Link' }, async t => {
        const f = await fixture(t);
        await withCloneSupport(t, { file: false, tree: false });
        const parent = depth === 'Nested' ? join(f.source, 'nested') : f.source;
        await mkdir(parent, { recursive: true });
        await writeFile(join(parent, 'target.txt'), 'snapshot bytes');
        if (leaf === 'Link') await symlink('target.txt', join(parent, 'linked.txt'), 'file');
        const generation = join(f.world, 'generation');
        const mkdirCalls = [];
        const originalMkdir = fsp.mkdir;
        const mock = t.mock.method(fsp, 'mkdir', (path, ...args) => {
          mkdirCalls.push(path);
          return originalMkdir(path, ...args);
        });
        syncBuiltinESMExports();
        try {
          const snapshot = await snapshotInputs(f.options, f.world);
          let copied = snapshot.config.functions.source;
          if (stage === 'Generation') {
            const prepared = await prepareGeneration(snapshot, generation);
            copied = JSON.parse(await readFile(prepared.configPath, 'utf8')).functions.source;
          }
          const copiedParent = join(copied, relative(f.source, parent));
          const copiedLeaf = join(copiedParent, leaf === 'File' ? 'target.txt' : 'linked.txt');
          assert.equal(await readFile(copiedLeaf, 'utf8'), 'snapshot bytes');
          await writeFile(copiedLeaf, 'generation bytes');
          assert.equal(await readFile(join(parent, 'target.txt'), 'utf8'), 'snapshot bytes');
          assert.equal(mkdirCalls.filter(path => path === copiedParent).length, 1);
        } finally {
          mock.mock.restore();
          syncBuiltinESMExports();
        }
      });
    }
  }
}

test('portable copy still prepares missing parents for a root file input', async t => {
  const f = await fixture(t);
  const source = join(f.source, 'entry.cjs');
  await writeFile(source, 'module.exports = {};');
  await mkdir(join(f.root, 'node_modules'));
  const snapshot = await snapshotInputs({ ...f.options, functionsSource: source }, f.world);
  assert.equal(await readFile(snapshot.config.functions.source, 'utf8'), 'module.exports = {};');
});

test('configuration open cancellation closes a handle returned after abort', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-open-cancel-'));
  let openHandle;
  t.after(async () => { if (openHandle) await openHandle.close().catch(() => {}); await rm(root, { recursive: true, force: true }); });
  const path = join(root, 'config.json');
  await writeFile(path, '{}');
  const controller = new AbortController();
  const reason = Error('cancel during configuration open');
  let releaseOpen, markStarted;
  const release = new Promise(resolve => { releaseOpen = resolve; });
  const started = new Promise(resolve => { markStarted = resolve; });
  const delayedOpen = async (file, flags) => {
    markStarted();
    await release;
    openHandle = await open(file, flags);
    return openHandle;
  };
  const pending = readRegularFile(path, controller.signal, delayedOpen);
  await started;
  controller.abort(reason);
  releaseOpen();
  await assert.rejects(pending, error => error === reason);
  assert.ok(openHandle, 'open resolved with an owned file handle');
  await assert.rejects(openHandle.stat(), { code: 'EBADF' });
});

for (const mode of ['implicit', 'explicit-without-node-path', 'explicit-empty', 'explicit-global']) {
  test(`test world NODE_PATH requires explicit environment selection: ${mode}`, async t => {
    const f = await fixture(t);
    await linkedRepository(f);
    const temporary = join(f.root, 'temporary');
    await mkdir(temporary);
    const settings = { cwd: f.root, functionsSource: f.source, services: ['auth', 'functions'], binaryPath: process.execPath, tempRoot: temporary };
    const script = `
      import assert from 'node:assert/strict';
      import { readdir } from 'node:fs/promises';
      import { createTestWorld } from ${JSON.stringify(new URL('../fireemu/testing.mjs', import.meta.url).href)};
      const settings = ${JSON.stringify(settings)};
      const mode = ${JSON.stringify(mode)};
      if (mode !== 'implicit') {
        settings.env = { ...process.env };
        if (mode === 'explicit-empty') settings.env.NODE_PATH = '';
        if (mode === 'explicit-without-node-path') delete settings.env.NODE_PATH;
      }
      // Node cannot act as the daemon: reaching its startup error proves snapshot completion.
      await assert.rejects(createTestWorld(settings), mode === 'explicit-global' ? /Cannot snapshot NODE_PATH/ : /fireemu could not start test world/);
      assert.deepEqual(await readdir(${JSON.stringify(temporary)}), []);
    `;
    await exec(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, NODE_PATH: f.modules }, timeout: 10000 });
  });
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fireemu-node-path-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), modules = join(root, 'shared'), world = join(root, 'world');
  await Promise.all([source, modules, world].map(path => mkdir(path)));
  return { root, source, modules, world, options: { cwd: root, functionsSource: source, env: { NODE_PATH: 'shared' } } };
}

// Full order-3 PICT table for origin × entry × copy mode.
for (const origin of ['Source', 'NodePath']) {
  for (const entry of ['File', 'Directory']) {
    for (const copy of ['Portable', 'CloneEnabled']) {
      test(`Functions capture inspects each entry once: ${origin} / ${entry} / ${copy}`, async t => {
        const f = await fixture(t);
        await withCloneSupport(t, { file: copy === 'CloneEnabled' });
        const parent = origin === 'Source' ? f.source : f.modules;
        const input = join(parent, 'tracked');
        const leaf = entry === 'File' ? input : join(input, 'leaf.txt');
        if (entry === 'Directory') await mkdir(input);
        await writeFile(leaf, 'creation bytes');
        const originalLstat = fsp.lstat;
        let inspections = 0;
        const mock = t.mock.method(fsp, 'lstat', (path, ...args) => {
          if (path === input) inspections++;
          return originalLstat(path, ...args);
        });
        syncBuiltinESMExports();
        t.after(() => {
          mock.mock.restore();
          syncBuiltinESMExports();
        });
        const snapshot = await snapshotInputs(f.options, f.world);
        const copyParent = origin === 'Source' ? snapshot.config.functions.source : snapshot.nodePaths[0];
        assert.equal(await readFile(join(copyParent, relative(parent, leaf)), 'utf8'), 'creation bytes');
        assert.equal(inspections, 1);
      });
    }
  }
}

// Full order-3 PICT table for target × capture graph × snapshot generation.
for (const target of ['Exact', 'Descendant', 'External']) {
  for (const graph of ['Single', 'Overlap']) {
    for (const verify of ['Capture', 'Generation']) {
      test(`Functions links use the closest captured owner: ${target} / ${graph} / ${verify}`, async t => {
        const f = await fixture(t);
        const owner = graph === 'Overlap' ? join(f.source, 'nested') : f.source;
        const consumer = join(f.root, 'consumer');
        const selected = {
          Exact: owner,
          Descendant: join(owner, 'pkg'),
          External: join(f.root, 'external'),
        }[target];
        await mkdir(owner, { recursive: true });
        await mkdir(selected, { recursive: true });
        await mkdir(consumer);
        await writeFile(join(selected, 'fixture.txt'), 'original dependency');
        await symlink(selected, join(consumer, 'dependency'), directoryLink);
        const originalRelative = path.relative;
        let unrelatedChecks = 0;
        const mock = t.mock.method(path, 'relative', (from, to) => {
          if (from === consumer && to === selected) unrelatedChecks++;
          return originalRelative(from, to);
        });
        syncBuiltinESMExports();
        t.after(() => {
          mock.mock.restore();
          syncBuiltinESMExports();
        });

        const sources = graph === 'Overlap' ? [f.source, owner, consumer] : [owner, consumer];
        const snapshot = await snapshotInputs({
          cwd: f.root,
          config: { functions: sources.map(source => ({ source })) },
          services: ['functions'],
          env: { NODE_PATH: '' },
        }, f.world);
        const config = verify === 'Capture' ? snapshot.config
          : JSON.parse(await readFile((await prepareGeneration(snapshot, join(f.world, 'generation'))).configPath, 'utf8'));
        const { functions } = JSON.parse(await readFile(config.firebaseJson, 'utf8'));
        const linked = join(functions.at(-1).source, 'dependency');
        const savedOwner = functions.at(-2).source;
        assert.equal(await readFile(join(linked, 'fixture.txt'), 'utf8'), 'original dependency');
        if (target !== 'External') {
          const expected = target === 'Exact' ? savedOwner : join(savedOwner, 'pkg');
          assert.equal(await realpath(linked), await realpath(expected));
        } else {
          assert.notEqual(await realpath(linked), await realpath(selected));
        }
        if (process.platform !== 'win32') assert.equal(unrelatedChecks, 0);
      });
    }
  }
}
function hideAbortSignalAny(t) {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  Object.defineProperty(AbortSignal, 'any', { configurable: true, writable: true, value: undefined });
  t.after(() => descriptor ? Object.defineProperty(AbortSignal, 'any', descriptor) : delete AbortSignal.any);
}
async function linkedRepository(f) {
  const repository = join(f.root, 'unrelated-repository');
  await mkdir(repository);
  await symlink(repository, join(f.modules, 'unused-tool'), directoryLink);
  await symlink(join(f.root, 'missing-directory'), join(repository, 'broken'), directoryLink);
  return repository;
}
async function packageAt(modules, name, value) {
  const path = join(modules, name);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'index.js'), `module.exports=${JSON.stringify(value)};`);
  return path;
}

for (const copying of ['copy', 'file', 'tree', 'fallback']) {
  test(`snapshot and reset privately own relative, external and symlinked Storage signed URL keys: ${copying}`, { skip: process.platform === 'win32' }, async t => {
    await withCloneSupport(t, copying === 'tree' ? plainCopy : copying === 'fallback'
      ? { tree: true, treeCommand: 'false', treeArguments: () => [] }
      : { file: copying === 'file' });
    if (copying === 'file') {
      const real = fsp.copyFile;
      t.mock.method(fsp, 'copyFile', (source, destination) => real(source, destination, fsConstants.COPYFILE_EXCL));
    }
    const f = await fixture(t);
    const external = await realpath(await mkdtemp(join(tmpdir(), 'fireemu-external-keys-')));
    t.after(() => rm(external, { recursive: true, force: true }));
    assert.ok(relative(f.root, external).startsWith('..'), 'external keys are outside options.cwd');
    const relativeKey = join(f.root, 'keys', 'relative.pem');
    const absoluteKey = join(external, 'absolute.pem');
    const targetKey = join(external, 'target.pem');
    const linkedKey = join(f.root, 'linked.pem');
    await mkdir(join(f.root, 'keys'));
    const originals = ['relative creation key', 'external creation key', 'symlink creation key'];
    for (const [index, path] of [relativeKey, absoluteKey, targetKey].entries()) {
      await writeFile(path, originals[index]);
      await chmod(path, 0o644);
    }
    await symlink(targetKey, linkedKey, 'file');
    const config = {
      schemaVersion: 1,
      storage: { signedUrlKeys: ['keys/relative.pem', absoluteKey, linkedKey] },
    };
    const snapshot = await snapshotInputs({ ...f.options, config }, f.world);
    assert.deepEqual(config.storage.signedUrlKeys, ['keys/relative.pem', absoluteKey, linkedKey]);
    assert.equal(snapshot.config.storage.signedUrlKeys.length, originals.length);
    for (const [index, path] of snapshot.config.storage.signedUrlKeys.entries()) {
      assert.equal(await readFile(path, 'utf8'), originals[index]);
      assert.equal((await stat(path)).mode & 0o777, 0o600, 'baseline key mode');
      const rel = relative(snapshot.baseline, path);
      assert.ok(rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
    }

    await writeFile(relativeKey, 'caller changed relative key');
    await rm(absoluteKey);
    await writeFile(targetKey, 'caller changed symlink target');
    for (const name of ['generation', 'reset']) {
      if (name === 'reset') await rm(targetKey);
      const generation = await prepareGeneration(snapshot, join(f.world, name));
      assert.equal(generation.stats.method, copying === 'file' || copying === 'tree' ? 'clone' : 'copy');
      const prepared = JSON.parse(await readFile(generation.configPath, 'utf8'));
      assert.equal(prepared.storage.signedUrlKeys.length, originals.length);
      for (const [index, path] of prepared.storage.signedUrlKeys.entries()) {
        assert.equal(await readFile(path, 'utf8'), originals[index]);
        assert.equal((await stat(path)).mode & 0o777, 0o600, `${name} key mode`);
        const rel = relative(generation.cwd, path);
        assert.ok(rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
        if (name === 'generation') await writeFile(path, 'generation-local mutation');
      }
    }
  });
}

test('Storage signed URL key snapshots preserve an empty list and reject missing files', async t => {
  const f = await fixture(t);
  const empty = await snapshotInputs({ ...f.options, config: { schemaVersion: 1, storage: { signedUrlKeys: [] } } }, f.world);
  assert.deepEqual(empty.config.storage.signedUrlKeys, []);

  const missing = join(f.root, 'missing.pem');
  const missingWorld = join(f.root, 'missing-world');
  await mkdir(missingWorld);
  await assert.rejects(
    snapshotInputs({ ...f.options, config: { schemaVersion: 1, storage: { signedUrlKeys: [missing] } } }, missingWorld),
    error => error.message.includes(missing) && error.message.includes('ENOENT'),
  );
});

for (const explicit of [false, true]) {
  test(`native world preserves ordinary environment and isolates opted-in globals: ${explicit}`, { skip: !process.env.FIREEMU_TEST_BINARY }, async t => {
    const f = await fixture(t);
    await writeFile(join(f.source, 'index.js'), 'module.exports = {};');
    if (explicit) await packageAt(f.modules, 'needed', 'creation');
    else await linkedRepository(f);
    const settings = { cwd: f.root, functionsSource: f.source, services: ['auth', 'functions'], binaryPath: process.env.FIREEMU_TEST_BINARY };
    const script = `
      import assert from 'node:assert/strict';
      import { writeFile } from 'node:fs/promises';
      import { createTestWorld } from ${JSON.stringify(new URL('../fireemu/testing.mjs', import.meta.url).href)};
      const settings = ${JSON.stringify(settings)};
      if (${explicit}) settings.env = { ...process.env };
      const world = await createTestWorld(settings);
      try {
        if (${explicit}) await writeFile(${JSON.stringify(join(f.modules, 'needed', 'index.js'))}, "module.exports='caller mutation'");
        for (let generation = 0; generation < 2; generation++) {
          if (generation) await world.reset();
          const child = await world.run(process.execPath, ['-e', "console.log(process.env.FIREEMU_TEST_PARENT_MARKER)"]);
          assert.equal(child.stdout.trim(), 'inherited');
          if (${explicit}) {
            assert.ok(world.environment.NODE_PATH.includes('generation-' + (generation + 1)));
            const result = await world.run(process.execPath, ['-e', "console.log(require('needed'))"]);
            assert.equal(result.stdout.trim(), 'creation');
          } else assert.equal(world.environment.NODE_PATH, '');
        }
      } finally { await world.dispose(); }
    `;
    await exec(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, NODE_PATH: f.modules, FIREEMU_TEST_PARENT_MARKER: 'inherited', FIREEMU_RUNNER_NODE: new URL('../../tools/runner-node/index.mjs', import.meta.url).pathname }, timeout: 30000 });
  });
}

test('NODE_PATH errors identify the original entry, copy root and complete external link chain', async t => {
  const f = await fixture(t), repository = await linkedRepository(f);
  await assert.rejects(snapshotInputs(f.options, f.world), error => {
    assert.ok(error.message.includes(`NODE_PATH entry \"shared\" (copy root ${JSON.stringify(f.modules)})`), error.message);
    for (const value of ['NODE_PATH', 'shared', f.modules, join(f.modules, 'unused-tool'), repository, join(repository, 'broken'), 'missing-directory', 'ENOENT']) {
      assert.ok(error.message.includes(value), `Missing ${value}: ${error.message}`);
    }
    let original = error;
    while (original.cause) original = original.cause;
    assert.equal(original.code, 'ENOENT');
    assert.ok(error.message.includes('nodePathExcludes'));
    return true;
  });
});

test('explicit NODE_PATH exclusions avoid unrelated repositories and retain private required globals across reset', async t => {
  const f = await fixture(t);
  await linkedRepository(f);
  const dependency = await packageAt(f.modules, 'needed', 'creation');
  const options = { ...f.options, nodePathExcludes: ['unused-tool'] };
  const snapshot = await snapshotInputs(options, f.world);
  assert.deepEqual(options.nodePathExcludes, ['unused-tool']);
  await writeFile(join(dependency, 'index.js'), "module.exports='caller mutation'");
  for (const name of ['generation', 'reset']) {
    const prepared = await prepareGeneration(snapshot, join(f.world, name));
    assert.deepEqual(await readdir(prepared.nodePath), ['needed']);
    const result = await exec(process.execPath, ['-e', "console.log(require('needed'))"], { env: { ...process.env, NODE_PATH: prepared.nodePath } });
    assert.equal(result.stdout.trim(), 'creation');
    await writeFile(join(prepared.nodePath, 'needed', 'index.js'), "module.exports='generation mutation'");
  }
});

test('NODE_PATH exclusions match exact scoped and unscoped package names, not prefixes', async t => {
  const f = await fixture(t);
  const names = ['tool', 'tool-extra', '@scope/tool', '@scope/tool-extra', '@other/tool', 'tool.js'];
  for (const name of names) await packageAt(f.modules, name, name);
  // Bounded generated subsets check exact matching independently of the filter implementation.
  for (let mask = 0; mask < 1 << names.length; mask++) {
    const exclusions = names.filter((_, index) => mask & (1 << index));
    const world = join(f.root, `world-${mask}`);
    await mkdir(world);
    const snapshot = await snapshotInputs({ ...f.options, nodePathExcludes: exclusions }, world);
    for (let index = 0; index < names.length; index++) {
      const path = join(snapshot.nodePaths[0], names[index], 'index.js');
      if (mask & (1 << index)) await assert.rejects(readFile(path), { code: 'ENOENT' });
      else assert.equal(await readFile(path, 'utf8'), `module.exports=${JSON.stringify(names[index])};`);
    }
  }
});

for (const invalid of [null, '', 'tool', {}, ['*'], ['@scope/*'], ['tool?'], ['tool[ab]'], ['tool{a,b}'], [' tool'], ['tool name'], ['@scope/ tool'], ['tool:stream'], [null], [1], [''], ['.'], ['..'], ['../tool'], ['/tool'], ['tool/nested'], ['@scope'], ['@scope/..'], ['@scope/tool/nested'], ['tool\\nested'], ['tool\0bad']]) {
  test(`invalid nodePathExcludes is rejected: ${JSON.stringify(invalid)}`, async t => {
    const f = await fixture(t);
    await assert.rejects(snapshotInputs({ ...f.options, nodePathExcludes: invalid }, f.world), error => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /nodePathExcludes/);
      return true;
    });
  });
}

test('excluding one package does not suppress a different missing dependency', async t => {
  const f = await fixture(t);
  await linkedRepository(f);
  await symlink(join(f.root, 'other-missing'), join(f.modules, 'needed'), directoryLink);
  await assert.rejects(snapshotInputs({ ...f.options, nodePathExcludes: ['unused-tool'] }, f.world), error => {
    assert.ok(error.message.includes(join(f.modules, 'needed')));
    assert.ok(error.message.includes('ENOENT'));
    return true;
  });
});

test('retained links into an excluded directory fail explicitly instead of creating dangling snapshot links', async t => {
  const f = await fixture(t);
  const excluded = await packageAt(f.modules, 'excluded', 'needed');
  await symlink(excluded, join(f.modules, 'retained'), directoryLink);
  await assert.rejects(snapshotInputs({ ...f.options, nodePathExcludes: ['excluded'] }, f.world), /excluded.*retained|retained.*excluded/);
});

test('exclusions do not prune Functions sources or an already captured ancestor node_modules root', async t => {
  const f = await fixture(t);
  const modules = join(f.root, 'node_modules');
  await packageAt(modules, 'needed', 'local');
  const snapshot = await snapshotInputs({ ...f.options, env: { NODE_PATH: modules }, nodePathExcludes: ['needed'] }, f.world);
  assert.equal(await readFile(join(snapshot.nodePaths[0], 'needed', 'index.js'), 'utf8'), 'module.exports="local";');
});

test('worlds without Functions never traverse unrelated NODE_PATH roots', async t => {
  const f = await fixture(t);
  await linkedRepository(f);
  const snapshot = await snapshotInputs({ cwd: f.root, env: f.options.env }, f.world);
  assert.deepEqual(snapshot.nodePaths, []);
});

test('NODE_PATH search order and absent root handling survive explicit exclusions', async t => {
  const f = await fixture(t), second = join(f.root, 'second');
  await mkdir(second);
  for (const modules of [f.modules, second]) {
    await packageAt(modules, 'needed', modules);
    await symlink(join(f.root, 'missing'), join(modules, 'unused-tool'), directoryLink);
  }
  const snapshot = await snapshotInputs({ ...f.options, env: { NODE_PATH: ['absent', 'shared', 'second'].join(delimiter) }, nodePathExcludes: ['unused-tool'] }, f.world);
  assert.equal(snapshot.nodePaths.length, 2);
  for (const [index, original] of [f.modules, second].entries()) {
    assert.deepEqual(await readdir(snapshot.nodePaths[index]), ['needed']);
    assert.equal(await readFile(join(snapshot.nodePaths[index], 'needed', 'index.js'), 'utf8'), `module.exports=${JSON.stringify(original)};`);
  }
});

test('createTestWorld snapshots caller exclusions and cleans failed snapshot directories', async t => {
  const f = await fixture(t), temporary = join(f.root, 'temporary');
  await mkdir(temporary);
  await linkedRepository(f);
  const exclusions = [];
  const pending = createTestWorld({ ...f.options, binaryPath: process.execPath, tempRoot: temporary, nodePathExcludes: exclusions });
  exclusions.push('unused-tool');
  await assert.rejects(pending, /NODE_PATH/);
  assert.deepEqual(await readdir(temporary), []);
});

test('snapshot timeout names its phase, removes partial input and never starts the daemon', { timeout: 20_000 }, async t => {
  const f = await fixture(t), temporary = join(f.root, 'temporary');
  await mkdir(temporary);
  const source = join(f.root, 'slow-functions');
  await mkdir(source);
  const input = join(source, 'large.bin'), inputBytes = 96 * 1024 * 1024;
  const handle = await open(input, 'w');
  await handle.truncate(inputBytes);
  await handle.close();
  const marker = join(f.root, 'daemon-started');
  const daemon = join(f.root, 'marker-daemon');
  await writeFile(daemon, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\n`);
  await chmod(daemon, 0o755);

  await assert.rejects(createTestWorld({
    cwd: f.root,
    functionsSource: source,
    services: ['auth', 'functions'],
    env: { ...process.env, NODE_PATH: '' },
    binaryPath: daemon,
    tempRoot: temporary,
    snapshotTimeoutMs: 5,
  }), /test world snapshot timed out/);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.deepEqual(await readdir(temporary), []);
});

test('Firebase JSON overrides preserve the alias file when both configurations are snapshotted', async t => {
  const f = await fixture(t);
  const aliases = JSON.stringify({ projects: { default: 'demo-test-worlds' } });
  await writeFile(join(f.root, 'firebase.json'), JSON.stringify({ emulators: { auth: { port: 9099 } } }));
  await writeFile(join(f.root, 'firebase.test.json'), JSON.stringify({ emulators: { firestore: { port: 8080 } } }));
  await writeFile(join(f.root, '.firebaserc'), aliases);
  const snapshot = await snapshotInputs({
    cwd: f.root,
    config: { schemaVersion: 1, firebaseJson: 'firebase.json' },
    firebaseJson: 'firebase.test.json',
  }, f.world);
  assert.deepEqual(JSON.parse(await readFile(snapshot.config.firebaseJson, 'utf8')), { emulators: { firestore: { host: '127.0.0.1', port: 0 } } });
  assert.equal(await readFile(join(snapshot.baseline, '.firebaserc'), 'utf8'), aliases);
  assert.equal(await readFile(join(f.root, '.firebaserc'), 'utf8'), aliases);
});

test('snapshotTimeoutMs must fit the timer range before creating a world directory', async t => {
  const f = await fixture(t), temporary = join(f.root, 'temporary');
  await mkdir(temporary);
  for (const snapshotTimeoutMs of [2147483648, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 0, -1, 1.5, NaN]) {
    await assert.rejects(createTestWorld({
      ...f.options,
      binaryPath: process.execPath,
      tempRoot: temporary,
      snapshotTimeoutMs,
    }), /snapshotTimeoutMs must be a positive integer no greater than 2147483647/);
  }
  assert.deepEqual(await readdir(temporary), []);
});

test('snapshotTimeoutMs accepts the maximum timer delay', async t => {
  const f = await fixture(t);
  const reason = Error('cancel before snapshot');
  await assert.rejects(createTestWorld({
    ...f.options,
    binaryPath: process.execPath,
    tempRoot: f.world,
    snapshotTimeoutMs: 2147483647,
    signal: AbortSignal.abort(reason),
  }), error => error.cause === reason);
  assert.deepEqual(await readdir(f.world), []);
});

test('external abort during an active file copy settles I/O before removing the world directory', { timeout: 30_000 }, async t => {
  hideAbortSignalAny(t);
  const f = await fixture(t), temporary = join(f.root, 'temporary');
  await mkdir(temporary);
  const source = join(f.root, 'slow-functions');
  await mkdir(source);
  const input = join(source, 'large.bin'), inputBytes = 512 * 1024 * 1024;
  const handle = await open(input, 'w');
  await handle.truncate(inputBytes);
  await handle.close();
  const controller = new AbortController();
  const pending = createTestWorld({
    cwd: f.root,
    functionsSource: source,
    services: ['auth', 'functions'],
    env: { ...process.env, NODE_PATH: '' },
    binaryPath: process.execPath,
    tempRoot: temporary,
    snapshotTimeoutMs: 30_000,
    signal: controller.signal,
  });
  let outcome;
  pending.then(world => { outcome = { world }; }, error => { outcome = { error }; });
  let partialCopyObserved = false;
  const observationDeadline = Date.now() + 20_000;
  while (Date.now() < observationDeadline && !partialCopyObserved) {
    if (outcome?.error) assert.fail(`construction finished before cancellation: ${outcome.error.message}`);
    const [worldName] = await readdir(temporary);
    if (worldName) {
      try {
        const copied = await stat(join(temporary, worldName, 'baseline', 'functions-0', 'large.bin'));
        partialCopyObserved = copied.size > 0 && copied.size < inputBytes;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (!partialCopyObserved) await delay(2);
  }
  if (!partialCopyObserved) {
    controller.abort(Error('cancelled because no partial copy was observed'));
    await pending;
    assert.fail('expected to observe an active partial file copy');
  }

  const reason = Error('caller cancelled the snapshot');
  controller.abort(reason);
  await pending.then(
    () => assert.fail('expected aborted construction to reject'),
    error => {
      assert.match(error.message, /test world snapshot aborted/);
      assert.equal(error.cause, reason);
    },
  );
  assert.deepEqual(await readdir(temporary), []);
  await delay(25);
  assert.deepEqual(await readdir(temporary), []);
});

test('generation preparation abort removes its partial copy after the stream settles', { timeout: 30_000 }, async t => {
  await withCloneSupport(t, {});
  const f = await fixture(t), baseline = join(f.root, 'baseline'), generation = join(f.root, 'generation');
  await mkdir(baseline);
  const input = join(baseline, 'large.bin'), inputBytes = 512 * 1024 * 1024;
  const handle = await open(input, 'w');
  await handle.truncate(inputBytes);
  await handle.close();
  const controller = new AbortController();
  const reason = Error('cancel generation preparation');
  const pending = prepareGeneration({ baseline, config: { daemon: {} }, nodePaths: [] }, generation, controller.signal);
  let outcome;
  pending.then(value => { outcome = { value }; }, error => { outcome = { error }; });
  let partialCopyObserved = false;
  const observationDeadline = Date.now() + 20_000;
  while (Date.now() < observationDeadline && !partialCopyObserved) {
    if (outcome?.error) assert.fail(`generation preparation finished before cancellation: ${outcome.error.message}`);
    try {
      const copied = await stat(join(generation, 'inputs', 'large.bin'));
      partialCopyObserved = copied.size > 0 && copied.size < inputBytes;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!partialCopyObserved) await delay(2);
  }
  if (!partialCopyObserved) {
    controller.abort(Error('cancelled because no partial generation copy was observed'));
    await pending;
    assert.fail('expected to observe an active generation file copy');
  }

  controller.abort(reason);
  await pending.then(
    () => assert.fail('expected aborted generation preparation to reject'),
    error => {
      assert.equal(error.name, 'AbortError');
      assert.equal(error.cause, reason);
    },
  );
  await assert.rejects(stat(generation), { code: 'ENOENT' });
  await delay(25);
  await assert.rejects(stat(generation), { code: 'ENOENT' });
});

for (const api of ['snapshot', 'generation']) {
  for (const laterFailure of ['leaf', 'traversal']) {
    test(`${api} preserves an earlier slow leaf error before a later ${laterFailure} error`, { timeout: 10_000 }, async t => {
      await withCloneSupport(t, { file: false, tree: false });
      const f = await fixture(t);
      const earlier = join(f.source, '00-earlier.txt'), later = join(f.source, '01-later.txt');
      await writeFile(earlier, 'earlier');
      await writeFile(later, 'later');
      const earlierError = Object.assign(Error('earlier read denied'), { code: 'EACCES' });
      const laterError = Object.assign(Error('later read failed'), { code: 'EIO' });
      let earlierStream, pending, markLaterFailure;
      const laterFailed = new Promise(resolve => { markLaterFailure = resolve; });
      const streams = new Set();
      t.after(async () => {
        for (const stream of streams) stream.destroy();
        if (pending) await pending.catch(() => {});
        t.mock.restoreAll();
        syncBuiltinESMExports();
      });
      const realReaddir = fsp.readdir;
      t.mock.method(fsp, 'readdir', async (path, options) => {
        const entries = await realReaddir(path, options);
        return path === f.source ? entries.sort((a, b) => a.name.localeCompare(b.name)) : entries;
      });
      const realLstat = fsp.lstat;
      t.mock.method(fsp, 'lstat', async path => {
        if (path === later && laterFailure === 'traversal') {
          markLaterFailure();
          return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => false };
        }
        return realLstat(path);
      });
      const realCreateReadStream = fs.createReadStream;
      t.mock.method(fs, 'createReadStream', (path, options) => {
        if (path !== earlier && path !== later) return realCreateReadStream(path, options);
        const stream = new Readable({ signal: options.signal, read() {} });
        streams.add(stream);
        stream.once('close', () => streams.delete(stream));
        if (path === earlier) earlierStream = stream;
        else stream.destroy(laterError);
        return stream;
      });
      const realRm = fsp.rm;
      t.mock.method(fsp, 'rm', async (path, options) => {
        if (String(path).endsWith('/01-later.txt')) markLaterFailure();
        return realRm(path, options);
      });
      syncBuiltinESMExports();
      pending = api === 'snapshot'
        ? snapshotInputs({ cwd: f.root, functionsSource: f.source, services: ['functions'], env: { NODE_PATH: '' } }, f.world)
        : prepareGeneration({ baseline: f.source, config: { daemon: {} }, nodePaths: [] }, join(f.world, 'generation'));
      let settled = false;
      pending.then(() => { settled = true; }, () => { settled = true; });
      await laterFailed;
      await setImmediate();
      assert.ok(earlierStream, 'the earlier leaf was admitted before the later failure');
      const settledBeforeEarlierFailure = settled;
      earlierStream.destroy(earlierError);
      await assert.rejects(pending, error => api === 'snapshot' ? error.cause === earlierError : error === earlierError);
      assert.equal(settledBeforeEarlierFailure, false, 'the earlier copy finishes before rejection');
      assert.equal(streams.size, 0, 'all admitted input streams close before rejection');
      if (api === 'generation') await assert.rejects(stat(join(f.world, 'generation')), { code: 'ENOENT' });
    });
  }
}

test('a leaf failure drains admitted copies before generation cleanup and stops later admission', { timeout: 10_000 }, async t => {
  if (process.getuid?.() === 0 || process.platform === 'win32') return t.skip('permissions are not enforced');
  await withCloneSupport(t, { file: true });
  const f = await fixture(t), baseline = join(f.root, 'baseline'), generation = join(f.root, 'generation');
  await mkdir(baseline);
  for (let index = 0; index < 8; index++) await writeFile(join(baseline, `${String(index).padStart(2, '0')}.txt`), `input ${index}`);
  await chmod(join(baseline, '01.txt'), 0o000);
  t.after(() => chmod(join(baseline, '01.txt'), 0o600).catch(() => {}));

  let releaseCleanup, markCleanupStarted;
  const cleanupReleased = new Promise(resolve => { releaseCleanup = resolve; });
  let pending;
  const cleanupStarted = new Promise(resolve => { markCleanupStarted = resolve; });
  const copyGates = new Map();
  for (let index = 0; index < 8; index++) {
    if (index === 1) continue;
    let release;
    copyGates.set(`${String(index).padStart(2, '0')}.txt`, { promise: new Promise(resolve => { release = resolve; }), release: () => release() });
  }
  t.after(async () => {
    releaseCleanup();
    for (const gate of copyGates.values()) gate.release();
    if (pending) await pending.catch(() => {});
  });
  const calls = [];
  const realCopyFile = fsp.copyFile;
  t.mock.method(fsp, 'copyFile', async (source, destination) => {
    const name = source.split(/[\\/]/).pop();
    calls.push(name);
    if (name === '01.txt') {
      throw Object.assign(Error('clone unavailable'), { code: 'ENOTSUP' });
    }
    await copyGates.get(name).promise;
    return realCopyFile(source, destination, fsConstants.COPYFILE_EXCL);
  });
  let failedCopySignal;
  const failedInput = join(baseline, '01.txt');
  const realCreateReadStream = fs.createReadStream;
  t.mock.method(fs, 'createReadStream', (path, options) => {
    if (path === failedInput) failedCopySignal = options.signal;
    return realCreateReadStream(path, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const realRm = fsp.rm;
  t.mock.method(fsp, 'rm', async (path, options) => {
    if (String(path).endsWith('/01.txt')) {
      markCleanupStarted();
      await cleanupReleased;
    }
    return realRm(path, options);
  });

  let settled = false;
  pending = prepareGeneration({ baseline, config: { daemon: {} }, nodePaths: [] }, generation);
  pending.then(() => { settled = true; }, () => { settled = true; });
  const cleanupWasReached = await Promise.race([cleanupStarted.then(() => true), delay(2_000).then(() => false)]);
  if (!cleanupWasReached) {
    releaseCleanup();
    for (const gate of copyGates.values()) gate.release();
    await pending.catch(() => {});
    assert.fail('the failing leaf did not reach owned-output cleanup');
  }
  const admittedAtCleanup = calls.length;
  assert.ok(admittedAtCleanup <= 4, 'the admitted set stays within the pool bound');
  assert.ok(calls.includes('01.txt') && calls.some(name => name !== '01.txt'), `a failing and held copy were admitted: ${calls}`);
  assert.ok(failedCopySignal, 'the failing leaf reached its portable stream fallback');
  assert.equal(failedCopySignal.aborted, false, 'internal failures leave earlier copies running to preserve their errors');
  releaseCleanup();
  await delay(50);
  assert.equal(settled, false, 'generation rejection waits for every already admitted copy');
  for (const name of calls) if (name !== '01.txt') copyGates.get(name).release();
  await assert.rejects(pending, /EACCES|permission denied/i);
  await assert.rejects(stat(generation), { code: 'ENOENT' });
  await delay(25);
  await assert.rejects(stat(generation), { code: 'ENOENT' });
});

test('portable concurrent copies restore restrictive directory modes after their files settle', async t => {
  await withCloneSupport(t, { file: true });
  const readonlyPaths = [];
  t.after(async () => { for (const path of readonlyPaths) await chmod(path, 0o700).catch(() => {}); });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  const readonly = join(f.source, 'readonly');
  readonlyPaths.push(readonly);
  await mkdir(readonly);
  for (let index = 0; index < 8; index++) await writeFile(join(readonly, `${index}.js`), `module.exports = ${index};`);
  await chmod(readonly, 0o555);

  let releaseCopies, markCopyStarted;
  const copiesReleased = new Promise(resolve => { releaseCopies = resolve; });
  const copyStarted = new Promise(resolve => { markCopyStarted = resolve; });
  let pending;
  t.after(async () => { releaseCopies(); if (pending) await pending.catch(() => {}); });
  const realCopyFile = fsp.copyFile;
  t.mock.method(fsp, 'copyFile', async (source, destination) => {
    if (source.split(/[\\/]/).includes('readonly')) {
      markCopyStarted();
      await copiesReleased;
    }
    return realCopyFile(source, destination, fsConstants.COPYFILE_EXCL);
  });
  pending = snapshotInputs({ ...options, services: ['functions'] }, f.world);
  const copyWasStarted = await Promise.race([copyStarted.then(() => true), delay(2_000).then(() => false)]);
  if (!copyWasStarted) {
    releaseCopies();
    await pending;
    assert.fail('the read-only descendant copy did not start');
  }
  const baseline = join(f.world, 'baseline');
  const functionsDirectory = (await readdir(baseline)).find(name => name.startsWith('functions-'));
  const activeDirectory = join(baseline, functionsDirectory, 'readonly');
  assert.equal((await stat(activeDirectory)).mode & 0o777, 0o700, 'destination remains writable while a descendant copy is active');
  releaseCopies();
  const snapshot = await pending;
  const copiedDirectory = join(snapshot.config.functions.source, 'readonly');
  readonlyPaths.push(copiedDirectory);
  assert.equal((await stat(copiedDirectory)).mode & 0o777, 0o555);
  for (let index = 0; index < 8; index++) assert.equal(await readFile(join(copiedDirectory, `${index}.js`), 'utf8'), `module.exports = ${index};`);
});

// The checked order-3 PICT table is the full copy-path x source-shape x source-mode product.
const worldCopyPictCases = [
  { copyPath: 'Portable', shape: 'Flat', mode: 'Writable' },
  { copyPath: 'Portable', shape: 'Flat', mode: 'ReadOnly' },
  { copyPath: 'Portable', shape: 'Nested', mode: 'Writable' },
  { copyPath: 'Portable', shape: 'Nested', mode: 'ReadOnly' },
  { copyPath: 'CloneEnabled', shape: 'Flat', mode: 'Writable' },
  { copyPath: 'CloneEnabled', shape: 'Flat', mode: 'ReadOnly' },
  { copyPath: 'CloneEnabled', shape: 'Nested', mode: 'Writable' },
  { copyPath: 'CloneEnabled', shape: 'Nested', mode: 'ReadOnly' },
];
for (const row of worldCopyPictCases) {
  test(`PICT world copy case ${JSON.stringify(row)}`, async t => {
    const modePaths = [];
    t.after(async () => { for (const path of modePaths) await chmod(path, 0o700).catch(() => {}); });
    await withCloneSupport(t, { file: row.copyPath === 'CloneEnabled' });
    const f = await fixture(t), sourceTree = f.source;
    const target = row.shape === 'Nested' ? join(sourceTree, 'nested') : sourceTree;
    if (target !== sourceTree) await mkdir(target);
    const contents = new Map();
    for (let index = 0; index < 5; index++) {
      const name = `input-${index}.txt`, value = `case ${row.shape} file ${index}`;
      contents.set(name, value);
      await writeFile(join(target, name), value);
    }
    const expectedMode = (await stat(sourceTree)).mode & 0o777;
    if (row.mode === 'ReadOnly') {
      await chmod(sourceTree, 0o555);
      modePaths.push(sourceTree);
    }
    const snapshot = await snapshotInputs({ cwd: f.root, functionsSource: sourceTree, services: ['functions'], env: { NODE_PATH: '' } }, f.world);
    const copiedSource = snapshot.config.functions.source;
    modePaths.push(copiedSource);
    assert.equal((await stat(copiedSource)).mode & 0o777, row.mode === 'ReadOnly' ? 0o555 : expectedMode);
    const copiedTarget = row.shape === 'Nested' ? join(copiedSource, 'nested') : copiedSource;
    for (const [name, value] of contents) assert.equal(await readFile(join(copiedTarget, name), 'utf8'), value);
    const files = await regularFiles(snapshot.baseline);
    assert.equal(snapshot.stats.files, files.length);
    assert.equal(snapshot.stats.bytes, files.reduce((sum, [, size]) => sum + size, 0));
  });
}


test('scoped exclusions follow an external scope directory link before visiting excluded packages', async t => {
  const f = await fixture(t), scope = join(f.root, 'external-scope');
  await mkdir(scope);
  await symlink(scope, join(f.modules, '@scope'), directoryLink);
  await symlink(join(f.root, 'missing'), join(scope, 'unused'), directoryLink);
  await packageAt(scope, 'needed', 'creation');
  const snapshot = await snapshotInputs({ ...f.options, nodePathExcludes: ['@scope/unused'] }, f.world);
  const generation = await prepareGeneration(snapshot, join(f.world, 'generation'));
  assert.deepEqual(await readdir(join(generation.nodePath, '@scope')), ['needed']);
  await writeFile(join(scope, 'needed', 'index.js'), "module.exports='caller mutation'");
  const result = await exec(process.execPath, ['-e', "console.log(require('@scope/needed'))"], { env: { ...process.env, NODE_PATH: generation.nodePath } });
  assert.equal(result.stdout.trim(), 'creation');
});

test('scoped exclusions reject a linked scope already captured through another directory', async t => {
  const f = await fixture(t), scope = join(f.modules, 'shared-scope');
  await packageAt(scope, 'unused', 'also reachable');
  await symlink(scope, join(f.modules, '@scope'), directoryLink);
  await assert.rejects(snapshotInputs({ ...f.options, nodePathExcludes: ['@scope/unused'] }, f.world), /nodePathExcludes.*already captured|already captured.*nodePathExcludes/);
});

// Functions sources and dependencies are snapshotted only when a selected service loads them
// (model: PICT services x source x NODE_PATH, full order-3 product).
const serviceSelections = {
  default: undefined,
  auth: ['auth'],
  functions: ['functions'],
  'functions-codebase': ['functions:default'],
  'auth-and-functions': ['auth', 'functions'],
  'firestore-storage': ['firestore', 'storage'],
};
const functionsSources = ['none', 'functionsSource', 'firebase-json', 'config-source', 'manifest'];

async function selectionFixture(t, kind) {
  const f = await fixture(t);
  await mkdir(join(f.source, 'node_modules', 'dependency'), { recursive: true });
  await writeFile(join(f.source, 'index.js'), 'exports.main = 1;');
  await writeFile(join(f.source, 'node_modules', 'dependency', 'index.js'), 'module.exports = 2;');
  await packageAt(f.modules, 'global', 'shared');
  await writeFile(join(f.root, 'manifest.json'), '{}');
  const options = { cwd: f.root };
  if (kind === 'functionsSource') options.functionsSource = f.source;
  if (kind === 'firebase-json') {
    await writeFile(join(f.root, 'firebase.json'), JSON.stringify({ functions: [{ source: 'source', codebase: 'default' }], firestore: { rules: 'firestore.rules' } }));
    await writeFile(join(f.root, 'firestore.rules'), 'rules');
    options.firebaseJson = 'firebase.json';
  }
  if (kind === 'config-source') options.config = { schemaVersion: 1, functions: { source: 'source' } };
  if (kind === 'manifest') options.config = { schemaVersion: 1, functions: { manifest: 'manifest.json' } };
  return { f, options };
}

for (const [selection, services] of Object.entries(serviceSelections)) {
  for (const kind of functionsSources) {
    for (const nodePath of ['unset', 'set']) {
      test(`Functions snapshot follows the selected services: ${selection} / ${kind} / NODE_PATH ${nodePath}`, async t => {
        const { f, options } = await selectionFixture(t, kind);
        const selected = services === undefined || services.some(name => name.startsWith('functions'));
        const configured = kind !== 'none';
        const snapshot = await snapshotInputs({ ...options, services, env: nodePath === 'set' ? { NODE_PATH: 'shared' } : {} }, f.world);
        const copiedSource = ['functionsSource', 'firebase-json', 'config-source'].includes(kind);
        const baseline = await readdir(snapshot.baseline);
        assert.equal(baseline.some(name => name.startsWith('functions-')), selected && copiedSource, `baseline ${baseline}`);
        assert.equal(baseline.some(name => name.startsWith('node-path-')), selected && configured && nodePath === 'set');
        assert.equal(snapshot.nodePaths.length, selected && configured && nodePath === 'set' ? 1 : 0);
        assert.equal(snapshot.functionsSkipped, !selected);
        assert.equal(snapshot.functionsConfigured, selected && configured);
        const files = await regularFiles(snapshot.baseline);
        assert.equal(snapshot.stats.files, files.length, 'statistics count every file the snapshot owns');
        assert.equal(snapshot.stats.bytes, files.reduce((sum, [, size]) => sum + size, 0));
        if (!selected) assert.equal(files.length, kind === 'firebase-json' ? 3 : 1, 'only the configuration and non-Functions inputs');
        const config = JSON.parse(await readFile(join(snapshot.baseline, 'fireemu.json'), 'utf8'));
        assert.equal(config.functions.clock.date, 'virtual', 'clock policy survives');
        if (!selected) {
          assert.equal(config.functions.source, undefined);
          assert.equal(config.functions.manifest, undefined);
          assert.ok(!JSON.stringify(config).includes(f.source), 'no caller Functions path in the snapshot');
          if (kind === 'firebase-json') {
            const firebase = JSON.parse(await readFile(config.firebaseJson, 'utf8'));
            assert.equal(firebase.functions, undefined);
            assert.ok(firebase.firestore.rules.startsWith(snapshot.baseline), 'other services are still snapshotted');
          }
        } else if (copiedSource) {
          assert.ok(snapshot.stats.files >= 2, 'source and dependency were copied');
        }
      });
    }
  }
}

test('selecting Functions in a codebase-qualified form snapshots every configured source', async t => {
  const { f, options } = await selectionFixture(t, 'functionsSource');
  const snapshot = await snapshotInputs({ ...options, services: ['auth', 'functions:other'] }, f.world);
  assert.equal(snapshot.functionsSkipped, false);
  assert.ok((await readdir(snapshot.baseline)).some(name => name.startsWith('functions-')));
});

async function regularFiles(root) {
  const found = [];
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) found.push([path, (await stat(path)).size]);
    }
  };
  await visit(root);
  return found;
}

test('snapshot and generation statistics count the copied files and bytes', async t => {
  const { f, options } = await selectionFixture(t, 'functionsSource');
  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  const configBytes = (await stat(join(snapshot.baseline, 'fireemu.json'))).size;
  assert.equal(snapshot.stats.files, 3, 'two source files and the configuration written beside them');
  assert.equal(snapshot.stats.bytes, 'exports.main = 1;'.length + 'module.exports = 2;'.length + configBytes);
  assert.ok(snapshot.stats.directories >= 3);
  assert.ok(Number.isInteger(snapshot.stats.elapsedMs) && snapshot.stats.elapsedMs >= 0);
  assert.ok(['copy', 'clone', 'mixed'].includes(snapshot.stats.method));
  const generation = await prepareGeneration(snapshot, join(f.world, 'generation-1'));
  const files = await regularFiles(join(f.world, 'generation-1', 'inputs'));
  assert.equal(generation.stats.files, files.length);
  assert.equal(generation.stats.bytes, files.reduce((sum, [, size]) => sum + size, 0));
  assert.ok(Number.isInteger(generation.stats.elapsedMs) && generation.stats.elapsedMs >= 0);
  assert.ok(Object.isFrozen(snapshot.stats) && Object.isFrozen(generation.stats));
});

test('portable snapshot file copies stay within the fixed concurrency bound and preserve statistics', async t => {
  await withCloneSupport(t, { file: true });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  for (let index = 0; index < 20; index++) await writeFile(join(f.source, `many-${String(index).padStart(2, '0')}.js`), `module.exports = ${index};`);

  let active = 0, peak = 0;
  const realCopyFile = fsp.copyFile;
  t.mock.method(fsp, 'copyFile', async (source, destination) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await delay(25);
      return await realCopyFile(source, destination, fsConstants.COPYFILE_EXCL);
    } finally {
      active--;
    }
  });

  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  const files = await regularFiles(snapshot.baseline);
  assert.equal(peak, 4, 'the portable leaf-copy pool reaches but does not exceed its fixed bound');
  assert.equal(snapshot.stats.files, files.length);
  assert.equal(snapshot.stats.bytes, files.reduce((sum, [, size]) => sum + size, 0));
});

test('statistics keep symbolic links apart from files and count rewritten Firebase files exactly', async t => {
  const { f, options } = await selectionFixture(t, 'firebase-json');
  await symlink(join(f.root, 'shared'), join(f.source, 'node_modules', 'linked'), directoryLink);
  const snapshot = await snapshotInputs({ ...options, services: ['functions', 'firestore'] }, f.world);
  const generation = await prepareGeneration(snapshot, join(f.world, 'generation-1'));
  assert.ok(generation.stats.symlinks >= 1);
  assert.equal(generation.stats.symlinks, snapshot.stats.symlinks);
  const files = await regularFiles(join(f.world, 'generation-1', 'inputs'));
  assert.equal(generation.stats.files, files.length, 'links are not files');
  assert.equal(generation.stats.bytes, files.reduce((sum, [, size]) => sum + size, 0), 'rewritten configuration bytes are included');
});

test('snapshot retains copied symbolic-link paths for later generation relocation', async t => {
  const f = await fixture(t);
  const dependency = join(f.modules, 'dependency');
  await mkdir(dependency);
  await writeFile(join(dependency, 'index.js'), 'module.exports = 1;');
  await mkdir(join(f.source, 'node_modules'));
  await symlink(dependency, join(f.source, 'node_modules', 'dependency'), directoryLink);
  const options = { cwd: f.root, functionsSource: f.source, services: ['functions'], env: { NODE_PATH: '' } };
  const snapshot = await snapshotInputs(options, f.world);
  const linkInBaseline = join(snapshot.config.functions.source, 'node_modules', 'dependency');
  const relativeLink = relative(snapshot.baseline, linkInBaseline);
  assert.deepEqual(snapshot.relocationLinks, [relativeLink]);

  const generation = await prepareGeneration(snapshot, join(f.world, 'generation'));
  const linkInGeneration = join(generation.cwd, relativeLink);
  const target = await realpath(linkInGeneration);
  assert.ok(target.startsWith(generation.cwd), 'dependency link resolves inside this generation');
  assert.equal(await readFile(join(target, 'index.js'), 'utf8'), 'module.exports = 1;');
});

const graphReuseCases = [
  { copy: 'TreeClone', graph: 'DirectCapture', outcome: 'Success' },
  { copy: 'FileCopy', graph: 'DirectCapture', outcome: 'Failure' },
  { copy: 'TreeClone', graph: 'SharedAncestorReuse', outcome: 'Success' },
  { copy: 'FileCopy', graph: 'SharedAncestorReuse', outcome: 'Failure' },
  { copy: 'FileCopy', graph: 'DirectCapture', outcome: 'Success' },
  { copy: 'TreeClone', graph: 'DirectCapture', outcome: 'Failure' },
  { copy: 'FileCopy', graph: 'SharedAncestorReuse', outcome: 'Success' },
];

for (const row of graphReuseCases) {
  test(`PICT graph-reuse case ${JSON.stringify(row)}`, { skip: process.platform === 'win32' && row.copy === 'TreeClone' }, async t => {
    const saved = { ...cloneSupport };
    if (row.copy === 'TreeClone') Object.assign(cloneSupport, { file: false, tree: true, treeCommand: 'cp', treeArguments: (source, destination) => process.platform === 'darwin' ? ['-c', '-R', '-p', source, destination] : ['-R', source, destination] });
    else Object.assign(cloneSupport, { file: false, tree: false });
    t.after(() => Object.assign(cloneSupport, saved));

    const root = await realpath(await mkdtemp(join(tmpdir(), 'fireemu-world-graph-reuse-')));
    const workspace = join(root, 'workspace'), worldRoot = join(root, 'world');
    await mkdir(workspace, { recursive: true });
    await mkdir(worldRoot);
    t.after(() => rm(root, { recursive: true, force: true }));

    const sourceNames = row.graph === 'SharedAncestorReuse' ? ['functions-a', 'functions-b'] : ['functions-a'];
    const sources = sourceNames.map(name => join(workspace, name));
    for (const source of sources) {
      await mkdir(source, { recursive: true });
      await writeFile(join(source, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
      await writeFile(join(source, 'index.cjs'), "module.exports=require('dependency')");
    }

    if (row.graph === 'SharedAncestorReuse') {
      const dependency = join(workspace, 'node_modules', 'dependency');
      await mkdir(dependency, { recursive: true });
      await writeFile(join(dependency, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
      await writeFile(join(dependency, 'index.cjs'), "module.exports='creation dependency'");
    } else {
      const dependency = join(root, 'shared', 'dependency');
      await mkdir(dependency, { recursive: true });
      await writeFile(join(dependency, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
      await writeFile(join(dependency, 'index.cjs'), "module.exports='creation dependency'");
      await mkdir(join(sources[0], 'node_modules'));
      await symlink(dependency, join(sources[0], 'node_modules', 'dependency'), directoryLink);
    }

    const config = { functions: sources.map((source, index) => ({ source: relative(root, source), codebase: String.fromCharCode(97 + index) })) };
    const snapshot = await snapshotInputs({ cwd: root, config, services: ['functions'], env: { NODE_PATH: '' } }, worldRoot);
    const baselineFirebase = JSON.parse(await readFile(snapshot.config.firebaseJson, 'utf8'));
    const baselineSources = baselineFirebase.functions.map(codebase => codebase.source);
    const relocationLink = row.graph === 'SharedAncestorReuse'
      ? join(dirname(baselineSources[1]), 'node_modules')
      : join(baselineSources[0], 'node_modules', 'dependency');
    const relocationEntry = relative(snapshot.baseline, relocationLink);

    const absoluteTarget = await realpath(relocationLink);
    await unlink(relocationLink);
    await symlink(absoluteTarget, relocationLink, directoryLink);

    if (row.outcome === 'Failure') {
      assert.ok(snapshot.relocationLinks.includes(relocationEntry), 'every copied or graph-reused junction is in the relocation manifest');
      snapshot.relocationLinks = [...snapshot.relocationLinks, 'missing-relocation-link'];
      const generationDirectory = join(worldRoot, 'failed-generation');
      await assert.rejects(prepareGeneration(snapshot, generationDirectory), { code: 'ENOENT' });
      await assert.rejects(stat(generationDirectory), { code: 'ENOENT' });
      return;
    }

    const generation = await prepareGeneration(snapshot, join(worldRoot, 'generation-1'));
    const generatedFirebase = JSON.parse(await readFile(JSON.parse(await readFile(generation.configPath, 'utf8')).firebaseJson, 'utf8'));
    const generatedSources = generatedFirebase.functions.map(codebase => codebase.source);
    const generatedLink = row.graph === 'SharedAncestorReuse'
      ? join(dirname(generatedSources[1]), 'node_modules')
      : join(generatedSources[0], 'node_modules', 'dependency');
    const generatedTarget = await realpath(generatedLink);
    assert.ok(generatedTarget.startsWith(generation.cwd), 'junction target belongs to this generation');
    assert.ok(snapshot.relocationLinks.includes(relocationEntry), 'every copied or graph-reused junction is in the relocation manifest');
    for (const source of generatedSources) assert.equal(createRequire(join(source, 'package.json'))('./index.cjs'), 'creation dependency');

    const generatedDependency = row.graph === 'SharedAncestorReuse'
      ? join(generatedTarget, 'dependency', 'index.cjs')
      : join(generatedTarget, 'index.cjs');
    await writeFile(generatedDependency, "module.exports='generation mutation'");
    assert.equal(await readFile(join(absoluteTarget, row.graph === 'SharedAncestorReuse' ? 'dependency/index.cjs' : 'index.cjs'), 'utf8'), "module.exports='creation dependency'");
    const reset = await prepareGeneration(snapshot, join(worldRoot, 'generation-2'));
    const resetFirebase = JSON.parse(await readFile(JSON.parse(await readFile(reset.configPath, 'utf8')).firebaseJson, 'utf8'));
    for (const codebase of resetFirebase.functions) {
      assert.ok((await realpath(join(row.graph === 'SharedAncestorReuse' ? dirname(codebase.source) : codebase.source, 'node_modules', 'dependency'))).startsWith(reset.cwd), 'reset dependency belongs to the reset generation');
      assert.equal(createRequire(join(codebase.source, 'package.json'))('./index.cjs'), 'creation dependency');
    }
  });
}

const generatedRelocationCases = [
  { copy: 'TreeClone', link: 'Relative', owner: 'InternalBaseline', outcome: 'Success' },
  { copy: 'TreeClone', link: 'AbsoluteJunction', owner: 'CapturedDependency', outcome: 'Success' },
  { copy: 'FileCopy', link: 'Relative', owner: 'InternalBaseline', outcome: 'CancelledOrFailed' },
  { copy: 'FileCopy', link: 'AbsoluteJunction', owner: 'CapturedDependency', outcome: 'CancelledOrFailed' },
  { copy: 'FileCopy', link: 'AbsoluteJunction', owner: 'InternalBaseline', outcome: 'Success' },
  { copy: 'TreeClone', link: 'AbsoluteJunction', owner: 'CapturedDependency', outcome: 'CancelledOrFailed' },
];

for (const row of generatedRelocationCases) {
  test(`PICT relocation case ${JSON.stringify(row)}`, { skip: process.platform === 'win32' && (row.copy === 'TreeClone' || row.link === 'Relative') }, async t => {
    const saved = { ...cloneSupport };
    if (row.copy === 'TreeClone') Object.assign(cloneSupport, { file: false, tree: true, treeCommand: 'cp', treeArguments: (source, destination) => process.platform === 'darwin' ? ['-c', '-R', '-p', source, destination] : ['-R', source, destination] });
    else Object.assign(cloneSupport, { file: false, tree: false });
    t.after(() => Object.assign(cloneSupport, saved));

    const f = await fixture(t);
    const target = row.owner === 'InternalBaseline' ? join(f.source, 'target') : join(f.modules, 'dependency');
    const link = join(f.source, 'node_modules', 'dependency');
    await mkdir(target);
    await writeFile(join(target, 'index.js'), 'module.exports = 7;');
    await mkdir(join(f.source, 'node_modules'));
    await symlink(row.link === 'Relative' ? relative(join(f.source, 'node_modules'), target) : target, link, directoryLink);
    const snapshot = await snapshotInputs({ cwd: f.root, functionsSource: f.source, services: ['functions'], env: { NODE_PATH: '' } }, f.world);
    const generationDirectory = join(f.world, 'generation');
    if (row.link === 'AbsoluteJunction') {
      const baselineLink = join(snapshot.config.functions.source, 'node_modules', 'dependency');
      const baselineTarget = await realpath(baselineLink);
      await unlink(baselineLink);
      await symlink(baselineTarget, baselineLink, directoryLink);
    }

    if (row.outcome === 'CancelledOrFailed') {
      snapshot.relocationLinks = [...snapshot.relocationLinks, 'missing-link'];
      await assert.rejects(prepareGeneration(snapshot, generationDirectory), { code: 'ENOENT' });
      await assert.rejects(stat(generationDirectory), { code: 'ENOENT' });
      snapshot.relocationLinks.pop();

      const baselineLink = join(snapshot.config.functions.source, 'node_modules', 'dependency');
      const baselineLinkValue = await readlink(baselineLink);
      const baselineTarget = await realpath(baselineLink);
      const baselineConfig = await readFile(join(snapshot.baseline, 'fireemu.json'), 'utf8');
      const copiedLink = join(generationDirectory, 'inputs', relative(snapshot.baseline, baselineLink));
      const controller = new AbortController();
      const reason = Error('cancel during generation link relocation');
      const originalReadlink = readlink;
      t.mock.method(fsp, 'readlink', async (...args) => {
        const value = await originalReadlink(...args);
        if (args[0] === copiedLink) controller.abort(reason);
        return value;
      });
      syncBuiltinESMExports();
      t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

      await assert.rejects(prepareGeneration(snapshot, generationDirectory, controller.signal), error => error === reason);
      assert.equal(controller.signal.reason, reason, 'cancellation happens during generation link relocation');
      await assert.rejects(stat(generationDirectory), { code: 'ENOENT' });
      assert.equal(await readlink(baselineLink), baselineLinkValue);
      assert.equal(await realpath(baselineLink), baselineTarget);
      assert.equal(await readFile(join(baselineTarget, 'index.js'), 'utf8'), 'module.exports = 7;');
      assert.equal(await readFile(join(snapshot.baseline, 'fireemu.json'), 'utf8'), baselineConfig);
      return;
    }

    const generation = await prepareGeneration(snapshot, generationDirectory);
    const copiedLink = join(generation.cwd, relative(snapshot.baseline, join(snapshot.config.functions.source, 'node_modules', 'dependency')));
    const copiedTarget = await realpath(copiedLink);
    assert.ok(copiedTarget.startsWith(generation.cwd), 'link target belongs to the generated world');
    assert.equal(await readFile(join(copiedTarget, 'index.js'), 'utf8'), 'module.exports = 7;');
    await writeFile(join(copiedTarget, 'index.js'), 'generation mutation');
    assert.equal(await readFile(join(snapshot.config.functions.source, row.owner === 'InternalBaseline' ? 'target' : 'node_modules/dependency', 'index.js'), 'utf8'), 'module.exports = 7;');
  });
}

async function withCloneSupport(t, overrides) {
  const saved = { ...cloneSupport };
  Object.assign(cloneSupport, { file: false, tree: false }, overrides);
  t.after(() => Object.assign(cloneSupport, saved));
}

test('copy-on-write file clones are requested when enabled and generations stay independent', async t => {
  await withCloneSupport(t, { file: true });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  const calls = [];
  const real = fsp.copyFile;
  t.mock.method(fsp, 'copyFile', async (source, destination, mode) => { calls.push(mode); return real(source, destination, fsConstants.COPYFILE_EXCL); });
  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(mode => mode === (fsConstants.COPYFILE_FICLONE_FORCE | fsConstants.COPYFILE_EXCL)), 'only forced exclusive clones are requested');
  const first = await prepareGeneration(snapshot, join(f.world, 'generation-1'));
  const second = await prepareGeneration(snapshot, join(f.world, 'generation-2'));
  assert.equal(first.stats.method, 'clone');
  const config = JSON.parse(await readFile(first.configPath, 'utf8'));
  await writeFile(join(config.functions.source, 'index.js'), 'generation edit');
  assert.equal(await readFile(join(snapshot.baseline, 'functions-0', 'index.js'), 'utf8'), 'exports.main = 1;', 'the baseline keeps its bytes');
  const secondConfig = JSON.parse(await readFile(second.configPath, 'utf8'));
  assert.equal(await readFile(join(secondConfig.functions.source, 'index.js'), 'utf8'), 'exports.main = 1;');
  assert.equal(await readFile(join(f.source, 'index.js'), 'utf8'), 'exports.main = 1;', 'the caller keeps its bytes');
});

test('file clones are not attempted when the platform has none', async t => {
  await withCloneSupport(t, { file: false });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  let attempts = 0;
  t.mock.method(fsp, 'copyFile', async () => { attempts++; });
  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  assert.equal(attempts, 0);
  assert.equal(snapshot.stats.method, 'copy');
});

test('a file system that refuses clones falls back to a real copy, once per source device', async t => {
  await withCloneSupport(t, { file: true });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  for (let index = 0; index < 4; index++) await writeFile(join(f.source, `extra-${index}.js`), `extra ${index}`);
  let attempts = 0;
  t.mock.method(fsp, 'copyFile', async () => { attempts++; throw Object.assign(Error('operation not supported'), { code: 'ENOTSUP' }); });
  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  assert.equal(snapshot.stats.files, 7);
  assert.equal(snapshot.stats.method, 'copy');
  assert.equal(attempts, 1, 'the refusal disables clones for the rest of that device');
  const config = JSON.parse(await readFile(join(snapshot.baseline, 'fireemu.json'), 'utf8'));
  assert.equal(await readFile(join(config.functions.source, 'extra-3.js'), 'utf8'), 'extra 3');
  assert.equal(await readFile(join(config.functions.source, 'node_modules', 'dependency', 'index.js'), 'utf8'), 'module.exports = 2;');
});

test('a snapshot that clones some files and copies the rest reports a mixed method', async t => {
  await withCloneSupport(t, { file: true });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  const real = fsp.copyFile;
  let calls = 0;
  t.mock.method(fsp, 'copyFile', async (source, destination) => {
    if (++calls === 1) return real(source, destination, fsConstants.COPYFILE_EXCL);
    throw Object.assign(Error('operation not supported'), { code: 'ENOTSUP' });
  });
  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  assert.equal(snapshot.stats.method, 'mixed');
  assert.equal(calls, 2, 'one clone, then one refusal that disables clones');
  const config = JSON.parse(await readFile(join(snapshot.baseline, 'fireemu.json'), 'utf8'));
  assert.equal(await readFile(join(config.functions.source, 'index.js'), 'utf8'), 'exports.main = 1;');
});

test('a clone that leaves a partial file does not break the fallback copy', async t => {
  await withCloneSupport(t, { file: true });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  t.mock.method(fsp, 'copyFile', async (source, destination) => { await writeFile(destination, 'partial'); throw Object.assign(Error('cross-device'), { code: 'EXDEV' }); });
  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  const config = JSON.parse(await readFile(join(snapshot.baseline, 'fireemu.json'), 'utf8'));
  assert.equal(await readFile(join(config.functions.source, 'index.js'), 'utf8'), 'exports.main = 1;');
});

test('a clone cancelled by the caller stops the snapshot instead of falling back', async t => {
  await withCloneSupport(t, { file: true });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  const controller = new AbortController();
  t.mock.method(fsp, 'copyFile', async () => { controller.abort(Error('stop here')); throw Object.assign(Error('aborted'), { code: 'ECANCELED' }); });
  await assert.rejects(snapshotInputs({ ...options, services: ['functions'] }, f.world, controller.signal), /stop here/);
});

test('a source that cannot be read still fails when clones fall back to the real copy', async t => {
  if (process.getuid?.() === 0 || process.platform === 'win32') return t.skip('permissions are not enforced');
  await withCloneSupport(t, { file: true });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  t.mock.method(fsp, 'copyFile', async () => { throw Object.assign(Error('operation not supported'), { code: 'ENOTSUP' }); });
  await chmod(join(f.source, 'index.js'), 0o000);
  t.after(() => chmod(join(f.source, 'index.js'), 0o644).catch(() => {}));
  await assert.rejects(snapshotInputs({ ...options, services: ['functions'] }, f.world), /EACCES|permission denied/i);
});

test('the macOS tree clone preserves modes', () => {
  assert.deepEqual(cloneSupport.treeArguments('a', 'b'), ['-c', '-R', '-p', 'a', 'b']);
});

for (const platformClone of [false, true]) {
  test(`tree cloning preserves file and directory modes: ${platformClone ? 'macOS' : 'portable'}`, { skip: process.platform === 'win32' || (platformClone && process.platform !== 'darwin') }, async t => {
    let baseline, inputs;
    t.after(async () => {
      for (const root of [baseline, inputs]) if (root) await chmod(join(root, 'readonly'), 0o700).catch(() => {});
    });
    const f = await fixture(t);
    if (!platformClone) await withCloneSupport(t, { tree: true, treeCommand: 'cp', treeArguments: (source, destination) => ['-R', '-p', source, destination] });
    baseline = join(f.root, 'baseline');
    inputs = join(f.world, 'generation', 'inputs');
    await mkdir(baseline);
    const modes = { executable: 0o755, group: 0o640, file: 0o444, directory: 0o750, 'directory/inside': 0o640, readonly: 0o555, 'readonly/inside': 0o444 };
    for (const name of ['directory', 'readonly']) await mkdir(join(baseline, name));
    for (const name of ['executable', 'group', 'file', 'directory/inside', 'readonly/inside']) await writeFile(join(baseline, name), 'x');
    for (const [name, mode] of Object.entries(modes)) await chmod(join(baseline, name), mode);
    const previousUmask = process.umask(0o077);
    t.after(() => process.umask(previousUmask));
    try {
      const generation = await prepareGeneration({ baseline, config: { daemon: {} }, nodePaths: [], totals: { files: 5, directories: 3, symlinks: 0, bytes: 5 } }, join(f.world, 'generation'));
      assert.equal(generation.stats.method, 'clone');
      for (const name of Object.keys(modes)) assert.equal((await stat(join(inputs, name))).mode & 0o777, (await stat(join(baseline, name))).mode & 0o777, name);
    } finally {
      process.umask(previousUmask);
    }
  });
}

// The tree clone is the platform copy tool run over the whole baseline; plain `cp -R` stands in
// for `cp -c -R` so the path runs on every platform.
const plainCopy = { tree: true, treeCommand: 'cp', treeArguments: (source, destination) => ['-R', source, destination] };

test('a generation is cloned from the baseline as a tree with exact statistics, and stays independent', { skip: process.platform === 'win32' }, async t => {
  await withCloneSupport(t, plainCopy);
  const { f, options } = await selectionFixture(t, 'firebase-json');
  await symlink(join(f.root, 'shared'), join(f.source, 'node_modules', 'linked'), directoryLink);
  const snapshot = await snapshotInputs({ ...options, services: ['functions', 'firestore'] }, f.world);
  const first = await prepareGeneration(snapshot, join(f.world, 'generation-1'));
  assert.equal(first.stats.method, 'clone');
  const files = await regularFiles(join(f.world, 'generation-1', 'inputs'));
  assert.equal(first.stats.files, files.length);
  assert.equal(first.stats.bytes, files.reduce((sum, [, size]) => sum + size, 0));
  const sourceOf = async generation => JSON.parse(await readFile(JSON.parse(await readFile(generation.configPath, 'utf8')).firebaseJson, 'utf8')).functions[0].source;
  const source = await sourceOf(first);
  assert.ok(source.startsWith(join(f.world, 'generation-1')), 'paths point into the generation');
  assert.equal(await readFile(join(source, 'node_modules', 'dependency', 'index.js'), 'utf8'), 'module.exports = 2;');
  await writeFile(join(source, 'index.js'), 'generation edit');
  const second = await prepareGeneration(snapshot, join(f.world, 'generation-2'));
  assert.equal(await readFile(join(await sourceOf(second), 'index.js'), 'utf8'), 'exports.main = 1;');
});

test('a failing tree clone leaves nothing behind and the generation is copied file by file', { skip: process.platform === 'win32' }, async t => {
  await withCloneSupport(t, { tree: true, treeCommand: 'false', treeArguments: () => [] });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  const generation = await prepareGeneration(snapshot, join(f.world, 'generation-1'));
  assert.equal(generation.stats.method, 'copy');
  const files = await regularFiles(join(f.world, 'generation-1', 'inputs'));
  assert.equal(generation.stats.files, files.length);
  const config = JSON.parse(await readFile(generation.configPath, 'utf8'));
  assert.equal(await readFile(join(config.functions.source, 'index.js'), 'utf8'), 'exports.main = 1;');
});

test('a tree clone that leaves a partial directory is cleaned before the fallback', { skip: process.platform === 'win32' }, async t => {
  await withCloneSupport(t, { tree: true, treeCommand: process.execPath, treeArguments: (source, destination) => ['-e', "require('fs').mkdirSync(process.argv[1]+'/partial',{recursive:true});process.exit(1)", destination] });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  const generation = await prepareGeneration(snapshot, join(f.world, 'generation-1'));
  assert.equal(generation.stats.method, 'copy');
  assert.deepEqual((await readdir(join(f.world, 'generation-1', 'inputs'))).sort(), ['fireemu.json', 'functions-0']);
});

test('cancelling a tree clone stops the tool and removes the generation directory', { skip: process.platform === 'win32', timeout: 20_000 }, async t => {
  await withCloneSupport(t, { tree: true, treeCommand: process.execPath, treeArguments: () => ['-e', 'setTimeout(() => {}, 10000)'] });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  const controller = new AbortController();
  const pending = prepareGeneration(snapshot, join(f.world, 'generation-1'), controller.signal);
  await delay(100);
  controller.abort(Error('cancelled while cloning'));
  await assert.rejects(pending, /cancelled while cloning/);
  await assert.rejects(stat(join(f.world, 'generation-1')), { code: 'ENOENT' });
});

test('snapshot statistics count only the selected Firebase file and its inputs', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'one.json'), JSON.stringify({ firestore: { rules: 'one.rules' } }));
  await writeFile(join(f.root, 'two.json'), JSON.stringify({ firestore: { rules: 'two.rules' } }));
  await writeFile(join(f.root, 'one.rules'), 'one');
  await writeFile(join(f.root, 'two.rules'), 'twelve bytes');
  const snapshot = await snapshotInputs({ cwd: f.root, services: ['firestore'], config: { schemaVersion: 1, firebaseJson: 'one.json' }, firebaseJson: 'two.json' }, f.world);
  const files = await regularFiles(snapshot.baseline);
  assert.equal(snapshot.stats.files, files.length);
  assert.equal(snapshot.stats.bytes, files.reduce((sum, [, size]) => sum + size, 0));
  assert.equal(files.length, 3, 'firebase.json, the selected Rules and fireemu.json');
  const firebase = JSON.parse(await readFile(snapshot.config.firebaseJson, 'utf8'));
  assert.equal(await readFile(firebase.firestore.rules, 'utf8'), 'twelve bytes');
});

for (const tree of [false, true]) {
  test(`a generation counts configuration the baseline did not hold (tree clone ${tree})`, { skip: tree && process.platform === 'win32' }, async t => {
    await withCloneSupport(t, tree ? plainCopy : {});
    const f = await fixture(t);
    const baseline = join(f.root, 'baseline');
    await mkdir(baseline);
    await writeFile(join(baseline, 'data.txt'), 'twelve bytes');
    const generation = await prepareGeneration({ baseline, config: { daemon: {} }, nodePaths: [], totals: { files: 1, directories: 1, symlinks: 0, bytes: 12 } }, join(f.root, 'generation'));
    const files = await regularFiles(join(f.root, 'generation', 'inputs'));
    assert.deepEqual(files.map(([path]) => path.split('/').pop()).sort(), ['data.txt', 'fireemu.json']);
    assert.equal(generation.stats.files, 2, 'the newly written configuration is a file of the generation');
    assert.equal(generation.stats.bytes, files.reduce((sum, [, size]) => sum + size, 0));
  });
}

test('the elapsed time covers the copy', async t => {
  await withCloneSupport(t, { file: true });
  const { f, options } = await selectionFixture(t, 'functionsSource');
  const real = fsp.copyFile;
  t.mock.method(fsp, 'copyFile', async (source, destination) => { await delay(60); return real(source, destination, fsConstants.COPYFILE_EXCL); });
  const snapshot = await snapshotInputs({ ...options, services: ['functions'] }, f.world);
  assert.ok(snapshot.stats.elapsedMs >= 50, `snapshot includes the 60 ms leaves (${snapshot.stats.elapsedMs} ms)`);
  const generation = await prepareGeneration(snapshot, join(f.world, 'generation-1'));
  assert.ok(generation.stats.elapsedMs >= 50, `generation includes the 60 ms leaves (${generation.stats.elapsedMs} ms)`);
});

test('unselected RTDB does not open its Rules file', async t => {
  const f = await fixture(t);
  const settings = { cwd: f.root, config: { database: { rules: 'missing.rules.json' } } };
  const snapshot = await snapshotInputs(settings, f.world);
  const firebase = JSON.parse(await readFile(snapshot.config.firebaseJson, 'utf8'));
  assert.equal(firebase.database.rules, 'missing.rules.json');
});

test('explicit Firebase configuration wins before the overridden Rules and Hosting inputs are read', async t => {
  const f = await fixture(t);
  const overridden = { database: { rules: 'missing.rules.json' }, hosting: { public: 'firebase.json' } };
  await writeFile(join(f.root, 'ignored.json'), JSON.stringify(overridden));
  await writeFile(join(f.root, 'firebase.json'), JSON.stringify({ database: {} }));
  for (const [index, config] of [overridden, { schemaVersion: 1, firebaseJson: 'ignored.json' }].entries()) {
    const root = join(f.world, String(index));
    await mkdir(root);
    const snapshot = await snapshotInputs({
      cwd: f.root, config, firebaseJson: 'firebase.json', services: ['database', 'hosting'],
    }, root);
    assert.deepEqual(JSON.parse(await readFile(snapshot.config.firebaseJson, 'utf8')), { database: {} });
  }
});

test('Firebase inputs snapshot RTDB Rules and selected Hosting across configuration forms', async t => {
  for (const form of ['inline', 'file', 'option', 'wrapper']) {
    for (const database of ['object', 'array']) {
      for (const hosting of ['existing', 'missing', 'unselected']) {
        await t.test(`${form}/${database}/${hosting}`, async subtest => {
          const f = await fixture(subtest);
          const base = form === 'inline' ? f.root : join(f.root, 'project');
          await mkdir(join(base, 'rules'), { recursive: true });
          await writeFile(join(base, 'rules', 'firestore.rules'), 'firestore rules');
          await writeFile(join(base, 'rules', 'database.rules.json'), '{"rules":{".read":true}}');
          await writeFile(join(base, 'rules', 'tenant.rules.json'), '{"rules":{".read":false}}');
          const rc = { targets: { 'demo-world': { database: { tenant: ['demo-world-tenant'] } } } };
          await writeFile(join(base, '.firebaserc'), JSON.stringify(rc));
          if (hosting === 'existing') {
            await mkdir(join(base, 'public'));
            await writeFile(join(base, 'public', 'index.html'), 'snapshot marker');
          }
          const rules = { rules: 'rules/database.rules.json' };
          const firebase = {
            firestore: { rules: 'rules/firestore.rules' },
            database: database === 'object' ? rules : [
              { instance: 'demo-world-default-rtdb', ...rules },
              { target: 'tenant', rules: 'rules/tenant.rules.json' },
            ],
            hosting: { public: 'public' },
            emulators: { hosting: { host: 'localhost', port: 5019 } },
          };
          const settings = { cwd: f.root, services: hosting === 'unselected' ? ['database'] : ['database', 'hosting'] };
          if (form === 'inline') settings.config = firebase;
          else {
            await writeFile(join(base, 'firebase.json'), JSON.stringify(firebase));
            if (form === 'file') settings.config = 'project/firebase.json';
            if (form === 'option') settings.firebaseJson = 'project/firebase.json';
            if (form === 'wrapper') {
              await writeFile(join(base, 'fireemu.json'), JSON.stringify({ schemaVersion: 1, firebaseJson: 'firebase.json' }));
              settings.config = 'project/fireemu.json';
            }
          }
          const snapshot = await snapshotInputs(settings, f.world);
          await writeFile(join(base, 'rules', 'database.rules.json'), 'edited after capture');
          const generation = await prepareGeneration(snapshot, join(f.world, 'generation'));
          const config = JSON.parse(await readFile(generation.configPath, 'utf8'));
          const captured = JSON.parse(await readFile(config.firebaseJson, 'utf8'));
          const inside = path => assert.ok(!relative(generation.cwd, path).startsWith('..') && isAbsolute(path), path);
          inside(captured.firestore.rules);
          assert.equal(await readFile(captured.firestore.rules, 'utf8'), 'firestore rules');
          const entries = Array.isArray(captured.database) ? captured.database : [captured.database];
          inside(entries[0].rules);
          assert.equal(await readFile(entries[0].rules, 'utf8'), '{"rules":{".read":true}}');
          if (database === 'array') {
            assert.equal(entries[0].instance, 'demo-world-default-rtdb');
            assert.equal(entries[1].target, 'tenant');
            inside(entries[1].rules);
            assert.equal(await readFile(entries[1].rules, 'utf8'), '{"rules":{".read":false}}');
          }
          assert.deepEqual(JSON.parse(await readFile(join(generation.cwd, '.firebaserc'), 'utf8')), rc);
          if (hosting === 'unselected') assert.equal(captured.hosting.public, 'public');
          else if (hosting === 'missing') {
            inside(captured.hosting.public);
            await assert.rejects(stat(captured.hosting.public), { code: 'ENOENT' });
          } else {
            inside(captured.hosting.public);
            assert.equal(await readFile(join(captured.hosting.public, 'index.html'), 'utf8'), 'snapshot marker');
          }
          if (hosting !== 'unselected') {
            assert.equal(config.daemon.hostingPort, 0);
            assert.deepEqual(captured.emulators.hosting, { host: '127.0.0.1', port: 0 });
          }
        });
      }
    }
  }
});
