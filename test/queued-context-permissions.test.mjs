import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginContext, saveContext } from '../runtime/queued-context.mjs';

const MODULE = new URL('../runtime/queued-context.mjs', import.meta.url).href;
const CODES = ['EPERM', 'EACCES'];
const INSPECTIONS = ['lstat', 'opendir'];
const CLEANUPS = ['release-owner', 'release-dir', 'candidate-owner', 'candidate-dir'];
const PRELUDE = `
  import assert from 'node:assert/strict';
  import fs from 'node:fs';
  import {randomUUID} from 'node:crypto';
  import {dirname} from 'node:path';
  import {syncBuiltinESMExports} from 'node:module';
  const path=process.argv[1], guard=path+'.claim-lock';
  const original={...fs.promises}, before=await original.readFile(path);
  const owner=process.pid+'.'+randomUUID()+'.owner';
`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'estelle-context-permission-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'queue.json');
  const request = await beginContext(path, 'turn');
  assert.equal(await saveContext(path, 'turn', request, 'queued fixture', true), true);
  return path;
}

async function isolated(t, script) {
  const path = await fixture(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', PRELUDE + script, path], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 16_000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return JSON.parse(result.stdout);
}

function inspectionScript(code, stage, persistent) {
  return `
    const code=${JSON.stringify(code)}, stage=${JSON.stringify(stage)}, persistent=${persistent};
    const denied=Object.assign(new Error('inspection denied'),{code});
    let inspections=0, probing=false;
    fs.promises[stage]=async(name,...rest)=>{
      if(probing && name===guard) {
        inspections++;
        if(persistent || inspections===1) {
          if(!persistent) { await original.unlink(guard+'/'+owner); await original.rmdir(guard); }
          throw denied;
        }
      }
      return original[stage](name,...rest);
    };
    syncBuiltinESMExports(); const queue=await import(${JSON.stringify(MODULE)});
    for(const operation of ['take','save']) {
      await original.mkdir(guard); await original.writeFile(guard+'/'+owner,'');
      inspections=0; probing=true;
      const pending=JSON.parse(await original.readFile(path,'utf8'));
      const run=operation==='take'?queue.takeContext(path,'turn'):
        queue.saveContext(path,'turn',pending.requestId,'saved fixture',true);
      if(persistent) {
        await assert.rejects(run,error=>error===denied,'return the original inspection error');
        assert.equal(inspections,20,'inspection retries must use the shared claim bound');
        assert.deepEqual(await original.readFile(path),before);
        assert.deepEqual((await original.readdir(dirname(path))).sort(),['queue.json','queue.json.claim-lock']);
        assert.deepEqual(await original.readdir(guard),[owner]);
        probing=false; await original.unlink(guard+'/'+owner); await original.rmdir(guard);
      } else {
        assert.deepEqual(await run,operation==='take'?{text:'queued fixture',degraded:true}:true);
        assert.equal(inspections,1,'only the ambiguous inspection fails');
        probing=false;
        if(operation==='save') assert.deepEqual(await queue.takeContext(path,'turn'),{text:'saved fixture',degraded:true});
        assert.deepEqual(await original.readdir(dirname(path)),[]);
        const id=await queue.beginContext(path,'turn'); await queue.saveContext(path,'turn',id,'queued fixture',true);
      }
    }
    probing=false; assert.deepEqual(await queue.takeContext(path,'turn'),{text:'queued fixture',degraded:true});
    console.log(JSON.stringify({code,stage,persistent,originalErrorOrDelivery:true}));
  `;
}

test('transient guard inspection permission races recover after owner release for both take and save', async t => {
  for (const code of CODES) for (const stage of INSPECTIONS) {
    assert.deepEqual(await isolated(t, inspectionScript(code, stage, false)),
      { code, stage, persistent: false, originalErrorOrDelivery: true });
  }
});

test('persistent guard inspection denial returns the exact inspection error at the existing retry bound', async t => {
  for (const code of CODES) for (const stage of INSPECTIONS) {
    assert.deepEqual(await isolated(t, inspectionScript(code, stage, true)),
      { code, stage, persistent: true, originalErrorOrDelivery: true });
  }
});

function cleanupScript(code, phase, persistent) {
  return `
    const code=${JSON.stringify(code)}, phase=${JSON.stringify(phase)}, persistent=${persistent};
    const denied=Object.assign(new Error('owned cleanup denied'),{code});
    let faults=0, sourceMoves=0, conflict=false;
    if(phase.startsWith('candidate')) { await original.mkdir(guard); await original.writeFile(guard+'/'+owner,''); }
    fs.promises.rename=async(from,to)=>{
      if(phase.startsWith('candidate') && to===guard && !conflict) {
        conflict=true;
        await assert.rejects(original.rename(from,to));
        await original.unlink(guard+'/'+owner); await original.rmdir(guard);
        throw Object.assign(new Error('publication conflict released'),{code:'EPERM'});
      }
      const value=await original.rename(from,to);
      if(from===path && to.endsWith('.claimed')) sourceMoves++;
      return value;
    };
    const selected=name=>phase.startsWith('candidate')?name.includes('.claim-candidate'):name.startsWith(guard);
    fs.promises.unlink=async name=>{
      if(phase.endsWith('owner') && selected(name) && name.endsWith('.owner') && (persistent || faults===0)) {
        faults++; throw denied;
      }
      return original.unlink(name);
    };
    fs.promises.rmdir=async name=>{
      if(phase.endsWith('dir') && selected(name) && (persistent || faults===0)) { faults++; throw denied; }
      return original.rmdir(name);
    };
    syncBuiltinESMExports(); const queue=await import(${JSON.stringify(MODULE)});
    if(persistent) {
      await assert.rejects(queue.takeContext(path,'turn'),error=>error===denied);
      assert.equal(faults,20,'cleanup permission retries stop at the shared numeric bound');
      if(phase.startsWith('candidate')) {
        assert.equal(sourceMoves,0,'no queue move before successful guard publication');
        assert.deepEqual(await original.readFile(path),before);
        const names=await original.readdir(dirname(path));
        assert.equal(names.filter(name=>name.endsWith('.claim-candidate')).length,1,'preserve owned candidate if removal is denied');
      } else {
        assert.equal(sourceMoves,1,'never retry a successful source claim after cleanup failure');
        const names=await original.readdir(dirname(path));
        const claimed=names.filter(name=>name.endsWith('.claimed'));
        assert.equal(claimed.length,1,'retain the already claimed payload rather than claiming again');
        assert.deepEqual(await original.readFile(dirname(path)+'/'+claimed[0]),before);
      }
    } else {
      assert.deepEqual(await queue.takeContext(path,'turn'),{text:'queued fixture',degraded:true});
      assert.equal(sourceMoves,1,'one delivery must have exactly one successful source move');
      assert.equal(faults,1);
      assert.deepEqual(await original.readdir(dirname(path)),[],'all exact owned cleanup paths removed');
    }
    console.log(JSON.stringify({code,phase,persistent,sourceMoves,faults}));
  `;
}

test('transient owned unlink and rmdir permission failures retry cleanup without repeating source claims', async t => {
  for (const code of CODES) for (const phase of CLEANUPS) {
    assert.deepEqual(await isolated(t, cleanupScript(code, phase, false)),
      { code, phase, persistent: false, sourceMoves: 1, faults: 1 });
  }
});

test('persistent owned cleanup denial preserves its original error and never retries a successful source move', async t => {
  for (const code of CODES) for (const phase of CLEANUPS) {
    assert.deepEqual(await isolated(t, cleanupScript(code, phase, true)),
      { code, phase, persistent: true, sourceMoves: phase.startsWith('candidate') ? 0 : 1, faults: 20 });
  }
});
