'use strict';
// Interception 驱动 API 的 FFI 封装
// 签名全部对照官方 interception.h：
//   InterceptionContext                 -> void*   （这里用 uint64 承接，避免 koffi 指针转换坑）
//   InterceptionKeyStroke { u16 code; u16 state; u32 information; }
//   InterceptionStroke = char[sizeof(InterceptionMouseStroke)]
// 注意：sizeof(InterceptionMouseStroke) = 20（u16,u16,short 之后 int 要 4 字节对齐，
//       中间补 2 字节），所以报文数组的步长是 20 字节，不是 8！
const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

const DLL_PATH = path.join(__dirname, '..', 'native', 'interception.dll');

const STROKE_SIZE = 20;
const MAX_DEVICE = 20;

const FILTER_KEY_ALL = 0xffff;

const KEY_UP = 0x01;
const KEY_E0 = 0x02;
const KEY_E1 = 0x04;

function dllExists() {
  return fs.existsSync(DLL_PATH);
}

function load() {
  if (!dllExists()) {
    const e = new Error('缺少 native/interception.dll');
    e.code = 'NO_DLL';
    throw e;
  }
  const lib = koffi.load(DLL_PATH);
  return {
    koffi,
    STROKE_SIZE,
    FILTER_KEY_ALL,
    // ⚠️ 这三个必须一起返回！漏掉的话 worker 里 `state & api.KEY_UP`
    //    会变成 `state & undefined` = 0，于是「按下」和「抬起」都被判成按下，
    //    上层 held 集合只进不出，表现就是「每个键按过一次就再也没反应」。
    KEY_UP,
    KEY_E0,
    KEY_E1,
    create: lib.func('uint64 interception_create_context()'),
    destroy: lib.func('void interception_destroy_context(uint64 ctx)'),
    isKeyboard: lib.func('int interception_is_keyboard(int device)'),
    isInvalid: lib.func('int interception_is_invalid(int device)'),
    getHwId: lib.func('unsigned int interception_get_hardware_id(uint64 ctx, int device, void* buffer, unsigned int size)'),
    setFilter: lib.func('void interception_set_filter(uint64 ctx, void* predicate, unsigned short filter)'),
    wait: lib.func('int interception_wait(uint64 ctx)'),
    // 带超时的等待：没有它，线程会一直堵在这里，看门狗定时器根本没机会跑
    waitTimeout: lib.func('int interception_wait_with_timeout(uint64 ctx, uint32 ms)'),
    receive: lib.func('int interception_receive(uint64 ctx, int device, void* stroke, unsigned int nstroke)'),
    send: lib.func('int interception_send(uint64 ctx, int device, void* stroke, unsigned int nstroke)'),
  };
}

// 读某设备的硬件 ID（UTF-16LE 宽字符串）
function hardwareId(api, ctx, device) {
  const buf = Buffer.alloc(1024);
  const n = api.getHwId(ctx, device, buf, buf.length);
  if (!n) return '';
  // 截到第一个 UTF-16 的 NUL
  let end = 0;
  for (let i = 0; i + 1 < Math.min(n, buf.length); i += 2) {
    if (buf.readUInt16LE(i) === 0) break;
    end = i + 2;
  }
  return buf.toString('utf16le', 0, end).replace(/\u0000/g, '').trim();
}

// 枚举所有键盘设备
function listKeyboards(api, ctx) {
  const out = [];
  for (let d = 1; d <= MAX_DEVICE; d++) {
    try {
      if (!api.isKeyboard(d)) continue;
      out.push({ device: d, hwid: hardwareId(api, ctx, d) });
    } catch { /* 单个设备读失败不影响其他 */ }
  }
  return out;
}

// 遥控器的硬件 ID 特征：Broadcom 的 VID 0A5C + PID 8502。
// 必须「VID 位是 0A5C」且「PID 位是 8502」两个条件同时成立 ——
// 以前用的 /0A5C|8502/ 是「或」，任何串号里带 8502 的设备都会被当成遥控器，
// 一旦误判就会把用户的真实键盘整个吞掉。
const REMOTE_VID = /VID[&_]0*2?0a5c/i;   // VID&00020a5c（蓝牙 HID） / VID_0A5C（USB）
const REMOTE_PID = /PID[&_]8502/i;
const REMOTE_RE = REMOTE_VID;            // 兼容旧引用

function isRemoteHwid(hw) {
  const s = String(hw || '');
  return REMOTE_VID.test(s) && REMOTE_PID.test(s);
}

function findRemoteKeyboard(api, ctx) {
  const list = listKeyboards(api, ctx);
  const hit = list.find(x => isRemoteHwid(x.hwid));
  return { list, hit: hit || null };
}

// ---- 回调（过滤谓词）----
// koffi 不接受 'int(*)(int)' 这类内联写法（会报
// "Unexpected character '(' in type specifier"），
// 必须先 koffi.proto 声明一个具名类型，再取它的指针。
// 同一进程内 proto 名字不能重复注册，所以缓存起来。
let predProto = null;

function makePredicate(api, fn) {
  if (!predProto) {
    predProto = api.koffi.proto('int InterceptionPredicate(int device)');
  }
  return api.koffi.register(fn, api.koffi.pointer(predProto));
}

module.exports = {
  DLL_PATH, STROKE_SIZE, MAX_DEVICE, FILTER_KEY_ALL, KEY_UP, KEY_E0, KEY_E1,
  dllExists, load, hardwareId, listKeyboards, findRemoteKeyboard, isRemoteHwid, makePredicate, REMOTE_RE,
};
