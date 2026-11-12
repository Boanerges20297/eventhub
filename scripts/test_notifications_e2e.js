'use strict';
// Valida outbox transacional e caixa de notificacoes simuladas no Docker local.
// Get-Content -Raw .\scripts\test_notifications_e2e.js | docker compose exec -T identity node -
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const ROOT='http://gateway:3000';
class Client{
  constructor(){this.cookie='';this.csrf='';}
  async call(method,path,body,key){
    const headers={Origin:ROOT};
    if(body!==undefined)headers['content-type']='application/json';
    if(this.cookie)headers.Cookie=this.cookie;
    if(this.csrf && method!=='GET')headers['x-csrf-token']=this.csrf;
    if(key)headers['idempotency-key']=key;
    const res=await fetch(ROOT+path,{method,headers,
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(12000)});
    const data=await res.json().catch(()=>({}));
    const cookie=res.headers.get('set-cookie');
    if(cookie)this.cookie=cookie.split(';')[0];
    return {code:res.status,data};
  }
  async login(email,password){
    let r=await this.call('POST','/auth/login',{email,password});
    if (r.data?.otp_required === true) {
      assert.equal(r.data.simulation, true, "E2E requires simulated OTP in local development");
      r = await this.call("POST","/auth/verify",{challenge_id:r.data.challenge_id,code:r.data.simulation_code});
    }
    assert.equal(r.code,200,JSON.stringify(r.data));this.csrf=r.data.csrf;
  }
}
function cpf(n){
  let value=String(6800+n).padStart(9,'0');
  for(const size of [9,10]){
    const check=Array.from({length:size},(_,i)=>Number(value[i])*(size+1-i))
      .reduce((a,b)=>a+b,0)*10%11;
    value+=check===10?'0':String(check);
  }
  return value;
}
async function waitFor(label,fn,ms=30000){
  const end=Date.now()+ms;let last;
  while(Date.now()<end){
    last=await fn();if(last)return last;
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error('TIMEOUT '+label);
}
async function main(){
  const org=new Client();
  await org.login(process.env.EVENTHUB_BOOTSTRAP_EMAIL,
                  process.env.EVENTHUB_BOOTSTRAP_PASSWORD);
  let r=await org.call('POST','/eventos',{titulo:'Inbox demo '+crypto.randomUUID().slice(0,6)});
  assert.equal(r.code,201,JSON.stringify(r.data));
  r=await org.call('POST','/eventos/'+r.data.evento_id+'/atividades',{
    titulo:'Evento de notificacoes',capacidade:1,gratuita:false,
    preco_centavos:1200,lista_espera_habilitada:true,prazo_reserva_min:30
  });
  assert.equal(r.code,201,JSON.stringify(r.data));
  const activity=r.data.atividade_id;
  const first=new Client(),other=new Client();
  for(const [i,client] of [first,other].entries()){
    const email='notify-'+crypto.randomUUID()+'@eventhub.local';
    const password=crypto.randomBytes(16).toString('hex')+'Aa!';
    r=await client.call('POST','/auth/register',{email,password});
    assert.equal(r.code,201,JSON.stringify(r.data));
    await client.login(email,password);
  }
  r=await first.call('POST','/inscricoes',
    {atividade_id:activity,cpf:cpf(0)},crypto.randomUUID());
  assert.equal(r.code,202,JSON.stringify(r.data));
  const id=r.data.inscricao_id;
  await waitFor('RESERVADO',async()=>{
    const result=await first.call('GET','/inscricoes/'+id);
    return result.code===200 && result.data.estado==='RESERVADO';
  });
  const initial=await waitFor('OUTBOX_RESERVADO',async()=>{
    const result=await first.call('GET','/notificacoes');
    assert.equal(result.code,200,JSON.stringify(result.data));
    return result.data.notificacoes.find(
      n=>n.inscricao_id===id && n.estado_inscricao==='RESERVADO'
    );
  });
  assert.equal(initial.entrega,'ENTREGUE_SIMULADA');
  // Isolamento: outra conta nao visualiza a notificacao de terceiro.
  r=await other.call('GET','/notificacoes');
  assert.equal(r.code,200,JSON.stringify(r.data));
  assert.equal(r.data.notificacoes.some(n=>n.inscricao_id===id),false);

  const payKey=crypto.randomUUID();
  r=await first.call('POST','/pagamentos/'+id+'/simular',
    {resultado:'PAGO'},payKey);
  assert.equal(r.code,200,JSON.stringify(r.data));
  await waitFor('CONFIRMADO',async()=>{
    const result=await first.call('GET','/inscricoes/'+id);
    return result.code===200 && result.data.estado==='CONFIRMADO';
  });
  await waitFor('OUTBOX_CONFIRMADO',async()=>{
    const result=await first.call('GET','/notificacoes');
    return result.code===200 && result.data.notificacoes.some(
      n=>n.inscricao_id===id && n.estado_inscricao==='CONFIRMADO');
  });
  // Repetir mesma tentativa nao gera duplicacao de notificação final.
  r=await first.call('POST','/pagamentos/'+id+'/simular',
    {resultado:'PAGO'},payKey);
  assert.equal(r.code,200,JSON.stringify(r.data));
  const delivered=await first.call('GET','/notificacoes');
  assert.equal(delivered.code,200);
  assert.equal(delivered.data.notificacoes.filter(
    n=>n.inscricao_id===id && n.estado_inscricao==='CONFIRMADO').length,1);
  console.log('NOTIFICATIONS_E2E_OK',
    'activity='+activity,'persisted=true','reserved=true',
    'confirmed=true','dedupe=true','isolation=true');
}
main().catch(e=>{console.error('NOTIFICATIONS_E2E_FAILED',e.message);process.exitCode=1;});
