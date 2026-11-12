'use strict';
// 0.4: the default core is the driver configuration service. It does not read
// raw keyboard packets or inject input. Closing the UI leaves the kernel policy active.
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
const DRIVER_MODE = process.env.IPRC_BACKEND !== 'legacy';
const ICON = path.join(APP_DIR, 'ui', 'icon.ico');
const OUT_DIR = process.env.IPRC_OUT || path.join(APP_DIR, 'out');

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
  const dir = process.env.IPRC_DATA || (app.isPackaged
    ? path.join(path.dirname(process.execPath), 'config')
    : path.join(APP_DIR, 'config'));
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
  const dataDir = DRIVER_MODE ? (process.env.IPRC_DATA || path.join(APP_DIR,'config-driver')) : ensureDataDir();

  child = spawn(process.execPath, [path.join(APP_DIR, 'src', DRIVER_MODE ? 'driver-app.js' : 'app.js')], {
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

  mainWin.once('ready-to-show', () => { if (mainWin && process.env.SMOKE !== '1') mainWin.show(); });

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
  // Isolated UI smoke; caller must set IPRC_DIAGNOSTIC and IPRC_DATA.
  if (process.env.IPRC_DIAGNOSTIC !== '1') throw new Error('SMOKE requires IPRC_DIAGNOSTIC=1');
  setTimeout(async () => {
    try {
      const result = await mainWin.webContents.executeJavaScript(DRIVER_MODE ? `(async () => {
        const check=(ok,text)=>{if(!ok)throw new Error(text);};
        const get=()=>fetch('/api/app').then(r=>r.json());
        const post=(url,body)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-IPRC-Token':window.IPRC_TOKEN},body:JSON.stringify(body)}).then(r=>r.json());
        const state=await get();
        check(state.diagnostic&&state.backend==='driver','isolated driver diagnostic');
        check(document.querySelectorAll('.slot').length===22,'22 SVG buttons');
        document.querySelector('.slot[data-slot="back"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
        check(document.getElementById('pName').textContent==='返回','select button');
        document.getElementById('ruleType').value='2';document.getElementById('ruleType').onchange();
        document.getElementById('target').value='0';document.getElementById('target').onchange();
        await document.getElementById('btnSave').onclick();
        const changed=await get();
        check(changed.state.rules[0x21].type===2&&changed.state.rules[0x21].code===1,'UI apply Escape');
        const enabled=await post('/api/mode',{mode:1});
        check(enabled.ok&&enabled.state.mode===1&&enabled.state.rules[0x21].code===1,'enable preserves rules');
        const stopped=await post('/api/panic',{});
        check(stopped.ok&&stopped.state.mode===0,'observe');
        await load();
        check(document.getElementById('saveHint').textContent==='当前驱动配置','saved state displayed');
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        return {slots:22,backend:'driver',diagnostic:true};
      })()` : `(async () => {
        const check = (condition, text) => { if (!condition) throw new Error(text); };
        const get = () => fetch('/api/app').then(r => r.json());
        const state = await get();
        check(state.diagnostic, 'diagnostic mode');
        check(state.slots.length === 22, '22 slots');
        check(state.slots.every(s => s.usage != null), 'all positions bound');
        check(state.slots.find(s => s.id === 'up').action.type === 'native', 'navigation default');
        check(state.slots.find(s => s.id === 'mic').action.type === 'none', 'voice opt in');
        check(document.querySelectorAll('.slot').length === 22, '22 SVG buttons');
        document.querySelector('.slot[data-slot="mic"]').dispatchEvent(new MouseEvent('click', {bubbles:true}));
        check(document.getElementById('pName').textContent.includes('语音'), 'click selects voice');
        const panic = await fetch('/api/panic', {method:'POST'});
        check(panic.ok && (await get()).panic, 'panic API');
        await fetch('/api/rearm', {method:'POST'});
        check(!(await get()).panic, 'rearm API');
        return {slots:state.slots.length, bound:state.slots.filter(s=>s.usage!=null).length, diagnostic:true};
      })()`);
      if (DRIVER_MODE) fs.writeFileSync(path.join(OUT_DIR,'driver-ui.png'),(await mainWin.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(OUT_DIR, 'smoke.txt'), 'PASS ' + JSON.stringify(result));
    } catch (error) {
      fs.writeFileSync(path.join(OUT_DIR, 'smoke.txt'), 'FAIL ' + String(error.stack || error));
    } finally { app.quit(); }
  }, 1500);
}

/* ---------- 托盘：万一输入出问题，这里能一键撤掉接管 ---------- */
let tray = null;

async function panicStop(port) {
  try {
    const page = DRIVER_MODE ? await fetch(`http://127.0.0.1:${port}/`).then(r=>r.text()) : '';
    const token = page.match(/window\.IPRC_TOKEN='([a-f0-9]+)'/);
    const response = await fetch(`http://127.0.0.1:${port}/api/panic`, {
      method:'POST',headers:DRIVER_MODE ? {'Content-Type':'application/json','X-IPRC-Token':token?.[1]||''} : {},body:DRIVER_MODE ? '{}' : undefined,
    });
    if (!response.ok) throw new Error((await response.json()).reason || '接管线程尚未确认停止');
    dialog.showMessageBox({
      type: 'info',
      title: '已紧急停止',
      message: '已恢复原样放行。',
      detail: DRIVER_MODE ? '驱动中的按键绑定已保留，可在面板重新启用映射。' : '遥控器可能会重新往窗口里打字。',
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
  app.corePort = port;
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

let quitConfirmed = false;
app.on('before-quit', event => {
  app.isQuiting = true;
  if (DRIVER_MODE) return; // Kernel mappings continue independently of the UI.
  if (quitConfirmed || !child || child.exitCode !== null) return;
  event.preventDefault();
  if (app.stoppingCore) return;
  app.stoppingCore = true;
  const port = app.corePort;
  fetch('http://127.0.0.1:' + port + '/api/panic', {
    method: 'POST', signal: AbortSignal.timeout(3000),
  }).catch(() => {}).finally(() => { quitConfirmed = true; app.quit(); });
});
app.on('will-quit', () => { try { if (child) child.kill(); } catch {} });
app.on('window-all-closed', () => app.quit());
process.on('exit', () => { try { if (child) child.kill(); } catch {} });
