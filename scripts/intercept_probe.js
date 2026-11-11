'use strict';
// 诊断：Interception 驱动是否可用 + 它看到的每台键盘
// 用法：node scripts/intercept_probe.js
const ffi = require('../src/interception-ffi');

console.log('DLL 路径 :', ffi.DLL_PATH);
console.log('DLL 存在 :', ffi.dllExists());
if (!ffi.dllExists()) process.exit(1);

let api;
try {
  api = ffi.load();
  console.log('加载 DLL : 成功');
} catch (e) {
  console.log('加载 DLL : 失败 —', e.message);
  process.exit(1);
}

let ctx;
try {
  ctx = api.create();
} catch (e) {
  console.log('创建上下文: 抛异常 —', e.message);
  process.exit(1);
}

if (!ctx || ctx === 0n) {
  console.log('');
  console.log('创建上下文: 失败（返回 NULL）');
  console.log('');
  console.log('→ 说明 KeyboardFilter 驱动没有安装或没有运行。');
  console.log('→ 请右键「以管理员身份运行」enable-clean-mode.cmd，然后重跑本脚本。');
  process.exit(2);
}

console.log('创建上下文: 成功（驱动已就绪）');
console.log('');

const { list, hit } = ffi.findRemoteKeyboard(api, ctx);
console.log(`Interception 看到 ${list.length} 台键盘：`);
for (const k of list) {
  const mark = hit && hit.device === k.device ? '  <== 遥控器 ★' : '';
  console.log(`  device ${String(k.device).padStart(2)}  ${k.hwid || '（读不到硬件ID）'}${mark}`);
}
console.log('');
console.log(hit ? `遥控器定位成功：device ${hit.device}` : '没有匹配到遥控器（VID 0A5C / PID 8502）');

try { api.destroy(ctx); } catch {}
