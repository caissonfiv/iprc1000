'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs/promises');
const {defaults,encodePolicy,validatePolicy}=require('../src/driver-policy');
const {DriverClient}=require('../src/driver-client');
const {createDriverServer}=require('../src/driver-app');
test('driver binary policy has exact ABI layout and rejects unsafe or unsupported rules',()=>{
  const p=defaults(1);p.rules[33]={type:2,code:1,flags:0};const b=encodePolicy(p);
  assert.equal(b.length,2064);assert.equal(b.readUInt32LE(4),1);assert.equal(b.readUInt32LE(8),1);
  assert.equal(b.readUInt16LE(16+33*8),2);assert.equal(b.readUInt16LE(18+33*8),1);
  p.rules[0x17]={type:1,code:0,flags:0};assert.throws(()=>encodePolicy(p),/幽灵键/);
  p.rules[0x17]={type:0,code:0,flags:0};p.rules[33].flags=4;assert.throws(()=>encodePolicy(p),/单键/);
});
test('client serializes read/modify/write, preserves other rules and removes temporary files',async()=>{
  let state={...defaults(1),connected:1};const files=[];let active=0,max=0;
  const client=new DriverClient('unused',async args=>{
    active++;max=Math.max(max,active);
    try {
      await new Promise(r=>setTimeout(r,5));
      if(args[0]==='snapshot')return JSON.stringify(state);
      files.push(args[1]);const b=await fs.readFile(args[1]);
      state={...state,mode:b.readUInt32LE(8),rules:state.rules.map((r,i)=>({type:b.readUInt16LE(16+i*8),code:b.readUInt16LE(18+i*8),flags:b.readUInt16LE(20+i*8)}))};
      return 'applied';
    }finally{active--;}
  });
  await Promise.all([client.update(p=>{p.rules[33]={type:2,code:1,flags:0};return p;}),client.update(p=>{p.mode=0;return p;},true)]);
  assert.equal(max,1);assert.equal(state.mode,0);assert.equal(state.rules[33].code,1);
  for(const file of files)await assert.rejects(fs.access(file));
});
test('failed driver write rejects and cleans its temporary policy',async()=>{
  let file;
  const client=new DriverClient('unused',async args=>{
    if(args[0]==='snapshot')return JSON.stringify(defaults());
    file=args[1];throw new Error('write failed');
  });
  await assert.rejects(client.update(p=>p,true),/write failed/);await assert.rejects(fs.access(file));
});
test('HTTP UI reads live rules, protects writes, preserves mappings on resume, persists explicitly',async t=>{
  let state={...defaults(1),connected:1},writes=0,saved=false;
  const client={snapshot:async()=>structuredClone(state),update:async(edit,persist)=>{writes++;state=edit(structuredClone(state));validatePolicy(state);saved=persist;return state;}};
  const server=createDriverServer(client,{diagnostic:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;
  const html=await fetch(base).then(r=>r.text());const token=html.match(/window.IPRC_TOKEN='([^']+)'/)[1];
  const get=()=>fetch(base+'/api/app').then(r=>r.json());
  const post=(url,data,secret=token)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-IPRC-Token':secret},body:JSON.stringify(data)});
  assert.equal((await get()).slots.length,22);assert.equal(writes,0);
  assert.equal((await post('/api/mode',{mode:0},'bad')).status,403);assert.equal(writes,0);
  assert.equal((await post('/api/action',{usage:33,rule:{type:2,code:1,flags:0}})).status,200);
  assert.equal(saved,false);assert.equal(state.rules[33].code,1);
  await post('/api/panic',{});assert.equal(state.mode,0);await post('/api/mode',{mode:1});
  assert.equal(state.rules[33].code,1);assert.equal(state.mode,1);
  const before=writes;
  assert.equal((await post('/api/action',{usage:33,rule:{type:'combo',keys:[91,72]}})).status,400);
  assert.equal((await post('/api/action',{usage:23,rule:{type:1,code:0,flags:0}})).status,400);
  assert.equal(writes,before);
  await post('/api/persist',{persist:true});assert.equal(saved,true);
});
test('disconnected UI reports an error without fabricating defaults or writing to device',async t=>{
  const server=createDriverServer({snapshot:async()=>{throw new Error('offline');},update:()=>assert.fail('write attempted')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const data=await fetch('http://127.0.0.1:'+server.address().port+'/api/app').then(r=>r.json());
  assert.equal(data.state,null);assert.equal(data.error,'offline');
});
