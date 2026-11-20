// Không gian Điểm danh thông minh dành cho Ban điều hành (Admin, Giáo viên, Trợ giảng) và Phụ huynh / Học sinh
// Tuân thủ nghiêm ngặt hệ thống thiết kế LTCH Academic Design System 2.0 và CSP (không dùng inline style).

import { createActionMenu } from './action-menu.mjs';
import {
  timeZone,
  parseIsoDateParts,
  addIsoDays,
  isoDayOfWeek,
  weekDays
} from '../shared/classroom.mjs';
import { extractClassScheduleSlots } from './overview-workspace.mjs';

export const ATTENDANCE_STATUSES = [
  { value: 'present', label: 'Có mặt', shortLabel: 'Có mặt', badge: 'badge-success', tone: 'present' },
  { value: 'late', label: 'Đi muộn', shortLabel: 'Đi muộn', badge: 'badge-warning', tone: 'late' },
  { value: 'excused', label: 'Nghỉ có phép', shortLabel: 'Có phép', badge: 'badge-info', tone: 'excused' },
  { value: 'absent', label: 'Vắng không phép', shortLabel: 'Vắng', badge: 'badge-error', tone: 'absent' }
];

export const ATTENDANCE_QUICK_NOTES = {
  present: ['Học tích cực', 'Hoàn thành bài tốt', 'Đi học bù'],
  late: ['Muộn 5 phút', 'Muộn 10 phút', 'Muộn 15 phút', 'Đón muộn / tắc đường'],
  excused: ['Phụ huynh đã xin phép', 'Nghỉ ốm', 'Trùng lịch thi trường', 'Bận việc gia đình'],
  absent: ['Chưa thấy báo phép', 'Đã nhắn phụ huynh', 'Cần gọi hỏi thăm']
};

const STATUS_BY_VALUE = Object.fromEntries(ATTENDANCE_STATUSES.map(item => [item.value, item]));
const vnCollator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });

const ATT_ICONS = {
  present: '<polyline points="20 6 9 17 4 12"/>',
  late: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  excused: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>',
  absent: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  assignment: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
};

function attEl(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      node.className = v;
    } else if (k === 'text') {
      node.textContent = v;
    } else if (k === 'disabled' || k === 'hidden' || k === 'checked' || k === 'selected') {
      node[k] = Boolean(v);
    } else if (k === 'value') {
      node.value = String(v);
    } else if (v === true) {
      node.setAttribute(k, '');
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
  }
  return node;
}

function attIcon(name, size = 16, extraClass = '') {
  const path = ATT_ICONS[name];
  if (!path) return null;
  const span = attEl('span', {
    class: extraClass ? `att-icon ${extraClass}` : 'att-icon',
    'aria-hidden': 'true'
  });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  return span;
}

export function normalizeSearchText(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function vietnameseGivenNameKey(fullName = '') {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { given: '', family: '' };
  return {
    given: parts.at(-1),
    family: parts.slice(0, -1).join(' ')
  };
}

export function sortStudentsRoster(students = []) {
  return [...students].sort((a, b) => {
    const nameA = a.name || a.display_name || a.uid || '';
    const nameB = b.name || b.display_name || b.uid || '';
    const keyA = vietnameseGivenNameKey(nameA);
    const keyB = vietnameseGivenNameKey(nameB);
    const cmpGiven = vnCollator.compare(keyA.given, keyB.given);
    if (cmpGiven !== 0) return cmpGiven;
    const cmpFamily = vnCollator.compare(keyA.family, keyB.family);
    if (cmpFamily !== 0) return cmpFamily;
    return vnCollator.compare(String(a.student_code || a.uid), String(b.student_code || b.uid));
  });
}

export function getVietnamTodayIso(now = Date.now()) {
  const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const map = {};
    for (const part of fmt.formatToParts(new Date(ts))) {
      if (part.type !== 'literal') map[part.type] = part.value;
    }
    if (map.year && map.month && map.day) {
      return `${map.year}-${map.month.padStart(2, '0')}-${map.day.padStart(2, '0')}`;
    }
  } catch {}
  return new Date(ts).toISOString().slice(0, 10);
}

export function buildDateAttendanceMap(attendanceRows = [], dateStr = '') {
  const map = new Map();
  for (const row of attendanceRows || []) {
    if (row && row.lesson_date === dateStr && row.student_uid) {
      map.set(row.student_uid, {
        status: row.status || 'present',
        note: row.note || '',
        updated_at: row.updated_at || null
      });
    }
  }
  return map;
}

export function computeAttendanceCounts(students = [], draftMap = new Map()) {
  const counts = {
    total: students.length,
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    unmarked: 0,
    marked: 0
  };
  for (const s of students) {
    const entry = draftMap.get(s.uid);
    const status = entry?.status || '';
    if (status && status in counts) {
      counts[status]++;
      counts.marked++;
    } else {
      counts.unmarked++;
    }
  }
  return counts;
}

export function computeAttendanceRate(counts = {}) {
  const present = Number(counts.present) || 0;
  const late = Number(counts.late) || 0;
  const excused = Number(counts.excused) || 0;
  const absent = Number(counts.absent) || 0;
  const total = present + late + excused + absent;
  const attended = present + late;
  const ratePct = total > 0 ? Math.round((attended / total) * 100) : null;
  return { total, attended, ratePct };
}

export function groupAttendanceByDate(attendanceRows = []) {
  const groups = new Map();
  for (const row of attendanceRows || []) {
    if (!row || !row.lesson_date) continue;
    let group = groups.get(row.lesson_date);
    if (!group) {
      group = {
        date: row.lesson_date,
        records: [],
        present: 0,
        late: 0,
        absent: 0,
        excused: 0
      };
      groups.set(row.lesson_date, group);
    }
    group.records.push(row);
    if (row.status === 'present') group.present++;
    else if (row.status === 'late') group.late++;
    else if (row.status === 'absent') group.absent++;
    else if (row.status === 'excused') group.excused++;
  }
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function getChangedAttendanceEntries(students = [], savedMap = new Map(), draftMap = new Map()) {
  const changed = [];
  for (const s of students) {
    const draft = draftMap.get(s.uid);
    if (!draft || !draft.status) continue;
    const saved = savedMap.get(s.uid);
    const draftNote = String(draft.note || '').trim();
    const savedNote = String(saved?.note || '').trim();
    if (!saved || saved.status !== draft.status || savedNote !== draftNote) {
      changed.push({
        studentUid: s.uid,
        studentName: s.name || s.uid,
        status: draft.status,
        note: draftNote
      });
    }
  }
  return changed;
}

export function formatLessonDateLong(dateStr) {
  const parts = parseIsoDateParts(dateStr);
  if (!parts) return String(dateStr || '');
  const dow = isoDayOfWeek(parts.iso);
  const weekday = dow ? weekDays[dow - 1] : '';
  return weekday
    ? `${weekday}, ${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`
    : formatLessonDateShort(parts.iso);
}

export function formatLessonDateShort(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!match) return String(dateStr || '');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatMonthYearVi(monthKey) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!m) return String(monthKey || '');
  return `Tháng ${m[2]} / ${m[1]}`;
}

function weekdayShortVi(dateStr) {
  const dow = isoDayOfWeek(dateStr);
  if (!dow) return '';
  return dow === 7 ? 'CN' : `T${dow + 1}`;
}

export function buildSessionDateLookup(sessions = []) {
  const map = new Map();
  for (const s of Array.isArray(sessions) ? sessions : []) {
    const iso = parseIsoDateParts(s?.date)?.iso;
    if (!iso || map.has(iso)) continue;
    map.set(iso, s);
  }
  return map;
}

export function resolveCourseStartDate(catalog = null, classInfo = null) {
  const fromCatalog = parseIsoDateParts(catalog?.schoolYearStartsOn)?.iso;
  if (fromCatalog) return fromCatalog;

  const fromClass = parseIsoDateParts(
    classInfo?.school_year_starts_on || classInfo?.starts_on || classInfo?.start_date
  )?.iso;
  if (fromClass) return fromClass;

  const yearSource = String(
    classInfo?.school_year_id ||
    classInfo?.schoolYearId ||
    classInfo?.schoolYear ||
    classInfo?.schoolYearName ||
    ''
  );
  const yearMatch = /\b(20\d{2})\b/.exec(yearSource);
  if (yearMatch) return `${yearMatch[1]}-09-01`;

  return '2026-09-01';
}

export function computeSessionInfoFromStartDate({
  targetDate,
  startDate = '2026-09-01',
  scheduleSlots = []
} = {}) {
  const t = parseIsoDateParts(targetDate);
  const s = parseIsoDateParts(startDate);
  if (!t || !s) {
    return { sessionNumber: null, isScheduledDay: false, isBeforeStart: false, matchingSlots: [] };
  }

  const daysDiff = Math.round(
    (Date.UTC(t.year, t.month - 1, t.day) - Date.UTC(s.year, s.month - 1, s.day)) / 86400000
  );
  if (daysDiff < 0) {
    return { sessionNumber: null, isScheduledDay: false, isBeforeStart: true, matchingSlots: [] };
  }

  const validSlots = (Array.isArray(scheduleSlots) ? scheduleSlots : [])
    .filter(sl => sl && Number.isInteger(Number(sl.day)) && Number(sl.day) >= 1 && Number(sl.day) <= 7)
    .map(sl => ({ ...sl, day: Number(sl.day) }));

  if (validSlots.length > 0) {
    const fullWeeks = Math.floor(daysDiff / 7);
    const remDays = daysDiff % 7;
    const startDow = isoDayOfWeek(s.iso);
    let remCount = 0;
    for (let k = 0; k <= remDays; k++) {
      const dow = ((startDow - 1 + k) % 7) + 1;
      remCount += validSlots.filter(sl => sl.day === dow).length;
    }
    const targetDow = isoDayOfWeek(t.iso);
    const matchingSlots = validSlots.filter(sl => sl.day === targetDow);
    const isScheduledDay = matchingSlots.length > 0;
    const scheduledCount = fullWeeks * validSlots.length + remCount;
    return {
      sessionNumber: isScheduledDay ? scheduledCount : null,
      isScheduledDay,
      isBeforeStart: false,
      matchingSlots
    };
  }

  return {
    sessionNumber: Math.floor(daysDiff / 7) + 1,
    isScheduledDay: daysDiff % 7 === 0,
    isBeforeStart: false,
    matchingSlots: []
  };
}

export function computeStudentAttendanceStats(students = [], attendanceRows = []) {
  const byStudent = new Map();
  for (const row of Array.isArray(attendanceRows) ? attendanceRows : []) {
    if (!row?.student_uid || !row?.lesson_date) continue;
    let dateMap = byStudent.get(row.student_uid);
    if (!dateMap) {
      dateMap = new Map();
      byStudent.set(row.student_uid, dateMap);
    }
    const prev = dateMap.get(row.lesson_date);
    if (!prev || Number(row.updated_at || 0) >= Number(prev.updated_at || 0)) {
      dateMap.set(row.lesson_date, row);
    }
  }

  return sortStudentsRoster(students).map(student => {
    const dateMap = byStudent.get(student.uid);
    const records = dateMap
      ? [...dateMap.values()].sort((a, b) => String(b.lesson_date).localeCompare(String(a.lesson_date)))
      : [];
    let present = 0;
    let late = 0;
    let excused = 0;
    let absent = 0;
    for (const r of records) {
      if (r.status === 'present') present++;
      else if (r.status === 'late') late++;
      else if (r.status === 'excused') excused++;
      else if (r.status === 'absent') absent++;
    }
    const { total, attended, ratePct } = computeAttendanceRate({ present, late, excused, absent });
    const latest = records[0] || null;
    const needsAttention = Boolean(
      total > 0 && ((ratePct !== null && ratePct < 85) || absent >= 2 || latest?.status === 'absent')
    );

    return {
      uid: student.uid,
      name: student.name || student.display_name || student.uid,
      studentCode: student.student_code || null,
      total,
      present,
      late,
      excused,
      absent,
      attended,
      ratePct,
      needsAttention,
      recentRecords: records.slice(0, 8),
      allRecords: records,
      lastStatus: latest?.status || null,
      lastDate: latest?.lesson_date || null,
      lastNote: latest?.note || ''
    };
  });
}

