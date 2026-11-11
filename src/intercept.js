'use strict';
// 接管模式的对外封装：起一个 worker，把遥控器按键从驱动层截下来，
// 于是这些按键不会再到达任何窗口（不打出字），只交给我们处理。
const path = require('path');
const { Worker } = require('worker_threads');
const ffi = require('./interception-ffi');

let worker = null;
let state = {
  dll: false,
  active: false,
  reason: '',
  device: 0,
  hwid: '',
  keyboards: [],
  lastTick: 0,     // 上次心跳的时刻（见 intercept-worker.js 里的 tick）
};

let keyHandler = null;
let statusHandler = null;

function info() {
  const age = state.lastTick ? Date.now() - state.lastTick : -1;
  // stalled：接管线程还「号称」在跑，但已经 4 秒没有心跳 —— 多半卡在系统调用里了。
  // 这种情况下过滤器还挂在设备上却没人读报文，遥控器会整个失灵。
  return { ...state, dll: ffi.dllExists(), tickAge: age, stalled: state.active && age > 4000 };
}

function stop() {
  if (worker) {
    try { worker.terminate(); } catch {}
    worker = null;
  }
  state.active = false;
  state.lastTick = 0;
}

// onKey({code, down, e0, e1})
// onStatus('ready' | 'fail', payload)
// passthrough: 扫描码数组，这些键原样放行（action.type === 'native'）
function start(onKey, onStatus, passthrough) {
  if (worker) return true;
  if (!ffi.dllExists()) {
    state.reason = '缺少 native/interception.dll';
    return false;
  }

  keyHandler = onKey;
  statusHandler = onStatus;

  worker = new Worker(path.join(__dirname, 'intercept-worker.js'), {
    stdout: false,
    stderr: false,
    workerData: { passthrough: Array.isArray(passthrough) ? passthrough.slice() : [] },
  });

  const w = worker;
  // terminate() 是异步的：旧线程的 exit 事件可能在新线程已经 ready 之后才到。
  // 不加这层身份判断的话，旧线程的「退出」会把新线程判成「掉了」，于是来回重建
  // （日志里会出现「刚启用 → 线程掉了 → 再启用」的死循环）。
  const stale = () => worker !== w;

  let settled = false;
  const settle = (kind, payload) => {
    if (settled) return;
    settled = true;
    if (statusHandler) statusHandler(kind, payload || {});
  };

  w.on('message', m => {
    if (!m || !m.type || stale()) return;
    if (m.type === 'key') {
      if (keyHandler) {
        try { keyHandler(m); } catch (e) { /* 单个事件出错不影响接收 */ }
      }
      return;
    }
    if (m.type === 'tick') {
      state.lastTick = m.at || Date.now();
      return;
    }
    if (m.type === 'ready') {
      state.active = true;
      state.lastTick = Date.now();
      state.device = m.device;
      state.hwid = m.hwid;
      state.keyboards = m.keyboards || [];
      settle('ready', m);
      return;
    }
    if (m.type === 'unavailable') {
      state.active = false;
      state.reason = m.reason || m.code || '未知错误';
      settle('fail', { code: m.code, reason: state.reason });
      stop();
      return;
    }
    if (m.type === 'nokeyboard') {
      state.active = false;
      state.keyboards = m.keyboards || [];
      state.reason = '没有找到遥控器键盘设备';
      settle('fail', { code: 'NO_DEVICE', reason: state.reason, keyboards: state.keyboards });
      stop();
      return;
    }
    if (m.type === 'disarmed') {
      // 线程自己踩了刹车：设备号变了 or 检测到人在打字。过滤器已经撤掉，输入已还给系统。
      state.active = false;
      state.reason = m.reason || '已自动缴械';
      if (statusHandler) {
        try { statusHandler('disarmed', { reason: state.reason }); } catch {}
      }
      stop();
      return;
    }
    if (m.type === 'closed') {
      state.active = false;
      stop();
    }
  });

  w.on('error', e => {
    if (stale()) return;              // 旧线程的余波，忽略
    const wasReady = state.active;
    state.active = false;
    state.reason = String((e && e.message) || e);
    if (wasReady) {
      // 已经接管成功过，之后再出错必须照样上报。
      // 以前这里被 settle() 的一次性判断吃掉了：接管线程死了，主线程还以为是好的，
      // 于是遥控器彻底没反应，而且永远不会自己恢复。
      if (statusHandler) { try { statusHandler('lost', { reason: state.reason }); } catch {} }
    } else {
      settle('fail', { code: 'WORKER_ERROR', reason: state.reason });
    }
    stop();
  });

  w.on('exit', () => {
    if (stale()) return;              // stop() 主动终止的，不算掉线
    const wasReady = state.active;
    state.active = false;
    worker = null;
    if (wasReady) {
      if (statusHandler) { try { statusHandler('lost', { reason: state.reason || '接管线程已退出' }); } catch {} }
    } else {
      settle('fail', { code: 'WORKER_EXIT', reason: state.reason || '接管线程已退出' });
    }
  });

  return true;
}

module.exports = { start, stop, info, setPassthrough, dllExists: ffi.dllExists };

// 改键之后更新「原样放行」的集合（type === 'native' 的那些）
function setPassthrough(list) {
  if (!worker) return;
  try { worker.postMessage({ type: 'passthrough', set: Array.isArray(list) ? list : [] }); } catch {}
}
