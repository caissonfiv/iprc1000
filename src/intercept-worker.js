'use strict';
// 接管线程：Interception 的 wait/receive 都是阻塞调用，必须跑在独立线程，
// 否则会卡死主线程的事件循环（HTTP 面板就再也响应不了）。
//
// ⚠️ 必须防的大坑：驱动记的是「第 N 号设备」这个槽位号，而槽位号会变。
//    遥控器一睡、一重连，N 号可能就换成了用户的真键盘 —— 那时我们会把它
//    整个吞掉，用户看到的就是「键盘失灵 / 按键乱」。
//    所以这里有两道刹车：
//      ① 看门狗：每 2 秒核对 N 号设备的硬件 ID 还是不是遥控器，变了立刻缴械；
//      ② 打字检测：1.2 秒内出现 6 个以上不同扫描码，说明是人在打字（遥控器一次只按一个键），
//         立刻缴械。缴械 = 撤销过滤器 + 销毁上下文 + 退出线程，输入马上恢复正常。
const { parentPort, workerData } = require('worker_threads');
const ffi = require('./interception-ffi');

let api, ctx = 0n, probe = 0n, remoteId = 0;
let expectedHwid = '';
let pred = null;
let nonePred = null;
let disarmed = false;

// 「原样放行」的扫描码集合：这些键不吞，直接把原始报文转发回键盘栈。
// 用于 action.type === 'native' —— 接管模式下必须显式放行，否则方向键 / OK 会失灵。
let passthrough = new Set((workerData && workerData.passthrough) || []);

function post(m) {
  try { parentPort.postMessage(m); } catch { /* 主线程已退出 */ }
}

function bail(code, reason) {
  post({ type: 'unavailable', code, reason });
  process.exit(0);
}

// 缴械：撤销过滤、销毁上下文，把输入还给系统，然后退出线程
function disarm(reason) {
  if (disarmed) return;
  disarmed = true;
  try { if (ctx && nonePred) api.setFilter(ctx, nonePred, 0); } catch {}
  try { if (ctx) api.destroy(ctx); } catch {}
  try { if (probe) api.destroy(probe); } catch {}
  ctx = 0n; probe = 0n;
  post({ type: 'disarmed', reason });
  setTimeout(() => process.exit(0), 50);
}

try {
  api = ffi.load();
} catch (e) {
  bail(e.code || 'LOAD_FAIL', String((e && e.message) || e));
}

// 防御：KEY_UP/KEY_E0/KEY_E1 缺失时，`state & api.KEY_UP` 恒为 0，
// 「抬起」会被误判成「按下」——症状是每个键按过一次就再也没反应。
// 这种错误必须响亮地报出来，绝不能静默降级。
if (typeof api.KEY_UP !== 'number' || typeof api.KEY_E0 !== 'number' || typeof api.KEY_E1 !== 'number') {
  bail('BAD_CONST', 'interception 常量缺失（KEY_UP/KEY_E0/KEY_E1），无法区分按下与抬起');
}

try {
  ctx = api.create();
} catch (e) {
  bail('CREATE_THROW', String((e && e.message) || e));
}

if (!ctx || ctx === 0n) {
  // 驱动没装或没启动时，interception_create_context 返回 NULL
  bail('NO_DRIVER', '驱动未安装或未启动');
}

// 用来查设备的第二个上下文：永远不设过滤器，所以它不会截任何输入
try {
  probe = api.create();
} catch { probe = 0n; }

// ---- 找遥控器 ----
const { list, hit } = ffi.findRemoteKeyboard(api, ctx);
if (!hit) {
  post({ type: 'nokeyboard', keyboards: list });
  process.exit(0);
}
remoteId = hit.device;
expectedHwid = hit.hwid;

// ---- 只截获遥控器这一台键盘 ----
try {
  nonePred = ffi.makePredicate(api, () => 0);
  pred = ffi.makePredicate(api, d => (d === remoteId ? 1 : 0));
  api.setFilter(ctx, pred, api.FILTER_KEY_ALL);
} catch (e) {
  bail('SET_FILTER_FAIL', '设置过滤器失败：' + String((e && e.message) || e));
}

post({ type: 'ready', device: remoteId, hwid: hit.hwid, keyboards: list });

// 主线程可以随时更新「原样放行」的键集合（改键之后）
parentPort.on('message', m => {
  if (m && m.type === 'passthrough') {
    passthrough = new Set(m.set || []);
  }
});

// ---- 刹车 ①：核对槽位号还是不是遥控器 ----
const norm = s => String(s || '').toUpperCase().replace(/\s+/g, '');
let verifiedAt = 0;
let verifyState = 'ok';          // ok | changed | gone

