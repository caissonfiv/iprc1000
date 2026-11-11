'use strict';
// IPRC1000 按键映射主程序
const http = require('http');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const { spawn } = require('child_process');
const { start, stop } = require('./rawinput');
const { findRemote } = require('./devices');
const hid = require('./hidsource');
const intercept = require('./intercept');
const store = require('./store');
const layout = require('./layout');
const inject = require('./inject');
const model = require('./model');

const PORT = Number(process.env.PORT || 7788);

const OUT_DIR = path.join(__dirname, '..', 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });
const logStream = fs.createWriteStream(path.join(OUT_DIR, 'app.log'), { flags: 'a' });

let cfg = store.load();
let remote = findRemote();
const seen = new Map();          // usage -> { usage, count, lastVk }
const { PressLatch } = require('./latch');
const latch = new PressLatch();  // 「这个键还按着吗」：抑制重复上报（见 src/latch.js）
const activeVoice = new Map();   // usage -> keys
const voiceAt = new Map();       // usage -> 按下时刻
const sseClients = new Set();

let capture = null;              // { mods:Set } 录制中
let captureResolve = null;
let learnSlot = null;            // 「请按一下遥控器上的这个键」——等待绑定的坑位

// 统一收尾：无论按键命中、面板取消、请求断开还是 20 秒超时，都从这里出去。
// 之前漏了「面板取消」和「请求断开」，capture 会一直挂着，
// 之后每一次按键都被当成录制吃掉 —— 既不打字也不派发，看起来就像「录不了」。
function finishCapture(keys) {
  const done = captureResolve;
  capture = null;
  captureResolve = null;
  if (done) {
    try { done(keys || []); } catch { /* 已经断开 */ }
  }
}

// ---- 幽灵键过滤 ----
// 实测：遥控器固件在几乎每一次真实按键之后 18~40ms，都会补发一个 0x17
// （vkey 0x49，会打出字母 i）。它没有对应的物理按键，必须丢掉，否则会误触发。
// 若真实按键本身恰好是 0x17，则它出现在窗口外，照常放行。
// 注：下限原来写 60ms，是按早先「80~400ms」的错误观测定的，结果幽灵键一次都没被拦住；
// 照真实日志改成 8ms。
const PHANTOM_KEY = 0x17;
const PHANTOM_MIN_MS = 8;
const PHANTOM_MAX_MS = 500;
let lastRealDownAt = 0;
let phantomDropped = 0;
let phantomPending = 0;          // 已判定为幽灵、等着配对抬起的数量

function isPhantom(usage, ev) {
  if (cfg.filterPhantom === false) return false;
  if (usage !== PHANTOM_KEY) return false;
  if (ev.down) {
    const dt = Date.now() - lastRealDownAt;
    if (dt >= PHANTOM_MIN_MS && dt <= PHANTOM_MAX_MS) {
      phantomPending++;
      return true;
    }
    return false;
  }
  if (phantomPending > 0) { phantomPending--; return true; }
  return false;
}

const log = (...a) => {
  const line = a.join(' ');
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  try { console.log(stamp, line); } catch { /* 管道被关掉时忽略 */ }
  try { logStream.write(`${new Date().toISOString()}\t${line}\n`); } catch { /* ignore */ }
};

// 终端被关掉/管道断开时不要抛 EPIPE
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

// 把抓到的按键落盘，便于离线分析
let persistTimer = null;
function persistSeen() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const out = path.join(__dirname, '..', 'out');
      fs.mkdirSync(out, { recursive: true });
      const list = [...seen.values()]
        .sort((a, b) => a.usage - b.usage)
        .map(r => ({
          usage: r.usage,
          hex: '0x' + r.usage.toString(16).padStart(2, '0'),
          vkey: r.vkey,
          count: r.count,
        }));
      fs.writeFileSync(path.join(out, 'seen.json'), JSON.stringify(list, null, 2));
    } catch (e) { /* ignore */ }
  }, 400);
}

function broadcast(payload) {
  const line = 'data: ' + JSON.stringify(payload) + '\n\n';
  for (const res of sseClients) { try { res.write(line); } catch { sseClients.delete(res); } }
}

let present = false;   // 设备是否在线（Raw Input 或 直读 任一能看到）

