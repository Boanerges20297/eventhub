'use strict';
/** EventHub: concorrencia pela API real (Gateway->Inscricoes->SQLite->MySQL).
 * Executar em ambiente isolado: Get-Content -Raw scripts/test_api_concurrency_e2e.js | docker compose -p eventhub-chaos exec -T identity node -
 * Somente dados sinteticos. Nao apaga nenhuma tabela nem volume.
 */
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const BASE = process.env.EVENTHUB_TEST_URL || 'http://gateway:3000';
const PEOPLE = 40, CAPACITY = 12;

class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async call(method, path, body, key) {
    const headers = { Origin: BASE };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.csrf && method !== 'GET') headers['x-csrf-token'] = this.csrf;
    if (key) headers['idempotency-key'] = key;
    const response = await fetch(BASE + path, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(18000)
    });
    const result = await response.json().catch(() => ({}));
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    return { code: response.status, body: result };
  }
  async login(email, password) {
    let result = await this.call('POST', '/auth/login', { email, password });
    if (result.body?.otp_required === true) {
      assert.equal(result.body.simulation, true, "E2E requires simulated OTP in local development");
      result = await this.call("POST","/auth/verify",{challenge_id:result.body.challenge_id,code:result.body.simulation_code});
    }
    assert.equal(result.code, 200, JSON.stringify(result.body));
    this.csrf = result.body.csrf;
  }
}
function cpf(seed) {
  let result = String(41000 + seed).padStart(9, '0');
  for (const count of [9, 10]) {
    const check = Array.from({length: count}, (_, i) =>
      Number(result[i]) * (count + 1 - i)).reduce((a,b)=>a+b,0) * 10 % 11;
    result += check === 10 ? '0' : String(check);
  }
  return result;
}
async function main() {
  const organizer = new Client();
  await organizer.login(process.env.EVENTHUB_BOOTSTRAP_EMAIL,
                        process.env.EVENTHUB_BOOTSTRAP_PASSWORD);
  let response = await organizer.call('POST', '/eventos', {
    titulo: 'Stress HTTP ' + crypto.randomUUID().slice(0,8)
  });
  assert.equal(response.code, 201, JSON.stringify(response.body));
  response = await organizer.call('POST',
      '/eventos/' + response.body.evento_id + '/atividades', {
        titulo: 'Capacidade sob concorrencia HTTP',
        capacidade: CAPACITY, gratuita: true,
        lista_espera_habilitada: true, prazo_reserva_min: 30
      });
  assert.equal(response.code, 201, JSON.stringify(response.body));
  assert.equal(response.body.publicada, true);
  const activity = response.body.atividade_id;

  const participants = [];
  for (let start=0; start<PEOPLE; start+=8) {
    const batch = await Promise.all(
      Array.from({length: Math.min(8, PEOPLE-start)}, async () => {
        const c = new Client();
        const email = 'chaos-' + crypto.randomUUID() + '@eventhub.local';
        const password = crypto.randomBytes(16).toString('hex') + 'Aa!';
        const r = await c.call('POST','/auth/register',{email,password});
        assert.equal(r.code,201,JSON.stringify(r.body));
        await c.login(email,password);
        return c;
      })
    );
    participants.push(...batch);
  }

  const keys = participants.map(()=>crypto.randomUUID());
  const began = Date.now();
  const submissions = await Promise.all(
    participants.map((client,i) =>
      client.call('POST','/inscricoes',
        {atividade_id: activity, cpf: cpf(i)}, keys[i]))
  );
  const codes = submissions.reduce((a,r) => {
    a[r.code] = (a[r.code] || 0) + 1; return a;
  }, {});
  assert.ok(submissions.every(r => r.code === 202),
    'HTTP_CODES=' + JSON.stringify(codes) +
    ' EXAMPLE=' + JSON.stringify(submissions.find(r=>r.code!==202)));
  const ids = submissions.map(r => r.body.inscricao_id);
  const ticketNums = submissions.map(r=>r.body.numero_ticket);
  assert.equal(new Set(ids).size, PEOPLE, 'IDs duplicados');
  assert.deepEqual([...ticketNums].sort((a,b)=>a-b),
    Array.from({length: PEOPLE},(_,i)=>i+1), 'FIFO sequencial');

  for (let i=0; i<4; i++) {
    const replay = await participants[i].call('POST','/inscricoes',
      {atividade_id: activity, cpf: cpf(i)}, keys[i]);
    assert.equal(replay.code,202,'replay HTTP');
    assert.equal(replay.body.inscricao_id,ids[i],'replay id');
  }
  const forbidden = await participants[1].call('GET','/inscricoes/'+ids[0]);
  assert.equal(forbidden.code,404,'isolamento do titular');

  const deadline = Date.now() + 80000;
  let states = [];
  do {
    states = await Promise.all(participants.map(async(c,i) => {
      const r=await c.call('GET','/inscricoes/'+ids[i]);
      return r.code === 200 ? r.body.estado : 'HTTP_'+r.code;
    }));
    if (states.every(s => s === 'CONFIRMADO' || s === 'EM_FILA')) break;
    await new Promise(r=>setTimeout(r,1000));
  } while(Date.now() < deadline);

  const ordered = ticketNums.map((number,i)=>({number,state:states[i]}))
        .sort((a,b)=>a.number-b.number);
  assert.ok(ordered.slice(0,CAPACITY).every(x=>x.state==='CONFIRMADO'),
    'vagas iniciais: '+JSON.stringify(ordered));
  assert.ok(ordered.slice(CAPACITY).every(x=>x.state==='EM_FILA'),
    'fila: '+JSON.stringify(ordered));
  console.log('API_CONCURRENCY_E2E_OK',
    'activity='+activity, 'submitted='+PEOPLE, 'capacity='+CAPACITY,
    'confirmed='+states.filter(s=>s==='CONFIRMADO').length,
    'waiting='+states.filter(s=>s==='EM_FILA').length,
    'unique=true fifo=true idempotent=true isolation=true',
    'elapsed_ms='+(Date.now()-began));
}
main().catch(e=>{
  console.error('API_CONCURRENCY_E2E_FAILED',e.message);
  process.exitCode=1;
});
