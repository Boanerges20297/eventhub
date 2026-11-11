'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createLimiter}=require('./rate-limit');

test('independent login, verification and global per-IP limits',()=>{
  const x=createLimiter();
  const now=100000;
  for(let i=0;i<8;i++)assert.equal(x.check('192.0.2.1','/auth/login','POST',now).allowed,true);
  const blocked=x.check('192.0.2.1','/auth/login','POST',now);
  assert.equal(blocked.allowed,false);
  assert.equal(blocked.retryAfter,60);
  assert.equal(x.check('192.0.2.2','/auth/login','POST',now).allowed,true);
  assert.equal(x.check('192.0.2.1','/auth/verify','POST',now).allowed,true);
  assert.equal(x.check('192.0.2.1','/auth/login','POST',now+60001).allowed,true);
});

test('registration is more restricted and GET has global budget',()=>{
  const x=createLimiter();
  for(let i=0;i<4;i++)assert.equal(x.check('2001:db8::1','/auth/register','POST',1).allowed,true);
  assert.equal(x.check('2001:db8::1','/auth/register','POST',1).allowed,false);
  for(let i=0;i<120;i++)assert.equal(x.check('198.51.100.4','/eventos','GET',1).allowed,true);
  assert.equal(x.check('198.51.100.4','/eventos','GET',1).allowed,false);
  assert.equal(x.check('198.51.100.4','/eventos','GET',60002).allowed,true);
});

test('malformed remote address cannot create unlimited IP buckets',()=>{
  const x=createLimiter();
  for(let i=0;i<120;i++)assert.equal(x.check('untrusted-'+i,'/eventos','GET',1000).allowed,true);
  assert.equal(x.check('untrusted-120','/eventos','GET',1000).allowed,false);
});