function scanDevices() {
  const r = findRemote();
  remote = r || null;                       // 仅用于 Raw Input 事件过滤
  const now = !!(r || hid.find());          // 直读模式下设备不一定出现在 Raw Input 列表里

  if (now !== present) {
    present = now;
    hidBlocked = false;                     // 设备重连后允许再试直读
    // 设备来去一次就等于一次「物理重置」：把「还按着」和「卡键静音」全部清掉。
    // 用户取电池复位之后，遥控器回来就该是干净的 —— 不能因为离开前被判过卡键，
    // 回来还被静音十几分钟，那样看起来就跟「没修好」一样。
    latch.clear();
    const freed = guard.clear();
    if (freed.length) {
      log('遥控器重新连接，已解除全部卡键静音');
      broadcast({ type: 'stuck-clear' });
    }
    if (!now && sourceKind === 'intercept') {
      // 断开重连后设备号会变，接管线程必须重建
      intercept.stop();
      sourceKind = 'none';
      interceptTried = false;
      interceptPending = false;
    }
    if (now) {
      // 设备重新出现了：不管上一轮是因为什么没接上（拔电池、睡着、驱动报错），
      // 都必须重新抢一次接管。
      // 老代码只在 sourceKind === 'intercept' 时才重置这两个标志 —— 结果一旦
      // 「断开 → 重连」过一次，就永远停在 Raw Input：遥控器的键既照常打进窗口
      // （满屏 mmmmmm），又被我们当成遥控器按键派发一次（Win+H 风暴）。
      interceptTried = false;
      interceptPending = false;
      armBackoff = 0;
      lastArmAt = 0;
    }
    log(now ? '遥控器已连接' : '遥控器已断开');
    broadcast({ type: 'device', connected: now });
    connectSource();
    return;
  }

  if (sourceKind === 'hid' && hidHandle && !hid.find()) {
    log('直读连接断开，尝试恢复');
    try { hidHandle.close(); } catch {}
    hidHandle = null;
    connectSource();
  }
}
setInterval(scanDevices, 3000);

// 选择输入源：能直读 HID 报文就直读（驱动已切到「符合 HID 标准的设备」时），
// 否则退回 Raw Input（驱动还是键盘时）。
function connectSource() {
  if (panicStop) return;   // 紧急停止期间不再连任何数据源（重启才恢复）
  if (sourceKind === 'intercept') return;
  if (sourceKind === 'hid' && hidHandle) return;
  if (hidPending) return;

  // ① 最理想：接管模式（驱动层截获，按键不再打字）
  if (!interceptTried) {
    tryIntercept();
    if (interceptPending || sourceKind === 'intercept') return;
  }

  if (!hidBlocked) {
    hidPending = true;
    let gotData = false;

    const r = hid.open(
      e => {
        if (!gotData) {
          gotData = true;
          hidPending = false;
          if (sourceKind !== 'hid') {
            sourceKind = 'hid';
            log('▶ 直读 HID 报文模式（按键不会再打进系统）');
            broadcast({ type: 'state' });
          }
        }
        try { handleEvent({ id: e.id, vkey: 0, down: e.down, isRemote: true }); }
        catch (err) { log('事件异常:', String(err)); }
      },
      msg => {
        // 打开成功但读不到（驱动还是键盘）——安静地退回 Raw Input
        lastHidError = msg;
        hidBlocked = true;
        hidPending = false;
        hidHandle = null;
        if (sourceKind === 'hid') { sourceKind = 'none'; connectSource(); }
      }
    );

    if (r.ok) {
      hidHandle = r;
      // 900ms 内没收到任何报文 = 读不了，直接放弃
      setTimeout(() => {
        if (!gotData && hidPending) {
          hidPending = false;
          hidBlocked = true;
          try { hidHandle && hidHandle.close(); } catch {}
          hidHandle = null;
          if (sourceKind === 'hid') { sourceKind = 'none'; connectSource(); }
        }
      }, 900);
      if (sourceKind === 'none') sourceKind = 'raw';
      return;
    }

    hidPending = false;
    lastHidError = r.error;
    hidBlocked = true;
  }

  if (sourceKind !== 'raw' && sourceKind !== 'hid' && sourceKind !== 'intercept') {
    sourceKind = 'raw';
  }
}

// 每隔 30 秒重试一次数据源：直读被拒 / 刚插上设备时能自动升级
setInterval(() => {
  if (sourceKind === 'none' || sourceKind === 'raw') { hidBlocked = false; connectSource(); }
}, 30000);

