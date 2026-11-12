'use strict';
const { SCAN_CODES } = require('./device-profile');
const names = ['电源','返回','上','菜单','左 / 上一段','OK','右 / 下一段','退出','下','信息','收藏','语音','我的','快退','播放 / 暂停','快进','音量 +','音量 −','频道 +','频道 −','静音','上一个频道'];
const slots = Object.entries(SCAN_CODES).map(([id, usage], i) => ({id, usage, name:names[i]}));
const outputs = [];
const add = (name,code,flags=0) => outputs.push({name,code,flags});
for (const [name,code] of Object.entries({Esc:1,Backspace:14,Tab:15,Enter:28,Space:57})) add(name,code);
for (const [name,code] of Object.entries({'↑':72,'↓':80,'←':75,'→':77,Home:71,End:79,PageUp:73,PageDown:81,Insert:82,Delete:83,Win:91,Menu:93,'音量 +':48,'音量 −':46,'静音':32,'播放 / 暂停':34,'下一曲':25,'上一曲':16,'媒体停止':36})) add(name,code,2);
for (const [key,code] of Object.entries({A:30,B:48,C:46,D:32,E:18,F:33,G:34,H:35,I:23,J:36,K:37,L:38,M:50,N:49,O:24,P:25,Q:16,R:19,S:31,T:20,U:22,V:47,W:17,X:45,Y:21,Z:44})) add(key,code);
for(let i=1;i<=9;i++) add(String(i),i+1); add('0',11);
for(let i=1;i<=12;i++) add('F'+i,i<=10?58+i:i===11?87:88);
function validateRule(rule) {
  if(!rule || ![0,1,2].includes(rule.type) || !Number.isInteger(rule.code) || !Number.isInteger(rule.flags)) throw new Error('无效的按键动作');
  if(rule.type===2 ? rule.code<1||rule.code>=255||![0,2].includes(rule.flags) : rule.code!==0||rule.flags!==0) throw new Error('驱动当前支持单键、原样放行和屏蔽');
  return {type:rule.type,code:rule.code,flags:rule.flags};
}
function validatePolicy(policy) {
  if(!policy || ![0,1].includes(policy.mode) || !Array.isArray(policy.rules) || policy.rules.length!==256) throw new Error('驱动配置版本或长度不匹配');
  const rules=policy.rules.map(validateRule);
  if(rules[0x17].type!==0) throw new Error('幽灵键必须保持屏蔽');
  return {mode:policy.mode,rules};
}
function encodePolicy(policy) {
  const p=validatePolicy(policy), b=Buffer.alloc(2064);
  b.writeUInt32LE(2064,0); b.writeUInt32LE(1,4); b.writeUInt32LE(p.mode,8);
  p.rules.forEach((r,i)=>{b.writeUInt16LE(r.type,16+i*8);b.writeUInt16LE(r.code,18+i*8);b.writeUInt16LE(r.flags,20+i*8);});
  return b;
}
function defaults(mode=0) {
  const rules=Array.from({length:256},()=>({type:0,code:0,flags:0}));
  for(const i of [72,80,75,77,28]) rules[i]={type:1,code:0,flags:0};
  for(const [i,o] of [[3,48],[4,46],[34,32],[43,34]]) rules[i]={type:2,code:o,flags:2};
  return {mode,rules};
}
module.exports={slots,outputs,validateRule,validatePolicy,encodePolicy,defaults};
