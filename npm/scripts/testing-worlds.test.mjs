import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile, rm, stat, mkdir, chmod, open, symlink } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { createTestWorld, withTestWorld } from '../fireemu/testing.mjs';
import { cloneSupport } from '../fireemu/testing-snapshot.mjs';

const binary = process.env.FIREEMU_TEST_BINARY;
const runFile = promisify(execFile);
const native = { skip: !binary, timeout: 30_000 };
// Tests that observe a generation copy while it is in progress need the file-by-file copy, which can be cancelled
// mid-file; a tree clone (macOS) finishes at once.
function copyFileByFile(t) {
  const saved = { ...cloneSupport };
  Object.assign(cloneSupport, { file: false, tree: false });
  t.after(() => Object.assign(cloneSupport, saved));
}
const options = { binaryPath: binary, env:{...process.env,NODE_PATH:''}, projectId: 'demo-test-worlds', clockStart: '2026-01-31T23:59:00Z', services: ['auth','firestore'], config: { schemaVersion:1, firestore:{edition:'standard'} } };

test('invalid calendar clock arguments reject promises and leave the world clock unchanged', native, async () => {
  const world = await createTestWorld(options);
  try {
    await assert.rejects(world.clock.advance({}), /seconds, millis or calendar units/);
    await assert.rejects(world.clock.advance({ days: 1, hours: -1 }), /same sign/);
    await assert.rejects(world.clock.advanceAndSettle(1000, { allowBackwards: false }), /require.*ISO 8601/);
    await assert.rejects(world.clock.to('startOfMonth', { duration: {} }), /at least one unit/);
    await assert.rejects(world.clock.advance('P'), /duration/);
    assert.equal((await world.clock.get()).clock.clock, options.clockStart);
  } finally {
    await world.dispose();
  }
});

function signedReadUrl({ privateKey, host, bucket, object }) {
  const method = 'GET';
  const date = '20260131T235900Z';
  const expires = '3600';
  const email = 'signed-url-test@demo-test-worlds.iam.gserviceaccount.com';
  const scope = `${date.slice(0, 8)}/auto/storage/goog4_request`;
  const path = `/${bucket}/${encodeURIComponent(object)}`;
  const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const parameters = [
    ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
    ['X-Goog-Credential', `${email}/${scope}`],
    ['X-Goog-Date', date],
    ['X-Goog-Expires', expires],
    ['X-Goog-SignedHeaders', 'host'],
  ].sort(([left], [right]) => left.localeCompare(right));
  const query = parameters.map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
  const canonical = `${method}\n${path}\n${query}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const toSign = `GOOG4-RSA-SHA256\n${date}\n${scope}\n${createHash('sha256').update(canonical).digest('hex')}`;
  const signature = createSign('RSA-SHA256').update(toSign).sign(privateKey, 'hex');
  return `${path}?${query}&X-Goog-Signature=${signature}`;
}

test('Storage signed URL keys are snapshotted for daemon startup and world reset', native, async t => {
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-signed-key-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keyDirectory = join(root, 'keys');
  await mkdir(keyDirectory);
  const publicKeyPath = join(keyDirectory, 'public.pem');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const replacementKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).publicKey;
  await writeFile(publicKeyPath, publicKey);
  const world = await createTestWorld({
    ...options,
    cwd: root,
    services: ['storage'],
    config: { schemaVersion: 1, profile: 'strict', storage: { signedUrlKeys: ['keys/public.pem'] } },
  });
  try {
    const bucket = `${world.projectId}.appspot.com`;
    const object = 'snapshot-key.txt';
    const uploadObject = async () => {
      const upload = await fetch(`${world.endpoints.storage.url}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${object}`, {
        method: 'POST',
        headers: { authorization: 'Bearer owner', 'content-type': 'text/plain' },
        body: 'creation bytes',
      });
      assert.ok(upload.ok, `upload returned ${upload.status}: ${await upload.text()}`);
    };
    const verifySignedRead = async label => {
      const host = new URL(world.endpoints.storage.url).host;
      const signedUrl = signedReadUrl({ privateKey, host, bucket, object });
      const response = await fetch(new URL(signedUrl, world.endpoints.storage.url));
      assert.equal(response.status, 200, `signed read ${label} returned ${response.status}`);
      assert.equal(await response.text(), 'creation bytes');
    };
    await uploadObject();
    await verifySignedRead('before reset');

    await writeFile(publicKeyPath, replacementKey);
    await world.reset();
    await uploadObject();
    await verifySignedRead('after editing the source key and resetting');

    await rm(publicKeyPath);
    await world.reset();
    await uploadObject();
    await verifySignedRead('after deleting the source key and resetting');
  } finally {
    await world.dispose();
  }
});

async function uiConfig(world) {
  const response = await fetch(world.uiUrl);
  assert.equal(response.status, 200);
  const match = (await response.text()).match(/window\.__FIREEMU__ = (.*?);<\/script>/s);
  assert.ok(match, 'UI embeds its owning daemon configuration');
  return JSON.parse(match[1]);
}

async function uiRequest(world, config, path, init = {}) {
  return fetch(new URL(path, world.uiUrl), { ...init, headers: { authorization: `Bearer ${config.controlToken}`, ...init.headers } });
}

test('UI options reject non-booleans before starting a world', async () => {
  for (const ui of [null, 0, 1, 'true', {}, []]) {
    await assert.rejects(createTestWorld({ ...options, binaryPath: process.execPath, ui }), /ui must be a boolean/);
  }
});

test('test worlds keep UI disabled by default even with a configured UI port', native, async () => {
  await withTestWorld({ ...options, config: { ...options.config, daemon: { uiPort: 4000 } } }, async world => {
    assert.equal(world.uiUrl, undefined);
    const descriptor = JSON.parse(await readFile(join(world.directory, 'generation-1', 'ready.json'), 'utf8'));
    assert.equal(descriptor.uiUrl, null);
  });
});

test('opt-in UI shares only its owning world data and retires with the generation', native, async t => {
  const worlds = [];
  t.after(async () => { await Promise.all(worlds.map(world => world.dispose())); });
  for (let index = 0; index < 2; index++) worlds.push(await createTestWorld({ ...options, services: ['auth', 'firestore', 'storage'], ui: true }));
  const configs = await Promise.all(worlds.map(uiConfig));
  assert.notEqual(worlds[0].uiUrl, worlds[1].uiUrl);
  for (const [index, world] of worlds.entries()) {
    const config = configs[index];
    assert.equal(config.project, world.projectId);
    assert.equal(new URL(world.uiUrl).host, config.uiAddr);
    assert.equal(config.firestoreAddr, world.environment.FIRESTORE_EMULATOR_HOST);
    const docPath = `/v1/projects/${world.projectId}/databases/(default)/documents/isolated/item`;
    const write = await fetch(world.endpoints.firestore.url + docPath, { method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields: { marker: { stringValue: String(index) } } }) });
    assert.equal(write.status, 200);
    const read = await uiRequest(world, config, '/ui/api/firestore' + docPath);
    assert.equal((await read.json()).fields.marker.stringValue, String(index));
    const authPath = `/identitytoolkit.googleapis.com/v1/projects/${world.projectId}/accounts`;
    const account = await fetch(world.endpoints.auth.url + authPath, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ email: `world${index}@example.com`, password: 'test-password' }) });
    assert.equal(account.status, 200, await account.clone().text());
    const users = await (await uiRequest(world, config, `/ui/api/auth${authPath}:batchGet?maxResults=10`)).json();
    assert.deepEqual(users.users.map(user => user.email), [`world${index}@example.com`]);
    const bucket = `${world.projectId}.appspot.com`;
    const upload = await fetch(`${world.endpoints.storage.url}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=isolated%2Fitem.txt`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'text/plain' }, body: String(index) });
    assert.equal(upload.status, 200, await upload.clone().text());
    const bytes = await uiRequest(world, config, `/ui/api/storage/download/storage/v1/b/${bucket}/o/isolated%2Fitem.txt?alt=media`);
    assert.equal(bytes.status, 200);
    assert.equal(await bytes.text(), String(index));
    assert.equal((await uiRequest(world, configs[1 - index], '/ui/api/config')).status, 403);
    assert.equal((await fetch(new URL('/ui/api/config', world.uiUrl))).status, 403);
  }
  const retiredUrl = worlds[0].uiUrl;
  await worlds[0].reset();
  const fresh = await uiConfig(worlds[0]);
  const docPath = `/ui/api/firestore/v1/projects/${worlds[0].projectId}/databases/(default)/documents/isolated/item`;
  assert.equal((await uiRequest(worlds[0], fresh, docPath)).status, 404);
  assert.equal((await uiRequest(worlds[1], configs[1], docPath)).status, 200);
  if (retiredUrl !== worlds[0].uiUrl) await assert.rejects(fetch(retiredUrl, { headers: { connection: 'close' }, signal: AbortSignal.timeout(2000) }));
  const disposedUrl = worlds[0].uiUrl;
  await worlds[0].dispose();
  await assert.rejects(fetch(disposedUrl, { headers: { connection: 'close' }, signal: AbortSignal.timeout(2000) }));
  assert.equal((await uiRequest(worlds[1], configs[1], '/ui/api/config')).status, 200);
});

test('startup failure removes private directories and leaves parent environment unchanged', async () => {
  const parent = {...process.env};
  const root = await mkdtemp(join(tmpdir(),'fireemu-world-failure-'));
  try {
    await assert.rejects(createTestWorld({...options,binaryPath:join(root,'missing'),tempRoot:root}), /start|ENOENT/);
    const {readdir} = await import('node:fs/promises');
    assert.deepEqual(await readdir(root),[]);
    assert.deepEqual({...process.env},parent);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('three worlds with one project isolate data, clock and reset generations', native, async (t) => {
  const parent = {...process.env};
  const worlds = await Promise.all([createTestWorld(options),createTestWorld(options),createTestWorld(options)]);
  t.after(async()=>{await Promise.all(worlds.map(w=>w.dispose()));});
  const [a,b,c]=worlds;
  assert.equal(new Set(worlds.map(w=>w.endpoints.control.port)).size,3);
  assert.equal(new Set(worlds.map(w=>w.id)).size,3);
  await Promise.all(worlds.map((world,index)=>world.run(process.execPath,['-e',`fetch('http://'+process.env.FIRESTORE_EMULATOR_HOST+'/v1/projects/'+process.env.GCLOUD_PROJECT+'/databases/(default)/documents/isolated/item',{method:'PATCH',headers:{'content-type':'application/json',authorization:'Bearer owner'},body:JSON.stringify({fields:{value:{integerValue:'${index}'}}})}).then(r=>{if(!r.ok)throw Error('write '+r.status)})`])));
  const read=async w=>(await (await fetch(`http://${w.endpoints.firestore.host}:${w.endpoints.firestore.port}/v1/projects/demo-test-worlds/databases/(default)/documents/isolated/item`,{headers:{authorization:'Bearer owner'}})).json()).fields?.value?.integerValue;
  assert.deepEqual(await Promise.all(worlds.map(read)),['0','1','2']);
  const before = await b.clock.get();
  const generation = c.generation;
  const oldEndpoint = c.endpoints.control;
  await Promise.all([a.clock.advance({seconds:86400}),c.reset()]);
  assert.deepEqual(await b.clock.get(),before);
  assert.equal(c.generation,generation+1);
  assert.notDeepEqual(c.endpoints.control,oldEndpoint);
  assert.deepEqual(await Promise.all(worlds.map(read)),['0','1',undefined]);
  assert.deepEqual({...process.env},parent);
  const roots=worlds.map(w=>w.directory);
  await Promise.all(worlds.map(w=>w.dispose()));
  await Promise.all(worlds.map(w=>w.dispose()));
  for(const root of roots)await assert.rejects(stat(root),{code:'ENOENT'});
});

