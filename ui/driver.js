const ART = [
  // 顶部右上：电源
  { id:'pwr',   t:'c', x:208, y:59,  r:21, draw:'power' },

  // 第 1 排
  { id:'back',  t:'c', x:88,  y:182, r:23, label:'back', fs:9 },
  { id:'up',    t:'c', x:148, y:182, r:23, draw:'up' },
  { id:'menu',  t:'c', x:208, y:182, r:23, label:'menu', fs:9 },

  // 第 2 排
  { id:'left',  t:'c', x:88,  y:236, r:23, draw:'prev' },
  { id:'ok',    t:'c', x:148, y:236, r:24, label:'ok',   fs:11 },
  { id:'right', t:'c', x:208, y:236, r:23, draw:'next' },

  // 第 3 排
  { id:'exit',  t:'c', x:88,  y:290, r:23, label:'exit', fs:9 },
  { id:'down',  t:'c', x:148, y:290, r:23, draw:'down' },
  { id:'info',  t:'c', x:208, y:290, r:23, label:'info', fs:9 },

  // 第 4 排：收藏 / 语音 / 我的
  { id:'fav',   t:'c', x:88,  y:366, r:22, draw:'heart' },
  { id:'mic',   t:'c', x:148, y:366, r:22, draw:'mic' },
  { id:'me',    t:'c', x:208, y:366, r:22, draw:'me' },

  // 第 5 排：快退 / 播放暂停 / 快进
  { id:'rew',   t:'c', x:88,  y:416, r:22, draw:'rew' },
  { id:'play',  t:'c', x:148, y:416, r:22, draw:'pause' },
  { id:'ffwd',  t:'c', x:208, y:416, r:22, draw:'ffwd' },

  // 第 6 排：左「音量」摇杆 / 静音 + 上频道 / 右「频道」摇杆
  // 摇杆在真机上是一整条，这里拆成上下两个可点区域；名字只标在上半，避免重复。
  { id:'volup',   t:'r', x:62,  y:453, w:52, h:45, rx:20, draw:'plus',  sub:'VOL' },
  { id:'voldown', t:'r', x:62,  y:501, w:52, h:45, rx:20, draw:'minus' },
  { id:'chup',    t:'r', x:182, y:453, w:52, h:45, rx:20, draw:'up',    sub:'CH' },
  { id:'chdown',  t:'r', x:182, y:501, w:52, h:45, rx:20, draw:'down' },

  { id:'mute',  t:'c', x:148, y:478, r:22, draw:'mute' },
  { id:'last',  t:'c', x:148, y:522, r:22, label:'last', fs:9 },
];
const ART_MAP = {}; for (const a of ART) ART_MAP[a.id] = a;

const ICONS = {
  power: '<path d="M0 -7.8 V0.5"/><path d="M-5.9 -4.2 A 7.8 7.8 0 1 0 5.9 -4.2"/>',
  up:    '<path d="M-5.4 3.6 L0 -4.2 L5.4 3.6"/>',
  down:  '<path d="M-5.4 -3.6 L0 4.2 L5.4 -3.6"/>',
  prev:  '<path d="M-7 -5.2 V5.2"/><path d="M6.2 -5.4 L-3.6 0 L6.2 5.4 Z"/>',
  next:  '<path d="M7 -5.2 V5.2"/><path d="M-6.2 -5.4 L3.6 0 L-6.2 5.4 Z"/>',
  heart: '<path d="M0 6.4 C-1.8 4.6 -7.6 1.2 -7.6 -3.1 C-7.6 -6.1 -5.4 -7.6 -3.3 -7.6'
       + ' C-1.7 -7.6 -0.6 -6.7 0 -5.4 C0.6 -6.7 1.7 -7.6 3.3 -7.6'
       + ' C5.4 -7.6 7.6 -6.1 7.6 -3.1 C7.6 1.2 1.8 4.6 0 6.4 Z"/>',
  mic:   '<rect x="-3" y="-8.4" width="6" height="9.2" rx="3"/>'
       + '<path d="M-5.6 -1.2 a 5.6 5.6 0 0 0 11.2 0"/><path d="M0 4.6 V7.4"/>',
  me:    '<circle cx="-1.6" cy="-3.6" r="3.1"/>'
       + '<path d="M-7 6.4 C-7 2.2 -4.4 0.4 -1.6 0.4 C1.2 0.4 3.8 2.2 3.8 6.4"/>'
       + '<path d="M5 -8.6 h4.8 v3.8 h-2.6 l-1.6 1.7 v-1.7 h-0.6 z"/>',
  rew:   '<path d="M-0.6 -5 L-7.2 0 L-0.6 5 Z"/><path d="M7.2 -5 L0.6 0 L7.2 5 Z"/>',
  pause: '<rect class="fill" x="-4.8" y="-5.6" width="3.2" height="11.2" rx="1.2"/>'
       + '<rect class="fill" x="1.6" y="-5.6" width="3.2" height="11.2" rx="1.2"/>',
  ffwd:  '<path d="M0.6 -5 L7.2 0 L0.6 5 Z"/><path d="M-7.2 -5 L-0.6 0 L-7.2 5 Z"/>',
  mute:  '<path d="M-7.4 -2.4 H-4.6 L-0.8 -5.8 V5.8 L-4.6 2.4 H-7.4 Z"/>'
       + '<path d="M2.6 -2.6 L6.8 1.6"/><path d="M6.8 -2.6 L2.6 1.6"/>',
  plus:  '<path d="M-4.8 0 H4.8"/><path d="M0 -4.8 V4.8"/>',
  minus: '<path d="M-4.8 0 H4.8"/>',
};

