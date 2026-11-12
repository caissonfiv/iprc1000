'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const vm=require('node:vm');
const {once,EventEmitter}=require('node:events');
const model=require('../src/model');

async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iprc-http-'));
  let server,raw,finishStop;
  const timers=new Set(),events=[];
  const fakeProcess=new EventEmitter();
  Object.assign(fakeProcess,{env:{PORT:'0',NO_OPEN:'1'},stdout:new EventEmitter(),stderr:new EventEmitter()});
  const modules={
    http:{createServer:fn=>(server=http.createServer(fn))},
    fs:{...fs,createWriteStream:()=>({write:()=>{}})},path,dgram:require('node:dgram'),
    child_process:{spawn:()=>assert.fail('unexpected process launch')},
    './rawinput':{start:fn=>{raw=fn;},stop:()=>{}},'./devices':{findRemote:()=>({hDevice:42n})},
    './hidsource':{find:()=>null,open:()=>({ok:false,error:'mock'})},
    './intercept':{dllExists:()=>false,info:()=>({phase:'idle'}),setPassthrough:()=>{},
      stop:()=>new Promise(resolve=>{finishStop=resolve;})},
    './inject':{cancelAll:()=>events.push('cancel'),combo:()=>events.push('injected'),info:()=>({pending:0})},
    './store':{load:()=>({map:{'50':{type:'keys',keys:[91,72]}}}),save:()=>{},FILE:'mock'},
    './layout':{list:()=>[],SLOTS:[]},'./model':model,
    './latch':require('../src/latch'),'./stuck':require('../src/stuck'),
  };
  const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  vm.runInNewContext(source,{
    require:n=>{assert(n in modules,'unexpected dependency '+n);return modules[n];},
    __dirname:path.join(dir,'src'),process:fakeProcess,console:{log:()=>{}},URL,Buffer,
    setInterval:()=>0,clearInterval:()=>{},
    setTimeout:(fn,ms)=>{const id=setTimeout(fn,ms);timers.add(id);return id;},clearTimeout,
  });
  t.after(async()=>{
    for(const id of timers)clearTimeout(id);
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    fs.rmSync(dir,{recursive:true,force:true});
  });
  if(!server.listening)await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const post=route=>fetch(base+route,{method:'POST'});
  const request=()=>once(server,'request');
  return {post,request,raw,events,finishStop:()=>finishStop()};
}
test('capture survives completed HTTP request and resolves on physical key',async t=>{
  const f=await fixture(t);
  const received=f.request();
  const capture=f.post('/api/capture');
  await received;
  f.raw({hDevice:123n,usage:31,vkey:83,down:true});
  const response=await capture;assert.deepEqual((await response.json()).keys,[83]);
});
test('panic cancels injection immediately and replies only after worker stop',async t=>{
  const f=await fixture(t);let replied=false;
  const received=f.request();
  const pending=f.post('/api/panic').then(r=>{replied=true;return r;});
  await received;
  assert.deepEqual(f.events,['cancel']);assert.equal(replied,false);
  f.finishStop();const response=await pending;
  assert.equal(response.status,200);assert.equal((await response.json()).panic,true);
});
test('raw fallback observes remote keys without injecting a second action',async t=>{
  const f=await fixture(t);
  f.raw({hDevice:42n,usage:50,vkey:77,down:true});
  assert.deepEqual(f.events,[]);
});
