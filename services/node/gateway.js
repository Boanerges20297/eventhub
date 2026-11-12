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
async function requestTo(url,method,body,principal,timeoutMs=5000){
  try {
    const r=await fetch(url,{method,headers:{
      ...asHeaders(principal),'content-type':'application/json'
    },body:(method==='GET'||method==='HEAD')?undefined:JSON.stringify(body||{}),
      signal:AbortSignal.timeout(timeoutMs)});
    const data=await r.json().catch(()=>({error:'RESPOSTA_INVALIDA'}));
    return {status:r.status,data};
  } catch {return {status:503,data:{error:'SERVICO_INDISPONIVEL'}};}
}
function sessionCookie(value,age){
  return 'eh_session='+value+'; Path=/api; Max-Age='+age+'; HttpOnly; SameSite=Strict'+(secure?'; Secure':'');
}
function deviceCookie(value,age){
  return 'eh_device='+value+'; Path=/api; Max-Age='+age+'; HttpOnly; SameSite=Strict'+(secure?'; Secure':'');
}
function authenticated(reply,data){
  const token=jwt(data.user);
  reply.header('set-cookie',data.device_token
    ? [sessionCookie(token,1800),deviceCookie(data.device_token,2592000)]
    : sessionCookie(token,1800));
  return {user:{id:data.user.id,role:data.user.role,org_id:data.user.org_id},
    csrf:csrf(token),expira_em_segundos:1800,
    trusted_device:data.trusted_device===true||Boolean(data.device_token)};
}
function install(server){
  const identity=process.env.IDENTITY_URL||'http://identity:3000';
  const events=process.env.EVENTS_URL||'http://events:3000';
  const registrations=process.env.REGISTRATIONS_URL||'http://registrations:8000';
  const routes=[
    // Private organizer workspace; never expose unpublished events in the catalog.
    ['GET', /^\/me\/eventos$/,events,'/internal/me/eventos','organizer'],
    ['GET', /^\/me\/eventos\/([^/]+)\/atividades$/,events,m=>'/internal/me/eventos/'+m[1]+'/atividades','organizer'],
    ['PATCH', /^\/me\/eventos\/([^/]+)$/,events,m=>'/internal/me/eventos/'+m[1],'organizer'],
    ['PATCH', /^\/me\/atividades\/([^/]+)$/,events,m=>'/internal/me/atividades/'+m[1],'organizer'],
    ['GET', /^\/me\/atividades\/([^/]+)\/resumo$/,events,m=>'/internal/me/atividades/'+m[1]+'/resumo','organizer'],
    ['GET', /^\/me\/atividades\/([^/]+)\/inscricoes$/,events,m=>'/internal/me/atividades/'+m[1]+'/inscricoes','organizer'],
    ['GET', /^\/eventos$/,events,'/internal/eventos','public'],
    ['GET', /^\/eventos\/([^/]+)\/atividades$/,events,m=>'/internal/eventos/'+m[1]+'/atividades','public'],
    ['POST', /^\/eventos$/,events,'/internal/eventos','organizer'],
    ['POST', /^\/eventos\/([^/]+)\/atividades$/,events, m=>'/internal/eventos/'+m[1]+'/atividades','organizer'],
    ['POST', /^\/atividades\/([^/]+)\/sincronizar$/,events,m=>'/internal/atividades/'+m[1]+'/sincronizar','organizer'],
    ['GET', /^\/atividades\/([^/]+)$/,events,m=>'/internal/atividades/'+m[1],'public'],
    ['POST', /^\/inscricoes$/,registrations,'/internal/inscricoes','participant'],
    ['GET', /^\/inscricoes$/,registrations,'/internal/inscricoes','authenticated'],
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
      const r=await requestTo(identity+'/internal/auth/login','POST',{
        ...(request.body||{}),device_token:cookie(request,'eh_device'),
        user_agent:request.headers['user-agent']||''},null);
      if(r.status!==200)return reply.code(r.status).send(r.data);
      if(r.data.state==='otp_required')return {
        otp_required:true,challenge_id:r.data.challenge_id,
        expires_in_seconds:r.data.expires_in_seconds,
        simulation:r.data.simulation===true,simulation_code:r.data.simulation_code
      };
      if(r.data.state!=='authenticated'||!r.data.user)return reply.code(502).send({error:'IDENTIDADE_INVALIDA'});
      return authenticated(reply,r.data);
    }
    if(method==='POST' && path==='/auth/verify'){
      const r=await requestTo(identity+'/internal/auth/verify','POST',{
        ...(request.body||{}),user_agent:request.headers['user-agent']||''},null);
      if(r.status!==200)return reply.code(r.status).send(r.data);
      if(r.data.state!=='authenticated'||!r.data.user)return reply.code(502).send({error:'IDENTIDADE_INVALIDA'});
      return authenticated(reply,r.data);
    }
    const token=cookie(request,'eh_session');
    let checked=false, p=null, authFailure=401;
    async function principal(){
      if(checked)return p;
      checked=true;
      let claims;
      try{claims=verify(token);}catch{return null;}
      const r=await requestTo(identity+'/internal/auth/session','POST',{
        sub:claims.sub,sid:claims.sid,role:claims.role,org_id:claims.org_id,ver:claims.ver
      },null,3000);
      if(r.status===200 && r.data.valid===true){p=claims;return p;}
      if(r.status===503)authFailure=503;
      else reply.header('set-cookie',sessionCookie('',0));
      return null;
    }
    if(method==='GET' && path==='/auth/me'){
      const principalData=await principal();
      if(!principalData)return reply.code(authFailure).send({error:authFailure===503?'IDENTIDADE_INDISPONIVEL':'NAO_AUTENTICADO'});
      return {user:{id:p.sub,role:p.role,org_id:p.org_id},csrf:csrf(token)};
    }
    if(method==='POST' && path==='/auth/logout'){
      const principalData=await principal();
      if(!principalData)return reply.code(authFailure).send({error:'NAO_AUTENTICADO'});
      if(!same(request.headers['x-csrf-token'],csrf(token)))
        return reply.code(403).send({error:'CSRF_INVALIDO'});
      const r=await requestTo(identity+'/internal/auth/logout','POST',{sub:p.sub,sid:p.sid},null);
      reply.header('set-cookie',sessionCookie('',0));
      if(r.status!==200)return reply.code(r.status).send({error:'REVOGACAO_NAO_CONFIRMADA'});
      return {status:'SAIU'};
    }
    if(method==='POST' && path==='/auth/device/revoke'){
      const principalData=await principal();
      if(!principalData)return reply.code(authFailure).send({error:'NAO_AUTENTICADO'});
      if(!same(request.headers['x-csrf-token'],csrf(token)))
        return reply.code(403).send({error:'CSRF_INVALIDO'});
      const r=await requestTo(identity+'/internal/auth/device/revoke','POST',{
        sub:p.sub,device_token:cookie(request,'eh_device')},null);
      if(r.status!==200)return reply.code(r.status).send(r.data);
      reply.header('set-cookie',deviceCookie('',0));
      return {status:'DISPOSITIVO_REVOGADO'};
    }
    if(path==='/health' && method==='GET')
      return {status:'up',service:'gateway',implementation:'api-mvp',business_ready:false};
    for(const [verb,re,base,target,access] of routes){
      if(method!==verb)continue;
      const match=path.match(re);
      if(!match)continue;
      if(access!=='public' && !(await principal()))
        return reply.code(authFailure).send({error:authFailure===503?'IDENTIDADE_INDISPONIVEL':'NAO_AUTENTICADO'});
      if(access==='organizer' && !['organizer','admin'].includes(p.role))
        return reply.code(403).send({error:'SEM_PERMISSAO'});
      if(access==='participant' && p.role!=='participant' && p.role!=='admin')
        return reply.code(403).send({error:'SEM_PERMISSAO'});
      if(method!=='GET'&&!same(request.headers['x-csrf-token'],csrf(token)))
        return reply.code(403).send({error:'CSRF_INVALIDO'});
      const route=typeof target==='function'?target(match):target;
      // Preserve only the validated listing parameters for the owner-scoped API.
      const query=(method==='GET' && (path==='/inscricoes' || /^\/me\/atividades\/[^/]+\/inscricoes$/.test(path)))
        ? new URL(request.url,'http://eventhub.internal').search : '';
      const body={...(request.body||{})};
      if(method==='POST'&&(path==='/inscricoes'||/^\/pagamentos\/[^/]+\/simular$/.test(path))){
        body.idempotency_key=request.headers['idempotency-key'];
      }
      // Inscricoes usam registro duravel; sob grande carga o SQLite pode
      // confirmar o ticket apos o timeout curto do proxy. Nao responder 503
      // prematuramente quando o backend ainda esta processando o pedido.
      const timeoutMs=path==='/inscricoes' && method==='POST' ? 45000 : 5000;
      const r=await requestTo(base+route+query,method,body,p,timeoutMs);
      return reply.code(r.status).send(r.data);
    }
    return reply.code(404).send({error:'ROTA_NAO_ENCONTRADA'});
  });
}
module.exports={install};