// 接管看门狗：接管是「遥控器按键不打字」的唯一保障。
// 一旦掉回 Raw Input，每一秒都在往当前窗口里打字（就是那个满屏 mmmmmm），
// 所以必须尽快抢回来，不能等下一次重启。连续失败就退避，最长 1 分钟一次。
setInterval(() => {
  if (sourceKind === 'intercept') {
    // 线程还活着的心跳（worker 里每 ≤1 秒发一次）。停跳说明卡在系统调用里了：
    // 那时过滤器还挂在设备上、却没人读报文，遥控器就会「按一下彻底没反应」。
    // 必须销毁上下文把键还给系统，再重建。
    const st = intercept.info();
    if (st.stalled) {
      log(`⚠ 接管线程已 ${Math.round(st.tickAge / 1000)} 秒没有心跳，强制重建（否则遥控器会完全没反应）`);
      try { intercept.stop(); } catch {}
      sourceKind = 'none';
      interceptTried = false;
      interceptPending = false;
      armBackoff = 0;
      lastArmAt = 0;
      broadcast({ type: 'state' });
      connectSource();
      return;
    }
    armBackoff = 0;
    return;
  }
  if (panicStop || !present || sourceKind === 'hid') return;
  if (!intercept.dllExists() || interceptPending) return;
  const wait = Math.min(60000, 5000 * Math.pow(2, Math.min(armBackoff, 4)));
  if (Date.now() - lastArmAt < wait) return;
  lastArmAt = Date.now();
  armBackoff++;
  // tryIntercept 只在 sourceKind === 'none' 时才肯动手，所以先让位
  sourceKind = 'none';
  interceptTried = false;
  connectSource();
}, 2000);

function dispatch(usage, ev) {
  const action = cfg.map[usage];

  if (!action) return;

  if (action.type === 'none') return;

  if (action.type === 'voice') {
    if (ev.down && !activeVoice.has(usage)) {
      inject.hold(action.keys);
      activeVoice.set(usage, action.keys);
      voiceAt.set(usage, Date.now());
      log(`语音键 按下 → 注入 ${model.keysLabel(action.keys)}`);
    } else if (!ev.down && activeVoice.has(usage)) {
      inject.release(activeVoice.get(usage));
      activeVoice.delete(usage);
      voiceAt.delete(usage);
      log('语音键 松开 → 释放');
    }
    return;
  }

  if (action.type === 'keys') {
    if (!ev.down) return;
    inject.combo(action.keys);
    log(`0x${usage.toString(16)} → ${model.keysLabel(action.keys)}`);
    return;
  }

  if (action.type === 'text') {
    if (!ev.down) return;
    inject.pasteText(action.text || '');
    log(`0x${usage.toString(16)} → 粘贴文本`);
  }
}

let sourceKind = 'none';
let hidHandle = null;
let hidBlocked = false;
let hidPending = false;
let lastHidError = '';
let interceptTried = false;
let interceptPending = false;
let armBackoff = 0;      // 连续接管失败次数 → 退避，避免每 2 秒死磕驱动
let lastArmAt = 0;

// type === 'native' 的键：接管模式下不吞，原样放行（方向键、OK 这类系统原生行为）。
// 观察模式里它们本来就会原生生效，所以不需要额外处理 —— 两种模式语义一致。
function passthroughSet() {
  const out = [];
  for (const k of Object.keys(cfg.map)) {
    const a = cfg.map[k];
    if (a && a.type === 'native') out.push(Number(k));
  }
  return out;
}

function syncPassthrough() {
  intercept.setPassthrough(passthroughSet());
}

// 优先尝试「接管模式」：装了 Interception 驱动时，遥控器的按键会在驱动层被截走，
// 根本不会到达任何窗口 —— 既不打出字母，也不会触发 mmmmmm 这种自动重复。
let panicStop = false;           // 紧急停止：不再接管，直到重启程序

