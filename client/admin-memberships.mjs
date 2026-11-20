import { sortClasses } from '../shared/classroom.mjs';
import { normalizeSearchText, sortStudentsRoster } from './attendance-workspace.mjs';

export const ASSISTANT_PERMISSION_CHOICES = [
  { key: 'schedule.manage', label: 'Chỉnh lịch học' },
  { key: 'attendance.write', label: 'Ghi điểm danh' },
  { key: 'materials.write', label: 'Thêm tài liệu bài giảng' },
  { key: 'assignments.write', label: 'Giao bài và nhận xét bài nộp' },
  { key: 'practice.manage', label: 'Quản lý câu hỏi & đề thi' },
  { key: 'notices.write', label: 'Đăng thông báo lớp' },
  { key: 'messages.write', label: 'Trao đổi & Diễn đàn lớp' }
];

const VALID_PERMISSION_KEYS = ASSISTANT_PERMISSION_CHOICES.map(item => item.key);
const TOTAL_ASSISTANT_PERMISSIONS = ASSISTANT_PERMISSION_CHOICES.length;

function shortArchivedClassLabel(classId) {
  const raw = String(classId || '');
  const tail = raw.length > 10 ? raw.slice(-6) : raw;
  return `Lớp lưu trữ (${tail})`;
}

function canonicalPermissions(permissions) {
  const list = Array.isArray(permissions) ? permissions : [];
  return VALID_PERMISSION_KEYS.filter(key => list.includes(key));
}

function summarizeAssistantGrants(assistantItems) {
  if (!assistantItems.length) {
    return {
      kind: 'full_uniform',
      label: `Đầy đủ ${TOTAL_ASSISTANT_PERMISSIONS}/${TOTAL_ASSISTANT_PERMISSIONS} quyền`,
      tone: 'badge-success',
      count: TOTAL_ASSISTANT_PERMISSIONS,
      customItems: []
    };
  }

  const groups = new Map();
  for (const item of assistantItems) {
    const signature = item.permissions.join('|');
    const bucket = groups.get(signature) || { signature, count: item.permissions.length, items: [] };
    bucket.items.push(item);
    groups.set(signature, bucket);
  }

  if (groups.size === 1) {
    const only = [...groups.values()][0];
    if (only.count === TOTAL_ASSISTANT_PERMISSIONS) {
      return {
        kind: 'full_uniform',
        label: `Đầy đủ ${TOTAL_ASSISTANT_PERMISSIONS}/${TOTAL_ASSISTANT_PERMISSIONS} quyền`,
        tone: 'badge-success',
        count: only.count,
        customItems: []
      };
    }
    return {
      kind: 'same_subset',
      label: `Đồng nhất ${only.count}/${TOTAL_ASSISTANT_PERMISSIONS} quyền`,
      tone: only.count === 0 ? 'badge-warning' : 'badge-info',
      count: only.count,
      customItems: []
    };
  }

  const buckets = [...groups.values()].sort(
    (a, b) => (b.items.length - a.items.length) || (b.count - a.count)
  );
  const majority = buckets[0];
  const customItems = assistantItems
    .filter(item => item.permissions.join('|') !== majority.signature)
    .map(item => ({
      classId: item.class_id,
      className: item.className,
      count: item.permissions.length,
      permissions: item.permissions,
      membership: item
    }));

  return {
    kind: 'custom_per_class',
    label: `Tùy chỉnh riêng ${customItems.length} lớp`,
    tone: 'badge-warning',
    majorityCount: majority.count,
    customItems
  };
}

/**
 * Chuẩn hóa, khử trùng lặp và kiểm tra hiệu lực tài khoản cho từng bản ghi phân công.
 */
export function normalizeMemberships({
  memberships = [],
  users = [],
  activeClasses = [],
  archivedClasses = [],
  roleLabels = {}
} = {}) {
  const sortedActive = sortClasses(activeClasses || []);
  const sortedArchived = sortClasses(archivedClasses || []);
  const activeMap = new Map(sortedActive.map((cls, index) => [cls.id, { cls, index }]));
  const archivedMap = new Map(sortedArchived.map((cls, index) => [cls.id, { cls, index }]));
  const userMap = new Map((users || []).map(user => [user.uid, user]));

  const deduped = new Map();
  for (const raw of memberships || []) {
    if (!raw || !raw.class_id || !raw.uid || !raw.member_role) continue;
    const key = `${raw.class_id}::${raw.uid}::${raw.member_role}`;
    const existing = deduped.get(key);
    const nextStatus = raw.status === 'inactive' ? 'inactive' : 'active';
    if (existing && existing.status === 'active' && nextStatus !== 'active') continue;
    deduped.set(key, {
      ...raw,
      status: nextStatus,
      permissions: canonicalPermissions(raw.permissions)
    });
  }

  const normalized = [];
  for (const item of deduped.values()) {
    const activeInfo = activeMap.get(item.class_id);
    const archivedInfo = archivedMap.get(item.class_id);
    const classRecord = activeInfo?.cls || archivedInfo?.cls || null;
    const isArchivedClass = !activeInfo;
    const className = classRecord?.name || shortArchivedClassLabel(item.class_id);
    const classOrder = activeInfo
      ? activeInfo.index
      : (archivedInfo ? sortedActive.length + archivedInfo.index : sortedActive.length + sortedArchived.length + 1000);

    const user = userMap.get(item.uid) || null;
    const accountRoles = Array.isArray(user?.roles) ? user.roles : [];
    const accountStatus = user?.status || 'pending';
    const isAccountRoleValid = accountStatus === 'active' && accountRoles.includes(item.member_role);
    const isEffectiveActive = item.status === 'active' && !isArchivedClass && isAccountRoleValid;

    normalized.push({
      ...item,
      className,
      classOrder,
      isArchivedClass,
      displayName: user?.display_name || item.uid,
      email: user?.email || '',
      studentCode: user?.student_code || '',
      accountRoles,
      accountStatus,
      isAccountRoleValid,
      isEffectiveActive,
      roleLabel: roleLabels[item.member_role] || item.member_role,
      statusLabel: item.status === 'inactive' ? 'Đã nghỉ' : 'Đang học'
    });
  }

  return normalized.sort((a, b) => (a.classOrder - b.classOrder) || a.className.localeCompare(b.className, 'vi'));
}

/**
 * Gom nhóm dữ liệu Đội ngũ giảng dạy theo vai trò hiệu lực cao nhất (Admin > Giáo viên > Trợ giảng).
 */
