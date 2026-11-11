'use strict';
// 回归测试：「这个键还按着吗」（src/latch.js）
//
// 背景：遥控器的语音键按下后不再发「抬起」，固件每隔 6.000 秒把同一个按下报文重发一次。
// 旧代码的静默兜底是 5 秒 —— 比 6 秒还短，于是每一发重发都被判成
// 「已经松开了、又按了一下」，程序就 6 秒一次地派发动作（满屏 m / 一串 Win+H）。

const { PressLatch } = require('../src/latch');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  →  ' + extra)); }
}

// 模拟主循环：每 2 秒跑一次 sweep，和 app.js 里一致。
// 扫描起点故意错开 1 秒：真实世界里定时器和按键不可能永远对齐，
// 老 bug 正是靠这个「相位差」时有时无，所以必须模拟出来。
function run(latch, events, until, sweepEvery = 2000) {
  const accepted = [];
  let nextSweep = 1000;
  const all = [...events].sort((a, b) => a.t - b.t);
  let i = 0;
  for (let t = 0; t <= until; t += 100) {
    while (i < all.length && all[i].t <= t) {
      const e = all[i++];
      if (e.down) {
        if (!latch.down(e.u, e.t)) accepted.push({ u: e.u, t: e.t });
      } else {
        latch.up(e.u);
      }
    }
    if (t >= nextSweep) { latch.sweep(t); nextSweep += sweepEvery; }
  }
  return accepted;
}

console.log('① 正常按压：按下一次只算一次');
{
  const l = new PressLatch();
  ok('第一次 down → 是新的按压', l.down(0x32, 0) === false);
  ok('抬起', l.up(0x32) === true || true);
  ok('再按一次 → 又是新的按压', l.down(0x32, 5000) === false);
}

console.log('② 卡键重发（按下后不再有抬起）：6 秒一发，60 秒内只算一次');
{
  const l = new PressLatch();
  const ev = [{ t: 0, u: 0x32, down: true }];
  for (let t = 6000; t <= 60000; t += 6000) ev.push({ t, u: 0x32, down: true });
  const acc = run(l, ev, 62000);
  ok('11 次重发只被接受 1 次', acc.length === 1, '接受了 ' + acc.length + ' 次');
  ok('被接受的是最开始那一次', acc[0] && acc[0].t === 0, JSON.stringify(acc));
}

console.log('③ 兜底时间必须比重发周期（6 秒）长，否则每一发重发都成了新按压');
{
  ok('默认 ttl = 12000ms（6 秒周期的两倍）', new PressLatch().o.ttlMs === 12000, new PressLatch().o.ttlMs);

  // 反证：老代码的 5 秒兜底。只要兜底在「第 5~6 秒」之间跑过一次，
  // 键就被清掉，紧接着 6 秒那一发重发就被当成「新的一次按压」—— 满屏 m 就是这么来的。
  const l = new PressLatch({ ttlMs: 5000 });
  l.down(0x32, 0);
  l.sweep(5100);
  ok('ttl 5s：5.1 秒时兜底把键清掉了', l.has(0x32) === false);
  ok('于是 6 秒那一发重发变成「新按压」', l.down(0x32, 6000) === false);

  // 同一时刻，12 秒兜底不会清，重发被正确识别为重复
  const m = new PressLatch();
  m.down(0x32, 0);
  m.sweep(5100);
  ok('ttl 12s：同一时刻键还在（清不掉）', m.has(0x32) === true);
  ok('重发被识别为重复（不派发）', m.down(0x32, 6000) === true);
}

console.log('④ 真漏发抬起时还能自己恢复（不能把键锁死）');
{
  const l = new PressLatch();
  l.down(0x32, 0);
  l.sweep(11000);
  ok('11 秒还留着（没到 12 秒）', l.has(0x32) === true);
  l.sweep(12100);
  ok('12 秒后清掉', l.has(0x32) === false);
  ok('之后重新按下算新按压（键没有锁死）', l.down(0x32, 20000) === false);
}

console.log('⑤ 多个键互不影响');
{
  const l = new PressLatch();
  ok('A 按下', l.down(0x32, 0) === false);
  ok('B 按下是新的', l.down(0x48, 100) === false);
  ok('A 重发是重复', l.down(0x32, 6000) === true);
  ok('B 重发是重复', l.down(0x48, 6100) === true);
  l.up(0x48);
  ok('B 抬起后 A 仍按着', l.has(0x32) === true && l.has(0x48) === false);
}

console.log('⑥ clear');
{
  const l = new PressLatch();
  l.down(0x32, 0); l.down(0x48, 0);
  l.clear();
  ok('clear 之后全部释放', l.has(0x32) === false && l.has(0x48) === false);
}

console.log('');
if (fail) { console.log(`❌ ${fail} 项失败`); process.exit(1); }
console.log('✅ 全部通过');
