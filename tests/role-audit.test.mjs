import assert from 'node:assert/strict';
import test from 'node:test';
import {business} from '../worker/business.mjs';
import {roles, roleActor, primaryClassId} from './fixtures/role-audit.mjs';

const classPath = `/api/classes/${primaryClassId}`;
const learners = ['audit-student', 'audit-unlinked'];

function database() {
  const rows = {
    ltch_classes: [{id: primaryClassId}],
    ltch_assignments: ['published', 'draft'].map(status => ({id: status, class_id: primaryClassId, status})),
    ltch_attendance: learners.map(student_uid => ({student_uid, class_id: primaryClassId})),
    ltch_submissions: learners.map(uid => ({uid, assignment_id: 'published'})),
    ltch_class_memberships: learners.map(uid => ({uid, class_id: primaryClassId, member_role: 'student', status: 'active'})),
    ltch_accounts: Object.keys(roles).map(role => ({uid: `audit-${role}`, status: 'active', roles: [role]})),
  };
  const writes = [];
  return {writes, from(table) {
    let result = [...(rows[table] || [])];
    let single = false;
    const save = row => {
      writes.push({table, row});
      result = [row];
      return query;
    };
    const query = {
      select: () => query,
      order: () => query,
      limit: size => { result = result.slice(0, size); return query; },
      eq: (key, value) => { result = result.filter(row => row[key] === value); return query; },
      in: (key, values) => { result = result.filter(row => values.includes(row[key])); return query; },
      contains: (key, values) => { result = result.filter(row => values.every(value => row[key]?.includes(value))); return query; },
      or: expression => {
        if (table === 'ltch_notices') assert.equal(expression, `scope.eq.all,class_id.eq.${primaryClassId}`);
        else assert.equal(table, 'ltch_messages');
        return query;
      },
      maybeSingle: () => { single = true; return query; },
      insert: save,
      upsert: save,
      then: (resolve, reject) => Promise.resolve({data: single ? result[0] || null : result, error: null}).then(resolve, reject)
    };
    return query;
  }};
}

for (const role of Object.keys(roles)) test(`Role audit API: ${role}`, async () => {
  const actor = roleActor(role);
  const db = database();
  const request = (path, body) => business(new Request(`https://test.invalid${path}`, body && {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)
  }), path, {db, actor, env: {}});
  const expectStatus = async (path, status, body) => {
    if (status === 403) return assert.rejects(request(path, body), error => error.status === 403, path);
    const response = await request(path, body);
    assert.equal(response.status, status, path);
    return response.json();
  };

  const staff = ['admin', 'teacher', 'assistant'].includes(role);
  const canManage = ['admin', 'teacher'].includes(role);
  const workspace = await expectStatus(`${classPath}/workspace`, 200);
  assert.deepEqual(workspace.attendance.map(row => row.student_uid), staff ? learners : ['audit-student']);
  assert.deepEqual(workspace.submissions.map(row => row.uid), staff ? learners : ['audit-student']);
  assert.deepEqual(workspace.assignments.map(row => row.id), staff ? ['published', 'draft'] : ['published']);
  if (role !== 'admin') await expectStatus('/api/classes/audit-unassigned/workspace', 403);
  await expectStatus('/api/admin/accounts', role === 'admin' ? 200 : 403);
  await expectStatus(`${classPath}/notices`, canManage ? 201 : 403, {title: 'Thông báo thử', body: 'Dữ liệu kiểm thử'});
  await expectStatus(`${classPath}/attendance`, staff ? 200 : 403, {date: '2026-09-01', studentUid: 'audit-student', status: 'present'});
  await expectStatus(`${classPath}/questions`, canManage ? 200 : 403);
  await expectStatus(`${classPath}/forum`, role === 'parent' ? 403 : 200);
  assert.deepEqual(db.writes.map(write => write.table), [
    ...(canManage ? ['ltch_notices'] : []),
    ...(staff ? ['ltch_attendance'] : [])
  ]);
});
