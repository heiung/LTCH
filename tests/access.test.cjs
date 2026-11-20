const test = require('node:test');
const assert = require('node:assert/strict');
const { canAccess } = require('../server/domain/access.cjs');
const actor = (roles, extra = {}) => ({ uid: 'u1', status: 'active', roles, classIds: ['class-a'], ...extra });

test('admin has all defined actions but an inactive admin has none', () => {
  assert.equal(canAccess(actor(['admin']), 'accounts.manage'), true);
  assert.equal(canAccess(actor(['admin']), 'tuition.manage'), false);
  assert.equal(canAccess(actor(['admin'], { status: 'blocked' }), 'accounts.manage'), false);
  assert.equal(canAccess(actor(['admin']), 'invented.action'), false);
});
test('teacher actions are restricted to assigned classes', () => {
  assert.equal(canAccess(actor(['teacher']), 'attendance.write', { classId: 'class-a' }), true);
  assert.equal(canAccess(actor(['teacher']), 'attendance.write', { classId: 'class-b' }), false);
  assert.equal(canAccess(actor(['teacher']), 'tuition.manage'), false);
});
test('assistants need explicit permission for modifications', () => {
  assert.equal(canAccess(actor(['assistant']), 'attendance.write', { classId: 'class-a' }), false);
  assert.equal(canAccess(actor(['assistant'], { permissions: ['attendance.write'] }), 'attendance.write', { classId: 'class-a' }), true);
  assert.equal(canAccess(actor(['assistant'], { permissions: ['accounts.manage'] }), 'accounts.manage', { classId: 'class-a' }), false);
});
test('students and parents can access only their own linked student in an assigned class', () => {
  assert.equal(canAccess(actor(['student'], { studentId: 's1' }), 'results.read', { studentId: 's1', classId: 'class-a' }), true);
  assert.equal(canAccess(actor(['student'], { studentId: 's1' }), 'results.read', { studentId: 's2', classId: 'class-a' }), false);
  assert.equal(canAccess(actor(['parent'], { linkedStudentIds: ['s1'] }), 'results.read', { studentId: 's1', classId: 'class-a' }), true);
  assert.equal(canAccess(actor(['parent'], { linkedStudentIds: ['s1'] }), 'results.read', { studentId: 's2', classId: 'class-a' }), false);
  assert.equal(canAccess(actor(['parent'], { linkedStudentIds: ['s1'] }), 'submissions.create', { studentId: 's1', classId: 'class-a' }), false);
});
