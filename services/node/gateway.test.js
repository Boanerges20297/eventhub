'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Fastify=require('fastify');
process.env.EVENTHUB_INTERNAL_SECRET='h'.repeat(64);
process.env.EVENTHUB_JWT_SECRET='g'.repeat(64);
process.env.EVENTHUB_COOKIE_SECURE='false';
const {jwt,csrf}=require('./security');
const {install}=require('./gateway');

test('gateway revalidates identity and rejects forged roles, missing CSRF and revoked sessions',async()=>{
  const originalFetch=globalThis.fetch;
  let valid=true,identityAvailable=true,lastForwarded=null;
  const u={id:'11111111-1111-4111-8111-111111111111',
    sid:'22222222-2222-4222-8222-222222222222',
    auth_version:1,role:'participant',org_id:null};
  const token=jwt(u);
  const sessionHeaders={host:'localhost',cookie:'eh_session='+token};
  globalThis.fetch=async(url,options)=>{
    const path=String(url);
    if(path.endsWith('/internal/auth/session'))return new Response(JSON.stringify(
      identityAvailable ? valid?{valid:true}:{error:'SESSAO_REVOGADA'}:{error:'DOWN'}
    ),{status:identityAvailable?(valid?200:401):503});
    if(path.endsWith('/internal/auth/login'))return new Response(JSON.stringify({
      state:'otp_required',challenge_id:'33333333-3333-4333-8333-333333333333',
      simulation:true,simulation_code:'123456',expires_in_seconds:300
    }),{status:200});
    if(path.endsWith('/internal/auth/verify'))return new Response(JSON.stringify({
      state:'authenticated',user:u,device_token:'d'.repeat(43)
    }),{status:200});
    if(path.endsWith('/internal/auth/logout'))return new Response('{"status":"SAIU"}',{status:200});
    if(path.includes('/internal/inscricoes')){
      lastForwarded=options;
      return new Response('{"inscricoes":[]}',{status:200});
    }
    if(path.endsWith('/internal/eventos'))return new Response('{"eventos":[]}',{status:200});
    return new Response('{"error":"NAO_ENCONTRADO"}',{status:404});
  };
  const app=Fastify({logger:false});
  install(app);
  await app.ready();
  try{
    const noCookie=await app.inject({method:'GET',url:'/auth/me',headers:{host:'localhost'}});
    assert.equal(noCookie.statusCode,401);

    const authorized=await app.inject({method:'GET',url:'/auth/me',headers:sessionHeaders});
    assert.equal(authorized.statusCode,200);
    assert.equal(authorized.json().user.role,'participant');

    const organizer=await app.inject({method:'POST',url:'/eventos',headers:{
      ...sessionHeaders,origin:'http://localhost','x-csrf-token':csrf(token)
    },payload:{title:'Malicious'}});
    assert.equal(organizer.statusCode,403);

    const noCsrf=await app.inject({method:'POST',url:'/inscricoes',headers:{
      ...sessionHeaders,origin:'http://localhost'
    },payload:{atividade_id:'3'}});
    assert.equal(noCsrf.statusCode,403);

    const wrongOrigin=await app.inject({method:'POST',url:'/inscricoes',headers:{
      ...sessionHeaders,origin:'https://attacker.test','x-csrf-token':csrf(token)
    },payload:{atividade_id:'3'}});
    assert.equal(wrongOrigin.statusCode,403);

    const permitted=await app.inject({method:'GET',url:'/inscricoes',headers:sessionHeaders});
    assert.equal(permitted.statusCode,200);
    assert.equal(JSON.parse(Buffer.from(lastForwarded.headers['x-eventhub-auth'],'base64url').toString()).sub,u.id);

    const parts=token.split('.');
    const forged=JSON.parse(Buffer.from(parts[1],'base64url').toString());
    forged.role='admin';
    parts[1]=Buffer.from(JSON.stringify(forged)).toString('base64url');
    const unauthorized=await app.inject({method:'GET',url:'/auth/me',headers:{
      host:'localhost',cookie:'eh_session='+parts.join('.')
    }});
    assert.equal(unauthorized.statusCode,401);

    valid=false;
    assert.equal((await app.inject({method:'GET',url:'/inscricoes',headers:sessionHeaders})).statusCode,401);
    identityAvailable=false;
    assert.equal((await app.inject({method:'GET',url:'/inscricoes',headers:sessionHeaders})).statusCode,503);
    assert.equal((await app.inject({method:'GET',url:'/eventos',headers:{host:'localhost'}})).statusCode,200);
    valid=true;identityAvailable=true;

    const login=await app.inject({method:'POST',url:'/auth/login',headers:{
      host:'localhost',origin:'http://localhost'
    },payload:{email:'tester@example.test',password:'valid-password-1234'}});
    assert.equal(login.statusCode,200);
    assert.equal(login.json().otp_required,true);
    assert.equal(login.headers['set-cookie'],undefined);

    const verified=await app.inject({method:'POST',url:'/auth/verify',headers:{
      host:'localhost',origin:'http://localhost'
    },payload:{challenge_id:login.json().challenge_id,code:'123456',trust_device:true}});
    assert.equal(verified.statusCode,200);
    const cookies=verified.headers['set-cookie'];
    assert.ok(Array.isArray(cookies));
    assert.ok(cookies.some(x=>x.includes('eh_session=') && x.includes('HttpOnly')));
    assert.ok(cookies.some(x=>x.includes('eh_device=') && x.includes('SameSite=Strict')));
    const logout=await app.inject({method:'POST',url:'/auth/logout',headers:{
      ...sessionHeaders,origin:'http://localhost','x-csrf-token':csrf(token)
    },payload:{}});
    assert.equal(logout.statusCode,200);
  }finally{
    globalThis.fetch=originalFetch;
    await app.close();
  }
});
