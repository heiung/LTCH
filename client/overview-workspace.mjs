// Bộ trợ giúp thuần túy cho trang Tổng quan (/overview) — Lớp Toán cô Hạnh
// Tuân thủ nghiêm ngặt CSP (không dùng inline style) và múi giờ Việt Nam (Asia/Ho_Chi_Minh).

import { weekDays, classGrade, sortClasses, timeZone } from '../shared/classroom.mjs';

const WEEKDAY_SHORT_TO_ISO = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};

const NAMED_VI_DAY_TOKENS = [
  { re: /(?<!\p{L})thứ\s*hai(?!\p{L})/giu, day: 1 },
  { re: /(?<!\p{L})thứ\s*ba(?!\p{L})/giu, day: 2 },
  { re: /(?<!\p{L})thứ\s*tư(?!\p{L})/giu, day: 3 },
  { re: /(?<!\p{L})thứ\s*năm(?!\p{L})/giu, day: 4 },
  { re: /(?<!\p{L})thứ\s*sáu(?!\p{L})/giu, day: 5 },
  { re: /(?<!\p{L})thứ\s*bảy(?!\p{L})/giu, day: 6 },
  { re: /(?<!\p{L})(?:chủ\s*nhật|cn)(?!\p{L})/giu, day: 7 }
];

const TIME_RANGE_REGEX = /(\d{1,2})\s*[:h]\s*(\d{2})\s*[–—\-]\s*(\d{1,2})\s*[:h]\s*(\d{2})/i;

/**
 * Lấy thông tin ngày giờ hiện tại theo múi giờ Asia/Ho_Chi_Minh.
 */
export function getVietnamNowParts(now = Date.now()) {
  const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const map = {};
  for (const part of fmt.formatToParts(new Date(ts))) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const isoDay = WEEKDAY_SHORT_TO_ISO[map.weekday] || 1;
  const hour = Number.parseInt(map.hour, 10) % 24;
  const minute = Number.parseInt(map.minute, 10) || 0;
  const dayName = weekDays[isoDay - 1] || 'Thứ Hai';
  const day = String(map.day || '01').padStart(2, '0');
  const month = String(map.month || '01').padStart(2, '0');
  const year = String(map.year || '2026');
  return {
    isoDay,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
    dayName,
    isoDate: `${year}-${month}-${day}`,
    dateLabel: `${dayName}, ${day}/${month}/${year}`
  };
}

/**
 * Chuyển chuỗi giờ ("HH:MM" hoặc "HHhMM") sang tổng số phút trong ngày.
 */
