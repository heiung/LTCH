import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCOUNT_TABS,
  shouldShowRoleSwitcher,
  isStaffRoleList,
  shouldShowLinkedParentsCard,
  shouldShowLinkedStudentsCard,
  formatUserInitials,
  validateDisplayName,
  validateContactPhone,
  evaluatePasswordPolicy,
  describeAuthProviders,
  formatAssistantPermissions,
  formatIsoDob,
  normalizeAccountProfile,
  buildSupportMailtoHref,
  buildSupportCopyBundle
} from '../client/account-workspace.mjs';
import { business } from '../worker/business.mjs';

test('formatUserInitials handles multi-space Vietnamese names and single-word names cleanly', () => {
  assert.equal(formatUserInitials('Nguyễn Minh Quân'), 'MQ');
  assert.equal(formatUserInitials('  Trần   Thị   Hạnh  '), 'TH');
  assert.equal(formatUserInitials('Quản trị viên (Admin)'), 'VA');
  assert.equal(formatUserInitials('Hạnh'), 'HẠ');
  assert.equal(formatUserInitials('   '), 'LT');
  assert.equal(formatUserInitials('', 'HS'), 'HS');
});

test('validateDisplayName and validateContactPhone enforce clean validation rules', () => {
  assert.equal(validateDisplayName('   ').valid, false);
  assert.equal(validateDisplayName('a'.repeat(161)).valid, false);
  assert.deepEqual(validateDisplayName('  Cô Hạnh  '), { valid: true, value: 'Cô Hạnh', error: '' });

  assert.deepEqual(validateContactPhone(''), { valid: true, value: '', error: '' });
  assert.deepEqual(validateContactPhone(' 0912 345 678 '), { valid: true, value: '0912 345 678', error: '' });
  assert.equal(validateContactPhone('123').valid, false);
  assert.equal(validateContactPhone('abc-def-ghi').valid, false);
});

test('evaluatePasswordPolicy checks minimum length, confirmation match, current diff, and strength', () => {
  const shortRes = evaluatePasswordPolicy({ password: '123', confirm: '123' });
  assert.equal(shortRes.valid, false);
  assert.equal(shortRes.hasMinLength, false);

  const mismatchRes = evaluatePasswordPolicy({ password: 'Password123', confirm: 'Password999' });
  assert.equal(mismatchRes.valid, false);
  assert.equal(mismatchRes.matchesConfirm, false);

  const sameAsCurrent = evaluatePasswordPolicy({
    password: 'Password123!',
    confirm: 'Password123!',
    current: 'Password123!',
    requiresCurrent: true
  });
  assert.equal(sameAsCurrent.valid, false);

  const okRes = evaluatePasswordPolicy({
    password: 'StrongPassword9!',
    confirm: 'StrongPassword9!',
    current: 'OldPass123!',
    requiresCurrent: true
  });
  assert.equal(okRes.valid, true);
  assert.equal(okRes.strength, 'strong');
});

test('describeAuthProviders distinguishes Google-only, Google+Password, and Password-only accounts', () => {
  const googleOnly = describeAuthProviders([{ providerId: 'google.com' }]);
  assert.equal(googleOnly.mode, 'googleOnly');
  assert.equal(googleOnly.requiresCurrentPassword, false);
  assert.equal(googleOnly.reauthMethod, 'google_popup');

  const both = describeAuthProviders([{ providerId: 'google.com' }, { providerId: 'password' }]);
  assert.equal(both.mode, 'googleAndPassword');
  assert.equal(both.requiresCurrentPassword, false);

  const pwOnly = describeAuthProviders([{ providerId: 'password' }]);
  assert.equal(pwOnly.mode, 'passwordOnly');
  assert.equal(pwOnly.requiresCurrentPassword, true);
  assert.equal(pwOnly.reauthMethod, 'password_credential');
});

