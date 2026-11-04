'use strict';
// Executar dentro do container identity em rede Docker: node - < scripts/test_http_e2e.js
// Credenciais de bootstrap ja sao variaveis locais do container; nao sao impressas.
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const BASE=process.env.EVENTHUB_TEST_URL||'http://gateway:3000';
const origin=BASE;
class Client {
  constructor(){this.cookie='';this.csrf='';}
  async call(method,path,data,opts={}){
    const headers={Origin:origin};
    if(data!==undefined)headers['Content-Type']='application/json';
    if(this.cookie)headers.Cookie=this.cookie;
    if(this.csrf && opts.csrf!==false && method!=='GET')headers['X-CSRF-Token']=this.csrf;
    if(opts.key)headers['Idempotency-Key']=opts.key;
    const response=await fetch(BASE+path,{
      method,headers,body:data===undefined?undefined:JSON.stringify(data),
      signal:AbortSignal.timeout(10000)
    });
    const body=await response.json().catch(()=>({}));
    const set=response.headers.get('set-cookie');
    if(set)this.cookie=set.split(';')[0];
    return {status:response.status,body};
  }
  async login(email,password){
    const r=await this.call('POST','/auth/login',{email,password});
    assert.equal(r.status,200,JSON.stringify(r.body));
    this.csrf=r.body.csrf;
  }
}
function cpf(seed){
  let result=String(seed+1000).padStart(9,'0');
  for(const count of [9,10]){
    const check=Array.from({length:count},(_,i)=>Number(result[i])*(count+1-i))
      .reduce((a,b)=>a+b,0)*10%11;
    result+=check===10?'0':String(check);
  }
  return result;
}
async function awaitStatus(client,id,status){
  for(let tries=0;tries<50;tries++){
    const r=await client.call('GET','/inscricoes/'+id);
    if(r.status===200 && r.body.estado===status)return;
    await new Promise(r=>setTimeout(r,350));
  }
  throw new Error('STATUS_NAO_ATINGIDO: '+status);
}
async function main(){
  assert.ok(process.env.EVENTHUB_BOOTSTRAP_EMAIL);
  assert.ok(process.env.EVENTHUB_BOOTSTRAP_PASSWORD);
  const org=new Client();
  await org.login(process.env.EVENTHUB_BOOTSTRAP_EMAIL,
                  process.env.EVENTHUB_BOOTSTRAP_PASSWORD);
  let r=await org.call('POST','/eventos',{titulo:'Demo '+crypto.randomUUID().slice(0,6)});
  assert.equal(r.status,201,JSON.stringify(r.body));
  const event=r.body.evento_id;
  r=await org.call('POST','/eventos/'+event+'/atividades',{
    titulo:'Sessao de arquitetura',capacidade:2,gratuita:false,preco_centavos:1500,
    lista_espera_habilitada:true,prazo_reserva_min:30
  });
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal(r.body.publicada,true);
  const activity=r.body.atividade_id;
  const people=[];
  for(let i=0;i<3;i++){
    const c=new Client(),email='demo-'+crypto.randomUUID()+'@eventhub.local';
    const pwd=crypto.randomBytes(16).toString('hex')+'Aa!0';
    r=await c.call('POST','/auth/register',{email,password:pwd});
    assert.equal(r.status,201,JSON.stringify(r.body));
    await c.login(email,pwd);
    people.push(c);
  }
  r=await people[0].call('POST','/eventos',{titulo:'Nao autorizado'});
  assert.equal(r.status,403);
  r=await people[0].call('POST','/inscricoes',{atividade_id:activity,cpf:cpf(0)},
    {key:crypto.randomUUID(),csrf:false});
  assert.equal(r.status,403);
  const ids=[];
  for(let i=0;i<3;i++){
    const payload={atividade_id:activity,cpf:cpf(i)};
    const key=crypto.randomUUID();
    r=await people[i].call('POST','/inscricoes',payload,{key});
    assert.equal(r.status,202,JSON.stringify(r.body));
    const again=await people[i].call('POST','/inscricoes',payload,{key});
    assert.equal(again.status,202);
    assert.equal(again.body.inscricao_id,r.body.inscricao_id);
    ids.push(r.body.inscricao_id);
  }
  r=await people[1].call('GET','/inscricoes/'+ids[0]);
  assert.equal(r.status,404);
  const anonymous=new Client();
  assert.equal((await anonymous.call('GET','/inscricoes')).status,401);
  r=await people[0].call('GET','/inscricoes?limit=1&offset=0');
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.ok(r.body.total>=1);
  assert.equal(r.body.inscricoes[0].inscricao_id,ids[0]);
  assert.equal('cpf_digest' in r.body.inscricoes[0],false);
  r=await people[1].call('GET','/inscricoes?limit=50');
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.inscricoes.some(item=>item.inscricao_id===ids[0]),false);
  r=await people[0].call('GET','/inscricoes?limit=101');
  assert.equal(r.status,422);
  await awaitStatus(people[0],ids[0],'RESERVADO');
  await awaitStatus(people[1],ids[1],'RESERVADO');
  await awaitStatus(people[2],ids[2],'EM_FILA');
  r=await people[0].call('POST','/inscricoes/'+ids[0]+'/cancelar',{});
  assert.equal(r.status,200,JSON.stringify(r.body));
  r=await people[0].call('GET','/inscricoes?limit=50');
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.inscricoes.find(item=>item.inscricao_id===ids[0]).estado,'CANCELADO');
  await awaitStatus(people[2],ids[2],'RESERVADO');
  console.log('HTTP_E2E_OK', 'event='+event, 'activity='+activity,
    'auth=true csrf=true rbac=true idempotency=true ownership=true fifo=true promotion=true');
}
main().catch(error=>{console.error('HTTP_E2E_FAILED',error.message);process.exitCode=1;});
