import test from 'node:test';
import assert from 'node:assert/strict';
import {availableViewRoles, navigationForView, classesForView, tabsForView, directClassForView, classNavigationForView, workspaceForView, viewerForWorkspace} from '../client/role-view.mjs';

const permissions = {notices: true, materials: true, assignments: true, practice: true, attendance: true, messages: true, student: true};
const classes = ['teacher', 'assistant', 'student', 'child', 'other'].map(id => ({id, name: id}));
const mixed = {
  uid: 'self', roles: ['teacher', 'assistant', 'student', 'parent'],
  memberships: [{class_id: 'teacher', member_role: 'teacher'}, {class_id: 'assistant', member_role: 'assistant', permissions: ['attendance.write', 'messages.write']}, {class_id: 'student', member_role: 'student'}],
  childMemberships: [{class_id: 'child', uid: 'kid'}]
};

test('refresh accepts only the current viewer context and applies grants and revocations', () => {
 const me={uid:'self',roles:['assistant'],memberships:[{class_id:'assistant',member_role:'assistant',permissions:[]}],childMemberships:[]};
 const latest={...source('assistant'),viewerContext:{uid:'self',roles:['assistant'],memberships:[{class_id:'assistant',member_role:'assistant',permissions:['notices.write']}],childMemberships:[]}};
 const granted=viewerForWorkspace(me,latest);
 assert.equal(workspaceForView(granted,'assistant',latest).permissions.notices,true);
 latest.viewerContext.memberships=[{class_id:'assistant',member_role:'assistant',permissions:[]}];
 assert.equal(workspaceForView(viewerForWorkspace(granted,latest),'assistant',latest).permissions.notices,false);
 latest.viewerContext={...latest.viewerContext,uid:'another',roles:['admin']};
 assert.equal(viewerForWorkspace(me,latest),me);
 assert.equal(viewerForWorkspace(me,source('assistant')),me);
});
function source(id) {
  return {
    class: {id}, permissions,
    assignments: [{id: 'published', status: 'published'}, {id: 'draft', status: 'draft'}, {id: 'archived', status: 'archived'}],
    exams: [{id: 'e1', status: 'published'}, {id: 'e2', status: 'draft'}],
    notices: [{id: 'n1'}], materials: [{id: 'm1'}],
    attendance: ['self', 'kid', 'other'].map(student_uid => ({student_uid})),
    submissions: ['self', 'kid', 'other'].map(uid => ({uid})),
    attempts: ['self', 'kid', 'other'].map(uid => ({uid})),
    members: [{uid: 'teacher1', member_role: 'teacher'}, {uid: 'other', member_role: 'student'}],
    contacts: [{uid: 'teacher1'}, {uid: 'other'}],
    messages: [{sender_uid: 'self', recipient_uid: 'teacher1'}, {sender_uid: 'teacher1', recipient_uid: 'other'}]
  };
}

test('availableViewRoles returns only the account actual roles without admin role-switching', () => {
  assert.deepEqual(availableViewRoles({roles: ['admin']}), ['admin']);
  assert.deepEqual(availableViewRoles({roles: ['admin', 'teacher']}), ['admin', 'teacher']);
  assert.deepEqual(availableViewRoles({roles: ['student']}), ['student']);
  assert.deepEqual(navigationForView({roles: ['student']}, 'admin'), []);
  assert.deepEqual(navigationForView({roles: ['admin']}, 'student'), []);
});

test('navigation follows selected role and preserves teacher enrollment review without admin tools', () => {
  const me = {...mixed, roles: ['admin', 'teacher']};
  assert.deepEqual(navigationForView(me, 'admin'), ['home', 'classes', 'settings', 'admin']);
  assert.deepEqual(navigationForView(me, 'teacher'), ['home', 'classes', 'settings', 'enrollments']);
  for (const role of ['assistant', 'student', 'parent']) assert.deepEqual(navigationForView(mixed, role), ['home', 'classes', 'settings']);
  assert.deepEqual(navigationForView({roles: ['teacher'], memberships: []}, 'teacher'), ['home', 'classes', 'settings']);
});

test('mixed-role class lists use matching per-class membership and linked children', () => {
  for (const role of ['teacher', 'assistant', 'student']) assert.deepEqual(classesForView(mixed, role, classes).map(c => c.id), [role]);
  assert.deepEqual(classesForView(mixed, 'parent', classes).map(c => c.id), ['child']);
  assert.deepEqual(classesForView(mixed, 'admin', classes), []);
  assert.deepEqual(classesForView({...mixed, roles: ['admin']}, 'admin', classes), classes);
  assert.deepEqual(classesForView({...mixed, roles: ['admin']}, 'assistant', classes), []);
});

test('learner navigation opens directly only for an unambiguous authorized class', () => {
  assert.equal(directClassForView(mixed, 'student', classes)?.id, 'student');
  assert.equal(directClassForView(mixed, 'parent', classes)?.id, 'child');
  assert.equal(directClassForView(mixed, 'teacher', classes), null);
  assert.equal(directClassForView({roles:['student'], memberships:[]}, 'student', classes), null);
  const multiple = {...mixed, childMemberships:[{class_id:'child',uid:'kid1'},{class_id:'other',uid:'kid2'}]};
  assert.equal(directClassForView(multiple, 'parent', classes, {id:'child'}), null);
  const admin = {roles:['admin'], memberships:[], childMemberships:[]};
  assert.equal(directClassForView(admin, 'student', classes), null);
  assert.equal(directClassForView(admin, 'parent', classes), null);
});