test('formatAssistantPermissions, formatIsoDob, shouldShowRoleSwitcher, and normalizeAccountProfile format safely', () => {
  assert.deepEqual(formatAssistantPermissions(['attendance.write', 'practice.manage']), ['Điểm danh', 'Phòng luyện']);
  assert.equal(formatIsoDob('2009-05-14'), '14/05/2009');
  assert.equal(ACCOUNT_TABS.length, 3);
  assert.equal(shouldShowRoleSwitcher(['admin', 'teacher', 'student']), false);
  assert.equal(shouldShowRoleSwitcher(['admin']), false);
  assert.equal(shouldShowRoleSwitcher(['teacher', 'parent']), true);
  assert.equal(shouldShowRoleSwitcher(['student']), false);

  assert.equal(isStaffRoleList(['admin']), true);
  assert.equal(isStaffRoleList(['teacher']), true);
  assert.equal(isStaffRoleList(['assistant']), true);
  assert.equal(isStaffRoleList(['admin', 'student', 'parent']), true);
  assert.equal(isStaffRoleList(['student']), false);
  assert.equal(isStaffRoleList(['parent']), false);
  assert.equal(isStaffRoleList(['student', 'parent']), false);

  assert.equal(shouldShowLinkedParentsCard(['student'], 'student'), true);
  assert.equal(shouldShowLinkedParentsCard(['student', 'parent'], 'student'), true);
  assert.equal(shouldShowLinkedParentsCard(['student', 'parent'], 'parent'), false);
  assert.equal(shouldShowLinkedParentsCard(['parent'], 'parent'), false);
  assert.equal(shouldShowLinkedParentsCard(['admin', 'student'], 'student'), false);
  assert.equal(shouldShowLinkedParentsCard(['teacher', 'student'], 'student'), false);
  assert.equal(shouldShowLinkedParentsCard(['assistant', 'student'], 'student'), false);

  assert.equal(shouldShowLinkedStudentsCard(['parent'], 'parent'), true);
  assert.equal(shouldShowLinkedStudentsCard(['student', 'parent'], 'parent'), true);
  assert.equal(shouldShowLinkedStudentsCard(['student', 'parent'], 'student'), false);
  assert.equal(shouldShowLinkedStudentsCard(['student'], 'student'), false);
  assert.equal(shouldShowLinkedStudentsCard(['admin', 'parent'], 'parent'), false);
  assert.equal(shouldShowLinkedStudentsCard(['teacher', 'parent'], 'parent'), false);
  assert.equal(shouldShowLinkedStudentsCard(['assistant', 'parent'], 'parent'), false);

  const norm = normalizeAccountProfile(
    { display_name: 'Học sinh A', contact_phone: '0901234567', student_code: 'LTCH005' },
    { uid: 'u1', roles: ['student'] },
    'hs@example.test'
  );
  assert.equal(norm.displayName, 'Học sinh A');
  assert.equal(norm.ownStudentCode, 'LTCH005');
  assert.equal(norm.email, 'hs@example.test');
  assert.deepEqual(norm.linkedStudents, []);

  const adminNorm = normalizeAccountProfile(
    { display_name: 'Quản trị', student_code: 'LTCH005' },
    { uid: 'admin-1', roles: ['admin', 'student'] },
    'admin@example.test'
  );
  assert.equal(adminNorm.ownStudentCode, null);
});

test('support mailto and copy bundle encode structured account metadata', () => {
  const href = buildSupportMailtoHref({
    topic: 'data_rights',
    name: 'Nguyễn Văn A',
    email: 'a@example.test',
    studentCode: 'LTCH010',
    uid: 'uid-123',
    roleLabel: 'Học sinh'
  });
  assert.ok(href.startsWith('mailto:admin@example.com?'));
  assert.ok(decodeURIComponent(href).includes('LTCH010'));
  assert.ok(decodeURIComponent(href).includes('uid-123'));

  const bundle = buildSupportCopyBundle({
    name: 'Nguyễn Văn A',
    email: 'a@example.test',
    studentCode: 'LTCH010',
    uid: 'uid-123',
    roleLabels: ['Học sinh'],
    classNames: ['Lớp 12']
  });
  assert.match(bundle, /Họ tên: Nguyễn Văn A/);
  assert.match(bundle, /Mã học sinh: LTCH010/);
  assert.match(bundle, /Lớp học: Lớp 12/);
});

