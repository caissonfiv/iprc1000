'use strict';
// 「这个键现在还按着吗」的记录器。
//
// 这个判断被改坏过两次，所以单独拿出来能单测：
//   · 第一次：漏了 KEY_UP，抬起被当成按下 → 每个键按一次就再也没反应；
//   · 第二次：过期时间 5 秒比遥控器卡键时的 6.000 秒重发周期还短 →
//     每一发重发都被当成「已经松开、又按了一下」，于是无限派发（满屏 m / Win+H）。
//
// 规则：
//   按下          → 记下时刻，返回「之前没按」（＝这是一次真正的按压）
//   同一个键又来按下 → 只刷新时刻，返回「已经在按」（＝重复上报，别派发）
//   抬起          → 立刻清掉
//   长时间没动静   → 认为设备漏发了抬起，兜底清掉（否则这个键永远没有反应）

const DEFAULTS = {
  // 必须大于遥控器卡键时的重发周期。实测 6.000 秒，抖动几毫秒，取 12 秒留余量。
  ttlMs: 12000,
};

class PressLatch {
  constructor(opt) {
    this.o = Object.assign({}, DEFAULTS, opt || {});
    this.at = new Map();   // usage -> 最近一次按下（或重复上报）的时刻
  }

  // 记一次按下。返回 true 表示「已经按着了」—— 这是重复，不是新的一次按压。
  down(usage, now = Date.now()) {
    const again = this.at.has(usage);
    this.at.set(usage, now);
    return again;
  }

  up(usage) {
    this.at.delete(usage);
  }

  has(usage) {
    return this.at.has(usage);
  }

  seenAt(usage) {
    return this.at.get(usage) || 0;
  }

  // 清掉久无动静的键，返回被清掉的 usage 列表
  sweep(now = Date.now()) {
    const freed = [];
    for (const [u, t] of [...this.at]) {
      if (now - t > this.o.ttlMs) {
        this.at.delete(u);
        freed.push(u);
      }
    }
    return freed;
  }

  clear() {
    this.at.clear();
  }
}

module.exports = { PressLatch, DEFAULTS };
