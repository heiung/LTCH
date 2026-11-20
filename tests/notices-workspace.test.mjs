import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NOTICE_CATEGORIES,
  encodeNoticeMeta,
  decodeNoticeMeta,
  formatRelativeNoticeTimeVi,
  buildNoticeTemplates,
  computeClassPracticeOpsStats,
  formatNoticeReadSummaryLabel
} from '../client/notices-workspace.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('NOTICE_CATEGORIES defines all 5 academic announcement categories', () => {
  assert.deepEqual(
    NOTICE_CATEGORIES.map(c => c.key),
    ['important', 'schedule', 'homework', 'exam', 'general']
  );
  for (const cat of NOTICE_CATEGORIES) {
    assert.ok(cat.label && cat.pillLabel && cat.badgeClass && cat.iconName);
  }
});

test('encodeNoticeMeta and decodeNoticeMeta round-trip metadata cleanly without duplicating headers', () => {
  const originalBody = 'Các em ôn tập công thức $x^2 + y^2 = 1$ trước buổi học nhé.\nNhớ mang theo vở ghi.';
  const encoded = encodeNoticeMeta({
    category: 'schedule',
    pinned: true,
    body: originalBody
  });

  assert.equal(
    encoded,
    `[[ltch-notice:cat=schedule|pin=1]]\n${originalBody}`
  );

  const decoded = decodeNoticeMeta(encoded, 'Thông báo lớp');
  assert.equal(decoded.category, 'schedule');
  assert.equal(decoded.categoryMeta.key, 'schedule');
  assert.equal(decoded.pinned, true);
  assert.equal(decoded.cleanBody, originalBody);
  assert.equal(decoded.hasExplicitMeta, true);

  // Re-encoding an already encoded body updates metadata without nesting prefixes
  const reEncoded = encodeNoticeMeta({
    category: 'general',
    pinned: false,
    body: encoded
  });
  assert.equal(
    reEncoded,
    `[[ltch-notice:cat=general|pin=0]]\n${originalBody}`
  );

  const decodedAfterUpdate = decodeNoticeMeta(reEncoded, 'Lịch học tuần này');
  assert.equal(decodedAfterUpdate.category, 'general');
  assert.equal(decodedAfterUpdate.pinned, false);
  assert.equal(decodedAfterUpdate.cleanBody, originalBody);
  assert.equal(decodedAfterUpdate.hasExplicitMeta, true);
});

test('encodeNoticeMeta falls back to general for unknown category keys', () => {
  const encoded = encodeNoticeMeta({
    category: 'unknown-cat',
    pinned: false,
    body: 'Nội dung thử nghiệm'
  });
  assert.equal(encoded, '[[ltch-notice:cat=general|pin=0]]\nNội dung thử nghiệm');
});

test('decodeNoticeMeta preserves legacy plain notices and infers category by keywords', () => {
  const scheduleNotice = decodeNoticeMeta('Thứ Năm tuần này lớp nghỉ và học bù sang tối Chủ nhật.', 'Lịch học bù');
  assert.equal(scheduleNotice.category, 'schedule');
  assert.equal(scheduleNotice.pinned, false);
  assert.equal(scheduleNotice.hasExplicitMeta, false);
  assert.equal(scheduleNotice.cleanBody, 'Thứ Năm tuần này lớp nghỉ và học bù sang tối Chủ nhật.');

  const examNotice = decodeNoticeMeta('Chuẩn bị kiểm tra 45 phút chương Hàm số.', 'Đề kiểm tra định kỳ');
  assert.equal(examNotice.category, 'exam');

  const homeworkNotice = decodeNoticeMeta('Các em nộp BTVN buổi 4 trước 20h tối nay.', 'Nhắc nộp bài tập');
  assert.equal(homeworkNotice.category, 'homework');

  const importantNotice = decodeNoticeMeta('Các em lưu ý mang đủ thước kẻ và máy tính cầm tay.', 'Dặn dò quan trọng');
  assert.equal(importantNotice.category, 'important');

  const generalNotice = decodeNoticeMeta('Chào mừng các em tham gia lớp Toán cô Hạnh.', 'Chào mừng năm học mới');
  assert.equal(generalNotice.category, 'general');
});

