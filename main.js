'use strict';
// 桌面版外壳：一个独立窗口 + 一个后台核心进程（无浏览器、无地址栏）
//
// 为什么核心要跑在子进程里：
//   Raw Input 的 PeekMessage 轮询和 Electron 主线程的 Chromium 消息泵放在一起会互相卡死
//   （实测：窗口出来后主线程事件循环不再转，HTTP 也停响应）。
//   拆开后，窗口进程只管画界面，遥控器/接管驱动都在子进程里跑，跟 `node src/app.js` 完全一致。
const path = require('path');
const net = require('net');
const fs = require('fs');
const { spawn } = require('child_process');
const { app, BrowserWindow, Menu, shell, dialog, Tray } = require('electron');

const APP_DIR = __dirname;
const ICON = path.join(APP_DIR, 'ui', 'icon.ico');
const OUT_DIR = path.join(APP_DIR, 'out');

let mainWin = null;
let child = null;

/* ---------- 选一个空闲端口 ---------- */
function portFree(p) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(p, '127.0.0.1');
  });
}
async function pickPort() {
  for (let p = 7791; p <= 7800; p++) if (await portFree(p)) return p;
  return 7791;
}

/* ---------- 启动核心子进程 ---------- */
// 打包后配置放 exe 同级的 config\，重新打包不会覆盖用户的改动
function ensureDataDir() {
  const dir = app.isPackaged
    ? path.join(path.dirname(process.execPath), 'config')
    : path.join(APP_DIR, 'config');
  try {
    fs.mkdirSync(dir, { recursive: true });
    // 首次运行：把打进包里的默认配置复制出来
    const seed = path.join(APP_DIR, 'config');
    if (seed !== dir) {
      for (const f of ['keymap.json', 'layout.json']) {
        const from = path.join(seed, f);
        const to = path.join(dir, f);
        if (!fs.existsSync(to) && fs.existsSync(from)) fs.copyFileSync(from, to);
      }
    }
  } catch (e) { /* 目录不可写就退回包内配置 */ }
  return dir;
}

function startCore(port) {
  const logFile = path.join(OUT_DIR, 'core.log');
  try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch {}
  try { fs.writeFileSync(logFile, ''); } catch {}
  const dataDir = ensureDataDir();

  child = spawn(process.execPath, [path.join(APP_DIR, 'src', 'app.js')], {
    cwd: APP_DIR,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // 让 electron.exe 以「纯 node」身份跑这个脚本
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '',
      PORT: String(port),
      NO_OPEN: '1',
      IPRC_DATA: dataDir,
    },
  });

  const sink = data => {
    const s = data.toString();
    try { fs.appendFileSync(logFile, s); } catch {}
    if (process.env.SMOKE === '1') process.stdout.write('[core] ' + s);
  };
  child.stdout.on('data', sink);
  child.stderr.on('data', sink);

  child.on('exit', (code, sig) => {
    if (app.isQuiting) return;
    if (mainWin && !mainWin.isDestroyed()) {
      dialog.showMessageBox(mainWin, {
        type: 'error',
        title: '核心进程退出了',
        message: `后台进程意外结束（code=${code}${sig ? ', ' + sig : ''}）。`,
        detail: '详细信息见 out/core.log。点确定退出程序。',
        buttons: ['退出'],
      }).finally(() => app.quit());
    }
  });
  return child;
}