test('withTestWorld disposes after callback failure', native, async()=>{
  let directory;
  await assert.rejects(withTestWorld(options,async world=>{directory=world.directory;throw Error('callback failed');}),/callback failed/);
  await assert.rejects(stat(directory),{code:'ENOENT'});
});

test('command options cannot override the owning world SDK routes', native, async()=>{
  await withTestWorld(options,async world=>{
    const result=await world.run(process.execPath,['-e',"console.log(JSON.stringify({host:process.env.FIRESTORE_EMULATOR_HOST,project:process.env.GCLOUD_PROJECT,id:process.env.FIREEMU_TEST_WORLD_ID}))"],{env:{FIRESTORE_EMULATOR_HOST:'wrong.invalid:1',GCLOUD_PROJECT:'wrong-project',FIREEMU_TEST_WORLD_ID:'wrong-world'}});
    assert.deepEqual(JSON.parse(result.stdout),{host:world.environment.FIRESTORE_EMULATOR_HOST,project:world.projectId,id:world.id});
  });
});

test('a successful command joins its child after the command leader exits', native, async()=>{
  await withTestWorld(options,async world=>{
    const result=await world.run(process.execPath,['-e',"const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);process.exit(0)"]);
    const pid=Number(result.stdout.trim());
    assert.ok(Number.isSafeInteger(pid)&&pid>1);
    assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  });
});

test('real Admin SDK children route identical project and user IDs to independent worlds', {skip:!binary||!process.env.FIREEMU_TEST_SDK_MODULES,timeout:30_000}, async(t)=>{
  const settings={...options,env:{...options.env,FIREBASE_CONFIG:JSON.stringify({projectId:'wrong-inherited-project',storageBucket:'wrong-bucket'})}};
  const worlds=await Promise.all([createTestWorld(settings),createTestWorld(settings)]);
  t.after(async()=>{await Promise.all(worlds.map(world=>world.dispose()));});
  await worlds[0].clock.advance({seconds:86400});
  const script=`
    const load=require('node:module').createRequire(require('node:path').join(process.env.SDK_MODULES,'../package.json'));
    const {initializeApp,deleteApp}=load('firebase-admin/app');
    const {getFirestore,FieldValue}=load('firebase-admin/firestore');
    const {getAuth}=load('firebase-admin/auth');
    (async()=>{
      const app=initializeApp(undefined,process.env.FIREEMU_TEST_WORLD_ID);
      if(app.options.projectId!==process.env.GCLOUD_PROJECT)throw Error('SDK app inherited another world configuration');
      const db=getFirestore(app),ref=db.doc('sdk/item');
      await getAuth(app).createUser({uid:'same-sdk-user'});
      await ref.set({marker:process.env.MARKER,at:FieldValue.serverTimestamp()});
      const value=(await ref.get()).data();
      console.log(JSON.stringify({marker:value.marker,at:value.at.toMillis()}));
      await deleteApp(app);
    })().catch(error=>{console.error(error);process.exitCode=1});
  `;
  const replies=await Promise.all(worlds.map((world,index)=>world.run(process.execPath,['-e',script],{env:{SDK_MODULES:process.env.FIREEMU_TEST_SDK_MODULES,MARKER:String(index),FIREBASE_CONFIG:settings.env.FIREBASE_CONFIG}})));
  const values=replies.map(reply=>JSON.parse(reply.stdout.trim()));
  assert.deepEqual(values.map(value=>value.marker),['0','1']);
  assert.equal(values[0].at-values[1].at,86400_000);
});

test('Functions snapshots own dependencies and reset keeps creation bytes', async()=>{
  const {snapshotInputs,prepareGeneration}=await import('../fireemu/testing-snapshot.mjs');
  const {mkdir,symlink}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'fireemu-world-snapshot-'));
  try{
    const source=join(root,'source'),dependency=join(root,'dependency');
    await mkdir(join(source,'node_modules'),{recursive:true});await mkdir(dependency);
    await writeFile(join(source,'index.cjs'),'creation source');
    await writeFile(join(dependency,'index.cjs'),'creation dependency');
    await symlink(dependency,join(source,'node_modules','dependency'),process.platform==='win32'?'junction':'dir');
    const worldRoot=join(root,'world');await mkdir(worldRoot);
    const snapshot=await snapshotInputs({functionsSource:source},worldRoot);
    await writeFile(join(source,'index.cjs'),'caller mutation');
    await writeFile(join(dependency,'index.cjs'),'caller dependency mutation');
    const generation=await prepareGeneration(snapshot,join(worldRoot,'generation'));
    const config=JSON.parse(await readFile(generation.configPath,'utf8'));
    assert.equal(await readFile(join(config.functions.source,'index.cjs'),'utf8'),'creation source');
    assert.equal(await readFile(join(config.functions.source,'node_modules','dependency','index.cjs'),'utf8'),'creation dependency');
    await writeFile(join(config.functions.source,'node_modules','dependency','index.cjs'),'generation mutation');
    const reset=await prepareGeneration(snapshot,join(worldRoot,'reset'));
    const resetConfig=JSON.parse(await readFile(reset.configPath,'utf8'));
    assert.equal(await readFile(join(resetConfig.functions.source,'node_modules','dependency','index.cjs'),'utf8'),'creation dependency');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('snapshot copying preserves executable files and read-only directory modes', async()=>{
  const {snapshotInputs,prepareGeneration,removeSnapshotTree}=await import('../fireemu/testing-snapshot.mjs');
  const {mkdir,chmod}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'fireemu-world-modes-'));
  const source=join(root,'source'),nested=join(source,'readonly');
  await mkdir(nested,{recursive:true});
  const executable=join(nested,'run.cjs');
  await writeFile(executable,'module.exports=true');
  await chmod(executable,0o751);
  await chmod(nested,0o555);
  const worldRoot=join(root,'world');
  await mkdir(worldRoot);
  try{
    const snapshot=await snapshotInputs({functionsSource:source},worldRoot);
    const generation=await prepareGeneration(snapshot,join(worldRoot,'generation'));
    const baselineFile=join(snapshot.config.functions.source,'readonly','run.cjs');
    const generationFile=join(generation.cwd,'functions-0','readonly','run.cjs');
    assert.equal((await stat(baselineFile)).mode&0o777,0o751);
    assert.equal((await stat(join(snapshot.config.functions.source,'readonly'))).mode&0o777,0o555);
    assert.equal((await stat(generationFile)).mode&0o777,0o751);
    assert.equal((await stat(join(generation.cwd,'functions-0','readonly'))).mode&0o777,0o555);
  }finally{await removeSnapshotTree(worldRoot);await chmod(nested,0o700).catch(()=>{});await rm(root,{recursive:true,force:true});}
});

test('world cleanup removes read-only snapshots after generation cancellation and dispose', { ...native, timeout: 90_000 }, async t => {
  copyFileByFile(t);
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-readonly-cleanup-'));
  const source = join(root, 'source'), readonly = join(source, 'readonly');
  await mkdir(readonly, { recursive: true });
  await writeFile(join(source, 'index.js'), 'module.exports = {};');
  const payload = Buffer.alloc(1024, 0x61);
  await writeFile(join(readonly, 'payload.bin'), payload);
  await chmod(readonly, 0o555);
  t.after(async () => { await chmod(readonly, 0o700).catch(() => {}); await rm(root, { recursive: true, force: true }); });

  const controller = new AbortController();
  const tempRoot = join(root, 'worlds');
  await mkdir(tempRoot);
  let recordWrite, releaseWrite;
  const written = new Promise(resolve => { recordWrite = resolve; });
  const released = new Promise(resolve => { releaseWrite = resolve; });
  const originalCreateWriteStream = fs.createWriteStream;
  const writer = t.mock.method(fs, 'createWriteStream', (path, streamOptions) => {
    const [worldName, ...leaf] = relative(tempRoot, path).split(sep);
    if (!worldName.startsWith('fireemu-world-') || leaf.join('/') !== 'generation-1/inputs/functions-0/readonly/payload.bin') {
      return originalCreateWriteStream(path, streamOptions);
    }
    return originalCreateWriteStream(path, {
      ...streamOptions,
      fs: {
        open: fs.open,
        close: fs.close,
        write(fd, buffer, offset, length, position, callback) {
          // Hold the real copy after a short successful write and before the stream can write the remainder.
          fs.write(fd, buffer, offset, Math.min(length, 128), position, (error, bytes, data) => {
            if (error) { callback(error); return; }
            recordWrite({ path, worldName, bytes });
            void released.then(() => callback(null, bytes, data));
          });
        },
      },
    });
  });
  syncBuiltinESMExports();
  const reason = Error('read-only generation deadline elapsed');
  reason.name = 'TimeoutError';
  const pending = createTestWorld({ ...options, services: ['auth', 'firestore', 'functions'], functionsSource: source, tempRoot, signal: controller.signal, snapshotTimeoutMs: 30_000 });
  try {
    const partial = await Promise.race([
      written,
      pending.then(() => assert.fail('world became ready before the generation write was intercepted')),
    ]);
    assert.ok(partial.bytes > 0 && partial.bytes < payload.length);
    assert.equal((await stat(partial.path)).size, partial.bytes);
    assert.equal((await stat(join(tempRoot, partial.worldName, 'baseline', 'functions-0', 'readonly'))).mode & 0o777, 0o555);
    controller.abort(reason);
    releaseWrite();
    await assert.rejects(pending, error => {
      assert.match(error.message, /test world snapshot timed out/);
      assert.equal(error.cause, reason);
      return true;
    });
  } finally {
    controller.abort(reason);
    releaseWrite();
    writer.mock.restore();
    syncBuiltinESMExports();
    await pending.then(world => world.dispose(), () => {});
  }
  assert.deepEqual(await readdir(tempRoot), []);

  const runner = new URL('../../tools/runner-node/index.mjs', import.meta.url).pathname;
  const world = await createTestWorld({ ...options, services: ['auth', 'firestore', 'functions'], functionsSource: source, tempRoot, env: { ...options.env, FIREEMU_RUNNER_NODE: runner } });
  const owned = world.directory;
  assert.equal((await stat(join(owned, 'baseline', 'functions-0', 'readonly'))).mode & 0o777, 0o555);
  await world.reset();
  assert.equal(world.generation, 2);
  await world.dispose();
  await assert.rejects(stat(owned), { code: 'ENOENT' });
  assert.deepEqual(await readdir(tempRoot), []);
});

