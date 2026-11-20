// Không gian Bảng tin & Tổng quan Lớp học (Tab Thông báo)
// Tuân thủ hệ thống thiết kế LTCH Academic Design System 2.0 và CSP (không dùng inline style).

import { classGrade } from '../shared/classroom.mjs';
import { stripLegacyNoticeReads } from '../shared/notice-reads.mjs';
import { createActionMenu } from './action-menu.mjs';
import {
  computeAttendanceRate,
  formatLessonDateShort,
  groupAttendanceByDate
} from './attendance-workspace.mjs';

export const NOTICE_CATEGORIES = [
  {
    key: 'important',
    label: 'Quan trọng / Khẩn',
    pillLabel: 'Quan trọng',
    badgeClass: 'badge-error',
    iconName: 'alert'
  },
  {
    key: 'schedule',
    label: 'Lịch học & Học bù',
    pillLabel: 'Lịch học',
    badgeClass: 'badge-mint',
    iconName: 'attendance'
  },
  {
    key: 'homework',
    label: 'Bài tập & Học liệu',
    pillLabel: 'Bài tập & Học liệu',
    badgeClass: 'badge-primary',
    iconName: 'assignment'
  },
  {
    key: 'exam',
    label: 'Kiểm tra & Đánh giá',
    pillLabel: 'Kiểm tra',
    badgeClass: 'badge-warning',
    iconName: 'practice'
  },
  {
    key: 'general',
    label: 'Thông báo chung',
    pillLabel: 'Thông báo chung',
    badgeClass: 'badge-info',
    iconName: 'notice'
  }
];

const CATEGORY_MAP = Object.fromEntries(NOTICE_CATEGORIES.map(item => [item.key, item]));
const VALID_CATEGORY_KEYS = new Set(NOTICE_CATEGORIES.map(item => item.key));
const NOTICE_META_PREFIX_RE = /^\[\[ltch-notice:([^\]]+)\]\](?:\r?\n)?([\s\S]*)$/i;
const COLLAPSE_BODY_THRESHOLD = 500;
const opsPracticeStatsCache = new Map();
const opsForumStatsCache = new Map();

export function invalidateOpsPracticeStatsCache() {
  opsPracticeStatsCache.clear();
}

export function invalidateOpsForumStatsCache() {
  opsForumStatsCache.clear();
}

export function computeClassForumOpsStats(items = []) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const unanswered = list.filter(
    p => p && !p.resolved && !p.accepted_comment_id && !p.locked && !p.has_staff_reply
  ).length;
  const solved = list.filter(p => p && Boolean(p.resolved || p.accepted_comment_id)).length;
  return {
    total,
    unanswered,
    solved,
    badgeText: unanswered > 0 ? `${unanswered} chờ trả lời` : total > 0 ? 'Đã giải đáp hết' : 'Sẵn sàng',
    badgeClass: unanswered > 0 ? 'badge-warning' : total > 0 ? 'badge-success' : 'badge-info',
    valueText: String(total),
    unitText: 'câu hỏi',
    summaryText:
      total > 0
        ? `${unanswered} câu chờ giải đáp · ${solved} câu đã giải đáp.`
        : 'Chưa có câu hỏi nào trên diễn đàn lớp.',
    summaryItems:
      total > 0
        ? [
            { value: String(unanswered), label: 'chờ giải đáp', valueFirst: true, tone: unanswered > 0 ? 'warn' : '' },
            { value: String(solved), label: 'đã giải đáp', valueFirst: true, tone: solved > 0 ? 'positive' : '' }
          ]
        : []
  };
}

export function computeClassPracticeOpsStats(exams = [], grade) {
  const g = Number(grade);
  const published = (Array.isArray(exams) ? exams : []).filter(
    ex => ex && !ex.isPastPool && (ex.status || 'published') === 'published'
  );
  const thptqgCount = published.filter(
    ex => ex.examType === 'thptqg' && (Number(ex.targetGrade) || 12) === g
  ).length;
  const hsaCount = g === 12 ? published.filter(
    ex => ex.examType === 'hsa' && (Number(ex.targetGrade) || 12) === g
  ).length : 0;
  const tsaCount = g === 11 || g === 12 ? published.filter(ex => ex.examType === 'tsa').length : 0;

  let summaryText;
  let summaryItems;
  if (g === 12) {
    summaryText = `THPTQG: ${thptqgCount} đề · HSA: ${hsaCount} đề · TSA: ${tsaCount} đề`;
    summaryItems = [
      { label: 'THPTQG', value: String(thptqgCount) },
      { label: 'HSA', value: String(hsaCount) },
      { label: 'TSA', value: String(tsaCount) }
    ];
  } else if (g === 11) {
    summaryText = `Toán 11 (THPTQG): ${thptqgCount} đề · TSA: ${tsaCount} đề`;
    summaryItems = [
      { label: 'THPTQG', value: String(thptqgCount) },
      { label: 'TSA', value: String(tsaCount) }
    ];
  } else {
    summaryText = `Toán 10 (THPTQG): ${thptqgCount} đề`;
    summaryItems = [
      { label: 'THPTQG', value: `${thptqgCount} đề` }
    ];
  }

  return {
    thptqgCount,
    hsaCount,
    tsaCount,
    badgeText: `Kho Khối ${g}`,
    valueText: String(thptqgCount + hsaCount + tsaCount),
    unitText: 'đề',
    summaryText,
    summaryItems
  };
}

