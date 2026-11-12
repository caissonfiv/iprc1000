const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {checkKernelPe,peChecksum}=require('../shared/pe-check.cjs');
const original=fs.readFileSync(process.env.IPRC_PE_PATH||path.join(__dirname,'../build/iprcflt.sys'));
const coff=original.readUInt32LE(0x3c)+4,opt=coff+20;
const sections=opt+original.readUInt16LE(coff+16);
function changed(mutate){const b=Buffer.from(original);mutate(b);b.writeUInt32LE(peChecksum(b,opt+64),opt+64);return b;}
const offset=rva=>{
 for(let i=0;i<original.readUInt16LE(coff+2);i++){
  const at=sections+i*40,v=original.readUInt32LE(at+12),size=original.readUInt32LE(at+16);
  if(rva>=v&&rva<v+size)return original.readUInt32LE(at+20)+rva-v;
 }throw new Error('missing RVA');
};
const config=offset(original.readUInt32LE(opt+112+10*8));
test('actual MSVC kernel candidate passes strict checks and kernel rebasing simulation',()=>{
 const result=checkKernelPe(original);assert(result.cfgFunctions>0);assert(result.relocations>0);
 assert.equal(result.kernelRebase,'simulated pass');
});
test('legacy subsystem version is rejected',()=>assert.throws(()=>checkKernelPe(changed(b=>b.writeUInt16LE(6,opt+48))),/subsystem version/));
test('undefined KMDF compile version is rejected even with valid PE checksum',()=>{
 const {kmdf}=checkKernelPe(original);
 assert.equal(kmdf.minimum,33);
 assert.throws(()=>checkKernelPe(changed(b=>b.writeUInt32LE(0xffffffff,kmdf.minimumOffset))),/KMDF compiled minimum/);
});
test('stripped relocations are rejected',()=>assert.throws(()=>checkKernelPe(changed(b=>b.writeUInt16LE(b.readUInt16LE(coff+18)|1,coff+18))),/relocations must/));
test('missing CFG image flag is rejected',()=>assert.throws(()=>checkKernelPe(changed(b=>b.writeUInt16LE(b.readUInt16LE(opt+70)&~0x4000,opt+70))),/CFG image flags/));
test('unreadable metadata output sections are rejected',()=>assert.throws(()=>checkKernelPe(changed(b=>b.writeUInt32LE(0,sections+36))),/readable/));
test('writable executable section is rejected',()=>assert.throws(()=>checkKernelPe(changed(b=>b.writeUInt32LE((b.readUInt32LE(sections+36)|0x80000000)>>>0,sections+36))),/writable executable/));
test('CFG function-table metadata is mandatory',()=>assert.throws(()=>checkKernelPe(changed(b=>b.writeUInt32LE(0x100,config+144))),/function table/));
test('zero relocation directory is rejected',()=>assert.throws(()=>checkKernelPe(changed(b=>b.writeUInt32LE(0,opt+112+5*8))),/base relocation directory/));
test('modified payload fails checksum',()=>{
 const b=Buffer.from(original);b[original.readUInt32LE(sections+20)+16]^=1;
 assert.throws(()=>checkKernelPe(b),/PE checksum/);
});
