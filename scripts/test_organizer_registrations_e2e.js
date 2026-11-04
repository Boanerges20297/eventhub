'use strict';
// Feature-only test: organizer read-only registration list, pagination and status filters.
// Run on local EventHub development containers, with synthetic accounts only.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const BASE='http://gateway:3000';
class Client{
  constructor(){this.cookie='';this.csrf='';}
  async call(method,path,body,key){
    const headers={Origin:BASE};
    if(body!==undefined)headers['content-type']='application/json';
    if(this.cookie)headers.Cookie=this.cookie;
    if(this.csrf&&method!=='GET')headers['x-csrf-token']=this.csrf;
    if(key)headers['idempotency-key']=key;
    const r=await fetch(BASE+path,{
      method,headers,body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(15000)
    });
    const setCookie=r.headers.get('set-cookie');
    if(setCookie)this.cookie=setCookie.split(';')[0];
    return {status:r.status,body:await r.json().catch(()=>({}))};
  }
  async login(email,password){
    const r=await this.call('POST','/auth/login',{email,password});
    assert.equal(r.status,200,JSON.stringify(r.body));
    this.csrf=r.body.csrf;
  }
}
function cpf(seed){
  let digits=String(85000+seed).padStart(9,'0');
  for(const size of [9,10]){
    const check=Array.from({length:size},(_,i)=>Number(digits[i])*(size+1-i))
      .reduce((sum,value)=>sum+value,0)*10%11;
    digits+=check===10?'0':String(check);
  }
  return digits;
}
async function main(){
  const owner=new Client();
  await owner.login(process.env.EVENTHUB_BOOTSTRAP_EMAIL,
                    process.env.EVENTHUB_BOOTSTRAP_PASSWORD);
  let r=await owner.call('POST','/eventos',{
    titulo:'Gestao de inscritos '+crypto.randomUUID().slice(0,8)
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
  const eventId=r.body.evento_id;
  r=await owner.call('POST','/eventos/'+eventId+'/atividades',{
    titulo:'Listagem paginada',capacidade:2,gratuita:true,
    lista_espera_habilitada:true,prazo_reserva_min:30
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
  const id=r.body.atividade_id;
  r=await owner.call('GET','/me/atividades/'+id+'/inscricoes?limit=2');
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.total,0);
  assert.equal(r.body.origem,'mysql_processadas');

  const participants=[];
  for(let i=0;i<4;i++){
    const c=new Client();
    const email='inscricoes-'+crypto.randomUUID()+'@eventhub.local';
    const password=crypto.randomBytes(16).toString('hex')+'Aa!';
    r=await c.call('POST','/auth/register',{email,password});
    assert.equal(r.status,201,JSON.stringify(r.body));
    await c.login(email,password);
    participants.push(c);
    r=await c.call('POST','/inscricoes',{
      atividade_id:id,cpf:cpf(i)
    },crypto.randomUUID());
    assert.equal(r.status,202,JSON.stringify(r.body));
  }

  let all;
  for(let tries=0;tries<45;tries++){
    r=await owner.call('GET','/me/atividades/'+id+'/inscricoes?limit=2&offset=0');
    assert.equal(r.status,200,JSON.stringify(r.body));
    if(r.body.total===4){all=r.body;break;}
    await new Promise(ok=>setTimeout(ok,350));
  }
  assert.ok(all,'tickets not reconciled');
  assert.equal(all.total,4);
  assert.equal(all.inscricoes.length,2);
  assert.deepEqual(all.inscricoes.map(x=>x.numero_ticket),[1,2]);
  r=await owner.call('GET','/me/atividades/'+id+'/inscricoes?limit=2&offset=2');
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body.inscricoes.map(x=>x.numero_ticket),[3,4]);

  // Wait for the already-supported grants; focus assertions on list filtering.
  let confirmed,waiting;
  for(let tries=0;tries<45;tries++){
    [confirmed,waiting]=await Promise.all([
      owner.call('GET','/me/atividades/'+id+'/inscricoes?estado=CONFIRMADO'),
      owner.call('GET','/me/atividades/'+id+'/inscricoes?estado=EM_FILA')
    ]);
    if(confirmed.body.total===2&&waiting.body.total===2)break;
    await new Promise(ok=>setTimeout(ok,350));
  }
  assert.equal(confirmed.status,200);
  assert.equal(waiting.status,200);
  assert.equal(confirmed.body.total,2);
  assert.equal(waiting.body.total,2);
  assert.deepEqual(confirmed.body.inscricoes.map(x=>x.numero_ticket),[1,2]);
  assert.deepEqual(waiting.body.inscricoes.map(x=>x.numero_ticket),[3,4]);

  for(const item of [...confirmed.body.inscricoes,...waiting.body.inscricoes]){
    assert.deepEqual(Object.keys(item).sort(),
      ['estado','inscricao_id','numero_ticket']);
    assert.equal(typeof item.inscricao_id,'string');
  }
  r=await owner.call('GET','/me/atividades/'+id+'/inscricoes?estado=INVALIDO');
  assert.equal(r.status,400,JSON.stringify(r.body));
  r=await owner.call('GET','/me/atividades/'+id+'/inscricoes?limit=101');
  assert.equal(r.status,422,JSON.stringify(r.body));
  r=await participants[0].call('GET','/me/atividades/'+id+'/inscricoes');
  assert.equal(r.status,403,JSON.stringify(r.body));
  r=await owner.call('GET','/me/atividades/00000000-0000-0000-0000-000000000000/inscricoes');
  assert.equal(r.status,404);
  console.log('ORGANIZER_REGISTRATIONS_E2E_OK',
    'total=4 confirmed=2 waiting=2 pagination=true filtering=true',
    'privacy=true participant_denied=true invalid_filters_rejected=true');
}
main().catch(e=>{
  console.error('ORGANIZER_REGISTRATIONS_E2E_FAILED',e.stack||e.message);
  process.exitCode=1;
});