export function computeDateNavigationTargets({
  selectedDate,
  scheduleSlots = [],
  recordedDates = [],
  sessions = [],
  todayIso = getVietnamTodayIso()
} = {}) {
  const validSelected = parseIsoDateParts(selectedDate)?.iso || parseIsoDateParts(todayIso)?.iso || '2026-09-01';
  const validToday = parseIsoDateParts(todayIso)?.iso || validSelected;
  const scheduledDays = new Set(
    (Array.isArray(scheduleSlots) ? scheduleSlots : [])
      .map(s => Number(s?.day))
      .filter(d => Number.isInteger(d) && d >= 1 && d <= 7)
  );

  const candidateSet = new Set([validToday]);
  for (const d of Array.isArray(recordedDates) ? recordedDates : []) {
    const iso = parseIsoDateParts(d)?.iso;
    if (iso) candidateSet.add(iso);
  }
  for (const s of Array.isArray(sessions) ? sessions : []) {
    const iso = parseIsoDateParts(s?.date)?.iso;
    if (iso) candidateSet.add(iso);
  }
  if (scheduledDays.size > 0) {
    for (let offset = -21; offset <= 21; offset++) {
      const iso = addIsoDays(validSelected, offset);
      if (iso && scheduledDays.has(isoDayOfWeek(iso))) candidateSet.add(iso);
    }
    for (let offset = -14; offset <= 7; offset++) {
      const iso = addIsoDays(validToday, offset);
      if (iso && scheduledDays.has(isoDayOfWeek(iso))) candidateSet.add(iso);
    }
  }

  const sortedAsc = [...candidateSet].sort((a, b) => a.localeCompare(b));
  let prevDate = null;
  let nextDate = null;
  for (const d of sortedAsc) {
    if (d < validSelected) prevDate = d;
    else if (d > validSelected && !nextDate) nextDate = d;
  }
  if (!prevDate) prevDate = addIsoDays(validSelected, -1);
  if (!nextDate) nextDate = addIsoDays(validSelected, 1);

  const recordedSet = new Set((Array.isArray(recordedDates) ? recordedDates : []).map(d => parseIsoDateParts(d)?.iso).filter(Boolean));
  const quickSet = new Set();
  for (const d of [...recordedSet].sort((a, b) => b.localeCompare(a))) {
    quickSet.add(d);
    if (quickSet.size >= 5) break;
  }
  if (scheduledDays.size === 0 || scheduledDays.has(isoDayOfWeek(validToday)) || !recordedSet.has(validToday)) {
    quickSet.add(validToday);
  }
  if (scheduledDays.size > 0) {
    const recentScheduled = sortedAsc.filter(d => d <= validToday && scheduledDays.has(isoDayOfWeek(d))).reverse();
    for (const d of recentScheduled) {
      if (quickSet.size >= 7) break;
      quickSet.add(d);
    }
  }
  if (parseIsoDateParts(selectedDate)?.iso) {
    quickSet.add(validSelected);
  }

  const quickDates = [...quickSet].sort((a, b) => b.localeCompare(a)).slice(0, 7);
  return { prevDate, nextDate, quickDates };
}

export function groupRecordsByMonth(items = [], dateGetter = item => item?.lesson_date || item?.date) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const rawDate = dateGetter(item);
    const parts = parseIsoDateParts(rawDate);
    if (!parts) continue;
    const monthKey = `${parts.year}-${String(parts.month).padStart(2, '0')}`;
    let group = groups.get(monthKey);
    if (!group) {
      group = {
        monthKey,
        label: formatMonthYearVi(monthKey),
        items: [],
        present: 0,
        late: 0,
        excused: 0,
        absent: 0
      };
      groups.set(monthKey, group);
    }
    group.items.push(item);
    if (typeof item?.status === 'string') {
      if (item.status === 'present') group.present++;
      else if (item.status === 'late') group.late++;
      else if (item.status === 'excused') group.excused++;
      else if (item.status === 'absent') group.absent++;
    } else if (typeof item?.present === 'number') {
      group.present += Number(item.present) || 0;
      group.late += Number(item.late) || 0;
      group.excused += Number(item.excused) || 0;
      group.absent += Number(item.absent) || 0;
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    .map(g => ({
      ...g,
      stats: {
        present: g.present,
        late: g.late,
        excused: g.excused,
        absent: g.absent,
        ...computeAttendanceRate(g)
      }
    }));
}

