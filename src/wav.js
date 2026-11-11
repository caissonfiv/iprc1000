'use strict';
// 极简 WAV（PCM）解析与电平统计
// 目的：抓到音频后能立刻判断「里面到底有没有声音」，而不是只看到文件大小就以为成功。
const fs = require('fs');

function parse(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 44) throw new Error('文件太小，不是有效 WAV');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是 RIFF/WAVE 格式');
  }

  let off = 12;
  let fmt = null;
  let dataOff = -1;
  let dataLen = 0;

  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        byteRate: buf.readUInt32LE(body + 8),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = Math.min(size, buf.length - body);
      // 有些写入器把 data 长度写错，宁可截到文件尾
      if (!size || size === 0xffffffff) dataLen = buf.length - body;
    }
    off = body + size + (size % 2); // 块按偶数字节对齐
  }

  if (!fmt) throw new Error('缺少 fmt 块');
  if (dataOff < 0) throw new Error('缺少 data 块');

  return {
    ...fmt,
    dataOff,
    dataLen,
    duration: dataLen / (fmt.byteRate || 1),
    bytes: buf.length,
    raw: buf,
  };
}

// 逐样本统计（只处理 16bit PCM，这颗遥控器就是 16bit）
function stats(w) {
  if (w.bits !== 16) throw new Error('只支持 16bit PCM，当前 ' + w.bits + 'bit');
  const ch = w.channels || 1;
  const total = Math.floor(w.dataLen / (2 * ch));
  const buf = w.raw;

  let peak = 0;
  let sumSq = 0;
  let n = 0;

  // 每 100ms 一个窗口，用来判断"有没有人说话"
  const win = Math.max(1, Math.round(w.sampleRate / 10));
  const winRms = [];
  let acc = 0;
  let accN = 0;

  for (let i = 0; i < total; i++) {
    // 多声道取平均
    let s = 0;
    for (let c = 0; c < ch; c++) s += buf.readInt16LE(w.dataOff + (i * ch + c) * 2);
    s = Math.round(s / ch);
    const a = Math.abs(s);
    if (a > peak) peak = a;
    sumSq += s * s;
    n++;
    acc += s * s;
    accN++;
    if (accN >= win) {
      winRms.push(Math.sqrt(acc / accN) / 32768);
      acc = 0;
      accN = 0;
    }
  }
  if (accN) winRms.push(Math.sqrt(acc / accN) / 32768);

  const rms = n ? Math.sqrt(sumSq / n) / 32768 : 0;
  const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  const THRESH = 0.003; // 约 -50 dBFS，明显高于本底噪声

  const active = winRms.map(v => v > THRESH);
  const activeCount = active.filter(Boolean).length;
  const first = active.indexOf(true);
  const last = active.lastIndexOf(true);

  return {
    samples: n,
    peak,
    peakDb: db(peak / 32768),
    rmsDb: db(rms),
    windows: winRms.length,
    activeWindows: activeCount,
    activeRatio: winRms.length ? activeCount / winRms.length : 0,
    firstActiveSec: first < 0 ? -1 : first / 10,
    lastActiveSec: last < 0 ? -1 : last / 10,
  };
}

module.exports = { parse, stats };
