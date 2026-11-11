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
// 组合键相邻两步之间的间隔。太短外壳会把几个事件并成同一拍（Win 键卡住的根源），
// 太长又会让遥控器手感发闷。10ms 和真键盘的报文间隔接近。
const COMBO_GAP_MS = 10;

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
  return SendInput(inputs.length, buf, INPUT_SIZE);
}

function keyDown(vk) { return send([buildKey(vk, false)]); }
function keyUp(vk) { return send([buildKey(vk, true)]); }

// 把组合键展开成「带时间偏移的动作序列」。
// 纯函数，单独抽出来是为了能单测 —— 这里的顺序一旦错，
// 表现就是 Win 卡在按下状态、全系统快捷键失灵（用户看到的就是「卡死」）。
function comboPlan(vks, gap) {
  const g = gap || COMBO_GAP_MS;
  const list = (vks || []).filter(v => v > 0);
  const plan = [];
  let delay = 0;
  for (const vk of list) { plan.push({ vk, down: true, at: delay }); delay += g; }
  for (let i = list.length - 1; i >= 0; i--) { plan.push({ vk: list[i], down: false, at: delay }); delay += g; }
  // 收尾保险：再补一遍抬起。对已经松开的键重复发 key-up 是无害的，
  // 但万一上面某一步被系统吞了，这一下就能把卡住的 Win/Ctrl 救回来。
  for (const vk of list) plan.push({ vk, down: false, at: delay + 40, safety: true });
  return plan;
}

// 组合键：修饰键依次按下 → 主键按下 → 主键抬起 → 修饰键逆序抬起
//
// ⚠️ 不要一口气塞进同一个 SendInput 调用。Windows 外壳的 Win 键状态机是按「拍」
//    处理的，四个事件挤在同一个批次里时，它可能把「Win 按下+抬起」当成同一拍，
//    结果 Win 卡在按下状态：所有快捷键失灵、开始菜单乱弹，用户看到的就是「卡死」。
//    真键盘是每隔几毫秒发一份 HID 报文，这里照做 —— 分开发、每步 10ms。
function combo(vks) {
  for (const step of comboPlan(vks)) {
    setTimeout(() => {
      try { step.down ? keyDown(step.vk) : keyUp(step.vk); } catch {}
    }, step.at);
  }
}

function hold(vks) {
  for (const vk of vks.filter(v => v > 0)) keyDown(vk);
}

function release(vks) {
  const list = vks.filter(v => v > 0).reverse();
  for (const vk of list) keyUp(vk);
}

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
  if (!setClipboard(text)) { typeText(text); return; }
  setTimeout(() => combo([0x11, 0x56]), 20); // Ctrl+V
}

module.exports = { send, keyDown, keyUp, combo, comboPlan, hold, release, typeText, pasteText, setClipboard };