function verify(force) {
  const now = Date.now();
  // 按键时 force=true，每次都核对（一个 ioctl 而已）；空闲时也每 250ms 核对一次
  if (!force && now - verifiedAt < 1) return verifyState;
  verifiedAt = now;
  let hw = '';
  try { hw = ffi.hardwareId(api, probe || ctx, remoteId); } catch { hw = ''; }
  if (!hw) verifyState = 'gone';
  else verifyState = norm(hw) === norm(expectedHwid) ? 'ok' : 'changed';
  if (verifyState !== 'ok') lastHwidSeen = hw;
  return verifyState;
}
let lastHwidSeen = '';
let goneCount = 0;

// ---- 刹车 ②：打字检测 ----
let recent = [];
function looksLikeTyping(code) {
  const now = Date.now();
  recent.push({ code, t: now });
  recent = recent.filter(r => now - r.t < 1200);
  return new Set(recent.map(r => r.code)).size >= 6;
}

// ---- 接收循环（每轮最多阻塞 250ms）----
// 这里是同步死循环，Node 的定时器根本转不起来，所以心跳只能在循环里发。
// 主线程靠它判断「线程还活着」：一旦停跳，说明卡在某个系统调用里了 ——
// 那时过滤器还挂在设备上，但没人读报文，遥控器就会整个失灵（按键全被吞）。
//
// 以前的写法是「waitTimeout 拿到设备 → 内层死循环 receive」，
// 但 interception_receive 是阻塞的，队列一空就永久挂在内层循环里出不来：
// 既没法发心跳，也没法再核对设备身份。现在统一成单层循环，
// waitTimeout 说有报文才去 receive，receive 必定立即返回。
let lastTickAt = 0;
function tick() {
  const now = Date.now();
  if (now - lastTickAt < 1000) return;
  lastTickAt = now;
  post({ type: 'tick', at: now });
}

const buf = Buffer.alloc(api.STROKE_SIZE);

for (;;) {
  if (disarmed) break;
  tick();

  let dev = 0;
  try {
    dev = api.waitTimeout(ctx, 250);
  } catch (e) {
    if (disarmed) break;
    bail('WAIT_FAIL', '等待输入失败：' + String((e && e.message) || e));
  }
  if (disarmed) break;

  // 超时返回 0 是正常的，继续等，绝对不能 break
  if (!dev || api.isInvalid(dev)) {
    const st = verify(true);
    if (st === 'changed') {
      disarm(`设备 ${remoteId} 号已经不是遥控器了（现在是「${lastHwidSeen}」）`);
      break;
    }
    if (st === 'gone') {
      if (++goneCount >= 40) { disarm('遥控器设备已消失，先缴械避免误拦别人'); break; }   // 约 10 秒
    } else {
      goneCount = 0;
    }
    continue;
  }
  goneCount = 0;

  let n = 0;
  try {
    n = api.receive(ctx, dev, buf, 1);
  } catch (e) {
    if (disarmed) break;
    bail('RECV_FAIL', '读取报文失败：' + String((e && e.message) || e));
  }
  if (!n || n <= 0) continue;

  if (dev !== remoteId) {
    // 理论上不会走到（predicate 已限定设备），保险起见原样放行
    try { api.send(ctx, dev, buf, 1); } catch {}
    continue;
  }

  const code = buf.readUInt16LE(0);
  const state = buf.readUInt16LE(2);
  const down = (state & api.KEY_UP) === 0;

  // 每个报文前顺手核对设备身份：换了就先原样放行，再缴械
  if (verify(false) !== 'ok') {
    try { api.send(ctx, dev, buf, 1); } catch {}
    disarm(`设备 ${remoteId} 号已经不是遥控器了（现在是「${lastHwidSeen || '空槽'}」）`);
    break;
  }

  if (down && looksLikeTyping(code)) {
    // 人在打字：先把这个键原样放行（不能吞掉用户正在按的键），再缴械
    try { api.send(ctx, dev, buf, 1); } catch {}
    disarm('检测到连续打字，判断为误拦了真实键盘');
    break;
  }

  // native：不吞，原样转发回键盘栈（方向键、OK 这类系统原生行为）
  if (passthrough.has(code)) {
    try { api.send(ctx, dev, buf, 1); } catch { /* 转发失败就当它按下了没反应 */ }
    continue;
  }

  post({
    type: 'key',
    code,
    down,
    e0: (state & api.KEY_E0) !== 0,
    e1: (state & api.KEY_E1) !== 0,
  });
}

if (!disarmed) {
  try { api.destroy(ctx); } catch {}
  try { if (probe) api.destroy(probe); } catch {}
  post({ type: 'closed', reason: '接收循环结束' });
}