test('formatRelativeNoticeTimeVi formats relative durations in Vietnamese', () => {
  const now = Date.UTC(2026, 10, 16, 12, 0, 0);
  assert.equal(formatRelativeNoticeTimeVi(now - 20_000, now), 'Vừa đăng');
  assert.equal(formatRelativeNoticeTimeVi(now - 15 * 60_000, now), '15 phút trước');
  assert.equal(formatRelativeNoticeTimeVi(now - 4 * 3_600_000, now), '4 giờ trước');
  assert.equal(formatRelativeNoticeTimeVi(now - 26 * 3_600_000, now), 'Hôm qua');
  assert.equal(formatRelativeNoticeTimeVi(now - 5 * 86_400_000, now), '5 ngày trước');
  assert.equal(formatRelativeNoticeTimeVi(now - 45 * 86_400_000, now), '1 tháng trước');
  assert.equal(formatRelativeNoticeTimeVi(null, now), '');
  assert.equal(formatRelativeNoticeTimeVi(0, now), '');
});

test('buildNoticeTemplates injects class name and schedule summary into templates', () => {
  const templates = buildNoticeTemplates({
    className: 'Lớp 12A',
    schedule: 'Thứ Ba · 18:00–20:00'
  });
  assert.equal(templates.length, 4);
  assert.ok(templates.every(t => t.title.includes('Lớp 12A')));
  assert.ok(templates.find(t => t.id === 'schedule').body.includes('Thứ Ba · 18:00–20:00'));
});

test('computeClassPracticeOpsStats computes exact grade-scoped exam counts for Admin Điều hành tab', () => {
  const exams = [
    { id: 'thpt-10', examType: 'thptqg', targetGrade: 10, status: 'published' },
    { id: 'thpt-12', examType: 'thptqg', targetGrade: 12, status: 'published', isPastPool: false },
    { id: 'thpt-draft', examType: 'thptqg', targetGrade: 12, status: 'draft', isPastPool: false },
    { id: 'thpt-past', examType: 'thptqg', targetGrade: 11, status: 'published', isPastPool: true },
    { id: 'tsa-past', examType: 'tsa', targetGrade: 12, status: 'published', isPastPool: true },
    { id: 'tsa-draft', examType: 'tsa', targetGrade: 12, status: 'draft' },
    ...Array.from({ length: 11 }, (_, idx) => ({
      id: `hsa-${idx + 1}`,
      examType: 'hsa',
      targetGrade: 12,
      status: 'published',
      isPastPool: false
    })),
    ...Array.from({ length: 26 }, (_, idx) => ({
      id: `tsa-${idx + 1}`,
      examType: 'tsa',
      targetGrade: 12,
      status: 'published'
    }))
  ];

  const stats12 = computeClassPracticeOpsStats(exams, 12);
  assert.equal(stats12.valueText, '38');
  assert.equal(stats12.unitText, 'đề');
  assert.equal(stats12.badgeText, 'Kho Khối 12');
  assert.equal(stats12.summaryText, 'THPTQG: 1 đề · HSA: 11 đề · TSA: 26 đề');
  assert.deepEqual(stats12.summaryItems, [
    { label: 'THPTQG', value: '1' },
    { label: 'HSA', value: '11' },
    { label: 'TSA', value: '26' }
  ]);

  const stats11 = computeClassPracticeOpsStats(exams, 11);
  assert.equal(stats11.valueText, '26');
  assert.equal(stats11.unitText, 'đề');
  assert.equal(stats11.badgeText, 'Kho Khối 11');
  assert.equal(stats11.summaryText, 'Toán 11 (THPTQG): 0 đề · TSA: 26 đề');
  assert.deepEqual(stats11.summaryItems, [
    { label: 'THPTQG', value: '0' },
    { label: 'TSA', value: '26' }
  ]);

  const stats10 = computeClassPracticeOpsStats(exams, 10);
  assert.equal(stats10.valueText, '1');
  assert.equal(stats10.unitText, 'đề');
  assert.equal(stats10.badgeText, 'Kho Khối 10');
  assert.equal(stats10.summaryText, 'Toán 10 (THPTQG): 1 đề');
  assert.deepEqual(stats10.summaryItems, [
    { label: 'THPTQG', value: '1 đề' }
  ]);
});

