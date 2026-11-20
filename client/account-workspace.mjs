import { normalizeSettingsSubPage, timeZone } from '../shared/classroom.mjs';
import { supportEmail } from './config.js';

export const ACCOUNT_TABS = [
  {
    id: 'profile',
    label: 'Hồ sơ & Liên hệ',
    description: 'Cập nhật họ tên hiển thị, số điện thoại và thông tin liên kết.',
    icon: 'user'
  },
  {
    id: 'security',
    label: 'Bảo mật & Đăng nhập',
    description: 'Phương thức đăng nhập, bảo mật 2 lớp OTP và đổi mật khẩu.',
    icon: 'shield'
  },
  {
    id: 'privacy',
    label: 'Quyền dữ liệu & Hỗ trợ',
    description: 'Quyền chủ thể dữ liệu, chính sách bảo mật và liên hệ ban quản trị.',
    icon: 'notice'
  }
];

export const ACCOUNT_ROLE_LABELS = {
  admin: 'Quản trị viên',
  teacher: 'Giáo viên',
  assistant: 'Trợ giảng',
  student: 'Học sinh',
  parent: 'Phụ huynh'
};

export const ROLE_DESCRIPTIONS = {
  admin: 'Quản lý toàn bộ lớp học, duyệt hồ sơ, tài khoản và vận hành hệ thống.',
  teacher: 'Giảng dạy, đăng tài liệu, chấm bài tập, ghi điểm danh và duyệt hồ sơ lớp.',
  assistant: 'Hỗ trợ lớp học theo đúng các quyền được quản trị viên phân công.',
  student: 'Tham gia lớp học, xem bài giảng, nộp bài tập, luyện đề và hỏi đáp.',
  parent: 'Theo dõi chuyên cần, bài tập và kết quả học tập của học sinh đã liên kết.'
};

export const ASSISTANT_PERMISSION_LABELS = {
  'attendance.write': 'Điểm danh',
  'materials.write': 'Bài giảng',
  'assignments.write': 'Bài tập',
  'practice.manage': 'Phòng luyện',
  'notices.write': 'Thông báo',
  'messages.write': 'Diễn đàn',
  'schedule.manage': 'Lịch học'
};

export const PARENT_RELATION_LABELS = {
  father: 'Bố',
  mother: 'Mẹ',
  guardian: 'Người giám hộ'
};

export const SUPPORT_EMAIL = supportEmail;

export function resolveAccountTab(subPage = null) {
  return normalizeSettingsSubPage(subPage) || 'profile';
}

export function shouldShowRoleSwitcher(roles = []) {
  if (!Array.isArray(roles) || roles.includes('admin')) return false;
  return roles.length > 1;
}

const STAFF_ROLES = new Set(['admin', 'teacher', 'assistant']);

export function isStaffRoleList(roles = []) {
  return Array.isArray(roles) && roles.some(role => STAFF_ROLES.has(role));
}

export function shouldShowLinkedParentsCard(roles = [], viewRole = '') {
  return Array.isArray(roles) && !isStaffRoleList(roles) && roles.includes('student') && viewRole === 'student';
}

export function shouldShowLinkedStudentsCard(roles = [], viewRole = '') {
  return Array.isArray(roles) && !isStaffRoleList(roles) && roles.includes('parent') && viewRole === 'parent';
}

