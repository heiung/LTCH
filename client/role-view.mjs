// Presentation only. Every read/write still uses the account's server authorization.
import { classGrade } from '../shared/classroom.mjs';

export const viewRoles = ['admin', 'teacher', 'assistant', 'student', 'parent'];
const writes = {notices: 'notices.write', materials: 'materials.write', assignments: 'assignments.write', practice: 'practice.manage', attendance: 'attendance.write', messages: 'messages.write', schedule: 'schedule.manage'};
const memberships = me => me.memberships || [];
const children = me => me.childMemberships || [];
const admin = me => me.roles.includes('admin');
const member = (me, role, classId) => memberships(me).filter(m => m.member_role === role && m.class_id === classId);

export function viewerForWorkspace(me, source) {
  const context = source.viewerContext;
  if (!context || context.uid !== me.uid || !Array.isArray(context.roles) || !context.roles.length || !context.roles.every(role => viewRoles.includes(role)) || !Array.isArray(context.memberships) || !Array.isArray(context.childMemberships)) return me;
  return {...me, roles: context.roles, memberships: context.memberships, childMemberships: context.childMemberships};
}

export function availableViewRoles(me) {
  return viewRoles.filter(role => me.roles.includes(role));
}

export function navigationForView(me, role) {
  if (!availableViewRoles(me).includes(role)) return [];
  const pages = ['home', 'classes', 'settings'];
  if (role === 'admin') pages.push('admin');
  if (role === 'teacher' && (admin(me) || memberships(me).some(m => m.member_role === 'teacher'))) pages.push('enrollments');
  return pages;
}

export function classesForView(me, role, classes) {
  if (!availableViewRoles(me).includes(role)) return [];
  // Admin can preview every accessible classroom without becoming another user.
  if (admin(me)) return classes;
  const ids = new Set(role === 'parent' ? children(me).map(m => m.class_id) : memberships(me).filter(m => m.member_role === role).map(m => m.class_id));
  return classes.filter(c => ids.has(c.id) || Boolean(c?.archived && ['teacher', 'assistant'].includes(role) && me.roles.includes(role)));
}

export function tabsForView(role, klass = null) {
  const tabs = ['operations', 'notices', 'materials', 'assignments', 'practice', 'attendance', 'forum'];
  const grade = klass ? classGrade(klass.name) : null;
  const supportsPractice = grade === null || (grade >= 10 && grade <= 12);
  return tabs.filter(tab => {
    if (tab === 'operations' && role !== 'admin') return false;
    if (tab === 'practice' && !supportsPractice) return false;
    if (role === 'parent' && ['practice', 'forum'].includes(tab)) return false;
    return true;
  });
}

// Do not silently choose among multiple real classes.
export function directClassForView(me, role, classes) {
  if (!['student', 'parent'].includes(role)) return null;
  const visible = classesForView(me, role, classes);
  if (visible.length === 1) return visible[0];
  return null;
}

// A staff member can switch classes; learner views retain their existing direct class.
export function classNavigationForView(me, role, classes, {selectedClass = null, activeNav = 'home', hasWorkspace = false} = {}) {
  const direct = directClassForView(me, role, classes);
  const selected = !direct && activeNav === 'classes' && hasWorkspace && selectedClass
    ? classesForView(me, role, classes).find(item => item.id === selectedClass.id) : null;
  const current = direct || selected;
  return current ? {class: current, tabs: tabsForView(role, current), direct: Boolean(direct)} : null;
}

export function workspaceForView(me, role, source) {
  const classId = source.class.id;
  const allowed = availableViewRoles(me).includes(role) && classesForView(me, role, [source.class]).length > 0;
  const staff = allowed && ['admin', 'teacher', 'assistant'].includes(role);
  const own = role === 'student' && allowed && member(me, 'student', classId).length > 0;
  const scope = own ? [me.uid] : role === 'parent' && allowed ? children(me).filter(m => m.class_id === classId).map(m => m.uid) : [];
  const grants = new Set(member(me, 'assistant', classId).flatMap(m => m.permissions || []));
  const permissions = Object.fromEntries(Object.entries(writes).map(([key, action]) => [key, Boolean(allowed && source.permissions?.[key] && (role === 'admin' || role === 'teacher' || role === 'assistant' && grants.has(action)))]));
  permissions.student = Boolean(own && source.permissions?.student);
  if (!staff) permissions.messages = Boolean(allowed && source.permissions?.messages && (own || scope.length));
  const list = key => allowed ? source[key] || [] : [];
  const published = key => list(key).filter(item => staff || ['published', 'archived'].includes(item.status));
  const scoped = (key, uid) => list(key).filter(item => staff || scope.includes(item[uid]));
  const staffIds = new Set((source.members || []).filter(m => ['teacher', 'assistant'].includes(m.member_role)).map(m => m.uid));
  return {
    ...source,
    permissions,
    notices: list('notices').map(item => {
      if (staff || !item || typeof item !== 'object') return item;
      const {read_summary: _omitted, ...rest} = item;
      return rest;
    }),
    materials: tabsForView(role).includes('materials') ? list('materials') : [],
    assignments: published('assignments'),
    exams: tabsForView(role, source.class).includes('practice') ? published('exams') : [],
    attendance: scoped('attendance', 'student_uid'),
    submissions: scoped('submissions', 'uid'),
    attempts: scoped('attempts', 'uid'),
    members: staff ? list('members') : [],
    contacts: list('contacts').filter(c => staff || !staffIds.size || staffIds.has(c.uid)),
    messages: list('messages').filter(m => (staff || own || scope.length) && (m.sender_uid === me.uid || m.recipient_uid === me.uid))
  };
}
