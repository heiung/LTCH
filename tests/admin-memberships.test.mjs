import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_PERMISSION_CHOICES,
  normalizeMemberships,
  groupStudentsForAdmin,
  groupStaffForAdmin,
  groupMembershipsByClass,
  groupParentLinks,
  summarizeAccountAssignments
} from '../client/admin-memberships.mjs';

const roleLabels = {
  admin: 'Quản trị viên',
  teacher: 'Giáo viên',
  assistant: 'Trợ giảng',
  student: 'Học sinh',
  parent: 'Phụ huynh'
};

const allPermissions = ASSISTANT_PERMISSION_CHOICES.map(p => p.key);

const activeClasses = [
  { id: 'c-6', name: '6', schedule: 'T3, T5' },
  { id: 'c-7', name: '7', schedule: 'T3, T5' },
  { id: 'c-8a', name: '8A', schedule: 'T2, T6' },
  { id: 'c-8b', name: '8B', schedule: 'T3, T7' },
  { id: 'c-9a', name: '9A', schedule: 'T2, T6' },
  { id: 'c-9b', name: '9B', schedule: 'T4, CN' },
  { id: 'c-10a', name: '10A', schedule: 'T2, T5' },
  { id: 'c-10b', name: '10B', schedule: 'T3, T6' },
  { id: 'c-11', name: '11', schedule: 'T2, T5' },
  { id: 'c-12a', name: '12A', schedule: 'T4, T7' },
  { id: 'c-12b', name: '12B', schedule: 'T4, T7' }
];

const archivedClasses = [
  { id: 'arch-2025-12', name: '12 (Khóa 2025)', archived: true }
];

const users = [
  { uid: 'u-admin', display_name: 'Quản trị viên', email: 'admin@ltch.test', status: 'active', roles: ['admin', 'assistant'] },
  { uid: 'u-dual-teacher', display_name: 'Trần Minh Đức', email: 'dual-staff@ltch.test', status: 'active', roles: ['teacher', 'assistant'] },
  { uid: 'u-asst-full', display_name: 'Trợ giảng An', email: 'an@ltch.test', status: 'active', roles: ['assistant'] },
  { uid: 'u-asst-custom', display_name: 'Trợ giảng Bình', email: 'binh@ltch.test', status: 'active', roles: ['assistant'] },
  { uid: 'u-disabled-staff', display_name: 'Nhân sự đã khóa', email: 'locked@ltch.test', status: 'disabled', roles: ['assistant'] },
  { uid: 'u-stu-1', display_name: 'Nguyễn Minh Quân', email: 'quan@ltch.test', status: 'active', roles: ['student'], student_code: '2026001' },
  { uid: 'u-stu-2', display_name: 'Trần Bảo An', email: 'baoan@ltch.test', status: 'active', roles: ['student'], student_code: '2026002' },
  { uid: 'u-stu-removed-role', display_name: 'Học sinh gỡ quyền', email: 'removed@ltch.test', status: 'active', roles: [] },
  { uid: 'u-parent-1', display_name: 'Nguyễn Văn Hùng', email: 'hung@ltch.test', status: 'active', roles: ['parent'] }
];

const memberships = [
  ...activeClasses.map(c => ({ class_id: c.id, uid: 'u-admin', member_role: 'assistant', status: 'active', permissions: allPermissions })),
  ...activeClasses.map(c => ({ class_id: c.id, uid: 'u-dual-teacher', member_role: 'teacher', status: 'active', permissions: [] })),
  ...activeClasses.map(c => ({ class_id: c.id, uid: 'u-dual-teacher', member_role: 'assistant', status: 'active', permissions: allPermissions })),
  ...activeClasses.map(c => ({ class_id: c.id, uid: 'u-asst-full', member_role: 'assistant', status: 'active', permissions: allPermissions })),
  ...activeClasses.map(c => ({
    class_id: c.id,
    uid: 'u-asst-custom',
    member_role: 'assistant',
    status: 'active',
    permissions: c.id === 'c-12a' ? ['attendance.write', 'materials.write'] : allPermissions
  })),
  { class_id: 'c-12a', uid: 'u-disabled-staff', member_role: 'assistant', status: 'active', permissions: allPermissions },
  { class_id: 'arch-2025-12', uid: 'u-dual-teacher', member_role: 'teacher', status: 'active', permissions: [] },
  { class_id: 'unknown-old-uuid-123456', uid: 'u-stu-2', member_role: 'student', status: 'inactive', permissions: [] },
  { class_id: 'c-12a', uid: 'u-stu-1', member_role: 'student', status: 'active', permissions: [] },
  { class_id: 'c-12a', uid: 'u-stu-2', member_role: 'student', status: 'active', permissions: [] },
  { class_id: 'c-12a', uid: 'u-stu-removed-role', member_role: 'student', status: 'active', permissions: [] }
];

