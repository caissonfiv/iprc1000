'use strict';
// 检查 Raw Input 设备列表里有没有这台遥控器
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');

const GetRawInputDeviceList = user32.func('uint32 __stdcall GetRawInputDeviceList(void* p, _Inout_ uint32* pcb, uint32 cbSize)');
const GetRawInputDeviceInfoW = user32.func('int64 __stdcall GetRawInputDeviceInfoW(uint64 hDevice, uint32 cmd, void* pData, _Inout_ uint32* pcbSize)');

const pcb = [0];
GetRawInputDeviceList(null, pcb, 16);
const n = pcb[0];
const list = Buffer.alloc(n * 16);
pcb[0] = n;
GetRawInputDeviceList(list, pcb, 16);

const RIDI_DEVICENAME = 0x20000007;
const names = [];
for (let i = 0; i < n; i++) {
  const off = i * 16;
  const hDevice = list.readBigUInt64LE(off);
  const type = list.readUInt32LE(off + 8);
  const buf = Buffer.alloc(1024);
  const sz = [512];
  const r = GetRawInputDeviceInfoW(hDevice, RIDI_DEVICENAME, buf, sz);
  let name = '';
  if (sz[0] > 0) name = buf.subarray(0, sz[0] * 2).toString('utf16le').replace(/\0.*$/, '');
  names.push({ type, hDevice, name });
}

const types = { 0: 'MOUSE', 1: 'KEYBOARD', 2: 'HID' };
console.log(`Raw Input 设备共 ${n} 个\n`);
for (const d of names) {
  const mark = /0a5c.*8502/i.test(d.name) ? '  <== IPRC1000 ★' : '';
  console.log(`[${types[d.type] || d.type}] ${d.name}${mark}`);
}
console.log('\n命中：', names.filter(d => /0a5c.*8502/i.test(d.name)).length, '个');
