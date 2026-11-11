'use strict';
// 回归测试：卡键 / 连发识别
//
// 背景：2026-11-10 夜里，遥控器的语音键进入「开麦没被正常收尾」的状态，
// 自己每隔 6.0 秒重发一次 M 键。程序把它当成人按键，每发一次就注入一个 Win+H，
// 整台机器没法用。真人按不出那么整齐的节奏 —— 所以用「间隔抖动」来区分。
// 这个脚本盯住三件事：机器周期要判定出来、人手动连点不能误判、静音要能自动解除。

const { StuckGuard } = require('../src/stuck');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  →  ' + extra)); }
}

// 用假时钟喂时间戳，不依赖真实 Date.now()
function feed(g, usage, times) {
  let last = false;
  for (const t of times) last = g.note(usage, t);
  return last;
}

console.log('① 机器连发（真实现场：0x32 每 6.000 秒一发，实测抖动 <5ms）');
{
  const g = new StuckGuard();
  const r1 = g.note(0x32, 1000);
  const r2 = g.note(0x32, 7000);
  const r3 = g.note(0x32, 13000);
  ok('第 1~2 发不判定（样本不够）', r1 === false && r2 === false);
  ok('第 3 发判定为卡键（2 个间隔一样齐就够）', r3 === true, r3);
}

console.log('② 真人连点不能误判');
{
  const g = new StuckGuard();
  // 人手按：间隔忽长忽短，差距远超 0.6 秒
  const human = [0, 900, 2600, 3100, 5400, 6100, 9200];
  ok('节奏不规则的 7 次按下 → 一次都不判', feed(g, 0x32, human) === false);
}
{
  const g = new StuckGuard();
  // 快速连点 0.25 秒一下（翻收藏、连按方向），间隔太短，属于正常使用
  const fast = [0, 250, 500, 750, 1000, 1250];
  ok('0.25 秒连点 6 次 → 不判卡键（太密，是人）', feed(g, 0x32, fast) === false);
}
{
  const g = new StuckGuard();
  // 间隔稳定但太短：0.5 秒一次，仍然是人在按
  ok('0.5 秒连点 5 次 → 不判卡键', feed(g, 0x20, [0, 500, 1000, 1500, 2000]) === false);
}
{
  const g = new StuckGuard();
  // 人手按得比较匀（连按「上」翻页那种）：1.0s / 1.3s / 0.9s —— 抖动 400ms，
  // 必须放过。阈值放宽到 600ms 就会把这种正常操作误判成卡键。
  ok('间隔 1.0/1.3/0.9 秒 → 不判卡键', feed(g, 0x48, [0, 1000, 2300, 3200]) === false);
}
{
  const g = new StuckGuard();
  // 间隔稳定且够长：每 3 秒一次，节奏恒定 —— 这已经是机器的特征
  ok('每 3 秒一次连 4 次 → 判卡键', feed(g, 0x20, [0, 3000, 6000, 9000]) === true);
}

console.log('③ 窗口外的旧样本要过期，不然一次误判会赖一辈子');
{
  const g = new StuckGuard();
  g.note(0x32, 0);
  g.note(0x32, 6000);
  g.note(0x32, 12000);
  // 隔了 2 分钟才再按 —— 前面 3 次早该被窗口（30 秒）扔掉
  const r = g.note(0x32, 132000);
  ok('隔了 2 分钟再按，不算第 4 发', r === false, r);
}

console.log('④ 不同按键各算各的');
{
  const g = new StuckGuard();
  g.note(0x32, 1000); g.note(0x48, 1200);
  g.note(0x32, 7000); g.note(0x48, 7200);
  ok('交替按，各 2 次 → 都够不着阈值（不判）', g.note(0x20, 13000) === false);
  ok('0x32 凑到第 3 次才判，没有被 0x48 摊薄', g.note(0x32, 13000) === true);
}

console.log('⑤ 静音与解除');
{
  const g = new StuckGuard();
  const m = g.mute(0x32, 19000);
  ok('第一次静音 30 秒', m.ms === 30000 && m.until === 19000 + 30000, JSON.stringify(m));
  ok('静音期间 isMuted 为真', g.isMuted(0x32, 20000) === true);
  ok('其它键不受影响', g.isMuted(0x20, 20000) === false);
  ok('到期后 isMuted 为假', g.isMuted(0x32, m.until) === false);
  const list = g.list(20000);
  ok('list() 能报出正在静音的键', list.length === 1 && list[0].usage === 0x32, JSON.stringify(list));
  ok('到期后 list() 为空', g.list(m.until).length === 0);

  const freed = g.sweep(m.until);
  ok('sweep() 返回刚解除的键', freed.length === 1 && freed[0] === 0x32, JSON.stringify(freed));
  ok('sweep() 之后不再静音', g.isMuted(0x32, m.until) === false);
}
{
  const g = new StuckGuard();
  g.mute(0x32); g.mute(0x48);
  const cleared = g.clear();
  ok('clear() 返回全部并清空', cleared.length === 2 && g.list().length === 0, JSON.stringify(cleared));
}

console.log('⑤b 反复卡住要退避，别一直 30 秒拉锯');
{
  const g = new StuckGuard();
  const a = g.mute(0x32, 0);
  const b = g.mute(0x32, 1000);
  const c = g.mute(0x32, 2000);
  ok('第 1 次 30 秒', a.ms === 30000, a.ms);
  ok('第 2 次 60 秒', b.ms === 60000, b.ms);
  ok('第 3 次 120 秒', c.ms === 120000, c.ms);
  ok('streak 在累加', c.streak === 3, c.streak);
  for (let i = 0; i < 12; i++) g.mute(0x32, 3000);
  ok('封顶 15 分钟', g.list(3000)[0].until - 3000 === 900000, g.list(3000)[0].until - 3000);
}
{
  const g = new StuckGuard({ streakResetMs: 600000 });
  g.mute(0x32, 0); g.mute(0x32, 100);
  // 10 分钟没再犯：重新从 30 秒算起
  const again = g.mute(0x32, 100 + 600001);
  ok('久不犯就重置退避', again.ms === 30000, again.ms);
}

console.log('⑥ 参数可覆盖（别把阈值写死）');
{
  const g = new StuckGuard({ need: 3, muteMs: 5000 });
  ok('need=3：第 3 发就判', feed(g, 0x32, [0, 6000, 12000]) === true);
  ok('muteMs=5000：只静音 5 秒', g.mute(0x32, 0).ms === 5000);
}

console.log('');
if (fail) {
  console.log(`❌ ${fail} 项失败`);
  process.exit(1);
}
console.log('✅ 全部通过');
