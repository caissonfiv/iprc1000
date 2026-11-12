'use strict';
// 配置读写
const fs = require('fs');
const path = require('path');
const { defaultKeymap } = require('./device-profile');

// 配置目录：桌面版把 IPRC_DATA 指到 exe 同级的 config\，
// 这样重新打包不会把用户改过的配置覆盖掉（绿色软件的做法）。
const DIR = process.env.IPRC_DATA || path.join(__dirname, '..', 'config');
const FILE = path.join(DIR, 'keymap.json');

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!raw || typeof raw !== 'object' || !raw.map || typeof raw.map !== 'object' || Array.isArray(raw.map)) {
      throw new Error('无效的按键配置');
    }
    return { version: 1, ...raw }; // Never reintroduce actions deliberately cleared by a user.
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // Preserve unreadable configuration before later edits can replace it.
      fs.copyFileSync(FILE, FILE + '.corrupt-' + Date.now());
    }
    return defaultKeymap();
  }
}

function save(cfg) {
  fs.mkdirSync(DIR, { recursive: true });
  const temp = FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, FILE);
}

module.exports = { load, save, FILE };
