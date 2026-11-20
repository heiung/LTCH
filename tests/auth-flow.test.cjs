'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthFlow } = require('../server/domain/auth-flow.cjs');
function fixture() {
  const data = new Map(); let now = 1000000; let valid = true;
  const flow = createAuthFlow({ verifyIdentity: async token => token === 'firebase' ? { uid: 'u1', email: 'student@example.com' } : null,
    otp: { issue: async x => ({ identity: x.uid, challengeId: 'challenge' }), verify: async x => valid && x.uid === 'u1' && x.code === '123456' },
    sessions: { create: async (key, value) => data.set(key, value), get: async key => data.get(key), delete: async key => data.delete(key) },
    clock: () => now, random: () => 'a'.repeat(43), lifetimeMs: 60000 });
  return { flow, data, advance: n => { now += n; }, invalidate: () => { valid = false; } };
}
test('identity alone does not authorize, OTP creates a hashed session and logout revokes it', async () => {
  const { flow, data } = fixture();
  assert.equal(await flow.authenticate('firebase'), null);
  assert.equal((await flow.begin('firebase')).identity, 'u1');
  await assert.rejects(flow.complete('firebase', 'challenge', '000000'));
  const session = await flow.complete('firebase', 'challenge', '123456');
  assert.equal(data.has(session.token), false);
  assert.deepEqual(await flow.authenticate(session.token), { uid: 'u1' });
  await flow.logout(session.token);
  assert.equal(await flow.authenticate(session.token), null);
});
test('expired sessions and invalid identities fail closed', async () => {
  const f = fixture();
  await assert.rejects(f.flow.begin('bad'));
  const session = await f.flow.complete('firebase', 'challenge', '123456');
  f.advance(60000);
  assert.equal(await f.flow.authenticate(session.token), null);
});