test('owned cleanup does not follow symlinks into caller-owned directories', async () => {
  const { removeSnapshotTree } = await import('../fireemu/testing-snapshot.mjs');
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-cleanup-link-'));
  const owned = join(root, 'owned'), external = join(root, 'external');
  await mkdir(owned); await mkdir(external);
  await writeFile(join(external, 'caller.txt'), 'caller data');
  await chmod(external, 0o555);
  await (await import('node:fs/promises')).symlink(external, join(owned, 'external-link'), process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await removeSnapshotTree(owned);
    assert.equal((await stat(external)).mode & 0o777, 0o555);
    assert.equal(await readFile(join(external, 'caller.txt'), 'utf8'), 'caller data');
  } finally {
    await chmod(external, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

test('configuration FIFO inputs reject promptly inside a bounded child process', async t => {
  if (process.platform === 'win32') return t.skip('named pipes are not portable to Windows');
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-config-fifo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const moduleUrl = new URL('../fireemu/testing.mjs', import.meta.url).href;
  const script = `
    import { createTestWorld } from ${JSON.stringify(moduleUrl)};
    try {
      const mode = process.argv[1], fifo = process.argv[2], tempRoot = process.argv[3];
      const config = mode === 'config' ? fifo : mode === 'config.firebaseJson' ? { schemaVersion: 1, firebaseJson: fifo } : { schemaVersion: 1 };
      const firebaseJson = mode === 'firebaseJson' ? fifo : undefined;
      await createTestWorld({ binaryPath: process.execPath, config, firebaseJson, tempRoot, snapshotTimeoutMs: 50, env: { NODE_PATH: '' } });
      console.error('unexpected world creation success'); process.exitCode = 2;
    } catch (error) {
      console.log(JSON.stringify({ message: error.message, cause: error.cause?.message }));
    }
  `;
  for (const mode of ['config', 'config.firebaseJson', 'firebaseJson']) {
    const fifo = join(root, `${mode}.json`), tempRoot = join(root, `worlds-${mode}`);
    execFileSync('mkfifo', [fifo]);
    await mkdir(tempRoot);
    const { stdout } = await runFile(process.execPath, ['--input-type=module', '-e', script, mode, fifo, tempRoot], { timeout: 4_000, killSignal: 'SIGKILL', encoding: 'utf8' });
    const result = JSON.parse(stdout.trim());
    assert.match(`${result.message} ${result.cause}`, /regular file|unsupported|Cannot read/);
    assert.deepEqual(await (await import('node:fs/promises')).readdir(tempRoot), []);
  }
});

test('configuration paths that symlink to regular files remain supported', async () => {
  const { snapshotInputs, removeSnapshotTree } = await import('../fireemu/testing-snapshot.mjs');
  const { symlink } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-config-symlink-'));
  const source = join(root, 'firebase-source.json'), link = join(root, 'firebase-link.json');
  await writeFile(source, JSON.stringify({ schemaVersion: 1, firestore: { edition: 'standard' } }));
  await symlink(source, link);
  try {
    const configInput = join(root, 'from-config'); await mkdir(configInput);
    const configSnapshot = await snapshotInputs({ config: link, cwd: root }, configInput);
    assert.equal(configSnapshot.config.schemaVersion, 1);
    const nestedInput = join(root, 'from-nested-option'); await mkdir(nestedInput);
    const nestedSnapshot = await snapshotInputs({ config: { schemaVersion: 1, firebaseJson: link }, cwd: root }, nestedInput);
    assert.ok(nestedSnapshot.config.firebaseJson);
    const optionInput = join(root, 'from-option'); await mkdir(optionInput);
    const optionSnapshot = await snapshotInputs({ firebaseJson: link, cwd: root }, optionInput);
    assert.ok(optionSnapshot.config.firebaseJson);
  } finally {
    await removeSnapshotTree(root);
  }
});

test('reset applies a fresh snapshot budget and removes an aborted generation copy', native, async t => {
  copyFileByFile(t);
  const controller = new AbortController();
  const world = await createTestWorld({ ...options, snapshotTimeoutMs: 30_000, signal: controller.signal });
  t.after(() => world.dispose());
  const { open } = await import('node:fs/promises');
  const input = join(world.directory, 'baseline', 'reset-large.bin'), inputBytes = 512 * 1024 * 1024;
  const handle = await open(input, 'w');
  await handle.truncate(inputBytes);
  await handle.close();

  const pending = world.reset();
  let outcome;
  pending.then(value => { outcome = { value }; }, error => { outcome = { error }; });
  const generationDirectory = join(world.directory, 'generation-2');
  let partialCopyObserved = false;
  const observationDeadline = Date.now() + 20_000;
  while (Date.now() < observationDeadline && !partialCopyObserved) {
    if (outcome?.error) assert.fail(`reset finished before cancellation: ${outcome.error.message}`);
    try {
      const copied = await stat(join(generationDirectory, 'inputs', 'reset-large.bin'));
      partialCopyObserved = copied.size > 0 && copied.size < inputBytes;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!partialCopyObserved) await new Promise(resolve => setTimeout(resolve, 2));
  }
  if (!partialCopyObserved) {
    controller.abort(Error('cancelled because no partial reset copy was observed'));
    await pending;
    assert.fail('expected to observe an active reset generation copy');
  }

  const reason = Error('caller cancelled reset preparation');
  controller.abort(reason);
  await assert.rejects(pending, error => {
    assert.match(error.message, /test world snapshot aborted/);
    assert.equal(error.cause, reason);
    return true;
  });
  await assert.rejects(stat(generationDirectory), { code: 'ENOENT' });
});

test('dispose joins a child command and its inherited-pipe grandchild', native, async()=>{
  const world=await createTestWorld(options);
  const command=world.run(process.execPath,['-e',`require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log('grandchild started');setInterval(()=>{},1000)`]);
  const settled=assert.rejects(command,/retired/);
  await new Promise(resolve=>setTimeout(resolve,100));
  await world.dispose();
  await settled;
});

test('snapshotted pnpm packages retain private sibling dependency resolution', async()=>{
  const {snapshotInputs,prepareGeneration}=await import('../fireemu/testing-snapshot.mjs');
  const {mkdir,symlink}=await import('node:fs/promises');
  const {createRequire}=await import('node:module');
  const root=await mkdtemp(join(tmpdir(),'fireemu-world-pnpm-'));
  try{
    const source=join(root,'source'),modules=join(root,'store','node_modules');
    await mkdir(join(source,'node_modules'),{recursive:true});
    for(const name of ['sdk','sibling']){
      await mkdir(join(modules,name),{recursive:true});
      await writeFile(join(modules,name,'package.json'),JSON.stringify({main:'index.cjs'}));
    }
    await writeFile(join(modules,'sdk','index.cjs'),"module.exports=require('sibling')");
    await writeFile(join(modules,'sibling','index.cjs'),"module.exports='creation dependency'");
    await symlink(join(modules,'sdk'),join(source,'node_modules','sdk'),process.platform==='win32'?'junction':'dir');
    const worldRoot=join(root,'world');await mkdir(worldRoot);
    const snapshot=await snapshotInputs({functionsSource:source},worldRoot);
    await writeFile(join(modules,'sibling','index.cjs'),"module.exports='caller mutation'");
    const prepared=await prepareGeneration(snapshot,join(worldRoot,'generation'));
    const config=JSON.parse(await readFile(prepared.configPath,'utf8'));
    const load=createRequire(join(config.functions.source,'package.json'));
    assert.equal(load('sdk'),'creation dependency');
    await writeFile(load.resolve('sibling',{paths:[load.resolve('sdk')]}),"module.exports='generation mutation'");
    const reset=await prepareGeneration(snapshot,join(worldRoot,'reset'));
    const resetConfig=JSON.parse(await readFile(reset.configPath,'utf8'));
    assert.equal(createRequire(join(resetConfig.functions.source,'package.json'))('sdk'),'creation dependency');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('Functions snapshots retain ancestor node_modules without caller-owned paths', async()=>{
  const {snapshotInputs,prepareGeneration}=await import('../fireemu/testing-snapshot.mjs');
  const {mkdir}=await import('node:fs/promises');
  const {createRequire}=await import('node:module');
  const root=await mkdtemp(join(tmpdir(),'fireemu-world-workspace-'));
  try{
    const source=join(root,'workspace','functions'),dependency=join(root,'node_modules','dependency');
    await mkdir(source,{recursive:true});await mkdir(dependency,{recursive:true});
    await writeFile(join(source,'index.cjs'),"module.exports=require('dependency')");
    await writeFile(join(dependency,'package.json'),JSON.stringify({main:'index.cjs'}));
    await writeFile(join(dependency,'index.cjs'),"module.exports='creation dependency'");
    const worldRoot=join(root,'world');await mkdir(worldRoot);
    const snapshot=await snapshotInputs({functionsSource:source},worldRoot);
    await writeFile(join(dependency,'index.cjs'),"module.exports='caller mutation'");
    const prepared=await prepareGeneration(snapshot,join(worldRoot,'generation'));
    const config=JSON.parse(await readFile(prepared.configPath,'utf8'));
    assert.equal(createRequire(join(config.functions.source,'package.json'))('./index.cjs'),'creation dependency');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('NODE_PATH dependencies are private and reset retains their creation bytes', async()=>{
  const {snapshotInputs,prepareGeneration}=await import('../fireemu/testing-snapshot.mjs');
  const {mkdir}=await import('node:fs/promises');
  const {promisify}=await import('node:util');
  const exec=promisify((await import('node:child_process')).execFile);
  const root=await mkdtemp(join(tmpdir(),'fireemu-world-node-path-'));
  try{
    const source=join(root,'source'),modules=join(root,'global-modules'),dependency=join(modules,'path-only');
    await mkdir(source);await mkdir(dependency,{recursive:true});
    await writeFile(join(source,'index.cjs'),"module.exports=require('path-only')");
    await writeFile(join(dependency,'package.json'),JSON.stringify({main:'index.cjs'}));
    await writeFile(join(dependency,'index.cjs'),"module.exports='creation dependency'");
    const worldRoot=join(root,'world');await mkdir(worldRoot);
    const snapshot=await snapshotInputs({functionsSource:source,env:{NODE_PATH:modules}},worldRoot);
    await writeFile(join(dependency,'index.cjs'),"module.exports='caller mutation'");
    for(const name of ['generation','reset']){
      const prepared=await prepareGeneration(snapshot,join(worldRoot,name));
      const config=JSON.parse(await readFile(prepared.configPath,'utf8'));
      const reply=await exec(process.execPath,['-e',`console.log(require(${JSON.stringify(join(config.functions.source,'index.cjs'))}))`],{env:{...process.env,NODE_PATH:prepared.nodePath??modules}});
      assert.equal(reply.stdout.trim(),'creation dependency');
    }
  }finally{await rm(root,{recursive:true,force:true});}
});

test('commands cannot inject emulator routes for unselected services', native, async()=>{
  await withTestWorld({...options,services:['auth']},async world=>{
    const result=await world.run(process.execPath,['-e',"if(process.env.FIRESTORE_EMULATOR_HOST)throw Error('unselected route escaped');if(JSON.parse(process.env.FIREBASE_CONFIG).projectId!==process.env.GCLOUD_PROJECT)throw Error('wrong config')"],{env:{FIRESTORE_EMULATOR_HOST:'wrong.invalid:1',FIREBASE_CONFIG:'{"projectId":"wrong"}'}});
    assert.equal(result.code,0);
  });
});

test('a command retirement failure still stops the daemon and permits cleanup retry', {...native,timeout:30_000}, async(t)=>{
  if(process.platform==='win32')return t.skip('Unix detached-pipe failure fixture');
  const {execFileSync}=await import('node:child_process');
  const root=await mkdtemp(join(tmpdir(),'fireemu-world-retirement-'));
  const world=await createTestWorld(options);
  const descriptor=JSON.parse(await readFile(join(world.directory,'generation-1','ready.json'),'utf8'));
  const pidFile=join(root,'pid');
  let escapedPid;
  const stopOwned=(pid,marker)=>{
    try{
      const identity=execFileSync('/bin/ps',['-o','comm=','-o','args=','-p',String(pid)],{encoding:'utf8'});
      assert.ok(identity.includes(marker));
      process.kill(pid,'SIGKILL');
    }catch(error){if(error.code!=='ESRCH'&&error.status!==1)throw error;}
  };
  t.after(async()=>{
    if(escapedPid)stopOwned(escapedPid,pidFile);
    try{await world.dispose();}finally{
      stopOwned(descriptor.pid,world.directory);
      await rm(root,{recursive:true,force:true});
    }
  });
  const script=`const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)',${JSON.stringify(pidFile)}],{detached:true,stdio:['ignore','inherit','inherit']});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.exit(0)`;
  const command=world.run(process.execPath,['-e',script]);
  const joined=assert.rejects(command,/retired/);
  for(let count=0;count<100;count++){
    try{escapedPid=Number(await readFile(pidFile,'utf8'));break;}catch(error){if(error.code!=='ENOENT')throw error;}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.ok(Number.isSafeInteger(escapedPid)&&escapedPid>1);
  await assert.rejects(world.dispose(),/close|retirement/);
  assert.throws(()=>process.kill(descriptor.pid,0),{code:'ESRCH'});
  stopOwned(escapedPid,pidFile);escapedPid=undefined;
  await joined;
  await world.dispose();
  await assert.rejects(stat(world.directory),{code:'ENOENT'});
});

test('a process-group signal answered with EPERM still retires the world once the tree closes', {...native,timeout:30_000}, async(t)=>{
  if(process.platform==='win32')return t.skip('Unix process groups only');
  const world=await createTestWorld(options);
  const descriptor=JSON.parse(await readFile(join(world.directory,'generation-1','ready.json'),'utf8'));
  const kill=process.kill;
  let refused=0;
  // macOS answers EPERM while the group's members exit; deliver the signal, then report EPERM once.
  process.kill=(pid,signal)=>{const result=kill.call(process,pid,signal);if(pid<0&&refused===0){refused+=1;throw Object.assign(Error('kill EPERM'),{code:'EPERM'});}return result;};
  t.after(()=>{process.kill=kill;});
  await world.dispose();
  process.kill=kill;
  assert.equal(refused,1);
  assert.throws(()=>process.kill(descriptor.pid,0),{code:'ESRCH'});
  await assert.rejects(stat(world.directory),{code:'ENOENT'});
});

async function installFixtureExpress(source) {
  // Support the bundled runner's HTTP app without an SDK installation.
    await mkdir(join(source,'node_modules','express'),{recursive:true});
    await writeFile(join(source,'node_modules','express','package.json'),JSON.stringify({name:'express',version:'5.0.0',main:'index.cjs'}));
    await writeFile(join(source,'node_modules','express','index.cjs'),`module.exports=function(){let handler;const app=(req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{req.body=JSON.parse(body||'{}');const p=req.url.split('?')[0].split('/');req.params={project:p[1],region:p[2],name:p[3]};req.get=name=>req.headers[name.toLowerCase()];res.status=code=>{res.statusCode=code;return res;};res.send=value=>res.end(String(value));res.json=value=>res.end(JSON.stringify(value));handler(req,res,()=>{});});};app.use=()=>{};app.all=(_path,fn)=>handler=fn;return app;};for(const name of ['json','text','urlencoded','raw'])module.exports[name]=()=>()=>{};`);
  }

test('real Functions imports, trial boundaries, Rules and module globals belong to each world', {...native,timeout:process.env.FIREEMU_TEST_SDK_MODULES?180_000:30_000}, async(t)=>{
  const root=await mkdtemp(join(tmpdir(),'fireemu-functions-worlds-'));
  t.after(async()=>{await rm(root,{recursive:true,force:true});});
  const source=join(root,'functions');await mkdir(source);
  await writeFile(join(source,'package.json'),JSON.stringify({main:'index.cjs'}));
  if(process.env.FIREEMU_TEST_SDK_MODULES)await symlink(process.env.FIREEMU_TEST_SDK_MODULES,join(source,'node_modules'),process.platform==='win32'?'junction':'dir');
  else await installFixtureExpress(source);
  const expiry=Date.parse('2026-02-01T00:00:00Z');
  const code=marker=>`
    const imported=Date.now();let hits=0,scheduled=0,taskAttempts=0;
    const api=async(req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({marker:${JSON.stringify(marker)},imported,now:Date.now(),date:+new Date(),usable:Date.now()<${expiry},hits:++hits,scheduled,taskAttempts,runnerPid:process.pid}));};
    api.__endpoint={platform:'gcfv2',httpsTrigger:{}};
    const schedule=async()=>{scheduled++;await fetch('http://'+process.env.FIRESTORE_EMULATOR_HOST+'/v1/projects/'+process.env.GCLOUD_PROJECT+'/databases/(default)/documents/scheduled/item',{method:'PATCH',headers:{'content-type':'application/json',authorization:'Bearer owner'},body:JSON.stringify({fields:{now:{integerValue:String(Date.now())}}})});};
    schedule.run=schedule;schedule.__endpoint={platform:'gcfv2',scheduleTrigger:{schedule:'every 1 minutes'}};
    const task=async(req,res)=>{taskAttempts++;res.statusCode=taskAttempts===1?503:200;res.end('task');};
    task.__endpoint={platform:'gcfv2',taskQueueTrigger:{retryConfig:{maxAttempts:3,minBackoffSeconds:2,maxBackoffSeconds:2,maxDoublings:0},rateLimits:{maxConcurrentDispatches:1,maxDispatchesPerSecond:100}}};
    const timer=async(req,res)=>{await new Promise(resolve=>setTimeout(resolve,100));res.end('done');};
    timer.__endpoint={platform:'gcfv2',httpsTrigger:{}};
    const blocked=()=>{while(true){}};blocked.__endpoint={platform:'gcfv2',httpsTrigger:{}};
    module.exports={api,schedule,task,timer,blocked};
  `;
  const worlds=[];
  t.after(async()=>{await Promise.all(worlds.map(w=>w.dispose()));});
  for(const marker of ['A','B','C']){
    await writeFile(join(source,'index.cjs'),code(marker));
    const world=await createTestWorld({...options,ui:true,clockStart:'2026-01-31T23:59:59.999Z',functionsSource:source,services:['auth','firestore','functions'],clock:{timers:'virtual'},shutdownTimeoutMs:20,env:{...options.env,FIREEMU_RUNNER_NODE:new URL('../../tools/runner-node/index.mjs',import.meta.url).pathname}});
    worlds.push(world);
  }
  const [a,b,c]=worlds;
  const query=async world=>{
    const response=await fetch(`${world.endpoints.functions.url}/${world.projectId}/us-central1/api`);
    assert.equal(response.status,200,await response.clone().text());return response.json();
  };
  const initial=await Promise.all(worlds.map(query));
  assert.deepEqual(initial.map(value=>value.marker),['A','B','C']);
  assert.ok(initial.every(value=>value.usable&&value.now===expiry-1&&value.date===expiry-1&&value.imported===expiry-1));
  const allow="rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }";
  const deny=allow.replace('if true','if false');
  await Promise.all([a.control('PUT','/v1/rules',{source:allow}),b.control('PUT','/v1/rules',{source:deny}),c.control('PUT','/v1/rules',{source:allow})]);
  await Promise.all([a.clock.advance(1),c.reset()]);
  const after=await Promise.all(worlds.map(query));
  assert.equal(after[0].now,expiry);assert.equal(after[0].usable,false);
  assert.equal(after[1].now,expiry-1);assert.equal(after[1].usable,true);
  assert.equal(after[1].hits,2);assert.equal(after[2].hits,1);assert.equal(after[2].marker,'C');
  await a.clock.advance(1);assert.equal((await query(a)).now,expiry+1);
  const rules=await Promise.all(worlds.map(world=>world.control('GET','/v1/rules')));
  assert.ok(JSON.stringify(rules[0]).includes('if true'));assert.ok(JSON.stringify(rules[1]).includes('if false'));assert.equal(rules[2].loaded,false);
  const readScheduled=async world=>fetch(`${world.endpoints.firestore.url}/v1/projects/${world.projectId}/databases/(default)/documents/scheduled/item`,{headers:{authorization:'Bearer owner'}});
  for(let count=0;count<100;count++){if((await readScheduled(a)).status===200)break;await new Promise(resolve=>setTimeout(resolve,10));}
  const written=await (await readScheduled(a)).json();assert.equal(written.fields.now.integerValue,String(expiry));
  assert.equal((await readScheduled(b)).status,404);
  assert.equal((await query(b)).scheduled,0);
  const start=(await query(a)).now;
  const taskQueue=`projects/${a.projectId}/locations/us-central1/queues/task`;
  const taskResponse=await fetch(`${a.endpoints.tasks.url}/${taskQueue}/tasks`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task:{name:`${taskQueue}/tasks/clock-boundary`,scheduleTime:new Date(start+1000).toISOString(),httpRequest:{url:'',body:Buffer.from(JSON.stringify({data:{}})).toString('base64')}}})});
  assert.equal(taskResponse.status,200,await taskResponse.text());
  await a.clock.advance(999);await new Promise(resolve=>setTimeout(resolve,50));assert.equal((await query(a)).taskAttempts,0);
  await a.clock.advance(1);
  const attempts=async expected=>{for(let count=0;count<100;count++){if((await query(a)).taskAttempts===expected)return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail(`task attempts did not reach ${expected}`);};
  await attempts(1);await new Promise(resolve=>setTimeout(resolve,50));assert.equal((await query(a)).taskAttempts,1);
  await a.clock.advance(1999);assert.equal((await query(a)).taskAttempts,1);
  await a.clock.advance(1);await attempts(2);
  assert.equal((await query(b)).taskAttempts,0);
  const timerUrl=`${a.endpoints.functions.url}/${a.projectId}/us-central1/timer`;
  const timer=fetch(timerUrl);let timerFinished=false;
  timer.then(()=>{timerFinished=true;});
  await new Promise(resolve=>setTimeout(resolve,50));
  await a.clock.advance(99);await a.clock.runDue();assert.equal(timerFinished,false);
  await a.clock.advance(1);await a.clock.runDue();assert.equal(await (await timer).text(),'done');
  const pending=fetch(`${c.endpoints.functions.url}/${c.projectId}/us-central1/timer`);
  const retired=pending.then(response=>assert.ok(response.status>=500),()=>{});
  await new Promise(resolve=>setTimeout(resolve,50));
  await c.reset();await retired;
  assert.equal((await query(c)).hits,1);
  const uiValues = await Promise.all(worlds.map(async world => {
    const config = await uiConfig(world);
    const response = await uiRequest(world, config, '/ui/api/functions/api:invoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'GET' }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 200);
    assert.equal(result.bodyEncoding, 'utf8');
    return JSON.parse(result.body);
  }));
  assert.deepEqual(uiValues.map(value => value.marker), ['A', 'B', 'C']);
  assert.equal(uiValues[2].hits, 2);
  // Force daemon retirement while the runner cannot process shutdown or stdin closure.
  const runnerPid=(await query(a)).runnerPid;
  const blocked=fetch(`${a.endpoints.functions.url}/${a.projectId}/us-central1/blocked`);
  const closed=blocked.then(response=>assert.ok(response.status>=500),()=>{});
  await new Promise(resolve=>setTimeout(resolve,50));
  await a.dispose();await closed;
  for(let count=0;count<100;count++){
    try{process.kill(runnerPid,0);}catch(error){assert.equal(error.code,'ESRCH');return;}
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('blocked runner survived forced world retirement');
});

test('TOML world configuration starts and resets from the creation snapshot', native, async t => {
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-toml-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, 'fireemu.toml');
  const { execFileSync } = await import('node:child_process');
  execFileSync(binary, ['init', '--yes', '--profile', 'strict'], { cwd: root, timeout: 10_000 });
  await withTestWorld({ ...options, config }, async world => {
    const generation = world.generation;
    await writeFile(config, 'invalid replacement');
    await world.reset();
    assert.equal(world.generation, generation + 1);
    assert.equal(world.projectId, options.projectId);
    assert.ok(world.endpoints.auth.port > 0);
  });
});

test('invalid TOML startup names the format and path and removes private directories', native, async t => {
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-toml-error-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, 'broken.toml');
  await writeFile(config, 'schemaVersion = [');
  await assert.rejects(createTestWorld({ ...options, config, tempRoot: root }), error => {
    assert.ok(error.message.includes('TOML'));
    assert.ok(error.message.includes(config));
    return true;
  });
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(root), ['broken.toml']);
});

test('shared control routes retain legacy URLs and follow world reset', native, async t => {
  const world = await createTestWorld({...options,services:['auth']});
  t.after(()=>world.dispose());
  const control = world.control;
  for (let generation=0; generation<2; generation++) {
    const before = await world.clock.get();
    await assert.rejects(control('GET','/v1/not-a-route'),/test world control 404/);
    assert.deepEqual(await control('GET','sessions/default'),before);
    assert.deepEqual(await control('GET','/v1/sessions/default'),before);
    assert.equal(world.endpoints.control.url,world.endpoints.control.origin);
    assert.equal(world.environment.FIREEMU_CONTROL_URL,world.endpoints.control.apiBaseUrl);
    assert.equal(world.endpoints.control.apiBaseUrl,`${world.endpoints.control.url}/v1/`);
    const {createControlClient} = await import('../fireemu/control.mjs');
    const client = createControlClient({env:world.environment});
    assert.deepEqual(await client.request('GET','sessions/default'),before);
    const module = new URL('../fireemu/control.mjs',import.meta.url).href;
    const script = `import {createControlClient} from ${JSON.stringify(module)}; console.log(JSON.stringify(await createControlClient().request('GET','sessions/default')));`;
    const result = await world.run(process.execPath,['--input-type=module','-e',script]);
    assert.deepEqual(JSON.parse(result.stdout),before);
    await world.clock.advance({seconds:1});
    if(generation===0)await world.reset();
  }
  await world.dispose();
  await assert.rejects(control('GET','sessions/default'),/disposed/);
});

test('Hub options reject non-booleans before starting a world', async () => {
  for (const hub of [null, 0, 1, 'true', {}, []]) {
    await assert.rejects(createTestWorld({ ...options, binaryPath: process.execPath, hub }), /hub must be a boolean/);
  }
});

test('test worlds disable Hub by default even with configured Hub port', native, async () => {
  await withTestWorld({...options, config:{...options.config,daemon:{hubPort:4400}}}, async world => {
    assert.equal(world.endpoints.hub, undefined);
    assert.equal(world.environment.FIREBASE_EMULATOR_HUB, undefined);
  });
});

test('opt-in Hub isolates exports, retires credentials and restores creation snapshots', {...native,skip:!binary||process.platform==='win32',timeout:90_000}, async t => {
  const root = await mkdtemp(join(homedir(),'.fireemu-world-export-'));
  const worlds=[];
  t.after(async()=>{await Promise.all(worlds.map(world=>world.dispose()));await rm(root,{recursive:true,force:true});});
  const opts={...options,services:['auth','firestore','storage'],hub:true};
  const locator=async world=>JSON.parse(await readFile(join(world.environment.TMPDIR,`hub-${world.projectId}.json`),'utf8'));
  const exportWorld=async(world,path)=>{
    const result=await world.run(binary,['emulators:export',path,'--project',world.projectId]);
    assert.equal(result.code,0,result.stderr);
  };
  const document=world=>`${world.endpoints.firestore.url}/v1/projects/${world.projectId}/databases/(default)/documents/export/item`;
  const storage=world=>`${world.endpoints.storage.url}/storage/v1/b/${world.projectId}.appspot.com/o/item.txt?alt=media`;
  const headers={authorization:'Bearer owner','content-type':'application/json'};
  for(let index=0;index<2;index++)worlds.push(await createTestWorld(opts));
  const [a,b]=worlds;
  assert.ok(a.endpoints.hub);
  assert.notEqual(a.environment.FIREBASE_EMULATOR_HUB,b.environment.FIREBASE_EMULATOR_HUB);
  assert.notEqual(a.environment.TMPDIR,b.environment.TMPDIR);
  const locators=await Promise.all(worlds.map(locator));
  assert.notEqual(locators[0].fireemuControlToken,locators[1].fireemuControlToken);
  for(const [index,world] of worlds.entries()){
    assert.equal((await fetch(document(world),{method:'PATCH',headers,body:JSON.stringify({fields:{marker:{stringValue:String(index)}}})})).status,200);
    const uploaded=await fetch(`${world.endpoints.storage.url}/upload/storage/v1/b/${world.projectId}.appspot.com/o?uploadType=media&name=item.txt`,{method:'POST',headers:{authorization:'Bearer owner','content-type':'text/plain'},body:`bytes-${index}`});
    assert.equal(uploaded.status,200,await uploaded.clone().text());
    const created=await fetch(`${world.endpoints.auth.url}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=test`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`export${index}@example.com`,password:'password123',returnSecureToken:true})});
    assert.equal(created.status,200,await created.clone().text());
    for(const token of [undefined,locators[1-index].fireemuControlToken]){
      const denied=await fetch(`${world.endpoints.hub.url}/_admin/export`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify({path:join(root,'denied')})});
      assert.equal(denied.status,403);
    }
    await exportWorld(world,join(root,`export-${index}`));
  }
  const failurePath=join(root,'not-a-directory');await writeFile(failurePath,'occupied');
  await assert.rejects(a.run(binary,['emulators:export',failurePath,'--project',a.projectId]),/command exited .*not a directory/s);
  const oldHub=a.endpoints.hub.url,oldTmp=a.environment.TMPDIR,oldToken=locators[0].fireemuControlToken;
  await a.reset();
  await assert.rejects(stat(oldTmp),{code:'ENOENT'});
  assert.notEqual((await locator(a)).fireemuControlToken,oldToken);
  assert.equal((await fetch(document(a),{headers})).status,404);
  if(oldHub!==a.endpoints.hub.url)await assert.rejects(fetch(oldHub,{signal:AbortSignal.timeout(2000)}));
  const oldCredential=await fetch(`${a.endpoints.hub.url}/_admin/export`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${oldToken}`},body:JSON.stringify({path:join(root,'retired')})});
  assert.equal(oldCredential.status,403);
  for(let index=0;index<2;index++){
    const imported=await createTestWorld({...opts,import:join(root,`export-${index}`)});worlds.push(imported);
    const check=async()=>{
      assert.equal((await (await fetch(document(imported),{headers})).json()).fields.marker.stringValue,String(index));
      const object=await fetch(storage(imported),{headers});assert.equal(object.status,200);assert.equal(await object.text(),`bytes-${index}`);
      const metadata=await (await fetch(storage(imported).replace('?alt=media',''),{headers})).json();assert.equal(metadata.contentType,'text/plain');
      const accounts=await (await fetch(`${imported.endpoints.auth.url}/identitytoolkit.googleapis.com/v1/projects/${imported.projectId}/accounts:batchGet`,{headers})).json();
      assert.deepEqual(accounts.users.map(user=>user.email),[`export${index}@example.com`]);
      const login=await fetch(`${imported.endpoints.auth.url}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`export${index}@example.com`,password:'password123',returnSecureToken:true})});
      assert.equal(login.status,200,await login.clone().text());
      assert.equal((await login.json()).localId,accounts.users[0].localId);
    };
    await check();
    await rm(join(root,`export-${index}`),{recursive:true});
    await imported.reset();await check();
  }
  const surviving=join(root,'surviving');await exportWorld(b,surviving);
  const disposedHub=b.endpoints.hub.url,disposedTmp=b.environment.TMPDIR;
  await b.dispose();await assert.rejects(stat(disposedTmp),{code:'ENOENT'});
  await assert.rejects(fetch(disposedHub,{signal:AbortSignal.timeout(2000)}));
  assert.ok((await stat(join(surviving,'firebase-export-metadata.json'))).isFile());
});

