import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTENDANCE_STATUSES,
  normalizeSearchText,
  sortStudentsRoster,
  buildDateAttendanceMap,
  computeAttendanceCounts,
  computeAttendanceRate,
  groupAttendanceByDate,
  getChangedAttendanceEntries,
  formatLessonDateShort,
  formatLessonDateLong,
  getVietnamTodayIso,
  buildSessionDateLookup,
  resolveCourseStartDate,
  computeSessionInfoFromStartDate,
  computeStudentAttendanceStats,
  computeDateNavigationTargets,
  groupRecordsByMonth,
  buildAttendanceCsvContent
} from '../client/attendance-workspace.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('ATTENDANCE_STATUSES covers all four statuses in natural order', () => {
  assert.deepEqual(
    ATTENDANCE_STATUSES.map(s => s.value),
    ['present', 'late', 'excused', 'absent']
  );
});

test('normalizeSearchText strips Vietnamese diacritics and normalizes case', () => {
  assert.equal(normalizeSearchText('Nguyễn Minh Quân'), 'nguyen minh quan');
  assert.equal(normalizeSearchText('Đặng Thảo Đan'), 'dang thao dan');
});

test('sortStudentsRoster sorts students by Vietnamese given name then family name', () => {
  const input = [
    { uid: 'u1', name: 'Nguyễn Minh Quân', student_code: 'HS03' },
    { uid: 'u2', name: 'Trần Bảo An', student_code: 'HS01' },
    { uid: 'u3', name: 'Lê Hoàng An', student_code: 'HS02' },
    { uid: 'u4', name: 'Phạm Thu Hà', student_code: 'HS04' }
  ];
  const sorted = sortStudentsRoster(input);
  assert.deepEqual(
    sorted.map(s => s.uid),
    ['u3', 'u2', 'u4', 'u1']
  );
});

test('buildDateAttendanceMap and computeAttendanceCounts summarize class status accurately', () => {
  const students = [
    { uid: 's1', name: 'Học sinh 1' },
    { uid: 's2', name: 'Học sinh 2' },
    { uid: 's3', name: 'Học sinh 3' },
    { uid: 's4', name: 'Học sinh 4' }
  ];
  const rows = [
    { student_uid: 's1', lesson_date: '2026-11-06', status: 'present', note: '' },
    { student_uid: 's2', lesson_date: '2026-11-06', status: 'late', note: 'Muộn 10p' },
    { student_uid: 's3', lesson_date: '2026-11-06', status: 'absent', note: '' },
    { student_uid: 's1', lesson_date: '2026-11-03', status: 'present', note: '' }
  ];

  const dateMap = buildDateAttendanceMap(rows, '2026-11-06');
  assert.equal(dateMap.size, 3);

  const counts = computeAttendanceCounts(students, dateMap);
  assert.deepEqual(counts, {
    total: 4,
    present: 1,
    late: 1,
    absent: 1,
    excused: 0,
    unmarked: 1,
    marked: 3
  });

  assert.deepEqual(computeAttendanceRate(counts), {
    total: 3,
    attended: 2,
    ratePct: 67
  });
  assert.deepEqual(computeAttendanceRate({}), {
    total: 0,
    attended: 0,
    ratePct: null
  });
});

test('getChangedAttendanceEntries detects new and modified rows only', () => {
  const students = [
    { uid: 's1', name: 'An' },
    { uid: 's2', name: 'Bình' },
    { uid: 's3', name: 'Chi' }
  ];
  const saved = new Map([
    ['s1', { status: 'present', note: '' }],
    ['s2', { status: 'late', note: 'Muộn 5p' }]
  ]);
  const draft = new Map([
    ['s1', { status: 'present', note: '' }],
    ['s2', { status: 'late', note: 'Muộn 15p' }],
    ['s3', { status: 'excused', note: 'Ốm' }]
  ]);

  const changed = getChangedAttendanceEntries(students, saved, draft);
  assert.deepEqual(changed, [
    { studentUid: 's2', studentName: 'Bình', status: 'late', note: 'Muộn 15p' },
    { studentUid: 's3', studentName: 'Chi', status: 'excused', note: 'Ốm' }
  ]);
});

test('groupAttendanceByDate groups and sorts sessions newest first', () => {
  const rows = [
    { student_uid: 's1', lesson_date: '2026-11-03', status: 'present' },
    { student_uid: 's1', lesson_date: '2026-11-06', status: 'present' },
    { student_uid: 's2', lesson_date: '2026-11-06', status: 'absent' }
  ];
  const groups = groupAttendanceByDate(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, '2026-11-06');
  assert.equal(groups[0].present, 1);
  assert.equal(groups[0].absent, 1);
  assert.equal(formatLessonDateShort(groups[0].date), '06/11/2026');
  assert.equal(formatLessonDateLong('2026-11-19'), 'Thứ Năm, 19/11/2026');
});

