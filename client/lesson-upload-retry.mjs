// Only a digest and a random request ID are kept in this tab, never file bytes.
const prefix = 'ltch.lesson-upload.v1.';
const lifetime = 24 * 60 * 60 * 1000;
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');

export function createLessonUploadRetry({storage = () => globalThis.sessionStorage, clock = Date.now, crypt = globalThis.crypto} = {}) {
  const memory = new Map();
  return {
    async prepare({uid, classId, lessonId, file, fingerprint}) {
      const fileHash = typeof fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(fingerprint)
        ? fingerprint.toLowerCase()
        : hex(await crypt.subtle.digest('SHA-256', await (file.size > 10_000_000 ? file.slice(0, 2 * 1024 * 1024) : file).arrayBuffer()));
      const identity = JSON.stringify([uid, classId, lessonId, file.name, file.type, file.size, fileHash]);
      const key = prefix + hex(await crypt.subtle.digest('SHA-256', new TextEncoder().encode(identity)));
      let saved = memory.get(key), persisted = false;
      try {saved = JSON.parse(storage().getItem(key)) || saved;} catch {}
      const now = clock();
      if (!saved || typeof saved.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(saved.requestId) || !Number.isSafeInteger(saved.expiresAt) || saved.expiresAt <= now || saved.expiresAt > now + lifetime) {
        saved = {requestId: crypt.randomUUID(), expiresAt: now + lifetime};
      }
      memory.set(key, saved);
      try {storage().setItem(key, JSON.stringify(saved)); persisted = true;} catch {}
      return {key, requestId: saved.requestId, persisted};
    },
    complete(key) {
      memory.delete(key);
      try {storage().removeItem(key);} catch {}
    }
  };
}
