'use strict';
// 遥控器面板布局。兼容字段 usage 实际是 PS/2 扫描码，不是 HID usage。
// 为什么要这一层：光有 keymap（用法码 → 动作）没法画图，
// 图上得知道「哪个坑是哪个码」。坑位 ↔ 码的对应关系由用户按一次键来确认。
const fs = require('fs');
const path = require('path');
const { SCAN_CODES } = require('./device-profile');

const DATA_DIR = process.env.IPRC_DATA || path.join(__dirname, '..', 'config');
const FILE = path.join(DATA_DIR, 'layout.json');

// 遥控器图上的坑位，顺序和真机一致（上 → 下，左 → 右）。
// 新安装使用实测位置；已有配置（包括主动解绑）始终优先。
const SLOTS = [
  { id: 'pwr',     name: '电源' },

  { id: 'back',    name: '返回' },
  { id: 'up',      name: '上',        usage: 0x48 },
  { id: 'menu',    name: '菜单' },

  { id: 'left',    name: '左 / 上一段', usage: 0x4b },
  { id: 'ok',      name: 'OK',        usage: 0x1c },
  { id: 'right',   name: '右 / 下一段', usage: 0x4d },

  { id: 'exit',    name: '退出' },
  { id: 'down',    name: '下',        usage: 0x50 },
  { id: 'info',    name: '信息' },

  { id: 'fav',     name: '收藏（心）' },
  { id: 'mic',     name: '语音',      usage: 0x32 },
  { id: 'me',      name: '我的（人头）' },

  { id: 'rew',     name: '快退' },
  { id: 'play',    name: '播放 / 暂停' },
  { id: 'ffwd',    name: '快进' },

  { id: 'volup',   name: '音量 +' },
  { id: 'voldown', name: '音量 −' },
  { id: 'chup',    name: '频道 +' },
  { id: 'chdown',  name: '频道 −' },

  { id: 'mute',    name: '静音' },
  { id: 'last',    name: '上一个频道' },
].map(slot => ({ ...slot, usage: SCAN_CODES[slot.id] }));

const SLOT_IDS = new Set(SLOTS.map(s => s.id));

let bind = {};        // slotId -> usage
let customNames = {}; // slotId -> 用户改的名字

function load() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { raw = null; }
  if (!raw || typeof raw !== 'object') {
    // 首次运行：把出厂猜测写进配置，之后一切以配置为准
    bind = {};
    for (const s of SLOTS) if (typeof s.usage === 'number') bind[s.id] = s.usage;
    customNames = {};
    save();
    return;
  }
  bind = {};
  for (const [k, v] of Object.entries(raw.bind || {})) {
    if (SLOT_IDS.has(k) && Number.isInteger(v) && v >= 0 && v < 256) bind[k] = v;
  }
  customNames = {};
  for (const [k, v] of Object.entries(raw.names || {})) {
    if (SLOT_IDS.has(k) && typeof v === 'string' && v.trim()) customNames[k] = v.trim().slice(0, 12);
  }
}

function save() {
  const out = { version: 1, bind, names: customNames };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n');
  } catch (e) { /* 只读目录时忽略 */ }
}

function set(slotId, usage) {
  if (!SLOT_IDS.has(slotId)) return false;
  if (usage === null || usage === undefined) delete bind[slotId];
  else bind[slotId] = Number(usage);
  save();
  return true;
}

function rename(slotId, name) {
  if (!SLOT_IDS.has(slotId)) return false;
  if (name && String(name).trim()) customNames[slotId] = String(name).trim().slice(0, 12);
  else delete customNames[slotId];
  save();
  return true;
}

function slotOf(usage) {
  for (const [slot, u] of Object.entries(bind)) if (u === usage) return slot;
  return null;
}

function usageOf(slotId) {
  return Object.prototype.hasOwnProperty.call(bind, slotId) ? bind[slotId] : null;
}

function list() {
  return SLOTS.map(s => ({
    id: s.id,
    name: customNames[s.id] || s.name,
    defaultName: s.name,
    usage: usageOf(s.id),
  }));
}

load();

module.exports = { SLOTS, load, save, set, rename, slotOf, usageOf, list, FILE };
