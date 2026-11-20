'use strict';
const { createHmac, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');
const { AuthError } = require('./auth-error.cjs');

// store.update(uid, callback) must serialize the callback atomically across all
// instances and persist the returned { next, value }. Do not use an in-memory
// store in production. The caller must also enforce per-IP limits and verify
// uid/email against a trusted identity provider before calling this module.
function createOtpService({ store, send, secret, clock = Date.now, generateCode = () => String(randomInt(0, 1000000)).padStart(6, '0'), generateId = () => randomBytes(16).toString('hex') }) {
  if (!store || typeof store.update !== 'function' || typeof send !== 'function' || typeof secret !== 'string' || secret.length < 32) throw new TypeError('OTP configuration missing');
  const emailDigest = (uid, email) => createHmac('sha256', secret).update(JSON.stringify([uid, email.toLowerCase()])).digest('hex');
  const digest = (uid, id, code) => createHmac('sha256', secret).update(JSON.stringify([uid, id, code])).digest('hex');
  function validIdentity(uid, email) {
    return typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  async function issue({ uid, email }) {
    if (!validIdentity(uid, email)) throw new TypeError('Verified identity required');
    const now = clock();
    const code = generateCode();
    const id = generateId();
    if (!Number.isSafeInteger(now) || typeof code !== 'string' || !/^\d{6}$/.test(code) || typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new TypeError('Invalid generator');
    const result = await store.update(uid, previous => {
      if (previous && Number.isSafeInteger(previous.sentAt) && now - previous.sentAt < 60000) return { next: previous, value: Math.max(1, Math.ceil((previous.sentAt + 60000 - now) / 1000)) };
      return { next: { id, emailDigest: emailDigest(uid, email), digest: digest(uid, id, code), sentAt: now, expiresAt: now + 300000, attempts: 0, consumed: false }, value: 0 };
    });
    if (result) throw new AuthError('OTP_COOLDOWN', 'Try again later', 429, result);
    try { await send({ email, code }); }
    catch (_) {
      await store.update(uid, previous => ({ next: previous && previous.id === id ? { ...previous, consumed: true } : previous, value: null }));
      throw new AuthError('OTP_DELIVERY_FAILED', 'Delivery failed', 503, 60);
    }
    return { challengeId: id, expiresAt: now + 300000, resendAt: now + 60000 };
  }
  async function verify({ uid, email, challengeId, code }) {
    if (!validIdentity(uid, email) || typeof challengeId !== 'string' || !/^[a-f0-9]{32}$/.test(challengeId) || typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
    const now = clock();
    if (!Number.isSafeInteger(now)) return false;
    return store.update(uid, previous => {
      if (!previous || previous.id !== challengeId || previous.emailDigest !== emailDigest(uid, email) || previous.consumed || !Number.isSafeInteger(previous.expiresAt) || now >= previous.expiresAt || !Number.isSafeInteger(previous.attempts) || previous.attempts >= 5 || typeof previous.digest !== 'string' || !/^[a-f0-9]{64}$/.test(previous.digest)) return { next: previous, value: false };
      const expected = Buffer.from(previous.digest, 'hex');
      const supplied = Buffer.from(digest(uid, challengeId, code), 'hex');
      const correct = timingSafeEqual(expected, supplied);
      return { next: { ...previous, attempts: previous.attempts + 1, consumed: correct || previous.attempts + 1 >= 5 }, value: correct };
    });
  }
  return { issue, verify };
}
module.exports = { createOtpService };

