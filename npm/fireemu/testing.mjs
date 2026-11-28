// A test world owns a daemon, private input snapshots and generation-scoped clients.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveBinary, ensureExecutable } from './binary.mjs';
import { snapshotInputs, prepareGeneration, removeSnapshotTree } from './testing-snapshot.mjs';
import { createWorldQueue, waitRequestTimeoutMs } from './testing-queue.mjs';
import { createControlClient } from './control.mjs';
import { advanceBody, toBody } from './testing-clock.mjs';

const endpointVariables = {firestore:'FIRESTORE_EMULATOR_HOST',auth:'FIREBASE_AUTH_EMULATOR_HOST',storage:'FIREBASE_STORAGE_EMULATOR_HOST',functions:'FIREEMU_FUNCTIONS_HOST',hosting:'FIREEMU_HOSTING_HOST',eventarc:'CLOUD_EVENTARC_EMULATOR_HOST',tasks:'CLOUD_TASKS_EMULATOR_HOST',pubsub:'PUBSUB_EMULATOR_HOST',database:'FIREBASE_DATABASE_EMULATOR_HOST',appcheck:'FIREEMU_APP_CHECK_EMULATOR_HOST',hub:'FIREBASE_EMULATOR_HUB',logging:'FIREBASE_LOGGING_EMULATOR_HOST'};
const emulatorVariables = new Set([...Object.values(endpointVariables),'FIREBASE_CONFIG','NODE_PATH','FIREBASE_FIRESTORE_EMULATOR_ADDRESS','STORAGE_EMULATOR_HOST','FIREEMU_CONTROL_TOKEN','FIREEMU_CONTROL_URL','FIREEMU_APP_CHECK_EMULATOR_HOST','FIREEMU_APP_CHECK_JWKS_URL','FIREEMU_APP_CHECK_DEBUG_TOKEN_URL','FIREBASE_DATABASE_EMULATOR_HOST']);
const emptyEnvironment=base=>Object.fromEntries(Object.entries(base).filter(([name])=>!emulatorVariables.has(name)));

function supervise(command,args,options){
  const child=spawn(command,args,{...options,stdio:options.stdio??['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
  let output='',errorOutput='',result,commandResult;
  if(options.commandOwner)child.on('message',message=>{if(message?.type==='command-exit')commandResult=message;});
  child.stdin?.on('error',()=>{});
  child.stdout?.on('data',data=>{output=(output+data).slice(-65536);});
  child.stderr?.on('data',data=>{errorOutput=(errorOutput+data).slice(-65536);});
  const exited=new Promise(resolve=>{
    child.once('error',error=>{result={error};resolve(result);});
    child.once('close',(code,signal)=>{result??=commandResult?.error?{error:Error(commandResult.error)}:commandResult??{code,signal};resolve(result);});
  });
  return {child,exited,result:()=>result,output:()=>output,errorOutput:()=>errorOutput};
}
// macOS answers EPERM to a process-group signal while the group's members are exiting. The wait
// below still requires the tree to close, so EPERM is treated like ESRCH.
async function stop(process,timeout=5000){
  if(!process||process.result())return;
  const signal=kind=>{if(process.result())return;try{if(globalThis.process.platform==='win32')process.child.kill(kind);else globalThis.process.kill(-process.child.pid,kind);}catch(error){if(error.code!=='ESRCH'&&error.code!=='EPERM')throw error;}};
  process.child.stdin?.end();
  signal('SIGTERM');
  let timer;
  const grace=new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeout);});
  const retired=await Promise.race([process.exited.then(()=>true),grace]);
  clearTimeout(timer);
  if(!retired){
    signal('SIGKILL');
    const forced=new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);});
    const closed=await Promise.race([process.exited.then(()=>true),forced]);
    clearTimeout(timer);
    if(!closed)throw Error('test world process tree did not close after forced retirement');
  }
}
function endpoints(descriptor,control){
  const result={};
  const decode=value=>{const url=new URL(value.includes('://')?value:`http://${value}`);return Object.freeze({host:url.hostname,port:Number(url.port),url:`${url.protocol}//${url.host}`});};
  result.control=Object.freeze({...decode(descriptor.controlUrl),origin:control.origin,apiBaseUrl:control.apiBaseUrl});
  for(const [service,name] of Object.entries(endpointVariables))if(descriptor.environment[name])result[service]=decode(descriptor.environment[name]);
  if(descriptor.hostingUrl)result.hosting=decode(descriptor.hostingUrl);
  return Object.freeze(result);
}