test('getVietnamTodayIso resolves YYYY-MM-DD in Asia/Ho_Chi_Minh timezone', () => {
  // 2026-11-19T18:30:00Z => 2026-11-20T01:30:00+07:00
  const utcEvening = Date.parse('2026-11-19T18:30:00Z');
  assert.equal(getVietnamTodayIso(utcEvening), '2026-11-20');
});

test('buildSessionDateLookup and computeStudentAttendanceStats aggregate student health accurately', () => {
  const sessions = [
    { sessionNumber: 1, date: '2026-11-02', lessonName: 'Hàm số' },
    { sessionNumber: 2, date: '2026-11-05', lessonName: 'Cực trị' }
  ];
  const lookup = buildSessionDateLookup(sessions);
  assert.equal(lookup.get('2026-11-05')?.sessionNumber, 2);

  const students = [
    { uid: 's1', name: 'Nguyễn An', student_code: 'HS01' },
    { uid: 's2', name: 'Trần Bình', student_code: 'HS02' }
  ];
  const rows = [
    { student_uid: 's1', lesson_date: '2026-11-02', status: 'present', note: '', updated_at: 10 },
    { student_uid: 's1', lesson_date: '2026-11-05', status: 'late', note: '5p', updated_at: 20 },
    { student_uid: 's2', lesson_date: '2026-11-02', status: 'absent', note: 'Chưa phép', updated_at: 10 },
    { student_uid: 's2', lesson_date: '2026-11-05', status: 'absent', note: 'Nghỉ tiếp', updated_at: 20 }
  ];
  const stats = computeStudentAttendanceStats(students, rows);
  assert.equal(stats[0].uid, 's1');
  assert.equal(stats[0].ratePct, 100);
  assert.equal(stats[0].needsAttention, false);

  assert.equal(stats[1].uid, 's2');
  assert.equal(stats[1].absent, 2);
  assert.equal(stats[1].ratePct, 0);
  assert.equal(stats[1].needsAttention, true);
  assert.equal(stats[1].recentRecords.length, 2);
});

test('resolveCourseStartDate prefers catalog schoolYearStartsOn then class metadata', () => {
  assert.equal(
    resolveCourseStartDate({ schoolYearStartsOn: '2026-08-24' }, { school_year_id: 'year-2025-2026' }),
    '2026-08-24'
  );
  assert.equal(
    resolveCourseStartDate(null, { school_year_starts_on: '2026-08-18', school_year_id: 'year-2026-2027' }),
    '2026-08-18'
  );
  assert.equal(
    resolveCourseStartDate(null, { school_year_id: 'year-2025-2026' }),
    '2025-09-01'
  );
  assert.equal(resolveCourseStartDate(null, {}), '2026-09-01');
});

