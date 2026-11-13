'use strict';
/**
 * EventHub demonstration seed, opt-in, local-only, idempotent:
 * - identity records belong exclusively to Identity's MySQL schema;
 * - events, activities and requests go through the authenticated Gateway;
 * - no direct cross-service SQL; no real personal data.
 *
 * From EventHub root (PowerShell): .\\scripts\\seed-demo.ps1
 * The wrapper runs this source in the local Identity container, copies
 * the generated test-only JSON and Markdown login document to ignored paths,
 * and verifies credentials exist. Never commit the generated documents.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const {hash} = require('@node-rs/argon2');
const {db} = require('./database');

const BASE = 'http://gateway:3000';
const HASH_OPTIONS = {memoryCost:19456,timeCost:2,parallelism:1};
const ACCOUNTS = [
  {email:'admin.demo@eventhub.test', role:'admin',org_id:'org-demo-admin',label:'Administração geral'},
  {email:'organizador.ana@eventhub.test',role:'organizer',org_id:'org-demo-academia',label:'Organizadora — Academia'},
  {email:'organizador.bruno@eventhub.test',role:'organizer',org_id:'org-demo-comunidade',label:'Organizador — Comunidade'},
  ...Array.from({length:6},(_,i)=>({
    email:'cliente.'+String(i+1).padStart(2,'0')+'@eventhub.test',
    role:'participant',org_id:null,label:'Participante '+(i+1)
  }))
];
const SCENARIOS=[
  {owner:1,title:'DEMO · Congresso de Engenharia de Software',
   description:'Evento fictício para demonstrar organizadores, inscrições e fila de espera.',
   activities:[
     {title:'Oficina de microsserviços (grátis)',capacity:2,paid:false,price:0},
     {title:'Laboratório de arquitetura (simulação de pagamento)',capacity:3,paid:true,price:2000}
   ]},
  {owner:2,title:'DEMO · Mostra de Inovação',
   description:'Evento fictício de uma segunda organização; acesso isolado por tenant.',
   activities:[
     {title:'Introdução a Docker e containers',capacity:4,paid:false,price:0}
   ]},
  {owner:0,title:'DEMO · Painel Administrativo',
   description:'Exemplo fictício gerenciado pelo perfil administrador.',
   activities:[
     {title:'Mesa-redonda de integração',capacity:12,paid:false,price:0}
   ]}
];

function checkEnvironment(){
  if(process.env.EVENTHUB_ENABLE_DEMO_SEED!=='1'||!process.argv.includes('--demo-local'))
    throw Error('SEED_NAO_AUTORIZADO: opt-in explicito obrigatorio');
  if(process.env.DB_NAME!=='eventhub_identity'||process.env.DB_HOST!=='mysql'
     ||process.env.DB_USER!=='eventhub_identity'||process.env.NODE_ENV==='production')
    throw Error('AMBIENTE_NAO_EH_DESENVOLVIMENTO');
  if(!process.env.EVENTHUB_BOOTSTRAP_EMAIL)
    throw Error('BOOTSTRAP_DE_DESENVOLVIMENTO_AUSENTE');
}

class Session{
  constructor(){this.cookie='';this.csrf='';this.user=null;}
  async api(method,path,data,idem){
    const headers={Origin:BASE};
    if(data!==undefined)headers['content-type']='application/json';
    if(this.cookie)headers.Cookie=this.cookie;
    if(this.csrf&&method!=='GET')headers['x-csrf-token']=this.csrf;
    if(idem)headers['idempotency-key']=idem;
    const response=await fetch(BASE+path,{
      method,headers,body:data===undefined?undefined:JSON.stringify(data),
      signal:AbortSignal.timeout(20000)
    });
    const cookie=response.headers.get('set-cookie');
    if(cookie)this.cookie=cookie.split(';')[0];
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw Error('DEMO_API_'+response.status+' '+method+' '+path+' '+
      JSON.stringify(body).slice(0,180));
    return body;
  }
  async login(email,password){
    const x=await this.api('POST','/auth/login',{email,password});
    let auth=x;
    if(x.otp_required){
      if(x.simulation!==true || !/^[0-9]{6}$/.test(x.simulation_code||''))
        throw Error('DEMO_OTP_INDISPONIVEL: apenas simulacao local');
      auth=await this.api('POST','/auth/verify',{
        challenge_id:x.challenge_id,code:x.simulation_code,trust_device:false});
    }
    this.csrf=auth.csrf;this.user=auth.user;
    return auth.user;
  }
}
function stableUuid(a,b){
  const digest=crypto.createHash('sha256').update('eventhub-demo-v1:'+a+':'+b).digest();
  const bytes=Buffer.from(digest.subarray(0,16));
  bytes[6]=(bytes[6]&0x0f)|0x40;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const s=bytes.toString('hex');
  return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);
}
function demoCpf(i){
  let digits=String(192837400+i).padStart(9,'0');
  for(const len of [9,10]){
    const sum=[...digits].slice(0,len).reduce((acc,d,index)=>acc+Number(d)*(len+1-index),0);
    const digit=sum*10%11;
    digits+=digit===10?'0':String(digit);
  }
  return digits; // only hashed by registrations; never sent in the seed's output
}
async function seedIdentities(){
  const entries=[];
  for(const account of ACCOUNTS){
    const password='Demo-'+crypto.randomBytes(18).toString('base64url')+'!';
    const passwordHash=await hash(password,HASH_OPTIONS);
    const id=crypto.randomUUID();
    await db().execute(
      'INSERT INTO users (id,email,password_hash,role,org_id) VALUES (?,?,?,?,?) '+
      'ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), '+
      'role=VALUES(role),org_id=VALUES(org_id)',
      [id,account.email,passwordHash,account.role,account.org_id]);
    entries.push({...account,password});
  }
  return entries;
}
async function ensureEvent(owner,spec){
  const existing=await owner.api('GET','/me/eventos');
  let event=existing.eventos.find(x=>x.title===spec.title);
  if(!event){
    const created=await owner.api('POST','/eventos',
      {titulo:spec.title,descricao:spec.description});
    event={id:created.evento_id,title:spec.title};
  }
  const current=await owner.api('GET','/me/eventos/'+event.id+'/atividades');
  const result={event_id:event.id,title:event.title,activities:[]};
  for(const ac of spec.activities){
    let activity=current.atividades.find(a=>a.titulo===ac.title);
    if(!activity){
      const created=await owner.api('POST','/eventos/'+event.id+'/atividades',{
        titulo:ac.title,capacidade:ac.capacity,gratuita:!ac.paid,
        preco_centavos:ac.price,lista_espera_habilitada:true,
        prazo_reserva_min:30
      });
      if(!created.publicada)throw Error('ATIVIDADE_DEMO_NAO_PUBLICADA: '+ac.title);
      activity={atividade_id:created.atividade_id,titulo:ac.title};
    }
    result.activities.push({id:activity.atividade_id,title:ac.title,capacity:ac.capacity});
  }
  return result;
}
async function seedRegistrations(clients,plans){
  const byName=Object.fromEntries(plans.flatMap(e=>e.activities.map(a=>[a.title,a.id])));
  const pairs=[];
  // 5 clients compete for 2 free seats -> 2 confirmed, 3 waiting.
  for(let i=0;i<5;i++)pairs.push([i,'Oficina de microsserviços (grátis)']);
  // 3 client reservations for the paid, simulated-only activity.
  for(let i=1;i<=3;i++)pairs.push([i,'Laboratório de arquitetura (simulação de pagamento)']);
  // A distinct organization has independent occupancy.
  for(let i=0;i<4;i++)pairs.push([i,'Introdução a Docker e containers']);
  let issued=0,already=0;
  for(const [index,title] of pairs){
    const client=clients[index],activityId=byName[title];
    const owned=await client.api('GET','/inscricoes?limit=100');
    if(owned.inscricoes.some(item=>item.atividade_id===activityId)){
      already++;continue;
    }
    await client.api('POST','/inscricoes',{
      atividade_id:activityId,cpf:demoCpf(index+1)
    },stableUuid(client.user.id,activityId));
    issued++;
  }
  return {issued,already};
}
async function main(){
  checkEnvironment();
  const credentials=await seedIdentities();
  const sessions=[];
  for(const entry of credentials){
    const session=new Session();
    const user=await session.login(entry.email,entry.password);
    if(user.role!==entry.role||user.org_id!==entry.org_id)
      throw Error('IDENTIDADE_DEMO_INCORRETA');
    sessions.push(session);
  }
  const events=[];
  for(const spec of SCENARIOS)
    events.push(await ensureEvent(sessions[spec.owner],spec));

  const requests=await seedRegistrations(sessions.slice(3),events);
  // Give the durable queue a short chance to reconcile before collecting summaries.
  const metrics=[];
  for(const e of events){
    const owner=sessions[SCENARIOS.find(s=>s.title===e.title).owner];
    for(const activity of e.activities){
      let data=null;
      for(let tries=0;tries<30;tries++){
        const response=await owner.api('GET','/me/atividades/'+activity.id+'/resumo');
        data=response.resumo;
        if(data && data.em_processamento===0)break;
        await new Promise(done=>setTimeout(done,350));
      }
      metrics.push({activity:activity.title,
        confirmed:data?.confirmadas||0,reserved:data?.reservadas||0,
        waiting:data?.em_fila||0,processing:data?.em_processamento||0});
    }
  }
  await db().end();
  const summary={
    generated_at:new Date().toISOString(),
    environment:'local-development-only',
    warning:'Acessos de demonstração local. Nunca reutilizar em produção.',
    accounts:credentials,
    events,
    registrations:requests,
    metrics
  };
  const lines=[
    '# EventHub — Logins e senhas de teste mock (uso local)',
    '',
    '> Somente demonstração no notebook: http://127.0.0.1:8088',
    '> Contém senhas ativas no banco de TESTE. Não publicar nem versionar este arquivo.',
    '',
    'Gerado em: '+summary.generated_at,
    '',
    '| Função | Login | Senha de teste | Organização |',
    '|---|---|---|---|',
    ...credentials.map(item=>'| '+item.label+' ('+item.role+') | '+
      item.email+' | '+item.password+' | '+(item.org_id||'—')+' |'),
    '',
    '## Cenários disponíveis',
    ...events.map(e=>'- '+e.title+': '+e.activities.map(a=>a.title).join('; ')),
    '',
    '## Indicadores no momento da geração',
    ...metrics.map(m=>'- '+m.activity+': confirmados='+m.confirmed+
      ', reservados='+m.reserved+', fila='+m.waiting+
      ', processando='+m.processing),
    '',
    '## Orientações',
    '1. Entre com uma das contas acima; alterne perfis fazendo logout.',
    '2. O cadastro público cria apenas participantes; administrador e organizador são provisionados pelo seed.',
    '3. Todas as contas e eventos são fictícios. Pagamentos são simulados.',
    '4. Nova execução do seed renova as senhas e substitui este documento.',
    ''
  ];
  // Atomic local handoff through docker cp; no credentials on stdout or in git.
  fs.writeFileSync('/tmp/eventhub-demo-credentials.json',
    JSON.stringify(summary,null,2),{mode:0o600});
  fs.writeFileSync('/tmp/eventhub-demo-logins.md',
    lines.join('\n'),{mode:0o600});
  process.stderr.write('DEMO_SEED_OK accounts='+credentials.length+
    ' events='+events.length+' registrations_new='+requests.issued+
    ' registrations_existing='+requests.already+
    ' credentials_ready_in_container=true\n');
  process.exit(0);
}
main().catch(error=>{
  process.stderr.write('DEMO_SEED_FAILED: '+String(error.message||error)+'\n');
  process.exitCode=1;
});
