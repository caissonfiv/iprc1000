'use strict';
// 输入诊断：把所有设备的原始事件都打出来，用来定位"按了没反应"卡在哪一层
const { start, stop, stats } = require('../src/rawinput');
const { list } = require('../src/devices');

const names = new Map();
for (const d of list()) names.set(d.hDevice.toString(), d.name);

function nameOf(h) {
  if (h === null) return '(注入/未知)';
  const key = h.toString();
  if (names.has(key)) {
    const n = names.get(key);
    const m = n.match(/#(.*?)#/);
    return m ? m[1] : n;
  }
  return '0x' + key;
}

const t0 = Date.now();
console.log('=== 输入诊断 ===');
console.log('1) 按几下遥控器方向键');
console.log('2) 在电脑键盘上打几个字');
console.log('3) 晃一下鼠标');
console.log('（全部试完按 Ctrl+C 结束）\n');

const last = new Map();

start(ev => {
  const t = ((Date.now() - t0) / 1000).toFixed(1);
  const dev = nameOf(ev.hDevice);
  const short = dev.length > 34 ? dev.slice(0, 34) + '…' : dev;
  const k = `${dev}|${ev.usage}|${ev.down}`;
  if (last.has(k)) return; // 去抖，同行重复不刷屏
  last.set(k, 1);
  console.log(`[${t}s] ${ev.down ? '↓' : '↑'} usage=0x${ev.usage.toString(16).padStart(2, '0')} vkey=0x${ev.vkey.toString(16).padStart(2, '0')} ← ${short}`);
}, 5, () => console.log('*** 设备变化 ***'));

let prev = { messages: 0, wmInput: 0, inputs: 0 };
setInterval(() => {
  const dm = stats.messages - prev.messages;
  const dw = stats.wmInput - prev.wmInput;
  const di = stats.inputs - prev.inputs;
  prev = { messages: stats.messages, wmInput: stats.wmInput, inputs: stats.inputs };
  if (dm || dw || di) {
    console.log(`   心跳: 消息 +${dm}  WM_INPUT到达 +${dw}  解析成功 +${di}  (累计 ${stats.messages}/${stats.wmInput}/${stats.inputs})`);
  }
}, 2000);

setInterval(() => {}, 1000);

process.on('SIGINT', () => {
  console.log(`\n累计: 消息 ${stats.messages} 条, WM_INPUT ${stats.inputs} 条, 设备变化 ${stats.devChanges} 次`);
  stop();
  process.exit(0);
});
