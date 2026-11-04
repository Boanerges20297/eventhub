'use strict';
// Testa SOMENTE o novo modulo de gestao do organizador.
// Executar no projeto isolado: Get-Content -Raw scripts/test_organizer_workspace_e2e.js |
//   docker compose -p eventhub-chaos exec -T identity node -
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
    const res=await fetch(BASE+path,{method,headers,
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(15000)});
    const data=await res.json().catch(()=>({}));
    const cookie=res.headers.get('set-cookie');
    if(cookie)this.cookie=cookie.split(';')[0];
    return {code:res.status,data};
  }
  async login(email,password){
    const res=await this.call('POST','/auth/login',{email,password});
    assert.equal(res.code,200,JSON.stringify(res.data));
    this.csrf=res.data.csrf;
    return res.data.user;
  }
}
function cpf(seed){
  let digits=String(310000+seed).padStart(9,'0');
  for(const n of [9,10]){
    const check=[...digits].slice(0,n).reduce((sum,x,i)=>sum+Number(x)*(n+1-i),0)*10%11;
    digits+=check===10?'0':String(check);
  }
  return digits;
}
async function main(){
  const owner=new Client();
  const user=await owner.login(process.env.EVENTHUB_BOOTSTRAP_EMAIL,
    process.env.EVENTHUB_BOOTSTRAP_PASSWORD);
  assert.ok(['organizer','admin'].includes(user.role));
  let r=await owner.call('GET','/me/eventos');
  assert.equal(r.code,200,JSON.stringify(r.data));
  assert.ok(Array.isArray(r.data.eventos));
  if(user.role==='organizer')
    assert.ok(r.data.eventos.every(e=>e.org_id===user.org_id),
      'organizacao restrita');

  const marker='Workspace '+crypto.randomUUID().slice(0,8);
  r=await owner.call('POST','/eventos',{titulo:marker,descricao:'Criado pelo teste de gestao'});
  assert.equal(r.code,201,JSON.stringify(r.data));
  const id=r.data.evento_id;
  r=await owner.call('GET','/me/eventos');
  assert.equal(r.code,200);
  const fresh=r.data.eventos.find(e=>e.id===id);
  assert.ok(fresh,'evento sem atividades deve estar no workspace privado');
  assert.equal(fresh.atividades_total,0);
  r=await owner.call('PATCH','/me/eventos/'+id,
    {titulo:marker+' atualizado',descricao:'Descricao atualizada'});
  assert.equal(r.code,200,JSON.stringify(r.data));
  r=await owner.call('GET','/me/eventos/'+id+'/atividades');
  assert.equal(r.code,200);
  assert.equal(r.data.evento.title,marker+' atualizado');
  assert.equal(r.data.atividades.length,0);

  r=await owner.call('POST','/eventos/'+id+'/atividades',{
    titulo:'Oficina segura',capacidade:3,gratuita:true,
    lista_espera_habilitada:true,prazo_reserva_min:30});
  assert.equal(r.code,201,JSON.stringify(r.data));
  assert.equal(r.data.publicada,true);
  const activity=r.data.atividade_id;
  r=await owner.call('GET','/me/eventos/'+id+'/atividades');
  assert.equal(r.code,200);
  assert.equal(r.data.atividades.length,1);
  assert.equal(r.data.atividades[0].publicada,true);
  r=await owner.call('PATCH','/me/atividades/'+activity,{titulo:'Oficina revisada'});
  assert.equal(r.code,200);
  r=await owner.call('GET','/me/eventos/'+id+'/atividades');
  assert.equal(r.data.atividades[0].titulo,'Oficina revisada');
  r=await owner.call('GET','/me/atividades/'+activity+'/resumo');
  assert.equal(r.code,200,JSON.stringify(r.data));
  assert.equal(r.data.resumo.capacidade,3);
  assert.equal(r.data.resumo.ocupadas,0);
  assert.equal(r.data.resumo.total_registradas,0);

  const attendee=new Client(),email='manage-'+crypto.randomUUID()+'@eventhub.local';
  const password=crypto.randomBytes(16).toString('hex')+'Aa!';
  r=await attendee.call('POST','/auth/register',{email,password});
  assert.equal(r.code,201);
  await attendee.login(email,password);
  for(const [method,path,body] of [
    ['GET','/me/eventos',undefined],
    ['GET','/me/eventos/'+id+'/atividades',undefined],
    ['GET','/me/atividades/'+activity+'/resumo',undefined],
    ['PATCH','/me/eventos/'+id,{titulo:'Tentativa indevida'}],
    ['PATCH','/me/atividades/'+activity,{titulo:'Tentativa indevida'}],
  ]){
    r=await attendee.call(method,path,body);
    assert.equal(r.code,403,'RBAC '+method+' '+path);
  }
  r=await owner.call('GET','/me/eventos/00000000-0000-0000-0000-000000000000/atividades');
  assert.equal(r.code,404);
  r=await attendee.call('POST','/inscricoes',{atividade_id:activity,cpf:cpf(0)},
    crypto.randomUUID());
  assert.equal(r.code,202,JSON.stringify(r.data));
  let count=0;
  for(let attempt=0;attempt<50;attempt++){
    r=await owner.call('GET','/me/atividades/'+activity+'/resumo');
    assert.equal(r.code,200,JSON.stringify(r.data));
    count=r.data.resumo.confirmadas;
    if(count===1)break;
    await new Promise(ok=>setTimeout(ok,300));
  }
  assert.equal(count,1,'resumo nao refletiu concessao real');
  assert.equal(r.data.resumo.vagas_livres,2);
  console.log('ORGANIZER_WORKSPACE_E2E_OK',
    'draft=true owner_scope=true edit_event=true edit_activity=true',
    'published=true summary=true occupied=1 free=2 participant_denied=true');
}
main().catch(e=>{
  console.error('ORGANIZER_WORKSPACE_E2E_FAILED',e.stack||e.message);
  process.exitCode=1;
});
