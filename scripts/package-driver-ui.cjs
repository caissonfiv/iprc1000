'use strict';
const fs=require('fs/promises'),path=require('path');
async function main(){
  const repo=path.resolve(__dirname,'..');
  await fs.access(path.join(repo,'driver-bin/iprcctl.exe'));
  const stage=await fs.mkdtemp(path.join(repo,'dist-driver-stage-'));
  try{
    for(const file of ['main.js','LICENSE','README.md','CHANGELOG.md','src/driver-app.js','src/driver-client.js','src/driver-policy.js','src/device-profile.js','ui/driver.html','ui/driver.js','ui/icon.ico','driver-bin/iprcctl.exe']){
      const target=path.join(stage,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(repo,file),target);
    }
    const mainPath=path.join(stage,'main.js');
    await fs.writeFile(mainPath,(await fs.readFile(mainPath,'utf8')).replace("const DRIVER_MODE = process.env.IPRC_BACKEND !== 'legacy';",'const DRIVER_MODE = true;'));
    const version=JSON.parse(await fs.readFile(path.join(repo,'package.json'),'utf8')).version;
    await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:'iprc1000-driver-ui',version,author:'Caisson',description:'IPRC1000 driver control panel',main:'main.js',license:'MIT'}));
    const {packager}=await import('@electron/packager');
    const electronVersion=JSON.parse(await fs.readFile(path.join(repo,'node_modules/electron/package.json'),'utf8')).version;
    const result=await packager({dir:stage,name:'IPRC1000-Driver',platform:'win32',arch:'x64',out:path.join(repo,'dist/driver-ui'),overwrite:true,
      icon:path.join(repo,'ui/icon.ico'),appVersion:version,electronVersion,asar:false,...(process.env.IPRC_ELECTRON_ZIP_DIR?{electronZipDir:path.resolve(process.env.IPRC_ELECTRON_ZIP_DIR)}:{})});
    console.log(result.join('\n'));
  }finally{
    // Only the unique staging directory created above is removed.
    await fs.rm(stage,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
