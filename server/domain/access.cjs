'use strict';

// These checks are meaningful only on a trusted server using verified session
// and membership records, never data supplied by the browser as authority.
const ROLES = new Set(['admin', 'teacher', 'assistant', 'student', 'parent']);
const ACTIONS = new Set(['class.read', 'attendance.read', 'attendance.write', 'materials.read', 'materials.write', 'assignments.read', 'assignments.write', 'submissions.read', 'submissions.create', 'practice.read', 'practice.manage', 'results.read', 'messages.read', 'messages.write', 'accounts.manage', 'schoolyear.manage']);
const STAFF = new Set(['teacher', 'assistant']);
const STAFF_ACTIONS = new Set(['class.read', 'attendance.read', 'materials.read', 'assignments.read', 'submissions.read', 'practice.read', 'results.read', 'messages.read', 'messages.write']);
const STUDENT_ACTIONS = new Set(['class.read', 'attendance.read', 'materials.read', 'assignments.read', 'submissions.read', 'submissions.create', 'practice.read', 'results.read', 'messages.read', 'messages.write']);
const PARENT_ACTIONS = new Set(['class.read', 'attendance.read', 'assignments.read', 'results.read', 'messages.read', 'messages.write']);

function canAccess(actor, action, context = {}) {
  if (!actor || actor.status !== 'active' || typeof actor.uid !== 'string' || !actor.uid || !Array.isArray(actor.roles) || !actor.roles.every(r => ROLES.has(r)) || !ACTIONS.has(action)) return false;
  // View-as is UI presentation only and must never grant privileges.
  if (actor.roles.includes('admin')) return true;
  if (['accounts.manage', 'schoolyear.manage'].includes(action)) return false;
  const inClass = typeof context.classId === 'string' && Array.isArray(actor.classIds) && actor.classIds.includes(context.classId);
  if (actor.roles.some(r => STAFF.has(r)) && inClass) {
    if (STAFF_ACTIONS.has(action)) return true;
    if (actor.roles.includes('teacher') && ['attendance.write', 'materials.write', 'assignments.write', 'practice.manage'].includes(action)) return true;
    // Assistant write permissions are explicitly granted by an administrator.
    if (actor.roles.includes('assistant') && Array.isArray(actor.permissions) && actor.permissions.includes(action) && ['attendance.write', 'materials.write', 'assignments.write', 'practice.manage'].includes(action)) return true;
  }
  const ownStudent = typeof context.studentId === 'string' && actor.studentId === context.studentId;
  if (actor.roles.includes('student') && inClass && ownStudent && STUDENT_ACTIONS.has(action)) return true;
  const linkedStudent = typeof context.studentId === 'string' && Array.isArray(actor.linkedStudentIds) && actor.linkedStudentIds.includes(context.studentId);
  if (actor.roles.includes('parent') && inClass && linkedStudent && PARENT_ACTIONS.has(action)) return true;
  return false;
}

module.exports = { canAccess };
