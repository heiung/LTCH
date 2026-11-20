import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getVietnamNowParts,
  parseTimeToMinutes,
  extractClassScheduleSlots,
  buildUpcomingScheduleItems,
  describeAssignmentUrgency,
  filterOverviewClasses,
  formatAttendanceStatusMeta,
  formatVnIsoDate,
  formatRelativeTimeVi,
  formatScore10,
  describeSubmissionStatusMeta
} from '../client/overview-workspace.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('getVietnamNowParts formats Asia/Ho_Chi_Minh date and weekday accurately', () => {
  // 2026-11-19T14:30:00+07:00 => Thứ Năm (isoDay 4), 19/11/2026, 14:30
  const ts = Date.parse('2026-11-19T07:30:00Z');
  const parts = getVietnamNowParts(ts);
  assert.equal(parts.isoDay, 4);
  assert.equal(parts.dayName, 'Thứ Năm');
  assert.equal(parts.hour, 14);
  assert.equal(parts.minute, 30);
  assert.equal(parts.minutesOfDay, 14 * 60 + 30);
  assert.equal(parts.dateLabel, 'Thứ Năm, 19/11/2026');
});

test('parseTimeToMinutes parses canonical HH:MM and shorthand HHhMM safely', () => {
  assert.equal(parseTimeToMinutes('18:15'), 18 * 60 + 15);
  assert.equal(parseTimeToMinutes('18h00'), 18 * 60);
  assert.equal(parseTimeToMinutes('24:00'), null);
  assert.equal(parseTimeToMinutes('invalid'), null);
});

test('extractClassScheduleSlots parses canonical slots, Vietnamese days including Thứ Tư, and shorthand lists', () => {
  const canonical = extractClassScheduleSlots({
    name: 'Lớp 12',
    scheduleSlots: [
      { day: 5, start: '19:30', end: '21:30' },
      { day: 1, start: '18:15', end: '21:30' }
    ]
  });
  assert.deepEqual(
    canonical.map(s => [s.day, s.start, s.end]),
    [
      [1, '18:15', '21:30'],
      [5, '19:30', '21:30']
    ]
  );

  const wednesdayText = extractClassScheduleSlots({
    name: 'Lớp 9B',
    schedule: 'Thứ Tư · 18:00–21:15; Chủ nhật · 08:00–11:00'
  });
  assert.deepEqual(
    wednesdayText.map(s => [s.day, s.start, s.end]),
    [
      [3, '18:00', '21:15'],
      [7, '08:00', '11:00']
    ]
  );

  const shorthand = extractClassScheduleSlots({
    name: 'Lớp 8A',
    schedule: 'Thứ 3, 5: 18h00 - 19h30; Thứ 4, CN: 18h00 - 19h30 (Ôn tập)'
  });
  assert.deepEqual(
    shorthand.map(s => [s.day, s.start, s.end]),
    [
      [2, '18:00', '19:30'],
      [3, '18:00', '19:30'],
      [4, '18:00', '19:30'],
      [7, '18:00', '19:30']
    ]
  );
});

test('buildUpcomingScheduleItems detects live, today, tomorrow, and rolls past slots to next week', () => {
  // Thursday (isoDay = 4) at 19:00 Vietnam time
  const nowTs = Date.parse('2026-11-19T12:00:00Z');
  const items = buildUpcomingScheduleItems(
    [
      { id: 'c6', name: 'Lớp 6', schedule: 'Thứ Năm · 17:00–18:30; Thứ Sáu · 18:00–20:00' },
      { id: 'c9', name: 'Lớp 9A', schedule: 'Thứ Năm · 18:30–20:30' },
      { id: 'c12', name: 'Lớp 12', schedule: 'Thứ Năm · 19:30–21:30' }
    ],
    nowTs
  );

  assert.equal(items.length, 4);
  assert.equal(items[0].classId, 'c9');
  assert.equal(items[0].status, 'live');
  assert.equal(items[0].dayOffset, 0);
  assert.equal(items[0].relativeDayLabel, 'Hôm nay');

  assert.equal(items[1].classId, 'c12');
  assert.equal(items[1].status, 'today');
  assert.equal(items[1].dayOffset, 0);

  assert.equal(items[2].classId, 'c6');
  assert.equal(items[2].status, 'tomorrow');
  assert.equal(items[2].dayOffset, 1);

  assert.equal(items[3].classId, 'c6');
  assert.equal(items[3].dayOffset, 7);
  assert.equal(items[3].status, 'upcoming');
});

test('describeAssignmentUrgency classifies upcoming, urgent, soon, and open deadlines accurately', () => {
  const now = 1_795_000_000_000;
  assert.equal(describeAssignmentUrgency({ opens_at: now + 60_000, closes_at: now + 86_400_000 }, now).tone, 'upcoming');
  const todayDue = describeAssignmentUrgency({ opens_at: now - 1000, closes_at: now + 5 * 3600 * 1000 }, now);
  assert.equal(todayDue.tone, 'urgent');
  assert.equal(todayDue.badgeText, 'Hạn hôm nay');
  assert.equal(todayDue.isUrgent, true);

  const twoDays = describeAssignmentUrgency({ opens_at: now - 1000, closes_at: now + 48 * 3600 * 1000 }, now);
  assert.equal(twoDays.tone, 'soon');
  assert.equal(twoDays.isUrgent, true);

  const weekLater = describeAssignmentUrgency({ opens_at: now - 1000, closes_at: now + 7 * 86_400_000 }, now);
  assert.equal(weekLater.tone, 'open');
  assert.equal(weekLater.isUrgent, false);
});

