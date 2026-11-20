export const primaryClassId = 'class-12a1';
export const secondaryClassId = 'class-10a1';

export const roles = {
  admin: 'Quản trị viên',
  teacher: 'Giáo viên',
  assistant: 'Trợ giảng',
  student: 'Học sinh',
  parent: 'Phụ huynh'
};

export function roleActor(role) {
  const staffMemberships = ['teacher', 'assistant'].includes(role);
  const classIds = staffMemberships ? [primaryClassId, secondaryClassId] : [primaryClassId];
  const memberships = staffMemberships || role === 'student'
    ? classIds.map(class_id => ({class_id, member_role: role, permissions: role === 'assistant' ? ['attendance.write'] : []}))
    : [];
  return {
    uid: `audit-${role}`,
    name: `${roles[role]} kiểm thử`,
    status: 'active',
    roles: [role],
    memberships,
    childMemberships: role === 'parent' ? [{class_id: primaryClassId, uid: 'audit-student'}] : []
  };
}