function shape(a, cls){
  if (a.t === 'c') return `<circle class="${cls}" cx="${a.x}" cy="${a.y}" r="${a.r}"/>`;
  return `<rect class="${cls}" x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${a.rx}"/>`;
}
function buildRemote(){
  const out = [];
  for (const a of ART){
    const cx = a.t === 'c' ? a.x : a.x + a.w / 2;
    const cy = a.t === 'c' ? a.y : a.y + a.h / 2;
    let inner;
    if (a.draw){
      const dy = a.sub ? -6.5 : 0;
      inner = `<g class="ic" transform="translate(${cx},${cy + dy})">${ICONS[a.draw]}</g>`
            + (a.sub
                ? `<text x="${cx}" y="${cy + 11.5}" font-size="7" letter-spacing=".5" opacity=".8">${a.sub}</text>`
                : '');
    } else {
      inner = `<text x="${cx}" y="${cy}" font-size="${a.fs || 11}">${a.label || ''}</text>`;
    }
    out.push(
      `<g class="slot" data-slot="${a.id}">` + shape(a, 'base') + shape(a, 'ring') + inner + '</g>'
    );
  }
  document.getElementById('slots').innerHTML = out.join('');
  document.querySelectorAll('.slot').forEach(g => {
    g.addEventListener('click', () => selectSlot(g.dataset.slot));
  });
}