export function groupStaffForAdmin({
  normalized = [],
  users = [],
  activeClasses = [],
  searchQuery = ''
} = {}) {
  const openClasses = sortClasses(activeClasses || []);
  const openClassCount = openClasses.length;
  const query = normalizeSearchText(searchQuery);

  const assistantOpenByUid = new Map();
  for (const item of normalized || []) {
    if (item.member_role === 'assistant' && !item.isArchivedClass && item.status === 'active') {
      const list = assistantOpenByUid.get(item.uid) || [];
      list.push(item);
      assistantOpenByUid.set(item.uid, list);
    }
  }

  const entries = [];
  for (const user of users || []) {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    if (user?.status !== 'active') continue;
    const isAdminAccount = roles.includes('admin');
    const isTeacherAccount = !isAdminAccount && roles.includes('teacher');
    const isAssistantAccount = !isAdminAccount && !isTeacherAccount && roles.includes('assistant');
    if (!isAdminAccount && !isTeacherAccount && !isAssistantAccount) continue;

    let effectiveRole = 'assistant';
    let effectiveRoleLabel = 'Trợ giảng';
    let roleBadgeTone = 'badge-mint';
    let hasRedundantAssistantRole = false;
    let canEditAssistantGrants = false;
    let scopeSummary = '';
    let authorityLabel = '';
    let authorityTone = 'badge-info';
    let assistantItems = [];
    let assistantGrantSummary = null;
    let primaryAssistantMembership = null;

    if (isAdminAccount) {
      effectiveRole = 'admin';
      effectiveRoleLabel = 'Quản trị viên';
      roleBadgeTone = 'badge-primary';
      scopeSummary = openClassCount ? `Tất cả ${openClassCount} lớp đang mở` : 'Toàn hệ thống';
      authorityLabel = 'Toàn quyền hệ thống';
      authorityTone = 'badge-info';
    } else if (isTeacherAccount) {
      effectiveRole = 'teacher';
      effectiveRoleLabel = 'Giáo viên';
      roleBadgeTone = 'badge-info';
      hasRedundantAssistantRole = roles.includes('assistant');
      scopeSummary = openClassCount ? `Tất cả ${openClassCount} lớp đang mở` : 'Toàn hệ thống';
      authorityLabel = 'Toàn quyền giảng dạy';
      authorityTone = 'badge-success';
    } else {
      effectiveRole = 'assistant';
      effectiveRoleLabel = 'Trợ giảng';
      roleBadgeTone = 'badge-mint';
      canEditAssistantGrants = openClassCount > 0;
      assistantItems = assistantOpenByUid.get(user.uid) || [];
      if (!assistantItems.length && openClasses.length) {
        assistantItems = [{
          class_id: openClasses[0].id,
          className: openClasses[0].name,
          uid: user.uid,
          member_role: 'assistant',
          status: 'active',
          permissions: VALID_PERMISSION_KEYS
        }];
      }
      assistantGrantSummary = summarizeAssistantGrants(assistantItems);
      primaryAssistantMembership = assistantItems[0] || null;
      scopeSummary = openClassCount ? `Tất cả ${openClassCount} lớp đang mở` : 'Chưa có lớp đang mở';
    }

    const searchBlob = normalizeSearchText(
      [
        user.display_name,
        user.email,
        user.uid,
        effectiveRoleLabel,
        hasRedundantAssistantRole ? 'tro giang kiem nhiem' : '',
        scopeSummary,
        authorityLabel,
        assistantGrantSummary?.label || ''
      ].join(' ')
    );
    if (query && !searchBlob.includes(query)) continue;

    entries.push({
      uid: user.uid,
      name: user.display_name || user.uid,
      displayName: user.display_name || user.uid,
      email: user.email || '',
      roles,
      effectiveRole,
      effectiveRoleLabel,
      roleBadgeTone,
      hasRedundantAssistantRole,
      canEditAssistantGrants,
      scopeSummary,
      authorityLabel,
      authorityTone,
      assistantItems,
      assistantGrantSummary,
      primaryAssistantMembership
    });
  }

  const priority = { admin: 1, teacher: 2, assistant: 3 };
  const sortedNames = sortStudentsRoster(entries);
  const nameRank = new Map(sortedNames.map((entry, idx) => [entry.uid, idx]));

  const sorted = [...entries].sort((a, b) => {
    const rankDiff = (priority[a.effectiveRole] || 9) - (priority[b.effectiveRole] || 9);
    if (rankDiff !== 0) return rankDiff;
    return (nameRank.get(a.uid) ?? 0) - (nameRank.get(b.uid) ?? 0);
  });

  return {
    entries: sorted,
    totalCount: sorted.length
  };
}

/**
 * Gom nhóm học sinh theo từng tài khoản học sinh (1 học sinh = 1 dòng).
 */
export function groupStudentsForAdmin({
  normalized = [],
  searchQuery = '',
  classFilter = 'all',
  statusFilter = 'active'
} = {}) {
  const query = normalizeSearchText(searchQuery);
  const byUid = new Map();

  for (const item of normalized || []) {
    if (item.member_role !== 'student' || !item.isAccountRoleValid) continue;
    if (statusFilter === 'active' && !item.isEffectiveActive) continue;
    if (statusFilter === 'inactive' && item.status !== 'inactive') continue;

    const list = byUid.get(item.uid) || [];
    list.push(item);
    byUid.set(item.uid, list);
  }

  const entries = [];
  for (const [uid, items] of byUid.entries()) {
    const matchesClass = classFilter === 'all' || items.some(x => x.class_id === classFilter);
    if (!matchesClass) continue;

    const base = items[0];
    const searchBlob = normalizeSearchText(
      [
        base.displayName,
        base.email,
        base.studentCode,
        uid,
        ...items.map(x => `${x.className} ${x.statusLabel}`)
      ].join(' ')
    );
    if (query && !searchBlob.includes(query)) continue;

    const classes = items.map(x => ({
      classId: x.class_id,
      className: x.className,
      status: x.status,
      isArchivedClass: x.isArchivedClass,
      membership: x
    }));
    const activeClasses = classes.filter(c => c.status === 'active' && !c.isArchivedClass);
    const inactiveClasses = classes.filter(c => c.status === 'inactive');

    entries.push({
      uid,
      name: base.displayName,
      displayName: base.displayName,
      email: base.email,
      studentCode: base.studentCode,
      student_code: base.studentCode,
      classes,
      activeClasses,
      inactiveClasses,
      overallStatus: activeClasses.length > 0 ? 'active' : 'inactive'
    });
  }

  return {
    entries: sortStudentsRoster(entries),
    totalMatched: entries.length
  };
}

