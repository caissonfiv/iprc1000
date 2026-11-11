'use strict';
// 服务端捕获链路测试：/api/capture → 注入按键 → 拿回键码
const http = require('http');
const inject = require('../src/inject');

const PORT = Number(process.env.TPORT || 7799);
const base = { host: '127.0.0.1', port: PORT };

function post(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...base, path, method: 'POST' }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ① 正常路径
  const t0 = Date.now();
  const p = post('/api/capture');
  await sleep(400);
  inject.combo([0x7c]);                  // F13，模拟电脑键盘；任何程序都不会响应它
  const r = await p;
  const dt = Date.now() - t0;
  const ok1 = r && Array.isArray(r.keys) && r.keys.join(',') === '124';
  console.log(`① 注入 F13 → ${JSON.stringify(r)}  (${dt} ms)  ${ok1 ? '✅' : '❌'}`);

  // ② 取消路径：必须立刻返回，不能挂着
  const t1 = Date.now();
  const p2 = post('/api/capture');
  await sleep(250);
  await post('/api/capture/cancel');
  const r2 = await p2;
  const dt2 = Date.now() - t1;
  const ok2 = r2 && Array.isArray(r2.keys) && r2.keys.length === 0 && dt2 < 2000;
  console.log(`② 取消捕获 → ${JSON.stringify(r2)}  (${dt2} ms)  ${ok2 ? '✅ 立即返回' : '❌ 卡住'}`);

  // ③ 取消之后，按键要恢复正常（不能再被吞）
  const p3 = post('/api/capture');
  await sleep(300);
  inject.combo([0x10, 0x86]);            // Shift+F23
  const r3 = await p3;
  const ok3 = r3 && r3.keys.join(',') === '16,134';
  console.log(`③ 取消后重新录制 Shift+F23 → ${JSON.stringify(r3)}  ${ok3 ? '✅' : '❌'}`);

  console.log(ok1 && ok2 && ok3 ? '\n✅ 服务端捕获链路全部通过' : '\n❌ 有用例失败');
  process.exit(ok1 && ok2 && ok3 ? 0 : 1);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });
