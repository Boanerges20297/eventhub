'use strict';
const crypto = require('node:crypto');

const secret = process.env.EVENTHUB_JWT_SECRET || '';
const internalSecret = process.env.EVENTHUB_INTERNAL_SECRET || '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function b64(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function mac(data) { return crypto.createHmac('sha256', secret).update(data).digest('base64url'); }
function jwt(user) {
  if (secret.length < 48) throw new Error('JWT_SECRET_AUSENTE');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    sub: user.id, role: user.role, org_id: user.org_id || null,
    sid: user.sid, ver: user.auth_version,
    iss: 'eventhub-identity', aud: 'eventhub', iat: now, exp: now + 1800
  });
  const unsigned = header + '.' + payload;
  return unsigned + '.' + mac(unsigned);
}
function verify(token) {
  if (typeof token !== 'string' || token.length > 4096 || !token || secret.length < 48) throw new Error('NAO_AUTENTICADO');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWT_INVALIDO');
  let header, body;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    body = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch { throw new Error('JWT_INVALIDO'); }
  if (!header || typeof header !== 'object' || header.alg !== 'HS256' || header.typ !== 'JWT' ||
      !body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JWT_INVALIDO');
  const expected = Buffer.from(mac(parts[0] + '.' + parts[1]));
  const supplied = Buffer.from(parts[2]);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error('JWT_INVALIDO');
  }
  const now = Math.floor(Date.now() / 1000);
  if (body.iss !== 'eventhub-identity' || body.aud !== 'eventhub'
      || typeof body.sub !== 'string' || !UUID.test(body.sub)
      || typeof body.sid !== 'string' || !UUID.test(body.sid)
      || !Number.isInteger(body.ver) || body.ver < 1
      || !['participant', 'organizer', 'admin'].includes(body.role)
      || !(body.org_id === null || (typeof body.org_id === 'string' && body.org_id.length <= 64))
      || !Number.isInteger(body.iat) || body.iat > now + 30 || body.iat < now - 1800
      || !Number.isInteger(body.exp) || body.exp <= now
      || body.exp - body.iat <= 0 || body.exp - body.iat > 1800) throw new Error('JWT_EXPIRADO_OU_INVALIDO');
  return body;
}
function csrf(token) { return mac('csrf:' + token); }
function same(a,b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left,right);
}
function internal(request) {
  if (internalSecret.length < 48 || !same(request.headers['x-eventhub-internal-key'], internalSecret)) {
    throw new Error('SERVICO_NAO_AUTORIZADO');
  }
  const encoded = String(request.headers['x-eventhub-auth'] || '');
  if (encoded.length > 2500) throw new Error('CONTEXTO_INVALIDO');
  if (!encoded) return null;
  try {
    const p = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (!p.sub || !['participant','organizer','admin'].includes(p.role)) throw new Error();
    return p;
  } catch { throw new Error('CONTEXTO_INVALIDO'); }
}
function asHeaders(principal) {
  return {
    'x-eventhub-internal-key': internalSecret,
    'x-eventhub-auth': principal ? Buffer.from(JSON.stringify(principal)).toString('base64url') : ''
  };
}
module.exports = {jwt,verify,csrf,same,internal,asHeaders};