function tryIntercept() {
  if (panicStop) { interceptTried = true; return; }
  if (interceptTried || interceptPending || sourceKind !== 'none') return;
  if (!intercept.dllExists()) { interceptTried = true; return; }

  interceptPending = true;
  const ok = intercept.start(
    ev => {
      try {
        handleEvent({ id: ev.code, vkey: 0, down: ev.down, isRemote: true, ext: ev.e0 || ev.e1 });
      } catch (e) {
        log('事件处理异常:', e && e.stack ? e.stack.split('\n')[0] : String(e));
      }
    },
    (kind, payload) => {
      interceptPending = false;
      interceptTried = true;
      if (kind === 'ready') {
        sourceKind = 'intercept';
        log(`▶ 接管模式已启用（设备 #${payload.device}）`);
        const pass = passthroughSet();
        log(`  遥控器按键已被驱动层拦下，不会再往窗口里打字`);
        if (pass.length) {
          log(`  其中 ${pass.length} 个键设为「系统原生」，会原样放行：` +
              pass.map(x => '0x' + x.toString(16).padStart(2, '0').toUpperCase()).join(' '));
        }
        broadcast({ type: 'state' });
      } else if (kind === 'lost') {
        // 已经接管成功了，线程却掉了/出错了。以前这里什么都不做，
        // 结果过滤器可能还挂在设备上而没人读报文 —— 遥控器整个失灵，
        // 而且永远不会自己恢复。现在立刻重建。
        releaseHeld();
        sourceKind = 'none';
        interceptTried = false;
        interceptPending = false;
        armBackoff = 0;
        lastArmAt = 0;
        log('⚠ 接管线程掉了：' + (payload.reason || '未知原因') + '，立即重建');
        broadcast({ type: 'state' });
        connectSource();
      } else if (kind === 'disarmed') {
        // 接管线程自己踩了刹车（设备号被抢 或 检测到人在打字）。
        // 必须马上退回别的数据源，否则遥控器会彻底没反应。
        releaseHeld();
        sourceKind = 'none';
        interceptTried = true;              // 先别立刻又抢回去
        log('⚠ 接管模式已自动停用：' + (payload.reason || '未知原因'));
        log('  输入已交还系统。10 秒后再尝试接管。');
        broadcast({ type: 'state' });
        connectSource();
        setTimeout(() => { interceptTried = false; }, 10000);
      } else {
        log('接管模式不可用：' + (payload.reason || payload.code || '未知原因') +
            (payload.code ? `（${payload.code}）` : ''));
        connectSource();
        // 「没找到键盘设备」多半只是蓝牙刚断开/刚重连的那一瞬间。
        // 以前这里一失败就永久放弃（interceptTried 再也不复位），
        // 于是重连之后永远停在 Raw Input，遥控器直接开始往窗口里打字。
        // 现在记下时间，让看门狗按退避节奏自动再抢。
        armBackoff = Math.max(1, armBackoff);
        lastArmAt = Date.now();
      }
    },
    passthroughSet()
  );

  if (!ok) { interceptPending = false; interceptTried = true; }
}

function rawHandler(ev) {
  try {
    // 紧急停止之后一丝一毫都不许再派发：Raw Input 是「旁听」，停掉接管并不会
    // 停掉它。之前忘了这一条，于是点了紧急停止，遥控器的键还在每 6 秒触发一次
    // Win+H —— 越急越乱。
    if (panicStop) return;
    const isRemote = !!(remote && ev.hDevice === remote.hDevice);
    if (sourceKind === 'hid' || sourceKind === 'intercept') {
      // 直读/接管模式下 Raw Input 只用来录制快捷键（物理键盘），遥控器事件走另一条路
      if (capture) handleEvent({ id: ev.usage, vkey: ev.vkey, down: ev.down, isRemote: false });
      return;
    }
    handleEvent({ id: ev.usage, vkey: ev.vkey, down: ev.down, isRemote });
  } catch (e) {
    log('事件处理异常:', e && e.stack ? e.stack.split('\n')[0] : String(e));
  }
}

/* ---------- 卡键 / 连发保护 ----------
   遥控器的语音键在「开麦没被正常收尾」时会每隔几秒自动重发同一个键。
   识别逻辑放在 ./stuck.js（那边有单测），这里只负责判定之后做什么：
   静音这个键 30 秒，期间绝不注入任何按键 —— 否则每一发都是一个 Win+H，
   桌面立刻没法用。 */
const { StuckGuard } = require('./stuck');
const guard = new StuckGuard();

function muteKey(usage, why) {
  const m = guard.mute(usage);
  releaseHeld();
  const h = '0x' + usage.toString(16).padStart(2, '0').toUpperCase();
  const sec = Math.round(m.ms / 1000);
  log(`⚠ 按键 ${h} 疑似卡住：${why}`);
  log(`  已暂停派发 ${sec} 秒${m.streak > 1 ? `（第 ${m.streak} 次，退避加长）` : ''}，期间不会注入任何按键。`);
  log(`  遥控器本身在以固定节奏重发这个键，取下电池再装回即可复位。`);
  broadcast({ type: 'stuck', usage, hex: h, ms: m.ms, streak: m.streak, why });
}

