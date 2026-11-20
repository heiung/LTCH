'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../server/integrations/firestore-rate-limit.cjs');
test('IP limits are shared in storage, expire by window and fail closed on missing IP', async () => {
  const records = new Map(); let now = 1800000000000;
  const db = { collection() { return { doc: id => id }; }, async runTransaction(fn) { return fn({ get: async id => ({ exists: records.has(id), data: () => records.get(id) }), set: (id, value) => records.set(id, value) }); } };
  const limit = createRateLimiter(db, () => now); const req = { ip: '127.0.0.1' };
  for (let i = 0; i < 10; i++) assert.equal(await limit(req, 'otp-begin'), true);
  assert.equal(await limit(req, 'otp-begin'), false);
  assert.equal(await limit({}, 'otp-begin'), false);
  assert.equal(await limit(req, 'unknown'), false);
  now += 900000; assert.equal(await limit(req, 'otp-begin'), true);
  assert.ok([...records.values()].every(record => record.purgeAt instanceof Date));
});
