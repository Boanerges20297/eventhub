'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Module=require('node:module');
const Fastify=require('fastify');
const {hash}=require('@node-rs/argon2');

process.env.EVENTHUB_INTERNAL_SECRET='t'.repeat(64);
process.env.EVENTHUB_JWT_SECRET='j'.repeat(64);
process.env.EVENTHUB_OTP_SIMULATION='true';
process.env.NODE_ENV='test';

test('identity: OTP, trusted devices, session revocation and three-attempt lockout',async()=>{
  const now=()=>Date.now();
  const user={
    id:'11111111-1111-4111-8111-111111111111',email:'tester@example.test',
    password_hash:await hash('valid-password-1234',{memoryCost:8192,timeCost:1,parallelism:1}),
    role:'participant',org_id:null,auth_version:1,
    failed_attempts:0,locked_until:null
  };
  const sessions=new Map(), challenges=new Map(), devices=new Map();
  const fake={
    async execute(sql,values=[]){
      const q=sql.replace(/\s+/g,' ').trim().toLowerCase();
      const res=items=>[items,[]];
      if(q.startsWith('update users set failed_attempts=0,locked_until=null where email=')){
        if(values[0]===user.email && user.locked_until && user.locked_until<=now()){
          user.failed_attempts=0;user.locked_until=null;
        }
        return res([{affectedRows:1}]);
      }
      if(q.startsWith('select id,email,password_hash,role,org_id,auth_version,')){
        if(values[0]!==user.email)return res([]);
        return res([{...user,is_locked:Boolean(user.locked_until && user.locked_until>now()),
          retry_seconds:Math.max(0,Math.ceil(((user.locked_until||0)-now())/1000))}]);
      }
      if(q.startsWith('update users set locked_until=if(')){
        user.failed_attempts++;
        user.locked_until=user.failed_attempts>=3?now()+15*60*1000:null;
        return res([{affectedRows:1}]);
      }
      if(q.startsWith('select failed_attempts, greatest('))return res([{
        failed_attempts:user.failed_attempts,
        retry_seconds:Math.max(0,Math.ceil(((user.locked_until||0)-now())/1000))
      }]);
      if(q.startsWith('update users set failed_attempts=0,locked_until=null where id=')){
        user.failed_attempts=0;user.locked_until=null;
        return res([{affectedRows:1}]);
      }
      if(q.startsWith('select id from trusted_devices')){
        const [id,token_hash,agent_hash,auth_version]=values;
        const result=[...devices.values()].filter(x=>x.user_id===id && x.token_hash===token_hash &&
          x.agent_hash===agent_hash && x.auth_version===auth_version &&
          !x.revoked_at && x.expires_at>now()).map(x=>({id:x.id}));
        return res(result);
      }
      if(q.startsWith('update trusted_devices set last_used_at='))return res([{affectedRows:1}]);
      if(q.startsWith('insert into trusted_devices')){
        const [id,user_id,token_hash,agent_hash,auth_version]=values;
        devices.set(id,{id,user_id,token_hash,agent_hash,auth_version,expires_at:now()+30*86400000,revoked_at:null});
        return res([{affectedRows:1}]);
      }
      if(q.startsWith('update trusted_devices set revoked_at=')){
        for(const x of devices.values()){
          if(x.user_id===values[0] && x.token_hash===values[1])x.revoked_at=now();
        }
        return res([{affectedRows:1}]);
      }
      if(q.startsWith('insert into otp_challenges')){
        const [id,user_id,code_mac]=values;
        challenges.set(id,{id,user_id,code_mac,attempts:0,expires_at:now()+300000,consumed_at:null});
        return res([{affectedRows:1}]);
      }
      if(q.startsWith('select c.id,c.code_mac,c.attempts,')){
        const challenge=challenges.get(values[0]);
        if(!challenge)return res([]);
        return res([{
          ...challenge,active:challenge.expires_at>now() && !challenge.consumed_at,
          user_id:user.id,role:user.role,org_id:user.org_id,
          auth_version:user.auth_version,
          is_locked:Boolean(user.locked_until && user.locked_until>now())
        }]);
      }
      if(q.startsWith('update otp_challenges set attempts=')){
        const c=challenges.get(values[0]);
        if(c && !c.consumed_at && c.attempts<3)c.attempts++;
        return res([{affectedRows:1}]);
      }
      if(q.startsWith('update otp_challenges set consumed_at=')){
        const c=challenges.get(values[0]);
        if(!c || c.consumed_at || c.expires_at<=now() || c.attempts>=3)return res({affectedRows:0});
        c.consumed_at=now();
        return res({affectedRows:1});
      }
      if(q.startsWith('insert into sessions')){
        const [id,user_id,auth_version]=values;
        sessions.set(id,{id,user_id,auth_version,expires_at:now()+1800000,revoked_at:null});
        return res([{affectedRows:1}]);
      }
      if(q.startsWith('select u.id,u.role,u.org_id,u.auth_version from sessions')){
        const [sid,uid]=values;const session=sessions.get(sid);
        if(!session || session.user_id!==uid || session.revoked_at ||
          session.expires_at<=now() || session.auth_version!==user.auth_version)return res([]);
        return res([{id:user.id,role:user.role,org_id:user.org_id,auth_version:user.auth_version}]);
      }
      if(q.startsWith('update sessions set revoked_at=')){
        const [sid,uid]=values;const s=sessions.get(sid);
        if(s && s.user_id===uid)s.revoked_at=now();
        return res({affectedRows:s?1:0});
      }
      throw Error('Unmocked SQL: '+q);
    }
  };
  const dbPath=require.resolve('./database');
  const original=require.cache[dbPath];
  const stub=new Module(dbPath);
  stub.filename=dbPath;stub.loaded=true;stub.exports={db:()=>fake};
  require.cache[dbPath]=stub;
  delete require.cache[require.resolve('./identity')];
  const identity=require('./identity');
  if(original)require.cache[dbPath]=original;else delete require.cache[dbPath];
  const app=Fastify({logger:false});
  identity.install(app);
  await app.ready();
  const headers={'x-eventhub-internal-key':'t'.repeat(64)};
  const post=(path,payload)=>app.inject({method:'POST',url:path,headers,payload});
  try{
    const first=await post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',user_agent:'browser-A'
    });
    assert.equal(first.statusCode,200);
    const challenge=first.json();
    assert.equal(challenge.state,'otp_required');
    assert.match(challenge.simulation_code,/^[0-9]{6}$/);
    assert.equal(challenge.simulation,true);
    const wrongCode=challenge.simulation_code==='000000'?'999999':'000000';
    const wrong=await post('/internal/auth/verify',{
      challenge_id:challenge.challenge_id,code:wrongCode
    });
    assert.equal(wrong.statusCode,401);
    assert.equal(wrong.json().remaining_attempts,2);

    const good=await post('/internal/auth/verify',{
      challenge_id:challenge.challenge_id,code:challenge.simulation_code,
      trust_device:true,user_agent:'browser-A'
    });
    assert.equal(good.statusCode,200,good.body);
    const session=good.json().user;
    const device=good.json().device_token;
    assert.equal(session.id,user.id);
    assert.match(device,/^[A-Za-z0-9_-]{43}$/);

    const replay=await post('/internal/auth/verify',{
      challenge_id:challenge.challenge_id,code:challenge.simulation_code
    });
    assert.equal(replay.statusCode,401);

    const sessionPayload={sub:user.id,sid:session.sid,role:'participant',org_id:null,ver:1};
    assert.equal((await post('/internal/auth/session',sessionPayload)).statusCode,200);
    user.role='admin';
    assert.equal((await post('/internal/auth/session',sessionPayload)).statusCode,401);
    user.role='participant';

    const trusted=await post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',device_token:device,user_agent:'browser-A'
    });
    assert.equal(trusted.json().state,'authenticated');
    const differentUA=await post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',device_token:device,user_agent:'browser-B'
    });
    assert.equal(differentUA.json().state,'otp_required');

    assert.equal((await post('/internal/auth/device/revoke',{
      sub:user.id,device_token:device})).statusCode,200);
    const revokedDevice=await post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',device_token:device,user_agent:'browser-A'
    });
    assert.equal(revokedDevice.json().state,'otp_required');

    assert.equal((await post('/internal/auth/logout',{sub:user.id,sid:session.sid})).statusCode,200);
    assert.equal((await post('/internal/auth/session',sessionPayload)).statusCode,401);

    for(let attempt=1;attempt<=3;attempt++){
      const response=await post('/internal/auth/login',{
        email:user.email,password:'wrong-pass',user_agent:'browser-A'
      });
      assert.equal(response.statusCode,attempt===3?429:401);
      if(attempt<3)assert.equal(response.json().remaining_attempts,3-attempt);
    }
    assert.equal((await post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',user_agent:'browser-A'
    })).statusCode,429);

    user.locked_until=now()-1;
    const afterUnlock=await post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',user_agent:'browser-A'
    });
    assert.equal(afterUnlock.json().state,'otp_required');
    const expired=challenges.get(afterUnlock.json().challenge_id);
    expired.expires_at=now()-1;
    assert.equal((await post('/internal/auth/verify',{
      challenge_id:expired.id,code:afterUnlock.json().simulation_code
    })).statusCode,401);
  }finally{await app.close();}
});
