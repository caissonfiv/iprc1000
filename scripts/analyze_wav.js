'use strict';
// 分析一个 WAV：时长 / 峰值 / RMS / 有声占比
// 用法：node scripts/analyze_wav.js out/mic.wav
const path = require('path');
const wav = require('../src/wav');

const f = process.argv[2];
if (!f) {
  console.error('用法: node scripts/analyze_wav.js <文件.wav>');
  process.exit(1);
}

const p = path.resolve(f);
const w = wav.parse(p);
const s = wav.stats(w);

const fmtDb = v => (v === -Infinity ? '-inf' : v.toFixed(1));
const verdict = s.activeRatio > 0.05 && s.peakDb > -35;

console.log('文件      :', p);
console.log('格式      :', `${w.sampleRate} Hz / ${w.channels} 声道 / ${w.bits} bit`);
console.log('时长      :', w.duration.toFixed(2), '秒');
console.log('样本数    :', s.samples);
console.log('峰值      :', fmtDb(s.peakDb), 'dBFS');
console.log('RMS       :', fmtDb(s.rmsDb), 'dBFS');
console.log('有声窗口  :', `${s.activeWindows}/${s.windows}`, `(${(s.activeRatio * 100).toFixed(0)}%)`);
if (s.firstActiveSec >= 0) {
  console.log('有声区间  :', `${s.firstActiveSec.toFixed(1)}s ~ ${s.lastActiveSec.toFixed(1)}s`);
}
console.log('');
console.log(verdict ? '✅ 抓到声音了' : '❌ 全是静音／噪声底 —— 没抓到有效音频');
process.exit(verdict ? 0 : 2);
