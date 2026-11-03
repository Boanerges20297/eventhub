'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.EVENTHUB_JWT_SECRET='a'.repeat(64);
process.env.EVENTHUB_INTERNAL_SECRET='b'.repeat(64);
const {jwt,verify,csrf,internal}=require('./security');
test('jwt 30 minute session and csrf',()=>{
  const token=jwt({id:'test-user',role:'participant',org_id:null});
  const user=verify(token);
  assert.equal(user.sub,'test-user');
  assert.equal(user.role,'participant');
  assert.equal(user.exp-user.iat,1800);
  assert.equal(typeof csrf(token),'string');
  assert.throws(()=>verify(token.slice(0,-1)+'x'));
});
test('internal access not implied by network',()=>{
  assert.throws(()=>internal({headers:{}}));
  assert.equal(internal({headers:{'x-eventhub-internal-key':'b'.repeat(64)}}),null);
});
