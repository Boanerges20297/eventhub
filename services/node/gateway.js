'use strict';
const {jwt,verify,csrf,same,asHeaders} = require('./security');
const secure = process.env.EVENTHUB_COOKIE_SECURE !== 'false';

function cookie(request,name){
  const cookie=String(request.headers.cookie||'');
  for(const part of cookie.split(';')){
    const [key,...value]=part.trim().split('=');
    if(key===name)return value.join('=');
  }
  return '';
}
function originOK(request){
  const origin=request.headers.origin;
  if(!origin) return false;
  try {
    const src=new URL(origin);
    const host=String(request.headers.host||'');
    return src.host===host && (src.protocol==='https:' || (!secure && src.protocol==='http:'));
  }catch{return false;}
}
async function requestTo(url,method,body,principal){
  try {
    const r=await fetch(url,{method,headers:{
      ...asHeaders(principal),'content-type':'application/json'
    },body:(method==='GET'||method==='HEAD')?undefined:JSON.stringify(body||{}),
      signal:AbortSignal.timeout(5000)});
    const data=await r.json().catch(()=>({error:'RESPOSTA_INVALIDA'}));
    return {status:r.status,data};
  } catch {return {status:503,data:{error:'SERVICO_INDISPONIVEL'}};}
}
function install(server){
  const identity=process.env.IDENTITY_URL||'http://identity:3000';
  const events=process.env.EVENTS_URL||'http://events:3000';
  const registrations=process.env.REGISTRATIONS_URL||'http://registrations:8000';
  const routes=[
    ['GET', /^\/eventos$/,events,'/internal/eventos','public'],
    ['GET', /^\/eventos\/([^/]+)\/atividades$/,events,m=>'/internal/eventos/'+m[1]+'/atividades','public'],
    ['POST', /^\/eventos$/,events,'/internal/eventos','organizer'],
    ['POST', /^\/eventos\/([^/]+)\/atividades$/,events, m=>'/internal/eventos/'+m[1]+'/atividades','organizer'],
    ['POST', /^\/atividades\/([^/]+)\/sincronizar$/,events,m=>'/internal/atividades/'+m[1]+'/sincronizar','organizer'],
    ['GET', /^\/atividades\/([^/]+)$/,events,m=>'/internal/atividades/'+m[1],'public'],
    ['POST', /^\/inscricoes$/,registrations,'/internal/inscricoes','participant'],
    ['POST', /^\/pagamentos\/([^/]+)\/simular$/,process.env.PAYMENTS_URL||'http://payments:3000',m=>'/internal/pagamentos/'+m[1]+'/simular','participant'],
    ['GET', /^\/pagamentos\/([^/]+)$/,process.env.PAYMENTS_URL||'http://payments:3000',m=>'/internal/pagamentos/'+m[1],'authenticated'],
    ['GET', /^\/inscricoes\/([^/]+)$/,registrations,m=>'/internal/inscricoes/'+m[1],'authenticated'],
    ['GET', /^\/notificacoes$/,process.env.NOTIFICATIONS_URL||'http://notifications:8000','/internal/notificacoes','authenticated'],
    ['POST', /^\/inscricoes\/([^/]+)\/cancelar$/,registrations,m=>'/internal/inscricoes/'+m[1]+'/cancelar','authenticated'],
  ];
  // Entrypoint reachability is local-only in development; CSRF applies to all browser writes.
  server.all('/*', async(request,reply)=>{
    const path=request.url.split('?')[0];
    const method=request.method;
    if(method!=='GET' && method!=='HEAD' && !originOK(request))
      return reply.code(403).send({error:'ORIGIN_INVALIDA'});
    if(method==='POST' && path==='/auth/register'){
      const r=await requestTo(identity+'/internal/auth/register','POST',request.body,null);
      return reply.code(r.status).send(r.data);
    }
    if(method==='POST' && path==='/auth/login'){
      const r=await requestTo(identity+'/internal/auth/login','POST',request.body,null);
      if(r.status!==200)return reply.code(r.status).send(r.data);
      const token=jwt(r.data.user);
      reply.header('set-cookie',
        'eh_session='+token+'; Path=/api; Max-Age=1800; HttpOnly; SameSite=Strict'+(secure?'; Secure':''));
      return {user:{id:r.data.user.id,role:r.data.user.role,org_id:r.data.user.org_id},
        csrf:csrf(token),expira_em_segundos:1800};
    }
    const token=cookie(request,'eh_session');
    let p=null;
    try{if(token)p=verify(token);}catch{}
    if(method==='GET' && path==='/auth/me'){
      if(!p)return reply.code(401).send({error:'NAO_AUTENTICADO'});
      return {user:{id:p.sub,role:p.role,org_id:p.org_id},csrf:csrf(token)};
    }
    if(method==='POST'&&path==='/auth/logout'){
      if(!p)return reply.code(401).send({error:'NAO_AUTENTICADO'});
      if(!same(request.headers['x-csrf-token'],csrf(token)))
        return reply.code(403).send({error:'CSRF_INVALIDO'});
      reply.header('set-cookie','eh_session=; Path=/api; Max-Age=0; HttpOnly; SameSite=Strict'+(secure?'; Secure':''));
      return {status:'SAIU'};
    }
    if(path==='/health' && method==='GET')
      return {status:'up',service:'gateway',implementation:'api-mvp',business_ready:false};
    for(const [verb,re,base,target,access] of routes){
      if(method!==verb)continue;
      const match=path.match(re);
      if(!match)continue;
      if(access!=='public'&&!p)return reply.code(401).send({error:'NAO_AUTENTICADO'});
      if(access==='organizer' && !['organizer','admin'].includes(p.role))
        return reply.code(403).send({error:'SEM_PERMISSAO'});
      if(access==='participant' && p.role!=='participant' && p.role!=='admin')
        return reply.code(403).send({error:'SEM_PERMISSAO'});
      if(method!=='GET'&&!same(request.headers['x-csrf-token'],csrf(token)))
        return reply.code(403).send({error:'CSRF_INVALIDO'});
      const route=typeof target==='function'?target(match):target;
      const body={...(request.body||{})};
      if(method==='POST'&&(path==='/inscricoes'||/^\/pagamentos\/[^/]+\/simular$/.test(path))){
        body.idempotency_key=request.headers['idempotency-key'];
      }
      const r=await requestTo(base+route,method,body,p);
      return reply.code(r.status).send(r.data);
    }
    return reply.code(404).send({error:'ROTA_NAO_ENCONTRADA'});
  });
}
module.exports={install};
