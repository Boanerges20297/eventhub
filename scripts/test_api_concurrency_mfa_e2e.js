'use strict';
// EventHub: concurrent registration E2E against the live main Docker Compose.
// A load-test fixture seeds 40 synthetic identities/sessions in Identity's own MySQL;
// it does NOT benchmark HTTP registration or OTP. Those are covered separately.
// Requests do traverse Gateway JWT/CSRF/session checks, Registrations, SQLite, MySQL.
// Run only in non-production laboratory environment.
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const mysql=require('mysql2/promise');
const argon=require('@node-rs/argon2');
const {jwt,csrf}=require('./security');
const BASE='http://gateway:3000';
const PEOPLE=40,CAPACITY=12;
const uuid=()=>crypto.randomUUID();
const seedTag=crypto.randomBytes(5).toString('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function cpf(seed){
  let n=String(41000+seed).padStart(9,'0');
  for(const count of [9,10]){
    const value=Array.from({length:count},(_,i)=>Number(n[i])*(count+1-i))
      .reduce((a,b)=>a+b,0)*10%11;
    n+=value===10?'0':String(value);
  }
  return n;
}
async function call(client,method,path,body,key){
  const headers={Origin:BASE};
  if(body!==undefined)headers['content-type']='application/json';
  if(client?.cookie)headers.Cookie=client.cookie;
  if(method!=='GET'&&client?.csrf)headers['x-csrf-token']=client.csrf;
  if(key)headers['idempotency-key']=key;
  const res=await fetch(BASE+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(30000)
  });
  const data=await res.json().catch(()=>({}));
  const setCookie=res.headers.get('set-cookie');
  if(client&&setCookie){
    const c=setCookie.split(';')[0];
    if(c.startsWith('eh_session='))client.cookie=c;
  }
  return {code:res.status,body:data};
}
function expect(res,code,where){assert.equal(res.code,code,where+' '+JSON.stringify(res.body))}
async function main(){
  if(process.env.EVENTHUB_NODE_ENV==='production'||process.env.NODE_ENV==='production'){
    throw new Error('Refusing synthetic fixture on production');
  }
  const db=await mysql.createPool({
    host:'mysql',user:'eventhub_identity',
    password:process.env.EVENTHUB_MYSQL_IDENTITY_PASSWORD,
    database:'eventhub_identity',timezone:'Z',connectionLimit:6
  });
  const participantIds=[];
  let activity;
  try{
    const organizer={cookie:'',csrf:''};
    let r=await call(organizer,'POST','/auth/login',{
      email:process.env.EVENTHUB_BOOTSTRAP_EMAIL,
      password:process.env.EVENTHUB_BOOTSTRAP_PASSWORD
    });
    expect(r,200,'organizer password');
    assert.equal(r.body.otp_required,true,'expected development OTP');
    assert.equal(r.body.simulation,true);
    r=await call(organizer,'POST','/auth/verify',{
      challenge_id:r.body.challenge_id,code:r.body.simulation_code
    });
    expect(r,200,'organizer OTP');
    organizer.csrf=r.body.csrf;
    assert.ok(organizer.cookie.startsWith('eh_session='));
    r=await call(organizer,'POST','/eventos',{
      titulo:'Cenario concorrente OTP '+seedTag
    });
    expect(r,201,'event create');
    r=await call(organizer,'POST','/eventos/'+r.body.evento_id+'/atividades',{
      titulo:'Capacidade real 40 por 12',capacidade:CAPACITY,gratuita:true,
      lista_espera_habilitada:true,prazo_reserva_min:30
    });
    expect(r,201,'activity create');
    assert.equal(r.body.publicada,true);
    activity=r.body.atividade_id;

    // Synthetic identity/session fixture: 40 real MySQL users, 40 verifiable
    // HS256 JWTs, 40 persisted sessions. No Gateway registration rate-limit override.
    const disabledPassword=crypto.randomBytes(32).toString('base64url');
    const passwordHash=await argon.hash(disabledPassword,{
      memoryCost:19456,timeCost:2,parallelism:1
    });
    const people=[];
    for(let i=0;i<PEOPLE;i++){
      const id=uuid(),sid=uuid(),email='e2e-mfa-load-'+seedTag+'-'+i+'@example.test';
      await db.execute('INSERT INTO users(id,email,password_hash,role,org_id) VALUES(?,?,?,?,?)',
        [id,email,passwordHash,'participant',null]);
      participantIds.push(id);
      await db.execute(
        'INSERT INTO sessions(id,user_id,auth_version,expires_at) VALUES(?,?,1,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 30 MINUTE))',
        [sid,id]);
      const token=jwt({id,sid,role:'participant',org_id:null,auth_version:1});
      people.push({cookie:'eh_session='+token,csrf:csrf(token)});
    }
    console.log('LOAD_FIXTURE_READY participants='+people.length+
      ' isolation=session-per-user; authentication=pre-seeded');
    const keys=people.map(()=>uuid());
    const began=Date.now();
    const replies=await Promise.all(people.map((c,i)=>call(c,'POST','/inscricoes',{
      atividade_id:activity,cpf:cpf(i)
    },keys[i])));
    const codes=replies.reduce((a,r)=>(a[r.code]=(a[r.code]||0)+1,a),{});
    assert.ok(replies.every(r=>r.code===202),
      'SUBMISSIONS_HTTP_CODES '+JSON.stringify(codes)+' example '+
      JSON.stringify(replies.find(r=>r.code!==202)?.body));
    const ids=replies.map(r=>r.body.inscricao_id);
    const tickets=replies.map(r=>r.body.numero_ticket);
    assert.equal(new Set(ids).size,PEOPLE,'duplicate registration IDs');
    assert.deepEqual([...tickets].sort((a,b)=>a-b),
      Array.from({length:PEOPLE},(_,i)=>i+1),'non-FIFO ticket sequence');
    for(let i=0;i<4;i++){
      const replay=await call(people[i],'POST','/inscricoes',{
        atividade_id:activity,cpf:cpf(i)
      },keys[i]);
      expect(replay,202,'idempotent replay');
      assert.equal(replay.body.inscricao_id,ids[i]);
    }
    const forbidden=await call(people[1],'GET','/inscricoes/'+ids[0]);
    expect(forbidden,404,'cross-user read');
    // Audit the authoritative InnoDB state directly instead of consuming the
    // per-IP HTTP read quota with repeated 40-request polling rounds.
    const audit=mysql.createPool({
      host:'mysql',user:'eventhub_registrations',
      password:process.env.EVENTHUB_MYSQL_REGISTRATIONS_PASSWORD,
      database:'eventhub_inscricoes',timezone:'Z',connectionLimit:3
    });
    let rows=[];
    try{
      for(let round=0;round<30;round++){
        const [found]=await audit.execute(
          'SELECT inscricao_id,numero_ticket,status FROM registrations WHERE atividade_id=? ORDER BY numero_ticket',
          [activity]
        );
        rows=found;
        if(rows.length===PEOPLE &&
           rows.every(x=>x.status==='CONFIRMADO'||x.status==='EM_FILA'))break;
        await delay(1000);
      }
    }finally{await audit.end();}
    assert.equal(rows.length,PEOPLE,'MySQL reconciliation has missing registrations');
    assert.deepEqual(rows.map(x=>Number(x.numero_ticket)),
      Array.from({length:PEOPLE},(_,i)=>i+1),'MySQL ticket numbering');
    const ordered=rows.map(x=>({ticket:Number(x.numero_ticket),state:x.status}));
    assert.ok(ordered.slice(0,CAPACITY).every(x=>x.state==='CONFIRMADO'),
      'initial capacity '+JSON.stringify(ordered));
    assert.ok(ordered.slice(CAPACITY).every(x=>x.state==='EM_FILA'),
      'waiting overflow '+JSON.stringify(ordered));
    const states=ordered.map(x=>x.state);
    // Representative API reads still prove JWT ownership and result visibility.
    for(const i of [0,11,12,39]){
      const r=await call(people[i],'GET','/inscricoes/'+ids[i]);
      expect(r,200,'sample authenticated registration read');
      assert.equal(r.body.estado,states[i]);
    }
    console.log('API_CONCURRENCY_MFA_E2E_OK activity='+activity+
      ' submitted='+PEOPLE+' capacity='+CAPACITY+
      ' confirmed='+CAPACITY+' waiting='+(PEOPLE-CAPACITY)+
      ' unique=true fifo=true idempotent=true isolation=true'+
      ' session_validation=true csrf=true overbooking=false'+
      ' db_audit=true sample_reads=4 elapsed_ms='+(Date.now()-began));
  }finally{
    // Keep synthetic test users and registrations for reproducibility/audit:
    // registration owner IDs must remain valid across service boundaries.
    // Only revoke the temporary sessions created by this fixture.
    if(participantIds.length){
      const marks=participantIds.map(()=>'?').join(',');
      await db.execute('UPDATE sessions SET revoked_at=UTC_TIMESTAMP(6) WHERE user_id IN ('+
        marks+') AND revoked_at IS NULL',participantIds).catch(err=>
        console.error('SYNTHETIC_SESSION_CLEANUP_ERROR '+err.code));
      console.log('LOAD_FIXTURE_SESSION_REVOKE_ATTEMPTED='+participantIds.length);
    }
    await db.end();
  }
}
main().catch(e=>{
  console.error('API_CONCURRENCY_MFA_E2E_FAILED '+(e.stack||e.message));
  process.exitCode=1;
});
