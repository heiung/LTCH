import test from 'node:test';
import assert from 'node:assert/strict';
import { readOverviewDashboard } from '../worker/overview.mjs';
import { encodeLegacySubmissionFeedback } from '../shared/submission-metadata.mjs';

function createMockDb(tables = {}, { failTables = {}, dropColumns = {} } = {}) {
  const queries = [];

  function runTableFilter(table, filters, orderBy, limitVal) {
    if (failTables[table]) {
      const err = failTables[table];
      return { data: null, error: typeof err === 'string' ? { code: err, message: err } : err };
    }
    let rows = [...(tables[table] || [])];
    for (const f of filters) {
      if (f.op === 'eq') rows = rows.filter(r => r?.[f.col] === f.val);
      else if (f.op === 'in') rows = rows.filter(r => f.val.includes(r?.[f.col]));
      else if (f.op === 'gte') rows = rows.filter(r => r?.[f.col] !== null && r?.[f.col] !== undefined && r[f.col] >= f.val);
    }
    if (orderBy) {
      const { col, ascending } = orderBy;
      rows.sort((a, b) => {
        const av = a?.[col] ?? '';
        const bv = b?.[col] ?? '';
        if (av === bv) return 0;
        const cmp = av < bv ? -1 : 1;
        return ascending ? cmp : -cmp;
      });
    }
    if (Number.isFinite(limitVal)) rows = rows.slice(0, limitVal);
    return { data: rows, error: null };
  }

  return {
    queries,
    from(table) {
      const state = { filters: [], orderBy: null, limitVal: null, cols: '*', singleMode: null };
      const q = {
        select(cols) {
          state.cols = cols;
          return q;
        },
        eq(col, val) {
          state.filters.push({ op: 'eq', col, val });
          return q;
        },
        in(col, val) {
          state.filters.push({ op: 'in', col, val: Array.isArray(val) ? val : [] });
          return q;
        },
        gte(col, val) {
          state.filters.push({ op: 'gte', col, val });
          return q;
        },
        order(col, opts = {}) {
          state.orderBy = { col, ascending: opts.ascending !== false };
          return q;
        },
        limit(n) {
          state.limitVal = n;
          return q;
        },
        maybeSingle() {
          state.singleMode = 'maybeSingle';
          return q;
        },
        single() {
          state.singleMode = 'single';
          return q;
        },
        then(resolve, reject) {
          queries.push({ table, cols: state.cols, filters: [...state.filters] });
          const missingCols = dropColumns[table] || [];
          const requestedCols = String(state.cols || '').split(',').map(c => c.trim());
          if (missingCols.some(mc => requestedCols.includes(mc))) {
            return Promise.resolve({
              data: null,
              error: { code: '42703', message: `column ${missingCols[0]} does not exist` }
            }).then(resolve, reject);
          }
          const result = runTableFilter(table, state.filters, state.orderBy, state.limitVal);
          if (result.error) return Promise.resolve(result).then(resolve, reject);
          if (state.singleMode) {
            return Promise.resolve({ data: result.data[0] || null, error: null }).then(resolve, reject);
          }
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return q;
    }
  };
}

const sampleClasses = [
  { id: 'c9', name: 'Lớp 9A', schoolYearId: 'y26', schedule: 'Thứ 2, 6: 19h45 - 21h15' },
  { id: 'c12', name: 'Lớp 12', schoolYearId: 'y26', schedule: 'Thứ 4, 7: 18h00 - 20h00' }
];

test('readOverviewDashboard aggregates staff metrics, deduplicates resubmissions, and ignores legacy metadata as feedback', async () => {
  const now = Date.parse('2026-11-19T08:00:00Z');
  const legacyOnlyMeta = encodeLegacySubmissionFeedback({
    feedback: '',
    note: 'Em nộp lại ạ',
    files: [{ name: 'bai.jpg', contentType: 'image/jpeg', size: 100, objectPath: 'p1' }]
  });
  const legacyWithTeacherNote = encodeLegacySubmissionFeedback({
    feedback: 'Bài làm tốt, trình bày rõ ràng',
    note: 'Note HS',
    files: [{ name: 'bai2.jpg', contentType: 'image/jpeg', size: 120, objectPath: 'p2' }]
  });

  const db = createMockDb({
    ltch_assignments: [
      { id: 'a1', class_id: 'c12', title: 'BTVN Buổi 1', instructions: '[[buoi:1]]\nLàm hết', status: 'published', opens_at: now - 10000, closes_at: now + 86400000 },
      { id: 'a2', class_id: 'c9', title: 'BTVN Buổi 2', instructions: '[[buoi:2]]\nÔn tập', status: 'published', opens_at: now - 10000, closes_at: now + 172800000 }
    ],
    ltch_class_memberships: [
      { class_id: 'c12', uid: 'stu-1', member_role: 'student', status: 'active' },
      { class_id: 'c12', uid: 'stu-2', member_role: 'student', status: 'active' },
      { class_id: 'c9', uid: 'stu-3', member_role: 'student', status: 'active' }
    ],
    ltch_attendance: [
      { class_id: 'c12', student_uid: 'stu-1', lesson_date: '2026-11-18', status: 'present', updated_at: now - 1000 },
      { class_id: 'c12', student_uid: 'stu-2', lesson_date: '2026-11-18', status: 'late', updated_at: now - 1000 },
      { class_id: 'c9', student_uid: 'stu-3', lesson_date: '2026-11-18', status: 'absent', updated_at: now - 1000 },
      { class_id: 'c9', student_uid: 'stu-3', lesson_date: '2026-11-01', status: 'excused', updated_at: now - 2000 }
    ],
    ltch_submissions: [
      // stu-1 nộp 2 lần cho a1: chỉ tính 1 bài, lần mới nhất chỉ có metadata legacy (chưa chấm)
      { id: 'sub-old', assignment_id: 'a1', uid: 'stu-1', status: 'stored', created_at: now - 50000, stored_at: now - 50000, feedback: '' },
      { id: 'sub-new', assignment_id: 'a1', uid: 'stu-1', status: 'stored', created_at: now - 10000, stored_at: now - 10000, feedback: legacyOnlyMeta },
      // stu-2 nộp a1 đã có nhận xét thật của GV
      { id: 'sub-2', assignment_id: 'a1', uid: 'stu-2', status: 'stored', created_at: now - 20000, stored_at: now - 20000, feedback: legacyWithTeacherNote }
    ],
    ltch_lessons: [
      { id: 'l1', class_id: 'c12', title: 'Buổi 1: Hàm số', topic: '', created_at: now - 40000 }
    ],
    ltch_lesson_files: [
      { id: 'lf1', lesson_id: 'l1', class_id: 'c12', name: 'Tai_lieu.pdf', content_type: 'application/pdf', status: 'stored', created_at: now - 35000 }
    ],
    ltch_enrollment_requests: [
      { id: 'enr-1', uid: 'u-new', applicant_role: 'student', class_id: 'c12', full_name: 'Lê Minh Tuấn', status: 'pending', created_at: '2026-11-19T07:00:00Z' }
    ],
    ltch_forum_posts: [
      { id: 'fp-1', class_id: 'c9', author_uid: 'stu-3', title: 'Em hỏi câu 5', created_at: now - 5000 },
      { id: 'fp-solved', class_id: 'c9', author_uid: 'stu-3', title: 'Câu đã giải', body: '[[ltch-forum:solved=1]]\nĐã xong', created_at: now - 9000 },
      { id: 'fp-locked', class_id: 'c9', author_uid: 'admin-1', title: 'Thông báo khóa', body: '[[ltch-forum:locked=1]]\nGhim', created_at: now - 10000 }
    ],
    ltch_forum_comments: [],
    ltch_practice_attempts: [
      { id: 'att-1', exam_id: 'ex-1', uid: 'stu-1', submitted_at: now - 3000, score: 8.5, max_score: 10, status: 'submitted', is_preview: false },
      { id: 'att-preview', exam_id: 'ex-1', uid: 'admin-1', submitted_at: now - 2000, score: 10, max_score: 10, status: 'submitted', is_preview: true }
    ],
    ltch_question_reports: [
      { id: 'qr-1', exam_id: 'ex-1', category: 'wrong_answer', status: 'new', created_at: now - 4000 }
    ],
    ltch_accounts: [
      { uid: 'stu-1', display_name: 'Nguyễn An' },
      { uid: 'stu-2', display_name: 'Trần Bình' },
      { uid: 'stu-3', display_name: 'Phạm Chi' }
    ]
  });

  const result = await readOverviewDashboard(
    db,
    { uid: 'admin-1', status: 'active', roles: ['admin', 'teacher', 'student', 'parent'], memberships: [], childMemberships: [] },
    sampleClasses,
    { viewRole: 'admin', now }
  );

  assert.equal(result.assignments.length, 2);
  assert.equal(result.notices.length, 0);
  assert.equal(result.dashboard.mode, 'staff');
  assert.equal(result.dashboard.kpis.activeStudents, 3);
  assert.equal(result.dashboard.kpis.attendance30d.ratePct, 50); // 2 present/late out of 4
  assert.equal(result.dashboard.kpis.ungradedCount, 1); // sub-new only, sub-old deduplicated, sub-2 graded
  assert.equal(result.dashboard.kpis.pendingEnrollmentsCount, 1);
  assert.equal(result.dashboard.kpis.practice7d.count, 1); // ignores is_preview
  assert.equal(result.dashboard.kpis.practice7d.avgScore10, 8.5);
  assert.deepEqual(result.dashboard.assignmentStats.a1, { submittedCount: 2, ungradedCount: 1, expectedStudents: 2 });
  assert.ok(result.dashboard.actionQueue.some(item => item.type === 'enrollment' && item.title === 'Lê Minh Tuấn'));
  assert.ok(result.dashboard.actionQueue.some(item => item.type === 'grading' && item.target.subPage === 'buoi-1'));
  assert.ok(result.dashboard.actionQueue.some(item => item.type === 'question_report'));
  assert.ok(result.dashboard.actionQueue.some(item => item.type === 'forum' && item.title === 'Em hỏi câu 5' && item.target.subPage === 'fp-1'));
  assert.equal(result.dashboard.kpis.unansweredForumCount, 1);
  assert.equal(result.dashboard.classHealth.length, 2);
  assert.equal(result.dashboard.classHealth.find(c => c.classId === 'c9').unansweredForumCount, 1);
  assert.ok(result.dashboard.recentActivity.some(item => item.type === 'forum_post' && item.target.subPage === 'fp-1'));
  assert.equal(result.dashboard.recentActivity.length > 0, true);
});

test('teacher and assistant roles isolate classes and enrollment review permissions strictly', async () => {
  const now = Date.parse('2026-11-19T08:00:00Z');
  const db = createMockDb({
    ltch_assignments: [
      { id: 'a9', class_id: 'c9', title: 'BTVN 9A', instructions: '', status: 'published', opens_at: now - 1000, closes_at: now + 50000 },
      { id: 'a12', class_id: 'c12', title: 'BTVN 12', instructions: '', status: 'published', opens_at: now - 1000, closes_at: now + 50000 }
    ],
    ltch_class_memberships: [
      { class_id: 'c9', uid: 's9', member_role: 'student', status: 'active' },
      { class_id: 'c12', uid: 's12', member_role: 'student', status: 'active' }
    ],
    ltch_enrollment_requests: [
      { id: 'e9', uid: 'u9', applicant_role: 'student', class_id: 'c9', full_name: 'HS Lớp 9', status: 'pending', created_at: '2026-11-19T05:00:00Z' },
      { id: 'e12', uid: 'u12', applicant_role: 'student', class_id: 'c12', full_name: 'HS Lớp 12', status: 'pending', created_at: '2026-11-19T05:00:00Z' }
    ]
  });

  // Teacher chỉ phụ trách c9 -> không thấy a12 hay e12
  const teacherRes = await readOverviewDashboard(
    db,
    {
      uid: 't-1',
      status: 'active',
      roles: ['teacher'],
      memberships: [{ class_id: 'c9', member_role: 'teacher', status: 'active', permissions: [] }]
    },
    sampleClasses,
    { viewRole: 'teacher', now }
  );
  assert.deepEqual(teacherRes.assignments.map(a => a.id), ['a9']);
  assert.equal(teacherRes.dashboard.kpis.activeStudents, 1);
  assert.equal(teacherRes.dashboard.kpis.pendingEnrollmentsCount, 1);
  assert.deepEqual(teacherRes.dashboard.classHealth.map(c => c.classId), ['c9']);

  // Assistant không có quyền duyệt hồ sơ -> không query ltch_enrollment_requests
  db.queries.length = 0;
  const assistantRes = await readOverviewDashboard(
    db,
    {
      uid: 'asst-1',
      status: 'active',
      roles: ['assistant'],
      memberships: [{ class_id: 'c9', member_role: 'assistant', status: 'active', permissions: ['attendance.write'] }]
    },
    sampleClasses,
    { viewRole: 'assistant', now }
  );
  assert.equal(assistantRes.dashboard.canReviewEnrollments, false);
  assert.equal(db.queries.some(q => q.table === 'ltch_enrollment_requests'), false);
});

test('student dashboard prevents role spoofing and leaks zero cross-student records', async () => {
  const now = Date.parse('2026-11-19T08:00:00Z');
  const db = createMockDb({
    ltch_assignments: [
      { id: 'a12', class_id: 'c12', title: 'BTVN Buổi 3', instructions: '[[buoi:3]]', status: 'published', opens_at: now - 1000, closes_at: now + 86400000 }
    ],
    ltch_submissions: [
      {
        id: 'sub-me',
        assignment_id: 'a12',
        uid: 'stu-me',
        status: 'stored',
        created_at: now - 5000,
        stored_at: now - 5000,
        feedback: encodeLegacySubmissionFeedback({ feedback: 'Làm chính xác câu 1-4', note: '', files: [] })
      },
      { id: 'sub-other', assignment_id: 'a12', uid: 'stu-other', status: 'stored', created_at: now - 2000, stored_at: now - 2000, feedback: 'Secret other feedback' }
    ],
    ltch_attendance: [
      { class_id: 'c12', student_uid: 'stu-me', lesson_date: '2026-11-18', status: 'present', note: '', updated_at: now },
      { class_id: 'c12', student_uid: 'stu-other', lesson_date: '2026-11-18', status: 'absent', note: 'Bí mật', updated_at: now }
    ],
    ltch_practice_attempts: [
      { id: 'att-me', exam_id: 'ex-thpt', uid: 'stu-me', submitted_at: now - 1000, score: 9, max_score: 10 },
      { id: 'att-other', exam_id: 'ex-thpt', uid: 'stu-other', submitted_at: now - 1000, score: 2, max_score: 10 }
    ],
    ltch_exams: [{ id: 'ex-thpt', class_id: 'c12', title: 'Đề THPTQG số 1', exam_type: 'thptqg' }],
    ltch_lessons: [{ id: 'l-3', class_id: 'c12', title: 'Buổi 3: Tích phân', topic: '', created_at: now - 5000 }],
    ltch_lesson_files: [{ id: 'f-v1', lesson_id: 'l-3', class_id: 'c12', name: 'Video_B3.mp4', content_type: 'video/mp4', status: 'stored', created_at: now - 4000 }],
    ltch_forum_posts: [
      { id: 'fp-me', class_id: 'c12', author_uid: 'stu-me', title: 'Câu 2 tích phân', body: '[[ltch-forum:cat=homework|ses=3]]\nGiúp em', created_at: now - 3000 },
      { id: 'fp-other', class_id: 'c12', author_uid: 'stu-other', title: 'Đề luyện số 1', body: '[[ltch-forum:cat=exam|pin=1]]\nThảo luận', created_at: now - 4000 }
    ],
    ltch_forum_comments: [
      { id: 'fc-1', post_id: 'fp-me', author_uid: 'tea-1', created_at: now - 1000 }
    ],
    ltch_accounts: [
      { uid: 'stu-me', display_name: 'Học sinh Tôi' },
      { uid: 'stu-other', display_name: 'Học sinh Khác' }
    ]
  });

  // Học sinh giả mạo ?role=admin phải bị chặn xuống student
  const res = await readOverviewDashboard(
    db,
    {
      uid: 'stu-me',
      status: 'active',
      roles: ['student'],
      memberships: [{ class_id: 'c12', member_role: 'student', status: 'active' }]
    },
    sampleClasses,
    { viewRole: 'admin', now }
  );

  assert.equal(res.dashboard.mode, 'student');
  assert.equal(res.dashboard.role, 'student');
  assert.equal(db.queries.some(q => q.table === 'ltch_enrollment_requests'), false);
  assert.equal(db.queries.some(q => q.table === 'ltch_question_reports'), false);
  assert.equal(res.dashboard.assignmentStatus.a12.status, 'graded');
  assert.equal(res.dashboard.recentFeedback.length, 1);
  assert.equal(res.dashboard.recentFeedback[0].feedbackPreview, 'Làm chính xác câu 1-4');
  assert.equal(res.dashboard.recentAttendance.length, 1);
  assert.equal(res.dashboard.kpis.attendance.ratePct, 100);
  assert.equal(res.dashboard.recentPractice.length, 1);
  assert.equal(res.dashboard.recentLessons.length, 1);
  assert.equal(res.dashboard.recentLessons[0].videoCount, 1);
  assert.equal(res.dashboard.recentForumPosts.length, 2);
  assert.equal(res.dashboard.recentForumPosts.every(p => p.target.tab === 'forum' && Boolean(p.target.subPage)), true);
  assert.deepEqual(res.dashboard.kpis.forum, {
    recentCount: 2,
    openCount: 2,
    myPostsCount: 1,
    myAnsweredCount: 1
  });
});

test('parent dashboard scopes to linked children and survives legacy schema column fallbacks', async () => {
  const now = Date.parse('2026-11-19T08:00:00Z');
  const db = createMockDb(
    {
      ltch_assignments: [
        { id: 'a12', class_id: 'c12', title: 'BTVN Buổi 5', instructions: '[[buoi:5]]', status: 'published', opens_at: now - 1000, closes_at: now + 86400000 }
      ],
      ltch_attendance: [
        { class_id: 'c12', student_uid: 'child-1', lesson_date: '2026-11-18', status: 'late', note: 'Đến muộn 10 phút', updated_at: now }
      ],
      ltch_practice_attempts: [
        { id: 'att-child', exam_id: 'ex-1', uid: 'child-1', submitted_at: now - 3000, score: 8, max_score: 10 }
      ],
      ltch_exams: [{ id: 'ex-1', class_id: 'c12', title: 'Đề kiểm tra giữa kỳ' }],
      ltch_forum_posts: [{ id: 'fp-hidden', class_id: 'c12', author_uid: 'child-1', title: 'Câu hỏi riêng tư', body: 'Không hiển thị với phụ huynh', created_at: now - 1000 }],
      ltch_accounts: [{ uid: 'child-1', display_name: 'Nguyễn Minh Anh', student_code: 'LTCH008' }]
    },
    {
      dropColumns: {
        ltch_practice_attempts: ['is_preview'],
        ltch_exams: ['exam_type']
      },
      failTables: {
        ltch_question_reports: '42P01'
      }
    }
  );

  const parentRes = await readOverviewDashboard(
    db,
    {
      uid: 'par-1',
      status: 'active',
      roles: ['parent'],
      memberships: [],
      childMemberships: [{ class_id: 'c12', uid: 'child-1' }],
      linkedStudentIds: ['child-1']
    },
    sampleClasses,
    { viewRole: 'parent', now }
  );

  assert.equal(parentRes.dashboard.mode, 'parent');
  assert.equal(parentRes.dashboard.children[0].name, 'Nguyễn Minh Anh');
  assert.equal(parentRes.dashboard.children[0].studentCode, 'LTCH008');
  assert.equal(parentRes.dashboard.recentAttendance[0].status, 'late');
  assert.equal(parentRes.dashboard.recentPractice[0].examTitle, 'Đề kiểm tra giữa kỳ');
  assert.equal(parentRes.dashboard.assignmentStatus.a12.status, 'missing');
  assert.equal(parentRes.dashboard.recentForumPosts, undefined);
  assert.equal(parentRes.dashboard.kpis.forum, undefined);
  assert.equal(db.queries.some(q => q.table === 'ltch_forum_posts'), false);

  // Phụ huynh chưa liên kết học sinh nào không bị lỗi
  const emptyParent = await readOverviewDashboard(
    db,
    { uid: 'par-empty', status: 'active', roles: ['parent'], memberships: [], childMemberships: [], linkedStudentIds: [] },
    sampleClasses,
    { viewRole: 'parent', now }
  );
  assert.deepEqual(emptyParent.dashboard.children, []);
  assert.equal(emptyParent.assignments.length, 0);
});
