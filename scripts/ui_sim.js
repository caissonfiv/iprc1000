'use strict';
// 用最小 DOM 仿真跑一遍 ui/index.html 的内联脚本，验证「点录制 → 按组合键」链路
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function mkEl(id) {
  const cls = new Set();
  return {
    id, textContent: '', innerHTML: '', value: '', disabled: false, dataset: {}, children: [],
    style: {}, scrollTop: 0, scrollHeight: 0,
    className: '',
    classList: {
      add: c => cls.add(c),
      remove: c => cls.delete(c),
      contains: c => cls.has(c),
      toggle: (c, on) => (on === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : (on ? cls.add(c) : cls.delete(c))),
    },
    appendChild(n) { this.children.push(n); },
    removeChild() {}, querySelectorAll: () => [], focus() { focused = id; }, blur() { if (focused === id) focused = null; },
    onclick: null,
  };
}
let focused = null;
const els = new Map();
const getEl = id => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); };

const listeners = [];
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  AbortController,
  document: { getElementById: getEl, createElement: () => mkEl('tmp') },
  window: {
    addEventListener: (t, fn, cap) => listeners.push({ t, fn, cap }),
    removeEventListener: (t, fn) => {
      const i = listeners.findIndex(l => l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    focus: () => { focused = 'window'; },
  },
  fetch: (url) => {
    if (url === '/api/state') {
      return Promise.resolve({ json: () => Promise.resolve({ keys: [], presets: [], connected: true, source: 'intercept' }) });
    }
    if (url === '/api/capture') return new Promise(() => {});   // 服务端一直挂着，模拟没人按键
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  },
  EventSource: class { constructor() { this.onmessage = null; } },
  Date, Math, JSON, Promise, Set, Map, Number, String, Array, Object, Error, parseInt,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'ui-inline.js' });

const fire = (type, ev) => {
  let hit = 0;
  for (const l of listeners.slice()) if (l.t === type) { l.fn(ev); hit++; }
  return hit;
};

setTimeout(() => {
  const btnRec = getEl('btnRec');
  const box = getEl('recBox');
  let prevented = 0;

  btnRec.onclick({ preventDefault: () => prevented++, currentTarget: btnRec });
  console.log('点击录制后：按钮文案 =', JSON.stringify(btnRec.textContent),
              '| 禁用 =', btnRec.disabled,
              '| 提示 =', JSON.stringify(box.textContent),
              '| 脉冲 =', box.classList.contains('on'));

  // 先按 Ctrl(17)
  fire('keydown', { keyCode: 17, preventDefault() {}, stopPropagation() {} });
  console.log('按住 Ctrl 后 ：', JSON.stringify(box.textContent));

  // 再按 S(83)
  fire('keydown', { keyCode: 83, preventDefault() {}, stopPropagation() {} });
  console.log('按下 S 之后：', JSON.stringify(box.textContent));
  console.log('按钮恢复  ：', JSON.stringify(btnRec.textContent), '| 禁用 =', btnRec.disabled);
  console.log('监听器残留：', listeners.length, '| preventDefault 次数 =', prevented);

  const ok = box.textContent === 'Ctrl+S' && btnRec.disabled === false && listeners.length === 0;
  console.log(ok ? '\n✅ 录制链路通过' : '\n❌ 录制链路失败');

  // 再来一次，验证第二次点击仍可用（冷却之后）
  setTimeout(() => {
    btnRec.onclick({ preventDefault() {}, currentTarget: btnRec });
    fire('keydown', { keyCode: 91, preventDefault() {}, stopPropagation() {} });
    fire('keydown', { keyCode: 68, preventDefault() {}, stopPropagation() {} });
    console.log('第二次录制 ：', JSON.stringify(box.textContent),
                box.textContent === 'Win+D' ? '✅' : '❌');
    process.exit(ok ? 0 : 1);
  }, 400);
}, 60);
