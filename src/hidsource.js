'use strict';
// 直读 HID 报文（需要设备驱动是「符合 HID 标准的设备」，不是键盘）
// 用 node-hid 的后台线程读取，拿到完整 report bytes
const HID = require('node-hid');

const VID = 0x0a5c;
const PID = 0x8502;

function find() {
  const d = HID.devices().find(x => x.vendorId === VID && x.productId === PID);
  return d || null;
}

/**
 * 打开设备并开始读报文。
 * @param {(ev:{keys:Set<number>, raw:number[]}) => void} onReport 每次收到报文
 * @returns {{ok:boolean, error?:string, close:Function}}
 */
function open(onReport, onFail) {
  const dev = find();
  if (!dev) return { ok: false, error: '未找到设备', close() {} };

  let h;
  try {
    h = new HID.HID(dev.path);
  } catch (e) {
    return { ok: false, error: e.message || String(e), close() {} };
  }

  let prev = new Set();
  let dead = false;

  // 打开成功不代表能读：驱动还是键盘(kbdhid)时 ReadFile 会返回 ACCESS_DENIED
  h.on('error', e => {
    if (dead) return;
    dead = true;
    const msg = (e && e.message) || String(e);
    try { h.close(); } catch {}
    if (onFail) onFail(msg);
  });

  h.on('data', buf => {
    if (dead) return;
    // 去掉可能的 report id（node-hid 会在开头带上 report id）
    const bytes = [...buf];
    const body = bytes.length >= 9 ? bytes.slice(1) : bytes;
    // 标准键盘报文：[修饰键][保留][key1..key6]
    const keys = new Set();
    if (body.length >= 3) {
      for (let i = 2; i < body.length; i++) {
        const u = body[i];
        if (u) keys.add(u);
      }
    }

    // 差分出按下/抬起
    const down = [...keys].filter(k => !prev.has(k));
    const up = [...prev].filter(k => !keys.has(k));

    for (const k of down) onReport({ id: k, down: true, raw: bytes });
    for (const k of up) onReport({ id: k, down: false, raw: bytes });
    prev = keys;
  });

  return {
    ok: true,
    get dead() { return dead; },
    close() { dead = true; try { h.close(); } catch {} },
  };
}

module.exports = { open, find };