test('groupStaffForAdmin enforces effective role hierarchy, suppresses misleading assistant controls on teachers, and ignores disabled accounts', () => {
  const normalized = normalizeMemberships({ memberships, users, activeClasses, archivedClasses, roleLabels });
  const staff = groupStaffForAdmin({ normalized, users, activeClasses });

  assert.equal(staff.entries.length, 4);
  assert.equal(staff.entries.some(e => e.uid === 'u-disabled-staff'), false);

  const adminEntry = staff.entries.find(e => e.uid === 'u-admin');
  assert.equal(adminEntry.effectiveRole, 'admin');
  assert.equal(adminEntry.canEditAssistantGrants, false);
  assert.equal(adminEntry.hasRedundantAssistantRole, false);

  const dualTeacher = staff.entries.find(e => e.uid === 'u-dual-teacher');
  assert.equal(dualTeacher.effectiveRole, 'teacher');
  assert.equal(dualTeacher.effectiveRoleLabel, 'Giáo viên');
  assert.equal(dualTeacher.hasRedundantAssistantRole, true);
  assert.equal(dualTeacher.canEditAssistantGrants, false);

  const asstFull = staff.entries.find(e => e.uid === 'u-asst-full');
  assert.equal(asstFull.effectiveRole, 'assistant');
  assert.equal(asstFull.canEditAssistantGrants, true);
  assert.equal(asstFull.assistantGrantSummary.kind, 'full_uniform');

  const asstCustom = staff.entries.find(e => e.uid === 'u-asst-custom');
  assert.equal(asstCustom.assistantGrantSummary.kind, 'custom_per_class');
  assert.equal(asstCustom.assistantGrantSummary.customItems.length, 1);
  assert.equal(asstCustom.assistantGrantSummary.customItems[0].className, '12A');
  assert.equal(asstCustom.assistantGrantSummary.customItems[0].count, 2);
});

test('groupStudentsForAdmin and groupMembershipsByClass filter invalid roles, archived/inactive rows, and sort Vietnamese names', () => {
  const normalized = normalizeMemberships({ memberships, users, activeClasses, archivedClasses, roleLabels });

  const activeStudents = groupStudentsForAdmin({ normalized, statusFilter: 'active' });
  assert.deepEqual(activeStudents.entries.map(e => e.uid), ['u-stu-2', 'u-stu-1']);

  const inactiveStudents = groupStudentsForAdmin({ normalized, statusFilter: 'inactive' });
  assert.equal(inactiveStudents.entries.length, 1);
  assert.equal(inactiveStudents.entries[0].uid, 'u-stu-2');
  assert.match(inactiveStudents.entries[0].inactiveClasses[0].className, /^Lớp lưu trữ \(123456\)$/);

  const byClass = groupMembershipsByClass({ normalized, activeClasses, archivedClasses });
  assert.equal(byClass.classGroups.length, 11);
  const class12a = byClass.classGroups.find(g => g.classItem.id === 'c-12a');
  assert.deepEqual(class12a.students.map(s => s.uid), ['u-stu-2', 'u-stu-1']);
});

test('groupParentLinks groups multiple children under one parent and summarizeAccountAssignments formats cleanly', () => {
  const normalized = normalizeMemberships({ memberships, users, activeClasses, archivedClasses, roleLabels });
  const links = [
    { parent_uid: 'u-parent-1', student_uid: 'u-stu-1', status: 'active' },
    { parent_uid: 'u-parent-1', student_uid: 'u-stu-2', status: 'active' },
    { parent_uid: 'u-parent-1', student_uid: 'u-stu-1', status: 'inactive' }
  ];
  const parentGroups = groupParentLinks({ links, users, normalizedMemberships: normalized, statusFilter: 'active' });
  assert.equal(parentGroups.length, 1);
  assert.equal(parentGroups[0].children.length, 2);
  assert.deepEqual(parentGroups[0].children[0].classNames, ['12A']);

  const staff = groupStaffForAdmin({ normalized, users, activeClasses });
  const students = groupStudentsForAdmin({ normalized, statusFilter: 'active' });
  const staffByUid = new Map(staff.entries.map(e => [e.uid, e]));
  const studentByUid = new Map(students.entries.map(e => [e.uid, e]));
  const parentByUid = new Map(parentGroups.map(g => [g.parentUid, g]));

  assert.equal(
    summarizeAccountAssignments('u-dual-teacher', { staffByUid, studentByUid, parentGroupByUid: parentByUid, activeClassesCount: 11 }),
    'Giảng dạy tất cả 11 lớp đang mở'
  );
  assert.equal(
    summarizeAccountAssignments('u-parent-1', { staffByUid, studentByUid, parentGroupByUid: parentByUid, activeClassesCount: 11 }),
    'Phụ huynh của: Trần Bảo An, Nguyễn Minh Quân'
  );
});
