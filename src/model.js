'use strict';
// 键名与动作模型
const MODS = { ctrl: 0x11, alt: 0x12, shift: 0x10, win: 0x5b };
const MOD_VKS = new Set([0x10, 0x11, 0x12, 0x5b, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5c, 0x5d]);

const VK_NAMES = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0d: 'Enter', 0x13: 'Pause', 0x1b: 'Esc', 0x20: 'Space',
  0x21: 'PageUp', 0x22: 'PageDown', 0x23: 'End', 0x24: 'Home',
  0x25: '←', 0x26: '↑', 0x27: '→', 0x28: '↓',
  0x2c: 'PrtSc', 0x2d: 'Insert', 0x2e: 'Delete', 0x5b: 'Win', 0x5d: 'Menu',
  0x90: 'NumLock', 0x91: 'ScrollLock',
  0xa0: 'LShift', 0xa1: 'RShift', 0xa2: 'LCtrl', 0xa3: 'RCtrl', 0xa4: 'LAlt', 0xa5: 'RAlt',
  0xad: '静音', 0xae: '音量-', 0xaf: '音量+',
  0xb0: '下一曲', 0xb1: '上一曲', 0xb2: '停止', 0xb3: '播放/暂停',
  0xba: ';', 0xbb: '=', 0xbc: ',', 0xbd: '-', 0xbe: '.', 0xbf: '/', 0xc0: '`',
  0xdb: '[', 0xdc: '\\', 0xdd: ']', 0xde: "'",
};
for (let i = 0x30; i <= 0x39; i++) VK_NAMES[i] = String(i - 0x30);
for (let i = 0x41; i <= 0x5a; i++) VK_NAMES[i] = String.fromCharCode(i);
for (let i = 0x60; i <= 0x69; i++) VK_NAMES[i] = 'Num' + (i - 0x60);
for (let i = 0x70; i <= 0x87; i++) VK_NAMES[i] = 'F' + (i - 0x70 + 1);

function vkName(vk) {
  return VK_NAMES[vk] || ('VK_0x' + vk.toString(16).toUpperCase());
}

function keysLabel(keys) {
  if (!Array.isArray(keys) || !keys.length) return '—';
  const out = [];
  const rest = [];
  for (const k of keys) {
    if (k === 0x11) out.push('Ctrl');
    else if (k === 0x12) out.push('Alt');
    else if (k === 0x10) out.push('Shift');
    else if (k === 0x5b) out.push('Win');
    else rest.push(vkName(k));
  }
  return [...out, ...rest].join('+');
}

function actionLabel(action) {
  if (!action) return '未设置';
  if (action.type === 'keys') return keysLabel(action.keys);
  if (action.type === 'voice') return '按住说话（' + keysLabel(action.keys) + '）';
  if (action.type === 'text') return '粘贴：' + (action.text || '').slice(0, 24);
  if (action.type === 'none') return '不执行';
  if (action.type === 'native') return '系统原生（不重复注入）';
  return '未映射（原样输入）';
}

// 常用预设
const PRESETS = [
  { id: 'enter', name: 'Enter', action: { type: 'keys', keys: [0x0d] } },
  { id: 'esc', name: 'Esc', action: { type: 'keys', keys: [0x1b] } },
  { id: 'backspace', name: 'Backspace', action: { type: 'keys', keys: [0x08] } },
  { id: 'up', name: '↑', action: { type: 'keys', keys: [0x26] } },
  { id: 'down', name: '↓', action: { type: 'keys', keys: [0x28] } },
  { id: 'left', name: '←', action: { type: 'keys', keys: [0x25] } },
  { id: 'right', name: '→', action: { type: 'keys', keys: [0x27] } },
  { id: 'tab', name: 'Tab', action: { type: 'keys', keys: [0x09] } },
  { id: 'volup', name: '音量+', action: { type: 'keys', keys: [0xaf] } },
  { id: 'voldown', name: '音量-', action: { type: 'keys', keys: [0xae] } },
  { id: 'mute', name: '静音', action: { type: 'keys', keys: [0xad] } },
  { id: 'playpause', name: '播放/暂停', action: { type: 'keys', keys: [0xb3] } },
  { id: 'winl', name: 'Win+L 锁屏', action: { type: 'keys', keys: [0x5b, 0x4c] } },
  { id: 'wind', name: 'Win+D 桌面', action: { type: 'keys', keys: [0x5b, 0x44] } },
  { id: 'snipping', name: 'Win+Shift+S 截图', action: { type: 'keys', keys: [0x5b, 0x10, 0x53] } },
  { id: 'ralt_voice', name: '语音：按住右 Alt', action: { type: 'voice', keys: [0xa5] } },
  { id: 'ctrlwin_voice', name: '语音：按住 Ctrl+Win', action: { type: 'voice', keys: [0x11, 0x5b] } },
  // Windows 自带的语音输入：按下就开麦，说完自动上屏，最省事的一条路。
  // 前提是「CABLE Output」是默认录音设备、并且语音桥接（mic-live.cmd）在跑。
  { id: 'dictate', name: '语音输入 Win+H', action: { type: 'keys', keys: [0x5b, 0x48] } },
  // WorkBuddy 自己的语音输入（设置 → 键盘快捷键里的「语音录制」，Windows 默认 Ctrl+D）。
  // 注意它只是应用内快捷键，不是全局热键：只有 WorkBuddy 窗口在前台时才生效。
  { id: 'dictate_wb', name: '语音：WorkBuddy（Ctrl+D）', action: { type: 'keys', keys: [0x11, 0x44] } },
  { id: 'none', name: '不执行', action: { type: 'none' } },
];

module.exports = { MODS, MOD_VKS, vkName, keysLabel, actionLabel, PRESETS };