function handleEvent(ev) {
  if (panicStop) return;   // 紧急停止之后一切派发都停（见 rawHandler 里的说明）

  // 录制模式：优先响应「电脑键盘」的按键
  if (capture) {
    if (process.env.DBG_CAPTURE === '1') {
      log(`[capture] id=0x${Number(ev.id).toString(16)} vkey=${ev.vkey} down=${ev.down} isRemote=${ev.isRemote}`);
    }
    if (!ev.down) return;
    // 遥控器自己的按键不参与录制：接管模式下它给的是扫描码不是虚拟键码，
    // 记下来也没法用 inject 复原。录快捷键请用电脑键盘。
    if (ev.isRemote) return;
    if (!ev.vkey) return;
    if (model.MOD_VKS.has(ev.vkey)) {
      capture.mods.add(ev.vkey);
      broadcast({ type: 'capture-mod', mods: [...capture.mods] });
      return;
    }
    finishCapture([...capture.mods, ev.vkey]);
    return;
  }

  if (!ev.isRemote) return;

  // 「按键确认」模式：下一个遥控器按键就绑定到正在等的那个坑位，不派发、不记录
  if (learnSlot) {
    if (ev.down) {
      // 一个按键只应该挂一个位置。如果这个码已经在别的坑位上，
      // 说明按错了（或者图上这个位置本来就重复），此时：
      // 不覆盖、不挪走，继续等用户按正确的那个键 —— 否则一次误按就把已有绑定毁了。
      const owner = layout.slotOf(ev.id);
      if (owner && owner !== learnSlot) {
        const o = layout.list().find(x => x.id === owner);
        const nm = o ? o.name : owner;
        log(`⚠ 这个键已经绑在「${nm}」上，没有重复绑定，请按别的键`);
        broadcast({ type: 'learn-dup', slot: learnSlot, usage: ev.id, owner: nm });
        return;
      }
      const slot = learnSlot;
      learnSlot = null;
      layout.set(slot, ev.id);
      log(`绑定：${slot} ← 0x${ev.id.toString(16).padStart(2, '0').toUpperCase()}`);
      syncPassthrough();                 // 学习完了恢复「系统原生」放行
      broadcast({ type: 'learn-done', slot, usage: ev.id });
      broadcast({ type: 'state' });
    }
    return;
  }

  const usage = ev.id;

  // 幽灵键：在记录/派发之前就丢掉（连 seen 计数也不记，免得污染面板）
  if (isPhantom(usage, ev)) {
    if (ev.down) {
      phantomDropped++;
      broadcast({ type: 'phantom', total: phantomDropped });
    }
    return;
  }

  // 静音期内的键：只当没看见，绝不派发。
  // （驱动层没拦住的话它仍然会往窗口里打字，那不是我们能补救的部分 —— 见看门狗。）
  if (ev.down && guard.isMuted(usage)) return;

  if (ev.down) {
    // 已经按着的键又来个 down = 重复上报（键盘自动重复 / 固件 keep-alive），不是新按压。
    // down() 内部会刷新时刻，所以「静默 12 秒才算松开」的兜底不会被 6 秒的重发骗过去。
    if (latch.down(usage)) {
      if (process.env.DBG_KEYS === '1') {
        log(`重复 0x${usage.toString(16).padStart(2, '0').toUpperCase()}（仍按着，已刷新）`);
      }
      return;
    }
    // 卡键保护：真正连发的是遥控器，不是人。拦在派发之前，一个 Win+H 都不许出去。
    const act0 = cfg.map[usage];
    if (act0 && act0.type !== 'native' && guard.note(usage)) {
      muteKey(usage, `以几乎相同的间隔连发了 ${guard.o.need} 次`);
      return;
    }
    lastRealDownAt = Date.now();
    const rec = seen.get(usage) || { usage, count: 0, vkey: ev.vkey };
    rec.vkey = ev.vkey;
    rec.count++;
    seen.set(usage, rec);
    persistSeen();
    const act = cfg.map[usage];
    log(`按键 0x${usage.toString(16).padStart(2, '0').toUpperCase()}  ` +
        `vkey=0x${ev.vkey.toString(16).padStart(2, '0').toUpperCase()}  ` +
        (act ? '→ ' + model.actionLabel(act) : '（未映射）'));
    broadcast({ type: 'key', usage, down: true, vkey: ev.vkey, mapped: !!act });
  } else {
    // 抬起：默认不记（日志太吵），排查「到底是没抬起还是重复发」时用 DBG_KEYS=1
    if (process.env.DBG_KEYS === '1') {
      log(`抬起 0x${usage.toString(16).padStart(2, '0').toUpperCase()}`);
    }
    latch.up(usage);
  }

  dispatch(usage, ev);
}

