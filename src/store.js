'use strict';
// 配置读写
const fs = require('fs');
const path = require('path');

// 配置目录：桌面版把 IPRC_DATA 指到 exe 同级的 config\，
// 这样重新打包不会把用户改过的配置覆盖掉（绿色软件的做法）。
const DIR = process.env.IPRC_DATA || path.join(__dirname, '..', 'config');
const FILE = path.join(DIR, 'keymap.json');

const DEFAULTS = {
  version: 1,
  map: {},
};

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { ...DEFAULTS, ...raw, map: raw.map || {} };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function save(cfg) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = { load, save, FILE };
