'use strict';

const { escapeHtml, renderHtmlLayout } = require('./email-layout.cjs');
const defaultSiteUrl = (process.env.LTCH_SITE_URL || process.env.ALLOWED_ORIGIN || 'https://ltch.example.com').replace(/\/+$/, '');
const defaultSupportEmail = (process.env.LTCH_SUPPORT_EMAIL || process.env.ADMIN_EMAIL || 'admin@example.com').trim();

function resolveMailContext(options = {}) {
  const siteUrl = String(options?.siteUrl || defaultSiteUrl).replace(/\/+$/, '');
  const supportEmail = String(options?.supportEmail || defaultSupportEmail).trim();
  return {
    siteUrl,
    supportEmail,
    overviewUrl: `${siteUrl}/overview`,
    loginUrl: `${siteUrl}/login`,
    onboardingUrl: `${siteUrl}/onboarding`,
    adminStaffUrl: `${siteUrl}/admin/staff`,
    enrollmentsUrl: `${siteUrl}/enrollments`
  };
}

function buildClassActionUrl(fields, tabSegment = '', siteUrl = defaultSiteUrl) {
  const classId = resolveField(fields, 'class_id');
  if (/^[A-Za-z0-9_-]{1,128}$/.test(classId)) {
    return tabSegment ? `${siteUrl}/class/${classId}/${tabSegment}` : `${siteUrl}/class/${classId}`;
  }
  return `${siteUrl}/class`;
}

function resolveField(fields, name) {
  const raw = fields && fields[name];
  if (name === 'parent_relation') {
    return { mother: 'Mẹ', father: 'Bố', guardian: 'Người giám hộ' }[raw] || raw || 'Phụ huynh';
  }
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    return String(raw);
  }
  if (name === 'schedule') return 'Giáo viên sẽ cập nhật lịch học cụ thể.';
  if (name === 'student_phone') return 'Chưa cung cấp';
  if (name === 'school_year_name') return 'Năm học hiện hành';
  return '';
}

function renderText(template, fields) {
  return template.replace(/{{([a-z_]+)}}/g, (_, name) => resolveField(fields, name));
}

function renderOtpEmail(code, options = {}) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new TypeError('Invalid verification code');
  const ctx = resolveMailContext(options);
  const title = 'Mã xác minh đăng nhập';
  const instructions = 'Nhập mã dưới đây để hoàn tất đăng nhập vào cổng học tập.';
  const safetyNote = 'Không chia sẻ mã này. Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.';
  return {
    subject: `[Lớp Toán cô Hạnh] ${title}`,
    body: [instructions, '', `Mã xác minh: ${code}`, 'Mã dùng một lần và có hiệu lực trong 5 phút.', '', safetyNote, '',
      `Cổng học tập: ${ctx.loginUrl}`, 'Ban Quản trị Lớp Toán cô Hạnh'].join('\n'),
    htmlBody: renderHtmlLayout({
      preheader: 'Mã dùng một lần và có hiệu lực trong 5 phút.',
      badgeText: 'Bảo mật tài khoản',
      title,
      leadHtml: instructions,
      summary: {label: 'Mã xác minh', value: code, detail: 'Dùng một lần • hiệu lực 5 phút', code: true},
      footerNote: safetyNote,
      siteUrl: ctx.siteUrl,
      supportEmail: ctx.supportEmail
    })
  };
}

const attendanceTimeNote = 'Email được gửi sau khi hoàn tất điểm danh và lưu kết quả. Thời điểm nhận email không đồng nghĩa với việc học sinh đến lớp muộn vào thời điểm đó.';
const attendanceStatusLabels = {present: 'Có mặt', absent: 'Vắng mặt', late: 'Đi muộn', excused: 'Nghỉ có phép'};
const attendanceStatusColors = {
  present: {badgeBg: '#dcfce7', badgeColor: '#166534'},
  absent: {badgeBg: '#fee2e2', badgeColor: '#991b1b'},
  late: {badgeBg: '#fef3c7', badgeColor: '#92400e'},
  excused: {badgeBg: '#eaf1fc', badgeColor: '#013f93'}
};

