'use strict';
// 回归测试：Interception 报文的方向判定（按下 / 抬起）
//
// 背景：2026-11-10 出现过「每个键按过一次就再也没反应」——
// ffi.load() 返回的对象里漏了 KEY_UP/KEY_E0/KEY_E1，
// 于是 `state & api.KEY_UP` 变成 `state & undefined` === 0，
// 「抬起」被永远判成「按下」，上层 held 集合只进不出，按键被当成自动重复吞掉。
// 这个脚本专门盯住这件事：常量在不在、四种 state 解得对不对。

const ffi = require('../src/interception-ffi');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name + (extra === undefined ? '' : '  →  ' + extra));
  }
}

const api = ffi.load();

console.log('① 常量必须挂在 load() 的返回值上（不是只在 module.exports 里）');
ok('api.KEY_UP 是数字 0x01', api.KEY_UP === 0x01, api.KEY_UP);
ok('api.KEY_E0 是数字 0x02', api.KEY_E0 === 0x02, api.KEY_E0);
ok('api.KEY_E1 是数字 0x04', api.KEY_E1 === 0x04, api.KEY_E1);

console.log('② 报文方向解析（和 intercept-worker.js 里的写法逐字一致）');
const decode = state => (state & api.KEY_UP) === 0;

ok('普通按下  state=0x00 → down=true ', decode(0x00) === true, decode(0x00));
ok('普通抬起  state=0x01 → down=false', decode(0x01) === false, decode(0x01));
ok('扩展键按下 state=0x02 → down=true ', decode(0x02) === true, decode(0x02));
ok('扩展键抬起 state=0x03 → down=false', decode(0x03) === false, decode(0x03));
ok('E1 键按下  state=0x04 → down=true ', decode(0x04) === true, decode(0x04));
ok('E1 键抬起  state=0x05 → down=false', decode(0x05) === false, decode(0x05));

console.log('③ E0 / E1 标志位');
const e0 = state => (state & api.KEY_E0) !== 0;
const e1 = state => (state & api.KEY_E1) !== 0;
ok('state=0x02 → 是 E0 键', e0(0x02) === true && e1(0x02) === false);
ok('state=0x04 → 是 E1 键', e0(0x04) === false && e1(0x04) === true);
ok('state=0x00 → 都不是  ', e0(0x00) === false && e1(0x00) === false);

console.log('④ 报文布局');
ok('STROKE_SIZE = 20（sizeof(InterceptionMouseStroke) 决定步长）', ffi.STROKE_SIZE === 20, ffi.STROKE_SIZE);
const buf = Buffer.alloc(ffi.STROKE_SIZE);
buf.writeUInt16LE(0x48, 0);   // 扫描码在偏移 0
buf.writeUInt16LE(0x01, 2);   // state 在偏移 2
ok('从偏移 0 读出扫描码 0x48', buf.readUInt16LE(0) === 0x48);
ok('从偏移 2 读出 state 0x01', buf.readUInt16LE(2) === 0x01);
ok('该报文被判为「抬起」', decode(buf.readUInt16LE(2)) === false);

console.log('');
if (fail) {
  console.log(`❌ ${fail} 项失败`);
  process.exit(1);
}
console.log('✅ 全部通过');