// ---------------- 启动 ----------------
start(rawHandler, 5, () => setTimeout(scanDevices, 120));
connectSource();

// 把「按住」状态的键全部抬起来。卡住的 Ctrl/Win 会让整个系统的鼠标键盘都像坏了一样，
// 所以退出、缴械、断开时都要兜一下。
function releaseHeld() {
  for (const [, keys] of activeVoice) { try { inject.release(keys); } catch {} }
  activeVoice.clear();
  voiceAt.clear();
  latch.clear();
  try { inject.release([0x10, 0x11, 0x12, 0x5b, 0x5c, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]); } catch {}
}

// 语音键兜底：遥控器开麦时常常漏发抬键，超过 20 秒强制释放，避免卡键
setInterval(() => {
  const now = Date.now();
  for (const [usage, keys] of activeVoice) {
    const t = voiceAt.get(usage) || 0;
    if (now - t > 20000) {
      inject.release(keys);
      activeVoice.delete(usage);
      voiceAt.delete(usage);
      log('语音键超时（20 秒），已强制释放，避免修饰键卡住');
    }
  }

  // 「还按着」的兜底：万一驱动/设备漏发抬键，这个键会被永久当成按着，之后就再也没反应。
  // 所以一段时间（latch 里配的 12 秒）没动静就当它松开了。
  // ⚠️ 这个时间必须大于遥控器卡键时的重发周期（实测 6.000 秒）—— 5 秒的老值
  //    正好卡在 6 秒下面，导致每一发重发都被当成「新的一次按压」，满屏 m 就是这么来的。
  for (const u of latch.sweep(now)) {
    if (process.env.DBG_KEYS === '1') {
      log(`松手兜底 0x${u.toString(16).padStart(2, '0').toUpperCase()}（太久没动静）`);
    }
  }

  // 卡键静音到期就自动解除（遥控器取下电池再装回之后就能继续用）
  for (const u of guard.sweep(now)) {
    log(`按键 0x${u.toString(16).padStart(2, '0').toUpperCase()} 的静音已解除`);
    broadcast({ type: 'stuck-clear', usage: u });
  }
}, 2000);

process.on('exit', releaseHeld);
process.on('SIGTERM', () => { releaseHeld(); process.exit(0); });
process.on('SIGBREAK', () => { releaseHeld(); process.exit(0); });

// ---------------- HTTP ----------------
function state() {
  const usages = new Set([...Object.keys(cfg.map).map(Number), ...seen.keys()]);
  const keys = [...usages].sort((a, b) => a - b).map(u => {
    const action = cfg.map[u];
    return {
      usage: u,
      hex: '0x' + u.toString(16).padStart(2, '0').toUpperCase(),
      name: action && action.name ? action.name : (seen.get(u) ? '新键' : ''),
      action,
      actionLabel: model.actionLabel(action),
      count: seen.get(u) ? seen.get(u).count : 0,
    };
  });
  return {
    connected: present,
    source: sourceKind,
    keys,
    capture: !!capture,
    captureMods: capture ? [...capture.mods] : [],
    presets: model.PRESETS.map(p => ({ id: p.id, name: p.name })),
    phantomDropped,
    filterPhantom: cfg.filterPhantom !== false,
    intercept: intercept.info(),
  };
}

function body(req) {
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => (d += c));
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}

function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}