export function formatUserInitials(name, fallback = 'LT') {
  const tokens = String(name || '')
    .trim()
    .split(/\s+/)
    .map(token => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  if (!tokens.length) return fallback;
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  return tokens
    .slice(-2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

export function validateDisplayName(name) {
  const value = String(name ?? '').trim();
  if (!value) {
    return { valid: false, value: '', error: 'Vui lòng nhập họ và tên hiển thị.' };
  }
  if (value.length > 160) {
    return { valid: false, value, error: 'Họ và tên hiển thị không vượt quá 160 ký tự.' };
  }
  return { valid: true, value, error: '' };
}

export function validateContactPhone(phone) {
  const value = String(phone ?? '').trim();
  if (!value) {
    return { valid: true, value: '', error: '' };
  }
  if (!/^[0-9+() -]{8,30}$/.test(value)) {
    return {
      valid: false,
      value,
      error: 'Số điện thoại không hợp lệ (cần 8–30 ký tự gồm chữ số, khoảng trắng, dấu + hoặc -).'
    };
  }
  return { valid: true, value, error: '' };
}

export function evaluatePasswordPolicy({ password = '', confirm = '', current = '', requiresCurrent = false } = {}) {
  const pw = String(password || '');
  const cf = String(confirm || '');
  const cur = String(current || '');
  const hasMinLength = pw.length >= 8 && pw.length <= 128;
  const matchesConfirm = pw.length > 0 && pw === cf;
  const differsFromCurrent = !requiresCurrent || !cur || pw !== cur;

  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9\s]/.test(pw)) score++;

  let strength = 'empty';
  let strengthLabel = 'Chưa nhập mật khẩu mới';
  if (pw.length > 0 && pw.length < 8) {
    strength = 'short';
    strengthLabel = 'Cần tối thiểu 8 ký tự';
  } else if (pw.length >= 8) {
    if (score >= 4) {
      strength = 'strong';
      strengthLabel = 'Độ mạnh tốt';
    } else if (score >= 2) {
      strength = 'fair';
      strengthLabel = 'Khá ổn (nên thêm chữ hoa, số hoặc ký tự đặc biệt)';
    } else {
      strength = 'weak';
      strengthLabel = 'Đủ điều kiện tối thiểu (nên kết hợp thêm chữ và số)';
    }
  }

  let error = '';
  if (requiresCurrent && !cur) {
    error = 'Vui lòng nhập mật khẩu hiện tại để xác minh.';
  } else if (!hasMinLength) {
    error = 'Mật khẩu mới phải dài từ 8 đến 128 ký tự.';
  } else if (!matchesConfirm) {
    error = 'Hai lần nhập mật khẩu mới chưa trùng khớp.';
  } else if (requiresCurrent && cur === pw) {
    error = 'Mật khẩu mới cần khác mật khẩu hiện tại.';
  }

  return {
    valid: !error,
    error,
    hasMinLength,
    matchesConfirm,
    differsFromCurrent,
    strength,
    strengthLabel
  };
}

export function describeAuthProviders(providerData = []) {
  const ids = new Set(
    (Array.isArray(providerData) ? providerData : [])
      .map(item => item?.providerId)
      .filter(Boolean)
  );
  const hasGoogle = ids.has('google.com');
  const hasPassword = ids.has('password');

  if (hasGoogle && hasPassword) {
    return {
      mode: 'googleAndPassword',
      hasGoogle: true,
      hasPassword: true,
      requiresCurrentPassword: false,
      reauthMethod: 'google_popup',
      formTitle: 'Đổi mật khẩu đăng nhập bằng email',
      submitLabel: 'Xác minh Google & Đổi mật khẩu',
      helperText: 'Tài khoản đã liên kết Google và mật khẩu email. Bạn chỉ cần xác minh lại qua cửa sổ Google để đặt mật khẩu mới.'
    };
  }
  if (hasGoogle) {
    return {
      mode: 'googleOnly',
      hasGoogle: true,
      hasPassword: false,
      requiresCurrentPassword: false,
      reauthMethod: 'google_popup',
      formTitle: 'Tạo mật khẩu đăng nhập bằng email',
      submitLabel: 'Xác minh Google & Tạo mật khẩu',
      helperText: 'Bạn đang đăng nhập bằng Google. Hãy tạo mật khẩu riêng để có thể đăng nhập dự phòng bằng email khi cần.'
    };
  }
  return {
    mode: 'passwordOnly',
    hasGoogle: false,
    hasPassword: true,
    requiresCurrentPassword: true,
    reauthMethod: 'password_credential',
    formTitle: 'Đổi mật khẩu tài khoản',
    submitLabel: 'Xác minh & Đổi mật khẩu',
    helperText: 'Nhập mật khẩu hiện tại để xác minh danh tính trước khi cập nhật mật khẩu mới.'
  };
}

export function formatAssistantPermissions(permissions = []) {
  if (!Array.isArray(permissions) || !permissions.length) return [];
  return permissions
    .map(key => ASSISTANT_PERMISSION_LABELS[key] || key)
    .filter(Boolean);
}

export function formatVietnamDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('vi-VN', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

export function formatIsoDob(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || '').trim());
  if (!m) return String(isoDate || '').trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function normalizeAccountProfile(raw = {}, fallbackMe = {}, fallbackEmail = '') {
  const data = raw && typeof raw === 'object' ? raw : {};
  const fallbackRoles = Array.isArray(fallbackMe?.roles) ? fallbackMe.roles : [];
  return {
    uid: fallbackMe?.uid || data.uid || '',
    displayName: String(data.display_name || fallbackMe?.name || 'Thành viên').trim(),
    contactPhone: String(data.contact_phone || '').trim(),
    studentCode: data.student_code || fallbackMe?.studentCode || null,
    ownStudentCode: data.own_student_code || (!isStaffRoleList(fallbackRoles) && fallbackRoles.includes('student') ? (data.student_code || fallbackMe?.studentCode || null) : null),
    email: String(data.email || fallbackEmail || fallbackMe?.email || '').trim(),
    status: String(data.status || 'active'),
    roles: Array.isArray(data.roles) && data.roles.length ? data.roles : fallbackRoles,
    createdAt: data.created_at || null,
    enrollment: data.enrollment && typeof data.enrollment === 'object' ? data.enrollment : null,
    linkedStudents: Array.isArray(data.linked_students) ? data.linked_students : [],
    linkedParents: Array.isArray(data.linked_parents) ? data.linked_parents : []
  };
}

export function buildSupportMailtoHref({
  topic = 'general',
  name = '',
  email = '',
  studentCode = '',
  uid = '',
  roleLabel = ''
} = {}) {
  const subjectMap = {
    profile_update: '[LTCH] Yêu cầu điều chỉnh hồ sơ lớp học',
    data_rights: '[LTCH] Yêu cầu thực hiện quyền về dữ liệu cá nhân',
    general: '[LTCH] Hỗ trợ tài khoản cá nhân'
  };
  const introMap = {
    profile_update: 'Nội dung cần điều chỉnh (họ tên, lớp học, liên kết phụ huynh...):',
    data_rights: 'Quyền đề nghị thực hiện (xem / chỉnh sửa / rút đồng ý / hạn chế / xóa dữ liệu):',
    general: 'Mô tả vấn đề cần hỗ trợ:'
  };
  const key = subjectMap[topic] ? topic : 'general';
  const lines = [
    'Kính gửi Ban Quản trị Lớp Toán cô Hạnh,',
    '',
    introMap[key],
    '- ...',
    '',
    'Thông tin tài khoản đối chiếu:',
    `- Họ tên: ${name || '(chưa cập nhật)'}`,
    `- Email: ${email || '(chưa cập nhật)'}`,
    `- Vai trò: ${roleLabel || 'Thành viên'}`,
    ...(studentCode ? [`- Mã học sinh: ${studentCode}`] : []),
    `- Mã định danh tài khoản (UID): ${uid || '(không rõ)'}`
  ];
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subjectMap[key])}&body=${encodeURIComponent(lines.join('\n'))}`;
}

export function buildSupportCopyBundle({
  name = '',
  email = '',
  studentCode = '',
  uid = '',
  roleLabels = [],
  classNames = []
} = {}) {
  const lines = [
    `Họ tên: ${name || '(chưa cập nhật)'}`,
    `Email: ${email || '(chưa cập nhật)'}`,
    `Vai trò: ${Array.isArray(roleLabels) && roleLabels.length ? roleLabels.join(', ') : 'Thành viên'}`
  ];
  if (studentCode) lines.push(`Mã học sinh: ${studentCode}`);
  if (Array.isArray(classNames) && classNames.length) lines.push(`Lớp học: ${classNames.join(', ')}`);
  if (uid) lines.push(`UID: ${uid}`);
  return lines.join('\n');
}
