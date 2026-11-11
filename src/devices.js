'use strict';
// 列出 Raw Input 设备（带真实句柄，可用于过滤事件来源）
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');

const GetRawInputDeviceList = user32.func('uint32 __stdcall GetRawInputDeviceList(void* p, _Inout_ uint32* pcb, uint32 cbSize)');
const GetRawInputDeviceInfoW = user32.func('int64 __stdcall GetRawInputDeviceInfoW(uint64 hDevice, uint32 cmd, void* pData, _Inout_ uint32* pcbSize)');

const RIDI_DEVICENAME = 0x20000007;

function list() {
  const pcb = [0];
  GetRawInputDeviceList(null, pcb, 16);
  const n = pcb[0];
  if (!n) return [];
  const buf = Buffer.alloc(n * 16);
  pcb[0] = n;
  GetRawInputDeviceList(buf, pcb, 16);
  const out = [];
  for (let i = 0; i < pcb[0]; i++) {
    const off = i * 16;
    const hDevice = buf.readBigUInt64LE(off);
    const type = buf.readUInt32LE(off + 8);
    const nameBuf = Buffer.alloc(2048);
    const sz = [1024];
    GetRawInputDeviceInfoW(hDevice, RIDI_DEVICENAME, nameBuf, sz);
    const name = sz[0] > 0
      ? nameBuf.subarray(0, sz[0] * 2).toString('utf16le').replace(/\0.*$/, '')
      : '';
    out.push({ hDevice, type, name });
  }
  return out;
}

// IPRC1000: VID 0A5C / PID 8502，设备名形如 ..._VID&00020a5c_PID&8502#...
const REMOTE_RE = /0a5c_PID&8502/i;

function findRemote() {
  return list().find(d => REMOTE_RE.test(d.name)) || null;
}

module.exports = { list, findRemote, REMOTE_RE };
