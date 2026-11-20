'use strict';
function createFirestorePracticeRepository(db) {
  if (!db || typeof db.collection !== 'function') throw new TypeError('Firestore required');
  const valid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  return {
    async getExam(id) {
      if (!valid(id)) return null;
      const snap = await db.collection('practice_exams').doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async saveAttemptOnce(attempt) {
      if (!attempt || !valid(attempt.attemptId) || !valid(attempt.uid) || !valid(attempt.examId)) throw new TypeError('Invalid attempt');
      // create(), unlike set(), prevents concurrent retries from overwriting results.
      try { await db.collection('practice_attempts').doc(attempt.attemptId).create(attempt); return true; }
      catch (e) { if (e && (e.code === 6 || e.code === 'already-exists')) return false; throw e; }
    },
    async getAttempt(id) {
      if (!valid(id)) return null;
      const snap = await db.collection('practice_attempts').doc(id).get();
      return snap.exists ? snap.data() : null;
    }
  };
}
module.exports = { createFirestorePracticeRepository };
