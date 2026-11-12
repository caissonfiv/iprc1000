'use strict';

// Session-scoped lifecycle: replacements wait for the predecessor's exit.
function createController({ createWorker, dllExists, stopTimeout = 1500 }) {
  let current = null;
  let closing = Promise.resolve();
  let retiring = false;
  const state = { phase: 'idle', active: false, reason: '', device: 0, hwid: '', keyboards: [], lastTick: 0,
    requestedVersion: 0, appliedVersion: 0 };
  function info() {
    const age = state.lastTick ? Date.now() - state.lastTick : -1;
    return { ...state, dll: dllExists(), tickAge: age,
      stalled: !!current && Date.now() - (state.lastTick || current.startedAt) > 4000 };
  }
  function stop() {
    const session = current;
    if (!session) return closing;
    current = null;
    Object.assign(state, { active: false, lastTick: 0, phase: 'stopping' });
    session.cancelled = true;
    if (!session.worker) { state.phase = retiring ? 'stopping' : 'idle'; return closing; }
    retiring = true;
    closing = new Promise(resolve => {
      let timer;
      session.worker.once('exit', () => {
        retiring = false;
        clearTimeout(timer);
        if (!current) state.phase = 'idle';
        resolve();
      });
      const force = () => {
        state.reason = '接管线程未确认退出，正在强制终止';
        try { Promise.resolve(session.worker.terminate()).catch(() => {}); } catch {}
      };
      timer = setTimeout(force, stopTimeout);
      try { session.worker.postMessage({ type: 'stop' }); } catch { force(); }
    });
    return closing;
  }
  function start(onKey, onStatus, passthrough = []) {
    if (current) return true;
    if (!dllExists()) { state.reason = '缺少 native/interception.dll'; return false; }
    const session = { worker: null, cancelled: false, ready: false, startedAt: Date.now(),
      passthrough: passthrough.slice(), version: 1 };
    current = session;
    Object.assign(state, { phase: 'starting', reason: '', requestedVersion: 1, appliedVersion: 0 });
    const notify = (kind, payload) => { if (onStatus) onStatus(kind, payload); };
    closing.then(() => {
      if (current !== session || session.cancelled) return;
      session.startedAt = Date.now();
      const fail = (kind, payload) => {
        if (current !== session) return;
        state.reason = payload.reason || '';
        stop(); // Detach before notifying: callback may request recovery.
        notify(kind, payload);
      };
      try {
        const w = session.worker = createWorker({ passthrough: session.passthrough, version: session.version });
        w.on('message', m => {
          if (current !== session || !m) return;
          if (m.type === 'key') { if (onKey) onKey(m); }
          else if (m.type === 'tick') state.lastTick = Date.now();
          else if (m.type === 'configured') { state.appliedVersion = m.version; notify('configured', m); }
          else if (m.type === 'ready') {
            session.ready = true;
            Object.assign(state, { phase: 'active', active: true, lastTick: Date.now(), device: m.device,
              hwid: m.hwid, keyboards: m.keyboards || [], appliedVersion: m.version || 1 });
            notify('ready', m);
          } else if (m.type === 'disarmed') fail('disarmed', m);
          else if (m.type === 'unavailable' || m.type === 'nokeyboard') fail('fail', {
            ...m, reason: m.reason || '没有找到遥控器键盘设备', code: m.code || 'NO_DEVICE' });
        });
        w.on('error', e => fail(session.ready ? 'lost' : 'fail', { code: 'WORKER_ERROR', reason: e.message }));
        w.on('exit', () => {
          if (current !== session) return;
          current = null;
          Object.assign(state, { phase: 'idle', active: false, lastTick: 0 });
          notify(session.ready ? 'lost' : 'fail', { code: 'WORKER_EXIT', reason: '接管线程已退出' });
        });
      } catch (e) {
        current = null;
        Object.assign(state, { phase: 'idle', active: false, reason: e.message });
        notify('fail', { code: 'WORKER_START', reason: e.message });
      }
    });
    return true;
  }
  function setPassthrough(list) {
    if (!current) return;
    current.passthrough = Array.isArray(list) ? list.slice() : [];
    state.requestedVersion = ++current.version;
    if (current.worker) current.worker.postMessage({ type: 'passthrough', set: current.passthrough, version: current.version });
  }
  return { start, stop, info, setPassthrough, dllExists };
}
module.exports = { createController };