function escapeCsvCell(rawValue) {
  let str = rawValue === null || rawValue === undefined ? '' : String(rawValue);
  str = str.replace(/\r?\n/g, ' ').trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n']/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildAttendanceCsvContent({
  students = [],
  attendanceRows = [],
  personResolver = uid => uid
} = {}) {
  const stats = computeStudentAttendanceStats(students, attendanceRows);
  const dates = [...new Set(
    (Array.isArray(attendanceRows) ? attendanceRows : [])
      .map(r => parseIsoDateParts(r?.lesson_date)?.iso)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  const recordLookup = new Map();
  for (const row of Array.isArray(attendanceRows) ? attendanceRows : []) {
    if (!row?.student_uid || !row?.lesson_date) continue;
    recordLookup.set(`${row.student_uid}|${row.lesson_date}`, row);
  }

  const header = [
    'STT',
    'Mã học sinh',
    'Họ và tên',
    'Tỷ lệ chuyên cần (%)',
    'Tổng buổi',
    'Có mặt',
    'Đi muộn',
    'Nghỉ có phép',
    'Vắng không phép',
    ...dates.map(d => formatLessonDateShort(d))
  ];

  const rows = [header.map(escapeCsvCell).join(',')];
  stats.forEach((st, idx) => {
    const displayName = st.name || personResolver(st.uid) || st.uid;
    const baseCols = [
      String(idx + 1),
      st.studentCode || '',
      displayName,
      st.ratePct === null ? '' : String(st.ratePct),
      String(st.total),
      String(st.present),
      String(st.late),
      String(st.excused),
      String(st.absent)
    ];
    const dateCols = dates.map(d => {
      const rec = recordLookup.get(`${st.uid}|${d}`);
      if (!rec) return '';
      const label = STATUS_BY_VALUE[rec.status]?.label || rec.status;
      const cleanNote = String(rec.note || '').trim();
      return cleanNote ? `${label} (${cleanNote})` : label;
    });
    rows.push([...baseCols, ...dateCols].map(escapeCsvCell).join(','));
  });

  return `\uFEFF${rows.join('\n')}`;
}

function triggerCsvDownload(filename, csvContent) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return false;
  try {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

function getStudentInitials(name = '') {
  const tokens = String(name || '')
    .trim()
    .split(/\s+/)
    .map(t => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  if (!tokens.length) return 'HS';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toLocaleUpperCase('vi-VN');
  return tokens.slice(-2).map(t => t[0]).join('').toLocaleUpperCase('vi-VN') || 'HS';
}

export function renderStaffAttendanceWorkspace({
  root,
  classId,
  classInfo = null,
  isArchived = false,
  students: rawStudents = [],
  attendanceRows = [],
  canWrite = false,
  initialDate = null,
  sessionsLoader = null,
  personResolver = uid => uid || 'Thành viên',
  onSaveRecord,
  onOpenHistoryModal = null,
  onDateChange = null,
  onOpenSessionLink = null,
  onStatusToast = null
}) {
  if (!root) return;
  root.replaceChildren();

  const students = sortStudentsRoster(rawStudents || []);
  const todayStr = getVietnamTodayIso();
  const allRows = Array.isArray(attendanceRows) ? attendanceRows : [];
  let effectiveScheduleSlots = extractClassScheduleSlots(classInfo || {});
  let courseStartDate = resolveCourseStartDate(null, classInfo);

  let sessions = [];
  let sessionLookup = new Map();
  let selectedDate = parseIsoDateParts(initialDate)?.iso || todayStr;
  let activeView = 'rollcall'; // 'rollcall' | 'students' | 'history'
  let searchQuery = '';
  let statusFilter = 'all';
  let analyticsSearch = '';
  let analyticsFilter = 'all'; // 'all' | 'attention' | 'good'
  let analyticsSort = 'name'; // 'name' | 'rate_asc' | 'absent_desc'
  let pendingSwitchDate = null;
  let isSaving = false;

  const expandedNoteUids = new Set();
  const rowRefs = new Map();

  let savedMap = buildDateAttendanceMap(allRows, selectedDate);
  let draftMap = new Map();
  let studentStatsCache = computeStudentAttendanceStats(students, allRows);
  let studentStatsByUid = new Map(studentStatsCache.map(s => [s.uid, s]));

  function refreshDerivedStats() {
    studentStatsCache = computeStudentAttendanceStats(students, allRows);
    studentStatsByUid = new Map(studentStatsCache.map(s => [s.uid, s]));
  }

  function syncDraftFromSaved() {
    savedMap = buildDateAttendanceMap(allRows, selectedDate);
    draftMap = new Map();
    expandedNoteUids.clear();
    for (const [uid, entry] of savedMap.entries()) {
      draftMap.set(uid, { status: entry.status, note: entry.note });
      if (String(entry.note || '').trim()) {
        expandedNoteUids.add(uid);
      }
    }
  }
  syncDraftFromSaved();

  const container = attEl('div', { class: 'attendance-workspace' });

  // =========================================================================
  // 1. HEADER BAR & VIEW MODE TABS
  // =========================================================================
  const metaPills = [];
  if (classInfo?.schedule) {
    metaPills.push(
      attEl(
        'span',
        { class: 'att-meta-chip' },
        attIcon('calendar', 14),
        attEl('span', { text: classInfo.schedule })
      )
    );
  }
  metaPills.push(
    attEl(
      'span',
      { class: 'att-meta-chip' },
      attIcon('users', 14),
      attEl('span', { text: `${students.length} học sinh` })
    )
  );
  if (isArchived) {
    metaPills.push(attEl('span', { class: 'badge badge-warning', text: 'Chế độ xem lưu trữ' }));
  } else if (!canWrite) {
    metaPills.push(attEl('span', { class: 'badge badge-info', text: 'Chế độ chỉ xem' }));
  }

  const commandBar = attEl(
    'header',
    { class: 'att-command-bar' },
    attEl(
      'div',
      { class: 'att-command-info' },
      attEl('h1', { class: 'att-command-title', text: 'Điểm danh lớp học' }),
      attEl('div', { class: 'att-command-meta' }, ...metaPills)
    )
  );

  const tabAttentionBadge = attEl('span', { class: 'att-tab-count is-warn', hidden: true });
  const tabHistoryBadge = attEl('span', { class: 'att-tab-count', hidden: true });

  const viewTabsHost = attEl('div', {
    class: 'att-view-tabs',
    role: 'tablist',
    'aria-label': 'Chế độ xem điểm danh'
  });

  const viewTabDefs = [
    { key: 'rollcall', label: 'Điểm danh buổi học', iconName: 'calendar', badgeEl: null },
    { key: 'students', label: 'Tổng hợp học sinh', iconName: 'users', badgeEl: tabAttentionBadge },
    { key: 'history', label: 'Lịch sử các buổi', iconName: 'history', badgeEl: tabHistoryBadge }
  ];

  const viewTabButtons = new Map();

  // Tab panels
  const rollcallPanel = attEl('section', {
    id: 'att-panel-rollcall',
    class: 'att-tabpanel',
    role: 'tabpanel',
    'aria-labelledby': 'att-tab-rollcall'
  });
  const studentsPanel = attEl('section', {
    id: 'att-panel-students',
    class: 'att-tabpanel',
    role: 'tabpanel',
    'aria-labelledby': 'att-tab-students',
    hidden: true
  });
  const historyPanel = attEl('section', {
    id: 'att-panel-history',
    class: 'att-tabpanel',
    role: 'tabpanel',
    'aria-labelledby': 'att-tab-history',
    hidden: true
  });

  function switchView(nextView) {
    activeView = nextView;
    for (const [key, btn] of viewTabButtons.entries()) {
      const isSelected = key === activeView;
      btn.classList.toggle('is-active', isSelected);
      btn.setAttribute('aria-selected', String(isSelected));
    }
    rollcallPanel.hidden = activeView !== 'rollcall';
    studentsPanel.hidden = activeView !== 'students';
    historyPanel.hidden = activeView !== 'history';

    if (activeView === 'students') renderStudentsAnalyticsPanel();
    if (activeView === 'history') renderHistorySection();
  }

  for (const def of viewTabDefs) {
    const btn = attEl(
      'button',
      {
        id: `att-tab-${def.key}`,
        type: 'button',
        class: `att-view-tab${def.key === activeView ? ' is-active' : ''}`,
        role: 'tab',
        'aria-selected': String(def.key === activeView),
        'aria-controls': `att-panel-${def.key}`,
        onclick: () => switchView(def.key)
      },
      attIcon(def.iconName, 16),
      attEl('span', { text: def.label }),
      def.badgeEl
    );
    viewTabButtons.set(def.key, btn);
    viewTabsHost.append(btn);
  }

  function updateTabBadges() {
    const attentionCount = studentStatsCache.filter(s => s.needsAttention).length;
    if (attentionCount > 0) {
      tabAttentionBadge.hidden = false;
      tabAttentionBadge.textContent = String(attentionCount);
    } else {
      tabAttentionBadge.hidden = true;
    }

    const sessionCount = groupAttendanceByDate(allRows).length;
    if (sessionCount > 0) {
      tabHistoryBadge.hidden = false;
      tabHistoryBadge.textContent = String(sessionCount);
    } else {
      tabHistoryBadge.hidden = true;
    }
  }

  // =========================================================================
  // 2. ROLLCALL PANEL: SESSION BAR + UNSAVED GUARD + KPI + TOOLBAR + ROSTER
  // =========================================================================
  const dateDisplay = attEl('span', { class: 'att-date-display', text: formatLessonDateLong(selectedDate) });
  const dateInput = attEl('input', {
    type: 'date',
    class: 'att-date-native-overlay',
    value: selectedDate,
    'aria-label': 'Chọn ngày buổi học'
  });
  const datePickerLabel = attEl(
    'label',
    {
      class: 'att-date-picker-label',
      title: 'Chọn ngày buổi học',
      onclick: () => {
        try {
          if (typeof dateInput.showPicker === 'function') dateInput.showPicker();
        } catch {}
      }
    },
    attIcon('calendar', 15),
    dateDisplay,
    dateInput
  );

  const prevDateBtn = attEl(
    'button',
    {
      type: 'button',
      class: 'att-nav-btn',
      'aria-label': 'Buổi trước',
      title: 'Buổi trước',
      onclick: () => {
        const nav = computeDateNavigationTargets({
          selectedDate,
          scheduleSlots: effectiveScheduleSlots,
          recordedDates: groupAttendanceByDate(allRows).map(g => g.date),
          sessions,
          todayIso: todayStr
        });
        requestDateSwitch(nav.prevDate);
      }
    },
    attIcon('chevronLeft', 16)
  );

  const nextDateBtn = attEl(
    'button',
    {
      type: 'button',
      class: 'att-nav-btn',
      'aria-label': 'Buổi sau',
      title: 'Buổi sau',
      onclick: () => {
        const nav = computeDateNavigationTargets({
          selectedDate,
          scheduleSlots: effectiveScheduleSlots,
          recordedDates: groupAttendanceByDate(allRows).map(g => g.date),
          sessions,
          todayIso: todayStr
        });
        requestDateSwitch(nav.nextDate);
      }
    },
    attIcon('chevronRight', 16)
  );

  const todayQuickBtn = attEl('button', {
    type: 'button',
    class: 'att-chip-btn',
    text: 'Hôm nay',
    hidden: selectedDate === todayStr,
    onclick: () => requestDateSwitch(todayStr)
  });

  const dateStepper = attEl('div', { class: 'att-date-stepper' }, prevDateBtn, datePickerLabel, nextDateBtn);

  function getSessionInfoForDate(isoDate) {
    return computeSessionInfoFromStartDate({
      targetDate: isoDate,
      startDate: courseStartDate,
      scheduleSlots: effectiveScheduleSlots
    });
  }

  const sessionStatusPill = attEl('span', {
    class: 'att-session-status-pill is-empty',
    role: 'status',
    'aria-live': 'polite'
  });
  const sessionMetaHost = attEl('div', { class: 'att-session-meta-inline' });

  const recordedMenuWrap = createActionMenu({
    label: 'Đã chấm (0)',
    ariaLabel: 'Chọn nhanh buổi đã điểm danh',
    iconName: 'history',
    triggerClass: 'att-recorded-trigger',
    align: 'end',
    minMenuWidth: 250,
    getItems: () => {
      const groups = groupAttendanceByDate(allRows);
      const items = groups.slice(0, 8).map(g => {
        const info = getSessionInfoForDate(g.date);
        const datePart = `${weekdayShortVi(g.date)}, ${formatLessonDateShort(g.date)}`;
        const prefix = info.sessionNumber
          ? `Buổi ${String(info.sessionNumber).padStart(2, '0')}`
          : info.isBeforeStart
            ? 'Trước ngày bắt đầu'
            : 'Ngoài lịch';
        return {
          icon: g.date === selectedDate ? 'check' : 'calendar',
          label: `${prefix} · ${datePart}`,
          hint: `${g.records.length}/${students.length || g.records.length}`,
          onSelect: () => requestDateSwitch(g.date)
        };
      });
      if (groups.length > 8) {
        items.push({
          label: `Xem tất cả ${groups.length} buổi trong Lịch sử`,
          icon: 'history',
          dividerBefore: true,
          onSelect: () => switchView('history')
        });
      }
      return items;
    }
  });
  recordedMenuWrap.classList.add('att-recorded-menu-wrap');

  const unsavedGuardHost = attEl('div', {
    class: 'att-unsaved-guard',
    role: 'alert',
    hidden: true
  });

  function applyDateSwitch(nextDate) {
    if (!parseIsoDateParts(nextDate) || isSaving) return;
    selectedDate = nextDate;
    pendingSwitchDate = null;
    unsavedGuardHost.hidden = true;
    dateInput.value = selectedDate;
    dateDisplay.textContent = formatLessonDateLong(selectedDate);
    todayQuickBtn.hidden = selectedDate === todayStr;
    syncDraftFromSaved();
    renderSessionContext();
    renderRecordedSessionsMenu();
    renderKpiAndSaveState();
    renderRosterRows();
    if (typeof onDateChange === 'function') {
      onDateChange(selectedDate);
    }
  }

  function requestDateSwitch(nextDate) {
    const valid = parseIsoDateParts(nextDate)?.iso;
    if (!valid || valid === selectedDate || isSaving) {
      if (valid) dateInput.value = selectedDate;
      return;
    }
    const changed = canWrite ? getChangedAttendanceEntries(students, savedMap, draftMap) : [];
    if (changed.length > 0) {
      pendingSwitchDate = valid;
      dateInput.value = selectedDate;
      renderUnsavedGuard(changed.length);
      return;
    }
    applyDateSwitch(valid);
  }

  function renderUnsavedGuard(changedCount) {
    if (!pendingSwitchDate) {
      unsavedGuardHost.hidden = true;
      unsavedGuardHost.replaceChildren();
      return;
    }
    const targetDate = pendingSwitchDate;
    unsavedGuardHost.hidden = false;
    unsavedGuardHost.replaceChildren(
      attEl(
        'div',
        { class: 'att-unsaved-guard-msg' },
        attIcon('alert', 18),
        attEl('span', {
          text: `Có ${changedCount} học sinh chưa lưu ở ngày ${formatLessonDateShort(selectedDate)}. Bạn muốn xử lý thế nào trước khi chuyển sang ${formatLessonDateShort(targetDate)}?`
        })
      ),
      attEl(
        'div',
        { class: 'att-unsaved-guard-actions' },
        attEl('button', {
          type: 'button',
          class: 'primary att-guard-btn',
          text: 'Lưu rồi chuyển',
          onclick: async () => {
            const ok = await saveChangedRecords();
            if (ok) applyDateSwitch(targetDate);
          }
        }),
        attEl('button', {
          type: 'button',
          class: 'secondary att-guard-btn',
          text: 'Bỏ thay đổi & chuyển',
          onclick: () => applyDateSwitch(targetDate)
        }),
        attEl('button', {
          type: 'button',
          class: 'att-guard-btn',
          text: 'Ở lại',
          onclick: () => {
            pendingSwitchDate = null;
            unsavedGuardHost.hidden = true;
          }
        })
      )
    );
  }

  dateInput.addEventListener('change', () => {
    if (dateInput.value) requestDateSwitch(dateInput.value);
  });

  const sessionBar = attEl(
    'section',
    { class: 'att-session-bar', 'aria-label': 'Chọn ngày và thông tin buổi học' },
    attEl(
      'div',
      { class: 'att-session-top' },
      attEl(
        'div',
        { class: 'att-date-nav' },
        dateStepper,
        todayQuickBtn,
        sessionMetaHost
      ),
      attEl('div', { class: 'att-session-right' }, recordedMenuWrap, sessionStatusPill)
    ),
    unsavedGuardHost
  );

  function renderSessionContext() {
    sessionMetaHost.replaceChildren();
    const info = getSessionInfoForDate(selectedDate);
    const matchedSession = sessionLookup.get(selectedDate) || null;
    const lessonName = matchedSession?.lessonName ? String(matchedSession.lessonName).trim() : '';

    if (info.isBeforeStart) {
      sessionMetaHost.append(
        attEl(
          'span',
          { class: 'att-context-badge is-extra' },
          attEl('span', { text: 'Trước ngày bắt đầu' })
        )
      );
      return;
    }

    if (info.sessionNumber) {
      const noLabel = String(info.sessionNumber).padStart(2, '0');
      const titleText = lessonName ? `Buổi ${noLabel}: ${lessonName}` : `Buổi ${noLabel}`;
      sessionMetaHost.append(
        attEl(
          'span',
          { class: 'att-context-badge is-matched', title: titleText },
          attIcon('book', 13),
          attEl('span', { text: titleText })
        )
      );
      return;
    }

    const extraText = lessonName ? `Ngoài lịch: ${lessonName}` : 'Ngoài lịch';
    sessionMetaHost.append(
      attEl(
        'span',
        { class: 'att-context-badge is-extra', title: extraText },
        attEl('span', { text: extraText })
      )
    );
  }

  function renderRecordedSessionsMenu() {
    const count = groupAttendanceByDate(allRows).length;
    recordedMenuWrap.hidden = count === 0;
    const labelEl = recordedMenuWrap.querySelector('.ltch-action-menu-label');
    if (labelEl) labelEl.textContent = `Đã chấm (${count})`;
  }

  // 3. KPI Filter Strip
  const kpiHost = attEl('div', {
    class: 'att-kpi-grid',
    role: 'group',
    'aria-label': 'Lọc theo trạng thái điểm danh'
  });

  const kpiCards = [
    { key: 'all', label: 'Tất cả', tone: 'total' },
    { key: 'present', label: 'Có mặt', tone: 'present' },
    { key: 'late', label: 'Đi muộn', tone: 'late' },
    { key: 'excused', label: 'Có phép', tone: 'excused' },
    { key: 'absent', label: 'Vắng KP', tone: 'absent' },
    { key: 'unmarked', label: 'Chưa chấm', tone: 'unmarked' }
  ].map(({ key, label, tone }) => {
    const countEl = attEl('span', { class: 'att-kpi-count', text: '0' });
    const labelEl = attEl('span', { class: 'att-kpi-label', text: label });
    const button = attEl(
      'button',
      {
        type: 'button',
        class: `att-kpi-card tone-${tone}`,
        'aria-controls': 'attendance-student-roster',
        'aria-pressed': String(statusFilter === key),
        onclick: () => {
          statusFilter = statusFilter === key && key !== 'all' ? 'all' : key;
          renderKpiAndSaveState();
          renderRosterRows();
        }
      },
      countEl,
      labelEl
    );
    kpiHost.append(button);
    return { key, button, countEl };
  });

  // 4. Roster Toolbar
  const searchInput = attEl('input', {
    type: 'search',
    class: 'att-search-input',
    placeholder: 'Tìm theo tên hoặc mã học sinh…',
    'aria-label': 'Tìm kiếm học sinh trong lớp'
  });
  const searchClearBtn = attEl(
    'button',
    {
      type: 'button',
      class: 'att-search-clear',
      'aria-label': 'Xóa tìm kiếm',
      hidden: true,
      onclick: () => {
        searchQuery = '';
        searchInput.value = '';
        searchClearBtn.hidden = true;
        renderRosterRows();
      }
    },
    attIcon('close', 14)
  );

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    searchClearBtn.hidden = !searchQuery.trim();
    renderRosterRows();
  });

  const quickBulkBtn = attEl('button', {
    type: 'button',
    class: 'att-quick-bulk-btn',
    hidden: true,
    onclick: () => {
      if (!canWrite || isSaving) return;
      const counts = computeAttendanceCounts(students, draftMap);
      if (counts.unmarked > 0) {
        for (const s of students) {
          if (!draftMap.get(s.uid)?.status) {
            draftMap.set(s.uid, { status: 'present', note: '' });
          }
        }
      } else {
        for (const s of students) {
          const existing = draftMap.get(s.uid);
          draftMap.set(s.uid, { status: 'present', note: existing?.note || '' });
        }
      }
      renderKpiAndSaveState();
      renderRosterRows();
    }
  }, attIcon('present', 15), attEl('span', { text: 'Có mặt cả lớp' }));

  const undoBtn = attEl(
    'button',
    {
      type: 'button',
      class: 'att-quick-bulk-btn att-undo-btn',
      text: 'Hoàn tác',
      hidden: true,
      onclick: () => {
        if (isSaving) return;
        syncDraftFromSaved();
        renderKpiAndSaveState();
        renderRosterRows();
      }
    }
  );

  const batchSaveBtn = attEl(
    'button',
    {
      type: 'button',
      class: 'primary att-batch-save-btn',
      onclick: () => saveChangedRecords()
    },
    attEl('span', { text: 'Lưu bảng điểm danh' })
  );

  const bulkToolbar = attEl(
    'div',
    { class: 'att-roster-toolbar' },
    attEl(
      'div',
      { class: 'att-search-wrap' },
      attIcon('search', 16, 'att-search-icon'),
      searchInput,
      searchClearBtn
    )
  );

  if (canWrite && students.length) {
    bulkToolbar.append(
      attEl('div', { class: 'att-save-tools' }, quickBulkBtn, undoBtn, batchSaveBtn)
    );
  } else if (allRows.length) {
    bulkToolbar.append(
      attEl(
        'div',
        { class: 'att-save-tools' },
        attEl(
          'button',
          {
            type: 'button',
            class: 'secondary att-export-btn',
            onclick: () => handleExportCsv()
          },
          attIcon('download', 15),
          attEl('span', { text: 'Xuất CSV' })
        )
      )
    );
  }

  function handleExportCsv() {
    const csv = buildAttendanceCsvContent({ students, attendanceRows: allRows, personResolver });
    const ok = triggerCsvDownload(`diem-danh-${classId || 'lop'}-${selectedDate}.csv`, csv);
    if (typeof onStatusToast === 'function') {
      if (ok) onStatusToast('Đã tải xuống bảng điểm danh (CSV).', false, 'success');
      else onStatusToast('Trình duyệt không hỗ trợ tải tệp trực tiếp.', true);
    }
  }

  // 5. Student Roster Host
  const rosterHost = attEl('div', {
    id: 'attendance-student-roster',
    class: 'att-roster-list',
    role: 'list'
  });

  function renderKpiAndSaveState() {
    const counts = computeAttendanceCounts(students, draftMap);
    const rate = computeAttendanceRate(counts);
    const changed = getChangedAttendanceEntries(students, savedMap, draftMap);

    for (const { key, button, countEl } of kpiCards) {
      const value = key === 'all' ? counts.total : (counts[key] ?? 0);
      countEl.textContent = String(value);
      button.setAttribute('aria-pressed', String(statusFilter === key));
    }

    if (!students.length) {
      sessionStatusPill.className = 'att-session-status-pill is-empty';
      sessionStatusPill.textContent = 'Chưa có học sinh';
    } else if (counts.marked === 0) {
      sessionStatusPill.className = 'att-session-status-pill is-empty';
      sessionStatusPill.textContent = `Chưa chấm · 0/${counts.total}`;
    } else if (counts.marked < counts.total) {
      sessionStatusPill.className = 'att-session-status-pill is-partial';
      sessionStatusPill.textContent = `Đang chấm ${counts.marked}/${counts.total}`;
    } else {
      const rateSuffix = rate.ratePct !== null ? ` · ${rate.ratePct}%` : '';
      sessionStatusPill.className = 'att-session-status-pill is-done';
      sessionStatusPill.textContent = `Đã chấm ${counts.marked}/${counts.total}${rateSuffix}`;
    }

    if (canWrite && students.length) {
      batchSaveBtn.disabled = isSaving || changed.length === 0;
      undoBtn.hidden = isSaving || changed.length === 0;
      undoBtn.disabled = isSaving;

      if (counts.unmarked > 0) {
        quickBulkBtn.hidden = false;
        quickBulkBtn.disabled = isSaving;
        quickBulkBtn.querySelector('span:last-child').textContent = `Có mặt còn lại (${counts.unmarked})`;
      } else if (counts.present < counts.total) {
        quickBulkBtn.hidden = false;
        quickBulkBtn.disabled = isSaving;
        quickBulkBtn.querySelector('span:last-child').textContent = 'Cả lớp có mặt';
      } else {
        quickBulkBtn.hidden = true;
      }

      if (isSaving) {
        batchSaveBtn.querySelector('span').textContent = 'Đang lưu…';
      } else if (changed.length > 0) {
        batchSaveBtn.querySelector('span').textContent = `Lưu bảng điểm danh (${changed.length})`;
      } else {
        batchSaveBtn.querySelector('span').textContent = 'Lưu bảng điểm danh';
      }
    }

    updateTabBadges();
  }

  function upsertLocalRow(studentUid, dateStr, statusValue, noteValue) {
    const id = `${classId}_${studentUid}_${dateStr}`;
    const existingIndex = allRows.findIndex(
      r => r.student_uid === studentUid && r.lesson_date === dateStr
    );
    const updatedRow = {
      id,
      class_id: classId,
      student_uid: studentUid,
      lesson_date: dateStr,
      status: statusValue,
      note: noteValue,
      updated_at: Date.now()
    };
    if (existingIndex >= 0) {
      allRows[existingIndex] = updatedRow;
    } else {
      allRows.unshift(updatedRow);
    }
    refreshDerivedStats();
  }

  async function saveSingleStudent(studentUid) {
    if (!canWrite || isSaving) return;
    const draft = draftMap.get(studentUid);
    if (!draft || !draft.status) return;
    isSaving = true;
    renderKpiAndSaveState();
    syncRowInPlace(studentUid);
    try {
      const result = await onSaveRecord({
        studentUid,
        date: selectedDate,
        status: draft.status,
        note: String(draft.note || '').trim()
      });
      upsertLocalRow(studentUid, selectedDate, draft.status, String(draft.note || '').trim());
      savedMap = buildDateAttendanceMap(allRows, selectedDate);
      if (typeof onStatusToast === 'function') {
        if (result?.notificationStatus === 'failed') {
          onStatusToast('Đã lưu điểm danh. Chưa chuyển được email thông báo sang Google.', true);
        } else {
          onStatusToast('Đã lưu điểm danh học sinh.', false, 'success');
        }
      }
    } catch (err) {
      if (typeof onStatusToast === 'function') {
        onStatusToast(err.message || 'Không thể lưu điểm danh.', true);
      }
    } finally {
      isSaving = false;
      renderRecordedSessionsMenu();
      renderKpiAndSaveState();
      renderRosterRows();
      if (activeView === 'students') renderStudentsAnalyticsPanel();
      if (activeView === 'history') renderHistorySection();
    }
  }

  async function saveChangedRecords() {
    if (!canWrite || isSaving) return false;
    let targets = getChangedAttendanceEntries(students, savedMap, draftMap);
    if (!targets.length) {
      for (const s of students) {
        const draft = draftMap.get(s.uid);
        if (draft?.status && !savedMap.has(s.uid)) {
          targets.push({
            studentUid: s.uid,
            studentName: s.name || s.uid,
            status: draft.status,
            note: String(draft.note || '').trim()
          });
        }
      }
    }
    if (!targets.length) {
      if (typeof onStatusToast === 'function') {
        onStatusToast('Tất cả dữ liệu điểm danh của buổi này đã được lưu.', false, 'success');
      }
      return true;
    }

    isSaving = true;
    renderKpiAndSaveState();
    renderRosterRows();
    let savedCount = 0;
    let mailFailures = 0;
    let succeeded = false;

    try {
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        const progressLabel = `Đang lưu ${i + 1}/${targets.length}…`;
        batchSaveBtn.querySelector('span').textContent = progressLabel;
        const result = await onSaveRecord({
          studentUid: item.studentUid,
          date: selectedDate,
          status: item.status,
          note: item.note
        });
        if (result?.notificationStatus === 'failed') mailFailures++;
        upsertLocalRow(item.studentUid, selectedDate, item.status, item.note);
        savedCount++;
      }
      savedMap = buildDateAttendanceMap(allRows, selectedDate);
      succeeded = true;
      if (typeof onStatusToast === 'function') {
        if (mailFailures) {
          onStatusToast(`Đã lưu điểm danh cho ${savedCount} học sinh. Chưa chuyển được email của ${mailFailures} học sinh sang Google.`, true);
        } else {
          onStatusToast(`Đã lưu điểm danh thành công cho ${savedCount} học sinh (${formatLessonDateShort(selectedDate)}).`, false, 'success');
        }
      }
    } catch (err) {
      savedMap = buildDateAttendanceMap(allRows, selectedDate);
      if (typeof onStatusToast === 'function') {
        onStatusToast(
          `Đã lưu ${savedCount}/${targets.length} học sinh. Lỗi: ${err.message || 'Vui lòng thử lưu lại.'}`,
          true
        );
      }
    } finally {
      isSaving = false;
      renderRecordedSessionsMenu();
      renderKpiAndSaveState();
      renderRosterRows();
      if (activeView === 'students') renderStudentsAnalyticsPanel();
      if (activeView === 'history') renderHistorySection();
    }
    return succeeded;
  }

  function computeRowDirtyState(uid) {
    const saved = savedMap.get(uid);
    const draft = draftMap.get(uid) || { status: '', note: '' };
    const isDirty = Boolean(
      draft.status &&
      (!saved || saved.status !== draft.status || String(saved.note || '').trim() !== String(draft.note || '').trim())
    );
    return { saved, draft, isDirty };
  }

  function syncRowInPlace(uid) {
    const refs = rowRefs.get(uid);
    if (!refs) return;
    const { saved, draft, isDirty } = computeRowDirtyState(uid);
    const hasNote = Boolean(String(draft.note || '').trim());
    const isDrawerOpen = expandedNoteUids.has(uid);

    refs.row.className = `att-student-row${draft.status ? ` status-${draft.status}` : ' status-unmarked'}${isDirty ? ' is-dirty' : ''}`;

    if (isDirty) {
      refs.stateBadge.className = 'att-row-state is-dirty';
      refs.stateBadge.textContent = 'Chưa lưu';
      refs.stateBadge.hidden = false;
    } else if (!saved) {
      refs.stateBadge.className = 'att-row-state is-unmarked';
      refs.stateBadge.textContent = 'Chưa chấm';
      refs.stateBadge.hidden = false;
    } else {
      refs.stateBadge.className = 'att-row-state is-saved';
      refs.stateBadge.textContent = 'Đã lưu';
      refs.stateBadge.hidden = false;
    }

    for (const { value, button } of refs.statusButtons) {
      const selected = draft.status === value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = !canWrite || isSaving;
    }

    refs.noteToggleBtn.classList.toggle('has-note', hasNote);
    refs.noteToggleBtn.setAttribute('aria-expanded', String(isDrawerOpen));
    refs.noteToggleText.textContent = hasNote ? 'Có ghi chú' : 'Ghi chú';

    refs.noteDrawer.hidden = !isDrawerOpen;
    if (refs.noteInput.value !== (draft.note || '')) {
      refs.noteInput.value = draft.note || '';
    }
    refs.noteInput.disabled = !canWrite || isSaving;

    if (refs.quickNotesHost) {
      refs.quickNotesHost.replaceChildren();
      if (canWrite && isDrawerOpen) {
        const suggestions = ATTENDANCE_QUICK_NOTES[draft.status || 'present'] || ATTENDANCE_QUICK_NOTES.present;
        for (const text of suggestions) {
          refs.quickNotesHost.append(
            attEl('button', {
              type: 'button',
              class: `att-quick-note-chip${String(draft.note || '').trim() === text ? ' is-active' : ''}`,
              disabled: isSaving,
              text,
              onclick: () => {
                const cur = draftMap.get(uid) || { status: saved?.status || 'present', note: '' };
                draftMap.set(uid, { status: cur.status || 'present', note: text });
                refs.noteInput.value = text;
                syncRowInPlace(uid);
                renderKpiAndSaveState();
              }
            })
          );
        }
      }
    }

    if (refs.quickSaveBtn) {
      refs.quickSaveBtn.hidden = !canWrite || !isDirty;
      refs.quickSaveBtn.disabled = !draft.status || isSaving;
    }
  }

  function renderRosterRows() {
    rowRefs.clear();
    rosterHost.replaceChildren();

    if (!students.length) {
      rosterHost.append(
        attEl('p', {
          class: 'empty',
          text: 'Lớp hiện chưa có học sinh nào trong danh sách để điểm danh.'
        })
      );
      return;
    }

    const q = normalizeSearchText(searchQuery);
    const filtered = students.filter(s => {
      const draft = draftMap.get(s.uid);
      const currentStatus = draft?.status || 'unmarked';
      if (statusFilter !== 'all' && currentStatus !== statusFilter) return false;
      if (!q) return true;
      const haystack = normalizeSearchText(`${s.name || ''} ${s.student_code || ''} ${s.uid || ''}`);
      return haystack.includes(q);
    });

    if (!filtered.length) {
      rosterHost.append(
        attEl(
          'div',
          { class: 'att-filter-empty' },
          attEl('p', { class: 'empty', text: 'Không tìm thấy học sinh phù hợp với bộ lọc hiện tại.' }),
          attEl('button', {
            type: 'button',
            class: 'secondary',
            text: 'Xem tất cả học sinh',
            onclick: () => {
              statusFilter = 'all';
              searchQuery = '';
              searchInput.value = '';
              searchClearBtn.hidden = true;
              renderKpiAndSaveState();
              renderRosterRows();
            }
          })
        )
      );
      return;
    }

    filtered.forEach((student, idx) => {
      const studentName = student.name || personResolver(student.uid) || student.uid;
      const initials = getStudentInitials(studentName);
      const stat = studentStatsByUid.get(student.uid);
      const rateChip = stat && stat.total > 0
        ? attEl('span', {
            class: `att-student-rate-chip${stat.needsAttention ? ' is-warn' : ''}`,
            text: stat.absent > 0 ? `${stat.ratePct}% · ${stat.absent} vắng` : `${stat.ratePct}%`
          })
        : null;

      const stateBadge = attEl('span', { class: 'att-row-state' });
      const noteInputId = `att-note-${student.uid}-${idx}`;

      const statusButtons = ATTENDANCE_STATUSES.map(st => {
        const button = attEl(
          'button',
          {
            type: 'button',
            class: `att-status-pill tone-${st.tone}`,
            'aria-pressed': 'false',
            onclick: () => {
              if (!canWrite || isSaving) return;
              const current = draftMap.get(student.uid) || { status: '', note: '' };
              draftMap.set(student.uid, { status: st.value, note: current.note });
              if (st.value !== 'present') {
                expandedNoteUids.add(student.uid);
              }
              renderKpiAndSaveState();
              if (statusFilter !== 'all' && statusFilter !== st.value) {
                renderRosterRows();
              } else {
                syncRowInPlace(student.uid);
              }
            }
          },
          attIcon(st.value, 14),
          attEl('span', { text: st.shortLabel })
        );
        return { value: st.value, button };
      });

      const noteToggleText = attEl('span', { text: 'Ghi chú' });
      const noteToggleBtn = attEl(
        'button',
        {
          type: 'button',
          class: 'att-note-toggle-btn',
          'aria-expanded': 'false',
          onclick: () => {
            if (expandedNoteUids.has(student.uid)) expandedNoteUids.delete(student.uid);
            else expandedNoteUids.add(student.uid);
            syncRowInPlace(student.uid);
            if (expandedNoteUids.has(student.uid) && canWrite) {
              noteInput.focus();
            }
          }
        },
        attIcon('note', 14),
        noteToggleText
      );

      const noteInput = attEl('input', {
        id: noteInputId,
        type: 'text',
        class: 'att-note-input',
        maxLength: 1000,
        placeholder: 'Nhập ghi chú (VD: Muộn 10p, phụ huynh đã xin phép...)',
        'aria-label': `Ghi chú điểm danh cho ${studentName}`
      });

      const quickNotesHost = canWrite ? attEl('div', { class: 'att-quick-note-chips' }) : null;

      const quickSaveBtn = canWrite
        ? attEl(
            'button',
            {
              type: 'button',
              class: 'att-row-save-btn',
              hidden: true,
              onclick: () => saveSingleStudent(student.uid)
            },
            attEl('span', { text: 'Lưu riêng' })
          )
        : null;

      noteInput.addEventListener('input', () => {
        if (!canWrite || isSaving) return;
        const current = draftMap.get(student.uid) || { status: savedMap.get(student.uid)?.status || 'present', note: '' };
        const nextStatus = current.status || 'present';
        draftMap.set(student.uid, { status: nextStatus, note: noteInput.value });
        syncRowInPlace(student.uid);
        renderKpiAndSaveState();
      });

      const noteDrawer = attEl(
        'div',
        { class: 'att-row-note-drawer', hidden: true },
        attEl(
          'div',
          { class: 'att-note-input-row' },
          attEl('label', { for: noteInputId, class: 'sr-only', text: `Ghi chú cho ${studentName}` }),
          noteInput,
          quickSaveBtn
        ),
        quickNotesHost
      );

      const row = attEl(
        'article',
        { class: 'att-student-row', role: 'listitem' },
        attEl(
          'div',
          { class: 'att-student-main' },
          attEl(
            'div',
            { class: 'att-student-identity' },
            attEl('span', { class: 'att-student-index', text: String(idx + 1).padStart(2, '0') }),
            attEl('span', { class: 'att-student-avatar', 'aria-hidden': 'true', text: initials }),
            attEl(
              'div',
              { class: 'att-student-name-box' },
              attEl('strong', { class: 'att-student-name', text: studentName }),
              attEl(
                'div',
                { class: 'att-student-submeta' },
                student.student_code ? attEl('span', { class: 'att-code-badge', text: student.student_code }) : null,
                rateChip,
                stateBadge
              )
            )
          ),
          attEl(
            'div',
            { class: 'att-student-actions' },
            attEl(
              'div',
              {
                class: 'att-status-group',
                role: 'group',
                'aria-label': `Trạng thái điểm danh của ${studentName}`
              },
              ...statusButtons.map(b => b.button)
            ),
            noteToggleBtn
          )
        ),
        noteDrawer
      );

      rowRefs.set(student.uid, {
        row,
        stateBadge,
        statusButtons,
        noteToggleBtn,
        noteToggleText,
        noteDrawer,
        noteInput,
        quickNotesHost,
        quickSaveBtn
      });

      syncRowInPlace(student.uid);
      rosterHost.append(row);
    });
  }

  // =========================================================================
  // 3. TAB 2: TỔNG HỢP CHUYÊN CẦN THEO HỌC SINH
  // =========================================================================
  function openStudentDetailModal(stat) {
    if (typeof onOpenHistoryModal !== 'function') return;
    const rateLabel = stat.ratePct !== null ? `${stat.ratePct}%` : 'Chưa có';
    const body = attEl(
      'section',
      { class: 'att-student-detail-modal', 'aria-label': `Chi tiết chuyên cần của ${stat.name}` },
      attEl(
        'div',
        { class: 'att-student-detail-summary' },
        attEl(
          'div',
          { class: 'att-student-detail-stat' },
          attEl('span', { class: 'meta', text: 'Tỷ lệ đi học' }),
          attEl('strong', { text: rateLabel })
        ),
        attEl(
          'div',
          { class: 'att-student-detail-stat' },
          attEl('span', { class: 'meta', text: 'Có mặt' }),
          attEl('strong', { text: String(stat.present) })
        ),
        attEl(
          'div',
          { class: 'att-student-detail-stat' },
          attEl('span', { class: 'meta', text: 'Đi muộn' }),
          attEl('strong', { text: String(stat.late) })
        ),
        attEl(
          'div',
          { class: 'att-student-detail-stat' },
          attEl('span', { class: 'meta', text: 'Có phép / Vắng' }),
          attEl('strong', { text: `${stat.excused} / ${stat.absent}` })
        )
      ),
      stat.allRecords.length
        ? attEl(
            'ul',
            { class: 'att-session-records' },
            ...stat.allRecords.map(rec => {
              const st = STATUS_BY_VALUE[rec.status] || { label: rec.status, badge: 'badge-info' };
              const info = getSessionInfoForDate(rec.lesson_date);
              const sessionSuffix = info.sessionNumber
                ? ` · Buổi ${String(info.sessionNumber).padStart(2, '0')}`
                : ' · Ngoài lịch';
              return attEl(
                'li',
                { class: 'att-session-record-item' },
                attEl(
                  'div',
                  { class: 'att-session-record-person' },
                  attEl('strong', {
                    text: `${formatLessonDateLong(rec.lesson_date)}${sessionSuffix}`
                  }),
                  rec.note ? attEl('span', { class: 'meta', text: `Ghi chú: ${rec.note}` }) : null
                ),
                attEl(
                  'div',
                  { class: 'att-session-record-right' },
                  attEl('span', { class: `badge ${st.badge}`, text: st.label }),
                  canWrite
                    ? attEl('button', {
                        type: 'button',
                        class: 'att-jump-edit-btn',
                        text: 'Sửa buổi',
                        onclick: () => {
                          const dialog = document.getElementById('editor');
                          if (dialog?.open) dialog.close();
                          switchView('rollcall');
                          requestDateSwitch(rec.lesson_date);
                        }
                      })
                    : null
                )
              );
            })
          )
        : attEl('p', { class: 'empty', text: 'Học sinh chưa có bản ghi điểm danh nào.' })
    );
    onOpenHistoryModal(`Chuyên cần · ${stat.name}`, body);
  }

  function renderStudentsAnalyticsPanel() {
    studentsPanel.replaceChildren();
    refreshDerivedStats();

    if (!students.length) {
      studentsPanel.append(attEl('p', { class: 'empty', text: 'Lớp học chưa có học sinh trong danh sách.' }));
      return;
    }

    const totalSessions = groupAttendanceByDate(allRows).length;
    const totalCounts = studentStatsCache.reduce(
      (acc, s) => ({
        present: acc.present + s.present,
        late: acc.late + s.late,
        excused: acc.excused + s.excused,
        absent: acc.absent + s.absent
      }),
      { present: 0, late: 0, excused: 0, absent: 0 }
    );
    const overallRate = computeAttendanceRate(totalCounts);
    const attentionCount = studentStatsCache.filter(s => s.needsAttention).length;

    const banner = attEl(
      'section',
      { class: 'att-analytics-banner', 'aria-label': 'Tổng quan chuyên cần cả lớp' },
      attEl(
        'div',
        { class: 'att-analytics-metric' },
        attEl('span', { class: 'att-analytics-label', text: 'Tỷ lệ chuyên cần chung' }),
        attEl('strong', {
          class: 'att-analytics-value',
          text: overallRate.ratePct !== null ? `${overallRate.ratePct}%` : '—'
        }),
        attEl('progress', {
          class: 'att-session-progress',
          value: String(overallRate.ratePct ?? 0),
          max: '100',
          'aria-label': 'Tỷ lệ chuyên cần chung của lớp'
        })
      ),
      attEl(
        'div',
        { class: 'att-analytics-metric' },
        attEl('span', { class: 'att-analytics-label', text: 'Số buổi đã điểm danh' }),
        attEl('strong', { class: 'att-analytics-value', text: String(totalSessions) }),
        attEl('span', { class: 'meta', text: `${overallRate.total} lượt ghi nhận` })
      ),
      attEl(
        'div',
        { class: `att-analytics-metric${attentionCount > 0 ? ' is-warn' : ''}` },
        attEl('span', { class: 'att-analytics-label', text: 'Học sinh cần lưu ý' }),
        attEl('strong', { class: 'att-analytics-value', text: String(attentionCount) }),
        attEl('span', {
          class: 'meta',
          text: attentionCount > 0 ? 'Chuyên cần < 85% hoặc vắng ≥ 2 buổi' : 'Tất cả học sinh đi học đều'
        })
      )
    );

    const searchBox = attEl('input', {
      type: 'search',
      class: 'att-search-input',
      value: analyticsSearch,
      placeholder: 'Tìm tên, mã HS…',
      'aria-label': 'Tìm học sinh trong bảng tổng hợp'
    });
    searchBox.addEventListener('input', () => {
      analyticsSearch = searchBox.value;
      drawStudentRows();
    });

    const sortSelect = attEl(
      'select',
      {
        class: 'att-sort-select',
        'aria-label': 'Sắp xếp danh sách học sinh',
        onchange: e => {
          analyticsSort = e.target.value;
          drawStudentRows();
        }
      },
      attEl('option', { value: 'name', selected: analyticsSort === 'name', text: 'Xếp: Tên A–Z' }),
      attEl('option', { value: 'rate_asc', selected: analyticsSort === 'rate_asc', text: 'Xếp: Chuyên cần thấp' }),
      attEl('option', { value: 'absent_desc', selected: analyticsSort === 'absent_desc', text: 'Xếp: Vắng nhiều' })
    );

    const filterPills = [
      { key: 'all', label: `Tất cả (${studentStatsCache.length})` },
      { key: 'attention', label: `Cần lưu ý (${attentionCount})` },
      { key: 'good', label: 'Đi đều (≥85%)' }
    ].map(def =>
      attEl('button', {
        type: 'button',
        class: `att-filter-pill${analyticsFilter === def.key ? ' is-active' : ''}`,
        'aria-pressed': String(analyticsFilter === def.key),
        text: def.label,
        onclick: () => {
          analyticsFilter = def.key;
          renderStudentsAnalyticsPanel();
        }
      })
    );

    const toolbar = attEl(
      'div',
      { class: 'att-analytics-toolbar' },
      attEl('div', { class: 'att-search-wrap' }, attIcon('search', 16, 'att-search-icon'), searchBox),
      attEl('div', { class: 'att-filter-pills', role: 'group', 'aria-label': 'Lọc học sinh' }, ...filterPills),
      attEl(
        'div',
        { class: 'att-analytics-right-tools' },
        sortSelect,
        allRows.length
          ? attEl(
              'button',
              {
                type: 'button',
                class: 'secondary att-export-btn',
                onclick: () => handleExportCsv()
              },
              attIcon('download', 14),
              attEl('span', { text: 'Xuất CSV' })
            )
          : null
      )
    );

    const listHost = attEl('div', { class: 'att-summary-list', role: 'list' });

    function drawStudentRows() {
      listHost.replaceChildren();
      const q = normalizeSearchText(analyticsSearch);
      let rows = studentStatsCache.filter(s => {
        if (analyticsFilter === 'attention' && !s.needsAttention) return false;
        if (analyticsFilter === 'good' && !(s.ratePct !== null && s.ratePct >= 85)) return false;
        if (!q) return true;
        return normalizeSearchText(`${s.name} ${s.studentCode || ''} ${s.uid}`).includes(q);
      });

      if (analyticsSort === 'rate_asc') {
        rows = [...rows].sort((a, b) => {
          const ra = a.ratePct === null ? 999 : a.ratePct;
          const rb = b.ratePct === null ? 999 : b.ratePct;
          return ra - rb || b.absent - a.absent;
        });
      } else if (analyticsSort === 'absent_desc') {
        rows = [...rows].sort((a, b) => b.absent - a.absent || (a.ratePct ?? 999) - (b.ratePct ?? 999));
      }

      if (!rows.length) {
        listHost.append(attEl('p', { class: 'empty', text: 'Không có học sinh nào khớp bộ lọc.' }));
        return;
      }

      rows.forEach((stat, idx) => {
        const dots = stat.recentRecords.map(rec => {
          const st = STATUS_BY_VALUE[rec.status] || { label: rec.status, tone: 'neutral' };
          const tip = `${formatLessonDateShort(rec.lesson_date)}: ${st.label}${rec.note ? ` (${rec.note})` : ''}`;
          return attEl('span', {
            class: `att-dot tone-${st.tone}`,
            title: tip,
            'aria-label': tip
          });
        });

        listHost.append(
          attEl(
            'article',
            { class: `att-summary-row${stat.needsAttention ? ' is-attention' : ''}`, role: 'listitem' },
            attEl(
              'div',
              { class: 'att-summary-identity' },
              attEl('span', { class: 'att-student-index', text: String(idx + 1).padStart(2, '0') }),
              attEl('span', { class: 'att-student-avatar', 'aria-hidden': 'true', text: getStudentInitials(stat.name) }),
              attEl(
                'div',
                { class: 'att-student-name-box' },
                attEl('strong', { class: 'att-student-name', text: stat.name }),
                attEl(
                  'div',
                  { class: 'att-student-submeta' },
                  stat.studentCode ? attEl('span', { class: 'att-code-badge', text: stat.studentCode }) : null,
                  stat.needsAttention ? attEl('span', { class: 'badge badge-error', text: 'Cần lưu ý' }) : null
                )
              )
            ),
            attEl(
              'div',
              { class: 'att-summary-metrics' },
              attEl(
                'div',
                { class: 'att-summary-rate' },
                attEl('strong', { text: stat.ratePct !== null ? `${stat.ratePct}%` : '—' }),
                attEl('progress', {
                  class: `att-mini-progress${stat.needsAttention ? ' is-warn' : ''}`,
                  value: String(stat.ratePct ?? 0),
                  max: '100',
                  'aria-label': `Chuyên cần ${stat.name}`
                })
              ),
              attEl(
                'div',
                { class: 'att-summary-counts' },
                attEl('span', { class: 'att-mini-stat is-present', text: `CM: ${stat.present}` }),
                attEl('span', { class: 'att-mini-stat is-late', text: `M: ${stat.late}` }),
                attEl('span', { class: 'att-mini-stat is-excused', text: `P: ${stat.excused}` }),
                attEl('span', { class: 'att-mini-stat is-absent', text: `V: ${stat.absent}` })
              ),
              dots.length ? attEl('div', { class: 'att-dot-strip', 'aria-label': '8 buổi gần nhất' }, ...dots) : null
            ),
            attEl(
              'div',
              { class: 'att-summary-actions' },
              attEl('button', {
                type: 'button',
                class: 'secondary att-detail-btn',
                text: 'Chi tiết',
                onclick: () => openStudentDetailModal(stat)
              })
            )
          )
        );
      });
    }

    drawStudentRows();
    studentsPanel.append(banner, toolbar, listHost);
  }

  // =========================================================================
  // 4. TAB 3: LỊCH SỬ CÁC BUỔI (GOM THEO THÁNG)
  // =========================================================================
  function renderHistorySection() {
    historyPanel.replaceChildren();
    const groups = groupAttendanceByDate(allRows);
    const headerRow = attEl(
      'div',
      { class: 'att-history-header' },
      attEl(
        'div',
        { class: 'att-history-title-wrap' },
        attEl('h2', { text: 'Lịch sử điểm danh các buổi học' }),
        attEl('span', { class: 'meta', text: groups.length ? `${groups.length} buổi đã ghi nhận` : 'Chưa có buổi học nào' })
      ),
      allRows.length
        ? attEl(
            'button',
            {
              type: 'button',
              class: 'secondary att-export-btn',
              onclick: () => handleExportCsv()
            },
            attIcon('download', 15),
            attEl('span', { text: 'Xuất CSV' })
          )
        : null
    );
    historyPanel.append(headerRow);

    if (!groups.length) {
      historyPanel.append(attEl('p', { class: 'empty', text: 'Lớp học chưa có dữ liệu điểm danh.' }));
      return;
    }

    const monthly = groupRecordsByMonth(groups, g => g.date);
    const statusOrder = { absent: 0, excused: 1, late: 2, present: 3 };

    for (const month of monthly) {
      const monthSection = attEl(
        'section',
        { class: 'att-month-group', 'aria-label': month.label },
        attEl(
          'div',
          { class: 'att-month-header' },
          attEl('h3', { text: month.label }),
          attEl('span', {
            class: 'att-month-rate',
            text: month.stats.ratePct !== null
              ? `${month.items.length} buổi · ${month.stats.ratePct}% đi học`
              : `${month.items.length} buổi`
          })
        )
      );

      const grid = attEl('div', { class: 'att-history-list' });
      for (const group of month.items) {
        const dateLabel = formatLessonDateLong(group.date);
        const info = getSessionInfoForDate(group.date);
        const matchedSession = sessionLookup.get(group.date);
        const sessionLabel = info.sessionNumber
          ? `Buổi ${String(info.sessionNumber).padStart(2, '0')}`
          : info.isBeforeStart
            ? 'Trước ngày bắt đầu'
            : 'Ngoài lịch';
        const rate = computeAttendanceRate(group);

        const viewButton = attEl('button', {
          type: 'button',
          class: 'att-view-session-btn',
          'aria-label': `Xem danh sách điểm danh ${formatLessonDateShort(group.date)}`,
          'aria-haspopup': 'dialog',
          text: 'Xem danh sách',
          onclick: () => {
            if (typeof onOpenHistoryModal !== 'function') return;
            const sortedRecords = [...group.records].sort((a, b) => {
              const oa = statusOrder[a.status] ?? 9;
              const ob = statusOrder[b.status] ?? 9;
              if (oa !== ob) return oa - ob;
              return vnCollator.compare(personResolver(a.student_uid), personResolver(b.student_uid));
            });
            const records = sortedRecords.map(r => {
              const st = STATUS_BY_VALUE[r.status] || { label: r.status, badge: 'badge-info' };
              return attEl(
                'li',
                { class: 'att-session-record-item' },
                attEl(
                  'div',
                  { class: 'att-session-record-person' },
                  attEl('strong', { text: personResolver(r.student_uid) }),
                  r.note ? attEl('span', { class: 'meta', text: `Ghi chú: ${r.note}` }) : null
                ),
                attEl('span', { class: `badge ${st.badge}`, text: st.label })
              );
            });
            onOpenHistoryModal(
              'Danh sách điểm danh',
              attEl(
                'section',
                { class: 'att-session-roster', 'aria-label': dateLabel },
                attEl(
                  'div',
                  { class: 'att-session-roster-header' },
                  attEl('strong', { text: dateLabel }),
                  attEl('span', {
                    class: 'meta',
                    text: matchedSession?.lessonName ? `${sessionLabel}: ${matchedSession.lessonName}` : sessionLabel
                  })
                ),
                attEl('ul', { class: 'att-session-records' }, ...records)
              )
            );
          }
        });

        const loadSessionBtn = attEl(
          'button',
          {
            type: 'button',
            class: 'att-open-session-btn',
            onclick: () => {
              switchView('rollcall');
              requestDateSwitch(group.date);
              container.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          },
          attEl('span', { text: canWrite ? 'Chỉnh sửa buổi' : 'Xem trên bảng chính' })
        );

        grid.append(
          attEl(
            'article',
            { class: 'att-session-card' },
            attEl(
              'div',
              { class: 'att-session-card-head' },
              attEl('h4', {}, attEl('time', { datetime: group.date, text: dateLabel })),
              attEl('span', { class: `badge ${info.sessionNumber ? 'badge-info' : 'badge-warning'}`, text: sessionLabel })
            ),
            attEl(
              'div',
              { class: 'att-session-card-rate' },
              attEl('span', {
                class: 'meta',
                text: `${rate.attended}/${rate.total} đi học${rate.ratePct !== null ? ` (${rate.ratePct}%)` : ''}`
              }),
              attEl('progress', {
                class: 'att-mini-progress',
                value: String(rate.ratePct ?? 0),
                max: '100',
                'aria-label': `Chuyên cần ngày ${formatLessonDateShort(group.date)}`
              })
            ),
            attEl(
              'div',
              { class: 'att-session-badges' },
              attEl('span', { class: 'badge badge-success', text: `Có mặt: ${group.present}` }),
              group.late ? attEl('span', { class: 'badge badge-warning', text: `Đi muộn: ${group.late}` }) : null,
              group.excused ? attEl('span', { class: 'badge badge-info', text: `Có phép: ${group.excused}` }) : null,
              group.absent ? attEl('span', { class: 'badge badge-error', text: `Vắng: ${group.absent}` }) : null
            ),
            attEl('div', { class: 'att-session-actions' }, viewButton, loadSessionBtn)
          )
        );
      }

      monthSection.append(grid);
      historyPanel.append(monthSection);
    }
  }

  // Initial draw
  todayQuickBtn.hidden = selectedDate === todayStr;
  renderSessionContext();
  renderRecordedSessionsMenu();
  renderKpiAndSaveState();
  renderRosterRows();
  updateTabBadges();

  rollcallPanel.append(sessionBar, kpiHost, bulkToolbar, rosterHost);
  container.append(commandBar, viewTabsHost, rollcallPanel, studentsPanel, historyPanel);
  root.append(container);

  // Lazy load class sessions catalog for start-date session numbering & lesson titles
  if (typeof sessionsLoader === 'function') {
    Promise.resolve(sessionsLoader())
      .then(catalog => {
        if (!container.isConnected) return;
        sessions = Array.isArray(catalog?.sessions) ? catalog.sessions : [];
        sessionLookup = buildSessionDateLookup(sessions);
        courseStartDate = resolveCourseStartDate(catalog, classInfo);
        if (Array.isArray(catalog?.scheduleSlots) && catalog.scheduleSlots.length) {
          effectiveScheduleSlots = extractClassScheduleSlots({
            schedule_slots: catalog.scheduleSlots,
            schedule: catalog?.scheduleText || classInfo?.schedule || ''
          });
        }
        renderSessionContext();
        renderRecordedSessionsMenu();
        if (activeView === 'history') renderHistorySection();
      })
      .catch(() => {});
  }
}

// ===========================================================================
// GIAO DIỆN PHỤ HUYNH & HỌC SINH (LEARNER ATTENDANCE JOURNAL)
// ===========================================================================
export function renderLearnerAttendanceWorkspace({
  root,
  classInfo = null,
  viewRole = 'student',
  attendanceRows = [],
  linkedChildren = [],
  initialDate = null,
  sessionsLoader = null,
  personResolver = uid => uid || 'Học sinh',
  onOpenSessionLink = null
}) {
  if (!root) return;
  root.replaceChildren();

  const isParent = viewRole === 'parent';
  const allRows = [...(Array.isArray(attendanceRows) ? attendanceRows : [])].sort((a, b) =>
    String(b?.lesson_date || '').localeCompare(String(a?.lesson_date || ''))
  );
  const highlightedDate = parseIsoDateParts(initialDate)?.iso || null;

  let sessions = [];
  let sessionLookup = new Map();
  let effectiveScheduleSlots = extractClassScheduleSlots(classInfo || {});
  let courseStartDate = resolveCourseStartDate(null, classInfo);
  let selectedChildUid = 'all';
  let selectedStatus = 'all'; // 'all' | 'present' | 'late' | 'excused' | 'absent' | 'non_present' | 'with_note'
  let selectedMonth = 'all';

  const container = attEl('div', { class: 'attendance-workspace is-learner-mode' });

  // Child list for multi-child parents
  const childUids = [...new Set([
    ...(Array.isArray(linkedChildren) ? linkedChildren.map(c => c.uid).filter(Boolean) : []),
    ...allRows.map(r => r.student_uid).filter(Boolean)
  ])];

  // Header Command Bar
  const metaPills = [];
  if (classInfo?.schedule) {
    metaPills.push(
      attEl('span', { class: 'att-meta-chip' }, attIcon('calendar', 14), attEl('span', { text: classInfo.schedule }))
    );
  }

  const commandBar = attEl(
    'header',
    { class: 'att-command-bar' },
    attEl(
      'div',
      { class: 'att-command-info' },
      attEl('h1', {
        class: 'att-command-title',
        text: isParent ? 'Nhật ký chuyên cần của con' : 'Nhật ký chuyên cần'
      }),
      metaPills.length ? attEl('div', { class: 'att-command-meta' }, ...metaPills) : null
    )
  );

  container.append(commandBar);

  if (!allRows.length) {
    container.append(
      attEl(
        'div',
        { class: 'att-learner-empty-card' },
        attIcon('calendar', 28),
        attEl('strong', { text: 'Chưa có dữ liệu điểm danh' }),
        attEl('p', {
          class: 'meta',
          text: isParent
            ? 'Khi giáo viên lưu kết quả điểm danh buổi học của con, lịch sử chuyên cần và thông báo email sẽ hiển thị ngay tại đây.'
            : 'Khi giáo viên lưu kết quả điểm danh buổi học, lịch sử chuyên cần của em sẽ hiển thị tại đây.'
        })
      )
    );
    root.append(container);
    return;
  }

  // Child switcher for parent with multiple children in same class
  const childSwitcherHost = attEl('div', { class: 'att-child-switcher', hidden: !(isParent && childUids.length > 1) });
  const heroHost = attEl('section', { class: 'att-learner-hero', 'aria-label': 'Tổng hợp tỷ lệ chuyên cần' });
  const filterBarHost = attEl('div', { class: 'att-learner-filter-bar' });
  const timelineHost = attEl('div', { class: 'att-learner-timeline' });
  const footnote = attEl(
    'p',
    { class: 'att-learner-footnote' },
    'Email thông báo điểm danh được gửi tự động ngay sau khi giáo viên hoàn tất và lưu kết quả buổi học. Nếu cần cập nhật hoặc xin phép nghỉ học, vui lòng nhắn tin trực tiếp với giáo viên phụ trách.'
  );

  function getScopedRowsByChild() {
    if (selectedChildUid === 'all') return allRows;
    return allRows.filter(r => r.student_uid === selectedChildUid);
  }

  function renderChildSwitcher() {
    if (!(isParent && childUids.length > 1)) {
      childSwitcherHost.hidden = true;
      return;
    }
    childSwitcherHost.hidden = false;
    childSwitcherHost.replaceChildren(
      attEl('button', {
        type: 'button',
        class: `att-filter-pill${selectedChildUid === 'all' ? ' is-active' : ''}`,
        'aria-pressed': String(selectedChildUid === 'all'),
        text: 'Tất cả các con',
        onclick: () => {
          selectedChildUid = 'all';
          renderAllLearnerSections();
        }
      }),
      ...childUids.map(uid =>
        attEl('button', {
          type: 'button',
          class: `att-filter-pill${selectedChildUid === uid ? ' is-active' : ''}`,
          'aria-pressed': String(selectedChildUid === uid),
          text: personResolver(uid),
          onclick: () => {
            selectedChildUid = uid;
            renderAllLearnerSections();
          }
        })
      )
    );
  }

  function renderHeroAndKpis() {
    const scoped = getScopedRowsByChild();
    const counts = { present: 0, late: 0, excused: 0, absent: 0 };
    for (const r of scoped) {
      if (r.status in counts) counts[r.status]++;
    }
    const rate = computeAttendanceRate(counts);
    const rateTone = rate.ratePct === null ? 'neutral' : rate.ratePct >= 90 ? 'good' : rate.ratePct >= 80 ? 'steady' : 'warn';
    const rateBadgeText = rate.ratePct === null
      ? 'Chưa có dữ liệu'
      : rate.ratePct >= 90
        ? 'Chuyên cần rất tốt'
        : rate.ratePct >= 80
          ? 'Chuyên cần ổn định'
          : 'Cần chú ý chuyên cần';

    const summaryCard = attEl(
      'div',
      { class: 'att-learner-hero-summary' },
      attEl('strong', { class: 'att-learner-hero-pct', text: rate.ratePct !== null ? `${rate.ratePct}%` : '—' }),
      attEl(
        'div',
        { class: 'att-learner-hero-info' },
        attEl(
          'div',
          { class: 'att-learner-hero-top' },
          attEl('span', {
            class: 'att-learner-hero-label',
            text: `${isParent ? 'Chuyên cần của con' : 'Chuyên cần'} · ${rate.attended}/${rate.total} buổi`
          }),
          attEl('span', { class: `att-rate-badge is-${rateTone}`, text: rateBadgeText })
        ),
        attEl('progress', {
          class: `att-learner-progress is-${rateTone}`,
          value: String(rate.ratePct ?? 0),
          max: '100',
          'aria-label': `Tỷ lệ chuyên cần ${rate.ratePct ?? 0}%`
        })
      )
    );

    const kpiDefs = [
      { key: 'present', label: 'Có mặt', count: counts.present, tone: 'present' },
      { key: 'late', label: 'Đi muộn', count: counts.late, tone: 'late' },
      { key: 'excused', label: 'Có phép', count: counts.excused, tone: 'excused' },
      { key: 'absent', label: 'Vắng KP', count: counts.absent, tone: 'absent' }
    ];

    const kpiGrid = attEl(
      'div',
      { class: 'att-learner-kpi-grid', role: 'group', 'aria-label': 'Lọc nhật ký theo trạng thái' },
      ...kpiDefs.map(k =>
        attEl(
          'button',
          {
            type: 'button',
            class: `att-learner-kpi-card is-${k.tone}`,
            'aria-pressed': String(selectedStatus === k.key),
            onclick: () => {
              selectedStatus = selectedStatus === k.key ? 'all' : k.key;
              renderAllLearnerSections();
            }
          },
          attEl('span', { class: 'att-learner-kpi-label', text: k.label }),
          attEl('span', { class: 'att-learner-kpi-value', text: String(k.count) })
        )
      )
    );

    heroHost.replaceChildren(summaryCard, kpiGrid);
  }

  function renderFilterBar() {
    const scoped = getScopedRowsByChild();
    const months = groupRecordsByMonth(scoped, r => r.lesson_date);

    const pills = [
      { key: 'all', label: 'Tất cả' },
      { key: 'non_present', label: 'Đi muộn / Nghỉ' },
      { key: 'with_note', label: 'Có ghi chú' }
    ].map(def =>
      attEl('button', {
        type: 'button',
        class: `att-filter-pill${selectedStatus === def.key ? ' is-active' : ''}`,
        'aria-pressed': String(selectedStatus === def.key),
        text: def.label,
        onclick: () => {
          selectedStatus = def.key;
          renderAllLearnerSections();
        }
      })
    );

    const monthSelect = attEl(
      'select',
      {
        class: 'att-month-select',
        'aria-label': 'Lọc theo tháng',
        onchange: e => {
          selectedMonth = e.target.value;
          renderTimeline();
        }
      },
      attEl('option', { value: 'all', selected: selectedMonth === 'all', text: 'Tất cả các tháng' }),
      ...months.map(m =>
        attEl('option', { value: m.monthKey, selected: selectedMonth === m.monthKey, text: `${m.label} (${m.items.length})` })
      )
    );

    filterBarHost.replaceChildren(
      attEl('div', { class: 'att-filter-pills', role: 'group', 'aria-label': 'Bộ lọc nhanh nhật ký' }, ...pills),
      monthSelect
    );
  }

  function renderTimeline() {
    timelineHost.replaceChildren();
    const scoped = getScopedRowsByChild();
    const filtered = scoped.filter(r => {
      if (selectedMonth !== 'all' && !String(r.lesson_date || '').startsWith(`${selectedMonth}-`)) return false;
      if (selectedStatus === 'non_present') return r.status !== 'present';
      if (selectedStatus === 'with_note') return Boolean(String(r.note || '').trim());
      if (['present', 'late', 'excused', 'absent'].includes(selectedStatus)) return r.status === selectedStatus;
      return true;
    });

    if (!filtered.length) {
      timelineHost.append(
        attEl(
          'div',
          { class: 'att-filter-empty' },
          attEl('p', { class: 'empty', text: 'Không có buổi điểm danh nào khớp với bộ lọc hiện tại.' }),
          attEl('button', {
            type: 'button',
            class: 'secondary',
            text: 'Xem tất cả buổi học',
            onclick: () => {
              selectedStatus = 'all';
              selectedMonth = 'all';
              renderAllLearnerSections();
            }
          })
        )
      );
      return;
    }

    const monthly = groupRecordsByMonth(filtered, r => r.lesson_date);
    let highlightedCard = null;

    for (const month of monthly) {
      const monthBlock = attEl(
        'section',
        { class: 'att-month-group', 'aria-label': month.label },
        attEl(
          'div',
          { class: 'att-month-header' },
          attEl('h2', { text: month.label }),
          attEl('span', {
            class: 'att-month-rate',
            text: month.stats.ratePct !== null
              ? `${month.items.length} buổi · ${month.stats.ratePct}% chuyên cần`
              : `${month.items.length} buổi`
          })
        )
      );

      const list = attEl('div', { class: 'att-learner-list' });
      for (const a of month.items) {
        const st = STATUS_BY_VALUE[a.status] || { label: a.status, badge: 'badge-info', tone: 'neutral' };
        const matchedSession = sessionLookup.get(a.lesson_date) || null;
        const info = computeSessionInfoFromStartDate({
          targetDate: a.lesson_date,
          startDate: courseStartDate,
          scheduleSlots: effectiveScheduleSlots
        });
        const isHighlighted = Boolean(highlightedDate && a.lesson_date === highlightedDate);

        const dateTile = info.sessionNumber
          ? attEl(
              'div',
              {
                class: `att-date-tile tone-${st.tone}`,
                'aria-label': `Buổi ${String(info.sessionNumber).padStart(2, '0')}`
              },
              attEl('span', { class: 'att-date-tile-wk', text: 'Buổi' }),
              attEl('strong', {
                class: 'att-date-tile-day',
                text: String(info.sessionNumber).padStart(2, '0')
              })
            )
          : attEl(
              'div',
              { class: `att-date-tile tone-${st.tone}`, 'aria-label': 'Buổi ngoài lịch' },
              attEl('span', { class: 'att-date-tile-wk', text: 'Ngoài' }),
              attEl('strong', { class: 'att-date-tile-day', text: 'lịch' })
            );

        const lessonSubtitle = matchedSession?.lessonName ? String(matchedSession.lessonName).trim() : '';

        const needsReview = a.status === 'absent' || a.status === 'excused' || a.status === 'late';
        const studyLinks = matchedSession && typeof onOpenSessionLink === 'function'
          ? attEl(
              'div',
              { class: 'att-learner-study-links' },
              needsReview
                ? attEl('span', { class: 'att-review-hint', text: 'Ôn lại nội dung buổi này:' })
                : null,
              attEl(
                'button',
                {
                  type: 'button',
                  class: 'att-study-link-btn',
                  onclick: () => onOpenSessionLink('materials', matchedSession.sessionNumber)
                },
                attIcon('book', 14),
                attEl('span', { text: `Xem bài giảng Buổi ${matchedSession.sessionNumber}` })
              ),
              attEl(
                'button',
                {
                  type: 'button',
                  class: 'att-study-link-btn',
                  onclick: () => onOpenSessionLink('assignments', matchedSession.sessionNumber)
                },
                attIcon('assignment', 14),
                attEl('span', { text: `Xem bài tập Buổi ${matchedSession.sessionNumber}` })
              )
            )
          : null;

        const card = attEl(
          'article',
          { class: `att-learner-entry tone-${st.tone}${isHighlighted ? ' is-highlighted' : ''}` },
          dateTile,
          attEl(
            'div',
            { class: 'att-learner-entry-body' },
            attEl(
              'div',
              { class: 'att-learner-entry-top' },
              attEl(
                'div',
                { class: 'att-learner-entry-heading' },
                attEl('h3', { class: 'att-learner-date', text: formatLessonDateLong(a.lesson_date) }),
                lessonSubtitle ? attEl('p', { class: 'att-learner-session-name', text: lessonSubtitle }) : null
              ),
              attEl(
                'span',
                { class: `badge ${st.badge} att-status-badge` },
                attIcon(a.status, 14),
                attEl('span', { text: st.label })
              )
            ),
            isParent
              ? attEl('p', { class: 'att-learner-person', text: `Học sinh: ${personResolver(a.student_uid)}` })
              : null,
            a.note
              ? attEl('p', { class: 'att-learner-note', text: `Ghi chú: ${a.note}` })
              : null,
            studyLinks
          )
        );

        if (isHighlighted && !highlightedCard) highlightedCard = card;
        list.append(card);
      }

      monthBlock.append(list);
      timelineHost.append(monthBlock);
    }

    if (highlightedCard && typeof highlightedCard.scrollIntoView === 'function') {
      setTimeout(() => {
        if (highlightedCard.isConnected) {
          highlightedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 60);
    }
  }

  function renderAllLearnerSections() {
    renderChildSwitcher();
    renderHeroAndKpis();
    renderFilterBar();
    renderTimeline();
  }

  renderAllLearnerSections();
  container.append(childSwitcherHost, heroHost, filterBarHost, timelineHost, footnote);
  root.append(container);

  if (typeof sessionsLoader === 'function') {
    Promise.resolve(sessionsLoader())
      .then(catalog => {
        if (!container.isConnected) return;
        sessions = Array.isArray(catalog?.sessions) ? catalog.sessions : [];
        sessionLookup = buildSessionDateLookup(sessions);
        courseStartDate = resolveCourseStartDate(catalog, classInfo);
        if (Array.isArray(catalog?.scheduleSlots) && catalog.scheduleSlots.length) {
          effectiveScheduleSlots = extractClassScheduleSlots({
            schedule_slots: catalog.scheduleSlots,
            schedule: catalog?.scheduleText || classInfo?.schedule || ''
          });
        }
        renderTimeline();
      })
      .catch(() => {});
  }
}
