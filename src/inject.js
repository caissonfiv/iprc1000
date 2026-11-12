'use strict';
// 按键注入：SendInput（支持组合键、单键、按住/松开、剪贴板粘贴文本）
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, void* pInputs, int cbSize)');
const OpenClipboard = user32.func('bool __stdcall OpenClipboard(void* hWndNewOwner)');
const EmptyClipboard = user32.func('bool __stdcall EmptyClipboard()');
const CloseClipboard = user32.func('bool __stdcall CloseClipboard()');
const SetClipboardData = user32.func('void* __stdcall SetClipboardData(uint32 uFormat, void* hMem)');
const GlobalAlloc = kernel32.func('void* __stdcall GlobalAlloc(uint32 uFlags, uint64 dwBytes)');
const GlobalLock = kernel32.func('void* __stdcall GlobalLock(void* hMem)');
const GlobalUnlock = kernel32.func('bool __stdcall GlobalUnlock(void* hMem)');
const RtlMoveMemory = kernel32.func('void __stdcall RtlMoveMemory(void* dest, void* src, uint64 len)');

const INPUT_SIZE = 40;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;
const { comboPlan } = require('./combo-plan');
const { InputQueue } = require('./input-queue');

function buildKey(vk, up, unicode = 0, scan = 0) {
  const b = Buffer.alloc(INPUT_SIZE);
  b.writeUInt32LE(1, 0);
  b.writeUInt16LE(unicode ? 0 : vk, 8);
  b.writeUInt16LE(scan, 10);
  b.writeUInt32LE((up ? KEYEVENTF_KEYUP : 0) | (unicode ? KEYEVENTF_UNICODE : 0), 12);
  return b;
}

function send(inputs) {
  if (!inputs.length) return 0;
  const buf = Buffer.concat(inputs);
  const count = SendInput(inputs.length, buf, INPUT_SIZE);
  if (count !== inputs.length) throw new Error('SendInput 未完整注入（可能受权限隔离限制）: ' + count + '/' + inputs.length);
  return count;
}

function keyDown(vk) { return send([buildKey(vk, false)]); }
function keyUp(vk) { return send([buildKey(vk, true)]); }

const queue = new InputQueue({
  down: keyDown, up: keyUp,
  onError: error => console.error('[input]', error.message),
});
function combo(vks) { queue.enqueue(comboPlan(vks)); }
function hold(vks) { queue.hold(vks.filter(v => v > 0)); }
function release(vks) { queue.releaseHold(vks.filter(v => v > 0)); }
function cancelAll() { queue.cancel(); }

// 逐字符 Unicode 注入（纯 ASCII 可靠；中文建议走 pasteText）
function typeText(text) {
  const seq = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) continue;
    seq.push(buildKey(0, false, 1, code));
    seq.push(buildKey(0, true, 1, code));
  }
  send(seq);
}

const CF_UNICODETEXT = 13;
const GMEM_MOVEABLE = 0x0002;

function setClipboard(text) {
  const buf = Buffer.from(text + '\0', 'utf16le');
  if (!OpenClipboard(null)) return false;
  try {
    EmptyClipboard();
    const h = GlobalAlloc(GMEM_MOVEABLE, buf.length);
    if (!h || koffi.address(h) === 0n) return false;
    const p = GlobalLock(h);
    if (!p) return false;
    RtlMoveMemory(p, buf, buf.length);
    GlobalUnlock(h);
    SetClipboardData(CF_UNICODETEXT, h);
    return true;
  } finally {
    CloseClipboard();
  }
}

// 中文/多行文本：写剪贴板 + Ctrl+V
function pasteText(text) {
  // Clipboard mutation belongs to the same serial task as its Ctrl+V.
  queue.enqueue([
    { at: 0, run: () => {
      if (!setClipboard(text)) throw new Error('剪贴板当前不可写，已取消粘贴');
    } },
    ...comboPlan([0x11, 0x56]).map(step => ({ ...step, at: step.at + 20 })),
  ]);
}

module.exports = { send, keyDown, keyUp, combo, comboPlan, hold, release, cancelAll,
  typeText, pasteText, setClipboard, info: () => queue.info() };
