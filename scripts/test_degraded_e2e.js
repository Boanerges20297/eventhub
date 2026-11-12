'use strict';
/** Ensaio E2E da contingencia pela API (nao interrompe containers).
 * Orquestrar os tres modos setup/during/after usando NEXO + compose isolado.
 * Stop/start MySQL SOMENTE mediante autorizacao do proprietario.
 */
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const BASE='http://gateway:3000';
class Client{
  constructor(cookie='',csrf=''){this.cookie=cookie;this.csrf=csrf;}
  async call(method,path,data,key){
    const headers={Origin:BASE};
    if(data!==undefined)headers['content-type']='application/json';
    if(this.cookie)headers.Cookie=this.cookie;
    if(this.csrf&&method!=='GET')headers['x-csrf-token']=this.csrf;
    if(key)headers['idempotency-key']=key;
    const r=await fetch(BASE+path,{method,headers,
      body:data===undefined?undefined:JSON.stringify(data),
      signal:AbortSignal.timeout(16000)});
    const body=await r.json().catch(()=>({}));
    const cookie=r.headers.get('set-cookie');
    if(cookie)this.cookie=cookie.split(';')[0];
    return {code:r.status,body};
  }
  async login(email,password){
    let r=await this.call('POST','/auth/login',{email,password});
    if (r.body?.otp_required === true) {
      assert.equal(r.body.simulation, true, "E2E requires simulated OTP in local development");
      r = await this.call("POST","/auth/verify",{challenge_id:r.body.challenge_id,code:r.body.simulation_code});
    }
    assert.equal(r.code,200,JSON.stringify(r.body));
    this.csrf=r.body.csrf;
  }
}
function cpf(seed){
  let digits=String(87000+seed).padStart(9,'0');
  for(const size of [9,10]){
    const check=Array.from({length:size},(_,i)=>Number(digits[i])*(size+1-i))
      .reduce((a,b)=>a+b,0)*10%11;
    digits+=check===10?'0':String(check);
  }
  return digits;
}
function state(){
  const b64=process.env.EVENTHUB_TEST_STATE_B64||'';
  return JSON.parse(Buffer.from(b64,'base64').toString('utf8'));
}
function emit(value){console.log('DEGRADED_E2E_STATE_B64='+Buffer.from(JSON.stringify(value)).toString('base64'));}
async function setup(){
  const org=new Client();
  await org.login(process.env.EVENTHUB_BOOTSTRAP_EMAIL,
    process.env.EVENTHUB_BOOTSTRAP_PASSWORD);
  const event=await org.call('POST','/eventos',{
    titulo:'Falha real publica '+crypto.randomUUID().slice(0,8)});
  assert.equal(event.code,201,JSON.stringify(event.body));
  const activity=await org.call('POST',
    '/eventos/'+event.body.evento_id+'/atividades',{
      titulo:'Atividade previamente publicada, cache duravel',
      capacidade:2,gratuita:true,lista_espera_habilitada:true,
      prazo_reserva_min:30});
  assert.equal(activity.code,201,JSON.stringify(activity.body));
  assert.equal(activity.body.publicada,true);
  const users=[];
  for(let i=0;i<3;i++){
    const c=new Client();
    const email='chaos-degraded-'+crypto.randomUUID()+'@eventhub.local';
    const password=crypto.randomBytes(18).toString('hex')+'Aa!';
    const registered=await c.call('POST','/auth/register',{email,password});
    assert.equal(registered.code,201,JSON.stringify(registered.body));
    await c.login(email,password);
    users.push({cookie:c.cookie,csrf:c.csrf});
  }
  emit({activity:activity.body.atividade_id,users});
  console.log('DEGRADED_E2E_SETUP_OK','capacity=2','published=true',
    'users=3','activity='+activity.body.atividade_id);
}
async function during(){
  const s=state();
  const results=await Promise.all(s.users.map((p,i)=>{
    const c=new Client(p.cookie,p.csrf);
    return c.call('POST','/inscricoes',{
      atividade_id:s.activity,cpf:cpf(i)
    },crypto.randomUUID());
  }));
  assert.ok(results.every(r=>r.code===202),
    'HTTP_RESPONSES='+JSON.stringify(results.map(r=>({code:r.code,body:r.body}))));
  assert.ok(results.every(r=>r.body.estado==='REGISTRADO'&&r.body.modo_degradado===true),
    'NOT_DEGRADED='+JSON.stringify(results.map(r=>r.body)));
  const nums=results.map(r=>r.body.numero_ticket);
  assert.deepEqual([...nums].sort((a,b)=>a-b),[1,2,3]);
  const unknown=new Client(s.users[0].cookie,s.users[0].csrf);
  const fail=await unknown.call('POST','/inscricoes',{
    atividade_id:crypto.randomUUID(),cpf:cpf(77)
  },crypto.randomUUID());
  assert.equal(fail.code,503,'UNKNOWN_ACTIVITY_ACCEPTED='+JSON.stringify(fail));
  assert.equal(fail.body.detail,'PUBLICACAO_NAO_VERIFICAVEL');
  s.ids=results.map(r=>r.body.inscricao_id);
  s.nums=nums;
  emit(s);
  console.log('DEGRADED_E2E_DURING_OK','submitted=3','locally_registered=3',
    'unknown_rejected=true','fifo=true');
}
async function after(){
  const s=state();
  let states=[];
  const end=Date.now()+75000;
  do {
    states=await Promise.all(s.users.map(async(p,i)=>{
      const c=new Client(p.cookie,p.csrf);
      const r=await c.call('GET','/inscricoes/'+s.ids[i]);
      return r.code===200?r.body.estado:'HTTP_'+r.code;
    }));
    if(states.every(x=>x==='CONFIRMADO'||x==='EM_FILA'))break;
    await new Promise(r=>setTimeout(r,1000));
  }while(Date.now()<end);
  const ordered=s.nums.map((n,i)=>({ticket:n,status:states[i]}))
    .sort((a,b)=>a.ticket-b.ticket);
  assert.deepEqual(ordered.map(x=>x.status),
    ['CONFIRMADO','CONFIRMADO','EM_FILA']);
  console.log('DEGRADED_E2E_RECOVERY_OK','activity='+s.activity,
    'confirmed=2','waiting=1','fifo=true','overbooking=false');
}
const mode=process.env.EVENTHUB_TEST_MODE||'setup';
const run={setup,during,after}[mode];
(run ? run() : Promise.reject(new Error('INVALID_MODE')))
 .catch(e=>{console.error('DEGRADED_E2E_FAILED',e.message);process.exitCode=1;});
