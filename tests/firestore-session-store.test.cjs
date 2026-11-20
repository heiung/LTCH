'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFirestoreSessionStore } = require('../server/integrations/firestore-session-store.cjs');
test('sessions use hashed document identifiers and create-only records with a cleanup date', async () => {
  const data = new Map();
  const db = { collection(name) { assert.equal(name, '_sessions'); return { doc(id) { return {
    async create(value) { if (data.has(id)) throw new Error('exists'); data.set(id, value); },
    async get() { return { exists: data.has(id), data: () => data.get(id) }; },
    async delete() { data.delete(id); }
  }; } }; } };
  const sessions = createFirestoreSessionStore(db); const key = 'a'.repeat(64);
  await sessions.create(key, { uid: 'user', createdAt: 1000, expiresAt: 2000 });
  assert.equal((await sessions.get(key)).purgeAt.getTime(), 2000);
  await assert.rejects(sessions.create(key, { uid: 'user', createdAt: 1000, expiresAt: 2000 }));
  await assert.rejects(sessions.get('../session'));
  await sessions.delete(key);
  assert.equal(await sessions.get(key), null);
});
