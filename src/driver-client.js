'use strict';
const {execFile} = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {validatePolicy,encodePolicy} = require('./driver-policy');
class DriverClient {
  constructor(executable=path.join(__dirname,'..','driver-bin','iprcctl.exe'),run) {
    this.executable=executable;
    this.run=run || ((args)=>new Promise((resolve,reject)=>{
      execFile(this.executable,args,{windowsHide:true,timeout:5000,maxBuffer:262144,encoding:'utf8'},(error,stdout,stderr)=>{
        if(error) {
          let message=(stderr||error.message).trim();
          if(error.code==='ENOENT') message='缺少配套 iprcctl.exe，请使用完整的驱动版软件目录';
          else if(/Windows error 5\./.test(message)) message='需要管理员权限：关闭软件后，以管理员身份运行';
          else if(/Windows error 259\./.test(message)) message='驱动控制接口未连接，请唤醒遥控器；若仍失败，检查驱动是否已安装并启动';
          else if(/Windows error 32\./.test(message)) message='其他程序正在访问驱动，请稍后重试';
          reject(new Error(message));
        } else resolve(stdout);
      });
    }));
    this.pending=Promise.resolve();
  }
  exclusive(work) {
    const next=this.pending.then(work);
    this.pending=next.catch(()=>{});
    return next;
  }
  async read() {
    const state=JSON.parse(await this.run(['snapshot']));
    validatePolicy(state);
    return state;
  }
  snapshot() { return this.exclusive(()=>this.read()); }
  update(edit,persist=false) {
    return this.exclusive(async()=>{
      const current=await this.read();
      const next=edit(structuredClone(current));
      const bytes=encodePolicy(next);
      const directory=await fs.mkdtemp(path.join(os.tmpdir(),'iprc-policy-'));
      try {
        const file=path.join(directory,'policy.bin');
        await fs.writeFile(file,bytes,{flag:'wx'});
        await this.run(['apply',file,...(persist?['--persist']:[])]);
        return await this.read();
      } finally {
        await fs.rm(directory,{recursive:true,force:true});
      }
    });
  }
}
module.exports={DriverClient};