/**
 * Gom nhóm học sinh theo từng lớp học (Khối 6 -> 12).
 */
export function groupMembershipsByClass({
  normalized = [],
  activeClasses = [],
  archivedClasses = [],
  searchQuery = '',
  statusScope = 'active_open'
} = {}) {
  const query = normalizeSearchText(searchQuery);
  const activeSorted = sortClasses(activeClasses || []);
  const archivedSorted = sortClasses(archivedClasses || []);

  const targetClasses = statusScope === 'all'
    ? [
        ...activeSorted.map(c => ({ ...c, isArchivedClass: false })),
        ...archivedSorted.map(c => ({ ...c, isArchivedClass: true }))
      ]
    : activeSorted.map(c => ({ ...c, isArchivedClass: false }));

  const byClass = new Map();
  for (const item of normalized || []) {
    if (item.member_role !== 'student' || !item.isAccountRoleValid) continue;
    if (statusScope === 'active_open' && !item.isEffectiveActive) continue;
    const list = byClass.get(item.class_id) || [];
    list.push(item);
    byClass.set(item.class_id, list);
  }

  const classGroups = [];
  for (const cls of targetClasses) {
    const classMatchesQuery = !query || normalizeSearchText(`${cls.name} ${cls.schedule || ''}`).includes(query);
    const rawStudents = byClass.get(cls.id) || [];
    const students = sortStudentsRoster(
      rawStudents
        .filter(item => {
          if (!query || classMatchesQuery) return true;
          const text = normalizeSearchText(`${item.displayName} ${item.email} ${item.studentCode} ${item.uid}`);
          return text.includes(query);
        })
        .map(item => ({ ...item, name: item.displayName, student_code: item.studentCode }))
    );

    if (query && !classMatchesQuery && !students.length) continue;
    if (cls.isArchivedClass && !students.length && !(query && classMatchesQuery)) continue;

    classGroups.push({
      classItem: cls,
      students
    });
  }

  return { classGroups };
}

/**
 * Gộp liên kết phụ huynh - học sinh theo từng phụ huynh (1 phụ huynh = 1 dòng).
 */
export function groupParentLinks({
  links = [],
  users = [],
  normalizedMemberships = [],
  searchQuery = '',
  statusFilter = 'active'
} = {}) {
  const userMap = new Map((users || []).map(u => [u.uid, u]));
  const studentClassesMap = new Map();
  for (const m of normalizedMemberships || []) {
    if (m.member_role === 'student' && m.isEffectiveActive) {
      const list = studentClassesMap.get(m.uid) || [];
      if (!list.includes(m.className)) list.push(m.className);
      studentClassesMap.set(m.uid, list);
    }
  }

  const deduped = new Map();
  for (const raw of links || []) {
    if (!raw || !raw.parent_uid || !raw.student_uid) continue;
    const key = `${raw.parent_uid}::${raw.student_uid}`;
    const nextStatus = raw.status === 'inactive' ? 'inactive' : 'active';
    const existing = deduped.get(key);
    if (existing && existing.status === 'active' && nextStatus !== 'active') continue;
    deduped.set(key, { ...raw, status: nextStatus });
  }

  const byParent = new Map();
  for (const link of deduped.values()) {
    if (statusFilter === 'active' && link.status !== 'active') continue;
    if (statusFilter === 'inactive' && link.status !== 'inactive') continue;
    const list = byParent.get(link.parent_uid) || [];
    list.push(link);
    byParent.set(link.parent_uid, list);
  }

  const query = normalizeSearchText(searchQuery);
  const groups = [];
  for (const [parentUid, items] of byParent.entries()) {
    const parentUser = userMap.get(parentUid);
    const parentName = parentUser?.display_name || parentUid;
    const parentEmail = parentUser?.email || '';
    const isEffectiveParent = Boolean(
      parentUser?.status === 'active' &&
      Array.isArray(parentUser?.roles) &&
      !parentUser.roles.some(r => r === 'admin' || r === 'teacher' || r === 'assistant') &&
      parentUser.roles.includes('parent')
    );

    const children = sortStudentsRoster(
      items.map(link => {
        const childUser = userMap.get(link.student_uid);
        const childName = childUser?.display_name || link.student_uid;
        return {
          studentUid: link.student_uid,
          studentName: childName,
          name: childName,
          studentCode: childUser?.student_code || '',
          student_code: childUser?.student_code || '',
          classNames: studentClassesMap.get(link.student_uid) || [],
          status: link.status,
          statusLabel: link.status === 'inactive' ? 'Ngừng liên kết' : 'Đang liên kết'
        };
      })
    );

    const activeCount = children.filter(c => c.status === 'active').length;
    const searchBlob = normalizeSearchText(
      [
        parentName,
        parentEmail,
        parentUid,
        ...children.map(c => `${c.studentName} ${c.studentCode} ${c.classNames.join(' ')} ${c.statusLabel}`)
      ].join(' ')
    );
    if (query && !searchBlob.includes(query)) continue;

    groups.push({
      parentUid,
      parentName,
      name: parentName,
      parentEmail,
      isEffectiveParent,
      children,
      activeCount
    });
  }

  return sortStudentsRoster(groups);
}

/**
 * Tạo dòng tóm tắt ngắn gọn hiển thị dưới tên tài khoản trong bảng Tài khoản & Phân quyền.
 */
