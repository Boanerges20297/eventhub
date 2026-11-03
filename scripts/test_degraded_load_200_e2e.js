'use strict';
/** Stress controlado: 200 participantes, 30 vagas, MySQL indisponivel.
 * Executar SOMENTE no projeto isolado eventhub-chaos.
 * Modos setup/during/after; cookies sinteticos ficam em /tmp do container
 * Identity de chaos, fora do Git. O script NAO altera containers.
 */
const crypto=require('node:crypto'), fs=require('node:fs');
const assert=require('node:assert/strict');
const ROOT='http://gateway:3000', FILE='/tmp/eventhub-chaos-load-20261103.json';
const PEOPLE=200, CAPACITY=30;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const load=()=>JSON.parse(fs.readFileSync(FILE,'utf8'));
function save(s){fs.writeFileSync(FILE,JSON.stringify(s),{mode:0o600});}
class Client {
  constructor(cookie='',csrf=''){this.cookie=cookie;this.csrf=csrf;}
  async request(method,path,data,key){
    const headers={Origin:ROOT};
    if(data!==undefined)headers['content-type']='application/json';
    if(this.cookie)headers.Cookie=this.cookie;
    if(this.csrf&&method!=='GET')headers['x-csrf-token']=this.csrf;
    if(key)headers['idempotency-key']=key;
    const r=await fetch(ROOT+path,{
      method,headers,body:data===undefined?undefined:JSON.stringify(data),
      signal:AbortSignal.timeout(120000)
    });
    const body=await r.json().catch(()=>({}));
    const raw=r.headers.get('set-cookie');
    if(raw)this.cookie=raw.split(';')[0];
    return {code:r.status,body};
  }
  async login(email,password){
    const r=await this.request('POST','/auth/login',{email,password});
    assert.equal(r.code,200,'AUTH_'+JSON.stringify(r.body));
    this.csrf=r.body.csrf;
  }
}
function cpf(seed){
  let n=String(390000+seed).padStart(9,'0');
  for(const size of [9,10]){
    const x=Array.from({length:size},(_,i)=>Number(n[i])*(size+1-i))
      .reduce((a,b)=>a+b,0)*10%11;
    n+=x===10?'0':String(x);
  }
  return n;
}
async function setup(){
  const org=new Client();
  await org.login(process.env.EVENTHUB_BOOTSTRAP_EMAIL,
                  process.env.EVENTHUB_BOOTSTRAP_PASSWORD);
  let r=await org.request('POST','/eventos',{
    titulo:'Stress degradado HTTP '+crypto.randomUUID().slice(0,8)});
  assert.equal(r.code,201,JSON.stringify(r.body));
  r=await org.request('POST','/eventos/'+r.body.evento_id+'/atividades',{
    titulo:'Stress 200 pedidos MySQL off',capacidade:CAPACITY,
    gratuita:true,lista_espera_habilitada:true,prazo_reserva_min:30});
  assert.equal(r.code,201,JSON.stringify(r.body));
  assert.equal(r.body.publicada,true);
  const activity=r.body.atividade_id, users=[];
  for(let start=0;start<PEOPLE;start+=10){
    const batch=await Promise.all(Array.from({length:Math.min(10,PEOPLE-start)},
      async()=>{
        const c=new Client();
        const email='stress-degraded-'+crypto.randomUUID()+'@eventhub.local';
        const pass=crypto.randomBytes(16).toString('hex')+'Aa!';
        let z=await c.request('POST','/auth/register',{email,password:pass});
        assert.equal(z.code,201,'REGISTER_'+JSON.stringify(z.body));
        await c.login(email,pass);
        return {cookie:c.cookie,csrf:c.csrf};
      }));
    users.push(...batch);
    if(start%50===0)console.log('LOAD_SETUP_PROGRESS users='+users.length);
  }
  save({activity,users});
  console.log('LOAD_SETUP_OK','activity='+activity,'users='+users.length,'capacity='+CAPACITY,'published=true');
}
async function during(){
  const s=load();assert.equal(s.users.length,PEOPLE);
  const start=Date.now();
  const keys=s.users.map(()=>crypto.randomUUID());
  const attempted=await Promise.allSettled(s.users.map((p,i)=>{
    const c=new Client(p.cookie,p.csrf);
    return c.request('POST','/inscricoes',{atividade_id:s.activity,cpf:cpf(i)},keys[i]);
  }));
  const failures=attempted.filter(x=>x.status==='rejected');
  const responses=attempted.filter(x=>x.status==='fulfilled').map(x=>x.value);
  const counts={};
  for(const r of responses)counts[r.code]=(counts[r.code]||0)+1;
  console.log('LOAD_DURING_COUNTS',JSON.stringify(counts),'exceptions='+failures.length,'elapsed_ms='+(Date.now()-start));
  if(failures.length)console.error('LOAD_FIRST_EXCEPTION',String(failures[0].reason).slice(0,350));
  const bad=responses.find(r=>r.code!==202||r.body.estado!=='REGISTRADO'||r.body.modo_degradado!==true);
  if(bad)console.error('LOAD_BAD_RESPONSE',JSON.stringify(bad).slice(0,350));
  assert.equal(failures.length,0,'EXCEPTIONS_WHILE_DOWN');
  assert.equal(responses.length,PEOPLE,'MISSING_RESPONSES');
  assert.equal(bad,undefined,'FAILED_HTTP_RESPONSES');
  const nums=responses.map(r=>r.body.numero_ticket);
  const ids=responses.map(r=>r.body.inscricao_id);
  assert.equal(new Set(ids).size,PEOPLE,'DUPLICATE_IDS');
  assert.deepEqual([...nums].sort((a,b)=>a-b),
    Array.from({length:PEOPLE},(_,i)=>i+1),'TICKET_GAPS');
  // Idempotencia durante falha: repetir 5 requests nao pode gerar novos tickets.
  for(let i=0;i<5;i++){
    const c=new Client(s.users[i].cookie,s.users[i].csrf);
    const reply=await c.request('POST','/inscricoes',
      {atividade_id:s.activity,cpf:cpf(i)},keys[i]);
    assert.equal(reply.code,202,'REPLAY_HTTP');
    assert.equal(reply.body.inscricao_id,ids[i],'REPLAY_DIFFERENT_ID');
  }
  const c=new Client(s.users[0].cookie,s.users[0].csrf);
  const unknown=await c.request('POST','/inscricoes',{
    atividade_id:crypto.randomUUID(),cpf:cpf(999)
  },crypto.randomUUID());
  assert.equal(unknown.code,503,'UNKNOWN_ACTIVITY_ACCEPTED');
  assert.equal(unknown.body.detail,'PUBLICACAO_NAO_VERIFICAVEL');
  s.ids=ids;s.nums=nums;save(s);
  console.log('LOAD_DURING_OK','submitted='+PEOPLE,'capacity='+CAPACITY,
    'unique=true fifo=true degraded=true unknown_rejected=true replay=true',
    'elapsed_ms='+(Date.now()-start));
}
async function after(){
  const s=load();assert.equal(s.ids.length,PEOPLE,'NO_COMPLETE_DURING_STATE');
  const end=Date.now()+180000;let states=[];
  do {
    states=[];
    for(let start=0;start<PEOPLE;start+=25){
      const part=await Promise.all(s.users.slice(start,start+25).map(async(p,j)=>{
        const i=start+j,c=new Client(p.cookie,p.csrf);
        const r=await c.request('GET','/inscricoes/'+s.ids[i]);
        return r.code===200?r.body.estado:'HTTP_'+r.code;
      }));
      states.push(...part);
    }
    const done=states.filter(v=>v==='CONFIRMADO'||v==='EM_FILA').length;
    if(done===PEOPLE)break;
    await delay(2000);
  }while(Date.now()<end);
  const ordered=s.nums.map((ticket,i)=>({ticket,status:states[i]}))
    .sort((a,b)=>a.ticket-b.ticket);
  const counts={};
  for(const s of states)counts[s]=(counts[s]||0)+1;
  console.log('LOAD_RECOVERY_COUNTS',JSON.stringify(counts));
  assert.ok(ordered.slice(0,CAPACITY).every(x=>x.status==='CONFIRMADO'),
    'CAPACITY_FIRST_TICKETS='+JSON.stringify(ordered.slice(0,40)));
  assert.ok(ordered.slice(CAPACITY).every(x=>x.status==='EM_FILA'),
    'WAITLIST_MISMATCH='+JSON.stringify(ordered.slice(CAPACITY,CAPACITY+10)));
  console.log('LOAD_RECOVERY_OK','activity='+s.activity,'submitted='+PEOPLE,
    'confirmed='+CAPACITY,'waiting='+(PEOPLE-CAPACITY),
    'fifo=true overbooking=false');
  fs.rmSync(FILE);
}
const mode=process.env.EVENTHUB_STRESS_MODE||'setup';
const f={setup,during,after}[mode];
(f?f():Promise.reject(new Error('BAD_STRESS_MODE')))
  .catch(e=>{console.error('LOAD_E2E_FAILED',e.message);process.exitCode=1;});
