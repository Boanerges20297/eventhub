'use strict';
const crypto = require('node:crypto');
const { hash, verify: verifyHash } = require('@node-rs/argon2');
const { db } = require('./database');
const { internal, same } = require('./security');
const hashOptions = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const OTP_SECRET = process.env.EVENTHUB_INTERNAL_SECRET || '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const simulated = process.env.EVENTHUB_OTP_SIMULATION === 'true' && process.env.NODE_ENV !== 'production';

const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const codeMac = (challenge, code) => crypto.createHmac('sha256', OTP_SECRET)
  .update(challenge + ':' + code).digest('hex');
const userAgentHash = agent => digest(String(agent || '').slice(0, 512));

function protectedEndpoint(request, reply) {
  try { internal(request); return true; }
  catch { reply.code(403).send({ error: 'SERVICO_NAO_AUTORIZADO' }); return false; }
}
async function bootstrap() {
  const email = String(process.env.EVENTHUB_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const password = process.env.EVENTHUB_BOOTSTRAP_PASSWORD || '';
  if (!email || password.length < 14) return;
  const [rows] = await db().execute('SELECT id FROM users WHERE email=?', [email]);
  if (!rows.length) await db().execute(
    'INSERT INTO users (id,email,password_hash,role,org_id) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(), email, await hash(password,hashOptions), 'organizer', 'org-demo']);
}
async function failedAttempt(id) {
  // InnoDB serializes concurrent UPDATEs on the same user row. Once locked,
  // later requests must not extend the ban or reset/raise the counter.
  await db().execute(`UPDATE users SET
    locked_until=IF(failed_attempts+1>=3,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 15 MINUTE),NULL),
    failed_attempts=LEAST(3,failed_attempts+1)
    WHERE id=? AND failed_attempts<3
    AND (locked_until IS NULL OR locked_until<=UTC_TIMESTAMP(6))`, [id]);
  const [rows] = await db().execute(
    'SELECT failed_attempts, GREATEST(0,COALESCE(TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(6),locked_until),0)) AS retry_seconds FROM users WHERE id=?', [id]);
  return rows[0] || {failed_attempts:0,retry_seconds:0};
}
async function unlockedUser(email) {
  await db().execute(`UPDATE users SET failed_attempts=0,locked_until=NULL
    WHERE email=? AND locked_until IS NOT NULL AND locked_until<=UTC_TIMESTAMP(6)`, [email]);
  const [rows] = await db().execute(`SELECT id,email,password_hash,role,org_id,auth_version,
    (locked_until > UTC_TIMESTAMP(6)) AS is_locked,
    GREATEST(0,COALESCE(TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(6),locked_until),0)) AS retry_seconds
    FROM users WHERE email=?`, [email]);
  return rows[0];
}
async function openSession(u, trustedToken=null, agent='') {
  // A prior password/OTP check can become stale while other logins fail.
  // Lock the user row until the session insert + counter reset commit.
  const conn = await db().getConnection();
  const sid = crypto.randomUUID();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(`SELECT id,role,org_id,auth_version,
      (locked_until>UTC_TIMESTAMP(6)) AS is_locked
      FROM users WHERE id=? FOR UPDATE`, [u.id]);
    const current = rows[0];
    if (!current || current.is_locked || current.role!==u.role ||
        (current.org_id||null)!==(u.org_id||null) ||
        current.auth_version!==u.auth_version) {
      const err = new Error('SESSAO_NEGADA_CONTA_BLOQUEADA_OU_ALTERADA');
      err.code = 'SESSION_DENIED';
      throw err;
    }
    if (trustedToken) {
      // Device revocation must not race with session issuance.
      const [devices] = await conn.execute(`SELECT id FROM trusted_devices
        WHERE user_id=? AND token_hash=? AND agent_hash=? AND auth_version=?
        AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(6) FOR UPDATE`,
        [u.id,digest(trustedToken),userAgentHash(agent),u.auth_version]);
      if (!devices.length) {
        const err=new Error('DISPOSITIVO_REVOGADO');
        err.code='SESSION_DENIED';
        throw err;
      }
    }
    await conn.execute(`INSERT INTO sessions (id,user_id,auth_version,expires_at)
      VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 30 MINUTE))`,
      [sid,u.id,u.auth_version]);
    await conn.execute('UPDATE users SET failed_attempts=0,locked_until=NULL WHERE id=?', [u.id]);
    await conn.commit();
    return {id:u.id, role:u.role, org_id:u.org_id, auth_version:u.auth_version, sid};
  } catch(err) {
    await conn.rollback();
    throw err;
  } finally { conn.release(); }
}
async function sessionFor(reply, u, trustedToken=null, agent='') {
  try { return await openSession(u,trustedToken,agent); }
  catch(err) {
    await rejectDenied(reply,u,err);
    return null;
  }
}
async function rejectDenied(reply,u,err) {
  if (err.code !== 'SESSION_DENIED') throw err;
  const [rows] = await db().execute(
    'SELECT GREATEST(0,COALESCE(TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(6),locked_until),0)) AS retry_seconds FROM users WHERE id=?',
    [u.id]);
  const retry=Number(rows[0]?.retry_seconds||0);
  if (retry>0) {
    reply.header('Retry-After',String(retry));
    reply.code(429).send({error:'LOGIN_BLOQUEADO_TEMPORARIAMENTE',retry_after_seconds:retry});
  } else {
    reply.code(401).send({error:'PERMISSAO_OU_SESSAO_ALTERADA_REFAZER_LOGIN'});
  }
}
async function openChallenge(u) {
  // Do not offer a new OTP challenge if another request has already locked
  // the account while Argon2 was verifying the password.
  const conn=await db().getConnection();
  const challenge_id=crypto.randomUUID();
  const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
  try {
    await conn.beginTransaction();
    const [rows]=await conn.execute(`SELECT id,role,org_id,auth_version,
      (locked_until>UTC_TIMESTAMP(6)) AS is_locked
      FROM users WHERE id=? FOR UPDATE`,[u.id]);
    const current=rows[0];
    if (!current || current.is_locked || current.role!==u.role ||
        (current.org_id||null)!==(u.org_id||null) ||
        current.auth_version!==u.auth_version) {
      const err=new Error('DESAFIO_NEGADO_CONTA_BLOQUEADA_OU_ALTERADA');
      err.code='SESSION_DENIED';
      throw err;
    }
    await conn.execute(`INSERT INTO otp_challenges
      (id,user_id,code_mac,expires_at)
      VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE))`,
      [challenge_id,u.id,codeMac(challenge_id,code)]);
    await conn.commit();
    return {state:'otp_required',challenge_id,expires_in_seconds:300,
      simulation:true,simulation_code:code};
  } catch(err) {
    await conn.rollback();
    throw err;
  } finally { conn.release(); }
}
async function challengeFor(reply,u) {
  try { return await openChallenge(u); }
  catch(err) {
    await rejectDenied(reply,u,err);
    return null;
  }
}
async function trustedDevice(u, token, agent) {
  if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return false;
  const [rows] = await db().execute(`SELECT id FROM trusted_devices
    WHERE user_id=? AND token_hash=? AND agent_hash=? AND auth_version=?
    AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(6)`,
    [u.id,digest(token),userAgentHash(agent),u.auth_version]);
  if (!rows.length) return false;
  await db().execute('UPDATE trusted_devices SET last_used_at=UTC_TIMESTAMP(6) WHERE id=?',[rows[0].id]);
  return true;
}
async function issueDevice(u, agent) {
  const token=crypto.randomBytes(32).toString('base64url');
  await db().execute(`INSERT INTO trusted_devices
    (id,user_id,token_hash,agent_hash,auth_version,expires_at)
    VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 30 DAY))`,
    [crypto.randomUUID(),u.id,digest(token),userAgentHash(agent),u.auth_version]);
  return token;
}
function install(server) {
  server.post('/internal/auth/register', async (request,reply) => {
    if (!protectedEndpoint(request,reply)) return;
    const {email,password}=request.body||{};
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || email.length>255 ||
        typeof password !== 'string' || password.length < 12 || password.length>128)
      return reply.code(400).send({error:'CADASTRO_INVALIDO'});
    try {
      const id=crypto.randomUUID();
      await db().execute('INSERT INTO users (id,email,password_hash,role,org_id) VALUES (?,?,?,?,?)',
        [id,email.trim().toLowerCase(),await hash(password,hashOptions),'participant',null]);
      return reply.code(201).send({user_id:id});
    } catch(e) {
      if (e.code==='ER_DUP_ENTRY') return reply.code(409).send({error:'EMAIL_JA_EXISTENTE'});
      throw e;
    }
  });

  server.post('/internal/auth/login', async(request,reply)=>{
    if (!protectedEndpoint(request,reply)) return;
    const {email,password,device_token,user_agent}=request.body||{};
    if (typeof email!=='string' || typeof password!=='string' || email.length>255 || password.length>128)
      return reply.code(401).send({error:'CREDENCIAIS_INVALIDAS'});
    const u=await unlockedUser(email.trim().toLowerCase());
    if (!u) return reply.code(401).send({error:'CREDENCIAIS_INVALIDAS'});
    if (u.is_locked) {
      reply.header('Retry-After',String(Math.max(1,u.retry_seconds)));
      return reply.code(429).send({error:'LOGIN_BLOQUEADO_TEMPORARIAMENTE',retry_after_seconds:u.retry_seconds});
    }
    if (!(await verifyHash(u.password_hash,password))) {
      const failure=await failedAttempt(u.id);
      if (failure.failed_attempts>=3) {
        reply.header('Retry-After',String(Math.max(1,failure.retry_seconds)));
        return reply.code(429).send({error:'LOGIN_BLOQUEADO_TEMPORARIAMENTE',retry_after_seconds:failure.retry_seconds});
      }
      return reply.code(401).send({error:'CREDENCIAIS_INVALIDAS',remaining_attempts:3-failure.failed_attempts});
    }
    if (await trustedDevice(u,device_token,user_agent)) {
      const session = await sessionFor(reply,u,device_token,user_agent);
      if (!session) return;
      return {state:'authenticated',user:session,trusted_device:true};
    }
    if (!simulated) return reply.code(503).send({error:'OTP_CANAL_NAO_CONFIGURADO'});
    const challenge=await challengeFor(reply,u);
    if (!challenge) return;
    return challenge;
  });

  server.post('/internal/auth/verify',async(request,reply)=>{
    if (!protectedEndpoint(request,reply)) return;
    const {challenge_id,code,trust_device,user_agent}=request.body||{};
    if (!UUID.test(String(challenge_id||'')) || typeof code!=='string' || !/^\d{6}$/.test(code))
      return reply.code(400).send({error:'OTP_INVALIDO'});
    const [rows]=await db().execute(`SELECT c.id,c.code_mac,c.attempts,
      (c.expires_at>UTC_TIMESTAMP(6) AND c.consumed_at IS NULL) AS active,
      u.id AS user_id,u.role,u.org_id,u.auth_version,
      (u.locked_until>UTC_TIMESTAMP(6)) AS is_locked
      FROM otp_challenges c JOIN users u ON u.id=c.user_id WHERE c.id=?`,[challenge_id]);
    if(!rows.length || !rows[0].active || rows[0].attempts>=3 || rows[0].is_locked)
      return reply.code(401).send({error:'OTP_INVALIDO_OU_EXPIRADO'});
    const c=rows[0];
    if (!same(c.code_mac,codeMac(challenge_id,code))) {
      const [changed] = await db().execute(`UPDATE otp_challenges SET attempts=attempts+1
        WHERE id=? AND consumed_at IS NULL AND expires_at>UTC_TIMESTAMP(6)
        AND attempts<3`,[challenge_id]);
      if (changed.affectedRows!==1)
        return reply.code(401).send({error:'OTP_INVALIDO_OU_EXPIRADO'});
      const f=await failedAttempt(c.user_id);
      if(f.failed_attempts>=3) return reply.code(429).send({
        error:'LOGIN_BLOQUEADO_TEMPORARIAMENTE',retry_after_seconds:f.retry_seconds});
      return reply.code(401).send({error:'OTP_INVALIDO',remaining_attempts:Math.max(0,2-c.attempts)});
    }
    const [result]=await db().execute(`UPDATE otp_challenges SET consumed_at=UTC_TIMESTAMP(6)
      WHERE id=? AND consumed_at IS NULL AND expires_at>UTC_TIMESTAMP(6) AND attempts<3`,[challenge_id]);
    if(result.affectedRows!==1) return reply.code(401).send({error:'OTP_JA_UTILIZADO'});
    const u={id:c.user_id,role:c.role,org_id:c.org_id,auth_version:c.auth_version};
    const session=await sessionFor(reply,u);
    if (!session) return;
    const device_token=trust_device===true ? await issueDevice(u,user_agent) : null;
    return {state:'authenticated',user:session,device_token};
  });

  server.post('/internal/auth/session',async(request,reply)=>{
    if (!protectedEndpoint(request,reply)) return;
    const {sub,sid,role,org_id,ver}=request.body||{};
    if(!UUID.test(String(sub||'')) || !UUID.test(String(sid||'')) ||
       !Number.isInteger(ver)) return reply.code(401).send({error:'SESSAO_INVALIDA'});
    const [rows]=await db().execute(`SELECT u.id,u.role,u.org_id,u.auth_version
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL
      AND s.expires_at>UTC_TIMESTAMP(6) AND s.auth_version=u.auth_version`,[sid,sub]);
    const u=rows[0];
    if(!u || u.role!==role || (u.org_id||null)!==(org_id||null) || u.auth_version!==ver)
      return reply.code(401).send({error:'SESSAO_REVOGADA_OU_PERMISSAO_ALTERADA'});
    return {valid:true};
  });

  server.post('/internal/auth/logout',async(request,reply)=>{
    if(!protectedEndpoint(request,reply)) return;
    const {sub,sid}=request.body||{};
    if(!UUID.test(String(sub||''))||!UUID.test(String(sid||'')))
      return reply.code(400).send({error:'SESSAO_INVALIDA'});
    await db().execute('UPDATE sessions SET revoked_at=UTC_TIMESTAMP(6) WHERE id=? AND user_id=?',
      [sid,sub]);
    return {status:'SAIU'};
  });

  server.post('/internal/auth/device/revoke',async(request,reply)=>{
    if(!protectedEndpoint(request,reply)) return;
    const {sub,device_token}=request.body||{};
    if(!UUID.test(String(sub||'')) || typeof device_token!=='string' ||
       !/^[a-zA-Z0-9_-]{43}$/.test(device_token))
      return reply.code(400).send({error:'DISPOSITIVO_INVALIDO'});
    await db().execute(`UPDATE trusted_devices SET revoked_at=UTC_TIMESTAMP(6)
      WHERE user_id=? AND token_hash=? AND revoked_at IS NULL`,[sub,digest(device_token)]);
    return {status:'DISPOSITIVO_REVOGADO'};
  });
}
async function purgeExpired(){
  for(const table of ['otp_challenges','sessions','trusted_devices']){
    await db().query('DELETE FROM '+table+' WHERE expires_at<UTC_TIMESTAMP(6) LIMIT 1000');
  }
}
function startCleanup(){
  const timer=setInterval(()=>purgeExpired().catch(()=>{}),60*1000);
  timer.unref();
}
module.exports={install,bootstrap,startCleanup};
