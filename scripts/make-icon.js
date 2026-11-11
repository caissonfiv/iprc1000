'use strict';
// 生成应用图标 ui/icon.ico（256×256，内部 1024×1024 超采样后缩下来）
// 不依赖任何图形库：自己画 SDF + 自己编 PNG + 自己套 ICO 壳。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'ui', 'icon.ico');

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- 画图 ----------
const SS = 4;            // 超采样倍数
const SZ = 256;
const BIG = SZ * SS;
const img = new Float32Array(BIG * BIG * 4);   // RGBA 累加（0..1）

function over(x, y, r, g, b, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= BIG || y >= BIG) return;
  const i = (y * BIG + x) * 4;
  const ia = 1 - a;
  img[i]     = r * a + img[i] * ia;
  img[i + 1] = g * a + img[i + 1] * ia;
  img[i + 2] = b * a + img[i + 2] * ia;
  img[i + 3] = a + img[i + 3] * ia;
}

// 圆角矩形的有向距离（内部为负）
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function coverage(sd) {           // 1px 抗锯齿
  return Math.min(1, Math.max(0, 0.5 - sd));
}

function paint(size, color, fn) {
  const a = Math.min(1, Math.max(0, size));
  if (a <= 0) return 0;
  fn(a, color);
  return 1;
}

// 主体：机身 + 方向键环 + 中心点 + 顶部话筒
function drawAll() {
  for (let y = 0; y < BIG; y++) {
    for (let x = 0; x < BIG; x++) {
      const px = x / SS, py = y / SS;
      // 阴影
      const sdShadow = sdRoundRect(px, py - 3, 128, 128, 62, 116, 34);
      paint(coverage(sdShadow + 1.5) * 0.20, [15, 23, 42], (a, c) => over(x, y, c[0] / 255, c[1] / 255, c[2] / 255, a));

      // 机身
      const sdBody = sdRoundRect(px, py, 128, 128, 60, 114, 32);
      const cov = coverage(sdBody);
      if (cov > 0) {
        // 竖向渐变：上白下浅灰蓝
        const t = Math.min(1, Math.max(0, (py - 14) / 228));
        const c = [
          255 - 24 * t,
          255 - 20 * t,
          255 - 10 * t,
        ];
        over(x, y, c[0] / 255, c[1] / 255, c[2] / 255, cov);
        // 描边
        const edge = coverage(Math.abs(sdBody + 1) - 1) * 0.35;
        if (edge > 0) over(x, y, 0.83, 0.86, 0.90, edge);
      }

      // 方向键底盘
      const sdRingArea = sdCircle(px, py, 128, 150, 46);
      const ringCov = coverage(sdRingArea);
      if (ringCov > 0) over(x, y, 0.93, 0.95, 0.98, ringCov);

      // 蓝色圆环
      const sdRing = Math.abs(sdCircle(px, py, 128, 150, 34)) - 4;
      const rc = coverage(sdRing);
      if (rc > 0) over(x, y, 0.145, 0.388, 0.921, rc);

      // 中心点
      const dc = coverage(sdCircle(px, py, 128, 150, 11));
      if (dc > 0) over(x, y, 0.145, 0.388, 0.921, dc);

      // 四个方向小三角（用圆点近似，够小不糊）
      for (const [dx, dy] of [[0, -46], [0, 46], [-46, 0], [46, 0]]) {
        const t = coverage(sdCircle(px, py, 128 + dx, 150 + dy, 5));
        if (t > 0) over(x, y, 0.35, 0.42, 0.52, t);
      }

      // 话筒键
      const mc = coverage(sdCircle(px, py, 128, 52, 13));
      if (mc > 0) over(x, y, 0.145, 0.388, 0.921, mc * 0.9);
      const mc2 = coverage(sdCircle(px, py, 128, 52, 7));
      if (mc2 > 0) over(x, y, 1, 1, 1, mc2);

      // 底部三个小按键
      for (const dx of [-30, 0, 30]) {
        const bc = coverage(sdRoundRect(px, py, 128 + dx, 218, 11, 6, 5));
        if (bc > 0) over(x, y, 0.78, 0.82, 0.88, bc);
      }
    }
  }
}

drawAll();

// ---------- 缩到 256 × 256 ----------
const out = Buffer.alloc(SZ * SZ * 4);
for (let y = 0; y < SZ; y++) {
  for (let x = 0; x < SZ; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * BIG + (x * SS + sx)) * 4;
        const al = img[i + 3];
        r += img[i] ; g += img[i + 1]; b += img[i + 2]; a += al;
      }
    }
    const n = SS * SS;
    const A = a / n;
    const o = (y * SZ + x) * 4;
    out[o]     = A > 0 ? Math.round(Math.min(255, (r / n) / Math.max(A, 0.0001) * 255)) : 0;
    out[o + 1] = A > 0 ? Math.round(Math.min(255, (g / n) / Math.max(A, 0.0001) * 255)) : 0;
    out[o + 2] = A > 0 ? Math.round(Math.min(255, (b / n) / Math.max(A, 0.0001) * 255)) : 0;
    out[o + 3] = Math.round(Math.min(255, A * 255));
  }
}

// ---------- PNG ----------
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pngBuf = png(SZ, SZ, out);

// ---------- ICO（内嵌 PNG） ----------
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0;          // 0 表示 256
entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4);           // planes
entry.writeUInt16LE(32, 6);          // bpp
entry.writeUInt32LE(pngBuf.length, 8);
entry.writeUInt32LE(22, 12);         // offset

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, entry, pngBuf]));
fs.writeFileSync(path.join(__dirname, '..', 'ui', 'icon.png'), pngBuf);

console.log(`图标已生成: ${OUT}  (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