// 桌面面板用的整包状态：图上坑位 + 没归位的散键
function appState() {
  const slots = layout.list().map(s => ({
    ...s,
    action: s.usage == null ? null : (cfg.map[s.usage] || null),
    count: s.usage == null ? 0 : (seen.get(s.usage) ? seen.get(s.usage).count : 0),
  }));
  const bound = new Set(slots.map(s => s.usage).filter(u => u != null));
  const all = new Set([...Object.keys(cfg.map).map(Number), ...seen.keys()]);
  const extras = [...all].filter(u => !bound.has(u)).sort((a, b) => a - b).map(u => ({
    usage: u,
    hex: '0x' + u.toString(16).padStart(2, '0').toUpperCase(),
    action: cfg.map[u] || null,
    count: seen.get(u) ? seen.get(u).count : 0,
  }));
  return {
    connected: present,
    source: sourceKind,
    panic: panicStop,
    capture: !!capture,
    learn: learnSlot,
    phantomDropped,
    intercept: intercept.info(),
    // 卡键静音中的键（面板刷新后仍然要显示，不然用户以为程序傻了）
    muted: guard.list().map(x => ({
      usage: x.usage,
      hex: '0x' + x.usage.toString(16).padStart(2, '0').toUpperCase(),
      until: x.until,
    })),
    slots,
    extras,
    presets: model.PRESETS.map(p => ({ id: p.id, name: p.name })),
  };
}

// ---- 语音桥接状态 ----
// 遥控器的麦克风走蓝牙 L2CAP，Windows 看不到，只能靠 ETW 抓 HCI 再解出 PCM
// （tools/etw_consumer.exe），mic_live.py 再把 PCM 播到虚拟声卡 CABLE Input，
// 于是系统的「CABLE Output」就等于遥控器麦克风。
// 桥有没有在跑，就看它有没有占着 31680 这个 UDP 口。
const MIC_PORT = 31680;

// VB-CABLE 装没装：驱动文件在就认为装了
function remoteCablePresent() {
  const sys = process.env.SystemRoot || 'C:\\Windows';
  try {
    return fs.existsSync(path.join(sys, 'System32', 'drivers', 'vbaudio_cable64_win7.sys'));
  } catch { return false; }
}

