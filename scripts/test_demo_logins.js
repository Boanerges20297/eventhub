'use strict';
// Smoke test local-only: no passwords printed, no user creation, no database reset.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:8088';
const fixture=path.join(__dirname,'../.demo-credentials.local.json');
const users=JSON.parse(fs.readFileSync(fixture,'utf8')).accounts;
async function validate(role){
  const account=users.find(x=>x.role===role);
  assert(account && account.password, 'Conta ausente: '+role);
  let cookie='',csrf='';
  async function api(method,url,body){
    const headers={'Origin':base};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(cookie)headers.Cookie=cookie;
    if(csrf && method!=='GET')headers['X-CSRF-Token']=csrf;
    const res=await fetch(base+'/api'+url,{
      method,headers,body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(12000)});
    const c=res.headers.get('set-cookie');
    if(c)cookie=c.split(';')[0];
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(role+' '+url+' HTTP '+res.status+' '+String(data.error||data.detail||''));
    return data;
  }
  const challenge=await api('POST','/auth/login',{email:account.email,password:account.password});
  let auth=challenge;
  if(challenge.otp_required){
    assert(challenge.simulation===true && /^[0-9]{6}$/.test(challenge.simulation_code||''),
      'OTP simulado nao disponivel no laboratorio');
    auth=await api('POST','/auth/verify',{
      challenge_id:challenge.challenge_id,code:challenge.simulation_code,trust_device:false});
  }
  assert.equal(auth.user.role,role);
  csrf=auth.csrf;
  const me=await api('GET','/auth/me');
  assert.equal(me.user.id,auth.user.id);
  await api('POST','/auth/logout',{});
  console.log('LOGIN_DEMO_OK',role,'otp='+Boolean(challenge.otp_required),'session=true','logout=true');
}
(async()=>{
  for(const role of ['admin','organizer','participant'])await validate(role);
  console.log('DEMO_LOGINS_OK profiles=3');
})().catch(e=>{console.error('DEMO_LOGINS_FAILED',e.message);process.exitCode=1});