test('computeSessionInfoFromStartDate computes session numbers accurately from startDate and scheduleSlots', () => {
  // Single slot/week: Monday (day=1) starting 2026-09-01 (Tuesday)
  const monSlot = [{ day: 1, start: '18:00', end: '19:30' }];
  assert.deepEqual(
    computeSessionInfoFromStartDate({ targetDate: '2026-09-07', startDate: '2026-09-01', scheduleSlots: monSlot }),
    { sessionNumber: 1, isScheduledDay: true, isBeforeStart: false, matchingSlots: monSlot }
  );
  assert.deepEqual(
    computeSessionInfoFromStartDate({ targetDate: '2026-09-14', startDate: '2026-09-01', scheduleSlots: monSlot }),
    { sessionNumber: 2, isScheduledDay: true, isBeforeStart: false, matchingSlots: monSlot }
  );
  assert.equal(
    computeSessionInfoFromStartDate({ targetDate: '2026-11-16', startDate: '2026-09-01', scheduleSlots: monSlot }).sessionNumber,
    11
  );
  assert.equal(
    computeSessionInfoFromStartDate({ targetDate: '2026-11-23', startDate: '2026-09-01', scheduleSlots: monSlot }).sessionNumber,
    12
  );
  const offDay = computeSessionInfoFromStartDate({
    targetDate: '2026-11-19',
    startDate: '2026-09-01',
    scheduleSlots: monSlot
  });
  assert.equal(offDay.sessionNumber, null);
  assert.equal(offDay.isScheduledDay, false);
  assert.equal(offDay.isBeforeStart, false);

  // Two slots/week: Tuesday (2) and Friday (5) starting 2026-09-01 (Tuesday)
  const tueFriSlots = [
    { day: 2, start: '18:00', end: '19:30' },
    { day: 5, start: '18:00', end: '19:30' }
  ];
  assert.equal(
    computeSessionInfoFromStartDate({ targetDate: '2026-09-01', startDate: '2026-09-01', scheduleSlots: tueFriSlots }).sessionNumber,
    1
  );
  assert.equal(
    computeSessionInfoFromStartDate({ targetDate: '2026-09-04', startDate: '2026-09-01', scheduleSlots: tueFriSlots }).sessionNumber,
    2
  );
  assert.equal(
    computeSessionInfoFromStartDate({ targetDate: '2026-09-08', startDate: '2026-09-01', scheduleSlots: tueFriSlots }).sessionNumber,
    3
  );

  // Before start date
  const beforeStart = computeSessionInfoFromStartDate({
    targetDate: '2026-08-31',
    startDate: '2026-09-01',
    scheduleSlots: tueFriSlots
  });
  assert.equal(beforeStart.isBeforeStart, true);
  assert.equal(beforeStart.sessionNumber, null);

  // No fixed scheduleSlots -> weekly fallback from startDate
  assert.equal(
    computeSessionInfoFromStartDate({ targetDate: '2026-09-01', startDate: '2026-09-01', scheduleSlots: [] }).sessionNumber,
    1
  );
  assert.equal(
    computeSessionInfoFromStartDate({ targetDate: '2026-09-08', startDate: '2026-09-01', scheduleSlots: [] }).sessionNumber,
    2
  );
});

test('computeDateNavigationTargets follows class schedule and recorded dates', () => {
  // Schedule on Tuesday (2) and Friday (5)
  const nav = computeDateNavigationTargets({
    selectedDate: '2026-11-17', // Tuesday
    scheduleSlots: [
      { day: 2, start: '18:00', end: '19:30' },
      { day: 5, start: '18:00', end: '19:30' }
    ],
    recordedDates: ['2026-11-10', '2026-11-13'],
    todayIso: '2026-11-19'
  });
  assert.equal(nav.prevDate, '2026-11-13'); // previous Friday
  assert.equal(nav.nextDate, '2026-11-19'); // today is in candidates (before Friday 2026-11-20)
  assert.ok(nav.quickDates.includes('2026-11-17'));
  assert.ok(nav.quickDates.includes('2026-11-13'));
});

test('groupRecordsByMonth groups attendance entries and session groups by YYYY-MM newest first', () => {
  const rows = [
    { lesson_date: '2026-10-28', status: 'present' },
    { lesson_date: '2026-11-05', status: 'late' },
    { lesson_date: '2026-11-12', status: 'absent' }
  ];
  const grouped = groupRecordsByMonth(rows);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].monthKey, '2026-11');
  assert.equal(grouped[0].label, 'Tháng 11 / 2026');
  assert.equal(grouped[0].stats.ratePct, 50);
  assert.equal(grouped[1].monthKey, '2026-10');
  assert.equal(grouped[1].stats.ratePct, 100);
});

test('buildAttendanceCsvContent emits UTF-8 BOM, headers, and guards CSV formula injection', () => {
  const csv = buildAttendanceCsvContent({
    students: [{ uid: 's1', name: '=CMD()', student_code: 'HS01' }],
    attendanceRows: [
      { student_uid: 's1', lesson_date: '2026-11-19', status: 'late', note: '+10p, tắc đường' }
    ]
  });
  assert.ok(csv.startsWith('\uFEFFSTT,Mã học sinh,Họ và tên'));
  assert.ok(csv.includes("'=CMD()"));
  assert.ok(csv.includes('Đi muộn (+10p, tắc đường)'));
});

test('attendance modules strictly comply with CSP (zero inline styles)', async () => {
  const attSrc = await fs.readFile(path.join(ROOT_DIR, 'client/attendance-workspace.mjs'), 'utf8');
  assert.doesNotMatch(attSrc, /setAttribute\s*\(\s*['"]style['"]/);
  assert.doesNotMatch(attSrc, /\.\s*style\s*\./);
  assert.doesNotMatch(attSrc, /\bstyle\s*[:=]\s*["']/);

  const noticesSrc = await fs.readFile(path.join(ROOT_DIR, 'client/notices-workspace.mjs'), 'utf8');
  assert.doesNotMatch(noticesSrc, /setAttribute\s*\(\s*['"]style['"]/);
  assert.doesNotMatch(noticesSrc, /\.\s*style\s*\./);
});