test('filterOverviewClasses filters THCS (6-9) and THPT (10-12) in grade order', () => {
  const sample = [
    { id: 'c12', name: 'Lớp 12' },
    { id: 'c6', name: 'Lớp 6' },
    { id: 'c10', name: 'Lớp 10A' },
    { id: 'c9', name: 'Lớp 9B' }
  ];
  assert.deepEqual(filterOverviewClasses(sample, 'all').map(c => c.id), ['c6', 'c9', 'c10', 'c12']);
  assert.deepEqual(filterOverviewClasses(sample, 'thcs').map(c => c.id), ['c6', 'c9']);
  assert.deepEqual(filterOverviewClasses(sample, 'thpt').map(c => c.id), ['c10', 'c12']);
});

test('overview formatting helpers return clean Vietnamese labels and scores', () => {
  assert.deepEqual(formatAttendanceStatusMeta('present'), { label: 'Có mặt', tone: 'present' });
  assert.deepEqual(formatAttendanceStatusMeta('late'), { label: 'Đi muộn', tone: 'late' });
  assert.deepEqual(formatAttendanceStatusMeta('excused'), { label: 'Vắng có phép', tone: 'excused' });
  assert.deepEqual(formatAttendanceStatusMeta('absent'), { label: 'Vắng không phép', tone: 'absent' });
  assert.equal(formatVnIsoDate('2026-11-19'), '19/11/2026');

  const baseNow = Date.parse('2026-11-19T12:00:00Z');
  assert.equal(formatRelativeTimeVi(baseNow - 30_000, baseNow), 'Vừa xong');
  assert.equal(formatRelativeTimeVi(baseNow - 15 * 60_000, baseNow), '15 phút trước');
  assert.equal(formatRelativeTimeVi(baseNow - 3 * 3_600_000, baseNow), '3 giờ trước');
  assert.equal(formatRelativeTimeVi(baseNow - 30 * 3_600_000, baseNow), 'Hôm qua');

  assert.equal(formatScore10(8.5, 10), '8,5/10');
  assert.equal(formatScore10(75, 100, { normalized: true }), '7,5/10');
  assert.equal(formatScore10(75, 100), '75/100');

  assert.deepEqual(describeSubmissionStatusMeta({ status: 'graded' }), { tone: 'graded', label: 'GV đã nhận xét' });
  assert.deepEqual(describeSubmissionStatusMeta({ status: 'submitted' }, { isParent: true }), { tone: 'submitted', label: 'Con đã nộp' });
  assert.deepEqual(describeSubmissionStatusMeta('missing', { isParent: false }), { tone: 'missing', label: 'Chưa nộp' });
});

test('overview workspace modules have zero inline styles (CSP compliance)', async () => {
  const src = await fs.readFile(path.join(ROOT_DIR, 'client/overview-workspace.mjs'), 'utf8');
  assert.doesNotMatch(src, /setAttribute\s*\(\s*['"]style['"]/);
  assert.doesNotMatch(src, /\.\s*style\s*\./);
  assert.doesNotMatch(src, /\bstyle\s*=\s*["']/);

  const appSrc = await fs.readFile(path.join(ROOT_DIR, 'client/app.js'), 'utf8');
  const homeStart = appSrc.indexOf('async function home(');
  const homeEnd = appSrc.indexOf('async function openClass(', homeStart);
  assert.ok(homeStart !== -1 && homeEnd > homeStart);
  const homeSlice = appSrc.slice(homeStart, homeEnd);
  assert.doesNotMatch(homeSlice, /setAttribute\s*\(\s*['"]style['"]/);
  assert.doesNotMatch(homeSlice, /\.\s*style\s*\./);
  assert.doesNotMatch(homeSlice, /\bstyle\s*[:=]\s*["']/);
  assert.doesNotMatch(homeSlice, /\.replaceChildren\([^;]*(?:lowBlock|attSummaryBlock|barBlock|filterBar)\)/);

  const cssSrc = await fs.readFile(path.join(ROOT_DIR, 'public/app.css'), 'utf8');
  assert.match(cssSrc, /\.icon-wrap[\s\S]{0,180}?display:\s*inline-flex[\s\S]{0,120}?line-height:\s*0/);
  assert.match(cssSrc, /\.icon-wrap\s+svg\s*\{[\s\S]{0,100}?display:\s*block/);
  assert.match(cssSrc, /\.overview-health-list\s*\{[\s\S]{0,120}?display:\s*grid/);
  assert.match(cssSrc, /\.overview-health-head,\s*[\r\n]+\s*\.overview-health-row\s*\{[\s\S]{0,120}?grid-template-columns:\s*subgrid/);
});