export function summarizeAccountAssignments(
  uid,
  { staffByUid = new Map(), studentByUid = new Map(), parentGroupByUid = new Map(), activeClassesCount = 0 } = {}
) {
  const parts = [];
  const staff = staffByUid.get(uid);
  const student = studentByUid.get(uid);
  const parent = parentGroupByUid.get(uid);

  if (staff) {
    if (staff.effectiveRole === 'admin') {
      parts.push('Toàn quyền quản trị hệ thống');
    } else if (staff.effectiveRole === 'teacher') {
      parts.push(activeClassesCount ? `Giảng dạy tất cả ${activeClassesCount} lớp đang mở` : 'Giảng dạy toàn hệ thống');
    } else {
      const grantText = staff.assistantGrantSummary?.label ? ` (${staff.assistantGrantSummary.label})` : '';
      parts.push(activeClassesCount ? `Trợ giảng tất cả ${activeClassesCount} lớp đang mở${grantText}` : `Trợ giảng${grantText}`);
    }
  }

  if (student?.activeClasses?.length) {
    const preview = student.activeClasses.slice(0, 3).map(c => c.className).join(', ');
    const extra = student.activeClasses.length > 3 ? ` (+${student.activeClasses.length - 3})` : '';
    parts.push(`Lớp đang học: ${preview}${extra}`);
  }

  if (parent) {
    const activeKids = parent.children.filter(c => c.status === 'active');
    if (activeKids.length) {
      const preview = activeKids.slice(0, 2).map(c => c.studentName).join(', ');
      const extra = activeKids.length > 2 ? ` (+${activeKids.length - 2})` : '';
      parts.push(`Phụ huynh của: ${preview}${extra}`);
    }
  }

  return parts.join(' · ');
}

/**
 * Dựng toàn bộ không gian Tab Phân công thành viên (3 phân mục: Học sinh theo lớp, Đội ngũ giảng dạy, Liên kết phụ huynh).
 */
