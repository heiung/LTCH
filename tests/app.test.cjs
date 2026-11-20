'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app.cjs');

test('API requires OTP session, rejects cross-origin writes, and checks active account', async () => {
  let active = true; let loggedOut = false;
  const token = 'x'.repeat(43);
  const app = createApp({ allowedOrigin: 'https://example.test', limit: async () => true,
    authFlow: { begin: async id => { if (id !== 'identity') throw Error(); return { challengeId: 'challenge' }; }, complete: async () => ({ token, expiresAt: 123 }), authenticate: async t => t === token && !loggedOut ? { uid: 'u1' } : null, logout: async () => { loggedOut = true; } },
    repository: { actor: async uid => ({ uid, name: 'A', status: active ? 'active' : 'disabled', roles: ['student'], classIds: [] }), classesFor: async () => [] }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/me', { headers: { authorization: 'Bearer identity' } })).status, 401);
    assert.equal((await fetch(base + '/api/auth/complete', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    const complete = await fetch(base + '/api/auth/complete', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(complete.status, 200); assert.match(complete.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
    const headers = { cookie: `__session=${token}` };
    assert.equal((await fetch(base + '/api/me', { headers })).status, 200);
    active = false; assert.equal((await fetch(base + '/api/me', { headers })).status, 403);
    active = true; await fetch(base + '/api/auth/logout', { method: 'POST', headers: { ...headers, origin: 'https://example.test' } });
    assert.equal((await fetch(base + '/api/me', { headers })).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
