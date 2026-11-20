'use strict';
const { createHash } = require('node:crypto');
// Fixed windows are shared across server instances through a Firestore transaction.
// Client address must be derived only from a trusted deployment proxy.
function createRateLimiter(db, clock = Date.now) {
  const policies = { 'otp-begin': { max: 10, window: 900000 }, 'otp-complete': { max: 30, window: 900000 } };
  return async (req, action) => {
    const policy = policies[action];
    const ip = req.ip;
    if (!policy || typeof ip !== 'string' || !ip || ip.length > 128) return false;
    const now = clock();
    if (!Number.isSafeInteger(now)) return false;
    const bucket = Math.floor(now / policy.window);
    const key = createHash('sha256').update(JSON.stringify([action, ip, bucket])).digest('hex');
    const ref = db.collection('_rate_limits').doc(key);
    return db.runTransaction(async tx => {
      const doc = await tx.get(ref); const count = doc.exists ? doc.data().count : 0;
      if (!Number.isSafeInteger(count) || count < 0 || count >= policy.max) return false;
      tx.set(ref, { count: count + 1, purgeAt: new Date((bucket + 2) * policy.window) });
      return true;
    });
  };
}
module.exports = { createRateLimiter };