test('account workspace modules obey strict CSP (zero inline styles)', () => {
  const src = readFileSync('client/account-workspace.mjs', 'utf8');
  const appSrc = readFileSync('client/app.js', 'utf8');
  assert.doesNotMatch(src, /style\s*=/i);
  assert.doesNotMatch(src, /\.style\./i);
  assert.doesNotMatch(appSrc.slice(appSrc.indexOf('function authenticatedAvatar')), /style:\s*['"]/);
});

test('/api/profile GET returns enriched profile cleanly and falls back when optional tables miss', async () => {
  const mkDb = ({ failEnrollment = false } = {}) => ({
    from(table) {
      if (table === 'ltch_accounts') {
        return {
          select(cols) {
            return {
              eq(_col, uid) {
                if (cols.includes('created_at')) {
                  return {
                    single: async () => ({
                      data: {
                        display_name: 'Phụ huynh Mẫu',
                        contact_phone: '0987654321',
                        student_code: null,
                        email: 'ph@example.test',
                        status: 'active',
                        roles: ['parent'],
                        created_at: '2026-09-01T00:00:00Z'
                      },
                      error: null
                    })
                  };
                }
                return { single: async () => ({ data: { display_name: 'Phụ huynh Mẫu', contact_phone: '0987654321', student_code: null }, error: null }) };
              },
              in(_col, uids) {
                return {
                  limit: async () => ({
                    data: uids.map(id => ({ uid: id, display_name: 'Con A', student_code: 'LTCH099' })),
                    error: null
                  })
                };
              }
            };
          }
        };
      }
      if (table === 'ltch_enrollment_requests') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => {
                    if (failEnrollment) throw Error('missing table');
                    return { data: null, error: null };
                  }
                };
              }
            };
          }
        };
      }
      return { select() { return { eq() { return { limit: async () => ({ data: [], error: null }) }; } }; } };
    }
  });

  const actor = {
    uid: 'parent-1',
    name: 'Phụ huynh Mẫu',
    email: 'ph@example.test',
    status: 'active',
    roles: ['parent'],
    memberships: [],
    linkedStudentIds: ['student-1'],
    childMemberships: [{ class_id: 'class-12', uid: 'student-1' }]
  };

  const res = await business(new Request('https://example.test/api/profile'), '/api/profile', {
    db: mkDb({ failEnrollment: true }),
    actor,
    env: {}
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.display_name, 'Phụ huynh Mẫu');
  assert.equal(body.student_code, 'LTCH099');
  assert.equal(body.own_student_code, null);
  assert.equal(body.enrollment, null);
  assert.equal(body.linked_students.length, 1);
  assert.deepEqual(body.linked_students[0].class_ids, ['class-12']);
});

test('/api/profile POST validates contact phone and updates account cleanly', async () => {
  let updatedPatch = null;
  const db = {
    from(table) {
      assert.equal(table, 'ltch_accounts');
      return {
        update(patch) {
          updatedPatch = patch;
          return { eq: async () => ({ data: [{ uid: 'u1' }], error: null }) };
        }
      };
    }
  };
  const actor = { uid: 'u1', status: 'active', roles: ['student'], memberships: [] };

  const badPhoneReq = new Request('https://example.test/api/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Minh Quân', phone: '12' })
  });
  await assert.rejects(
    business(badPhoneReq, '/api/profile', { db, actor, env: {} }),
    err => err.status === 400
  );

  const validReq = new Request('https://example.test/api/profile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Minh Quân', phone: '0912 345 678' })
  });
  const okRes = await business(validReq, '/api/profile', { db, actor, env: {} });
  assert.equal(okRes.status, 200);
  assert.deepEqual(updatedPatch, { display_name: 'Minh Quân', contact_phone: '0912 345 678' });
});

