'use strict';
/**
 * Corrige apenas textos sintéticos com prefixo DEMO em organizações conhecidas.
 * Usa Gateway/Eventos: nenhum SQL entre serviços, nenhuma exclusão de dados.
 * Executar localmente: node scripts/repair_demo_utf8.js --repair-demo
 */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:8088';
const cases=[
  {org:'org-demo-academia',match:'Congresso',title:'DEMO · Congresso de Engenharia de Software',description:'Evento fictício para demonstrar organizadores, inscrições e fila de espera.'},
  {org:'org-demo-comunidade',match:'Mostra',title:'DEMO · Mostra de Inovação',description:'Evento fictício de uma segunda organização; acesso isolado por tenant.'},
  {org:'org-demo-admin',match:'Painel',title:'DEMO · Painel Administrativo',description:'Exemplo fictício gerenciado pelo perfil administrador.'}
];
const activities=[
  {match:'Oficina',title:'Oficina de microsserviços (grátis)'},
  {match:'arquitetura',title:'Laboratório de arquitetura (simulação de pagamento)'},
  {match:'Docker',title:'Introdução a Docker e containers'},
  {match:'Mesa-redonda',title:'Mesa-redonda de integração'}
];
async function main(){
  assert(process.argv.includes('--repair-demo'),'Execução exige --repair-demo');
  const creds=JSON.parse(fs.readFileSync(path.join(__dirname,'../.demo-credentials.local.json'),'utf8'));
  const admin=creds.accounts.find(x=>x.role==='admin');
  assert(admin?.email&&admin?.password,'Conta admin mock indisponível');
  let cookie='',csrf='';
  async function call(method,uri,body){
    const headers={Origin:base};
    if(cookie)headers.Cookie=cookie;
    if(csrf&&method!=='GET')headers['x-csrf-token']=csrf;
    if(body)headers['content-type']='application/json; charset=utf-8';
    const res=await fetch(base+uri,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    const setCookie=res.headers.get('set-cookie');
    if(setCookie)cookie=setCookie.split(';')[0];
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(method+' '+uri+': HTTP '+res.status+' '+JSON.stringify(data));
    return data;
  }
  const auth=await call('POST','/api/auth/login',{email:admin.email,password:admin.password});
  const verified=auth.otp_required
    ?await call('POST','/api/auth/verify',{
      challenge_id:auth.challenge_id,code:auth.simulation_code,trust_device:false})
    :auth;
  csrf=verified.csrf;
  assert.equal(verified.user.role,'admin');
  const listing=await call('GET','/api/me/eventos');
  const found=listing.eventos.filter(x=>
    cases.some(s=>x.org_id===s.org&&x.title.startsWith('DEMO')&&x.title.includes(s.match))
  );
  assert(found.length>=3&&found.length<=12,'Número inesperado de eventos DEMO: '+found.length);
  let changedEvents=0,changedActivities=0;
  for(const item of found){
    const spec=cases.find(s=>item.org_id===s.org&&item.title.includes(s.match));
    if(item.title!==spec.title||item.description!==spec.description){
      await call('PATCH','/api/me/eventos/'+encodeURIComponent(item.id),{titulo:spec.title,descricao:spec.description});
      changedEvents++;
    }
    const detail=await call('GET','/api/me/eventos/'+encodeURIComponent(item.id)+'/atividades');
    for(const activity of detail.atividades){
      const target=activities.find(s=>activity.titulo.includes(s.match));
      if(target && activity.titulo!==target.title){
        await call('PATCH','/api/me/atividades/'+encodeURIComponent(activity.atividade_id),{titulo:target.title});
        changedActivities++;
      }
    }
  }
  const after=(await call('GET','/api/me/eventos')).eventos.filter(x=>
    cases.some(s=>x.org_id===s.org&&x.title.startsWith('DEMO')&&x.title.includes(s.match))
  );
  assert(after.every(x=>!x.title.includes('?')&&!x.title.includes('�')),'Persistiu título corrompido');
  assert(after.length===found.length,'Quantidade de eventos alterada inesperadamente');
  console.log('DEMO_UTF8_REPAIR_OK','events='+found.length,
    'titles_fixed='+changedEvents,'activities_fixed='+changedActivities,
    'utf8_titles=true');
}
main().catch(e=>{console.error('DEMO_UTF8_REPAIR_FAILED',e.message);process.exitCode=1});