test('a database world routes, exports, imports and resets the Realtime Database', {...native,skip:!binary||process.platform==='win32',timeout:60_000}, async t => {
  const root=await mkdtemp(join(homedir(),'.fireemu-database-export-'));
  const worlds=[];
  t.after(async()=>{await Promise.all(worlds.map(world=>world.dispose()));await rm(root,{recursive:true,force:true});});
  const opts={...options,services:['database'],hub:true};
  const value=world=>`${world.endpoints.database.url}/item.json?ns=${world.projectId}-default-rtdb`;
  const headers={authorization:'Bearer owner'};
  const read=async world=>{const response=await fetch(value(world),{headers});assert.equal(response.status,200);return response.json();};
  const source=await createTestWorld(opts);worlds.push(source);
  assert.equal(source.environment.FIREBASE_DATABASE_EMULATOR_HOST,`${source.endpoints.database.host}:${source.endpoints.database.port}`);
  assert.equal(source.environment.FIRESTORE_EMULATOR_HOST,undefined);
  assert.equal((await fetch(value(source),{method:'PUT',headers,body:'{"marker":"a"}'})).status,200);
  const exported=join(root,'export');
  const result=await source.run(binary,['emulators:export',exported,'--project',source.projectId]);
  assert.equal(result.code,0,result.stderr);
  assert.equal(await readFile(join(exported,'database_export',`${source.projectId}-default-rtdb.json`),'utf8'),'{"item":{"marker":"a"}}');
  const imported=await createTestWorld({...opts,hub:false,import:exported});worlds.push(imported);
  assert.deepEqual(await read(imported),{marker:'a'});
  assert.equal((await fetch(value(imported),{method:'PUT',headers,body:'{"marker":"b"}'})).status,200);
  await rm(exported,{recursive:true});
  await imported.reset();
  assert.deepEqual(await read(imported),{marker:'a'});
});