export function renderAdminMembershipsWorkspace({
  el,
  btn,
  empty,
  users = [],
  activeClasses = [],
  archivedClasses = [],
  memberships = [],
  links = [],
  roleLabels = {},
  currentUid = '',
  initialState = {},
  onStateChange,
  onOpenStudentAssignModal,
  onOpenTransferModal,
  onOpenStudentStatusModal,
  onOpenAssistantModal,
  onJumpToAccount,
  onOpenParentLinkModal,
  onOpenParentUnlinkModal
}) {
  const sortedActiveClasses = sortClasses(activeClasses || []);
  const expandedClassIds = new Set(Array.isArray(initialState.expandedClassIds) ? initialState.expandedClassIds : []);
  const state = {
    subTab: ['students', 'staff', 'parents'].includes(initialState.subTab) ? initialState.subTab : 'students',
    studentViewMode: initialState.studentViewMode === 'student' ? 'student' : 'class',
    studentClassFilter: initialState.studentClassFilter || 'all',
    studentStatusFilter: ['active', 'inactive', 'all'].includes(initialState.studentStatusFilter) ? initialState.studentStatusFilter : 'active',
    studentClassScope: ['active_open', 'all'].includes(initialState.studentClassScope) ? initialState.studentClassScope : 'active_open',
    studentSearch: initialState.studentSearch || '',
    staffSearch: initialState.staffSearch || '',
    parentStatus: ['active', 'inactive', 'all'].includes(initialState.parentStatus) ? initialState.parentStatus : 'active',
    parentSearch: initialState.parentSearch || '',
    expandedClassIds: [...expandedClassIds]
  };

  let studentVisibleLimit = 20;
  let parentVisibleLimit = 20;
  const classStudentLimit = new Map();

  const normalized = normalizeMemberships({
    memberships,
    users,
    activeClasses: sortedActiveClasses,
    archivedClasses,
    roleLabels
  });

  const activeStudentsSummary = groupStudentsForAdmin({
    normalized,
    searchQuery: '',
    classFilter: 'all',
    statusFilter: 'active'
  });
  const activeStudentByUid = new Map(activeStudentsSummary.entries.map(entry => [entry.uid, entry]));

  const staffSummary = groupStaffForAdmin({
    normalized,
    users,
    activeClasses: sortedActiveClasses,
    searchQuery: ''
  });

  const activeParentsSummary = groupParentLinks({
    links,
    users,
    normalizedMemberships: normalized,
    searchQuery: '',
    statusFilter: 'active'
  });
  const activeParentLinksCount = activeParentsSummary.reduce((sum, group) => sum + group.activeCount, 0);

  const emitState = () => {
    state.expandedClassIds = [...expandedClassIds];
    onStateChange?.({ ...state });
  };

  // --- THANH CHUYỂN 3 PHÂN MỤC ---
  const subTabSpecs = [
    { key: 'students', label: 'Học sinh theo lớp', count: activeStudentsSummary.entries.length },
    { key: 'staff', label: 'Đội ngũ giảng dạy', count: staffSummary.totalCount },
    { key: 'parents', label: 'Liên kết phụ huynh', count: activeParentLinksCount }
  ];

  const studentsPanel = el('section', {
    id: 'admin-subpanel-students',
    role: 'tabpanel',
    class: 'admin-subpanel',
    hidden: state.subTab !== 'students'
  });
  const staffPanel = el('section', {
    id: 'admin-subpanel-staff',
    role: 'tabpanel',
    class: 'admin-subpanel',
    hidden: state.subTab !== 'staff'
  });
  const parentsPanel = el('section', {
    id: 'admin-subpanel-parents',
    role: 'tabpanel',
    class: 'admin-subpanel',
    hidden: state.subTab !== 'parents'
  });

  const panelByKey = { students: studentsPanel, staff: staffPanel, parents: parentsPanel };

  const subTabButtons = subTabSpecs.map(spec =>
    el(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: `admin-subnav-pill${state.subTab === spec.key ? ' is-active' : ''}`,
        'aria-selected': String(state.subTab === spec.key),
        'aria-controls': panelByKey[spec.key].id,
        onclick: () => switchSubTab(spec.key)
      },
      el('span', { text: spec.label }),
      el('span', { class: 'admin-subnav-count', text: String(spec.count) })
    )
  );

  function switchSubTab(nextKey) {
    if (state.subTab === nextKey) return;
    state.subTab = nextKey;
    for (let i = 0; i < subTabSpecs.length; i++) {
      const active = subTabSpecs[i].key === nextKey;
      subTabButtons[i].classList.toggle('is-active', active);
      subTabButtons[i].setAttribute('aria-selected', String(active));
      panelByKey[subTabSpecs[i].key].hidden = !active;
    }
    emitState();
  }

  // --- PHÂN MỤC 1: HỌC SINH THEO LỚP ---
  const studentCountStatus = el('span', {
    class: 'badge badge-info',
    role: 'status',
    'aria-atomic': 'true',
    text: ''
  });

  const modeClassBtn = el('button', {
    type: 'button',
    class: `admin-seg-btn${state.studentViewMode === 'class' ? ' is-active' : ''}`,
    'aria-pressed': String(state.studentViewMode === 'class'),
    text: 'Theo lớp học',
    onclick: () => setStudentViewMode('class')
  });

  const modeStudentBtn = el('button', {
    type: 'button',
    class: `admin-seg-btn${state.studentViewMode === 'student' ? ' is-active' : ''}`,
    'aria-pressed': String(state.studentViewMode === 'student'),
    text: 'Theo học sinh',
    onclick: () => setStudentViewMode('student')
  });

  const studentSearchInput = el('input', {
    type: 'search',
    class: 'admin-membership-search',
    value: state.studentSearch,
    placeholder: 'Tìm tên học sinh, mã HS hoặc lớp…',
    'aria-label': 'Tìm kiếm học sinh trong phân công'
  });

  const classFilterSelect = el(
    'select',
    { class: 'admin-membership-select', 'aria-label': 'Lọc theo lớp học' },
    el('option', { value: 'all', text: 'Tất cả lớp' }),
    ...sortedActiveClasses.map(c => el('option', { value: c.id, text: c.name }))
  );
  classFilterSelect.value = sortedActiveClasses.some(c => c.id === state.studentClassFilter) ? state.studentClassFilter : 'all';

  const studentStatusSelect = el(
    'select',
    { class: 'admin-membership-select', 'aria-label': 'Lọc trạng thái học sinh' },
    el('option', { value: 'active', text: 'Đang học' }),
    el('option', { value: 'inactive', text: 'Đã nghỉ' }),
    el('option', { value: 'all', text: 'Tất cả' })
  );
  studentStatusSelect.value = state.studentStatusFilter;

  const classScopeSelect = el(
    'select',
    { class: 'admin-membership-select', 'aria-label': 'Phạm vi lớp hiển thị' },
    el('option', { value: 'active_open', text: 'Lớp đang mở' }),
    el('option', { value: 'all', text: 'Kể cả đã nghỉ' })
  );
  classScopeSelect.value = state.studentClassScope;

  const classFilterSlot = el('div', { class: 'admin-filter-slot', hidden: state.studentViewMode !== 'student' }, classFilterSelect);
  const studentStatusSlot = el('div', { class: 'admin-filter-slot', hidden: state.studentViewMode !== 'student' }, studentStatusSelect);
  const classScopeSlot = el('div', { class: 'admin-filter-slot', hidden: state.studentViewMode !== 'class' }, classScopeSelect);

  const studentListBody = el('div', { class: 'admin-membership-body' });

  function setStudentViewMode(mode) {
    if (state.studentViewMode === mode) return;
    state.studentViewMode = mode;
    modeClassBtn.classList.toggle('is-active', mode === 'class');
    modeClassBtn.setAttribute('aria-pressed', String(mode === 'class'));
    modeStudentBtn.classList.toggle('is-active', mode === 'student');
    modeStudentBtn.setAttribute('aria-pressed', String(mode === 'student'));
    classFilterSlot.hidden = mode !== 'student';
    studentStatusSlot.hidden = mode !== 'student';
    classScopeSlot.hidden = mode !== 'class';
    emitState();
    renderStudentsBody();
  }

  function renderStudentsTableView() {
    const grouped = groupStudentsForAdmin({
      normalized,
      searchQuery: state.studentSearch,
      classFilter: classFilterSelect.value,
      statusFilter: state.studentStatusFilter
    });

    const isFiltered = Boolean(
      normalizeSearchText(state.studentSearch) ||
      classFilterSelect.value !== 'all' ||
      state.studentStatusFilter !== 'active'
    );
    studentCountStatus.textContent = `${grouped.totalMatched} học sinh`;
    studentCountStatus.hidden = !isFiltered;

    if (!grouped.entries.length) {
      studentListBody.replaceChildren(empty('Chưa có học sinh nào khớp bộ lọc hiện tại.'));
      return;
    }

    const visible = grouped.entries.slice(0, studentVisibleLimit);
    const remaining = grouped.entries.length - visible.length;

    const rows = visible.map(entry => {
      const metaParts = [entry.studentCode ? `Mã HS: ${entry.studentCode}` : '', entry.email].filter(Boolean);
      const actionButtons = [];
      if (entry.activeClasses.length > 0) {
        actionButtons.push(
          btn('Đổi lớp', () => onOpenTransferModal?.({
            studentEntry: entry,
            fromClassId: entry.activeClasses[0].classId
          }), false)
        );
        actionButtons.push(
          btn('Ngừng học', () => onOpenStudentStatusModal?.({
            studentEntry: entry,
            targetClassId: entry.activeClasses.length === 1 ? entry.activeClasses[0].classId : '',
            nextStatus: 'inactive'
          }), false)
        );
      } else if (entry.inactiveClasses.length > 0) {
        actionButtons.push(
          btn('Cho học lại', () => onOpenStudentStatusModal?.({
            studentEntry: entry,
            targetClassId: entry.inactiveClasses[0].classId,
            nextStatus: 'active'
          }), false)
        );
      }

      return el(
        'tr',
        { role: 'row' },
        el(
          'td',
          { role: 'cell', 'data-label': 'Học sinh' },
          el('strong', { text: entry.displayName }),
          metaParts.length ? el('p', { class: 'meta admin-row-meta', text: metaParts.join(' · ') }) : null
        ),
        el(
          'td',
          { role: 'cell', 'data-label': 'Lớp tham gia' },
          el(
            'div',
            { class: 'admin-chip-collection' },
            ...entry.classes.map(cls => {
              const tone = cls.status === 'inactive' || cls.isArchivedClass ? 'badge-warning' : 'badge-primary';
              const suffix = cls.status === 'inactive' ? ' · Đã nghỉ' : (cls.isArchivedClass ? ' · Lưu trữ' : '');
              return el('span', { class: `badge ${tone}`, text: `${cls.className}${suffix}` });
            })
          )
        ),
        el(
          'td',
          { role: 'cell', 'data-label': 'Trạng thái' },
          el('span', {
            class: `badge ${entry.overallStatus === 'active' ? 'badge-success' : 'badge-warning'}`,
            text: entry.overallStatus === 'active' ? 'Đang học' : 'Đã nghỉ'
          })
        ),
        el(
          'td',
          { role: 'cell', 'data-label': 'Thao tác' },
          el('div', { class: 'admin-table-actions' }, ...actionButtons)
        )
      );
    });

    const tableWrap = el(
      'div',
      { class: 'table-wrap admin-roster-table-wrap' },
      el(
        'table',
        { class: 'admin-roster-table is-students-table', role: 'table', 'aria-label': 'Danh sách học sinh theo phân công' },
        el(
          'thead',
          { role: 'rowgroup' },
          el(
            'tr',
            { role: 'row' },
            ...['Học sinh', 'Lớp tham gia', 'Trạng thái', 'Thao tác'].map(label =>
              el('th', { scope: 'col', role: 'columnheader', text: label })
            )
          )
        ),
        el('tbody', { role: 'rowgroup' }, ...rows)
      )
    );

    const nodes = [tableWrap];
    if (remaining > 0) {
      nodes.push(
        el(
          'div',
          { class: 'admin-load-more-row' },
          el('button', {
            type: 'button',
            class: 'secondary',
            text: `Xem thêm học sinh (còn ${remaining})`,
            onclick: () => {
              studentVisibleLimit += 25;
              renderStudentsBody();
            }
          })
        )
      );
    }
    studentListBody.replaceChildren(...nodes);
  }

  function renderStudentsByClassView() {
    const grouped = groupMembershipsByClass({
      normalized,
      activeClasses: sortedActiveClasses,
      archivedClasses,
      searchQuery: state.studentSearch,
      statusScope: state.studentClassScope
    });

    const isFiltered = Boolean(
      normalizeSearchText(state.studentSearch) ||
      state.studentClassScope !== 'active_open'
    );
    studentCountStatus.textContent = `${grouped.classGroups.length} lớp học`;
    studentCountStatus.hidden = !isFiltered;

    if (!grouped.classGroups.length) {
      studentListBody.replaceChildren(empty('Không tìm thấy lớp học hoặc học sinh nào phù hợp.'));
      return;
    }

    const hasQuery = Boolean(normalizeSearchText(state.studentSearch));
    const cards = grouped.classGroups.map(group => {
      const { classItem, students } = group;
      const limit = classStudentLimit.get(classItem.id) || 20;
      const visibleStudents = students.slice(0, limit);
      const remaining = students.length - visibleStudents.length;

      const bodyNodes = [];
      if (!classItem.isArchivedClass) {
        bodyNodes.push(
          el(
            'div',
            { class: 'admin-class-body-topbar' },
            el('span', { class: 'meta', text: students.length ? `Sĩ số hiện tại: ${students.length} học sinh` : 'Lớp chưa có học sinh.' }),
            btn('Thêm học sinh', () => onOpenStudentAssignModal?.({ classId: classItem.id }), true, 'plus')
          )
        );
      }

      if (visibleStudents.length) {
        const studentRows = visibleStudents.map(m => {
          const metaParts = [m.studentCode ? `Mã HS: ${m.studentCode}` : '', m.email].filter(Boolean);
          const studentEntry = activeStudentByUid.get(m.uid) || {
            uid: m.uid,
            displayName: m.displayName,
            activeClasses: m.status === 'active' && !classItem.isArchivedClass ? [{ classId: classItem.id, className: classItem.name }] : [],
            inactiveClasses: m.status === 'inactive' ? [{ classId: classItem.id, className: classItem.name }] : []
          };
          const rowActions = [];
          if (!classItem.isArchivedClass && m.status === 'active') {
            rowActions.push(
              btn('Đổi lớp', () => onOpenTransferModal?.({ studentEntry, fromClassId: classItem.id }), false)
            );
            rowActions.push(
              btn('Ngừng học', () => onOpenStudentStatusModal?.({
                studentEntry,
                targetClassId: classItem.id,
                nextStatus: 'inactive'
              }), false)
            );
          } else if (!classItem.isArchivedClass && m.status === 'inactive') {
            rowActions.push(
              btn('Cho học lại', () => onOpenStudentStatusModal?.({
                studentEntry,
                targetClassId: classItem.id,
                nextStatus: 'active'
              }), false)
            );
          }

          return el(
            'tr',
            { role: 'row' },
            el(
              'td',
              { role: 'cell', 'data-label': 'Học sinh' },
              el('strong', { text: m.displayName }),
              metaParts.length ? el('p', { class: 'meta admin-row-meta', text: metaParts.join(' · ') }) : null
            ),
            el(
              'td',
              { role: 'cell', 'data-label': 'Trạng thái' },
              el('span', {
                class: `badge ${m.status === 'active' ? 'badge-success' : 'badge-warning'}`,
                text: m.status === 'active' ? 'Đang học' : 'Đã nghỉ'
              })
            ),
            el(
              'td',
              { role: 'cell', 'data-label': 'Thao tác' },
              el('div', { class: 'admin-table-actions' }, ...rowActions)
            )
          );
        });

        bodyNodes.push(
          el(
            'div',
            { class: 'table-wrap admin-roster-table-wrap is-nested' },
            el(
              'table',
              { class: 'admin-roster-table is-class-students-table', role: 'table', 'aria-label': `Học sinh ${classItem.name}` },
              el(
                'thead',
                { role: 'rowgroup' },
                el(
                  'tr',
                  { role: 'row' },
                  ...['Học sinh', 'Trạng thái', 'Thao tác'].map(t => el('th', { scope: 'col', role: 'columnheader', text: t }))
                )
              ),
              el('tbody', { role: 'rowgroup' }, ...studentRows)
            )
          )
        );
      }

      if (remaining > 0) {
        bodyNodes.push(
          el(
            'div',
            { class: 'admin-load-more-row' },
            el('button', {
              type: 'button',
              class: 'secondary',
              text: `Xem thêm học sinh (còn ${remaining})`,
              onclick: () => {
                classStudentLimit.set(classItem.id, limit + 25);
                renderStudentsBody();
              }
            })
          )
        );
      }

      const detailsAttrs = { class: 'admin-class-roster-card' };
      if (hasQuery || expandedClassIds.has(classItem.id)) detailsAttrs.open = true;

      const detailsEl = el(
        'details',
        detailsAttrs,
        el(
          'summary',
          { class: 'admin-class-roster-summary' },
          el(
            'div',
            { class: 'admin-class-roster-title' },
            el('strong', { text: classItem.name }),
            classItem.schedule ? el('span', { class: 'meta', text: classItem.schedule }) : null
          ),
          el(
            'div',
            { class: 'admin-class-roster-badges' },
            classItem.isArchivedClass ? el('span', { class: 'badge badge-warning', text: 'Lưu trữ' }) : null,
            el('span', {
              class: `badge ${students.length ? 'badge-success' : 'badge-info'}`,
              text: `${students.length} học sinh`
            })
          )
        ),
        el('div', { class: 'admin-class-roster-body' }, ...bodyNodes)
      );

      detailsEl.addEventListener('toggle', () => {
        if (hasQuery) return;
        if (detailsEl.open) expandedClassIds.add(classItem.id);
        else expandedClassIds.delete(classItem.id);
        emitState();
      });

      return detailsEl;
    });

    studentListBody.replaceChildren(el('div', { class: 'admin-class-roster-list' }, ...cards));
  }

  function renderStudentsBody() {
    if (state.studentViewMode === 'student') renderStudentsTableView();
    else renderStudentsByClassView();
  }

  studentSearchInput.addEventListener('input', () => {
    state.studentSearch = studentSearchInput.value;
    studentVisibleLimit = 20;
    emitState();
    renderStudentsBody();
  });

  classFilterSelect.addEventListener('change', () => {
    state.studentClassFilter = classFilterSelect.value;
    studentVisibleLimit = 20;
    emitState();
    renderStudentsBody();
  });

  studentStatusSelect.addEventListener('change', () => {
    state.studentStatusFilter = studentStatusSelect.value;
    studentVisibleLimit = 20;
    emitState();
    renderStudentsBody();
  });

  classScopeSelect.addEventListener('change', () => {
    state.studentClassScope = classScopeSelect.value;
    emitState();
    renderStudentsBody();
  });

  renderStudentsBody();

  studentsPanel.append(
    el(
      'div',
      { class: 'admin-membership-toolbar' },
      el(
        'div',
        { class: 'admin-seg-group', role: 'group', 'aria-label': 'Chế độ xem học sinh' },
        modeClassBtn,
        modeStudentBtn
      ),
      studentSearchInput,
      classFilterSlot,
      studentStatusSlot,
      classScopeSlot,
      studentCountStatus,
      btn('Xếp học sinh', () => onOpenStudentAssignModal?.({}), true, 'plus')
    ),
    studentListBody
  );

  // --- PHÂN MỤC 2: ĐỘI NGŨ GIẢNG DẠY ---
  const staffSearchInput = el('input', {
    type: 'search',
    class: 'admin-membership-search',
    value: state.staffSearch,
    placeholder: 'Tìm tên hoặc email nhân sự…',
    'aria-label': 'Tìm kiếm đội ngũ giảng dạy'
  });

  const staffCountStatus = el('span', {
    class: 'badge badge-info',
    role: 'status',
    'aria-atomic': 'true',
    text: `${staffSummary.totalCount} nhân sự`
  });

  const staffBody = el('div', { class: 'admin-membership-body' });

  function renderStaffBody() {
    const grouped = groupStaffForAdmin({
      normalized,
      users,
      activeClasses: sortedActiveClasses,
      searchQuery: state.staffSearch
    });

    staffCountStatus.textContent = `${grouped.totalCount} nhân sự`;

    if (!grouped.entries.length) {
      staffBody.replaceChildren(empty('Không tìm thấy nhân sự nào khớp bộ lọc.'));
      return;
    }

    const rows = grouped.entries.map(entry => {
      const scopeNodes = [
        el('span', { class: 'badge badge-primary', text: entry.scopeSummary })
      ];
      if (entry.authorityLabel) {
        scopeNodes.push(
          el('span', { class: `badge ${entry.authorityTone}`, text: entry.authorityLabel })
        );
      }
      if (entry.assistantGrantSummary) {
        scopeNodes.push(
          el('span', { class: `badge ${entry.assistantGrantSummary.tone}`, text: entry.assistantGrantSummary.label })
        );
      }

      const customChips = entry.assistantGrantSummary?.customItems?.length
        ? el(
            'div',
            { class: 'admin-chip-collection' },
            ...entry.assistantGrantSummary.customItems.map(custom =>
              el('button', {
                type: 'button',
                class: 'admin-chip-toggle',
                text: `${custom.className}: ${custom.count}/${TOTAL_ASSISTANT_PERMISSIONS} quyền`,
                onclick: () => onOpenAssistantModal?.(custom.membership, entry.assistantItems)
              })
            )
          )
        : null;

      let actionNode;
      if (entry.canEditAssistantGrants) {
        actionNode = btn('Phân quyền', () => onOpenAssistantModal?.(entry.primaryAssistantMembership, entry.assistantItems), false, 'edit');
      } else if (entry.uid === currentUid) {
        actionNode = el('span', { class: 'meta', text: 'Đang sử dụng' });
      } else {
        actionNode = btn('Đổi vai trò', () => onJumpToAccount?.(entry.email || entry.displayName), false);
      }

      return el(
        'tr',
        { role: 'row' },
        el(
          'td',
          { role: 'cell', 'data-label': 'Nhân sự' },
          el('strong', { text: entry.displayName }),
          entry.email ? el('p', { class: 'meta admin-row-meta', text: entry.email }) : null
        ),
        el(
          'td',
          { role: 'cell', 'data-label': 'Vai trò hiệu lực' },
          el('div', { class: 'admin-chip-collection' },
            el('span', { class: `badge ${entry.roleBadgeTone}`, text: entry.effectiveRoleLabel })
          ),
          entry.hasRedundantAssistantRole
            ? el('p', { class: 'meta admin-redundant-role-note', text: 'Đang bật kèm Trợ giảng (áp dụng toàn quyền Giáo viên)' })
            : null
        ),
        el(
          'td',
          { role: 'cell', 'data-label': 'Phạm vi & Quyền hạn' },
          el('div', { class: 'admin-chip-collection' }, ...scopeNodes),
          customChips
        ),
        el(
          'td',
          { role: 'cell', 'data-label': 'Thao tác' },
          el('div', { class: 'admin-table-actions' }, actionNode)
        )
      );
    });

    staffBody.replaceChildren(
      el(
        'div',
        { class: 'table-wrap admin-roster-table-wrap' },
        el(
          'table',
          { class: 'admin-roster-table is-staff-table', role: 'table', 'aria-label': 'Danh sách đội ngũ giảng dạy' },
          el(
            'thead',
            { role: 'rowgroup' },
            el(
              'tr',
              { role: 'row' },
              ...['Nhân sự', 'Vai trò hiệu lực', 'Phạm vi & Quyền hạn', 'Thao tác'].map(t =>
                el('th', { scope: 'col', role: 'columnheader', text: t })
              )
            )
          ),
          el('tbody', { role: 'rowgroup' }, ...rows)
        )
      )
    );
  }

  staffSearchInput.addEventListener('input', () => {
    state.staffSearch = staffSearchInput.value;
    emitState();
    renderStaffBody();
  });

  renderStaffBody();

  staffPanel.append(
    el('p', {
      class: 'admin-staff-policy-note',
      text: 'Giáo viên và Trợ giảng đang hoạt động tự động phụ trách tất cả lớp đang mở. Có thể giới hạn 7 nhóm quyền chi tiết đối với Trợ giảng.'
    }),
    el(
      'div',
      { class: 'admin-membership-toolbar' },
      staffSearchInput,
      staffCountStatus
    ),
    staffBody
  );

  // --- PHÂN MỤC 3: LIÊN KẾT PHỤ HUYNH ---
  const parentSearchInput = el('input', {
    type: 'search',
    class: 'admin-membership-search',
    value: state.parentSearch,
    placeholder: 'Tìm phụ huynh, học sinh hoặc mã HS…',
    'aria-label': 'Tìm kiếm liên kết phụ huynh học sinh'
  });

  const parentStatusSelect = el(
    'select',
    { class: 'admin-membership-select', 'aria-label': 'Lọc trạng thái liên kết' },
    el('option', { value: 'active', text: 'Đang liên kết' }),
    el('option', { value: 'inactive', text: 'Ngừng liên kết' }),
    el('option', { value: 'all', text: 'Tất cả' })
  );
  parentStatusSelect.value = state.parentStatus;

  const parentCountStatus = el('span', {
    class: 'badge badge-info',
    role: 'status',
    'aria-atomic': 'true',
    text: ''
  });

  const parentBody = el('div', { class: 'admin-membership-body' });

  function renderParentsBody() {
    const groups = groupParentLinks({
      links,
      users,
      normalizedMemberships: normalized,
      searchQuery: state.parentSearch,
      statusFilter: state.parentStatus
    });

    const totalLinks = groups.reduce((sum, g) => sum + g.children.length, 0);
    parentCountStatus.textContent = `${groups.length} phụ huynh · ${totalLinks} liên kết`;

    if (!groups.length) {
      parentBody.replaceChildren(empty('Chưa có liên kết phụ huynh - học sinh nào phù hợp.'));
      return;
    }

    const visible = groups.slice(0, parentVisibleLimit);
    const remaining = groups.length - visible.length;

    const rows = visible.map(group =>
      el(
        'tr',
        { role: 'row' },
        el(
          'td',
          { role: 'cell', 'data-label': 'Phụ huynh' },
          el('strong', { text: group.parentName }),
          group.parentEmail ? el('p', { class: 'meta admin-row-meta', text: group.parentEmail }) : null,
          !group.isEffectiveParent
            ? el('span', { class: 'badge badge-warning', text: 'Tài khoản chưa kích hoạt' })
            : null
        ),
        el(
          'td',
          { role: 'cell', 'data-label': 'Học sinh theo dõi' },
          el(
            'div',
            { class: 'admin-linked-children-list' },
            ...group.children.map(child => {
              const infoParts = [
                child.studentCode ? `Mã HS: ${child.studentCode}` : '',
                child.classNames.length ? child.classNames.join(', ') : 'Chưa xếp lớp',
                child.status === 'inactive' ? 'Ngừng liên kết' : ''
              ].filter(Boolean);
              return el(
                'div',
                { class: `admin-linked-child-item${child.status === 'inactive' ? ' is-inactive' : ''}` },
                el(
                  'div',
                  { class: 'admin-linked-child-info' },
                  el('strong', { text: child.studentName }),
                  el('span', { class: 'meta', text: infoParts.join(' · ') })
                ),
                btn(
                  child.status === 'active' ? 'Ngừng liên kết' : 'Nối lại',
                  () => onOpenParentUnlinkModal?.({
                    parentUid: group.parentUid,
                    parentName: group.parentName,
                    child,
                    nextStatus: child.status === 'active' ? 'inactive' : 'active'
                  }),
                  false
                )
              );
            })
          )
        ),
        el(
          'td',
          { role: 'cell', 'data-label': 'Thao tác' },
          el(
            'div',
            { class: 'admin-table-actions' },
            btn('Thêm học sinh', () => onOpenParentLinkModal?.({ parentUid: group.parentUid }), false, 'plus')
          )
        )
      )
    );

    const nodes = [
      el(
        'div',
        { class: 'table-wrap admin-roster-table-wrap' },
        el(
          'table',
          { class: 'admin-roster-table is-parents-table', role: 'table', 'aria-label': 'Danh sách liên kết phụ huynh và học sinh' },
          el(
            'thead',
            { role: 'rowgroup' },
            el(
              'tr',
              { role: 'row' },
              ...['Phụ huynh', 'Học sinh theo dõi', 'Thao tác'].map(t => el('th', { scope: 'col', role: 'columnheader', text: t }))
            )
          ),
          el('tbody', { role: 'rowgroup' }, ...rows)
        )
      )
    ];

    if (remaining > 0) {
      nodes.push(
        el(
          'div',
          { class: 'admin-load-more-row' },
          el('button', {
            type: 'button',
            class: 'secondary',
            text: `Xem thêm phụ huynh (còn ${remaining})`,
            onclick: () => {
              parentVisibleLimit += 25;
              renderParentsBody();
            }
          })
        )
      );
    }

    parentBody.replaceChildren(...nodes);
  }

  parentSearchInput.addEventListener('input', () => {
    state.parentSearch = parentSearchInput.value;
    parentVisibleLimit = 20;
    emitState();
    renderParentsBody();
  });

  parentStatusSelect.addEventListener('change', () => {
    state.parentStatus = parentStatusSelect.value;
    parentVisibleLimit = 20;
    emitState();
    renderParentsBody();
  });

  renderParentsBody();

  parentsPanel.append(
    el(
      'div',
      { class: 'admin-membership-toolbar' },
      parentSearchInput,
      parentStatusSelect,
      parentCountStatus,
      btn('Liên kết phụ huynh', () => onOpenParentLinkModal?.({}), true, 'plus')
    ),
    parentBody
  );

  return el(
    'div',
    { class: 'admin-memberships-workspace' },
    el(
      'div',
      { class: 'admin-subnav-pills', role: 'tablist', 'aria-label': 'Phân loại phân công thành viên' },
      ...subTabButtons
    ),
    studentsPanel,
    staffPanel,
    parentsPanel
  );
}