function micPortFree() {
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4');
    let done = false;
    const finish = free => {
      if (done) return;
      done = true;
      try { s.close(); } catch {}
      resolve(free);
    };
    s.once('error', () => finish(false));        // 端口被占 = 桥已经在跑
    s.once('listening', () => finish(true));
    try { s.bind(MIC_PORT, '127.0.0.1'); } catch { finish(true); }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const f = path.join(__dirname, '..', 'ui', 'app.html');
    // 一定要禁缓存：改了前端却还跑着旧页面，是最容易误判成「功能坏了」的坑
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
    res.end(fs.readFileSync(f));
    return;
  }

  if (url.pathname === '/classic') {
    const f = path.join(__dirname, '..', 'ui', 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(f));
    return;
  }

  if (url.pathname === '/api/state') return json(res, 200, state());
  if (url.pathname === '/api/app') return json(res, 200, appState());

  // 紧急停止：撤掉接管、把所有按住状态的键抬起来，之后不再接管（重启才恢复）
  if (url.pathname === '/api/mic' && req.method === 'GET') {
    const free = await micPortFree();
    const cable = remoteCablePresent();
    return json(res, 200, { running: !free, port: MIC_PORT, cable });
  }

  if (url.pathname === '/api/mic/start' && req.method === 'POST') {
    // mic-live.cmd 自己会检查管理员权限并弹 UAC（ETW 必须提权），这里用普通权限起它就行
    const cmd = path.join(__dirname, '..', 'mic-live.cmd');
    if (!fs.existsSync(cmd)) {
      return json(res, 200, { ok: false, reason: '找不到 mic-live.cmd（打包里没带？）' });
    }
    try {
      spawn('cmd.exe', ['/c', cmd], {
        cwd: path.dirname(cmd),
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      }).unref();
    } catch (e) {
      return json(res, 200, { ok: false, reason: String((e && e.message) || e) });
    }
    log('启动语音桥接（会弹 UAC 请求管理员权限）');
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/unmute' && req.method === 'POST') {
    // 用户自己确认「遥控器已经好了」，那就立刻解除所有卡键静音
    const cleared = guard.clear();
    if (cleared.length) log('用户手动解除了卡键静音');
    broadcast({ type: 'stuck-clear' });
    return json(res, 200, { ok: true, cleared });
  }

  if (url.pathname === '/api/rearm' && req.method === 'POST') {
    // 「重新接管」：急停之后不用重启程序，一点就回来。
    // 也用来救「遥控器按了没反应」——把上下文销毁重建一遍。
    panicStop = false;
    try { intercept.stop(); } catch {}
    releaseHeld();
    sourceKind = 'none';
    interceptTried = false;
    interceptPending = false;
    armBackoff = 0;
    lastArmAt = 0;
    log('↻ 手动重新接管');
    broadcast({ type: 'state' });
    connectSource();
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/panic' && req.method === 'POST') {
    panicStop = true;
    learnSlot = null;
    try { intercept.stop(); } catch {}
    releaseHeld();
    sourceKind = 'none';
    interceptTried = true;
    log('🛑 紧急停止：接管模式已关闭，输入全部交还系统（重启程序才会再接管）');
    broadcast({ type: 'state' });
    return json(res, 200, { ok: true, panic: true });
  }

  if (url.pathname === '/api/bind' && req.method === 'POST') {
    const b = await body(req);
    const slot = typeof b.slot === 'string' ? b.slot : null;
    if (!slot) return json(res, 400, { ok: false });
    if (b.name !== undefined) layout.rename(slot, b.name);

    // 学习期间必须把「系统原生放行」关掉：方向键 / OK 走的是原样转发，
    // 不关的话这些键根本到不了这里，用户会以为「按了没反应」。
    const endLearn = () => {
      if (learnSlot) { learnSlot = null; syncPassthrough(); }
    };

    if (b.cancel) {
      endLearn();
    } else if (b.learn) {
      learnSlot = slot;
      intercept.setPassthrough([]);
      broadcast({ type: 'learn', slot });
    } else if (b.usage === null) {
      endLearn();
      layout.set(slot, null);
      broadcast({ type: 'state' });
    } else if (typeof b.usage === 'number') {
      endLearn();
      layout.set(slot, b.usage);
      broadcast({ type: 'state' });
    }
    return json(res, 200, { ok: true, learn: learnSlot });
  }

  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (url.pathname === '/api/action' && req.method === 'POST') {
    const { usage, action } = await body(req);
    if (typeof usage !== 'number') return json(res, 400, { ok: false });
    if (!action || action.type === 'clear') delete cfg.map[usage];
    else cfg.map[usage] = action;
    store.save(cfg);
    syncPassthrough();
    broadcast({ type: 'state' });
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/capture' && req.method === 'POST') {
    finishCapture([]);                     // 上一个没收尾的先放掉，避免叠加
    capture = { mods: new Set() };
    broadcast({ type: 'state' });

    let alive = true;
    req.on('close', () => { alive = false; if (capture) finishCapture([]); });

    const keys = await new Promise(resolve => {
      captureResolve = resolve;
      // 兜底：面板已经不在了也别让 capture 永远挂着
      setTimeout(() => { if (captureResolve === resolve) finishCapture([]); }, 20000);
    });

    if (!alive) { try { res.destroy(); } catch { /* 已断开 */ } return; }
    return json(res, 200, { ok: true, keys });
  }

  if (url.pathname === '/api/capture/cancel' && req.method === 'POST') {
    const was = !!capture;
    finishCapture([]);
    if (was) broadcast({ type: 'state' });
    return json(res, 200, { ok: true });
  }

  if (url.pathname === '/api/reset' && req.method === 'POST') {
    cfg.map = {};
    store.save(cfg);
    syncPassthrough();
    broadcast({ type: 'state' });
    return json(res, 200, { ok: true });
  }

  res.writeHead(404); res.end('not found');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    log(`端口 ${PORT} 已被占用 —— 可能已经有一个实例在跑。`);
    log(`要么关掉旧的窗口，要么用 PORT=7799 启动。`);
  } else {
    log('服务异常:', e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  log(`服务已启动: http://127.0.0.1:${PORT}`);
  log(`遥控器: ${present ? '已连接' : '未连接（按任意键唤醒）'}`);
  log(`配置文件: ${store.FILE}`);
  if (process.env.NO_OPEN !== '1') {
    try {
      require('child_process').spawn('cmd', ['/c', 'start', '', `http://127.0.0.1:${PORT}`], {
        detached: true, stdio: 'ignore', windowsHide: true,
      }).unref();
    } catch (e) { log('浏览器自动打开失败，请手动访问上面的地址'); }
  }
});

process.on('SIGINT', () => {
  for (const [, keys] of activeVoice) inject.release(keys);
  stop();
  process.exit(0);
});

let inHandler = false;
process.on('uncaughtException', e => {
  if (inHandler) return;          // 防止异常处理器自己再抛异常导致死循环
  inHandler = true;
  try {
    log('未捕获异常:', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  } catch { /* ignore */ }
  inHandler = false;
});