test('Hub export restores password authentication after import and reset', {...native,skip:!binary||process.platform==='win32',timeout:60_000}, async t => {
  const root=await mkdtemp(join(homedir(),'.fireemu-password-export-'));
  const worlds=[];
  t.after(async()=>{await Promise.all(worlds.map(world=>world.dispose()));await rm(root,{recursive:true,force:true});});
  const opts={...options,services:['auth'],hub:true};
  const source=await createTestWorld(opts);worlds.push(source);
  const credentials={email:'restored@example.com',password:'preserved-password',returnSecureToken:true};
  const auth=async(world,action,body)=>fetch(`${world.endpoints.auth.url}/identitytoolkit.googleapis.com/v1/accounts:${action}?key=test`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const created=await auth(source,'signUp',credentials);assert.equal(created.status,200,await created.clone().text());
  const uid=(await created.json()).localId;
  const path=join(root,'export');
  const exported=await source.run(binary,['emulators:export',path,'--project',source.projectId]);assert.equal(exported.code,0,exported.stderr);
  await source.dispose();
  const restored=await createTestWorld({...opts,import:path});worlds.push(restored);
  await rm(path,{recursive:true});
  for(let generation=1;generation<=2;generation++){
    if(generation===2)await restored.reset();
    const login=await auth(restored,'signInWithPassword',credentials);assert.equal(login.status,200,await login.clone().text());assert.equal((await login.json()).localId,uid);
    assert.notEqual((await auth(restored,'signInWithPassword',{...credentials,password:'wrong-password'})).status,200);
  }
});

test('a database world resets to the Rules captured from firebase.json', native, async t => {
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-rtdb-rules-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const shape of ['object', 'target']) {
    await t.test(shape, async () => {
      const cwd = join(root, shape);
      await mkdir(join(cwd, 'rules'), { recursive: true });
      const database = join(cwd, 'rules', 'database.rules.json');
      const firestore = join(cwd, 'rules', 'firestore.rules');
      const rules = access => JSON.stringify({ rules: { example: { '.read': access } } });
      const firestoreSource = "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{doc=**} { allow read: if true; } } }";
      await writeFile(database, rules(true));
      await writeFile(firestore, firestoreSource);
      const ns = shape === 'object' ? `${options.projectId}-default-rtdb` : `${options.projectId}-other`;
      const section = { rules: 'rules/database.rules.json' };
      await writeFile(join(cwd, 'firebase.json'), JSON.stringify({
        firestore: { rules: 'rules/firestore.rules' },
        database: shape === 'object' ? section : [{ target: 'rtdb', ...section }],
      }));
      await writeFile(join(cwd, '.firebaserc'), JSON.stringify({ targets: { [options.projectId]: { database: { rtdb: [ns] } } } }));
      const settings = {
        ...options, cwd, firebaseJson: 'firebase.json', services: ['database', 'firestore'],
        config: { schemaVersion: 1, profile: 'strict', database: { defaultAccess: 'locked' } },
      };
      const read = world => fetch(`${world.endpoints.database.url}/example.json?ns=${ns}`);
      await withTestWorld(settings, async world => {
        assert.equal((await read(world)).status, 200);
        assert.ok(JSON.stringify(await world.control('GET', '/v1/rules')).includes('allow read: if true'));
        await writeFile(database, rules(false));
        await writeFile(firestore, firestoreSource.replace('if true', 'if false'));
        await world.reset();
        assert.equal((await read(world)).status, 200);
        assert.ok(JSON.stringify(await world.control('GET', '/v1/rules')).includes('allow read: if true'));
        await withTestWorld(settings, async fresh => {
          assert.equal((await read(fresh)).status, 401);
          assert.ok(JSON.stringify(await fresh.control('GET', '/v1/rules')).includes('allow read: if false'));
        });
      });
    });
  }
});

