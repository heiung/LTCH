const test = require('node:test');
const assert = require('node:assert/strict');
const { createFirestoreOtpStore } = require('../server/integrations/firestore-otp-store.cjs');

test('OTP updates read and write within a transaction', async () => {
  const values = new Map();
  const db = {
    collection(name) { assert.equal(name, '_otp_challenges'); return { doc: id => id }; },
    async runTransaction(fn) { return fn({
      get: async id => ({ exists: values.has(id), data: () => values.get(id) }),
      set: (id, value) => values.set(id, value), delete: id => values.delete(id)
    }); }
  };
  const store = createFirestoreOtpStore(db);
  assert.equal(await store.update('u1', previous => ({ next: { attempts: (previous?.attempts ?? 0) + 1 }, value: true })), true);
  assert.equal(await store.update('u1', previous => ({ next: { attempts: previous.attempts + 1 }, value: previous.attempts })), 1);
  assert.equal(values.get('u1').attempts, 2);
  await store.update('u1', () => ({ next: null, value: null }));
  assert.equal(values.has('u1'), false);
  await assert.rejects(store.update('x/y', () => ({})), TypeError);
});
