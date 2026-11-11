'use strict';
const { isIP } = require('node:net');

function createLimiter() {
  const buckets = new Map();
  let operations = 0;
  function check(address, path, method, now = Date.now()) {
    const ip = isIP(address) ? address : 'unresolved';
    const auth = method === 'POST' && /^\/auth\/(login|verify|register)$/.test(path);
    const group = auth ? path : 'global';
    const period = path === '/auth/register' && auth ? 600000 : 60000;
    const limit = auth ? (path === '/auth/register' ? 4 : path === '/auth/login' ? 8 : 10) : 120;
    if (++operations % 300 === 0) {
      for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    }
    const key = ip + ':' + group;
    let slot = buckets.get(key);
    if (!slot || slot.reset <= now) {
      if (buckets.size >= 50000) return { allowed: false, retryAfter: 60 };
      slot = { count: 0, reset: now + period };
      buckets.set(key, slot);
    }
    slot.count++;
    return slot.count > limit
      ? { allowed: false, retryAfter: Math.max(1, Math.ceil((slot.reset - now) / 1000)) }
      : { allowed: true, remaining: limit - slot.count };
  }
  return {check};
}

function install(server) {
  const limiter = createLimiter();
  let inflight = 0;
  server.addHook('onRequest', async (request, reply) => {
    // Caddy overwrites X-Real-IP at the only published ingress.
    const forwarded = String(request.headers['x-real-ip'] || '');
    const address = isIP(forwarded) ? forwarded : request.ip;
    const path = request.url.split('?')[0];
    const result = limiter.check(address, path, request.method);
    reply.header('Cache-Control', 'no-store');
    if (!result.allowed) {
      reply.header('Retry-After', String(result.retryAfter));
      return reply.code(429).send({ error: 'LIMITE_DE_REQUISICOES', retry_after_seconds: result.retryAfter });
    }
    if (inflight >= 100) {
      reply.header('Retry-After', '5');
      return reply.code(503).send({ error: 'SERVICO_OCUPADO' });
    }
    inflight++;
    request.quotaReserved = true;
  });
  server.addHook('onResponse', async request => {
    if (request.quotaReserved) inflight = Math.max(0, inflight - 1);
  });
}
module.exports = { createLimiter, install };