test('Hosting readiness follows service selection and the current generation', native, async t => {
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-hosting-readiness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const shape of ['single', 'multiple']) {
    const cwd = join(root, shape);
    const publicDir = 'public';
    await mkdir(join(cwd, publicDir), { recursive: true });
    await writeFile(join(cwd, publicDir, 'index.html'), shape);
    const hosting = shape === 'single' ? { public: publicDir } : [
      { site: 'first', public: publicDir }, { site: 'second', public: publicDir },
    ];
    await writeFile(join(cwd, 'firebase.json'), JSON.stringify({ hosting }));
    for (const selection of ['selected', 'unselected']) {
      const services = selection === 'selected' ? ['hosting'] : ['firestore'];
      await withTestWorld({ ...options, cwd, firebaseJson: 'firebase.json', services }, async world => {
        for (const [index, phase] of ['create', 'reset'].entries()) {
          await t.test(`${shape}/${selection}/${phase}`, async () => {
            if (phase === 'reset') await world.reset();
            assert.equal(world.generation, index + 1);
            assert.ok(Object.isFrozen(world.hostingSites));
            if (selection === 'unselected') {
              assert.equal(world.hostingUrl, undefined);
              assert.equal(world.endpoints.hosting, undefined);
              assert.deepEqual(world.hostingSites, []);
              return;
            }
            assert.equal(world.hostingSites[0].url, world.hostingUrl);
            assert.equal(world.endpoints.hosting.url, new URL(world.hostingUrl).origin);
            assert.deepEqual(world.hostingSites.map(site => site.site), shape === 'single' ? [world.projectId] : ['first', 'second']);
            for (const site of world.hostingSites) {
              const response = await fetch(site.url);
              assert.equal(response.status, 200);
              assert.equal(await response.text(), shape);
            }
          });
        }
      });
    }
  }
});

test('Test World Hosting matches absolute ignore rules against the authored public root after relocation', native, async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'fireemu-world-hosting-ignore-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const publicDir = join(cwd, 'public');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'hidden.txt'), 'hidden');
  await writeFile(join(publicDir, 'visible.txt'), 'visible');
  await writeFile(join(cwd, 'firebase.json'), JSON.stringify({
    hosting: { public: 'public', ignore: [join(publicDir, 'hidden.txt').replaceAll('\\', '/')] },
  }));
  await withTestWorld({ ...options, cwd, firebaseJson: 'firebase.json', services: ['hosting'] }, async world => {
    const visible = await fetch(new URL('/visible.txt', world.hostingUrl));
    assert.equal(visible.status, 200);
    assert.equal(await visible.text(), 'visible');
    const hidden = await fetch(new URL('/hidden.txt', world.hostingUrl));
    assert.equal(hidden.status, 404);
  });
});

test('Test World Hosting keeps each authored public root outside the relocated Firebase config across reset', native, async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'fireemu-world-hosting-roots-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const hosting = [];
  for (const site of ['first', 'second']) {
    const publicDir = join(cwd, site);
    await mkdir(publicDir);
    await writeFile(join(publicDir, 'hidden.txt'), 'hidden');
    await writeFile(join(publicDir, 'visible.txt'), site);
    hosting.push({ site, public: site, ignore: [join(publicDir, 'hidden.txt').replaceAll('\\', '/')] });
  }
  hosting[0]._fireemuTestWorldPublicRoot = '/unrelated';
  hosting[0].ignore.push('/unrelated/visible.txt');
  await writeFile(join(cwd, 'firebase.json'), JSON.stringify({ hosting }));
  await withTestWorld({ ...options, cwd, firebaseJson: 'firebase.json', services: ['hosting'] }, async world => {
    for (const generation of [1, 2]) {
      const path = join(world.directory, `generation-${generation}`, 'inputs', 'firebase.json');
      const relocated = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(relocated.hosting[0]._fireemuTestWorldPublicRoot, '/unrelated');
      assert.equal(Object.hasOwn(relocated.hosting[1], '_fireemuTestWorldPublicRoot'), false);
      assert.deepEqual(world.hostingSites.map(({ site }) => site), ['first', 'second']);
      for (const { site, url } of world.hostingSites) {
        const hidden = await fetch(new URL('/hidden.txt', url));
        assert.equal(hidden.status, 404, site);
        await hidden.text();
        const visible = await fetch(new URL('/visible.txt', url));
        assert.equal(visible.status, 200, site);
        assert.equal(await visible.text(), site);
      }
      if (generation === 1) await world.reset();
    }
  });
});