const NOTICE_META_PREFIX_RE = /^\[\[ltch-notice:([^\]]+)\]\](?:\r?\n)?([\s\S]*)$/i;
const noticeCategoryStyles = {
  important: { label: 'Quan trọng / Khẩn', badgeText: 'Thông báo quan trọng', badgeBg: '#fee2e2', badgeColor: '#991b1b', calloutBg: '#fef2f2', calloutBorder: '#fca5a5', calloutAccent: '#dc2626' },
  schedule: { label: 'Lịch học & Học bù', badgeText: 'Thông báo lịch học', badgeBg: '#dcfce7', badgeColor: '#166534', calloutBg: '#f0fdf4', calloutBorder: '#bbf7d0', calloutAccent: '#16a34a' },
  homework: { label: 'Bài tập & Học liệu', badgeText: 'Bài tập & Học liệu', badgeBg: '#eaf1fc', badgeColor: '#17447d', calloutBg: '#f8fbff', calloutBorder: '#bfdbfe', calloutAccent: '#2563eb' },
  exam: { label: 'Kiểm tra & Đánh giá', badgeText: 'Kiểm tra & Đánh giá', badgeBg: '#fef3c7', badgeColor: '#92400e', calloutBg: '#fffbeb', calloutBorder: '#fde68a', calloutAccent: '#d97706' },
  general: { label: 'Thông báo chung', badgeText: 'Thông báo lớp học', badgeBg: '#e0f2fe', badgeColor: '#075985', calloutBg: '#f8fafc', calloutBorder: '#cbd5e1', calloutAccent: '#0284c7' }
};

function stripDiacriticsLower(text = '') {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
}

function parseNoticeEmailMeta(rawBody = '', rawTitle = '') {
  const str = String(rawBody ?? '');
  const matched = NOTICE_META_PREFIX_RE.exec(str);
  let category = 'general';
  let pinned = false;
  let cleanBody = str;
  if (matched) {
    cleanBody = matched[2] ?? '';
    for (const pair of matched[1].split('|').map(s => s.trim()).filter(Boolean)) {
      const [k, v = ''] = pair.split('=').map(s => s.trim().toLowerCase());
      if (k === 'cat' && Object.hasOwn(noticeCategoryStyles, v)) category = v;
      else if (k === 'pin') pinned = v === '1' || v === 'true';
    }
  } else {
    const combined = stripDiacriticsLower(`${rawTitle} ${str}`);
    if (/(lich hoc|hoc bu|nghi hoc|nghi buoi|doi lich|chuyen lich|thay doi lich|thoi khoa bieu|ca hoc)/.test(combined)) category = 'schedule';
    else if (/(kiem tra|thi thu|ky thi|lich thi|de thi|diem thi|bang diem|cham diem|khao sat|danh gia)/.test(combined)) category = 'exam';
    else if (/(bai tap|btvn|nop bai|tai lieu|hoc lieu|bai giang|de cuong|phieu bai)/.test(combined)) category = 'homework';
    else if (/(quan trong|khan|luu y|dac biet|bat buoc|dan do)/.test(combined)) category = 'important';
  }
  return { category, pinned, cleanBody: cleanBody.trim(), style: noticeCategoryStyles[category] };
}

