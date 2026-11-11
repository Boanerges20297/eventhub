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
  let dbQueue=Promise.resolve(), pauseNextSession=null;
  const fake={
    async getConnection(){
      const previous=dbQueue;
      let release;
      const active=new Promise(resolve=>{release=resolve;});
      dbQueue=previous.then(()=>active);
      await previous;
      if(pauseNextSession){
        const pause=pauseNextSession;
        pauseNextSession=null;
        pause.enter();
        await pause.wait;
      }
      return {
        beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},
        execute:(...args)=>fake.execute(...args),
        release
      };
    },
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
        if(user.failed_attempts>=3 || (user.locked_until && user.locked_until>now()))
          return res({affectedRows:0});
        user.failed_attempts=Math.min(3,user.failed_attempts+1);
        user.locked_until=user.failed_attempts>=3?now()+15*60*1000:null;
        return res({affectedRows:1});
      }
      if(q.startsWith('select greatest('))return res([{
        retry_seconds:Math.max(0,Math.ceil(((user.locked_until||0)-now())/1000))
      }]);
      if(q.startsWith('select id,role,org_id,auth_version,')){
        if(values[0]!==user.id)return res([]);
        return res([{id:user.id,role:user.role,org_id:user.org_id,auth_version:user.auth_version,
          is_locked:Boolean(user.locked_until && user.locked_until>now())}]);
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
        if(!c || c.consumed_at || c.attempts>=3 || c.expires_at<=now())return res({affectedRows:0});
        c.attempts++;
        return res({affectedRows:1});
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

    // Six simultaneous wrong passwords must cause exactly one 15-minute ban.
    user.failed_attempts=0;user.locked_until=null;
    const concurrent=await Promise.all(Array.from({length:6},()=>post('/internal/auth/login',{
      email:user.email,password:'wrong-pass',user_agent:'browser-A'
    })));
    assert.ok(concurrent.every(x=>[401,429].includes(x.statusCode)));
    assert.equal(user.failed_attempts,3);
    assert.ok(user.locked_until>now());
    const firstLock=user.locked_until;
    assert.equal((await post('/internal/auth/login',{
      email:user.email,password:'wrong-pass',user_agent:'browser-A'
    })).statusCode,429);
    assert.equal(user.locked_until,firstLock,'locked requests cannot extend the ban');

    // Concurrent wrong OTPs must not exceed three attempts or allow code replay.
    user.locked_until=now()-1;
    const next=await post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',user_agent:'browser-A'
    });
    assert.equal(next.json().state,'otp_required');
    const wrongOtp=next.json().simulation_code==='000000'?'999999':'000000';
    const failures=await Promise.all(Array.from({length:5},()=>post('/internal/auth/verify',{
      challenge_id:next.json().challenge_id,code:wrongOtp
    })));
    assert.ok(failures.every(x=>[401,429].includes(x.statusCode)));
    assert.equal(challenges.get(next.json().challenge_id).attempts,3);
    assert.equal(user.failed_attempts,3);
    assert.equal((await post('/internal/auth/verify',{
      challenge_id:next.json().challenge_id,code:next.json().simulation_code
    })).statusCode,401);

    // The password may have been verified before the third failure commits.
    // Force the valid login to wait before its locked-row read.
    user.locked_until=now()-1;
    const start=await post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',user_agent:'browser-A'
    });
    assert.equal(start.json().state,'otp_required');
    const setup=await post('/internal/auth/verify',{
      challenge_id:start.json().challenge_id,code:start.json().simulation_code,
      trust_device:true,user_agent:'browser-A'
    });
    assert.equal(setup.statusCode,200);
    const trustedToken=setup.json().device_token;
    user.failed_attempts=2;user.locked_until=null;
    let entered,release;
    const atLock=new Promise(resolve=>entered=resolve);
    const held=new Promise(resolve=>release=resolve);
    pauseNextSession={enter:entered,wait:held};
    const beforeSessions=sessions.size;
    const pendingValid=post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',
      device_token:trustedToken,user_agent:'browser-A'
    });
    try{
      await atLock;
      const third=await post('/internal/auth/login',{
        email:user.email,password:'wrong-pass',user_agent:'browser-A'
      });
      assert.equal(third.statusCode,429);
    }finally{release();}
    const denied=await pendingValid;
    assert.equal(denied.statusCode,429);
    assert.equal(sessions.size,beforeSessions,'no session created after competing lockout');
    assert.equal(user.failed_attempts,3);

    // A password validated before the third bad attempt cannot create
    // a new OTP challenge after the account is locked.
    user.failed_attempts=2;user.locked_until=null;
    let challengeEntered,challengeRelease;
    const atChallenge=new Promise(resolve=>challengeEntered=resolve);
    const waitChallenge=new Promise(resolve=>challengeRelease=resolve);
    pauseNextSession={enter:challengeEntered,wait:waitChallenge};
    const previousChallenges=challenges.size;
    const pendingChallenge=post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',user_agent:'browser-X'
    });
    try{
      await atChallenge;
      const third=await post('/internal/auth/login',{
        email:user.email,password:'wrong-pass',user_agent:'browser-A'
      });
      assert.equal(third.statusCode,429);
    }finally{challengeRelease();}
    assert.equal((await pendingChallenge).statusCode,429);
    assert.equal(challenges.size,previousChallenges,'locked account cannot create OTP challenge');

    // If a trusted device is revoked while a login is completing, its token
    // must be rechecked under lock instead of relying on the initial SELECT.
    user.locked_until=now()-1;
    const deviceLogin=await post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',user_agent:'browser-D'
    });
    assert.equal(deviceLogin.json().state,'otp_required');
    const newDevice=await post('/internal/auth/verify',{
      challenge_id:deviceLogin.json().challenge_id,code:deviceLogin.json().simulation_code,
      trust_device:true,user_agent:'browser-D'
    });
    assert.equal(newDevice.statusCode,200);
    const revocableToken=newDevice.json().device_token;
    let revokeEntered,revokeRelease;
    const atRevoke=new Promise(resolve=>revokeEntered=resolve);
    const waitRevoke=new Promise(resolve=>revokeRelease=resolve);
    pauseNextSession={enter:revokeEntered,wait:waitRevoke};
    const sessionsBeforeRevoke=sessions.size;
    const loginBeforeRevoke=post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',
      device_token:revocableToken,user_agent:'browser-D'
    });
    try{
      await atRevoke;
      assert.equal((await post('/internal/auth/device/revoke',{
        sub:user.id,device_token:revocableToken
      })).statusCode,200);
    }finally{revokeRelease();}
    const refused=await loginBeforeRevoke;
    assert.equal(refused.statusCode,401);
    assert.equal(sessions.size,sessionsBeforeRevoke,'revoked device cannot start a new session');

    // Same race after a valid OTP: no session nor trusted-device grant is allowed.
    user.locked_until=now()-1;
    const otpStart=await post('/internal/auth/login',{
      email:user.email,password:'valid-password-1234',user_agent:'browser-C'
    });
    assert.equal(otpStart.json().state,'otp_required');
    user.failed_attempts=2;user.locked_until=null;
    let otpEntered,otpRelease;
    const otpAtLock=new Promise(resolve=>otpEntered=resolve);
    const otpHeld=new Promise(resolve=>otpRelease=resolve);
    pauseNextSession={enter:otpEntered,wait:otpHeld};
    const beforeOtpSessions=sessions.size;
    const beforeDevices=devices.size;
    const pendingOtp=post('/internal/auth/verify',{
      challenge_id:otpStart.json().challenge_id,code:otpStart.json().simulation_code,
      trust_device:true,user_agent:'browser-C'
    });
    try{
      await otpAtLock;
      const third=await post('/internal/auth/login',{
        email:user.email,password:'wrong-pass',user_agent:'browser-A'
      });
      assert.equal(third.statusCode,429);
    }finally{otpRelease();}
    const otpDenied=await pendingOtp;
    assert.equal(otpDenied.statusCode,429);
    assert.equal(sessions.size,beforeOtpSessions);
    assert.equal(devices.size,beforeDevices,'OTP cannot grant trust after account lock');
  }finally{await app.close();}
});
