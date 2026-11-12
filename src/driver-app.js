'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DriverClient}=require('./driver-client');
const {slots,outputs,validateRule,defaults}=require('./driver-policy');
function createDriverServer(client=new DriverClient(),{diagnostic=false}={}) {
  const token=crypto.randomBytes(32).toString('hex');
  const html=fs.readFileSync(path.join(__dirname,'../ui/driver.html'),'utf8').replace('__IPRC_TOKEN__',token);
  const server=http.createServer(async(req,res)=>{
    const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    const host='127.0.0.1:'+server.address().port;
    if(req.headers.host!==host) return send(403,{error:'Invalid host'});
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
    try {
      if(req.method==='GET'&&req.url==='/') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(html);}
      if(req.method==='GET'&&req.url==='/driver.js') {res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'../ui/driver.js')));}
      if(req.method==='GET'&&req.url==='/api/app') {
        let state=null,error=null;
        try {state=await client.snapshot();} catch(e){error=e.message;}
        return send(200,{slots,outputs,state,error,diagnostic,backend:'driver'});
      }
      if(req.method!=='POST') return send(404,{error:'Not found'});
      if(req.headers['x-iprc-token']!==token || (req.headers.origin&&req.headers.origin!=='http://'+host)) return send(403,{error:'Invalid request token'});
      if(!['/api/action','/api/mode','/api/persist','/api/reset','/api/panic'].includes(req.url)) return send(404,{error:'Not found'});
      if(req.headers['content-type']!=='application/json') return send(415,{error:'Expected application/json'});
      let body='';
      for await(const part of req) {body+=part; if(body.length>4096) return send(413,{error:'Request too large'});}
      const data=JSON.parse(body||'{}');
      if(data.persist!==undefined&&typeof data.persist!=='boolean') throw new Error('无效的保存选项');
      const persist=data.persist===true;
      let edit=p=>p;
      if(req.url==='/api/action') {
        if(!slots.some(s=>s.usage===data.usage)) throw new Error('未知的遥控器按键');
        const rule=validateRule(data.rule);
        edit=p=>{p.rules[data.usage]=rule;return p;};
      } else if(req.url==='/api/mode') {
        if(![0,1].includes(data.mode)) throw new Error('无效模式');
        edit=p=>{p.mode=data.mode;return p;};
      } else if(req.url==='/api/panic') edit=p=>{p.mode=0;return p;};
      else if(req.url==='/api/reset') edit=p=>defaults(p.mode);
      const state=await client.update(edit,persist);
      send(200,{ok:true,state,persisted:persist});
    } catch(e) {send(400,{error:e.message});}
  });
  return server;
}
if(require.main===module) {
  const diagnostic=process.env.IPRC_DIAGNOSTIC==='1';
  let client;
  if(diagnostic) {
    // Isolated UI tests: never open the real control device.
    let state={...defaults(),connected:1,queued:0,accepted:'0',delivered:'0',suppressed:'0'};
    client={snapshot:async()=>structuredClone(state),update:async(edit)=>{state=edit(structuredClone(state));return structuredClone(state);}};
  }
  const server=createDriverServer(client,{diagnostic});
  server.listen(Number(process.env.PORT||7788),'127.0.0.1',()=>console.log('Driver UI listening on '+server.address().port+(diagnostic?' [diagnostic]':'')));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>process.exit(0)));
}
module.exports={createDriverServer};
