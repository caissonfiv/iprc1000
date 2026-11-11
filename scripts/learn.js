'use strict';
// 学习模式：抓取遥控器每个按键的原始 HID usage，生成 out/learn.json
const fs = require('fs');
const path = require('path');
const { start, stop } = require('../src/rawinput');
const { findRemote } = require('../src/devices');

const USAGE_NAMES = (() => {
  const m = {
    0x00: 'None', 0x28: 'Enter', 0x29: 'Esc', 0x2a: 'Backspace', 0x2b: 'Tab', 0x2c: 'Space',
    0x39: 'CapsLock', 0x46: 'PrtSc', 0x48: 'Pause', 0x49: 'Insert', 0x4a: 'Home',
    0x4b: 'PageUp', 0x4c: 'Delete', 0x4d: 'End', 0x4e: 'PageDown',
    0x4f: 'Right', 0x50: 'Left', 0x51: 'Down', 0x52: 'Up',
    0x53: 'NumLock', 0x65: 'App/Menu', 0x66: 'Power', 0x67: '=',
    0x6f: 'BrightnessUp', 0x70: 'BrightnessDown', 0x74: 'Sleep',
    0x79: 'Rewind', 0x7a: 'FastForward', 0x7b: 'Stop', 0x7c: 'Eject', 0x7d: 'MediaPlay',
    0x7e: 'MediaPause', 0x81: 'VolDown', 0x82: 'VolUp', 0x83: 'Mute',
    0x8a: 'WWW', 0x94: 'Mute2', 0x9a: 'SysReq',
    0xb0: 'Play', 0xb1: 'Pause', 0xb2: 'Record', 0xb3: 'FF', 0xb4: 'Rewind2',
    0xb5: 'NextTrack', 0xb6: 'PrevTrack', 0xb7: 'Stop2',
    0xcd: 'PlayPause', 0xe0: 'LCtrl', 0xe1: 'LShift', 0xe2: 'LAlt', 0xe3: 'LGui',
    0xe4: 'RCtrl', 0xe5: 'RShift', 0xe6: 'RAlt', 0xe7: 'RGui',
  };
  for (let i = 0x04; i <= 0x1d; i++) m[i] = String.fromCharCode(0x41 + i - 0x04);
  for (let i = 0x1e; i <= 0x26; i++) m[i] = String(1 + i - 0x1e);
  m[0x27] = '0';
  for (let i = 0x3a; i <= 0x45; i++) m[i] = 'F' + (1 + i - 0x3a);
  return m;
})();

const nameOf = u => USAGE_NAMES[u] || `Usage_0x${u.toString(16).padStart(2, '0')}`;

const DURATION = Number(process.argv[2] || 90) * 1000;

const remote = findRemote();
if (!remote) {
  console.log('❌ 没找到 IPRC1000。请先按一下遥控器任意键把它唤醒，再重跑。');
  process.exit(1);
}
console.log(`设备: ${remote.name.split('#')[1] || remote.name}\n`);
console.log(`学习模式启动，${DURATION / 1000} 秒。请把遥控器上每个键都按一遍（语音键按住 3 秒再松）。\n`);
console.log('时间      用法码   虚拟键   方向   按键名');
console.log('--------  -------  -------  -----  ----------------');

const seen = new Map();
const t0 = Date.now();
const pressAt = new Map();

start(ev => {
  if (!ev.hDevice || ev.hDevice !== remote.hDevice) return;
  const u = ev.usage;
  const dur = ev.down ? null : (pressAt.has(u) ? Date.now() - pressAt.get(u) : null);
  if (ev.down) pressAt.set(u, Date.now());

  const rec = seen.get(u) || { usage: u, name: nameOf(u), counts: 0, maxHoldMs: 0, vkeys: new Set() };
  if (ev.down) rec.counts++;
  if (dur && dur > rec.maxHoldMs) rec.maxHoldMs = dur;
  rec.vkeys.add(ev.vkey);
  seen.set(u, rec);

  const t = ((Date.now() - t0) / 1000).toFixed(2).padStart(6);
  console.log(
    `${t}s   0x${u.toString(16).padStart(2, '0')}     0x${ev.vkey.toString(16).padStart(2, '0')}     ${ev.down ? '↓' : '↑'}     ${rec.name}`
  );
});

setTimeout(() => {
  stop();
  const list = [...seen.values()]
    .sort((a, b) => a.usage - b.usage)
    .map(r => ({
      usage: r.usage,
      hex: '0x' + r.usage.toString(16).padStart(2, '0'),
      name: r.name,
      counts: r.counts,
      maxHoldMs: r.maxHoldMs,
      vkeys: [...r.vkeys].map(v => '0x' + v.toString(16).padStart(2, '0')),
    }));
  fs.mkdirSync(path.join(__dirname, '..', 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'out', 'learn.json'), JSON.stringify(list, null, 2));
  console.log(`\n共抓到 ${list.length} 个不同按键，已写入 out/learn.json`);
  process.exit(0);
}, DURATION);
