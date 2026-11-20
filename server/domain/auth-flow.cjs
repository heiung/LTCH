'use strict';
const { randomBytes, createHash } = require('node:crypto');
const { AuthError } = require('./auth-error.cjs');

// The caller must verify Firebase ID tokens with revocation checking enabled.
// Neither an ID token nor an OTP challenge alone is an application session.
function createAuthFlow({ verifyIdentity, otp, sessions, onVerified = async () => {}, clock = Date.now, random = () => randomBytes(32).toString('base64url'), lifetimeMs = 8 * 60 * 60 * 1000 }) {
  if (typeof verifyIdentity !== 'function' || !otp || typeof otp.issue !== 'function' || typeof otp.verify !== 'function' || !sessions || typeof sessions.create !== 'function' || typeof sessions.get !== 'function' || typeof sessions.delete !== 'function' || !Number.isSafeInteger(lifetimeMs) || lifetimeMs < 60000 || lifetimeMs > 86400000) throw new TypeError('Auth configuration missing');
  const hash = token => createHash('sha256').update(token).digest('hex');
  async function identity(idToken) {
    if (typeof idToken !== 'string' || !idToken || idToken.length > 16384) throw new AuthError('IDENTITY_REQUIRED', 'Authentication required');
    const user = await verifyIdentity(idToken);
    if (!user || typeof user.uid !== 'string' || !user.uid || typeof user.email !== 'string' || !user.email || user.disabled === true) throw new AuthError('IDENTITY_REQUIRED', 'Authentication required');
    return user;
  }
  async function begin(idToken) {
    const user = await identity(idToken);
    return otp.issue({ uid: user.uid, email: user.email });
  }
  async function complete(idToken, challengeId, code) {
    const user = await identity(idToken);
    if (!await otp.verify({ uid: user.uid, email: user.email, challengeId, code })) throw new AuthError('INVALID_OTP', 'Invalid or expired code', 400);
    const token = random();
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid session generator');
    const now = clock();
    if (!Number.isSafeInteger(now)) throw new Error('Invalid clock');
    await onVerified(user);
    await sessions.create(hash(token), { uid: user.uid, createdAt: now, expiresAt: now + lifetimeMs });
    return { token, expiresAt: now + lifetimeMs };
  }
  async function authenticate(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const record = await sessions.get(hash(token));
    const now = clock();
    if (!Number.isSafeInteger(now) || !record || typeof record.uid !== 'string' || !record.uid || !Number.isSafeInteger(record.expiresAt) || now >= record.expiresAt) return null;
    return { uid: record.uid };
  }
  async function logout(token) {
    if (typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)) await sessions.delete(hash(token));
  }
  return { begin, complete, authenticate, logout };
}
module.exports = { createAuthFlow };