function snapshotBudget(options,timeout){
  const controller=new AbortController();
  const deadline=Date.now()+timeout;
  const timedOut=()=>{
    const error=Error('test world snapshot timed out');
    error.name='TimeoutError';
    return error;
  };
  const relay=()=>{if(!controller.signal.aborted)controller.abort(options.signal.reason);};
  const timer=setTimeout(()=>{if(!controller.signal.aborted)controller.abort(timedOut());},timeout);
  options.signal?.addEventListener('abort',relay,{once:true});
  if(options.signal?.aborted)relay();
  return {
    signal:controller.signal,
    check(){if(Date.now()>=deadline&&!controller.signal.aborted)controller.abort(timedOut());controller.signal.throwIfAborted();},
    close(){clearTimeout(timer);options.signal?.removeEventListener('abort',relay);},
  };
}

function snapshotFailure(error,signal){
  if(!signal.aborted)return error;
  const reason=signal.reason;
  if(reason?.name==='TimeoutError')return Error('test world snapshot timed out',{cause:reason});
  return Error(`test world snapshot aborted${reason?.message?`: ${reason.message}`:''}`,{cause:reason??error});
}

// FIREEMU_TEST_WORLD_STATS=1 prints each snapshot and generation copy cost to stderr.
function logSnapshotStats(label,stats){
  if(process.env.FIREEMU_TEST_WORLD_STATS!=='1')return;
  process.stderr.write(`fireemu test world ${label}: ${stats.files} files, ${stats.bytes} bytes, ${stats.method}, ${stats.elapsedMs} ms\n`);
}

function retainCleanupError(error,cleanupError){
  if(error&&typeof error==='object')try{error.cleanupError=cleanupError;}catch{}
}

// AbortSignal.any needs Node 20.3; the package supports Node 20.
function anySignal(...signals){
  const controller=new AbortController();
  for(const signal of signals)signal.addEventListener('abort',()=>controller.abort(signal.reason),{once:true});
  return controller.signal;
}

