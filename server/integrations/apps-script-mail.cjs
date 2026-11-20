'use strict';
const { createHmac, randomBytes } = require('node:crypto');

// Keep secret and endpoint in server-side secret storage, never in browser code.
async function sendOtpEmail({ email, code, endpoint, secret, fetchImpl = globalThis.fetch, now = Date.now() }) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new TypeError('Invalid recipient or OTP');
  if (typeof secret !== 'string' || secret.length < 32 || typeof endpoint !== 'string' || !Number.isSafeInteger(now)) throw new TypeError('Mail configuration missing');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) || url.username || url.password || url.search || url.hash) throw new TypeError('Invalid Apps Script endpoint');
  const nonce = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', secret).update([now, nonce, email, code].join('\n')).digest('hex');
  const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code, nonce, timestamp: now, signature }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('OTP delivery failed');
  let result;
  try { result = await response.json(); } catch { throw new Error('OTP delivery failed'); }
  if (!result || result.ok !== true) throw new Error('OTP delivery failed');
}
module.exports = { sendOtpEmail };
