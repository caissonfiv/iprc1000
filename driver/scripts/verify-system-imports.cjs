'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function image(file){
 const b=fs.readFileSync(file),coff=b.readUInt32LE(60)+4,opt=coff+20,start=opt+b.readUInt16LE(coff+16),sections=[];
 for(let i=0;i<b.readUInt16LE(coff+2);i++){
  const at=start+i*40;sections.push({rva:b.readUInt32LE(at+12),size:b.readUInt32LE(at+16),offset:b.readUInt32LE(at+20)});
 }
 const offset=rva=>{const s=sections.find(s=>rva>=s.rva&&rva<s.rva+s.size);assert(s,'mapped RVA');return s.offset+rva-s.rva;};
 const string=rva=>{const at=offset(rva),end=b.indexOf(0,at);assert(end>at);return b.toString('ascii',at,end);};
 return {b,opt,offset,string};
}
const candidate=image(process.argv[2]);
const windows=process.env.SystemRoot||'C:\\Windows';
let at=candidate.offset(candidate.b.readUInt32LE(candidate.opt+120)),checked=0;
while(candidate.b.readUInt32LE(at+12)){
 const name=candidate.string(candidate.b.readUInt32LE(at+12));
 assert(/^(ntoskrnl\.exe|hal\.dll|wdfldr\.sys)$/i.test(name),'allowed kernel library');
 const target=path.join(windows,/\.sys$/i.test(name)?'System32/drivers':'System32',name);
 const dependency=image(target),directory=dependency.offset(dependency.b.readUInt32LE(dependency.opt+112));
 const names=new Set(),nameCount=dependency.b.readUInt32LE(directory+24),namesAt=dependency.offset(dependency.b.readUInt32LE(directory+32));
 for(let i=0;i<nameCount;i++)names.add(dependency.string(dependency.b.readUInt32LE(namesAt+i*4)));
 let thunk=candidate.offset(candidate.b.readUInt32LE(at)||candidate.b.readUInt32LE(at+16));
 for(let entry;(entry=candidate.b.readBigUInt64LE(thunk));thunk+=8){
  assert(!(entry&(1n<<63n)),'named imports expected');
  const imported=candidate.string(Number(entry)+2);
  assert(names.has(imported),'missing on target system: '+name+'!'+imported);checked++;
 }
 at+=20;
}
assert(checked>0);
console.log('PASS '+checked+' named kernel imports exist on this Windows installation; files read only, no kernel image loaded.');
