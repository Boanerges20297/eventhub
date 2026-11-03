'use strict';
// Teste de pagamentos SIMULADOS no Docker local, sem cobranca real.
// Executar: Get-Content -Raw .\scripts\test_payments_e2e.js | docker compose exec -T identity node -
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const BASE='http://gateway:3000';
class Client {
  constructor(){this.cookie='';this.csrf='';}
  async call(method,path,body,key){
    const headers={Origin:BASE};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(this.cookie)headers.Cookie=this.cookie;
    if(this.csrf && method!=='GET')headers['X-CSRF-Token']=this.csrf;
    if(key)headers['Idempotency-Key']=key;
    const res=await fetch(BASE+path,{method,headers,
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(12000)});
    const payload=await res.json().catch(()=>({}));
    const setCookie=res.headers.get('set-cookie');
    if(setCookie)this.cookie=setCookie.split(';')[0];
    return {status:res.status,payload};
  }
  async login(email,password){
    const r=await this.call('POST','/auth/login',{email,password});
    assert.equal(r.status,200,JSON.stringify(r.payload));
    this.csrf=r.payload.csrf;
  }
}
function cpf(seed){
  let digits=String(6000+seed).padStart(9,'0');
  for(const n of [9,10]){
    const x=Array.from({length:n},(_,i)=>Number(digits[i])*(n+1-i))
      .reduce((a,b)=>a+b,0)*10%11;
    digits+=x===10?'0':String(x);
  }
  return digits;
}
async function poll(client, id, goal){
  let last='';
  for(let i=0;i<60;i++){
    const r=await client.call('GET','/inscricoes/'+id);
    assert.equal(r.status,200,JSON.stringify(r.payload));
    last=r.payload.estado;
    if(last===goal)return;
    await new Promise(done=>setTimeout(done,400));
  }
  throw Error('ESTADO_DIVERGENTE esperado='+goal+' observado='+last);
}
async function main(){
  const org=new Client();
  await org.login(process.env.EVENTHUB_BOOTSTRAP_EMAIL,
                  process.env.EVENTHUB_BOOTSTRAP_PASSWORD);
  let r=await org.call('POST','/eventos',{titulo:'Simulacao pagamentos '+crypto.randomUUID().slice(0,6)});
  assert.equal(r.status,201,JSON.stringify(r.payload));
  const eventId=r.payload.evento_id;
  r=await org.call('POST','/eventos/'+eventId+'/atividades',{
    titulo:'Testes financeiros',capacidade:2,gratuita:false,preco_centavos:1500,
    lista_espera_habilitada:true,prazo_reserva_min:30});
  assert.equal(r.status,201,JSON.stringify(r.payload));
  const activity=r.payload.atividade_id;
  const users=[],ids=[];
  for(let i=0;i<3;i++){
    const client=new Client();
    const email='fin-'+crypto.randomUUID()+'@eventhub.local';
    const password=crypto.randomBytes(16).toString('hex')+'A!';
    r=await client.call('POST','/auth/register',{email,password});
    assert.equal(r.status,201,JSON.stringify(r.payload));
    await client.login(email,password);
    users.push(client);
    r=await client.call('POST','/inscricoes',
      {atividade_id:activity,cpf:cpf(i)},crypto.randomUUID());
    assert.equal(r.status,202,JSON.stringify(r.payload));
    ids.push(r.payload.inscricao_id);
  }
  await poll(users[0],ids[0],'RESERVADO');
  await poll(users[1],ids[1],'RESERVADO');
  await poll(users[2],ids[2],'EM_FILA');

  const paidKey=crypto.randomUUID();
  r=await users[0].call('POST','/pagamentos/'+ids[0]+'/simular',
    {resultado:'PAGO'},paidKey);
  assert.equal(r.status,200,JSON.stringify(r.payload));
  await poll(users[0],ids[0],'CONFIRMADO');
  const paidAgain=await users[0].call('POST','/pagamentos/'+ids[0]+'/simular',
    {resultado:'PAGO'},paidKey);
  assert.equal(paidAgain.status,200,JSON.stringify(paidAgain.payload));
  assert.equal(paidAgain.payload.tentativa_id,r.payload.tentativa_id);
  // Ninguem consulta pagamento de terceiro.
  const wrong=await users[1].call('GET','/pagamentos/'+ids[0]);
  assert.equal(wrong.status,404);
  // Mudanca de resultado com mesma chave nao pode redefinir pagamento confirmado.
  const mutation=await users[0].call('POST','/pagamentos/'+ids[0]+'/simular',
    {resultado:'RECUSADO_DEFINITIVO'},paidKey);
  assert.equal(mutation.status,409);

  r=await users[1].call('POST','/pagamentos/'+ids[1]+'/simular',
    {resultado:'RECUSADO_DEFINITIVO'},crypto.randomUUID());
  assert.equal(r.status,200,JSON.stringify(r.payload));
  await poll(users[1],ids[1],'RECUSADO');
  await poll(users[2],ids[2],'RESERVADO');

  r=await users[2].call('POST','/pagamentos/'+ids[2]+'/simular',
    {resultado:'INDETERMINADO'},crypto.randomUUID());
  assert.equal(r.status,200,JSON.stringify(r.payload));
  await poll(users[2],ids[2],'EM_VERIFICACAO');
  const noRelease=await users[2].call('GET','/pagamentos/'+ids[2]);
  assert.equal(noRelease.status,200,JSON.stringify(noRelease.payload));
  assert.equal(noRelease.payload.estado_inscricao,'EM_VERIFICACAO');
  console.log('PAYMENTS_E2E_OK',
    'activity='+activity,'approved=true','refusal_promotes_fifo=true',
    'indeterminate_holds_seat=true','idempotency=true','ownership=true');
}
main().catch(e=>{console.error('PAYMENTS_E2E_FAILED',e.message);process.exitCode=1;});
