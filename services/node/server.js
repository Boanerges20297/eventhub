'use strict';
const Fastify = require('fastify');
const {init} = require('./database');
const service=process.env.SERVICE_NAME;
if(!['identity','events','payments','gateway'].includes(service)) throw new Error('SERVICE_NAME_INVALIDO');
const server=Fastify({logger:true,bodyLimit:1024*1024,trustProxy:false});

server.get('/health',async()=>({
  status:'up',service,implementation:'mvp-em-construcao',
  business_ready:false
}));
async function start(){
  if(service==='identity'){
    await init(service);
    const identity=require('./identity');
    await identity.bootstrap();
    identity.install(server);
    identity.startCleanup();
  }else if(service==='events'){
    await init(service);
    require('./events').install(server);
  }else if(service==='payments'){
    await init(service);
    require('./payments').install(server);
  }else if(service==='gateway'){
    require('./rate-limit').install(server);
    require('./gateway').install(server);
  }
  await server.listen({port:Number(process.env.PORT||3000),host:'0.0.0.0'});
}
start().catch(e=>{server.log.error({code:e.code||'BOOT_FAILED'},'Falha na inicializacao');process.exit(1);});