function stripDiacriticsLower(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

function noticeEl(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      node.className = v;
    } else if (k === 'text') {
      node.textContent = v;
    } else if (v === true) {
      node.setAttribute(k, '');
    } else if (k in node && !k.includes('-') && k !== 'list' && k !== 'type') {
      node[k] = v;
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
  return node;
}

/**
 * Suy luận phân loại thông báo từ tiêu đề và nội dung đối với các thông báo cũ chưa gắn metadata.
 */
function inferNoticeCategory(rawTitle = '', rawBody = '') {
  const combined = stripDiacriticsLower(`${rawTitle} ${rawBody}`);
  if (!combined) return 'general';
  if (/(lich hoc|hoc bu|nghi hoc|nghi buoi|doi lich|chuyen lich|thay doi lich|thoi khoa bieu|ca hoc)/.test(combined)) {
    return 'schedule';
  }
  if (/(kiem tra|thi thu|ky thi|lich thi|de thi|diem thi|bang diem|cham diem|khao sat|danh gia)/.test(combined)) {
    return 'exam';
  }
  if (/(bai tap|btvn|nop bai|tai lieu|hoc lieu|bai giang|de cuong|phieu bai)/.test(combined)) {
    return 'homework';
  }
  if (/(quan trong|khan|luu y|dac biet|bat buoc|dan do)/.test(combined)) {
    return 'important';
  }
  return 'general';
}

/**
 * Lấy thông tin hiển thị của một phân loại thông báo.
 */
export function getNoticeCategoryMeta(category = 'general') {
  return CATEGORY_MAP[category] || CATEGORY_MAP.general;
}

/**
 * Đóng gói metadata phân loại và trạng thái ghim vào phần đầu nội dung thông báo.
 */
export function encodeNoticeMeta({ category = 'general', pinned = false, body = '' } = {}) {
  const safeCategory = VALID_CATEGORY_KEYS.has(category) ? category : 'general';
  const pinValue = pinned ? '1' : '0';
  const rawStr = String(body ?? '');
  const matched = NOTICE_META_PREFIX_RE.exec(rawStr);
  const cleanBody = (matched ? matched[2] : rawStr).replace(/^\r?\n/, '');
  const header = `[[ltch-notice:cat=${safeCategory}|pin=${pinValue}]]`;
  return cleanBody ? `${header}\n${cleanBody}` : header;
}

/**
 * Tách metadata phân loại, trạng thái ghim và nội dung sạch từ bản ghi thông báo.
 */
export function decodeNoticeMeta(rawBody = '', rawTitle = '') {
  const str = stripLegacyNoticeReads(rawBody ?? '');
  const matched = NOTICE_META_PREFIX_RE.exec(str);
  if (matched) {
    const pairs = matched[1].split('|').map(part => part.trim()).filter(Boolean);
    let category = 'general';
    let pinned = false;
    for (const pair of pairs) {
      const [rawKey, rawVal = ''] = pair.split('=').map(s => s.trim().toLowerCase());
      if (rawKey === 'cat' && VALID_CATEGORY_KEYS.has(rawVal)) {
        category = rawVal;
      } else if (rawKey === 'pin') {
        pinned = rawVal === '1' || rawVal === 'true';
      }
    }
    return {
      category,
      categoryMeta: getNoticeCategoryMeta(category),
      pinned,
      cleanBody: matched[2] ?? '',
      hasExplicitMeta: true
    };
  }
  const inferred = inferNoticeCategory(rawTitle, str);
  return {
    category: inferred,
    categoryMeta: getNoticeCategoryMeta(inferred),
    pinned: false,
    cleanBody: str,
    hasExplicitMeta: false
  };
}

/**
 * Định dạng thời gian tương đối tiếng Việt cho thông báo lớp học.
 */
export function formatRelativeNoticeTimeVi(timestampMs, nowMs = Date.now()) {
  const ts = Number(timestampMs);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffMs = Math.max(0, Number(nowMs) - ts);
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Vừa đăng';
  if (diffMins < 60) return `${diffMins} phút trước`;
  const diffHours = Math.floor(diffMs / 3_600_000);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 30) return `${diffDays} ngày trước`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} tháng trước`;
  return `${Math.floor(diffDays / 365)} năm trước`;
}

/**
 * Tạo danh sách mẫu soạn nhanh thông báo theo ngữ cảnh lớp học hiện tại.
 */
export function buildNoticeTemplates({ className = 'Lớp học', schedule = '' } = {}) {
  const safeClass = String(className || 'Lớp học').trim();
  const safeSchedule = String(schedule || '').trim();
  const scheduleLine = safeSchedule ? `Lịch học cố định hiện tại: ${safeSchedule}.` : 'Lịch học chi tiết sẽ được cập nhật trong mục Lịch học.';
  return [
    {
      id: 'schedule',
      label: 'Lịch học / Học bù',
      category: 'schedule',
      pinned: true,
      title: `Thông báo lịch học ${safeClass}`,
      body: `Chào các em học sinh và phụ huynh ${safeClass},\n\n${scheduleLine}\n- Thời gian buổi học thay đổi / học bù: ...\n- Nội dung trọng tâm cần chuẩn bị: ...\n\nCác em chú ý sắp xếp thời gian tham gia đầy đủ và đúng giờ.`
    },
    {
      id: 'homework',
      label: 'Nhắc nộp BTVN',
      category: 'homework',
      pinned: false,
      title: `Nhắc nhở hoàn thành Bài tập về nhà · ${safeClass}`,
      body: `Cô nhắc các em học sinh ${safeClass} hoàn thành đầy đủ Bài tập về nhà của buổi học gần nhất.\n\n- Hạn nộp bài: ...\n- Yêu cầu trình bày: Giải chi tiết, chụp ảnh rõ nét hoặc xuất PDF nộp tại mục Bài tập.\n\nNếu có câu khó chưa làm được, các em chụp đề gửi lên mục Diễn đàn để cùng trao đổi.`
    },
    {
      id: 'exam',
      label: 'Lịch kiểm tra định kỳ',
      category: 'exam',
      pinned: true,
      title: `Thông báo lịch kiểm tra định kỳ · ${safeClass}`,
      body: `Thông báo đến toàn thể học sinh ${safeClass} về bài kiểm tra đánh giá định kỳ:\n\n- Thời gian làm bài: ...\n- Phạm vi kiến thức ôn tập: ...\n- Hình thức: Làm trực tuyến tại mục Phòng luyện (hoặc trực tiếp tại lớp).\n\nCác em ôn kỹ lý thuyết trọng tâm và các dạng bài đã chữa trên lớp.`
    },
    {
      id: 'important',
      label: 'Dặn dò trước buổi học',
      category: 'important',
      pinned: false,
      title: `Dặn dò quan trọng trước buổi học · ${safeClass}`,
      body: `Các em học sinh ${safeClass} lưu ý chuẩn bị trước khi vào buổi học tới:\n\n1. Xem lại phần ghi chú và ví dụ mẫu của buổi trước.\n2. Tải hoặc in sẵn phiếu tài liệu trong mục Bài giảng.\n3. Có mặt trước giờ học 5–10 phút để ổn định lớp.\n\nChúc các em có một buổi học hiệu quả!`
    }
  ];
}

function createSearchSvg() {
  const wrap = noticeEl('span', { class: 'notices-search-icon', 'aria-hidden': 'true' });
  wrap.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  return wrap;
}

function parseScheduleSlots(rawSchedule = '') {
  return String(rawSchedule || '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map(slot => {
      const parts = slot.split('·').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return { day: parts[0], time: parts.slice(1).join(' · ') };
      }
      const colonMatch = /^([^:]+?):\s+(.+)$/.exec(slot);
      if (colonMatch) {
        return { day: colonMatch[1].trim(), time: colonMatch[2].trim() };
      }
      return { day: slot, time: '' };
    });
}

/**
 * Định dạng nhãn tóm tắt lượt đã xem hiển thị trên thẻ thông báo cho Ban điều hành.
 */
export function formatNoticeReadSummaryLabel(summary = null) {
  const toCount = value => {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const totalSeen = toCount(summary?.total_seen);
  const studentSeen = toCount(summary?.student_seen);
  const totalStudents = toCount(summary?.total_students);
  const parentSeen = toCount(summary?.parent_seen);
  const otherSeen = toCount(summary?.other_seen);

  if (totalStudents > 0) {
    const parts = [`Đã xem: ${studentSeen}/${totalStudents} HS`];
    if (parentSeen > 0) parts.push(`${parentSeen} PH`);
    if (otherSeen > 0) parts.push(`+${otherSeen}`);
    return parts.join(' · ');
  }
  return `Đã xem: ${totalSeen}`;
}

/**
 * Render toàn bộ giao diện Tab Thông báo (Không gian Bảng tin & Tổng quan Lớp học).
 */
export function renderClassNoticesWorkspace({
  root,
  workspace,
  staffView = false,
  isArchived = false,
  fmt = v => String(v || ''),
  icon = () => null,
  btn,
  empty,
  personResolver = uid => uid || 'Thành viên',
  renderMathText = null,
  renderAttachments = () => null,
  onOpenNoticeModal = () => {},
  onTogglePinNotice = () => {},
  onMarkNoticeRead = null,
  onInspectNoticeReads = null
}) {
  if (!root || !workspace) return;
  root.replaceChildren();

  const p = workspace.permissions || {};
  const canWriteNotices = Boolean(p.notices && staffView);
  const klass = workspace.class || {};
  const scheduleSlots = parseScheduleSlots(klass.schedule);
  const scheduleLine = scheduleSlots.length
    ? scheduleSlots.map(slot => (slot.time ? `${slot.day} (${slot.time})` : slot.day)).join(' · ')
    : '';

  const rawNotices = Array.isArray(workspace.notices) ? workspace.notices : [];
  const decodedNotices = rawNotices
    .map(n => {
      const meta = decodeNoticeMeta(n.body, n.title);
      return {
        ...n,
        ...meta
      };
    })
    .sort((a, b) => {
      if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? 1 : -1;
      return (Number(b.created_at) || 0) - (Number(a.created_at) || 0);
    });

  const latestNotice = decodedNotices.reduce((best, item) => {
    if (!best) return item;
    return (Number(item.created_at) || 0) > (Number(best.created_at) || 0) ? item : best;
  }, null);
  const latestNoticeId = latestNotice?.id || null;

  const templates = canWriteNotices
    ? buildNoticeTemplates({
        className: klass.name || 'Lớp học',
        schedule: klass.schedule || ''
      })
    : [];

  // 1. Header Bảng tin lớp học
  const noticeActions = noticeEl('div', { class: 'subtab-command-actions' });
  if (canWriteNotices) {
    noticeActions.append(
      btn('Đăng thông báo mới', () => onOpenNoticeModal(null), true, 'plus')
    );
    if (templates.length) {
      const iconByCat = { schedule: 'calendar', homework: 'file', exam: 'play', important: 'alert' };
      noticeActions.append(
        createActionMenu({
          label: 'Mẫu soạn nhanh',
          iconName: 'plus',
          variant: 'secondary',
          items: templates.map(tpl => ({
            label: tpl.label,
            icon: iconByCat[tpl.category] || 'file',
            onSelect: () =>
              onOpenNoticeModal(null, {
                presetCategory: tpl.category,
                presetPinned: tpl.pinned,
                presetTitle: tpl.title,
                presetBody: tpl.body
              })
          }))
        })
      );
    }
  }

  const commandSubtitle = scheduleLine
    ? noticeEl(
        'p',
        { class: 'notices-hero-schedule' },
        icon('attendance'),
        noticeEl('span', { text: `Lịch cố định: ${scheduleLine}` })
      )
    : noticeEl('p', {
        class: 'subtab-command-subtitle',
        text: 'Bảng tin cập nhật lịch học, lịch nghỉ bù và thông báo từ giáo viên.'
      });

  const commandBar = noticeEl(
    'div',
    { class: 'subtab-command-bar notices-hero-bar' },
    noticeEl(
      'div',
      { class: 'subtab-command-info' },
      noticeEl(
        'div',
        { class: 'subtab-command-title-row' },
        noticeEl('h1', { class: 'subtab-command-title', text: `Thông báo ${klass.name || 'lớp học'}` })
      ),
      commandSubtitle
    ),
    noticeActions.childNodes.length ? noticeActions : null
  );

  const shell = noticeEl('div', { class: 'notices-workspace-shell' }, commandBar);

  // 2. Trạng thái trống (khung bảng tin sạch, không điều hướng chéo sang tab khác)
  if (!decodedNotices.length) {
    const emptyHeader = noticeEl(
      'div',
      { class: 'notices-empty-header' },
      noticeEl('div', { class: 'notices-empty-icon-wrap', 'aria-hidden': 'true' }, icon('notice')),
      noticeEl('h2', {
        class: 'notices-empty-title',
        text: canWriteNotices ? 'Bảng tin lớp chưa có thông báo' : 'Chưa có thông báo mới'
      }),
      noticeEl('p', {
        class: 'notices-empty-desc',
        text: canWriteNotices
          ? 'Chọn “Đăng thông báo mới” hoặc “Mẫu soạn nhanh” ở phía trên.'
          : `Hiện tại ${klass.name || 'lớp học'} chưa có thông báo nào từ giáo viên. Khi có thông báo về lịch học, lịch học bù hoặc kỳ kiểm tra, nội dung sẽ xuất hiện tại đây và được gửi tới email đã đăng ký.`
      })
    );

    const emptyCard = noticeEl(
      'section',
      { class: 'notices-empty-board', 'aria-label': 'Trạng thái bảng tin' },
      emptyHeader
    );

    shell.append(emptyCard);
    root.append(shell);
    return;
  }

  // Lớp có thông báo: dựng thanh tìm kiếm & bộ lọc danh mục
  let selectedCategory = 'all';
  let searchQuery = '';

  const searchInput = noticeEl('input', {
    type: 'search',
    class: 'notices-search-input',
    placeholder: 'Tìm theo tiêu đề hoặc nội dung thông báo…',
    'aria-label': 'Tìm kiếm thông báo'
  });
  const clearSearchBtn = noticeEl(
    'button',
    {
      type: 'button',
      class: 'notices-search-clear',
      'aria-label': 'Xóa từ khóa tìm kiếm',
      hidden: true,
      onclick: () => {
        searchQuery = '';
        searchInput.value = '';
        clearSearchBtn.hidden = true;
        renderFeed();
        searchInput.focus();
      }
    },
    noticeEl('span', { text: 'Xóa' })
  );

  const pillDefs = [
    { key: 'all', label: 'Tất cả' },
    ...NOTICE_CATEGORIES.map(c => ({
      key: c.key,
      label: c.pillLabel
    }))
  ];

  const pillButtons = [];
  const pillsGroup = noticeEl('div', {
    class: 'notices-category-pills',
    role: 'group',
    'aria-label': 'Lọc thông báo theo phân loại'
  });

  function syncCategoryPills() {
    for (const entry of pillButtons) {
      const active = selectedCategory === entry.key;
      entry.node.classList.toggle('is-active', active);
      entry.node.setAttribute('aria-pressed', String(active));
    }
  }

  for (const def of pillDefs) {
    const pillBtn = noticeEl(
      'button',
      {
        type: 'button',
        class: `notices-category-pill${selectedCategory === def.key ? ' is-active' : ''}`,
        'aria-pressed': String(selectedCategory === def.key),
        onclick: () => {
          selectedCategory = def.key;
          syncCategoryPills();
          renderFeed();
        }
      },
      noticeEl('span', { text: def.label })
    );
    pillButtons.push({ key: def.key, node: pillBtn });
    pillsGroup.append(pillBtn);
  }

  const toolbar = noticeEl(
    'section',
    { class: 'notices-toolbar-shell', 'aria-label': 'Tìm kiếm và lọc thông báo' },
    noticeEl(
      'div',
      { class: 'notices-search-row' },
      noticeEl(
        'label',
        { class: 'notices-search-box' },
        createSearchSvg(),
        searchInput,
        clearSearchBtn
      )
    ),
    pillsGroup
  );

  const feedHost = noticeEl('div', { class: 'notices-feed-region' });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    clearSearchBtn.hidden = !searchQuery.trim();
    renderFeed();
  });

  function buildNoticeCard(item, idx, { isPinnedLead = false } = {}) {
    const isLatest = Boolean(latestNoticeId ? item.id === latestNoticeId : idx === 0);
    const relTime = formatRelativeNoticeTimeVi(item.created_at);
    const fullDateText = fmt(item.created_at);
    const authorName = item.created_by ? personResolver(item.created_by) : 'Giáo viên lớp';
    const authorInitial = String(authorName || 'G').trim().slice(0, 1).toLocaleUpperCase('vi-VN') || 'G';

    const bodyNode = noticeEl('div', { class: 'notice-card-body' });
    const displayText = item.cleanBody || '';
    if (typeof renderMathText === 'function') {
      renderMathText(bodyNode, displayText);
    } else {
      bodyNode.textContent = displayText;
    }

    const isLongBody = displayText.length > COLLAPSE_BODY_THRESHOLD;
    let expandBtn = null;
    if (isLongBody) {
      bodyNode.classList.add('is-collapsed');
      expandBtn = noticeEl(
        'button',
        {
          type: 'button',
          class: 'notice-expand-btn',
          'aria-expanded': 'false',
          onclick: () => {
            const collapsed = bodyNode.classList.toggle('is-collapsed');
            expandBtn.setAttribute('aria-expanded', String(!collapsed));
            expandBtn.querySelector('span').textContent = collapsed ? 'Xem thêm nội dung' : 'Thu gọn nội dung';
          }
        },
        noticeEl('span', { text: 'Xem thêm nội dung' })
      );
    }

    const badgesRow = noticeEl(
      'div',
      { class: 'notice-card-badges' },
      noticeEl(
        'span',
        { class: `badge ${item.categoryMeta.badgeClass}` },
        icon(item.categoryMeta.iconName),
        noticeEl('span', { text: item.categoryMeta.label })
      ),
      item.pinned ? noticeEl('span', { class: 'badge badge-warning', text: 'Ghim quan trọng' }) : null,
      item.scope === 'all' ? noticeEl('span', { class: 'badge badge-primary', text: 'Toàn bộ lớp học' }) : null
    );

    const combinedTimeText = relTime && fullDateText ? `${relTime} · ${fullDateText}` : relTime || fullDateText;
    const timeRow = combinedTimeText
      ? noticeEl(
          'div',
          { class: 'notice-card-time-group' },
          noticeEl('span', { class: 'notice-card-date', text: combinedTimeText })
        )
      : null;

    const copyNoticeContent = async () => {
      const contentToCopy = [item.title || '', displayText].filter(Boolean).join('\n\n');
      try {
        await navigator.clipboard?.writeText(contentToCopy);
      } catch {
        // Ignore clipboard errors when browser restricts access.
      }
    };

    let footerActionsContent = [];
    if (staffView) {
      const readsLabelNode = noticeEl('span', {
        class: 'notice-reads-trigger-label',
        text: formatNoticeReadSummaryLabel(item.read_summary)
      });
      const readsTriggerBtn = noticeEl(
        'button',
        {
          type: 'button',
          class: `notice-reads-trigger${(Number(item.read_summary?.total_seen) || 0) > 0 ? ' has-reads' : ''}`,
          'aria-label': `Xem danh sách đã xem cho thông báo ${item.title || ''}`.trim(),
          title: 'Xem chi tiết học sinh và phụ huynh đã xác nhận xem thông báo',
          onclick: () => {
            onInspectNoticeReads?.(item, updatedSummary => {
              if (!updatedSummary) return;
              item.read_summary = updatedSummary;
              readsLabelNode.textContent = formatNoticeReadSummaryLabel(updatedSummary);
              readsTriggerBtn.classList.toggle(
                'has-reads',
                (Number(updatedSummary?.total_seen) || 0) > 0
              );
            });
          }
        },
        icon('eye'),
        readsLabelNode
      );
      footerActionsContent.push(readsTriggerBtn);
      if (canWriteNotices) {
        footerActionsContent.push(
          createActionMenu({
            iconOnly: true,
            ariaLabel: `Tác vụ thông báo ${item.title || ''}`.trim(),
            variant: 'outline',
            items: [
              {
                label: 'Chỉnh sửa thông báo',
                icon: 'edit',
                onSelect: () => onOpenNoticeModal(item)
              },
              {
                label: item.pinned ? 'Bỏ ghim thông báo' : 'Ghim lên đầu bảng tin',
                icon: 'pin',
                onSelect: () => onTogglePinNotice(item)
              },
              {
                label: 'Sao chép nội dung',
                icon: 'copy',
                onSelect: copyNoticeContent
              }
            ]
          })
        );
      }
    } else {
      const syncSeenButton = (btnNode, seenAt, loading = false) => {
        const iconWrap = btnNode.querySelector('.notice-seen-icon');
        const labelNode = btnNode.querySelector('.notice-seen-label');
        const isSeen = Boolean(seenAt);
        btnNode.className = `notice-seen-btn${isSeen ? ' is-seen' : ''}${loading ? ' is-loading' : ''}`;
        if (iconWrap) {
          const nextIcon = icon(isSeen ? 'checkDouble' : 'check') || icon('check');
          iconWrap.replaceChildren(...(nextIcon ? [nextIcon] : []));
        }
        if (labelNode) {
          labelNode.textContent = loading ? 'Đang xác nhận…' : 'Đã xem';
        }
        btnNode.setAttribute('aria-pressed', isSeen ? 'true' : 'false');
        if (loading) {
          btnNode.disabled = true;
          btnNode.title = 'Đang lưu xác nhận đã xem…';
        } else if (isSeen) {
          btnNode.disabled = true;
          const formatted = fmt(seenAt);
          btnNode.title = formatted
            ? `Bạn đã xác nhận xem lúc ${formatted}`
            : 'Bạn đã xác nhận xem thông báo này';
        } else if (isArchived) {
          btnNode.disabled = true;
          btnNode.title = 'Lớp đã lưu trữ';
        } else if (typeof onMarkNoticeRead !== 'function') {
          btnNode.disabled = true;
          btnNode.title = 'Chức năng xác nhận đã xem hiện chưa sẵn sàng';
        } else {
          btnNode.disabled = false;
          btnNode.title = 'Nhấn để xác nhận bạn đã xem thông báo này';
        }
      };

      const seenBtn = noticeEl(
        'button',
        {
          type: 'button',
          class: 'notice-seen-btn',
          onclick: async () => {
            if (
              item.viewer_seen_at ||
              isArchived ||
              typeof onMarkNoticeRead !== 'function' ||
              seenBtn.disabled
            ) {
              return;
            }
            syncSeenButton(seenBtn, null, true);
            try {
              const res = await onMarkNoticeRead(item);
              const confirmedAt = Number(res?.seenAt) || Date.now();
              item.viewer_seen_at = confirmedAt;
              syncSeenButton(seenBtn, confirmedAt, false);
            } catch {
              syncSeenButton(seenBtn, item.viewer_seen_at || null, false);
            }
          }
        },
        noticeEl('span', { class: 'notice-seen-icon', 'aria-hidden': 'true' }),
        noticeEl('span', { class: 'notice-seen-label', text: 'Đã xem' })
      );
      syncSeenButton(seenBtn, item.viewer_seen_at || null, false);
      footerActionsContent.push(seenBtn);
    }

    const footerActions = noticeEl(
      'div',
      { class: 'notice-card-actions' },
      ...footerActionsContent
    );

    const cardFooter = noticeEl(
      'div',
      { class: 'notice-card-footer' },
      noticeEl(
        'div',
        { class: 'notice-card-author-row' },
        noticeEl('span', { class: 'notice-author-avatar', 'aria-hidden': 'true', text: authorInitial }),
        noticeEl(
          'div',
          { class: 'notice-author-info' },
          noticeEl('strong', { text: authorName })
        )
      ),
      footerActions
    );

    return noticeEl(
      'article',
      {
        class: `notice-card${item.pinned ? ' is-pinned' : ''}${isPinnedLead ? ' is-pinned-lead' : ''}${isLatest ? ' is-latest' : ''}`,
        'data-category': item.category
      },
      noticeEl('div', { class: 'notice-card-top' }, badgesRow, timeRow),
      noticeEl('h3', { class: 'notice-card-title', text: item.title }),
      bodyNode,
      expandBtn ? noticeEl('div', { class: 'notice-card-expand-row' }, expandBtn) : null,
      renderAttachments(item),
      cardFooter
    );
  }

  function renderFeed() {
    feedHost.replaceChildren();
    const normQuery = stripDiacriticsLower(searchQuery);
    const filtered = decodedNotices.filter(item => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (!normQuery) return true;
      const hay = stripDiacriticsLower(`${item.title || ''} ${item.cleanBody || ''} ${item.categoryMeta.label}`);
      return hay.includes(normQuery);
    });

    if (!filtered.length) {
      const resetFilterBtn = noticeEl(
        'button',
        {
          type: 'button',
          class: 'primary',
          onclick: () => {
            selectedCategory = 'all';
            searchQuery = '';
            searchInput.value = '';
            clearSearchBtn.hidden = true;
            syncCategoryPills();
            renderFeed();
          }
        },
        noticeEl('span', { text: 'Xem tất cả thông báo' })
      );

      feedHost.append(
        noticeEl(
          'div',
          { class: 'notices-filter-empty' },
          empty('Không tìm thấy thông báo nào phù hợp với bộ lọc hiện tại.'),
          resetFilterBtn
        )
      );
      return;
    }

    const pinnedInFeed = filtered.filter(n => n.pinned);
    const singlePinnedLeadId =
      pinnedInFeed.length === 1 && filtered.length > 1 && filtered[0]?.pinned
        ? filtered[0].id
        : null;

    const grid = noticeEl('div', { class: 'notices-feed-grid' });
    filtered.forEach((item, idx) => {
      grid.append(buildNoticeCard(item, idx, { isPinnedLead: Boolean(singlePinnedLeadId && item.id === singlePinnedLeadId) }));
    });
    feedHost.append(grid);
  }

  renderFeed();
  shell.append(toolbar, feedHost);
  root.append(shell);
}

/**
 * Tab Điều hành lớp học (dành riêng cho Quản trị viên).
 */
export function renderClassOperationsWorkspace({
  root,
  workspace,
  api = null,
  isArchived = false,
  cohortSlug = '',
  fmt,
  icon,
  btn,
  onOpenScheduleEditor = () => {},
  onSwitchTab = () => {}
}) {
  if (!root || !workspace) return;
  root.replaceChildren();

  const p = workspace.permissions || {};
  const canEditSchedule = Boolean(!isArchived && p.schedule);
  const klass = workspace.class || {};
  const now = Date.now();
  const grade = classGrade(klass.name);
  const isHighSchoolClass = grade >= 10 && grade <= 12;

  const actions = noticeEl('div', { class: 'subtab-command-actions' });
  if (canEditSchedule) {
    actions.append(btn('Chỉnh lịch học', () => onOpenScheduleEditor(klass), true, 'attendance'));
  }

  const commandBar = noticeEl(
    'div',
    { class: 'subtab-command-bar' },
    noticeEl(
      'div',
      { class: 'subtab-command-info' },
      noticeEl(
        'div',
        { class: 'subtab-command-title-row' },
        noticeEl('h1', { class: 'subtab-command-title', text: `Điều hành ${klass.name || 'lớp học'}` })
      )
    ),
    actions.childNodes.length ? actions : null
  );

  const populateOpsSummary = (container, { summaryItems = null, summaryText = '' } = {}) => {
    container.replaceChildren();
    if (Array.isArray(summaryItems) && summaryItems.length) {
      for (const item of summaryItems) {
        if (!item) continue;
        const valClass = `ops-summary-val${item.tone ? ` is-${item.tone}` : ''}`;
        const valNode = item.value !== undefined && item.value !== ''
          ? noticeEl('strong', { class: valClass, text: String(item.value) })
          : null;
        const labelNode = item.label !== undefined && item.label !== ''
          ? noticeEl('span', { class: 'ops-summary-label', text: String(item.label) })
          : null;
        const children = item.valueFirst ? [valNode, labelNode] : [labelNode, valNode];
        container.append(noticeEl('span', { class: 'ops-summary-item' }, ...children));
      }
      return;
    }
    if (summaryText) {
      container.append(noticeEl('span', { class: 'ops-summary-empty', text: summaryText }));
    }
  };

  const buildOpsCard = ({ toneClass, iconNode, title, valueText, unitText, summaryItems = null, summaryText = '', ctaText, onCtaClick }) => {
    const summaryNode = noticeEl('div', { class: 'ops-card-summary' });
    populateOpsSummary(summaryNode, { summaryItems, summaryText });
    return noticeEl(
      'article',
      { class: `ops-card ${toneClass}` },
      noticeEl(
        'div',
        { class: 'ops-card-head' },
        noticeEl(
          'div',
          { class: 'ops-card-title-group' },
          noticeEl('span', { class: 'notices-pulse-icon-badge' }, iconNode),
          noticeEl('h2', { class: 'ops-card-title', text: title })
        )
      ),
      noticeEl(
        'div',
        { class: 'ops-card-metric' },
        noticeEl('strong', { class: 'notices-pulse-value', text: valueText }),
        unitText ? noticeEl('span', { class: 'notices-pulse-unit', text: unitText }) : null
      ),
      summaryNode,
      noticeEl(
        'div',
        { class: 'ops-card-foot' },
        btn(ctaText, onCtaClick)
      )
    );
  };

  // 1. Lịch học cố định
  const scheduleSlots = parseScheduleSlots(klass.schedule);
  const scheduleSummaryItems =
    scheduleSlots.length === 1
      ? [
          { value: scheduleSlots[0].day },
          ...(scheduleSlots[0].time ? [{ label: scheduleSlots[0].time }] : [])
        ]
      : scheduleSlots.map(slot => ({
          value: slot.day,
          label: slot.time || '',
          valueFirst: true
        }));
  const scheduleCard = buildOpsCard({
    toneClass: 'is-schedule',
    iconNode: icon('attendance'),
    title: 'Lịch học cố định',
    valueText: String(scheduleSlots.length),
    unitText: 'buổi / tuần',
    summaryItems: scheduleSummaryItems,
    summaryText: 'Chưa thiết lập lịch học cố định hằng tuần.',
    ctaText: canEditSchedule ? 'Chỉnh lịch học' : 'Xem lịch buổi học',
    onCtaClick: () => (canEditSchedule ? onOpenScheduleEditor(klass) : onSwitchTab('materials'))
  });

  // 2. Bài tập về nhà
  const assignmentsList = Array.isArray(workspace.assignments) ? workspace.assignments : [];
  const openAssignments = assignmentsList
    .filter(a => a.status !== 'archived' && now >= a.opens_at && now < a.closes_at)
    .sort((a, b) => (Number(a.closes_at) || 0) - (Number(b.closes_at) || 0));
  const nearestAssignment = openAssignments[0] || null;
  const homeworkSummaryItems = nearestAssignment
    ? [
        { label: 'Hạn gần nhất' },
        { value: fmt(nearestAssignment.closes_at) }
      ]
    : assignmentsList.length
      ? [
          { label: 'Đã giao', value: `${assignmentsList.length} bài` },
          { label: 'Không có bài mở' }
        ]
      : [];
  const homeworkCard = buildOpsCard({
    toneClass: 'is-homework',
    iconNode: icon('assignment'),
    title: 'Bài tập về nhà',
    valueText: String(openAssignments.length),
    unitText: 'đang mở',
    summaryItems: homeworkSummaryItems,
    summaryText: 'Chưa có bài tập nào được giao.',
    ctaText: 'Mở mục Bài tập',
    onCtaClick: () => onSwitchTab('assignments')
  });

  // 3. Phòng luyện (chỉ khối 10, 11, 12) hoặc Bài giảng & Tài liệu (khối 6-9)
  let learningCard;
  if (isHighSchoolClass) {
    const cachedStats = opsPracticeStatsCache.get(grade) || null;
    const hasApi = typeof api === 'function';
    const initialStats = cachedStats || (
      hasApi
        ? {
            valueText: '…',
            unitText: 'đề',
            summaryItems: [],
            summaryText: 'Đang tải thống kê đề luyện…'
          }
        : computeClassPracticeOpsStats([], grade)
    );
    learningCard = buildOpsCard({
      toneClass: 'is-practice',
      iconNode: icon('practice'),
      title: 'Phòng luyện & Chữa đề',
      valueText: initialStats.valueText,
      unitText: initialStats.unitText,
      summaryItems: initialStats.summaryItems,
      summaryText: initialStats.summaryText,
      ctaText: 'Vào Phòng luyện',
      onCtaClick: () => onSwitchTab('practice')
    });

    if (hasApi) {
      Promise.resolve(api(`/api/practice/rooms?grade=${encodeURIComponent(grade)}`))
        .then(res => {
          const stats = computeClassPracticeOpsStats(res?.exams || [], grade);
          opsPracticeStatsCache.set(grade, stats);
          if (!learningCard.isConnected) return;
          const valEl = learningCard.querySelector('.notices-pulse-value');
          const unitEl = learningCard.querySelector('.notices-pulse-unit');
          const sumEl = learningCard.querySelector('.ops-card-summary');
          if (valEl) valEl.textContent = stats.valueText;
          if (unitEl) unitEl.textContent = stats.unitText;
          if (sumEl) populateOpsSummary(sumEl, stats);
        })
        .catch(() => {
          if (!learningCard.isConnected) return;
          const valEl = learningCard.querySelector('.notices-pulse-value');
          const sumEl = learningCard.querySelector('.ops-card-summary');
          if (valEl && valEl.textContent === '…') {
            const fallback = computeClassPracticeOpsStats([], grade);
            valEl.textContent = fallback.valueText;
            if (sumEl) populateOpsSummary(sumEl, fallback);
          }
        });
    }
  } else {
    learningCard = buildOpsCard({
      toneClass: 'is-materials',
      iconNode: icon('material'),
      title: 'Bài giảng & Tài liệu',
      valueText: 'Theo buổi',
      unitText: 'học liệu lớp',
      summaryText: 'Tài liệu, video và lộ trình theo từng buổi học.',
      ctaText: 'Mở Bài giảng',
      onCtaClick: () => onSwitchTab('materials')
    });
  }

  // 4. Chuyên cần & Điểm danh
  const attList = Array.isArray(workspace.attendance) ? workspace.attendance : [];
  const studentsCount = (workspace.members || []).filter(m => m.member_role === 'student').length;
  const attGroups = groupAttendanceByDate(attList);
  const attCounts = attList.reduce(
    (acc, r) => {
      if (r?.status && r.status in acc) acc[r.status]++;
      return acc;
    },
    { present: 0, late: 0, excused: 0, absent: 0 }
  );
  const attRate = computeAttendanceRate(attCounts);
  const latestGroup = attGroups[0] || null;
  const latestDateCompact = latestGroup
    ? formatLessonDateShort(latestGroup.date).replace(/\/\d{4}$/, '')
    : '';
  const latestAbsentCount = latestGroup ? latestGroup.absent + latestGroup.excused : 0;
  const attSummaryItems = latestGroup
    ? [
        { label: latestDateCompact },
        { value: String(latestGroup.present), label: 'có mặt', valueFirst: true, tone: latestGroup.present > 0 ? 'positive' : '' },
        { value: String(latestGroup.late), label: 'muộn', valueFirst: true, tone: latestGroup.late > 0 ? 'warn' : '' },
        { value: String(latestAbsentCount), label: 'vắng', valueFirst: true, tone: latestAbsentCount > 0 ? 'danger' : '' }
      ]
    : [];
  const attendanceCard = buildOpsCard({
    toneClass: 'is-attendance',
    iconNode: icon('check'),
    title: 'Chuyên cần & Điểm danh',
    valueText: attRate.ratePct !== null ? `${attRate.ratePct}%` : String(studentsCount),
    unitText: attRate.ratePct !== null ? 'tỷ lệ đi học' : 'học sinh',
    summaryItems: attSummaryItems,
    summaryText: 'Chưa có buổi học nào được điểm danh.',
    ctaText: 'Mở Điểm danh',
    onCtaClick: () => onSwitchTab('attendance')
  });

  // 5. Diễn đàn hỏi đáp
  const cachedForum = klass.id ? opsForumStatsCache.get(klass.id) || null : null;
  const hasForumApi = typeof api === 'function' && Boolean(klass.id);
  const initialForumStats = cachedForum || (
    hasForumApi
      ? {
          valueText: '…',
          unitText: 'câu hỏi',
          summaryItems: [],
          summaryText: 'Đang tải thống kê hỏi đáp của lớp…'
        }
      : computeClassForumOpsStats([])
  );
  const forumCard = buildOpsCard({
    toneClass: 'is-forum',
    iconNode: icon('message'),
    title: 'Diễn đàn hỏi đáp',
    valueText: initialForumStats.valueText,
    unitText: initialForumStats.unitText,
    summaryItems: initialForumStats.summaryItems,
    summaryText: initialForumStats.summaryText,
    ctaText: 'Mở Diễn đàn',
    onCtaClick: () => onSwitchTab('forum')
  });

  if (hasForumApi) {
    Promise.resolve(api(`/api/classes/${encodeURIComponent(klass.id)}/forum`))
      .then(res => {
        const stats = computeClassForumOpsStats(res?.items || []);
        opsForumStatsCache.set(klass.id, stats);
        if (!forumCard.isConnected) return;
        const valEl = forumCard.querySelector('.notices-pulse-value');
        const unitEl = forumCard.querySelector('.notices-pulse-unit');
        const sumEl = forumCard.querySelector('.ops-card-summary');
        if (valEl) valEl.textContent = stats.valueText;
        if (unitEl) unitEl.textContent = stats.unitText;
        if (sumEl) populateOpsSummary(sumEl, stats);
      })
      .catch(() => {
        if (!forumCard.isConnected) return;
        const valEl = forumCard.querySelector('.notices-pulse-value');
        const sumEl = forumCard.querySelector('.ops-card-summary');
        if (valEl && valEl.textContent === '…') {
          const fallback = computeClassForumOpsStats([]);
          valEl.textContent = fallback.valueText;
          if (sumEl) populateOpsSummary(sumEl, fallback);
        }
      });
  }

  const grid = noticeEl(
    'section',
    { class: 'ops-grid', 'aria-label': 'Tổng quan điều hành lớp học' },
    scheduleCard,
    homeworkCard,
    learningCard,
    attendanceCard,
    forumCard
  );

  root.append(noticeEl('div', { class: 'ops-shell' }, commandBar, grid));
}
