const test = require('node:test');
const assert = require('node:assert/strict');
const { createOtpService } = require('../server/domain/otp.cjs');
function fixture() {
  const records = new Map(); const delivered = []; let now = 1800000000000;
  const store = { async update(uid, fn) { const result = fn(records.get(uid)); records.set(uid, result.next); return result.value; } };
  const svc = createOtpService({ store, secret: 's'.repeat(32), clock: () => now, generateCode: () => '012345', generateId: () => 'a'.repeat(32), send: async item => delivered.push(item) });
  return { svc, records, delivered, advance: n => { now += n; } };
}
test('OTP is stored as keyed digest and works once', async () => {
  const { svc, records, delivered } = fixture();
  const result = await svc.issue({ uid: 'user1', email: 'a@example.com' });
  assert.equal(delivered[0].code, '012345');
  assert.ok(!JSON.stringify(records.get('user1')).includes('012345'));
  assert.equal(await svc.verify({ uid: 'user1', email: 'a@example.com', challengeId: result.challengeId, code: '012345' }), true);
  assert.equal(await svc.verify({ uid: 'user1', email: 'a@example.com', challengeId: result.challengeId, code: '012345' }), false);
});
test('OTP expires, limits attempts, and throttles repeat sends', async () => {
  const a = fixture(); const item = await a.svc.issue({ uid: 'u', email: 'a@example.com' });
  await assert.rejects(a.svc.issue({ uid: 'u', email: 'a@example.com' }));
  for (let i = 0; i < 5; i++) assert.equal(await a.svc.verify({ uid: 'u', email: 'a@example.com', challengeId: item.challengeId, code: '999999' }), false);
  assert.equal(await a.svc.verify({ uid: 'u', email: 'a@example.com', challengeId: item.challengeId, code: '012345' }), false);
  const b = fixture(); const later = await b.svc.issue({ uid: 'u', email: 'a@example.com' }); b.advance(300000);
  assert.equal(await b.svc.verify({ uid: 'u', email: 'a@example.com', challengeId: later.challengeId, code: '012345' }), false);
});
test('delivery failure invalidates the challenge', async () => {
  const records = new Map();
  const store = { async update(uid, fn) { const r = fn(records.get(uid)); records.set(uid, r.next); return r.value; } };
  const svc = createOtpService({ store, secret: 's'.repeat(32), send: async () => { throw new Error('offline'); }, generateCode: () => '012345', generateId: () => 'a'.repeat(32) });
  await assert.rejects(svc.issue({ uid: 'u', email: 'a@example.com' }));
  assert.equal(await svc.verify({ uid: 'u', email: 'a@example.com', challengeId: 'a'.repeat(32), code: '012345' }), false);
});

test('a challenge cannot be redeemed after an account email changes', async () => {
  const f = fixture(); const challenge = await f.svc.issue({ uid: 'u', email: 'old@example.com' });
  assert.equal(await f.svc.verify({ uid: 'u', email: 'new@example.com', challengeId: challenge.challengeId, code: '012345' }), false);
  assert.equal(await f.svc.verify({ uid: 'u', email: 'old@example.com', challengeId: challenge.challengeId, code: '012345' }), true);
});

test('OTP resend errors include the remaining cooldown without sending another email', async () => {
  const f = fixture();
  const first = await f.svc.issue({uid: 'u', email: 'a@example.com'});
  assert.equal(first.resendAt, 1800000060000);
  f.advance(25000);
  await assert.rejects(f.svc.issue({uid: 'u', email: 'a@example.com'}), error => error.code === 'OTP_COOLDOWN' && error.status === 429 && error.retryAfter === 35);
  assert.equal(f.delivered.length, 1);
});
