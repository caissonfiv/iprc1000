'use strict';
// 自测：用 SendInput 注入一次 'A'，验证 Raw Input 捕获链路是否通
const koffi = require('koffi');
const { start, stop } = require('../src/rawinput');

const user32 = koffi.load('user32.dll');
const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, void* pInputs, int cbSize)');

function keyInput(vk, flags) {
  const buf = Buffer.alloc(40);
  buf.writeUInt32LE(1, 0);        // INPUT_KEYBOARD
  buf.writeUInt16LE(vk, 8);       // wVk
  buf.writeUInt16LE(0, 10);       // wScan
  buf.writeUInt32LE(flags, 12);   // dwFlags
  buf.writeUInt32LE(0, 16);       // time
  buf.writeBigUInt64LE(0n, 24);   // dwExtraInfo
  return buf;
}

const events = [];
start(ev => {
  events.push(ev);
  console.log(`usage=0x${ev.usage.toString(16).padStart(2, '0')} vkey=0x${ev.vkey.toString(16).padStart(2, '0')} ${ev.down ? 'DOWN' : 'UP'} hDevice=${ev.hDevice}`);
});

setTimeout(() => {
  const before = events.length;
  const down = keyInput(0x41, 0);      // 'A'
  const up = keyInput(0x41, 0x0002);   // KEYEVENTF_KEYUP
  const n = SendInput(1, down, 40);
  SendInput(1, up, 40);
  console.log('SendInput 返回', n);
  setTimeout(() => {
    console.log(events.length > before ? '✅ Raw Input 链路正常（能看到注入事件）' : '❌ 未捕获到注入事件');
    stop();
    process.exit(0);
  }, 400);
}, 300);
