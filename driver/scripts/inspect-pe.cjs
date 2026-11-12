'use strict';
const fs=require('node:fs');
const {checkKernelPe}=require('../shared/pe-check.cjs');
const file=process.argv[2];
if(!file)throw new Error('usage: node inspect-pe.cjs FILE [--allow-signed]');
console.log(JSON.stringify({file,...checkKernelPe(fs.readFileSync(file),{allowSigned:process.argv.includes('--allow-signed')})},null,2));