'use strict';
const $=id=>document.getElementById(id);
let A=null, selected=null, draft=null, dirty=false, busy=false;
const hex=n=>'0x'+n.toString(16).toUpperCase().padStart(2,'0');
function label(rule) {
  if(!rule) return '—';
  if(rule.type===0) return '屏蔽（不执行）';
  if(rule.type===1) return '原样放行';
  const out=A.outputs.find(o=>o.code===rule.code&&o.flags===rule.flags);
  return out?out.name:`扫描码 ${hex(rule.code)}${rule.flags?' · E0':''}`;
}
function message(text,bad=false) {$('message').textContent=text;$('message').style.color=bad?'#b91c1c':'#166534';}
function available(){return !!(A&&A.state&&A.state.connected);}
function paint() {
  const s=A&&A.state, ready=available();
  $('dot').className='dot'+(ready?' on':'');
  $('status').textContent=!s?(A?.error||'正在读取驱动…'):!ready?'驱动已连接，等待键盘就绪':s.mode===1?'驱动已连接 · 映射运行中':'驱动已连接 · 原样放行中';
  $('status').title=$('status').textContent;
  $('counts').textContent=s?`输入 ${s.accepted} · 输出 ${s.delivered} · 抑制 ${s.suppressed} · 队列 ${s.queued}`:'以管理员身份运行；按一下遥控器方向键唤醒。';
  $('modeNote').textContent=s?.mode===0?'当前处于透传模式，修改动作后需点“启用映射”才会执行。':'关闭此软件后，映射仍由驱动运行。';
  $('btnMode').textContent=s?.mode===1?'暂停映射':'启用映射';
  for(const id of ['btnMode','btnPanic','btnPersist','reset']) $(id).disabled=busy||!ready;
  for(const id of ['ruleType','target','scanCode','extended','btnRec','btnSave']) $(id).disabled=busy||!ready||!selected;
  document.querySelectorAll('.slot').forEach(g=>{
    const slot=A?.slots.find(s=>s.id===g.dataset.slot),rule=slot&&s?.rules[slot.usage];
    g.classList.toggle('mapped',!!rule&&rule.type===2);
    g.classList.toggle('set',!!rule&&rule.type===0);
    g.classList.toggle('sel',selected===g.dataset.slot);
  });
}
async function load() {
  try {
    const response=await fetch('/api/app'); if(!response.ok) throw new Error('无法读取驱动服务');
    A=await response.json();
    if(!selected&&A.slots.length) selectSlot('back');
    if(!dirty&&selected&&A.state) {draft=structuredClone(A.state.rules[A.slots.find(s=>s.id===selected).usage]);showEditor();}
    paint();
  }catch(e){message(e.message,true);}
}
function selectSlot(id) {
  if(busy) return;
  if(dirty&&!confirm('当前动作尚未应用，放弃修改并切换按键？')) return;
  selected=id;dirty=false;
  const slot=A.slots.find(s=>s.id===id);
  draft=A.state?structuredClone(A.state.rules[slot.usage]):{type:0,code:0,flags:0};
  $('pName').textContent=slot.name;$('pCode').textContent=hex(slot.usage);
  showEditor();paint();
}
function showEditor() {
  if(!draft)return;
  $('ruleType').value=String(draft.type);
  $('scanCode').value=draft.type===2?hex(draft.code):'';
  $('extended').checked=draft.flags===2;
  const index=A.outputs.findIndex(o=>o.code===draft.code&&o.flags===draft.flags);
  $('target').value=index<0?'custom':String(index);
  $('tapFields').hidden=draft.type!==2;
  $('recBox').textContent=label(draft);
  $('saveHint').textContent=dirty?'尚未应用':'当前驱动配置';
}
function edit(rule){draft=rule;dirty=true;showEditor();}
async function post(url,data,success) {
  if(dirty&&url!=='/api/action'&&url!=='/api/panic'&&!confirm('当前动作尚未应用，放弃这项修改并继续？')) return false;
  busy=true;paint();
  try {
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-IPRC-Token':window.IPRC_TOKEN},body:JSON.stringify(data)});
    const result=await response.json(); if(!response.ok) throw new Error(result.error||'操作失败');
    A.state=result.state;dirty=false;
    if(selected) draft=structuredClone(A.state.rules[A.slots.find(s=>s.id===selected).usage]);
    showEditor();message(success);return true;
  }catch(e){message(e.message,true);return false;}
  finally{busy=false;paint();}
}
$('ruleType').onchange=()=>edit(+$('ruleType').value===2?{type:2,code:1,flags:0}:{type:+$('ruleType').value,code:0,flags:0});
$('target').onchange=()=>{const o=A.outputs[+$('target').value];if(o)edit({type:2,code:o.code,flags:o.flags});};
function manual(){const code=Number($('scanCode').value);if(!Number.isInteger(code)||code<1||code>254){message('扫描码应为 1–254，可使用 0x 十六进制',true);return;}edit({type:2,code,flags:$('extended').checked?2:0});}
$('scanCode').onchange=manual;$('extended').onchange=manual;
$('btnSave').onclick=()=>{
  const slot=A.slots.find(s=>s.id===selected);
  return post('/api/action',{usage:slot.usage,rule:draft},'已应用到驱动。本次修改尚未保存到设备。');
};
$('btnMode').onclick=()=>post('/api/mode',{mode:A.state.mode===1?0:1},'运行模式已更新，现有按键绑定已保留。');
$('btnPanic').onclick=()=>post('/api/panic',{},'已恢复原样放行，按键绑定已保留。');
$('btnPersist').onclick=()=>{
  if(dirty){message('请先应用当前按键的修改，再保存整套配置。',true);return;}
  post('/api/persist',{persist:true},'整套配置和当前运行模式已保存到设备，重连后自动恢复。');
};
$('reset').onclick=()=>{if(confirm('恢复默认按键绑定？设备中已保存的配置不会被覆盖，直到你再次点“保存到设备”。'))post('/api/reset',{},'已在本次连接中恢复默认绑定。');};
$('refresh').onclick=load;
const codeToName={Escape:'Esc',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',MetaLeft:'Win',MetaRight:'Win',ContextMenu:'Menu',AudioVolumeUp:'音量 +',AudioVolumeDown:'音量 −',AudioVolumeMute:'静音',MediaPlayPause:'播放 / 暂停',MediaTrackNext:'下一曲',MediaTrackPrevious:'上一曲',MediaStop:'媒体停止'};
$('btnRec').onclick=()=>{
  $('recBox').textContent='请按电脑键盘上的一个键（不能组合修饰键）；点别处取消';
  let active=true;
  const stop=()=>{if(!active)return;active=false;window.removeEventListener('keydown',key,true);window.removeEventListener('pointerdown',stop,true);clearTimeout(timeout);showEditor();};
  const key=e=>{
    e.preventDefault();e.stopPropagation();
    if(e.ctrlKey||e.altKey||e.shiftKey||(e.metaKey&&!e.code.startsWith('Meta'))){message('当前驱动仅支持单键，组合键尚未接入。',true);return;}
    let name=codeToName[e.code]||e.code.replace(/^Key|^Digit/,'');
    const output=A.outputs.find(o=>o.name===name);
    if(!output){message('暂不支持这个键，请从列表选择或输入扫描码。',true);return;}
    stop();edit({type:2,code:output.code,flags:output.flags});
  };
  const timeout=setTimeout(stop,15000);
  window.addEventListener('keydown',key,true);window.addEventListener('pointerdown',stop,true);
};
async function init(){
  buildRemote();await load();
  for(const [i,o] of (A?.outputs||[]).entries()){
    const option=document.createElement('option');option.value=String(i);option.textContent=o.name;$('target').appendChild(option);
  }
  showEditor();setInterval(()=>{if(!busy)load();},2500);
}
init();
