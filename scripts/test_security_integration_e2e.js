'use strict';
// Real Docker E2E for the two-step Identity/Gateway flow.
// Run inside eventhub-identity, with simulated OTP enabled in local dev only.
// Creates and removes only its own synthetic participant accounts.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {db}=require(process.cwd()+'/database.js');
const BASE='http://gateway:3000';
const UA='EventHub-Security-E2E/1.0';
const passed=[];
const ids=[];
class Client{
  constructor(){this.cookies=new Map();this.csrf='';}
  async call(method,path,body,includeCsrf=true){
    const headers={Origin:BASE,'User-Agent':UA};
    if(body!==undefined)headers['content-type']='application/json';
    if(this.cookies.size)headers.cookie=[...this.cookies].map(([k,v])=>k+'='+v).join('; ');
    if(method!=='GET'&&includeCsrf&&this.csrf)headers['x-csrf-token']=this.csrf;
    const r=await fetch(BASE+path,{
      method,headers,body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(15000)
    });
    const data=await r.json().catch(()=>({}));
    const sets=typeof r.headers.getSetCookie==='function'
      ? r.headers.getSetCookie()
      : [r.headers.get('set-cookie')].filter(Boolean);
    for(const str of sets){
      const item=str.split(';',1)[0];
      const idx=item.indexOf('=');
      if(idx>0){
        const key=item.slice(0,idx),value=item.slice(idx+1);
        if(!value||/max-age=0/i.test(str))this.cookies.delete(key);
        else this.cookies.set(key,value);
      }
    }
    return {status:r.status,data};
  }
}
const mark=(name)=>{passed.push(name);console.log('SECURITY_E2E_PASS '+name)};
const ok=(response,status)=>assert.equal(response.status,status,JSON.stringify(response.data));
const a=new Client(),b=new Client();
const id=crypto.randomUUID().slice(0,12);
const accounts=[
  {email:'eh-sec-a-'+id+'@example.test',password:'E2e-Alpha-Password-2026!'},
  {email:'eh-sec-b-'+id+'@example.test',password:'E2e-Bravo-Password-2026!'}
];
async function register(c,account){
  const res=await c.call('POST','/auth/register',account);
  ok(res,201);
  assert.match(res.data.user_id,/^[0-9a-f-]{36}$/);
  ids.push(res.data.user_id);
}
async function login(c,account){
  const res=await c.call('POST','/auth/login',account);
  ok(res,200);
  return res.data;
}
async function verify(c,challenge,trust=false,code=challenge.simulation_code){
  return c.call('POST','/auth/verify',{
    challenge_id:challenge.challenge_id,code,trust_device:trust
  });
}
(async()=>{
 try{
   ok(await a.call('GET','/auth/me'),401);
   mark('unauthenticated access denied');

   await register(a,accounts[0]);await register(b,accounts[1]);
   mark('two isolated participants registered');

   const challenge=await login(a,accounts[0]);
   assert.equal(challenge.otp_required,true);
   assert.equal(challenge.simulation,true,'Dev-only OTP simulation must be enabled for this E2E');
   assert.match(challenge.simulation_code,/^\d{6}$/);
   mark('password alone does not authenticate');

   const wrong=challenge.simulation_code==='000000'?'111111':'000000';
   ok(await verify(a,challenge,false,wrong),401);
   const accepted=await verify(a,challenge,false);
   ok(accepted,200);
   assert.equal(accepted.data.user.role,'participant');
   a.csrf=accepted.data.csrf;
   const firstSession=a.cookies.get('eh_session');
   assert.ok(firstSession);
   ok(await verify(a,challenge,false),401);
   mark('OTP invalid then consumed once');

   ok(await a.call('GET','/auth/me'),200);
   ok(await a.call('GET','/me/eventos'),403);
   mark('session validated and organizer scope denied');

   const tamper=new Client();
   const parts=firstSession.split('.');
   const payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
   payload.role='admin';
   const fake=[parts[0],Buffer.from(JSON.stringify(payload)).toString('base64url'),parts[2]].join('.');
   tamper.cookies.set('eh_session',fake);
   ok(await tamper.call('GET','/auth/me'),401);
   mark('modified JWT cannot elevate privileges');

   ok(await a.call('POST','/auth/logout',{},false),403);
   ok(await a.call('POST','/auth/logout',{}),200);
   const replay=new Client();
   replay.cookies.set('eh_session',firstSession);
   ok(await replay.call('GET','/auth/me'),401);
   mark('CSRF protection, logout and session replay rejection');

   const second=await login(a,accounts[0]);
   assert.equal(second.otp_required,true);
   const trust=await verify(a,second,true);
   ok(trust,200);
   a.csrf=trust.data.csrf;
   const device=a.cookies.get('eh_device');
   assert.match(device,/^[A-Za-z0-9_-]{43}$/);
   mark('explicit trusted-device enrollment');

   const direct=await login(a,accounts[0]);
   assert.equal(direct.trusted_device,true);
   assert.ok(a.cookies.get('eh_session'));
   a.csrf=direct.csrf;
   mark('trusted device skips OTP with valid bound token');

   ok(await a.call('POST','/auth/device/revoke',{}),200);
   const revoked=new Client();
   revoked.cookies.set('eh_device',device);
   const blocked=await login(revoked,accounts[0]);
   assert.equal(blocked.otp_required,true,'Revoked device must not bypass OTP');
   mark('revoked trusted device loses OTP bypass');

   await db().execute('UPDATE users SET auth_version=auth_version+1 WHERE id=?',[ids[0]]);
   ok(await a.call('GET','/auth/me'),401);
   mark('auth version invalidates active JWT at gateway');

   for(let i=0;i<3;i++){
     const attempt=await b.call('POST','/auth/login',{
       email:accounts[1].email,password:'intentionally-wrong-password'
     });
     ok(attempt,i<2?401:429);
     if(i===2)assert.equal(attempt.data.error,'LOGIN_BLOQUEADO_TEMPORARIAMENTE');
   }
   const correct=await b.call('POST','/auth/login',accounts[1]);
   ok(correct,429);
   assert.equal(correct.data.error,'LOGIN_BLOQUEADO_TEMPORARIAMENTE');
   mark('three incorrect passwords lock account and block valid credentials');

   console.log('SECURITY_INTEGRATION_E2E_OK checks='+passed.length+
     ' otp=true jwt=true csrf=true rbac=true sessions=true device=true lockout=true');
 }finally{
   if(ids.length){
     try{
       const placeholders=ids.map(()=>'?').join(',');
       await db().execute('DELETE FROM users WHERE id IN ('+placeholders+')',ids);
       console.log('SECURITY_E2E_SYNTHETIC_USERS_CLEANED='+ids.length);
     }catch(err){
       console.error('SECURITY_E2E_CLEANUP_FAILED='+err.code);
       process.exitCode=1;
     }
   }
   await db().end();
 }
})().catch(err=>{console.error('SECURITY_INTEGRATION_E2E_FAILED '+(err.stack||err.message));process.exitCode=1;});
