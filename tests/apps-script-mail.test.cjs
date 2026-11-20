const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { sendOtpEmail } = require('../server/integrations/apps-script-mail.cjs');
const config = { email: 'student@example.com', code: '012345', endpoint: 'https://script.google.com/macros/s/test-id/exec', secret: 'x'.repeat(32), now: 1800000000000 };
test('signs a bounded request and requires successful delivery', async () => {
  let payload;
  await sendOtpEmail({ ...config, fetchImpl: async (url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ ok: true }) }; } });
  assert.equal(payload.signature, createHmac('sha256', config.secret).update([payload.timestamp, payload.nonce, payload.email, payload.code].join('\n')).digest('hex'));
  assert.match(payload.nonce, /^[a-f0-9]{32}$/);
  await assert.rejects(sendOtpEmail({ ...config, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false }) }) }));
});
test('refuses unsafe endpoints, missing secrets and malformed messages before sending', async () => {
  for (const bad of [{ endpoint: 'https://example.com/macros/s/test/exec' }, { secret: 'short' }, { code: '12' }, { email: 'a@example.com\nInjected' }]) {
    await assert.rejects(sendOtpEmail({ ...config, ...bad, fetchImpl: () => { throw new Error('must not be called'); } }), TypeError);
  }
});