const templates = {
  parent_approval_notice: {
    subject: '[Lớp Toán cô Hạnh] Đã duyệt tài khoản phụ huynh theo dõi {{class_name}}',
    body: [
      'Kính gửi Quý phụ huynh,',
      '',
      'Ban Quản trị Lớp Toán cô Hạnh trân trọng thông báo: Hồ sơ đăng ký tài khoản phụ huynh theo dõi học tập của học sinh {{full_name}} đã được phê duyệt chính thức.',
      '',
      'THÔNG TIN LIÊN KẾT HỌC TẬP',
      '- Học sinh được liên kết: {{full_name}}',
      '- Lớp theo học: {{class_name}}',
      '- Năm học: {{school_year_name}}',
      '- Lịch học định kỳ: {{schedule}}',
      '',
      'QUYỀN HẠN TRÊN TÀI KHOẢN PHỤ HUYNH',
      '- Theo dõi thông báo lớp học, lịch học và tình hình chuyên cần (điểm danh) từng buổi của học sinh được liên kết.',
      '- Xem đề bài tập, trạng thái hoàn thành và nhận xét, chấm chữa chi tiết từ giáo viên.',
      '- Xem kết quả rèn luyện tại phòng luyện đề (dành cho học sinh lớp 11, 12) và trao đổi trực tiếp với giáo viên phụ trách.',
      '',
      'Đăng nhập bằng địa chỉ email nhận thư này tại: {{action_url}}',
      'Nếu thông tin học sinh được liên kết chưa chính xác, Quý phụ huynh vui lòng phản hồi hoặc liên hệ Quản trị viên để được kiểm tra và điều chỉnh kịp thời.',
      '',
      'Trân trọng,',
      'Ban Quản trị — Lớp Toán cô Hạnh',
      'Hỗ trợ kỹ thuật: {{support_email}}'
    ].join('\n'),
    renderHtml(fields, ctx) {
      const fullName = resolveField(fields, 'full_name');
      const className = resolveField(fields, 'class_name');
      const schoolYear = resolveField(fields, 'school_year_name');
      const schedule = resolveField(fields, 'schedule');
      return renderHtmlLayout({
        preheader: `Tài khoản phụ huynh theo dõi học sinh ${fullName} (${className}) đã được kích hoạt.`,
        badgeText: 'Tài khoản phụ huynh',
        badgeBg: '#dcfce7',
        badgeColor: '#166534',
        title: 'Tài khoản phụ huynh đã được duyệt',
        greetingHtml: 'Kính gửi <strong>Quý phụ huynh</strong>,',
        leadHtml: `Quý phụ huynh có thể đăng nhập để theo dõi việc học của em <strong>${escapeHtml(fullName)}</strong>.`,
        infoTitle: 'Thông tin liên kết học sinh',
        infoRows: [
          { label: 'Học sinh được liên kết', value: fullName },
          { label: 'Lớp theo học', value: className },
          { label: 'Năm học', value: schoolYear },
          { label: 'Lịch học định kỳ', value: schedule }
        ],
        bulletsTitle: 'Tiện ích dành cho Phụ huynh trên cổng học tập',
        bullets: [
          'Theo dõi thông báo lớp học và nhật ký điểm danh chuyên cần của học sinh được liên kết.',
          'Xem nội dung bài tập, tiến độ hoàn thành và nhận xét, chấm chữa chi tiết từ giáo viên.',
          'Theo dõi kết quả rèn luyện chuyên đề và trao đổi riêng với giáo viên phụ trách.'
        ],
        ctaLabel: 'Đăng nhập Cổng Phụ huynh',
        ctaUrl: resolveField(fields, 'action_url') || buildClassActionUrl(fields, '', ctx.siteUrl),
        footerNote: 'Quý phụ huynh đăng nhập bằng chính địa chỉ email nhận thư này. Nếu thông tin học sinh được liên kết chưa đúng, vui lòng liên hệ Quản trị viên để kiểm tra.',
        siteUrl: ctx.siteUrl,
        supportEmail: ctx.supportEmail
      });
    }
  },

  lesson_reminder: {
    subject: '[Lớp Toán cô Hạnh] Sắp đến giờ học {{class_name}} lúc {{starts_at}} ({{lesson_date}})',
    body: [
      'Chào em {{full_name}},',
      '',
      'Hệ thống Lớp Toán cô Hạnh nhắc em sắp đến giờ học định kỳ của {{class_name}}.',
      '',
      'THÔNG TIN BUỔI HỌC',
      '- Lớp học: {{class_name}}',
      '- Ngày học: {{lesson_date}}',
      '- Thời gian: {{starts_at}}–{{ends_at}} (giờ Việt Nam)',
      '',
      'CHUẨN BỊ TRƯỚC GIỜ HỌC',
      '- Chuẩn bị đầy đủ sách vở, tài liệu chuyên đề, máy tính bỏ túi và bài tập đã giao.',
      '- Có mặt đúng giờ để buổi học đạt hiệu quả cao nhất.',
      '',
      'Xem thông tin lớp học và tài liệu buổi học tại: {{action_url}}',
      '',
      'Hiểu bản chất - Vững tư duy.',
      'Ban Quản trị — Lớp Toán cô Hạnh'
    ].join('\n'),
    renderHtml(fields, ctx) {
      const fullName = resolveField(fields, 'full_name');
      const className = resolveField(fields, 'class_name');
      const lessonDate = resolveField(fields, 'lesson_date');
      const startsAt = resolveField(fields, 'starts_at');
      const endsAt = resolveField(fields, 'ends_at');
      return renderHtmlLayout({
        preheader: `Nhắc lịch học ${className}: ${startsAt}–${endsAt} ngày ${lessonDate} (giờ Việt Nam).`,
        badgeText: 'Lịch học',
        badgeBg: '#e0f2fe',
        badgeColor: '#075985',
        title: `Sắp đến giờ học ${className}`,
        greetingHtml: `Chào em <strong>${escapeHtml(fullName)}</strong>,`,
        summary: {label: `Ngày ${lessonDate}`, value: `${startsAt}–${endsAt}`, detail: 'Giờ Việt Nam'},
        bulletsTitle: 'Chuẩn bị trước buổi học',
        bullets: ['Chuẩn bị vở ghi, bài tập và những câu hỏi em muốn trao đổi với cô.'],
        ctaLabel: 'Mở lớp học',
        ctaUrl: resolveField(fields, 'action_url') || buildClassActionUrl(fields, 'materials', ctx.siteUrl),
        siteUrl: ctx.siteUrl,
        supportEmail: ctx.supportEmail
      });
    }
  },

  attendance_saved: {
    subject: '[Lớp Toán cô Hạnh] Kết quả điểm danh {{class_name}} ngày {{lesson_date}}',
    body: [
      'Kính gửi Quý phụ huynh và em {{student_name}},',
      '',
      'Kết quả điểm danh của buổi học đã được lưu.',
      'Học sinh: {{student_name}}',
      'Lớp: {{class_name}}',
      'Ngày học: {{lesson_date}}',
      'Kết quả: {{status_label}}',
      '',
      'Xem kết quả điểm danh trên hệ thống: {{action_url}}',
      '',
      `Lưu ý: ${attendanceTimeNote}`,
      '',
      'Ban Quản trị — Lớp Toán cô Hạnh'
    ].join('\n'),
    renderHtml(fields, ctx) {
      const student = resolveField(fields, 'student_name');
      const result = resolveField(fields, 'status_label');
      return renderHtmlLayout({
        ...attendanceStatusColors[fields.attendance_status],
        preheader: 'Xem kết quả điểm danh đã lưu của buổi học.',
        title: 'Kết quả điểm danh',
        greetingHtml: `Kính gửi Quý phụ huynh và em <strong>${escapeHtml(student)}</strong>,`,
        summary: {label: 'Trạng thái đã lưu', value: result},
        infoTitle: 'Thông tin buổi học',
        infoRows: [
          {label: 'Học sinh', value: student},
          {label: 'Lớp', value: resolveField(fields, 'class_name')},
          {label: 'Ngày học', value: resolveField(fields, 'lesson_date')}
        ],
        footerNote: `<strong>Lưu ý:</strong> ${escapeHtml(attendanceTimeNote)}`,
        ctaLabel: 'Xem nhật ký điểm danh',
        ctaUrl: resolveField(fields, 'action_url') || buildClassActionUrl(fields, 'attendance', ctx.siteUrl),
        siteUrl: ctx.siteUrl,
        supportEmail: ctx.supportEmail
      });
    }
  },

  revision_request: {
    subject: '[Lớp Toán cô Hạnh] Yêu cầu cập nhật thông tin hồ sơ đăng ký lớp học',
    body: [
      'Kính gửi Quý phụ huynh và em {{full_name}},',
      '',
      'Ban Quản trị Lớp Toán cô Hạnh đã tiếp nhận hồ sơ đăng ký tham gia lớp học của em. Qua quá trình rà soát, Quản trị viên nhận thấy có một số thông tin cần được điều chỉnh hoặc bổ sung để việc xếp lớp và quản lý học tập được chính xác nhất.',
      '',
      'NỘI DUNG CẦN CẬP NHẬT / BỔ SUNG:',
      '----------------------------------------------------------------------',
      '{{admin_notes}}',
      '----------------------------------------------------------------------',
      '',
      'HƯỚNG DẪN CẬP NHẬT HỒ SƠ:',
      '1. Truy cập Cổng học tập tại: {{onboarding_url}}',
      '2. Đăng nhập bằng địa chỉ email này (hệ thống giữ nguyên các thông tin đã kê khai trước đó).',
      '3. Điều chỉnh theo hướng dẫn của Quản trị viên và nhấn "Gửi lại hồ sơ để xét duyệt".',
      '',
      'Quản trị viên sẽ ưu tiên kiểm tra và kích hoạt tài khoản ngay khi nhận được hồ sơ cập nhật từ em.',
      '',
      'Trân trọng,',
      'Ban Quản trị — Lớp Toán cô Hạnh',
      'Hỗ trợ kỹ thuật: {{support_email}}'
    ].join('\n'),
    renderHtml(fields, ctx) {
      const fullName = resolveField(fields, 'full_name');
      const className = resolveField(fields, 'class_name');
      const schoolYear = resolveField(fields, 'school_year_name');
      const rawNotes = resolveField(fields, 'admin_notes') || 'Vui lòng kiểm tra và bổ sung đầy đủ thông tin hồ sơ.';
      const adminNotes = rawNotes.length > 500 ? `${rawNotes.slice(0, 500)}…` : rawNotes;
      const infoRows = [{ label: 'Học sinh đăng ký', value: fullName }];
      if (className) infoRows.push({ label: 'Lớp đăng ký', value: className });
      if (schoolYear) infoRows.push({ label: 'Năm học', value: schoolYear });
      return renderHtmlLayout({
        preheader: `Hồ sơ đăng ký của ${fullName} cần được cập nhật một số thông tin để hoàn tất xét duyệt.`,
        badgeText: 'Hồ sơ đăng ký',
        badgeBg: '#fef3c7',
        badgeColor: '#92400e',
        title: 'Hồ sơ cần cập nhật',
        greetingHtml: `Kính gửi Quý phụ huynh và em <strong>${escapeHtml(fullName)}</strong>,`,
        leadHtml: 'Ban Quản trị đã nhận hồ sơ của em. Vui lòng cập nhật phần được yêu cầu dưới đây để tiếp tục xét duyệt.',
        infoTitle: 'Thông tin hồ sơ',
        infoRows,
        calloutHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
          <tr><td bgcolor="#fffbeb" style="background-color:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:8px;padding:16px 18px;">
            <div style="font-size:13px;font-weight:700;line-height:1.4;color:#92400e;margin-bottom:6px;">Nội dung Quản trị viên yêu cầu chỉnh sửa</div>
            <div style="font-size:14px;line-height:1.6;color:#78350f;white-space:pre-line;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(adminNotes)}</div>
          </td></tr>
        </table>`,
        bulletsTitle: 'Các bước thực hiện nhanh',
        bullets: [
          'Truy cập Cổng học tập và đăng nhập bằng chính địa chỉ email nhận thư này.',
          'Hệ thống sẽ hiển thị lại biểu mẫu cùng các thông tin đã điền trước đó.',
          'Cập nhật mục được yêu cầu và nhấn "Gửi lại hồ sơ để xét duyệt".'
        ],
        ctaLabel: 'Cập nhật hồ sơ ngay',
        ctaUrl: ctx.onboardingUrl,
        footerNote: 'Hồ sơ sau khi gửi lại sẽ được Quản trị viên ưu tiên xét duyệt và kích hoạt sớm nhất.',
        siteUrl: ctx.siteUrl,
        supportEmail: ctx.supportEmail
      });
    }
  },

  approval_notice: {
    subject: '[Lớp Toán cô Hạnh] Thông báo: Hồ sơ đăng ký đã được phê duyệt thành công',
    body: [
      'Kính gửi Quý phụ huynh và em {{full_name}},',
      '',
      'Ban Quản trị Lớp Toán cô Hạnh trân trọng thông báo: Hồ sơ đăng ký tham gia lớp học của em đã được phê duyệt chính thức!',
      '',
      'THÔNG TIN LỚP HỌC ĐƯỢC PHÂN CÔNG',
      '- Học sinh: {{full_name}}',
      '- Lớp học: {{class_name}}',
      '- Năm học: {{school_year_name}}',
      '- Giáo viên phụ trách môn Toán: Cô Hạnh',
      '- Lịch học định kỳ: {{schedule}}',
      '',
      'QUYỀN LỢI HỌC TẬP ĐÃ ĐƯỢC KÍCH HOẠT',
      '- Truy cập kho bài giảng chuyên đề và tải tài liệu PDF bổ trợ của lớp.',
      '- Nộp bài tập về nhà trực tuyến và xem nhận xét, chấm chữa chi tiết từ giáo viên.',
      '- Rèn luyện tại phòng luyện đề trắc nghiệm trực tuyến có hướng dẫn giải chi tiết (dành cho học sinh lớp 11, 12).',
      '- Theo dõi lịch học, thông báo lớp và nhật ký điểm danh chuyên cần từng buổi.',
      '',
      'Đăng nhập vào lớp học ngay tại: {{action_url}}',
      '(Sử dụng địa chỉ email nhận thư này để đăng nhập và nhận mã xác minh vào lớp học).',
      '',
      'Kính chúc em một năm học môn Toán nhiều niềm vui, nắm vững bản chất và tự tin chinh phục mọi kỳ thi!',
      '',
      'Trân trọng,',
      'Ban Quản trị — Lớp Toán cô Hạnh',
      'Hỗ trợ kỹ thuật: {{support_email}}'
    ].join('\n'),
    renderHtml(fields, ctx) {
      const fullName = resolveField(fields, 'full_name');
      const className = resolveField(fields, 'class_name');
      const schoolYear = resolveField(fields, 'school_year_name');
      const schedule = resolveField(fields, 'schedule');
      return renderHtmlLayout({
        preheader: `Chúc mừng ${fullName}! Hồ sơ đăng ký vào ${className} (${schoolYear}) đã được phê duyệt chính thức.`,
        badgeText: 'Hồ sơ học sinh',
        badgeBg: '#dcfce7',
        badgeColor: '#166534',
        title: 'Hồ sơ đăng ký đã được duyệt',
        greetingHtml: `Kính gửi Quý phụ huynh và em <strong>${escapeHtml(fullName)}</strong>,`,
        leadHtml: 'Em có thể đăng nhập vào cổng học tập để xem lớp và lịch học.',
        infoTitle: 'Thông tin phân lớp chính thức',
        infoRows: [
          { label: 'Học sinh', value: fullName },
          { label: 'Lớp học', value: className },
          { label: 'Năm học', value: schoolYear },
          { label: 'Giáo viên phụ trách', value: 'Cô Hạnh (Môn Toán)' },
          { label: 'Lịch học định kỳ', value: schedule }
        ],
        bulletsTitle: 'Quyền lợi học tập đã mở trên hệ thống',
        bullets: [
          'Xem kho bài giảng chuyên đề và tải tài liệu PDF bổ trợ theo từng buổi học.',
          'Nộp bài tập trực tuyến và nhận chấm chữa, nhận xét chi tiết từ giáo viên.',
          'Tham gia phòng luyện đề chuẩn cấu trúc với kết quả và lời giải chi tiết (dành cho học sinh lớp 11, 12).',
          'Theo dõi lịch học hàng tuần, thông báo mới và nhật ký chuyên cần.'
        ],
        ctaLabel: 'Vào Không gian lớp học',
        ctaUrl: resolveField(fields, 'action_url') || buildClassActionUrl(fields, '', ctx.siteUrl),
        footerNote: 'Kính chúc em một năm học môn Toán nhiều tiến bộ, nắm vững bản chất và tự tin chinh phục các kỳ thi!',
        siteUrl: ctx.siteUrl,
        supportEmail: ctx.supportEmail
      });
    }
  },

  urgent_admin_alert: {
    subject: '[LTCH - YÊU CẦU DUYỆT GẤP] Học sinh {{full_name}} xin vào lớp {{class_name}}',
    body: [
      'Kính gửi Quản trị viên Lớp Toán cô Hạnh,',
      '',
      'Hệ thống vừa ghi nhận yêu cầu ưu tiên xét duyệt hồ sơ đăng ký lớp học:',
      '',
      'THÔNG TIN HỒ SƠ YÊU CẦU DUYỆT GẤP',
      '- Học sinh: {{full_name}}',
      '- Lớp đăng ký: {{class_name}}',
      '- Năm học: {{school_year_name}}',
      '- Thời điểm gửi yêu cầu: {{request_time}}',
      '',
      'Vui lòng mở trang Quản trị hệ thống để kiểm tra và phê duyệt hồ sơ:',
      '{{enrollments_url}}',
      '',
      'Trân trọng,',
      'Hệ thống thông báo tự động — Lớp Toán cô Hạnh'
    ].join('\n'),
    renderHtml(fields, ctx) {
      const fullName = resolveField(fields, 'full_name');
      const className = resolveField(fields, 'class_name');
      const schoolYear = resolveField(fields, 'school_year_name');
      const requestTime = resolveField(fields, 'request_time') || 'Vừa xong';
      return renderHtmlLayout({
        preheader: `[Duyệt gấp] Hồ sơ học sinh ${fullName} đăng ký vào ${className} (${schoolYear}) đang chờ xét duyệt.`,
        badgeText: 'Hồ sơ ưu tiên',
        badgeBg: '#fee2e2',
        badgeColor: '#991b1b',
        title: `Yêu cầu ưu tiên duyệt hồ sơ: ${fullName}`,
        greetingHtml: 'Kính gửi <strong>Quản trị viên Lớp Toán cô Hạnh</strong>,',
        leadHtml: 'Học sinh hoặc phụ huynh đã yêu cầu ưu tiên xem xét hồ sơ đang chờ duyệt.',
        infoTitle: 'Tóm tắt hồ sơ chờ duyệt',
        infoRows: [
          { label: 'Họ và tên học sinh', value: fullName },
          { label: 'Lớp đăng ký', value: className },
          { label: 'Năm học', value: schoolYear },
          { label: 'Thời điểm yêu cầu', value: requestTime }
        ],
        ctaLabel: 'Mở Trang Quản trị để xét duyệt',
        ctaUrl: ctx.enrollmentsUrl,
        siteUrl: ctx.siteUrl,
        supportEmail: ctx.supportEmail
      });
    }
  },

  staff_request: {
    subject: '[Lớp Toán cô Hạnh] Yêu cầu tài khoản {{role_label}} — {{full_name}}',
    body: [
      'Kính gửi Quản trị viên Lớp Toán cô Hạnh,',
      '',
      'Một tài khoản đã xác minh email vừa gửi yêu cầu được xét duyệt vai trò {{role_label}} trên hệ thống.',
      '',
      'THÔNG TIN TÀI KHOẢN ĐĂNG KÝ NHÂN SỰ',
      '- Họ và tên: {{full_name}}',
      '- Địa chỉ Email: {{user_email}}',
      '- Vai trò đề nghị cấp: {{role_label}}',
      '',
      'Mở Quản trị hệ thống để xem xét và phân quyền tại:',
      '{{admin_staff_url}}',
      '',
      'Trân trọng,',
      'Hệ thống thông báo tự động — Lớp Toán cô Hạnh'
    ].join('\n'),
    renderHtml(fields, ctx) {
      const fullName = resolveField(fields, 'full_name');
      const userEmail = resolveField(fields, 'user_email');
      const roleLabel = resolveField(fields, 'role_label') || 'Nhân sự';
      return renderHtmlLayout({
        preheader: `Yêu cầu xét duyệt vai trò ${roleLabel} từ ${fullName} (${userEmail}).`,
        badgeText: 'Quản trị nhân sự',
        badgeBg: '#ede9fe',
        badgeColor: '#5b21b6',
        title: `Yêu cầu phê duyệt tài khoản ${roleLabel}`,
        greetingHtml: 'Kính gửi <strong>Quản trị viên Lớp Toán cô Hạnh</strong>,',
        leadHtml: 'Người yêu cầu đã xác minh địa chỉ email. Vui lòng xem hồ sơ trước khi cấp quyền.',
        infoTitle: 'Thông tin người yêu cầu',
        infoRows: [
          { label: 'Họ và tên hiển thị', value: fullName },
          { label: 'Địa chỉ Email', value: userEmail },
          { label: 'Vai trò đăng ký', value: roleLabel }
        ],
        ctaLabel: 'Mở Quản trị nhân sự',
        ctaUrl: ctx.adminStaffUrl,
        footerNote: 'Vui lòng kiểm tra danh tính nhân sự trước khi kích hoạt quyền truy cập lớp học.',
        siteUrl: ctx.siteUrl,
        supportEmail: ctx.supportEmail
      });
    }
  },

  class_notice: {
    subject: '[Lớp Toán cô Hạnh] Thông báo mới {{class_name}}: {{short_title}}',
    body: [
      'Chào em {{student_name}},',
      '',
      '{{sender_name}} vừa đăng một thông báo mới tại {{class_name}}.',
      '',
      'THÔNG TIN THÔNG BÁO',
      '- Lớp học: {{class_name}}',
      '- Phân loại: {{category_label}}',
      '- Người đăng: {{sender_name}}',
      '- Thời điểm đăng: {{posted_at}}',
      '',
      'TIÊU ĐỀ: {{notice_title}}',
      '----------------------------------------------------------------------',
      '{{clean_body}}',
      '----------------------------------------------------------------------',
      '{{attachment_summary}}',
      '',
      'Xem thông báo và tệp đính kèm tại: {{notice_url}}',
      '',
      'Ban Quản trị — Lớp Toán cô Hạnh',
      'Hỗ trợ kỹ thuật: {{support_email}}'
    ].join('\n'),
    renderHtml(fields, ctx) {
      const studentName = resolveField(fields, 'student_name') || 'em';
      const className = resolveField(fields, 'class_name');
      const senderName = resolveField(fields, 'sender_name') || 'Giáo viên Lớp Toán cô Hạnh';
      const postedAt = resolveField(fields, 'posted_at') || 'Vừa đăng';
      const noticeTitle = resolveField(fields, 'notice_title') || 'Thông báo mới';
      const cleanBody = resolveField(fields, 'clean_body');
      const categoryDisplay = resolveField(fields, 'category_label') || 'Thông báo chung';
      const attachments = Array.isArray(fields.attachments) ? fields.attachments : [];
      const meta = fields._noticeMeta || parseNoticeEmailMeta(fields.notice_body, noticeTitle);
      return renderHtmlLayout({
        preheader: `[${meta.style.label}] ${noticeTitle} — ${className}`,
        badgeText: meta.style.badgeText,
        badgeBg: meta.style.badgeBg,
        badgeColor: meta.style.badgeColor,
        title: `Thông báo mới — ${className}`,
        greetingHtml: `Chào em <strong>${escapeHtml(studentName)}</strong>,`,
        leadHtml: `<strong>${escapeHtml(senderName)}</strong> vừa đăng thông báo mới tại bảng tin <strong>${escapeHtml(className)}</strong>.`,
        infoTitle: 'Chi tiết thông báo',
        infoRows: [
          { label: 'Lớp học', value: className },
          { label: 'Phân loại', value: categoryDisplay },
          { label: 'Người đăng', value: senderName },
          { label: 'Thời điểm đăng', value: postedAt }
        ],
        calloutHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
          <tr><td bgcolor="${meta.style.calloutBg}" style="background-color:${meta.style.calloutBg};border:1px solid ${meta.style.calloutBorder};border-left:4px solid ${meta.style.calloutAccent};border-radius:8px;padding:16px 18px;">
            <div style="font-size:16px;font-weight:700;color:#082c60;line-height:1.4;margin-bottom:8px;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(noticeTitle)}</div>
            <div style="font-size:15px;line-height:1.62;color:#1e3350;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;">${escapeHtml(cleanBody).replace(/\r\n?|\n/g, '<br>')}</div>
          </td></tr>
        </table>`,
        bulletsTitle: attachments.length ? 'Tệp đính kèm' : '',
        bullets: attachments.map(attachment => String(attachment.name || 'Tệp đính kèm')),
        ctaLabel: /^[A-Za-z0-9_-]{1,128}$/.test(resolveField(fields, 'class_id')) ? 'Mở bảng tin lớp học' : 'Xem thông báo trên Cổng học tập',
        ctaUrl: resolveField(fields, 'notice_url') || ctx.overviewUrl,
        footerNote: 'Email được gửi tự động tới học sinh thuộc phạm vi thông báo khi Quản trị viên, Giáo viên hoặc Trợ giảng đăng thông báo mới.',
        siteUrl: ctx.siteUrl,
        supportEmail: ctx.supportEmail
      });
    }
  }
};

