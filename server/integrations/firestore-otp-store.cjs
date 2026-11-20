'use strict';

// Use Firebase Admin SDK on a trusted server only. Firestore rules must deny
// all direct client access to this collection. The project must provide TTL or
// a scheduled cleanup separately; OTP verification enforces expiresAt itself.
function createFirestoreOtpStore(db) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') throw new TypeError('Firestore Admin instance required');
  return {
    async update(uid, fn) {
      if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/') || typeof fn !== 'function') throw new TypeError('Invalid OTP update');
      const ref = db.collection('_otp_challenges').doc(uid);
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        const previous = snapshot.exists ? snapshot.data() : null;
        const result = fn(previous);
        if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'next') || !Object.hasOwn(result, 'value')) throw new TypeError('Invalid transaction result');
        if (result.next === null || result.next === undefined) {
          if (snapshot.exists) transaction.delete(ref);
        } else {
          if (typeof result.next !== 'object' || Array.isArray(result.next)) throw new TypeError('Invalid challenge');
          transaction.set(ref, result.next);
        }
        return result.value;
      });
    }
  };
}
module.exports = { createFirestoreOtpStore };
