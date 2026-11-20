'use strict';
function createRepository(db) {
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  return {
    async actor(uid) {
      if (!validId(uid)) return null;
      const doc = await db.collection('accounts').doc(uid).get();
      if (!doc.exists) return null;
      const a = doc.data();
      return { uid, name: a.name, status: a.status, roles: a.roles, classIds: a.classIds, studentId: a.studentId, linkedStudentIds: a.linkedStudentIds, permissions: a.permissions };
    },
    async getClass(id) {
      if (!validId(id)) return null;
      const doc = await db.collection('classes').doc(id).get();
      return doc.exists ? { id: doc.id, name: doc.get('name'), schoolYear: doc.get('schoolYear'), schedule: doc.get('schedule') || '' } : null;
    },
    async classesFor(actor) {
      if (!Array.isArray(actor.roles) || !Array.isArray(actor.classIds)) return [];
      if (actor.roles.includes('admin')) {
        const docs = await db.collection('classes').limit(200).get();
        return docs.docs.map(doc => ({ id: doc.id, name: doc.get('name'), schoolYear: doc.get('schoolYear'), schedule: doc.get('schedule') || '' }));
      }
      const docs = await Promise.all([...new Set(actor.classIds)].slice(0, 100).map(id => this.getClass(id)));
      return docs.filter(Boolean);
    }
  };
}
module.exports = { createRepository };