test('parallel Hosting worlds route the same API through their own Functions and Firestore', {...native, timeout: 60_000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'fireemu-world-hosting-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const documentPath = project => `/v1/projects/${project}/databases/(default)/documents/items/shared`;
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const page = marker => `<!doctype html><p id="asset">${marker}</p><p id="api"></p><script>
    fetch('/api/shared').then(response => response.json()).then(result => document.querySelector('#api').textContent = result.data);
  </script>`;
  async function project(marker) {
    const cwd = join(root, marker);
    const source = join(cwd, 'functions');
    await Promise.all(['public', 'secondary', 'functions'].map(name => mkdir(join(cwd, name), { recursive: true })));
    await writeFile(join(cwd, 'public', 'index.html'), page(marker));
    await writeFile(join(cwd, 'secondary', 'index.html'), page(`${marker}-secondary`));
    if (process.platform !== 'win32') {
      await writeFile(join(cwd, 'outside.txt'), 'outside-only');
      await writeFile(join(cwd, 'public', 'ignored.txt'), 'relatively ignored');
      await writeFile(join(cwd, 'public', 'absolute.txt'), 'absolutely ignored');
      await mkdir(join(cwd, 'public', 'nested'));
      await writeFile(join(cwd, 'public', 'nested', 'asset.txt'), 'linked directory asset');
      await symlink('../outside.txt', join(cwd, 'public', 'outside-link.txt'));
      await symlink('ignored.txt', join(cwd, 'public', 'ignored-link.txt'));
      await symlink('absolute.txt', join(cwd, 'public', 'blocked-alias.txt'));
      await symlink('index.html', join(cwd, 'public', 'inside-link.html'));
      await symlink('nested', join(cwd, 'public', 'inside-directory'), 'dir');
    }
    await writeFile(join(source, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
    await installFixtureExpress(source);
    await writeFile(join(source, 'index.cjs'), `
      const run = async (req, res) => {
        const response = await fetch('http://'+process.env.FIRESTORE_EMULATOR_HOST+${JSON.stringify(documentPath(options.projectId))},
          {headers:{authorization:'Bearer owner'}});
        const record = await response.json();
        res.json({marker:${JSON.stringify(marker)},data:record.fields?.value?.stringValue ?? null,path:req.headers['x-original-url']});
      };
      run.__endpoint = {platform:'gcfv2',httpsTrigger:{}};
      module.exports = { api: run };
    `);
    const rewrite = { source: '/api/**', function: { functionId: 'api', region: 'us-central1' } };
    await writeFile(join(cwd, 'firebase.json'), JSON.stringify({
      functions: { source: 'functions' },
      hosting: [
        { site: 'main-site', public: 'public', ignore: ['ignored.txt', `${root.replaceAll('\\', '/')}/**/public/absolute*.txt`], rewrites: [rewrite] },
        { target: 'secondary', public: 'secondary', rewrites: [rewrite] },
      ],
      emulators: { hosting: { port: 5019 } },
    }));
    await writeFile(join(cwd, '.firebaserc'), JSON.stringify({ targets: { [options.projectId]: { hosting: { secondary: ['secondary-site'] } } } }));
    return { ...options, cwd, services: ['hosting', 'functions', 'firestore'], firebaseJson: 'firebase.json',
      env: { ...options.env, FIREEMU_RUNNER_NODE: new URL('../../tools/runner-node/index.mjs', import.meta.url).pathname } };
  }
  const write = async (world, value) => {
    const response = await fetch(world.endpoints.firestore.url + documentPath(world.projectId), {
      method: 'PATCH', headers, body: JSON.stringify({ fields: { value: { stringValue: value } } }),
    });
    assert.equal(response.status, 200, await response.text());
  };
  const read = async url => {
    const response = await fetch(new URL('/api/shared', url));
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const settings = await Promise.all(['left', 'right'].map(project));
  await withTestWorld(settings[0], left => withTestWorld(settings[1], async right => {
    const worlds = [left, right];
    assert.ok(worlds.every(world => world.projectId === options.projectId));
    for (const world of worlds) {
      assert.deepEqual(world.hostingSites.map(site => site.site), ['main-site', 'secondary-site']);
      assert.equal(world.hostingSites[0].url, world.hostingUrl);
      assert.equal(world.endpoints.hosting.url, new URL(world.hostingUrl).origin);
      assert.ok(Object.isFrozen(world.hostingSites) && Object.isFrozen(world.hostingSites[0]));
    }
    const urls = worlds.flatMap(world => world.hostingSites.map(site => site.url));
    assert.equal(new Set(urls.map(url => new URL(url).port)).size, 4);
    assert.ok(urls.every(url => new URL(url).hostname === '127.0.0.1' && new URL(url).port !== '5019'));
    await Promise.all(worlds.map((world, index) => write(world, `database-${index}`)));
    for (const [index, world] of worlds.entries()) {
      const marker = index === 0 ? 'left' : 'right';
      const pages = await Promise.all(world.hostingSites.map(site => fetch(site.url).then(response => response.text())));
      assert.deepEqual(pages, [page(marker), page(`${marker}-secondary`)]);
    }
    const observed = await Promise.all(urls.map(read));
    assert.deepEqual(observed.map(value => [value.marker, value.data, value.path]), [
      ['left', 'database-0', '/api/shared'], ['left', 'database-0', '/api/shared'],
      ['right', 'database-1', '/api/shared'], ['right', 'database-1', '/api/shared'],
    ]);
    if (process.platform !== 'win32') {
      const requests = ['outside-link.txt', 'ignored-link.txt', 'absolute.txt', 'blocked-alias.txt', 'inside-link.html'].map(path => fetch(new URL(path, left.hostingUrl)));
      const [outside, ignored, absolute, absoluteAlias, inside] = await Promise.all(requests);
      assert.equal(outside.status, 404);
      assert.equal(ignored.status, 404);
      assert.equal(absolute.status, 404);
      assert.equal(absoluteAlias.status, 404);
      assert.equal(await inside.text(), page('left'));
      const directory = await fetch(new URL('inside-directory/asset.txt', left.hostingUrl));
      assert.equal(await directory.text(), 'linked directory asset');
    }
    if (process.env.FIREEMU_TEST_PLAYWRIGHT_MODULE) {
      await t.test('Playwright uses independent origins and same-origin API requests', async () => {
        const { chromium } = createRequire(import.meta.url)(process.env.FIREEMU_TEST_PLAYWRIGHT_MODULE);
        const browser = await chromium.launch({ args: ['--disable-background-networking'] });
        try {
          await Promise.all(worlds.map(async (world, index) => {
            const context = await browser.newContext();
            try {
              await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
              const browserPage = await context.newPage();
              await browserPage.goto(world.hostingUrl);
              await browserPage.waitForFunction(expected => document.querySelector('#api')?.textContent === expected, `database-${index}`);
            } finally { await context.close(); }
          }));
        } finally { await browser.close(); }
      });
    }
    await writeFile(join(settings[0].cwd, 'public', 'index.html'), page('edited'));
    await left.reset();
    assert.equal(left.generation, 2);
    assert.equal(await fetch(left.hostingUrl).then(response => response.text()), page('left'));
    assert.deepEqual(await read(left.hostingUrl), { marker: 'left', data: null, path: '/api/shared' });
    assert.deepEqual(await read(right.hostingUrl), { marker: 'right', data: 'database-1', path: '/api/shared' });
  }));
});

test('Remote Config admin handles observed client template transitions', native, async t => {
  await withTestWorld({ ...options, services: ['auth'] }, async world => {
    const request = async (suffix = '', { method = 'GET', body, match, coding = 'gzip', caller = 'valid', project = world.projectId } = {}) => {
      const url = new URL(`projects/${project}/remoteConfig${suffix}`, world.endpoints.control.apiBaseUrl);
      const headers = { 'accept-encoding': coding };
      if (caller !== 'missing') headers.authorization = `Bearer ${caller === 'valid' ? world.environment.FIREEMU_CONTROL_TOKEN : 'wrong'}`;
      if (match !== undefined) headers['if-match'] = match;
      let data;
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        data = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const response = await fetch(url, { method, body: data, headers });
      assert.equal(response.headers.get('content-encoding'), coding === 'gzip' ? 'gzip' : null);
      return { status: response.status, etag: response.headers.get('etag'), body: await response.json() };
    };

    const checkReadSelectors = async (current, first) => {
      for (const coding of ['identity', 'gzip']) {
        for (const [query, target] of [
          ['', current],
          ['?versionNumber=0', current],
          ['?versionNumber=-1', current],
          ['?versionNumber=1', first],
          ['?versionNumber=9223372036854775807', null],
        ]) {
          const reply = await request(query, { coding });
          assert.equal(reply.status, 200);
          assert.deepEqual(reply.body, target?.body ?? {});
          if (current && !target && coding === 'gzip') {
            assert.match(reply.etag, /^etag-/);
            assert.notEqual(reply.etag, current.etag);
          } else {
            assert.equal(reply.etag, coding === 'gzip' ? target?.etag ?? null : null);
          }
        }
        for (const query of ['?versionNumber=broken', '?versionNumber=9223372036854775808']) {
          const reply = await request(query, { coding });
          assert.equal(reply.status, 400);
          assert.equal(reply.etag, null);
        }
      }
    };

    for (const operation of ['read', 'validate', 'history']) {
      for (const coding of ['identity', 'gzip']) {
        for (const caller of ['valid', 'missing', 'wrong']) {
          await t.test(`${operation}/${coding}/${caller}`, async () => {
            const args = { caller, coding };
            const response = operation === 'validate'
              ? await request('?validateOnly=true', { ...args, method: 'PUT', match: '*', body: caller === 'valid' ? {} : '{' })
              : await request(operation === 'history' ? ':listVersions' : '', args);
            assert.equal(response.status, caller === 'valid' ? 200 : 401);
            if (caller === 'valid' && operation !== 'validate') assert.deepEqual(response.body, {});
          });
        }
      }
    }

    assert.equal((await request('', { project: 'demo-other' })).status, 404);
    await checkReadSelectors(null, null);
    const first = await request('', { method: 'PUT', match: '*', body: { version: { description: 'Empty' } } });
    assert.equal(first.status, 200);
    assert.match(first.etag, /^etag-/);
    assert.equal(first.body.version.versionNumber, '1');
    assert.equal(first.body.version.updateType, 'FORCED_UPDATE');
    const withoutCoding = await request('', { coding: 'identity' });
    assert.deepEqual(withoutCoding, { ...first, etag: null });
    const repeatedCoding = await new Promise((resolve, reject) => {
      const url = new URL(`projects/${world.projectId}/remoteConfig`, world.endpoints.control.apiBaseUrl);
      const req = httpGet(url, { headers: {
        authorization: `Bearer ${world.environment.FIREEMU_CONTROL_TOKEN}`,
        'accept-encoding': ['*', 'gzip;q=0'],
      } }, response => {
        response.resume();
        response.on('end', () => resolve([response.statusCode, response.headers['content-encoding']]));
        response.on('error', reject);
      });
      req.on('error', reject);
    });
    assert.deepEqual(repeatedCoding, [200, undefined]);
    await t.test(
      'Admin SDK reads and validates using the local capability',
      { skip: process.env.FIREEMU_TEST_SDK_MODULES ? false : 'FIREEMU_TEST_SDK_MODULES is not set' },
      async () => {
        const child = await world.run(process.execPath, ['-e', `
          const assert = require('node:assert/strict');
          const { createRequire } = require('node:module');
          const { join } = require('node:path');
          const load = createRequire(join(process.env.SDK_MODULES, '..', 'package.json'));
          const { initializeApp, deleteApp, SDK_VERSION } = load('firebase-admin/app');
          const { getRemoteConfig } = load('firebase-admin/remote-config');
          assert.equal(SDK_VERSION, '14.3.0');
          const app = initializeApp({
            projectId: process.env.RC_PROJECT,
            credential: { getAccessToken: async () => ({ access_token: process.env.FIREEMU_CONTROL_TOKEN, expires_in: 3600 }) }
          });
          (async () => {
            try {
              const admin = getRemoteConfig(app);
              const current = await admin.getTemplate();
              assert.equal(current.version.versionNumber, '1');
              assert.equal(current.etag, process.env.RC_START_ETAG);
              const proposal = {
                etag: current.etag, conditions: current.conditions ?? [], parameterGroups: current.parameterGroups ?? {},
                parameters: { sdk: { defaultValue: { value: 'local' } } },
              };
              const validated = await admin.validateTemplate(proposal);
              assert.equal(validated.etag, current.etag);
              assert.equal(validated.parameters.sdk.defaultValue.value, 'local');
              assert.deepEqual((await admin.getTemplate()).parameters ?? {}, {});
            } finally { await deleteApp(app); }
          })().catch(error => { console.error(error); process.exitCode = 1; });
        `], { env: {
          SDK_MODULES: process.env.FIREEMU_TEST_SDK_MODULES,
          RC_PROJECT: world.projectId,
          RC_START_ETAG: first.etag,
          FIREBASE_REMOTE_CONFIG_URL_BASE: new URL(world.endpoints.control.apiBaseUrl).origin,
        } });
        assert.equal(child.code, 0, child.stderr);
      },
    );

    const marker = { parameters: { probe: { defaultValue: { value: 'local' } } } };
    const dry = await request('?validate_only=true', { method: 'PUT', match: first.etag, body: marker });
    assert.equal(dry.status, 200);
    assert.match(dry.etag, /-0$/);
    assert.deepEqual(dry.body, { ...marker, version: {} });
    const stale = await request('?validateOnly=true', { method: 'PUT', match: 'etag-old', body: marker });
    assert.equal(stale.status, 412);
    assert.equal(stale.body.error.status, 'FAILED_PRECONDITION');
    const missingPrecondition = await request('?validateOnly=true', { method: 'PUT', body: marker });
    assert.equal(missingPrecondition.status, 400);
    assert.equal(missingPrecondition.body.error.status, 'FAILED_PRECONDITION');
    const malformedValue = await request('?validateOnly=true', { method: 'PUT', match: 'etag-old', body: {
      parameters: { flag: { valueType: 'BOOLEAN', defaultValue: { value: 1 } } },
    } });
    assert.equal(malformedValue.status, 400);
    assert.equal(malformedValue.body.error.status, 'INVALID_ARGUMENT');
    assert.deepEqual(await request(), first);

    const second = await request('', { method: 'PUT', match: first.etag, body: marker });
    assert.equal(second.status, 200);
    assert.equal(second.body.version.versionNumber, '2');
    assert.equal(second.body.version.updateType, 'INCREMENTAL_UPDATE');
    const restored = await request(':rollback', { method: 'POST', body: { versionNumber: '1' } });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.version.versionNumber, '3');
    assert.equal(restored.body.version.rollbackSource, '1');
    assert.equal(restored.body.version.description, 'Rollback to version 1');
    assert.equal(restored.body.parameters, undefined);
    assert.deepEqual(await request(), restored);
    await checkReadSelectors(restored, first);
    const historical = await request('?versionNumber=2');
    assert.deepEqual(historical, {
      ...second,
      body: { ...second.body, parameters: { probe: { ...marker.parameters.probe, valueType: 'STRING' } } },
    });

    const history = await request(':listVersions?pageSize=2');
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.versions.map(version => version.versionNumber), ['3', '2']);
    assert.ok(history.body.nextPageToken);
    const page = await request(`:listVersions?pageSize=2&pageToken=${encodeURIComponent(history.body.nextPageToken)}`);
    assert.deepEqual(page.body.versions.map(version => version.versionNumber), ['1']);
    await world.reset();
    assert.deepEqual(await request(), { status: 200, etag: null, body: {} });
  });
});

test('Remote Config admin serves server templates to the Admin SDK', native, async t => {
  await withTestWorld({ ...options, services: ['auth'] }, async world => {
    const base = world.endpoints.control.apiBaseUrl;
    const server = new URL(`projects/${world.projectId}/namespaces/firebase-server/remoteConfig`, base);
    const client = new URL(`projects/${world.projectId}/namespaces/firebase/remoteConfig`, base);
    const headers = { 'accept-encoding': 'gzip', authorization: `Bearer ${world.environment.FIREEMU_CONTROL_TOKEN}` };
    const initial = await fetch(server, { headers });
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get('content-encoding'), 'gzip');
    assert.match(initial.headers.get('etag'), /^etag-/);
    assert.deepEqual(await initial.json(), {});

    const sdkModules = process.env.FIREEMU_TEST_SDK_MODULES;
    const sdkEnv = {
      SDK_MODULES: sdkModules,
      RC_PROJECT: world.projectId,
      FIREBASE_REMOTE_CONFIG_URL_BASE: new URL(base).origin,
    };
    const sdkSetup = `
      const assert = require('node:assert/strict');
      const { createRequire } = require('node:module');
      const { join } = require('node:path');
      const load = createRequire(join(process.env.SDK_MODULES, '..', 'package.json'));
      const { initializeApp, deleteApp, SDK_VERSION } = load('firebase-admin/app');
      const { getRemoteConfig } = load('firebase-admin/remote-config');
      assert.equal(SDK_VERSION, '14.3.0');
      const app = initializeApp({
        projectId: process.env.RC_PROJECT,
        credential: { getAccessToken: async () => ({ access_token: process.env.FIREEMU_CONTROL_TOKEN, expires_in: 3600 }) }
      });
    `;
    await t.test(
      'Admin SDK sees an unpublished server template as not found',
      { skip: process.env.FIREEMU_TEST_SDK_MODULES ? false : 'FIREEMU_TEST_SDK_MODULES is not set' },
      async () => {
        const child = await world.run(process.execPath, ['-e', `${sdkSetup}
          (async () => {
            try {
              await assert.rejects(getRemoteConfig(app).getServerTemplate(), { code: 'remote-config/not-found' });
            } finally { await deleteApp(app); }
          })().catch(error => { console.error(error); process.exitCode = 1; });
        `], { env: sdkEnv });
        assert.equal(child.code, 0, child.stderr);
      },
    );

    const draft = String.raw`{"version":{"description":"Fireemu RC server coverage seed"},"conditions":[{"name":"audited","expression":"app.customSignal['fireemu_tier'].exactlyMatches(['premium'])"},{"name":"always","expression":"percent('fireemu_server') <= 100"}],"parameters":{"fireemu_text":{"defaultValue":{"value":"seed"},"valueType":"STRING","conditionalValues":{"audited":{"value":"matched"},"always":{"value":"fallback"}}},"fireemu_bool":{"defaultValue":{"value":"true"},"valueType":"BOOLEAN","conditionalValues":{"audited":{"value":"false"}}},"fireemu_number":{"defaultValue":{"value":"9.5"},"valueType":"NUMBER","conditionalValues":{"audited":{"value":"2.25"}}},"fireemu_json":{"defaultValue":{"value":"{\"outside\":1}"},"valueType":"JSON","conditionalValues":{"audited":{"value":"{\"inside\":2}"}}}}}`;
    const publishHeaders = { ...headers, 'content-type': 'application/json' };
    const published = await fetch(server, {
      method: 'PUT', headers: { ...publishHeaders, 'if-match': initial.headers.get('etag') }, body: draft,
    });
    assert.equal(published.status, 200);
    assert.equal((await published.json()).version.versionNumber, '1');

    const clientInitial = await fetch(client, { headers });
    assert.equal(clientInitial.status, 200);
    assert.equal(clientInitial.headers.get('etag'), null);
    assert.deepEqual(await clientInitial.json(), {});

    const clientPublished = await fetch(client, {
      method: 'PUT', headers: { ...publishHeaders, 'if-match': '*' }, body: '{}',
    });
    assert.equal(clientPublished.status, 200);
    assert.match(clientPublished.headers.get('etag'), /^etag-/);
    assert.equal((await clientPublished.json()).version.versionNumber, '1');
    const refused = await fetch(server, {
      method: 'PUT', headers: { ...publishHeaders, 'if-match': clientPublished.headers.get('etag') }, body: '{}',
    });
    assert.equal(refused.status, 412);
    assert.equal((await refused.json()).error.status, 'FAILED_PRECONDITION');

    await t.test(
      'Admin SDK evaluates the local server template',
      { skip: process.env.FIREEMU_TEST_SDK_MODULES ? false : 'FIREEMU_TEST_SDK_MODULES is not set' },
      async () => {
        const child = await world.run(process.execPath, ['-e', `${sdkSetup}
          (async () => {
            try {
              const admin = getRemoteConfig(app);
              const options = { defaultConfig: { fireemu_local: 17 } };
              const fetched = await admin.getServerTemplate(options);
              const initialized = admin.initServerTemplate(options);
              await initialized.load();
              for (const template of [fetched, initialized]) {
                for (const [input, values] of [
                  [{ randomizationId: 'fireemu-stable-01', fireemu_tier: 'premium' }, ['matched', false, 2.25, { inside: 2 }]],
                  [{ randomizationId: 'fireemu-stable-01', fireemu_tier: 'regular' }, ['fallback', true, 9.5, { outside: 1 }]],
                  [{}, ['seed', true, 9.5, { outside: 1 }]],
                ]) {
                  const config = template.evaluate(input);
                  assert.deepEqual([
                    config.getString('fireemu_text'),
                    config.getBoolean('fireemu_bool'),
                    config.getNumber('fireemu_number'),
                    JSON.parse(config.getString('fireemu_json')),
                    config.getNumber('fireemu_local'),
                    config.getValue('fireemu_local').getSource(),
                    config.getString('fixtured_absent'),
                    config.getValue('fixtured_absent').getSource(),
                  ], [...values, 17, 'default', '', 'static']);
                }
              }
            } finally { await deleteApp(app); }
          })().catch(error => { console.error(error); process.exitCode = 1; });
        `], { env: sdkEnv });
        assert.equal(child.code, 0, child.stderr);
      },
    );
  });
});
