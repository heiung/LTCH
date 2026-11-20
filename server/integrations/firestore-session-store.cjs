'use strict';

// Firestore is accessed only by the trusted server. Direct client access must
// remain denied. Configure a Firestore TTL policy on purgeAt before operation;
// expiration is also enforced by the auth flow regardless of TTL cleanup.
function createFirestoreSessionStore(db) {
  if (!db || typeof db.collection !== 'function') throw new TypeError('Firestore Admin instance required');
  const collection = db.collection('_sessions');
  function ref(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new TypeError('Invalid session identifier');
    return collection.doc(id);
  }
  return {
    async create(id, record) {
      if (!record || typeof record.uid !== 'string' || !record.uid || record.uid.length > 128 || !Number.isSafeInteger(record.createdAt) || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.createdAt) throw new TypeError('Invalid session record');
      await ref(id).create({ uid: record.uid, createdAt: record.createdAt, expiresAt: record.expiresAt, purgeAt: new Date(record.expiresAt) });
    },
    async get(id) {
      const snapshot = await ref(id).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async delete(id) { await ref(id).delete(); }
  };
}
module.exports = { createFirestoreSessionStore };