test('notices-workspace.mjs removes unrelated materials/assignments buttons and avoids inline styles', async () => {
  const src = await fs.readFile(path.join(ROOT_DIR, 'client/notices-workspace.mjs'), 'utf8');
  const appSrc = await fs.readFile(path.join(ROOT_DIR, 'client/app.js'), 'utf8');
  const start = src.indexOf('export function renderClassNoticesWorkspace');
  const end = src.indexOf('export function renderClassOperationsWorkspace');
  assert.ok(start !== -1 && end > start, 'Expected renderClassNoticesWorkspace before renderClassOperationsWorkspace');
  const noticesSlice = src.slice(start, end);
  assert.doesNotMatch(noticesSlice, /Mở Bài giảng/);
  assert.doesNotMatch(noticesSlice, /Mở Bài tập/);
  assert.doesNotMatch(src, /notices-empty-nav-actions/);
  assert.match(noticesSlice, /class:\s*['"]notices-empty-board['"]/);
  assert.doesNotMatch(src, /notices-starter-grid|buildStarterTemplateGrid/);
  assert.match(noticesSlice, /label:\s*['"]Mẫu soạn nhanh['"]/);
  assert.doesNotMatch(noticesSlice, /btn\(['"]Sao chép['"]/);
  assert.match(noticesSlice, /notice-seen-btn/);
  assert.match(noticesSlice, /notice-reads-trigger/);
  assert.match(noticesSlice, /Đã xem/);
  assert.doesNotMatch(src, /\bstyle\s*=\s*["'][^"']*["']/i);
  const readsModalIdx = appSrc.indexOf('function openNoticeReadsModal');
  assert.ok(readsModalIdx !== -1, 'Expected openNoticeReadsModal in client/app.js');
  const readsModalSlice = appSrc.slice(readsModalIdx, readsModalIdx + 7000);
  assert.doesNotMatch(readsModalSlice, /\bstyle\s*=\s*["'][^"']*["']/i);
});

test('formatNoticeReadSummaryLabel formats staff read-receipt summaries cleanly', () => {
  assert.equal(formatNoticeReadSummaryLabel(null), 'Đã xem: 0');
  assert.equal(formatNoticeReadSummaryLabel({}), 'Đã xem: 0');
  assert.equal(
    formatNoticeReadSummaryLabel({ total_seen: 3, student_seen: 3, total_students: 12, parent_seen: 0, other_seen: 0 }),
    'Đã xem: 3/12 HS'
  );
  assert.equal(
    formatNoticeReadSummaryLabel({ total_seen: 5, student_seen: 3, total_students: 12, parent_seen: 2, other_seen: 0 }),
    'Đã xem: 3/12 HS · 2 PH'
  );
  assert.equal(
    formatNoticeReadSummaryLabel({ total_seen: 6, student_seen: 3, total_students: 12, parent_seen: 2, other_seen: 1 }),
    'Đã xem: 3/12 HS · 2 PH · +1'
  );
  assert.equal(
    formatNoticeReadSummaryLabel({ total_seen: 4, student_seen: 0, total_students: 0, parent_seen: 0, other_seen: 4 }),
    'Đã xem: 4'
  );
});

test('decodeNoticeMeta strips embedded legacy read-receipt markers cleanly', () => {
  const raw = '[[ltch-notice:cat=schedule|pin=1]]\nNội dung thông báo\n<!--LTCH_NOTICE_READS:{"stu1":1700000000000}-->';
  const decoded = decodeNoticeMeta(raw, 'Lịch học');
  assert.equal(decoded.category, 'schedule');
  assert.equal(decoded.pinned, true);
  assert.equal(decoded.cleanBody, 'Nội dung thông báo');
});
