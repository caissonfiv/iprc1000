'use strict';
// Raw Input 捕获：绕过 kbdhid 的用法码映射，拿到遥控器每个键的原始 HID usage
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const CreateWindowExW = user32.func('void* __stdcall CreateWindowExW(uint32 dwExStyle, str16 lpClassName, str16 lpWindowName, uint32 dwStyle, int X, int Y, int nWidth, int nHeight, void* hWndParent, void* hMenu, void* hInstance, void* lpParam)');
const RegisterRawInputDevices = user32.func('bool __stdcall RegisterRawInputDevices(void* pRawInputDevices, uint32 uiNumDevices, uint32 cbSize)');
const GetRawInputData = user32.func('uint32 __stdcall GetRawInputData(uint64 hRawInput, uint32 uiCommand, void* pData, _Inout_ uint32* pcbSize, uint32 cbSizeHeader)');
const PeekMessageW = user32.func('bool __stdcall PeekMessageW(void* lpMsg, void* hWnd, uint32 wMsgFilterMin, uint32 wMsgFilterMax, uint32 wRemoveMsg)');
const GetModuleHandleW = kernel32.func('void* __stdcall GetModuleHandleW(str16 lpModuleName)');
const GetLastError = kernel32.func('uint32 __stdcall GetLastError()');

const HWND_MESSAGE = -3n;
const WM_INPUT = 0x00FF;
const WM_INPUT_DEVICE_CHANGE = 0x00FE;
const RID_INPUT = 0x10000003;
const RIDEV_INPUTSINK = 0x00000100;
const RIDEV_DEVNOTIFY = 0x00002000;
const PM_REMOVE = 0x0001;

let hwnd = null;
let running = false;
let timer = null;
const msgBuf = Buffer.alloc(64);
const rawHdrSize = 24;
let rawBuf = Buffer.alloc(1024);

function createMessageWindow() {
  const hInst = GetModuleHandleW(null);
  // 用真正的顶层隐藏窗口（WS_POPUP，不 ShowWindow）。
  // message-only 窗口(HWND_MESSAGE) 收不到 WM_INPUT，必须用普通窗口。
  const WS_POPUP = 0x80000000;
  const h = CreateWindowExW(0, 'STATIC', 'iprc-rawinput', WS_POPUP, 0, 0, 1, 1,
    null, null, hInst, null);
  if (!h || koffi.address(h) === 0n) {
    throw new Error('CreateWindowExW 失败 err=' + GetLastError());
  }
  return h;
}

function register(h) {
  // RAWINPUTDEVICE { USHORT usUsagePage; USHORT usUsage; DWORD dwFlags; HWND hwndTarget; }
  const dev = Buffer.alloc(16);
  dev.writeUInt16LE(0x01, 0);      // Generic Desktop
  dev.writeUInt16LE(0x06, 2);      // Keyboard
  dev.writeUInt32LE(RIDEV_INPUTSINK | RIDEV_DEVNOTIFY, 4);
  dev.writeBigUInt64LE(koffi.address(h), 8);
  const ok = RegisterRawInputDevices(dev, 1, 16);
  if (!ok) throw new Error('RegisterRawInputDevices 失败 err=' + GetLastError());
}

function parse(raw) {
  const dwType = raw.readUInt32LE(0);
  const hDevice = raw.readBigUInt64LE(8);
  if (dwType !== 1) return null; // RIM_TYPEKEYBOARD
  const makeCode = raw.readUInt16LE(24);
  const flags = raw.readUInt16LE(26);
  const vkey = raw.readUInt16LE(30);
  const message = raw.readUInt32LE(32);
  const extra = raw.readUInt32LE(36);
  const isBreak = (flags & 0x01) !== 0;
  const isE0 = (flags & 0x02) !== 0;
  return {
    hDevice: hDevice === 0n ? null : hDevice,
    usage: makeCode,      // HID usage ID（部分机型为扫描码）
    vkey,
    message,
    extra,
    down: !isBreak,
    e0: isE0,
  };
}

const stats = { messages: 0, wmInput: 0, inputs: 0, devChanges: 0 };

function pump(onEvent, onDeviceChange) {
  const got = [];
  while (PeekMessageW(msgBuf, null, 0, 0, PM_REMOVE)) {
    stats.messages++;
    const msgId = msgBuf.readUInt32LE(8);
    if (msgId === WM_INPUT_DEVICE_CHANGE) { stats.devChanges++; if (onDeviceChange) onDeviceChange(); continue; }
    if (msgId !== WM_INPUT) continue;
    stats.wmInput++;
    // MSG(x64): hwnd@0(8) message@8(4) wParam@16(8) lParam@24(8)
    // WM_INPUT 的 raw input 句柄在 lParam，不是 wParam！
    const hRawInput = msgBuf.readBigUInt64LE(24);
    const size = [rawBuf.length];
    const n = GetRawInputData(hRawInput, RID_INPUT, rawBuf, size, rawHdrSize);
    if (n === 0xFFFFFFFF) continue;
    stats.inputs++;
    const ev = parse(rawBuf.subarray(0, n));
    if (ev) got.push(ev);
  }
  for (const e of got) onEvent(e);
}

function start(onEvent, intervalMs = 2, onDeviceChange = null) {
  if (running) return hwnd;
  hwnd = createMessageWindow();
  register(hwnd);
  running = true;
  timer = setInterval(() => pump(onEvent, onDeviceChange), intervalMs);
  return hwnd;
}

function stop() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, stats, get hwnd() { return hwnd; } };

if (require.main === module) {
  const t0 = Date.now();
  console.log('Raw Input 捕获中，20 秒… 按遥控器任意键');
  const seen = new Map();
  const h = start(ev => {
    const k = `${ev.down ? 'D' : 'U'}:${ev.usage}:${ev.vkey}`;
    if (!seen.has(k)) {
      seen.set(k, 1);
      console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s] usage=0x${ev.usage.toString(16).padStart(2, '0')} vkey=0x${ev.vkey.toString(16).padStart(2, '0')} ${ev.down ? 'DOWN' : 'UP'}`);
    }
  });
  console.log('HWND =', h);
  setTimeout(() => { stop(); process.exit(0); }, 20000);
}
