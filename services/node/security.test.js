'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.EVENTHUB_JWT_SECRET='a'.repeat(64);
process.env.EVENTHUB_INTERNAL_SECRET='b'.repeat(64);
const {jwt,verify,csrf,internal}=require('./security');
test('jwt 30 minute session and csrf',()=>{
  const token=jwt({id:'11111111-1111-4111-8111-111111111111',sid:'22222222-2222-4222-8222-222222222222',auth_version:1,role:'participant',org_id:null});
  const user=verify(token);
  assert.equal(user.sub,'11111111-1111-4111-8111-111111111111');
  assert.equal(user.sid,'22222222-2222-4222-8222-222222222222');
  assert.equal(user.ver,1);
  assert.equal(user.role,'participant');
  assert.equal(user.exp-user.iat,1800);
  assert.equal(typeof csrf(token),'string');
  assert.throws(()=>verify(token.slice(0,-1)+'x'));
});
test('internal access not implied by network',()=>{
  assert.throws(()=>internal({headers:{}}));
  assert.equal(internal({headers:{'x-eventhub-internal-key':'b'.repeat(64)}}),null);
});


test('claims cannot escalate permissions or omit session/version metadata',()=>{
  const crypto=require('node:crypto');
  const token=jwt({id:'11111111-1111-4111-8111-111111111111',
    sid:'22222222-2222-4222-8222-222222222222',
    auth_version:1,role:'participant',org_id:null});
  const parts=token.split('.');
  const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());
  const resign=body=>{
    const unsigned=parts[0]+'.'+Buffer.from(JSON.stringify(body)).toString('base64url');
    return unsigned+'.'+crypto.createHmac('sha256','a'.repeat(64)).update(unsigned).digest('base64url');
  };
  assert.throws(()=>verify(resign({...claims,role:'superadmin'})));
  assert.throws(()=>verify(resign({...claims,sid:null})));
  assert.throws(()=>verify(resign({...claims,ver:0})));
  assert.throws(()=>verify(resign({...claims,iat:null})));
  assert.throws(()=>verify(resign({...claims,iat:claims.iat+3600,exp:claims.exp+3600})));
  assert.throws(()=>verify(resign({...claims,exp:claims.iat-1})));
  assert.throws(()=>verify(resign({...claims,org_id:{id:'evil'}})));
  assert.throws(()=>verify(token.slice(0,-4)+'AAAA'));
});
