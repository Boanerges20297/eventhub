'use strict';
// Real InnoDB integration test, opt-in and destructive ONLY to the DB it creates.
// Run: $env:EVENTHUB_TEST_MYSQL='1'; node --test identity.mysql.test.js
// Runs on STI01 against the isolated local MySQL on 127.0.0.1:33307.
// Never point this suite at a shared server or production database.
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const Fastify=require('fastify');
const {hash}=require('@node-rs/argon2');

if(process.env.EVENTHUB_TEST_MYSQL!=='1'){
  test('MySQL integration requires EVENTHUB_TEST_MYSQL=1', {skip:true},()=>{});
} else {
  test('Identity/InnoDB: lockout, concurrent OTP, session/device safety', {timeout:60000}, async(t)=>{
    const host='127.0.0.1', port=33307;
    const admin=await mysql.createConnection({
      host,port,user:'root',password:'',connectTimeout:4000,timezone:'Z'
    });
    let created=false, pool, app, lockConn;
    const name='eventhub_test_auth_'+Date.now().toString(36)+'_'+crypto.randomBytes(3).toString('hex');
    const userId=crypto.randomUUID(), email='identity-innodb@example.test';
    const password='correct-integration-password-123';
    const key='t'.repeat(64);
    const post=(path,payload)=>app.inject({
      method:'POST',url:path,headers:{'x-eventhub-internal-key':key},payload
    });
    const login=(pass=password,extras={})=>post('/internal/auth/login',{
      email,password:pass,user_agent:'integration-browser',...extras
    });
    const reset=async()=>{
      await pool.execute('UPDATE users SET failed_attempts=0,locked_until=NULL,role=?,auth_version=1 WHERE id=?',
        ['participant',userId]);
    };
    const row=async()=>(
      await pool.execute(
        "SELECT failed_attempts,locked_until,DATE_FORMAT(locked_until,'%Y-%m-%d %H:%i:%s.%f') AS lock_text FROM users WHERE id=?",
        [userId])
    )[0][0];
    const count=async(table)=>Number((await pool.query('SELECT COUNT(*) AS n FROM '+table))[0][0].n);
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    try{
      const [probe]=await admin.query('SELECT @@port AS port, @@version AS version, @@bind_address AS bind_address');
      assert.equal(Number(probe[0].port),port,'wrong MySQL port: refusing to run');
      assert.equal(probe[0].bind_address,'127.0.0.1','MySQL must be local-only');
      assert.match(probe[0].version,/^8\./);
      await admin.query('CREATE DATABASE '+mysql.escapeId(name)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
      created=true;
      process.env.DB_HOST=host;
      process.env.DB_PORT=String(port);
      process.env.DB_USER='root';
      process.env.DB_PASSWORD='';
      process.env.DB_NAME=name;
      process.env.EVENTHUB_INTERNAL_SECRET=key;
      process.env.EVENTHUB_JWT_SECRET='j'.repeat(64);
      process.env.EVENTHUB_OTP_SIMULATION='true';
      process.env.NODE_ENV='test';
      const database=require('./database');
      await database.init('identity');
      pool=database.db();
      const identity=require('./identity');
      app=Fastify({logger:false});
      identity.install(app);
      await app.ready();
      await pool.execute(
        'INSERT INTO users(id,email,password_hash,role,org_id) VALUES (?,?,?,?,?)',
        [userId,email,await hash(password,{memoryCost:8192,timeCost:1,parallelism:1}),'participant',null]);

      await t.test('schema and InnoDB indexes are really present',async()=>{
        const [tables]=await pool.query(
          "SELECT TABLE_NAME,ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE()");
        for(const table of ['users','sessions','otp_challenges','trusted_devices']){
          const found=tables.find(x=>x.TABLE_NAME===table);
          assert.ok(found,'missing '+table);
          assert.equal(found.ENGINE,'InnoDB');
        }
        const [indexes]=await pool.query(
          "SELECT TABLE_NAME,INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE()");
        assert.ok(indexes.some(x=>x.TABLE_NAME==='otp_challenges'&&x.INDEX_NAME==='idx_otp_expiry'));
        assert.ok(indexes.some(x=>x.TABLE_NAME==='sessions'&&x.INDEX_NAME==='idx_session_expiry'));
      });

      await t.test('six simultaneous wrong passwords lock exactly once',async()=>{
        await reset();
        const responses=await Promise.all(Array.from({length:6},()=>login('incorrect-password')));
        assert.ok(responses.every(x=>[401,429].includes(x.statusCode)),
          JSON.stringify(responses.map(x=>[x.statusCode,x.body])));
        const state=await row();
        assert.equal(state.failed_attempts,3);
        assert.ok(state.locked_until,'missing 15-minute ban');
        const originalLock=state.lock_text;
        assert.equal((await login('incorrect-password')).statusCode,429);
        assert.equal((await row()).lock_text,originalLock,'ban must not be extended');
        assert.equal((await login()).statusCode,429,'correct password must not bypass ban');
      });

      await t.test('five simultaneous wrong OTPs are capped and block the account',async()=>{
        await reset();
        const start=await login();
        assert.equal(start.statusCode,200,start.body);
        assert.equal(start.json().state,'otp_required');
        const {challenge_id,simulation_code}=start.json();
        const wrong=simulation_code==='000000'?'999999':'000000';
        const responses=await Promise.all(Array.from({length:5},
          ()=>post('/internal/auth/verify',{challenge_id,code:wrong})));
        assert.ok(responses.every(x=>[401,429].includes(x.statusCode)));
        const [challengeRows]=await pool.execute(
          'SELECT attempts,consumed_at FROM otp_challenges WHERE id=?',[challenge_id]);
        assert.equal(challengeRows[0].attempts,3);
        assert.equal((await row()).failed_attempts,3);
        assert.equal((await post('/internal/auth/verify',{challenge_id,code:simulation_code})).statusCode,401);
      });

      await t.test('a good OTP is consumed once and a trusted device is revocable',async()=>{
        await reset();
        const start=(await login()).json();
        const payload={challenge_id:start.challenge_id,code:start.simulation_code,
          trust_device:true,user_agent:'integration-browser'};
        const results=await Promise.all([
          post('/internal/auth/verify',payload),
          post('/internal/auth/verify',payload)
        ]);
        assert.deepEqual(results.map(x=>x.statusCode).sort(),[200,401]);
        const success=results.find(x=>x.statusCode===200).json();
        const token=success.device_token;
        assert.match(token,/^[A-Za-z0-9_-]{43}$/);
        const session=success.user;
        assert.equal(session.id,userId);
        assert.equal((await post('/internal/auth/session',{
          sub:userId,sid:session.sid,role:'participant',org_id:null,ver:1
        })).statusCode,200);
        const trusted=await login(password,{device_token:token});
        assert.equal(trusted.statusCode,200,trusted.body);
        assert.equal(trusted.json().trusted_device,true);
        const wrongUA=await login(password,{device_token:token,user_agent:'other-browser'});
        assert.equal(wrongUA.json().state,'otp_required');
        assert.equal((await post('/internal/auth/device/revoke',{
          sub:userId,device_token:token
        })).statusCode,200);
        const afterRevoke=await login(password,{device_token:token});
        assert.equal(afterRevoke.json().state,'otp_required');
        await pool.execute('UPDATE users SET role=? WHERE id=?',['admin',userId]);
        assert.equal((await post('/internal/auth/session',{
          sub:userId,sid:session.sid,role:'participant',org_id:null,ver:1
        })).statusCode,401,'role change should invalidate old session');
        await reset();
      });

      await t.test('committed third failure blocks OTP-to-session race on a real row lock',async()=>{
        await reset();
        const start=await login();
        assert.equal(start.statusCode,200,start.body);
        const challenge=start.json();
        const beforeSessions=await count('sessions');
        const beforeDevices=await count('trusted_devices');
        lockConn=await mysql.createConnection({
          host,port,user:'root',password:'',database:name,timezone:'Z'
        });
        await lockConn.beginTransaction();
        await lockConn.execute(
          'UPDATE users SET failed_attempts=3,locked_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE) WHERE id=?',
          [userId]);
        let finished=false;
        const pending=post('/internal/auth/verify',{
          challenge_id:challenge.challenge_id,code:challenge.simulation_code,
          trust_device:true,user_agent:'integration-browser'
        }).then(r=>{finished=true;return r;});
        try{
          await sleep(250);
          assert.equal(finished,false,'request should wait for the user-row lock');
          await lockConn.commit();
        }catch(error){
          await lockConn.rollback();
          await pending.catch(()=>{});
          throw error;
        }finally{
          await lockConn.end();
          lockConn=null;
        }
        const denied=await pending;
        assert.equal(denied.statusCode,429,denied.body);
        assert.equal(await count('sessions'),beforeSessions);
        assert.equal(await count('trusted_devices'),beforeDevices);
        assert.equal((await row()).failed_attempts,3);
      });

      await t.test('rollback of a competing transaction does not falsely lock the account',async()=>{
        await reset();
        const start=await login();
        assert.equal(start.statusCode,200,start.body);
        const challenge=start.json();
        lockConn=await mysql.createConnection({
          host,port,user:'root',password:'',database:name,timezone:'Z'
        });
        await lockConn.beginTransaction();
        await lockConn.execute(
          'UPDATE users SET failed_attempts=3,locked_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE) WHERE id=?',
          [userId]);
        let finished=false;
        const pending=post('/internal/auth/verify',{
          challenge_id:challenge.challenge_id,code:challenge.simulation_code
        }).then(r=>{finished=true;return r;});
        try{
          await sleep(250);
          assert.equal(finished,false);
          await lockConn.rollback();
        }catch(error){
          await lockConn.rollback().catch(()=>{});
          await pending.catch(()=>{});
          throw error;
        }finally{
          await lockConn.end();
          lockConn=null;
        }
        const accepted=await pending;
        assert.equal(accepted.statusCode,200,accepted.body);
        assert.equal((await row()).failed_attempts,0);
      });
    }finally{
      if(lockConn){await lockConn.rollback().catch(()=>{});await lockConn.end().catch(()=>{});}
      if(app)await app.close();
      if(pool)await pool.end();
      if(created)await admin.query('DROP DATABASE '+mysql.escapeId(name));
      await admin.end();
    }
  });
}
