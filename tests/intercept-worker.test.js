'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Worker}=require('node:worker_threads');

// Real worker source and MessagePort, simulated driver. Never loads a DLL.
const source=fs.readFileSync(path.join(__dirname,'../src/intercept-worker.js'),'utf8');
const bootstrap=`
 const wt=require('node:worker_threads'),vm=require('node:vm');
 const clock=new Int32Array(new SharedArrayBuffer(4));let up=false;
 const api={KEY_UP:1,KEY_E0:2,KEY_E1:4,STROKE_SIZE:20,FILTER_KEY_ALL:65535,
   create:()=>1n,destroy:()=>wt.parentPort.postMessage({type:'destroyed'}),
   koffi:{unregister:()=>{}},isInvalid:()=>false,
   setFilter:(ctx,pred,value)=>wt.parentPort.postMessage({type:'filter',value,selected:pred(7)}),
   waitTimeout:()=>{Atomics.wait(clock,0,0,5);return 7;},
   receive:(ctx,dev,buf)=>{buf.fill(0);buf.writeUInt16LE(72,0);buf.writeUInt16LE(up?1:0,2);up=!up;return 1;},
   send:(ctx,dev,buf)=>{wt.parentPort.postMessage({type:'forwarded',down:buf.readUInt16LE(2)===0});return 1;}
 };
 const ffi={load:()=>api,findRemoteKeyboard:()=>({list:[],hit:{device:7,hwid:'remote'}}),
   makePredicate:(a,fn)=>fn,hardwareId:()=> 'remote'};
 vm.runInNewContext(wt.workerData.source,{require:n=>n==='worker_threads'?wt:ffi,Buffer,Date,Set,process,setTimeout});
`;

test('synchronous worker applies live updates and explicitly cleans up on stop', {timeout:5000}, async()=>{
  const worker=new Worker(bootstrap,{eval:true,workerData:{source,passthrough:[72],version:1}});
  const messages=[];
  const waitFor=predicate=>new Promise((resolve,reject)=>{
    const existing=messages.find(predicate);if(existing)return resolve(existing);
    const timer=setTimeout(()=>{cleanup();reject(new Error('worker message timeout'));},2000);
    const listener=m=>{if(predicate(m)){cleanup();resolve(m);}};
    const cleanup=()=>{clearTimeout(timer);worker.off('message',listener);};
    worker.on('message',listener);
  });
  worker.on('message',m=>messages.push(m));
  try{
    await waitFor(m=>m.type==='forwarded');
    worker.postMessage({type:'passthrough',set:[],version:2});
    await waitFor(m=>m.type==='configured'&&m.version===2);
    await waitFor(m=>m.type==='key');
    const exited=new Promise((resolve,reject)=>{worker.once('exit',resolve);worker.once('error',reject);});
    worker.postMessage({type:'stop'}); assert.equal(await exited,0);
    assert(messages.some(m=>m.type==='filter'&&m.value===0&&m.selected===1));
    assert.equal(messages.filter(m=>m.type==='destroyed').length,2);
    assert(messages.some(m=>m.type==='closed'));
  }finally{await worker.terminate();}
});
