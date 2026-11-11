'use strict';
// 回归测试：组合键的注入顺序与节奏
//
// 背景：2026-11-11 晚上，遥控器连按了「上一个频道(Win+L) → 收藏(Win+D ×2) → 语音(Win+H)」
// 之后整台机器「卡死」。嫌疑是组合键被一口气塞进同一个 SendInput 调用：
// Windows 外壳按「拍」处理 Win 键，四件事挤在同一拍里就可能把 Win 留在按下状态，
// 于是所有快捷键失灵、开始菜单乱弹。这里盯住展开顺序：修饰键先按、最后松。

const { comboPlan } = require('../src/inject');

let fail = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { fail++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  →  ' + extra)); }
}

const seq = plan => plan.filter(s => !s.safety).map(s => (s.down ? '↓' : '↑') + '0x' + s.vk.toString(16));

console.log('① Win+H（语音键）展开顺序');
{
  const p = comboPlan([0x5b, 0x48]);
  ok('节奏：↓Win ↓H ↑H ↑Win', seq(p).join(' ') === '↓0x5b ↓0x48 ↑0x48 ↑0x5b', seq(p).join(' '));
  ok('修饰键第一个按下', p[0].vk === 0x5b && p[0].down === true);
  ok('修饰键最后松开（不看收尾保险）',
     seq(p).slice(-1)[0] === '↑0x5b', seq(p).slice(-1)[0]);
  ok('时间严格递增，没有两步同拍',
     p.filter(s => !s.safety).every((s, i, a) => i === 0 || s.at > a[i - 1].at),
     p.filter(s => !s.safety).map(s => s.at).join(','));
}

console.log('② Ctrl+V（粘贴）');
{
  const p = comboPlan([0x11, 0x56]);
  ok('节奏：↓Ctrl ↓V ↑V ↑Ctrl', seq(p).join(' ') === '↓0x11 ↓0x56 ↑0x56 ↑0x11', seq(p).join(' '));
}

console.log('③ 三个键的组合（如 Win+Shift+S）');
{
  const p = comboPlan([0x5b, 0x10, 0x53]);
  ok('按下顺序与给定一致', seq(p).slice(0, 3).join(' ') === '↓0x5b ↓0x10 ↓0x53', seq(p).slice(0, 3).join(' '));
  ok('抬起顺序是逆序', seq(p).slice(3, 6).join(' ') === '↑0x53 ↑0x10 ↑0x5b', seq(p).slice(3, 6).join(' '));
}

console.log('④ 收尾保险：每个键都要被补一次抬起');
{
  const p = comboPlan([0x5b, 0x48]);
  const safety = p.filter(s => s.safety);
  ok('两个键各补一次', safety.length === 2, safety.length);
  ok('补的全是抬起', safety.every(s => s.down === false));
  ok('补在最后一步之后', safety.every(s => s.at > Math.max(...p.filter(x => !x.safety).map(x => x.at))));
}

console.log('⑤ 边界');
{
  ok('空数组不产生任何动作', comboPlan([]).length === 0);
  ok('全是 0 也不产生动作（0 不是合法虚拟键码）', comboPlan([0, 0]).length === 0);
  ok('负数被过滤', comboPlan([-1, 0x48]).filter(s => s.vk === 0x48).length === 3);
  const p = comboPlan([0x5b, 0x48], 25);
  ok('间隔可配（25ms）', p[1].at === 25, p[1].at);
}

console.log('⑥ 每个按下的键都必须有对应的抬起（不留卡键）');
{
  for (const keys of [[0x5b, 0x48], [0x11, 0x56], [0x5b, 0x10, 0x53], [0xad]]) {
    const p = comboPlan(keys);
    // 只看「有哪些键被抬起过」：收尾保险会重复发抬起，重复本身无害。
    const downs = [...new Set(p.filter(s => s.down).map(s => s.vk))].sort();
    const ups = [...new Set(p.filter(s => !s.down).map(s => s.vk))].sort();
    const covered = downs.length === ups.length && downs.every((v, i) => v === ups[i]);
    ok('[' + keys.map(k => '0x' + k.toString(16)).join(',') + '] 每个按下都有抬起', covered,
       JSON.stringify({ downs, ups }));
  }
}

console.log('');
if (fail) {
  console.log(`❌ ${fail} 项失败`);
  process.exit(1);
}
console.log('✅ 全部通过');
