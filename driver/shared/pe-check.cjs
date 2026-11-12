'use strict';
const assert=require('node:assert/strict');
function peChecksum(b,checksumOffset){
  let sum=0;
  for(let i=0;i<b.length;i+=2){
    if(i===checksumOffset||i===checksumOffset+2)continue;
    sum+=b[i]|((b[i+1]||0)<<8);sum=(sum&0xffff)+(sum>>>16);
  }
  return (((sum&0xffff)+(sum>>>16))+b.length)>>>0;
}
function checkKernelPe(b,{allowSigned=false}={}){
  const pe=b.readUInt32LE(0x3c),coff=pe+4,opt=coff+20;
  assert.equal(b.toString('ascii',pe,pe+4),'PE\0\0');
  assert.equal(b.readUInt16LE(coff),0x8664,'x64 image');
  assert.equal(b.readUInt16LE(opt),0x20b,'PE32+');
  assert.equal(b.readUInt16LE(opt+68),1,'native subsystem');
  assert(b.readUInt16LE(opt+48)>=10,'Windows 10+ subsystem version');
  assert(!(b.readUInt16LE(coff+18)&1),'relocations must not be stripped');
  assert.equal(b.readUInt32LE(opt+32),4096,'page-aligned sections');
  const imageSize=b.readUInt32LE(opt+56),base=b.readBigUInt64LE(opt+24);
  const flags=b.readUInt16LE(opt+70);
  for(const flag of [0x20,0x40,0x80,0x100,0x4000])assert(flags&flag,'ASLR/integrity/NX/CFG image flags');
  const certOffset=b.readUInt32LE(opt+112+4*8),certSize=b.readUInt32LE(opt+112+4*8+4);
  if(!allowSigned)assert.equal(certSize,0,'unsigned build expected');
  if(certSize)assert(certOffset%8===0&&certOffset+certSize<=b.length,'certificate table bounds');
  assert.equal(b.readUInt32LE(opt+64),peChecksum(b,opt+64),'PE checksum');
  const sections=[],start=opt+b.readUInt16LE(coff+16);
  for(let i=0;i<b.readUInt16LE(coff+2);i++){
    const at=start+i*40,characteristics=b.readUInt32LE(at+36);
    const section={name:b.toString('ascii',at,at+8).replace(/\0.*$/,''),rva:b.readUInt32LE(at+12),
      size:Math.max(b.readUInt32LE(at+8),b.readUInt32LE(at+16)),rawSize:b.readUInt32LE(at+16),
      offset:b.readUInt32LE(at+20),flags:characteristics};
    assert(characteristics&0x40000000,'every output section must be readable');
    assert(!((characteristics&0x20000000)&&(characteristics&0x80000000)),'no writable executable sections');
    assert.equal(section.rva%4096,0,'section RVA alignment');
    assert(section.rva+section.size<=imageSize,'section inside image');
    assert(!section.rawSize||section.offset+section.rawSize<=b.length,'section file bounds');
    assert(!sections.some(s=>section.rva<s.rva+s.size&&s.rva<section.rva+section.size),'nonoverlapping sections');
    assert(!sections.some(s=>s.name===section.name),'unique output section names');
    sections.push(section);
  }
  const sectionAt=(rva,n=1)=>{const s=sections.find(s=>rva>=s.rva&&rva+n<=s.rva+s.size);assert(s,'valid RVA span');return s;};
  const offset=(rva,n=1)=>{const s=sectionAt(rva,n);assert(rva-s.rva+n<=s.rawSize,'file-backed RVA');return s.offset+rva-s.rva;};
  const executable=rva=>{assert(sectionAt(rva).flags&0x20000000,'target in executable section');};
  executable(b.readUInt32LE(opt+16));
  const imports=[];
  let at=offset(b.readUInt32LE(opt+112+8));
  while(b.readUInt32LE(at+12)){
    const ptr=offset(b.readUInt32LE(at+12)),end=b.indexOf(0,ptr);assert(end>ptr,'terminated import name');
    const name=b.toString('ascii',ptr,end);
    assert(/^(ntoskrnl\.exe|hal\.dll|wdfldr\.sys)$/i.test(name),'kernel-only import: '+name);
    imports.push(name);at+=20;
  }
  assert(imports.some(n=>/^wdfldr\.sys$/i.test(n)),'KMDF loader dependency');
  const configRva=b.readUInt32LE(opt+112+10*8);assert(configRva,'load configuration');
  const config=offset(configRva,148);assert(b.readUInt32LE(config)>=148,'complete CFG load configuration');
  const toRva=va=>{assert(va>=base&&va<base+BigInt(imageSize),'in-image absolute pointer');return Number(va-base);};
  // WDF_BIND_INFO2 is emitted by the WDK entry library. Validate its pointer
  // to the actual compiled minimum, rather than trusting the INF or flags.
  const bindings=[];
  for(const s of sections)for(let p=s.offset;p+88<=s.offset+s.rawSize;p+=8){
    if(b.readUInt32LE(p)!==88||b.readUInt32LE(p+16)!==1||b.readUInt32LE(p+20)!==33)continue;
    const name=offset(toRva(b.readBigUInt64LE(p+8)),24);
    if(b.toString('utf16le',name,name+24)!=='KmdfLibrary\0')continue;
    const minimumOffset=offset(toRva(b.readBigUInt64LE(p+48)),4);
    const minimum=b.readUInt32LE(minimumOffset);
    assert.equal(minimum,33,'KMDF compiled minimum must be 33, never the undefined-version sentinel');
    bindings.push({major:1,minor:33,minimum,minimumOffset});
  }
  assert.equal(bindings.length,1,'exactly one KMDF 1.33 binding');
  const cookie=toRva(b.readBigUInt64LE(config+88));
  assert(cookie%8===0&&(sectionAt(cookie,8).flags&0x80000000),'writable aligned stack cookie');
  for(const field of [112,120]){
    const slot=toRva(b.readBigUInt64LE(config+field));
    assert(slot%8===0,'CFG pointer alignment');
    executable(toRva(b.readBigUInt64LE(offset(slot,8))));
  }
  const guardFlags=b.readUInt32LE(config+144);
  assert((guardFlags&0x500)===0x500,'CFG instrumentation and function table');
  const table=toRva(b.readBigUInt64LE(config+128)),count=Number(b.readBigUInt64LE(config+136));
  assert(count>0&&count<65536,'nonempty CFG function table');
  const stride=4+(guardFlags>>>28),tableOffset=offset(table,count*stride);
  for(let i=0;i<count;i++)executable(b.readUInt32LE(tableOffset+i*stride));
  const relocRva=b.readUInt32LE(opt+112+5*8),relocSize=b.readUInt32LE(opt+112+5*8+4);
  assert(relocRva&&relocSize,'base relocation directory');
  at=offset(relocRva,relocSize);const end=at+relocSize;let relocationCount=0;
  const kernelBase=0xfffff80710000000n,delta=kernelBase-base;
  while(at<end){
    assert(at+8<=end,'relocation block header');
    const page=b.readUInt32LE(at),bytes=b.readUInt32LE(at+4);
    assert(page%4096===0&&bytes>=8&&bytes%4===0&&at+bytes<=end,'relocation block bounds');
    for(let p=at+8;p<at+bytes;p+=2){
      const fixup=b.readUInt16LE(p),type=fixup>>>12;if(!type)continue;
      assert.equal(type,10,'x64 DIR64 relocation');
      const rva=page+(fixup&4095);assert(rva%4096<=4088,'no page-straddling relocation');
      const old=b.readBigUInt64LE(offset(rva,8));
      toRva(old);
      const rebased=BigInt.asUintN(64,old+delta);
      assert(rebased>=kernelBase&&rebased<kernelBase+BigInt(imageSize),'simulated kernel rebasing');
      relocationCount++;
    }
    at+=bytes;
  }
  assert(relocationCount>0,'nonempty relocation table');
  return {bytes:b.length,machine:'x64',subsystem:'native',imports,checksum:'valid',
    stackCookie:true,kmdf:bindings[0],cfgFunctions:count,relocations:relocationCount,kernelRebase:'simulated pass',
    sections:sections.map(s=>s.name),hasEmbeddedSignature:certSize>0};
}
module.exports={checkKernelPe,peChecksum};
