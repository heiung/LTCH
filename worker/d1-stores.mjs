// D1 compare-and-swap ensures concurrent OTP attempts cannot both consume a code.
export function createD1OtpStore(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 required');
  return { async update(uid, update) {
    if (typeof uid !== 'string' || !uid || uid.length > 128 || typeof update !== 'function') throw new TypeError('Invalid OTP update');
    for (let tries = 0; tries < 12; tries++) {
      const row = await db.prepare('SELECT version, payload FROM otp_challenges WHERE uid = ?').bind(uid).first();
      const result = update(row ? JSON.parse(row.payload) : null);
      if (!result || !Object.hasOwn(result,'next') || !Object.hasOwn(result,'value')) throw new TypeError('Invalid update');
      if (!row && result.next == null) return result.value;
      let write;
      if (!row) write = await db.prepare('INSERT OR IGNORE INTO otp_challenges (uid, version, payload) VALUES (?, 1, ?)').bind(uid, JSON.stringify(result.next)).run();
      else if (result.next == null) write = await db.prepare('DELETE FROM otp_challenges WHERE uid = ? AND version = ?').bind(uid, row.version).run();
      else write = await db.prepare('UPDATE otp_challenges SET version = version + 1, payload = ? WHERE uid = ? AND version = ?').bind(JSON.stringify(result.next), uid, row.version).run();
      if (write.meta?.changes === 1) return result.value;
    }
    throw new Error('Concurrent update limit');
  } };
}
export function createD1SessionStore(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 required');
  const valid = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
  return {
    async create(id, value) {
      if (!valid(id) || !value || typeof value.uid !== 'string' || !value.uid || value.uid.length > 128 || !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.createdAt) throw new TypeError('Invalid session');
      await db.prepare('INSERT INTO sessions (id, uid, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(id, value.uid, value.createdAt, value.expiresAt).run();
    },
    async get(id) {
      if (!valid(id)) return null;
      const row = await db.prepare('SELECT uid, created_at, expires_at FROM sessions WHERE id = ?').bind(id).first();
      return row ? {uid: row.uid, createdAt: row.created_at, expiresAt: row.expires_at} : null;
    },
    async delete(id) { if (valid(id)) await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run(); }
  };
}