test('/api/profile GET omits student/parent links, student codes, and enrollment for staff accounts', async () => {
  const db = {
    from(table) {
      if (table === 'ltch_accounts') {
        return {
          select() {
            return {
              eq() {
                return {
                  single: async () => ({
                    data: {
                      display_name: 'Quản trị viên',
                      contact_phone: '0900000000',
                      student_code: 'LTCH001',
                      email: 'admin@example.com',
                      status: 'active',
                      roles: ['admin', 'teacher', 'student', 'parent'],
                      created_at: '2026-09-01T00:00:00Z'
                    },
                    error: null
                  })
                };
              }
            };
          }
        };
      }
      throw new Error(`Unexpected query on table ${table} for staff profile`);
    }
  };

  const staffActor = {
    uid: 'admin-1',
    name: 'Quản trị viên',
    email: 'admin@example.com',
    status: 'active',
    roles: ['admin', 'teacher', 'student', 'parent'],
    memberships: [],
    linkedStudentIds: ['student-1'],
    childMemberships: [{ class_id: 'class-12', uid: 'student-1' }]
  };

  const res = await business(new Request('https://example.test/api/profile'), '/api/profile', {
    db,
    actor: staffActor,
    env: {}
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.student_code, null);
  assert.equal(body.own_student_code, null);
  assert.equal(body.enrollment, null);
  assert.deepEqual(body.linked_students, []);
  assert.deepEqual(body.linked_parents, []);
});

test('/api/admin/parent-links POST allows only pure active parent and student links while permitting deactivation', async () => {
  const accounts = [
    { uid: 'p-1', status: 'active', roles: ['parent'] },
    { uid: 's-1', status: 'active', roles: ['student'] },
    { uid: 'admin-mix', status: 'active', roles: ['admin', 'parent', 'student'] },
    { uid: 'teacher-mix', status: 'active', roles: ['teacher', 'parent'] }
  ];
  const upserted = [];
  const db = {
    from(table) {
      if (table === 'ltch_accounts') {
        return {
          select() {
            return {
              in(_col, uids) {
                return Promise.resolve({
                  data: accounts.filter(a => uids.includes(a.uid)),
                  error: null
                });
              }
            };
          }
        };
      }
      if (table === 'ltch_parent_links') {
        return {
          upsert(row) {
            upserted.push(row);
            return Promise.resolve({ data: [row], error: null });
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };
  const adminActor = { uid: 'admin-mix', status: 'active', roles: ['admin'], memberships: [] };

  const badAdminLink = new Request('https://example.test/api/admin/parent-links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentUid: 'admin-mix', studentUid: 's-1', status: 'active' })
  });
  await assert.rejects(
    business(badAdminLink, '/api/admin/parent-links', { db, actor: adminActor, env: {} }),
    err => err.status === 400
  );

  const badTeacherLink = new Request('https://example.test/api/admin/parent-links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentUid: 'teacher-mix', studentUid: 's-1', status: 'active' })
  });
  await assert.rejects(
    business(badTeacherLink, '/api/admin/parent-links', { db, actor: adminActor, env: {} }),
    err => err.status === 400
  );

  const goodLink = new Request('https://example.test/api/admin/parent-links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentUid: 'p-1', studentUid: 's-1', status: 'active' })
  });
  const okRes = await business(goodLink, '/api/admin/parent-links', { db, actor: adminActor, env: {} });
  assert.equal(okRes.status, 200);

  const deactivateLegacy = new Request('https://example.test/api/admin/parent-links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentUid: 'teacher-mix', studentUid: 's-1', status: 'inactive' })
  });
  const deactRes = await business(deactivateLegacy, '/api/admin/parent-links', { db, actor: adminActor, env: {} });
  assert.equal(deactRes.status, 200);
  assert.equal(upserted.length, 2);
});
