'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createController } = require('../src/intercept-controller');
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const workers = [];
  class FakeWorker extends EventEmitter {
    constructor(data) { super(); this.data=data; this.messages=[]; this.terminated=false; workers.push(this); }
    postMessage(m) { this.messages.push(m); }
    terminate() { this.terminated=true; queueMicrotask(()=>this.emit('exit',1)); return Promise.resolve(1); }
  }
  const controller = createController({dllExists:()=>true,createWorker:data=>new FakeWorker(data),...options});
  return {controller,workers};
}
test('reentrant error recovery waits for old exit and cannot stop the replacement', async () => {
  const {controller:c,workers:w}=fixture();
  const status=kind=>{if(kind==='lost')c.start(()=>{},status,[]);};
  c.start(()=>{},status,[]); await flush(); w[0].emit('message',{type:'ready',device:7});
  w[0].emit('error',new Error('driver failed')); await flush();
  assert.equal(w.length,1); assert.equal(w[0].messages.at(-1).type,'stop');
  w[0].emit('exit',1); await flush(); assert.equal(w.length,2); assert.equal(w[1].terminated,false);
  w[1].emit('message',{type:'ready',device:8}); w[0].emit('error',new Error('stale'));
  assert.equal(c.info().active,true); assert.equal(c.info().device,8);
  const p=c.stop(); w[1].emit('exit',0); await p;
});
test('updates before spawn are seeded and later updates have acknowledgements', async () => {
  const {controller:c,workers:w}=fixture();
  c.start(()=>{},()=>{},[72]); c.setPassthrough([]); await flush();
  assert.deepEqual(w[0].data.passthrough,[]); assert.equal(w[0].data.version,2);
  w[0].emit('message',{type:'ready',version:2}); c.setPassthrough([28]);
  assert.equal(c.info().requestedVersion,3); assert.equal(c.info().appliedVersion,2);
  w[0].emit('message',{type:'configured',version:3}); assert.equal(c.info().appliedVersion,3);
  const p=c.stop(); w[0].emit('exit',0); await p;
});
test('panic during pending restart prevents spawning a replacement', async () => {
  const {controller:c,workers:w}=fixture();
  c.start(()=>{},()=>{},[]); await flush(); const p=c.stop();
  c.start(()=>{},()=>{},[]); c.stop(); w[0].emit('exit',0); await p; await flush();
  assert.equal(w.length,1); assert.equal(c.info().active,false);
});
test('stop has a forced termination fallback and still waits for exit', async () => {
  const {controller:c,workers:w}=fixture({stopTimeout:10});
  c.start(()=>{},()=>{},[]); await flush(); await c.stop();
  assert.equal(w[0].terminated,true); assert.equal(c.info().phase,'idle');
});
test('construction failure reports once and can be retried', async () => {
  let failures=0;
  const {controller:c}=fixture({createWorker:()=>{throw new Error('missing worker');}});
  c.start(()=>{},kind=>{assert.equal(kind,'fail');failures++;}); await flush();
  assert.equal(c.info().active,false); assert.equal(failures,1);
});