/** Create an independent emulator world; no method changes the parent's environment. */
export async function createTestWorld(options={}){
  options={...options,nodePathExcludes:Array.isArray(options.nodePathExcludes)?[...options.nodePathExcludes]:options.nodePathExcludes,config:typeof options.config==='object'?structuredClone(options.config):options.config,services:options.services?[...options.services]:undefined,env:{...(options.env??{...process.env,NODE_PATH:''})},clock:options.clock?{...options.clock}:undefined};
  if(options.hub!==undefined&&typeof options.hub!=='boolean')throw TypeError('hub must be a boolean');
  if(options.ui!==undefined&&typeof options.ui!=='boolean')throw TypeError('ui must be a boolean');
  const binary=resolveBinary(options.binaryPath?resolve(options.binaryPath):undefined);
  if(!binary)throw Error('fireemu could not start a test world: install the platform package or supply binaryPath');
  const timeout=options.startupTimeoutMs??60_000;
  if(!Number.isSafeInteger(timeout)||timeout<=0)throw TypeError('startupTimeoutMs must be a positive integer');
  const snapshotTimeout=options.snapshotTimeoutMs??60_000;
  if(!Number.isSafeInteger(snapshotTimeout)||snapshotTimeout<=0||snapshotTimeout>2147483647)throw TypeError('snapshotTimeoutMs must be a positive integer no greater than 2147483647');
  let services=options.services;
  if(services&&(!Array.isArray(services)||!services.length||services.some(name=>typeof name!=='string'||! /^(auth|firestore|storage|functions(?::[A-Za-z0-9_-]+)?|pubsub|database|appcheck|hosting)$/.test(name))))throw TypeError('services must name supported test-world services');
  const id=randomUUID();
  const directory=await mkdtemp(join(resolve(options.tempRoot??tmpdir()),'fireemu-world-'));
  let snapshot,current,closing=false,disposed=false,generation=0,checkpointSeq=0;
  const BASELINE_SNAPSHOT='__fireemu_baseline__';
  const queue=createWorldQueue();
  const snapshotLog={initial:undefined,generations:[]};
  const clients=new Set();
  const retiring=new Set();
  const check=()=>{if(closing||disposed)throw Error('test world is disposed');if(!current?.descriptor||current.process.result())throw Error('test world generation is unavailable');};
  const retire=async()=>{
    if(current)retiring.add(current);
    current=undefined;
    const clientResults=await Promise.allSettled([...clients].map(async client=>{await stop(client);clients.delete(client);}));
    const daemonResults=await Promise.allSettled([...retiring].map(async active=>{
      await stop(active.process,options.shutdownTimeoutMs??5000);
      if(!clients.size){await removeSnapshotTree(active.directory);retiring.delete(active);}
    }));
    const failures=[...clientResults,...daemonResults].filter(result=>result.status==='rejected').map(result=>result.reason);
    if(failures.length)throw new AggregateError(failures,'test world retirement failed; cleanup can be retried');
  };
  const idleSignal=body=>AbortSignal.timeout(waitRequestTimeoutMs(body));
  const requestFor=async(active,method,path,body,signal)=>{
    try{return await active.control.request(method,path,body,{signal});}
    catch(error){
      if(error.code==='FIREEMU_CONTROL_HTTP')error.message=`test world ${error.message}`;
      throw error;
    }
  };
  const recordGeneration=(number,stats)=>{
    const entry=Object.freeze({generation:number,...stats});
    snapshotLog.generations.push(entry);
    logSnapshotStats(`generation ${number}`,entry);
  };
  const start=async(prepared,generationDirectory)=>{
    options.signal?.throwIfAborted();
    const next=generation+1;
    const readyFile=join(generationDirectory,'ready.json');
    const args=['up'];
    if(prepared.hostingRootsPath)args.push('--test-world-hosting-roots',prepared.hostingRootsPath);
    args.push('--config',prepared.configPath,'--project',snapshot.config.daemon.authProject,'--only',services.join(','),'--ready-file',readyFile,'--owner-stdin','--log-verbosity','quiet');
    for(const name of ['firestore','http','storage','functions','eventarc','tasks','pubsub','database','logging'])args.push(`--${name}-port`,'0');
    if(services.includes('hosting'))args.push('--hosting-port','0');
    args.push('--hub-port',options.hub?'auto':'0');
    args.push('--ui-port',options.ui?'auto':'0');
    if(prepared.seed)args.push('--import',prepared.seed);
    const temporary=join(generationDirectory,'tmp');
    const environment={...emptyEnvironment(options.env??process.env),NODE_PATH:prepared.nodePath,TMPDIR:temporary,TEMP:temporary,TMP:temporary,FIREEMU_TEST_WORLD_ID:id,FIREEMU_TEST_WORLD_GENERATION:String(next)};
    ensureExecutable(binary.path);
    const daemon=supervise(binary.path,args,{cwd:prepared.cwd,env:environment,stdio:['pipe','pipe','pipe']});
    const active={process:daemon,directory:generationDirectory};current=active;
    const deadline=Date.now()+timeout;
    try{
      while(Date.now()<deadline){
        options.signal?.throwIfAborted();
        if(daemon.result())throw Error(`fireemu could not start test world: ${daemon.result().error?.message??daemon.errorOutput()??'daemon exited'}`);
        try{
          const descriptor=JSON.parse(await readFile(readyFile,'utf8'));
          if(descriptor.schemaVersion!==1||descriptor.pid!==daemon.child.pid||descriptor.projectId!==snapshot.config.daemon.authProject)throw Error('invalid test-world readiness descriptor');
          active.descriptor=descriptor;
          active.control=createControlClient({origin:descriptor.controlUrl,token:descriptor.controlToken,requestTimeoutMs:options.requestTimeoutMs});
          await requestFor(active,'GET','/health/ready',undefined,AbortSignal.timeout(Math.min(1000,timeout)));
          if(daemon.result())throw Error('daemon exited during test-world readiness');
          active.endpoints=endpoints(descriptor,active.control);
          active.hostingSites=Object.freeze((descriptor.hostingSites??[]).map(site=>Object.freeze(site)));
          active.environment=Object.freeze({...descriptor.environment,NODE_PATH:prepared.nodePath,TMPDIR:temporary,TEMP:temporary,TMP:temporary,FIREEMU_TEST_WORLD_ID:id,FIREEMU_TEST_WORLD_GENERATION:String(next)});
          active.hasBaseline=false;
          active.baselineError=undefined;
          try{
            await requestFor(active,'POST','/v1/sessions/default/snapshots',{name:BASELINE_SNAPSHOT},AbortSignal.timeout(Math.min(5000,timeout)));
            active.hasBaseline=true;
          }catch(err){
            active.baselineError=err;
          }
          generation=next;
          return;
        }catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError)&&error.name!=='TimeoutError'&&error.name!=='TypeError')throw error;}
        await delay(10);
      }
      throw Error('fireemu test-world startup timed out');
    }catch(error){await retire();throw error;}
  };
  // awaitIdle blocks until work finishes, which can need a clock move issued after it: it must not hold the ordered lane.
  const waitsForIdle=(method,path)=>String(method).toUpperCase()==='POST'&&typeof path==='string'&&/:awaitIdle(?:\?.*)?$/.test(path);
  const control=(method,path,body)=>waitsForIdle(method,path)
    ?queue.waiting(async signal=>{check();return requestFor(current,method,path,body,anySignal(idleSignal(body),signal));})
    :queue.ordered(async()=>{check();return requestFor(current,method,path,body);});
  const awaitIdle=async(settings={})=>{
    const {scope='all',timeoutSeconds=30}=settings;
    if(scope!=='all'&&scope!=='runnable')throw TypeError('scope must be all or runnable');
    if(typeof timeoutSeconds!=='number'||!Number.isFinite(timeoutSeconds)||timeoutSeconds<0||timeoutSeconds>600)throw TypeError('timeoutSeconds must be a number from 0 through 600');
    return control('POST','/v1/sessions/default:awaitIdle',{scope,timeoutSeconds});
  };
  const advanceAndSettle=async(duration,settings={})=>{
    // Due timers exist only where Functions runs with virtual timers; elsewhere the daemon refuses runDue.
    const {scope='runnable',timeoutSeconds=20,timeZone,allowBackwards,failOnFunctionError=false,runTimers=services.some(name=>name==='functions'||name.startsWith('functions:'))&&snapshot.config.functions?.clock?.timers==='virtual'}=settings;
    if(scope!=='all'&&scope!=='runnable')throw TypeError('scope must be all or runnable');
    if(typeof timeoutSeconds!=='number'||!Number.isFinite(timeoutSeconds)||timeoutSeconds<0||timeoutSeconds>600)throw TypeError('timeoutSeconds must be a number from 0 through 600');
    if(typeof runTimers!=='boolean')throw TypeError('runTimers must be a boolean');
    if(typeof failOnFunctionError!=='boolean')throw TypeError('failOnFunctionError must be a boolean');
    let priorDeadLetters=0;
    if(failOnFunctionError){
      try{
        const before=await control('GET','/v1/sessions/default/functions/history');
        if(Array.isArray(before?.deadLetters))priorDeadLetters=before.deadLetters.length;
      }catch{}
    }
    // The wait is admitted right behind the move, so it sees the move and never delays later clock calls.
    const moved=queue.ordered(async()=>{
      check();
      const active=current;
      const clock=await requestFor(active,'POST','/v1/sessions/default/clock:advance',advanceBody(duration,{timeZone,allowBackwards}));
      let timers;
      if(runTimers)for(let round=0;round<100;round++){
        timers=await requestFor(active,'POST','/v1/sessions/default/clock:runDue',{budget:1000});
        if(!timers?.codebases?.some(codebase=>codebase.timers?.due>0))break;
      }
      return {active,clock,timers};
    });
    const settled=queue.waiting(async signal=>{
      const {active,clock,timers}=await moved;
      const body={scope,timeoutSeconds};
      const idle=await requestFor(active,'POST','/v1/sessions/default:awaitIdle',body,anySignal(idleSignal(body),signal));
      if(failOnFunctionError){
        try{
          const after=await requestFor(active,'GET','/v1/sessions/default/functions/history');
          const deadLetters=Array.isArray(after?.deadLetters)?after.deadLetters.slice(priorDeadLetters):[];
          if(deadLetters.length>0){
            const summary=deadLetters.map(d=>`${d.function??'unknown'} (${JSON.stringify(d.outcome)})`).join(', ');
            throw Error(`background function(s) failed during advanceAndSettle: ${summary}`);
          }
        }catch(err){
          if(err?.message?.startsWith('background function(s) failed'))throw err;
        }
      }
      return {clock,timers,idle};
    });
    return settled;
  };
  const assertUserSnapshotName=name=>{
    const resolved=String(name??'');
    if(!resolved||resolved==='.'||resolved==='..'||resolved===BASELINE_SNAPSHOT)throw TypeError('snapshot/checkpoint name must be a non-empty non-reserved string');
    return resolved;
  };
  const restoreSnapshot=name=>requestFor(
    current,'POST',`/v1/sessions/default/snapshots/${encodeURIComponent(name)}:restore`,{waitForFunctions:true},
    AbortSignal.timeout(options.requestTimeoutMs??80_000),
  );
  const resetState=()=>queue.exclusive(async()=>{
    check();
    if(!current.hasBaseline){
      throw Error(`test world cannot reset state: startup baseline snapshot was not captured${current.baselineError?.message?` (${current.baselineError.message})`:''}`,{cause:current.baselineError});
    }
    await restoreSnapshot(BASELINE_SNAPSHOT);
    return world;
  },Error('test world call cancelled: the world state was reset'));
  const normalizeOrigin=value=>typeof value==='string'?value.replace(/\/+$/,''):undefined;
  const checkpointBody=(name,opts={})=>{
    const body={name};
    if(opts?.allowNonQuiescent!==undefined){
      if(typeof opts.allowNonQuiescent!=='boolean')throw TypeError('allowNonQuiescent must be a boolean');
      if(opts.allowNonQuiescent)body.allowNonQuiescent=true;
    }
    return body;
  };
  const checkpoint=async(name,opts={})=>{
    const resolved=name===undefined?`cp-${++checkpointSeq}-${randomUUID().slice(0,8)}`:assertUserSnapshotName(name);
    await control('POST','/v1/sessions/default/snapshots',checkpointBody(resolved,opts));
    return resolved;
  };
  const restore=name=>{
    const resolved=assertUserSnapshotName(name);
    return queue.exclusive(async()=>{
      check();
      await restoreSnapshot(resolved);
      return world;
    },Error('test world call cancelled: the world state was restored'));
  };
  const deleteCheckpoint=async name=>{
    const resolved=assertUserSnapshotName(name);
    await control('DELETE',`/v1/sessions/default/snapshots/${encodeURIComponent(resolved)}`);
  };
  const world={
    get generation(){return generation;},
    get uiUrl(){check();return current.descriptor.uiUrl??undefined;},
    get hostingUrl(){check();return normalizeOrigin(current.descriptor.hostingUrl);},
    get hostingSites(){check();return Object.freeze(current.hostingSites.map(entry=>Object.freeze({site:entry.site,url:normalizeOrigin(entry.url)})));},
    get endpoints(){check();return current.endpoints;},
    get environment(){check();return current.environment;},
    get directory(){return directory;},
    control,
    clock:Object.freeze({
      get:()=>control('GET','/v1/sessions/default'),
      set:(instant,{allowBackwards=false}={})=>control('POST','/v1/sessions/default/clock:set',{instant,allowBackwards}),
      advance:async(duration,options)=>control('POST','/v1/sessions/default/clock:advance',advanceBody(duration,options)),
      to:async(anchor,options)=>control('POST','/v1/sessions/default/clock:set',toBody(anchor,options)),
      advanceTo:instant=>control('POST','/v1/sessions/default/clock:advanceTo',{instant}),
      runDue:(budget=1000)=>control('POST','/v1/sessions/default/clock:runDue',{budget}),
      advanceAndSettle,
    }),
    snapshots:Object.freeze({
      list:async()=>{
        const res=await control('GET','/v1/sessions/default/snapshots');
        if(res&&typeof res==='object'&&Array.isArray(res.snapshots)){
          return {...res,snapshots:res.snapshots.filter(entry=>entry?.name!==BASELINE_SNAPSHOT)};
        }
        return res;
      },
      create:(name,opts={})=>control('POST','/v1/sessions/default/snapshots',checkpointBody(assertUserSnapshotName(name),opts)),
      restore:name=>restore(name),
      delete:name=>control('DELETE',`/v1/sessions/default/snapshots/${encodeURIComponent(assertUserSnapshotName(name))}`),
    }),
    firestore:Object.freeze({
      missingIndexes:()=>control('GET','/v1/sessions/default/firestore/missingIndexes'),
      clearMissingIndexes:()=>control('DELETE','/v1/sessions/default/firestore/missingIndexes'),
    }),
    functions:Object.freeze({
      invocations:()=>control('GET','/v1/sessions/default/functions/history'),
      logs:()=>control('GET','/v1/sessions/default/functions/logs'),
    }),
    logs:()=>control('GET','/v1/sessions/default/functions/logs'),
    awaitIdle,
    resources:()=>control('GET','/v1/sessions/default/resources'),
    checkpoint,
    restore,
    deleteCheckpoint,
    resetState,
    get snapshotStats(){return Object.freeze({initial:snapshotLog.initial,generations:Object.freeze([...snapshotLog.generations])});},
    reset:(resetOptions={})=>{
      const mode=resetOptions?.mode??'restart';
      if(mode==='state')return resetState();
      if(mode!=='restart')throw TypeError('reset mode must be "restart" or "state"');
      return queue.exclusive(async()=>{
        check();
        await retire();
        const next=generation+1,generationDirectory=join(directory,`generation-${next}`),budget=snapshotBudget(options,snapshotTimeout);
        let prepared;
        try{prepared=await prepareGeneration(snapshot,generationDirectory,budget.signal);budget.check();recordGeneration(next,prepared.stats);}
        catch(error){const failure=snapshotFailure(error,budget.signal);if(prepared)try{await removeSnapshotTree(generationDirectory);}catch(cleanupError){retainCleanupError(failure,cleanupError);}throw failure;}
        finally{budget.close();}
        await start(prepared,generationDirectory);
        return world;
      },Error('test world call cancelled: the world was reset'));
    },
    dispose:()=>{closing=true;return queue.exclusive(async()=>{if(disposed)return;await retire();await removeSnapshotTree(directory);disposed=true;},Error('test world call cancelled: the world was disposed'));},
    async run(command,args=[],runOptions={}){
      await queue.settled();check();
      const active=current;
      const windows=process.platform==='win32';
      const stdio=runOptions.stdio==='inherit'?['pipe','inherit','inherit']:['pipe','pipe','pipe'];
      if(!windows)stdio.push('ipc');
      const client=supervise(windows?binary.path:process.execPath,windows?['__test-world-command',command,...args]:[fileURLToPath(new URL('./testing-process.mjs',import.meta.url)),command,...args],{cwd:runOptions.cwd??options.cwd??process.cwd(),env:{...emptyEnvironment(process.env),...emptyEnvironment(runOptions.env??{}),...active.environment},stdio,commandOwner:!windows});
      clients.add(client);
      const aborted=()=>{void stop(client).catch(()=>{});};
      runOptions.signal?.addEventListener('abort',aborted,{once:true});
      if(runOptions.signal?.aborted)aborted();
      try{
        const result=await client.exited;
        if(current!==active||closing)throw Error('test world command was retired with its generation');
        runOptions.signal?.throwIfAborted();
        if(result.error)throw result.error;
        if(result.code!==0)throw Error(`test world command exited ${result.code??result.signal}: ${client.errorOutput()}`);
        return {...result,stdout:client.output(),stderr:client.errorOutput()};
      }finally{clients.delete(client);runOptions.signal?.removeEventListener('abort',aborted);}
    },
  };
  Object.defineProperty(world,'id',{value:id,enumerable:true});
  Object.defineProperty(world,'projectId',{get:()=>snapshot?.config.daemon.authProject,enumerable:true});
  if(typeof Symbol.asyncDispose==='symbol'){
    Object.defineProperty(world,Symbol.asyncDispose,{value:()=>world.dispose(),enumerable:false});
  }
  const budget=snapshotBudget(options,snapshotTimeout),generationDirectory=join(directory,'generation-1');
  try{
    snapshot=await snapshotInputs(options,directory,budget.signal);
    snapshotLog.initial=Object.freeze({...snapshot.stats,functions:snapshot.functionsSkipped?'skipped':'included'});
    logSnapshotStats('initial',snapshotLog.initial);
    services??=['auth','firestore','storage',...(snapshot.functionsConfigured?['functions']:[])];
    const prepared=await prepareGeneration(snapshot,generationDirectory,budget.signal);
    budget.check();
    recordGeneration(1,prepared.stats);
    budget.close();
    await start(prepared,generationDirectory);
    return Object.freeze(world);
  }catch(error){
    const failure=snapshotFailure(error,budget.signal);
    budget.close();
    try{await retire();}catch(cleanupError){retainCleanupError(failure,cleanupError);}
    try{await removeSnapshotTree(directory);}catch(cleanupError){retainCleanupError(failure,cleanupError);}
    throw failure;
  }
}

/** Always join disposal, including when the test callback rejects. */
export async function withTestWorld(options,callback){
  const world=await createTestWorld(options);
  try{return await callback(world);}finally{await world.dispose();}
}
