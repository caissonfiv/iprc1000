'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {SCAN_CODES,defaultKeymap}=require('../src/device-profile');

test('measured profile has 22 distinct scan codes and safe actions',()=>{
  const cfg=defaultKeymap();
  assert.equal(Object.keys(SCAN_CODES).length,22); assert.equal(new Set(Object.values(SCAN_CODES)).size,22);
  for(const slot of ['up','down','left','right','ok'])assert.equal(cfg.map[SCAN_CODES[slot]].type,'native');
  for(const slot of ['mic','info','me','fav','pwr'])assert.equal(cfg.map[SCAN_CODES[slot]].type,'none');
  cfg.map[SCAN_CODES.up].type='none'; assert.equal(defaultKeymap().map[SCAN_CODES.up].type,'native');
});
test('fresh configuration, existing empty map, corrupt backup and persistence',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'iprc-test-'));
  const previous=process.env.IPRC_DATA; process.env.IPRC_DATA=dir;
  try{
    const store=require('../src/store');
    assert.equal(Object.keys(store.load().map).length,22);
    store.save({version:1,map:{}}); assert.deepEqual(store.load().map,{});
    fs.writeFileSync(store.FILE,'broken json'); assert.equal(Object.keys(store.load().map).length,22);
    assert(fs.readdirSync(dir).some(n=>n.startsWith('keymap.json.corrupt-')));
    const layout=require('../src/layout'); assert.equal(layout.list().filter(s=>s.usage!==null).length,22);
    layout.set('up',null); layout.rename('mic','我的话筒'); layout.load();
    assert.equal(layout.usageOf('up'),null); assert.equal(layout.list().find(s=>s.id==='mic').name,'我的话筒');
    store.save({version:1,map:{'50':{type:'keys',keys:[91,72]}}});
    assert.deepEqual(store.load().map['50'].keys,[91,72]);
  }finally{
    if(previous===undefined)delete process.env.IPRC_DATA;else process.env.IPRC_DATA=previous;
    // Only remove the exact temporary directory allocated by this test.
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