test('assistant controls require explicit grants in the current class and backend authorization', () => {
  const view = workspaceForView(mixed, 'assistant', source('assistant'));
  assert.equal(view.permissions.attendance, true);
  assert.equal(view.permissions.messages, true);
  for (const key of ['assignments', 'notices', 'practice', 'materials', 'student']) assert.equal(view.permissions[key], false);
  assert.equal(workspaceForView(mixed, 'teacher', source('assistant')).permissions.attendance, false);
  const revoked = source('assistant'); revoked.permissions = {...permissions, attendance: false};
  assert.equal(workspaceForView(mixed, 'assistant', revoked).permissions.attendance, false);
});

test('student and parent views filter records and drafts even when the account has staff privileges', () => {
  for (const [role, classId, uid] of [['student', 'student', 'self'], ['parent', 'child', 'kid']]) {
    const view = workspaceForView(mixed, role, source(classId));
    assert.deepEqual(view.attendance.map(r => r.student_uid), [uid]);
    for (const key of ['submissions', 'attempts']) assert.deepEqual(view[key].map(r => r.uid), [uid]);
    assert.deepEqual(view.assignments.map(r => r.id), ['published', 'archived']);
    assert.deepEqual(view.members, []);
    assert.deepEqual(view.contacts, [{uid: 'teacher1'}]);
    assert.equal(view.messages.length, 1);
    assert.equal(view.permissions.assignments, false);
    assert.equal(view.permissions.student, role === 'student');
  }
});

test('admin-only account uses admin workspace and cannot preview other roles', () => {
  const me = {uid: 'self', roles: ['admin']}, raw = source('other');
  const snapshot = structuredClone(raw);
  const adminView = workspaceForView(me, 'admin', raw);
  for (const key of ['notices', 'materials', 'assignments', 'practice', 'attendance', 'messages']) assert.equal(adminView.permissions[key], true);
  assert.equal(adminView.attendance.length, 3);
  const denied = {...raw, permissions: {...raw.permissions, notices: false}};
  assert.equal(workspaceForView(me, 'admin', denied).permissions.notices, false, 'server permission remains authoritative');
  for (const role of ['teacher', 'assistant', 'student', 'parent']) {
    const view = workspaceForView(me, role, raw);
    assert.ok(Object.values(view.permissions).every(value => value === false));
    assert.equal(view.previewNotice, undefined);
    for (const key of ['attendance', 'submissions', 'attempts', 'messages']) assert.deepEqual(view[key], []);
  }
  assert.deepEqual(raw, snapshot, 'source data remains unchanged');
});

test('forum replaces private messages and is available to students and classroom staff only', () => {
  assert.deepEqual(tabsForView('parent'), ['notices', 'materials', 'assignments', 'attendance']);
  assert.equal(tabsForView('admin').length, 7);
  assert.ok(tabsForView('admin').includes('operations'));
  assert.ok(tabsForView('admin').includes('forum'));
  for (const role of ['teacher', 'assistant', 'student']) {
    assert.equal(tabsForView(role).length, 6);
    assert.ok(tabsForView(role).includes('forum'));
    assert.ok(!tabsForView(role).includes('operations'));
  }
  const view = workspaceForView(mixed, 'parent', source('child'));
  assert.deepEqual(view.materials, [{id: 'm1'}]);
  assert.deepEqual(workspaceForView(mixed, 'parent', source('other')).materials, []);
  assert.deepEqual(view.exams, []);
});

test('single-role student and parent retain server-provided teacher contacts', () => {
  const raw = source('student'); raw.members = [];
  raw.contacts = [{uid: 'teacher1'}];
  assert.deepEqual(workspaceForView({...mixed, roles: ['student']}, 'student', raw).contacts, raw.contacts);
});


test('class navigation follows the selected role and never exposes a stale or inaccessible class', () => {
  const options = (selectedClass, activeNav = 'classes', hasWorkspace = true) => ({selectedClass, activeNav, hasWorkspace});
  for (const role of ['teacher', 'assistant']) {
    const selected = classes.find(item => item.id === role);
    const nav = classNavigationForView(mixed, role, classes, options(selected));
    assert.equal(nav.class.id, role);
    assert.equal(nav.direct, false);
    assert.deepEqual(nav.tabs, tabsForView(role, selected));
    assert.equal(classNavigationForView(mixed, role, classes, options(classes.at(-1))), null);
    assert.equal(classNavigationForView(mixed, role, classes, options(selected, 'home')), null);
    assert.equal(classNavigationForView(mixed, role, classes, options(selected, 'classes', false)), null);
  }
  const admin = {roles:['admin'], memberships:[], childMemberships:[]};
  assert.equal(classNavigationForView(admin, 'admin', classes, options(classes.at(-1))).class.id, 'other');
  const student = classNavigationForView(mixed, 'student', classes);
  assert.equal(student.class.id, 'student'); assert.equal(student.direct, true);
  const parent = classNavigationForView(mixed, 'parent', classes);
  assert.equal(parent.class.id, 'child'); assert.equal(parent.direct, true);
  assert.deepEqual(parent.tabs, ['notices', 'materials', 'assignments', 'attendance']);
  assert.equal(classNavigationForView(mixed, 'admin', classes, options(classes[0])), null);
});
