'use strict';
// 诊断：窗口消息泵是否活着 + Raw Input 设备列表
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const CreateWindowExW = user32.func('void* __stdcall CreateWindowExW(uint32, str16, str16, uint32, int, int, int, int, void*, void*, void*, void*)');
const PeekMessageW = user32.func('bool __stdcall PeekMessageW(void* lpMsg, void* hWnd, uint32 a, uint32 b, uint32 c)');
const PostMessageW = user32.func('bool __stdcall PostMessageW(void* hWnd, uint32 Msg, uint64 wParam, int64 lParam)');
const RegisterRawInputDevices = user32.func('bool __stdcall RegisterRawInputDevices(void* p, uint32 n, uint32 cb)');
const GetRawInputDeviceList = user32.func('uint32 __stdcall GetRawInputDeviceList(void* p, _Inout_ uint32* pcb, uint32 cbSize)');
const GetModuleHandleW = kernel32.func('void* __stdcall GetModuleHandleW(str16)');
const GetLastError = kernel32.func('uint32 __stdcall GetLastError()');

const hInst = GetModuleHandleW(null);
const HWND_MESSAGE = -3n;
const hwnd = CreateWindowExW(0x00000000, 'STATIC', 'diag', 0x80000000, 0, 0, 0, 0, HWND_MESSAGE, null, hInst, null);
console.log('hwnd =', hwnd, 'addr nul?', koffi.address(hwnd) === 0n, 'err=', GetLastError());

const dev = Buffer.alloc(16);
dev.writeUInt16LE(0x01, 0); dev.writeUInt16LE(0x06, 2);
dev.writeUInt32LE(0x00000100 | 0x00002000, 4);
dev.writeBigUInt64LE(koffi.address(hwnd), 8);
console.log('RegisterRawInputDevices =', RegisterRawInputDevices(dev, 1, 16), 'err=', GetLastError());

const pcb = [0];
const cnt = GetRawInputDeviceList(null, pcb, 16);
console.log('RawInput 设备数 =', pcb[0], '(cbSize/elem=16, 返回值', cnt, ')');

console.log('PostMessage =', PostMessageW(hwnd, 0x0400 + 1, 0n, 0n), 'err=', GetLastError());

const msg = Buffer.alloc(64);
let hit = false;
for (let i = 0; i < 50; i++) {
  if (PeekMessageW(msg, null, 0, 0, 1)) {
    console.log('PeekMessage 拿到消息 id=0x' + msg.readUInt32LE(8).toString(16));
    hit = true;
    break;
  }
}
console.log(hit ? '✅ 消息泵工作正常' : '❌ 消息泵没拿到消息');
