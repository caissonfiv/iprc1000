'use strict';
// 抓取遥控器麦克风音频并落成 WAV，然后立刻判定「到底有没有声音」
//
// 原理：遥控器的麦克风音频和按键走同一条 L2CAP 通道（动态 CID 0x40/0x41，
// 也就是 Windows HID 驱动独占的那条）。用户态没有任何 API 能订阅它，
// 所以只能从 HCI 层用 ETW 旁路抓包，再按 L2CAP 重组、剥掉 13 字节帧头得到 PCM。
//
// 前提：
//   1) 已用管理员运行 enable-mic-capture.cmd 并【重启】（BthPort 在加载时读注册表）
//   2) 本脚本需要管理员权限（ETW 实时会话要求）
//
// 用法：node scripts/capture_mic.js --seconds 20 [--out out/mic.wav]
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const wav = require('../src/wav');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  return process.argv[i + 1] ?? def;
}

const seconds = Number(arg('seconds', 20));
const outDir = path.join(__dirname, '..', 'out');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.resolve(arg('out', path.join(outDir, 'mic.wav')));

const EXE = path.join(__dirname, '..', 'tools', 'etw_consumer.exe');
if (!fs.existsSync(EXE)) {
  console.error('缺少 tools/etw_consumer.exe');
  process.exit(1);
}

const isAdmin = (() => {
  try {
    // fsutil 不依赖任何系统服务，比 net session 可靠
    // （Server 服务被停时 net session 对管理员也返回失败，会导致误判）
    require('child_process').execSync(`fsutil dirty query ${process.env.SystemDrive || 'C:'}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

if (!isAdmin) {
  console.error('本脚本需要管理员权限（启动 ETW 实时会话）。');
  console.error('请改用双击 mic-test.cmd —— 它会自动请求提权。');
  process.exit(1);
}

try { fs.unlinkSync(outFile); } catch {}

console.log('开始抓取，共 ' + seconds + ' 秒');
console.log('>>> 现在请按住遥控器的语音键，对着它正常说话，中间停一下再说一句 <<<');
console.log('');

let sawNeedAdmin = false;
const child = spawn(EXE, ['--wav', outFile, '--seconds', String(seconds)], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

const relay = s => {
  const t = s.toString();
  if (/拒绝访问|Access is denied|5\)/.test(t) && /ETW|会话/.test(t)) sawNeedAdmin = true;
  process.stdout.write(t);
};
child.stdout.on('data', relay);
child.stderr.on('data', relay);

child.on('error', e => {
  console.error('启动抓取程序失败:', e.message);
  process.exit(1);
});

child.on('exit', code => {
  console.log('');
  console.log('抓取进程退出码:', code);

  if (!fs.existsSync(outFile)) {
    console.error('没有生成 WAV 文件。');
    if (sawNeedAdmin) console.error('原因：ETW 会话被拒 —— 请确认是以管理员身份运行。');
    process.exit(2);
  }

  const size = fs.statSync(outFile).size;
  console.log('WAV 大小:', (size / 1024).toFixed(1), 'KB');
  console.log('');

  try {
    const w = wav.parse(outFile);
    const s = wav.stats(w);
    const fmtDb = v => (v === -Infinity ? '-inf' : v.toFixed(1));
    const ok = s.activeRatio > 0.05 && s.peakDb > -35;

    console.log('========== 结果 ==========');
    console.log('格式      :', `${w.sampleRate} Hz / ${w.channels} 声道 / ${w.bits} bit`);
    console.log('时长      :', w.duration.toFixed(2), '秒');
    console.log('峰值      :', fmtDb(s.peakDb), 'dBFS');
    console.log('RMS       :', fmtDb(s.rmsDb), 'dBFS');
    console.log('有声窗口  :', `${s.activeWindows}/${s.windows} (${(s.activeRatio * 100).toFixed(0)}%)`);
    if (s.firstActiveSec >= 0) {
      console.log('有声区间  :', `${s.firstActiveSec.toFixed(1)}s ~ ${s.lastActiveSec.toFixed(1)}s`);
    }
    console.log('');
    if (ok) {
      console.log('✅ 成功抓到遥控器麦克风的声音');
      console.log('   文件:', outFile);
      console.log('   直接双击就能播放，先听一下是不是你说的内容。');
    } else {
      console.log('❌ 只有静音或噪声底');
      console.log('   排查顺序：');
      console.log('   1. 注册表改完是不是真的重启过？（BthPort 加载时才读）');
      console.log('   2. 抓取时有没有按住语音键并说话？');
      console.log('   3. 遥控器离电脑近一点，蓝牙链路抖动会丢帧');
    }
  } catch (e) {
    console.error('WAV 解析失败:', e.message);
    process.exit(3);
  }
});