export function parseTimeToMinutes(value) {
  const match = /^\s*(\d{1,2})\s*[:h]\s*(\d{2})\s*$/i.exec(String(value || ''));
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function formatHHMM(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function parseDaysFromSegmentPrefix(prefix) {
  const found = [];
  const addDay = dayNum => {
    if (dayNum >= 1 && dayNum <= 7 && !found.includes(dayNum)) found.push(dayNum);
  };

  let scrubbed = String(prefix || '');
  for (const { re, day } of NAMED_VI_DAY_TOKENS) {
    re.lastIndex = 0;
    if (re.test(scrubbed)) addDay(day);
    re.lastIndex = 0;
    scrubbed = scrubbed.replace(re, ' ');
  }

  // Hỗ trợ dạng rút gọn nhiều thứ liên tiếp: "Thứ 2, 5" hoặc "Thứ 3, 5, 7" hoặc "T2, T6"
  const thuListRegex = /(?<!\p{L})(?:thứ|t)\s*([2-7](?:\s*[,/&và\-]\s*(?:thứ|t)?\s*[2-7])*)(?!\d)/giu;
  let match;
  while ((match = thuListRegex.exec(scrubbed)) !== null) {
    const nums = match[1].match(/[2-7]/g) || [];
    for (const digit of nums) addDay(Number(digit) - 1);
  }

  return found;
}

/**
 * Trích xuất danh sách khung giờ học chuẩn {day, start, end} từ dữ liệu lớp học.
 */
export function extractClassScheduleSlots(klass) {
  if (!klass || typeof klass !== 'object') return [];

  const structured = Array.isArray(klass.scheduleSlots)
    ? klass.scheduleSlots
    : Array.isArray(klass.schedule_slots)
      ? klass.schedule_slots
      : null;

  const validStructured = [];
  if (structured && structured.length) {
    for (const slot of structured) {
      if (!slot || !Number.isInteger(slot.day) || slot.day < 1 || slot.day > 7) continue;
      const startMin = parseTimeToMinutes(slot.start);
      const endMin = parseTimeToMinutes(slot.end);
      if (startMin === null || endMin === null || endMin <= startMin) continue;
      validStructured.push({
        day: slot.day,
        start: formatHHMM(startMin),
        end: formatHHMM(endMin),
        startMin,
        endMin
      });
    }
  }
  if (validStructured.length) {
    return validStructured.sort((a, b) => a.day - b.day || a.startMin - b.startMin);
  }

  const rawText = String(klass.schedule || '').trim();
  if (!rawText) return [];

  const parsed = [];
  const seen = new Set();
  for (const segment of rawText.split(/[;\n]+/)) {
    const clean = segment.trim();
    if (!clean) continue;
    const rangeMatch = TIME_RANGE_REGEX.exec(clean);
    if (!rangeMatch) continue;
    const startStr = `${rangeMatch[1].padStart(2, '0')}:${rangeMatch[2]}`;
    const endStr = `${rangeMatch[3].padStart(2, '0')}:${rangeMatch[4]}`;
    const startMin = parseTimeToMinutes(startStr);
    const endMin = parseTimeToMinutes(endStr);
    if (startMin === null || endMin === null || endMin <= startMin) continue;

    const prefix = clean.slice(0, rangeMatch.index);
    const days = parseDaysFromSegmentPrefix(prefix);
    for (const day of days) {
      const key = `${day}|${startStr}|${endStr}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parsed.push({ day, start: startStr, end: endStr, startMin, endMin });
    }
  }

  return parsed.sort((a, b) => a.day - b.day || a.startMin - b.startMin);
}

/**
 * Xây dựng lịch học/dạy sắp tới trong 7 ngày tới tính từ thời điểm hiện tại (giờ Việt Nam).
 */
export function buildUpcomingScheduleItems(classesList = [], now = Date.now()) {
  const nowParts = getVietnamNowParts(now);
  const items = [];

  for (const klass of sortClasses(Array.isArray(classesList) ? classesList : [])) {
    const slots = extractClassScheduleSlots(klass);
    const grade = classGrade(klass.name);
    for (const slot of slots) {
      let dayOffset = (slot.day - nowParts.isoDay + 7) % 7;
      let status = 'upcoming';
      if (dayOffset === 0) {
        if (slot.endMin <= nowParts.minutesOfDay) {
          dayOffset = 7;
        } else if (slot.startMin <= nowParts.minutesOfDay) {
          status = 'live';
        } else {
          status = 'today';
        }
      } else if (dayOffset === 1) {
        status = 'tomorrow';
      }

      const dayName = weekDays[slot.day - 1] || 'Thứ Hai';
      const relativeDayLabel =
        status === 'live' || status === 'today'
          ? 'Hôm nay'
          : status === 'tomorrow'
            ? 'Ngày mai'
            : dayName;

      items.push({
        classObj: klass,
        classId: klass.id,
        className: klass.name,
        grade,
        day: slot.day,
        dayName,
        relativeDayLabel,
        start: slot.start,
        end: slot.end,
        timeRange: `${slot.start}–${slot.end}`,
        startMin: slot.startMin,
        endMin: slot.endMin,
        dayOffset,
        status
      });
    }
  }

  items.sort(
    (a, b) =>
      a.dayOffset - b.dayOffset ||
      a.startMin - b.startMin ||
      a.grade - b.grade ||
      a.className.localeCompare(b.className, 'vi')
  );
  return items;
}

/**
 * Phân loại mức độ khẩn của bài tập theo mốc mở & hạn nộp.
 */
export function describeAssignmentUrgency(assignment = {}, now = Date.now()) {
  const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const opensAt = Number(assignment?.opens_at || 0);
  const closesAt = Number(assignment?.closes_at || 0);

  if (opensAt > ts) {
    return {
      tone: 'upcoming',
      badgeText: 'Sắp mở',
      detailText: 'Chưa đến giờ mở nộp bài',
      isUrgent: false
    };
  }

  if (!closesAt) {
    return {
      tone: 'open',
      badgeText: 'Đang mở',
      detailText: 'Đang mở nộp bài',
      isUrgent: false
    };
  }

  const diffMs = closesAt - ts;
  if (diffMs <= 0) {
    return {
      tone: 'urgent',
      badgeText: 'Đã hết hạn',
      detailText: 'Vừa kết thúc thời gian nộp',
      isUrgent: true
    };
  }

  if (diffMs <= 24 * 3600 * 1000) {
    const hrs = Math.floor(diffMs / 3600000);
    return {
      tone: 'urgent',
      badgeText: 'Hạn hôm nay',
      detailText: hrs >= 1 ? `Còn khoảng ${hrs} giờ` : 'Còn dưới 1 giờ',
      isUrgent: true
    };
  }

  if (diffMs <= 72 * 3600 * 1000) {
    const daysLeft = Math.max(2, Math.ceil(diffMs / (24 * 3600 * 1000)));
    return {
      tone: 'soon',
      badgeText: `Còn ${daysLeft} ngày`,
      detailText: `Đến hạn trong ${daysLeft} ngày tới`,
      isUrgent: true
    };
  }

  return {
    tone: 'open',
    badgeText: 'Đang mở',
    detailText: 'Còn thời gian làm bài',
    isUrgent: false
  };
}

/**
 * Lọc danh sách lớp trên Tổng quan theo cấp học ('all' | 'thcs' | 'thpt').
 */
export function filterOverviewClasses(classesList = [], levelFilter = 'all') {
  const sorted = sortClasses(Array.isArray(classesList) ? classesList : []);
  if (levelFilter === 'thcs') {
    return sorted.filter(c => {
      const g = classGrade(c.name);
      return g >= 6 && g <= 9;
    });
  }
  if (levelFilter === 'thpt') {
    return sorted.filter(c => {
      const g = classGrade(c.name);
      return g >= 10 && g <= 12;
    });
  }
  return sorted;
}

/**
 * Chuẩn hóa nhãn và sắc độ trạng thái điểm danh.
 */
export function formatAttendanceStatusMeta(status) {
  switch (String(status || '').trim()) {
    case 'present':
      return { label: 'Có mặt', tone: 'present' };
    case 'late':
      return { label: 'Đi muộn', tone: 'late' };
    case 'excused':
      return { label: 'Vắng có phép', tone: 'excused' };
    case 'absent':
      return { label: 'Vắng không phép', tone: 'absent' };
    default:
      return { label: 'Chưa ghi nhận', tone: 'neutral' };
  }
}

/**
 * Chuyển ngày ISO 'YYYY-MM-DD' sang 'DD/MM/YYYY'.
 */
export function formatVnIsoDate(dateStr) {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return String(dateStr || '').trim();
}

/**
 * Định dạng thời gian tương đối bằng tiếng Việt (theo giờ Việt Nam).
 */
export function formatRelativeTimeVi(ts, now = Date.now()) {
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || tsNum <= 0) return '';
  const nowNum = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const diff = Math.max(0, nowNum - tsNum);
  if (diff < 2 * 60_000) return 'Vừa xong';
  if (diff < 60 * 60_000) return `${Math.max(1, Math.floor(diff / 60_000))} phút trước`;
  if (diff < 24 * 3_600_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} giờ trước`;
  if (diff < 48 * 3_600_000) return 'Hôm qua';
  if (diff < 7 * 86_400_000) return `${Math.max(2, Math.floor(diff / 86_400_000))} ngày trước`;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      day: '2-digit',
      month: '2-digit'
    }).formatToParts(new Date(tsNum));
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    return `${map.day || '01'}/${map.month || '01'}`;
  } catch {
    return '';
  }
}

function formatViDecimal(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1).replace('.', ',');
}

/**
 * Định dạng điểm số (hỗ trợ cả thang nguyên bản hoặc quy đổi thang 10).
 */
export function formatScore10(score, maxScore, { normalized = false } = {}) {
  const s = Number(score);
  const m = Number(maxScore);
  if (!Number.isFinite(s) || !Number.isFinite(m) || m <= 0) return '';
  if (normalized) {
    return `${formatViDecimal((s / m) * 10)}/10`;
  }
  return `${formatViDecimal(s)}/${formatViDecimal(m)}`;
}

/**
 * Nhãn trạng thái bài nộp của học sinh / con trên Dashboard.
 */
export function describeSubmissionStatusMeta(entry, { isParent = false } = {}) {
  const st = typeof entry === 'string' ? entry : entry?.status;
  if (st === 'graded') {
    return { tone: 'graded', label: 'GV đã nhận xét' };
  }
  if (st === 'submitted') {
    return { tone: 'submitted', label: isParent ? 'Con đã nộp' : 'Đã nộp · Chờ nhận xét' };
  }
  return { tone: 'missing', label: isParent ? 'Con chưa nộp' : 'Chưa nộp' };
}
