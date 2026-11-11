'use strict';
// 卡键 / 连发识别。
//
// 现象：遥控器的语音键按下之后，固件会每隔 6.000 秒把同一个键再发一遍，
// 一直发下去（实测连续 5 分钟以上，抖动只有几毫秒）。人按不出这么整齐的节奏 ——
// 真按的间隔忽长忽短，机器发的是固定周期。所以用「间隔抖动」区分人和机器。
//
// 抽成独立模块纯粹是为了能单测：逻辑一旦写错，代价是满屏 mmmmmm 或者键全失灵。

const DEFAULTS = {
  windowMs: 30000,    // 只看最近 30 秒内的按下
  need: 3,            // 3 次按下 = 2 个间隔，两个间隔一样齐就够判了
  // 抖动阈值不能放宽：人手按得再匀，间隔也会差三四百毫秒；
  // 机器重发实测是 0~50ms 的硬周期。350ms 两边都不会夹到。
  jitterMs: 350,
  muteMs: 30000,      // 第一次判定卡键，静音 30 秒
  maxMuteMs: 900000,  // 反复卡住就翻倍退避，封顶 15 分钟
  streakResetMs: 600000, // 10 分钟没再犯，重新从 30 秒算起
  minGapMs: 800,      // 间隔比这还短说明是人在连点，不算卡键
};

class StuckGuard {
  constructor(opt) {
    this.o = Object.assign({}, DEFAULTS, opt || {});
    this.taps = new Map();    // usage -> number[]
    this.muted = new Map();   // usage -> 到期时刻
    this.streak = new Map();  // usage -> 连续被判卡键的次数（用来退避）
    this.lastAt = new Map();  // usage -> 上次记「按下」的时刻（用来清空 streak）
  }

  // 久不犯案就把账一笔勾销（不然一次卡键会让这个键永远被重罚）
  _touch(usage, now) {
    const prev = this.lastAt.get(usage) || 0;
    if (prev && now - prev > this.o.streakResetMs) {
      this.streak.delete(usage);
      this.taps.delete(usage);
    }
    this.lastAt.set(usage, now);
  }

  // 记一次「按下」。返回 true 表示这次是机器在连发。
  note(usage, now = Date.now()) {
    const o = this.o;
    this._touch(usage, now);

    const arr = (this.taps.get(usage) || []).filter(t => now - t <= o.windowMs);
    arr.push(now);
    this.taps.set(usage, arr);
    if (arr.length < o.need) return false;

    const gaps = [];
    for (let i = 1; i < arr.length; i++) gaps.push(arr[i] - arr[i - 1]);
    const recent = gaps.slice(-(o.need - 1));
    const min = Math.min.apply(null, recent);
    const max = Math.max.apply(null, recent);
    return min >= o.minGapMs && (max - min) <= o.jitterMs;
  }

  // 静音这个键。连续被判卡键就翻倍，避免「30 秒 → 又犯 → 30 秒」的拉锯。
  // 返回 { until, ms, streak }
  mute(usage, now = Date.now()) {
    const o = this.o;
    this._touch(usage, now);
    const streak = (this.streak.get(usage) || 0) + 1;
    this.streak.set(usage, streak);
    const ms = Math.min(o.maxMuteMs, o.muteMs * Math.pow(2, streak - 1));
    const until = now + ms;
    this.muted.set(usage, until);
    return { until, ms, streak };
  }

  isMuted(usage, now = Date.now()) {
    const until = this.muted.get(usage);
    return !!until && now < until;
  }

  list(now = Date.now()) {
    const out = [];
    for (const [usage, until] of this.muted) if (until > now) out.push({ usage, until });
    return out;
  }

  // 清掉过期的静音，返回刚刚解除的 usage 列表
  sweep(now = Date.now()) {
    const freed = [];
    for (const [usage, until] of [...this.muted]) {
      if (now >= until) {
        this.muted.delete(usage);
        this.taps.delete(usage);
        freed.push(usage);
      }
    }
    return freed;
  }

  clear() {
    const all = [...this.muted.keys()];
    this.muted.clear();
    this.taps.clear();
    this.streak.clear();
    this.lastAt.clear();
    return all;
  }
}

module.exports = { StuckGuard, DEFAULTS };