function renderNotification(type, fields = {}, options = {}) {
  const t = templates[type];
  if (!t) throw Error('Invalid template');
  const ctx = resolveMailContext(options);
  fields = {
    ...fields,
    site_url: ctx.siteUrl,
    overview_url: ctx.overviewUrl,
    login_url: ctx.loginUrl,
    onboarding_url: ctx.onboardingUrl,
    admin_staff_url: ctx.adminStaffUrl,
    enrollments_url: ctx.enrollmentsUrl,
    support_email: ctx.supportEmail
  };
  if (type === 'attendance_saved') {
    if (!Object.hasOwn(attendanceStatusLabels, fields.attendance_status)) throw Error('Invalid attendance status');
    fields = { ...fields, status_label: attendanceStatusLabels[fields.attendance_status], action_url: buildClassActionUrl(fields, 'attendance', ctx.siteUrl) };
  } else if (type === 'lesson_reminder') {
    fields = { ...fields, action_url: buildClassActionUrl(fields, 'materials', ctx.siteUrl) };
  } else if (type === 'approval_notice' || type === 'parent_approval_notice') {
    fields = { ...fields, action_url: buildClassActionUrl(fields, '', ctx.siteUrl) };
  } else if (type === 'revision_request') {
    fields = { ...fields, action_url: ctx.onboardingUrl };
  } else if (type === 'urgent_admin_alert') {
    fields = { ...fields, action_url: ctx.enrollmentsUrl };
  } else if (type === 'staff_request') {
    fields = { ...fields, action_url: ctx.adminStaffUrl };
  } else if (type === 'class_notice') {
    const parsed = parseNoticeEmailMeta(fields.notice_body, fields.notice_title);
    const className = resolveField(fields, 'class_name');
    const rawTitle = String(fields.notice_title || '').replace(/\s+/g, ' ').trim() || 'Thông báo lớp học';
    const prefixLen = (`[Lớp Toán cô Hạnh] Thông báo mới ${className}: `).length;
    const maxShort = Math.max(20, Math.min(120, 240 - prefixLen));
    const shortTitle = rawTitle.length > maxShort ? `${rawTitle.slice(0, maxShort - 1)}…` : rawTitle;
    const rawCleanBody = parsed.cleanBody || rawTitle;
    const cleanBody = rawCleanBody;
    const categoryDisplay = parsed.pinned ? `Ghim quan trọng · ${parsed.style.label}` : parsed.style.label;
    const attachments = Array.isArray(fields.attachments) ? fields.attachments.filter(item => item && typeof item.name === 'string').slice(0, 8) : [];
    const classId = resolveField(fields, 'class_id');
    const noticeUrl = /^[A-Za-z0-9_-]{1,128}$/.test(classId)
      ? `${ctx.siteUrl}/class/${classId}/notifications`
      : ctx.overviewUrl;
    fields = {
      ...fields,
      student_name: resolveField(fields, 'student_name') || 'em',
      sender_name: resolveField(fields, 'sender_name') || 'Giáo viên Lớp Toán cô Hạnh',
      posted_at: resolveField(fields, 'posted_at') || 'Vừa đăng',
      notice_title: rawTitle,
      short_title: shortTitle,
      clean_body: cleanBody,
      attachments,
      attachment_summary: attachments.length ? `Tệp đính kèm:\n${attachments.map(item => `- ${item.name}`).join('\n')}` : '',
      notice_url: noticeUrl,
      category_label: categoryDisplay,
      _noticeMeta: parsed
    };
  }
  const subject = renderText(t.subject, fields);
  const body = renderText(t.body, fields);
  const htmlBody = typeof t.renderHtml === 'function' ? t.renderHtml(fields, ctx) : undefined;
  return htmlBody ? { subject, body, htmlBody } : { subject, body };
}

module.exports = { renderNotification, renderOtpEmail, parseNoticeEmailMeta };
