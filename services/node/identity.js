'use strict';
const crypto = require('node:crypto');
const { hash, verify } = require('@node-rs/argon2');
const { db } = require('./database');
const { internal } = require('./security');
const hashOptions = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

async function bootstrap() {
  const email = String(process.env.EVENTHUB_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const password = process.env.EVENTHUB_BOOTSTRAP_PASSWORD || '';
  if (!email || password.length < 14) return;
  const [rows] = await db().execute('SELECT id FROM users WHERE email=?', [email]);
  if (!rows.length) {
    await db().execute(
      'INSERT INTO users (id,email,password_hash,role,org_id) VALUES (?,?,?,?,?)',
      [crypto.randomUUID(),email,await hash(password,hashOptions),'organizer','org-demo']
    );
  }
}
function install(server) {
  server.post('/internal/auth/register', async (request,reply) => {
    try { internal(request); } catch { return reply.code(403).send({error:'SERVICO_NAO_AUTORIZADO'}); }
    const {email,password} = request.body || {};
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || email.length>255 ||
        typeof password !== 'string' || password.length < 12 || password.length>128) {
      return reply.code(400).send({error:'CADASTRO_INVALIDO'});
    }
    try {
      const id=crypto.randomUUID();
      await db().execute(
        'INSERT INTO users (id,email,password_hash,role,org_id) VALUES (?,?,?,?,?)',
        [id,email.trim().toLowerCase(),await hash(password,hashOptions),'participant',null]
      );
      return reply.code(201).send({user_id:id});
    } catch(e) {
      if (e.code==='ER_DUP_ENTRY') return reply.code(409).send({error:'EMAIL_JA_EXISTENTE'});
      throw e;
    }
  });
  server.post('/internal/auth/login', async (request,reply) => {
    try { internal(request); } catch { return reply.code(403).send({error:'SERVICO_NAO_AUTORIZADO'}); }
    const {email,password} = request.body||{};
    if(typeof email!=='string'||typeof password!=='string')
      return reply.code(400).send({error:'CREDENCIAIS_INVALIDAS'});
    const [rows] = await db().execute(
      'SELECT id,email,password_hash,role,org_id FROM users WHERE email=?',
      [email.trim().toLowerCase()]
    );
    if(!rows.length || !(await verify(rows[0].password_hash,password)))
      return reply.code(401).send({error:'CREDENCIAIS_INVALIDAS'});
    const u=rows[0];
    return {user:{id:u.id,role:u.role,org_id:u.org_id,email:u.email}};
  });
}
module.exports={install,bootstrap};