/* ---------- 窗口 ---------- */
function createWindow(port) {
  mainWin = new BrowserWindow({
    width: 1120,
    height: 880,
    minWidth: 960,
    minHeight: 720,
    backgroundColor: '#f4f6f9',
    title: 'IPRC1000 遥控器映射',
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWin.once('ready-to-show', () => { if (mainWin) mainWin.show(); });

  const url = `http://127.0.0.1:${port}/`;
  const load = () => { if (mainWin && !mainWin.isDestroyed()) mainWin.loadURL(url).catch(() => {}); };

  let tries = 0;
  mainWin.webContents.on('did-fail-load', (e, code, desc, u, isMain) => {
    if (!isMain) return;
    if (tries++ < 60) setTimeout(load, 250);
    else dialog.showErrorBox('面板打不开', `本地服务没有响应（${desc}）。\n请关掉重开一次。`);
  });

  mainWin.webContents.on('console-message', (event) => {
    if (process.env.SMOKE === '1') process.stdout.write('[renderer] ' + event.message + '\n');
  });

  mainWin.webContents.setWindowOpenHandler(({ url: u }) => {
    try { shell.openExternal(u); } catch {}
    return { action: 'deny' };
  });

  mainWin.on('closed', () => { mainWin = null; });
  load();
  return mainWin;
}

/* ---------- 自检 ---------- */
function startSmoke(port) {
  const write = s => { try { fs.appendFileSync(path.join(OUT_DIR, 'smoke.txt'), s + '\n'); } catch {} };
  write('boot port=' + port);
  setTimeout(async () => {
    write('timer fired');
    try {
      const info = await mainWin.webContents.executeJavaScript(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const txt = id => (document.getElementById(id) || {}).textContent || '';
        const api = async () => (await fetch('/api/app')).json();

        // ① 基线
        const artIds = [...document.querySelectorAll('.slot')].map(n => n.dataset.slot);
        const a0 = await api();
        const base = {
          slots: artIds.length,
          empty: document.querySelectorAll('.slot.empty').length,
          mapped: document.querySelectorAll('.slot.mapped').length,
          set: document.querySelectorAll('.slot.set').length,
          presets: document.querySelectorAll('#presets button').length,
          chips: document.querySelectorAll('.chip').length,
          status: txt('status'),
          wizBtn: txt('btnWizard'),
          wizBtnDisabled: document.getElementById('btnWizard').disabled,
          missingInApi: artIds.filter(i => !a0.slots.some(s => s.id === i)),
          missingInArt: a0.slots.map(s => s.id).filter(i => !artIds.includes(i)),
        };

        // ② 点一下「语音」，看右侧面板有没有正确带出绑定和动作
        const m = document.querySelector('.slot[data-slot="mic"]');
        if (m) m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(120);
        const click = {
          title: txt('pName'), code: txt('pCode'), rec: txt('recBox'),
          sel: document.querySelectorAll('.slot.sel').length,
        };

        // ③ 启动「依次绑定」，应该停在第一个空位 pwr
        document.getElementById('btnWizard').click();
        await sleep(700);
        const a1 = await api();
        const w1 = {
          learn: a1.learn, learnText: txt('learntext'),
          wizBtn: txt('btnWizard'), panel: txt('pName'),
          skipShown: document.getElementById('btnSkip').style.display !== 'none',
          learningMark: document.querySelectorAll('.slot.learning').length,
        };

        // ④ 模拟连绑两个（真机上就是按两下遥控器），看有没有自动往下跳
        window.__iprcSim({ type:'learn-done', slot:'pwr',  usage:0x66 });
        await sleep(700);
        window.__iprcSim({ type:'learn-done', slot:'back', usage:0x67 });
        await sleep(900);
        const a2 = await api();
        const w2 = {
          learn: a2.learn, learnText: txt('learntext'), wizBtn: txt('btnWizard'),
        };

        // ⑤ 按错键（码已经被别的坑位占了）应该被拒绝，并停在原地继续等
        document.getElementById('btnSkip').click();
        await sleep(700);
        const before = (await api()).learn;
        window.__iprcSim({ type:'learn-dup', slot: before, usage: 72, owner: '上' });
        await sleep(300);
        const dup = {
          warned: document.getElementById('learnbar').classList.contains('warn'),
          learnText: txt('learntext'),
          stillLearning: (await api()).learn,
        };

        // ⑥ 取消，应该回到干净状态
        document.getElementById('btnLearnCancel').click();
        await sleep(700);
        const a3 = await api();
        const end = {
          learn: a3.learn, wizBtn: txt('btnWizard'),
          learnbarOn: document.getElementById('learnbar').classList.contains('on'),
          skipShown: document.getElementById('btnSkip').style.display !== 'none',
        };

        // 回到「语音」再截一张有选中态的图
        const m2 = document.querySelector('.slot[data-slot="mic"]');
        if (m2) m2.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(200);

        return { base, click, w1, w2, dup, end };
      })()`);
      write('SMOKE ' + JSON.stringify(info, null, 1));
    } catch (e) { write('SMOKE_ERR ' + String((e && e.message) || e)); }
    try {
      // 再让向导停在「等待按键」状态截一张，方便看提示条长什么样
      await mainWin.webContents.executeJavaScript(
        `document.getElementById('btnWizard').click()`);
      await new Promise(r => setTimeout(r, 900));
      const imgW = await mainWin.webContents.capturePage();
      fs.writeFileSync(path.join(OUT_DIR, 'shot-wizard.png'), imgW.toPNG());
      write('SHOT_WIZ ' + imgW.getSize().width + 'x' + imgW.getSize().height);
      await mainWin.webContents.executeJavaScript(
        `document.getElementById('btnLearnCancel').click()`);
      await new Promise(r => setTimeout(r, 500));

      const img = await mainWin.webContents.capturePage();
      fs.writeFileSync(path.join(OUT_DIR, 'shot.png'), img.toPNG());
      write('SHOT ' + img.getSize().width + 'x' + img.getSize().height);
    } catch (e) { write('SHOT_ERR ' + String((e && e.message) || e)); }
    setTimeout(() => app.quit(), 400);
  }, 4500);
}

/* ---------- 托盘：万一输入出问题，这里能一键撤掉接管 ---------- */
let tray = null;

async function panicStop(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/panic`, { method: 'POST' });
    dialog.showMessageBox({
      type: 'info',
      title: '已紧急停止',
      message: '接管模式已关闭，按键全部交还系统。',
      detail: '现在键盘和鼠标应该恢复正常了。\n遥控器可能会重新往窗口里打字。\n要恢复接管，请退出程序再打开一次。',
      buttons: ['好'],
    });
  } catch (e) {
    dialog.showErrorBox('停止失败', String((e && e.message) || e));
  }
}

function createTray(port) {
  try {
    tray = new Tray(ICON);
    tray.setToolTip('IPRC1000 遥控器映射');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开面板', click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); } } },
      { type: 'separator' },
      { label: '紧急停止接管（键盘鼠标不听话时点这个）', click: () => panicStop(port) },
      { type: 'separator' },
      { label: '退出', click: () => { app.isQuiting = true; app.quit(); } },
    ]));
    tray.on('double-click', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
  } catch (e) { /* 托盘建不起来不影响主流程 */ }
}

/* ---------- 生命周期 ---------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
}

(async () => {
  if (!gotLock) return;
  const port = await pickPort();
  startCore(port);

  await app.whenReady();
  Menu.setApplicationMenu(null);
  createWindow(port);
  createTray(port);
  if (process.env.SMOKE === '1') startSmoke(port);

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow(port);
  });
})();

app.on('before-quit', () => { app.isQuiting = true; });
app.on('will-quit', () => { try { if (child) child.kill(); } catch {} });
app.on('window-all-closed', () => app.quit());
process.on('exit', () => { try { if (child) child.kill(); } catch {} });
