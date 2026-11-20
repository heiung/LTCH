import test from 'node:test';
import assert from 'node:assert/strict';
import {
  schoolYearStart,
  classCohortSlug,
  promoteClassName,
  planSchoolYearCohortTransition,
  findClassByCohortSlug,
  buildAppRoutePath,
  parseAppRoutePath,
  DEFAULT_COURSE_SESSIONS_COUNT,
  generateScheduleDates,
  rescheduleCourseSessions,
  buildClassSessionsCatalog,
  encodeSessionTopicMeta,
  decodeSessionTopicMeta,
  encodeAssignmentSessionInstructions,
  decodeAssignmentSessionInstructions
} from '../shared/classroom.mjs';

const sampleClasses = [
  { id: 'class-6a', name: 'Lớp 6', school_year_id: 'year-2026-2027' },
  { id: 'class-7a', name: 'Lớp 7', school_year_id: 'year-2026-2027' },
  { id: 'class-8a', name: 'Lớp 8A', school_year_id: 'year-2026-2027' },
  { id: 'class-8b', name: 'Lớp 8B', school_year_id: 'year-2026-2027' },
  { id: 'class-9a', name: 'Lớp 9A', school_year_id: 'year-2026-2027' },
  { id: 'class-9b', name: 'Lớp 9B', school_year_id: 'year-2026-2027' },
  { id: 'class-10a1', name: 'Lớp 10A', school_year_id: 'year-2026-2027' },
  { id: 'class-10a2', name: 'Lớp 10B', school_year_id: 'year-2026-2027' },
  { id: 'class-11a1', name: 'Lớp 11', school_year_id: 'year-2026-2027' },
  { id: 'class-12a1', name: 'Lớp 12', school_year_id: 'year-2026-2027' }
];

test('schoolYearStart extracts the starting calendar year from school year ids and labels', () => {
  assert.equal(schoolYearStart({ school_year_id: 'year-2026-2027' }), 2026);
  assert.equal(schoolYearStart({ schoolYearName: '2026 - 2027' }), 2026);
  assert.equal(schoolYearStart({}), 2026);
});

test('classCohortSlug computes Grade-6 entry year + section suffix for all 10 classes in 2026-2027', () => {
  const expected = {
    'class-12a1': '2020',
    'class-11a1': '2021',
    'class-10a1': '2022A',
    'class-10a2': '2022B',
    'class-9a': '2023A',
    'class-9b': '2023B',
    'class-8a': '2024A',
    'class-8b': '2024B',
    'class-7a': '2025',
    'class-6a': '2026'
  };

  for (const item of sampleClasses) {
    assert.equal(classCohortSlug(item), expected[item.id], `Mismatch for ${item.name}`);
  }
});

test('findClassByCohortSlug resolves classes by cohort slug case-insensitively', () => {
  assert.equal(findClassByCohortSlug(sampleClasses, 'class-6a')?.id, 'class-6a');
  assert.equal(findClassByCohortSlug(sampleClasses, '2020')?.id, 'class-12a1');
  assert.equal(findClassByCohortSlug(sampleClasses, '2023A')?.id, 'class-9a');
  assert.equal(findClassByCohortSlug(sampleClasses, '2023a')?.id, 'class-9a');
  assert.equal(findClassByCohortSlug(sampleClasses, '2022B')?.id, 'class-10a2');
  assert.equal(findClassByCohortSlug(sampleClasses, '2026')?.id, 'class-6a');
  assert.equal(findClassByCohortSlug(sampleClasses, '1999'), null);
});

test('buildAppRoutePath builds clean extensionless paths (no .html) for top-level pages, class entry, and class tabs', () => {
  const class12 = sampleClasses.find(c => c.id === 'class-12a1');
  const class9A = sampleClasses.find(c => c.id === 'class-9a');

  assert.equal(buildAppRoutePath({ page: 'home' }), '/overview');
  assert.equal(buildAppRoutePath({ page: 'classes' }), '/class');
  assert.equal(buildAppRoutePath({ page: 'archive' }), '/archive');
  assert.equal(buildAppRoutePath({ page: 'settings' }), '/settings');
  assert.equal(buildAppRoutePath({ page: 'settings', subPage: 'profile' }), '/settings');
  assert.equal(buildAppRoutePath({ page: 'settings', subPage: 'learning' }), '/settings');
  assert.equal(buildAppRoutePath({ page: 'settings', subPage: 'security' }), '/settings/security');
  assert.equal(buildAppRoutePath({ page: 'settings', subPage: 'privacy' }), '/settings/privacy');
  assert.equal(buildAppRoutePath({ page: 'admin' }), '/admin');
  assert.equal(buildAppRoutePath({ page: 'admin', subPage: 'staff' }), '/admin/staff');
  assert.equal(buildAppRoutePath({ page: 'admin', subPage: 'enrollments' }), '/admin/enrollments');
  assert.equal(buildAppRoutePath({ page: 'enrollments' }), '/enrollments');
  assert.equal(buildAppRoutePath({ page: 'onboarding' }), '/onboarding');

  // Entering a class directly -> /class/<cohort>
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'notices', isClassEntry: true }),
    '/class/2020'
  );
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class9A, activeClassTab: 'notices', isClassEntry: true }),
    '/class/2023A'
  );

  // Specific tabs inside a class
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'notices', isClassEntry: false }),
    '/class/2020/notifications'
  );
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'materials', materialsSubTab: 'files' }),
    '/class/2020/materials'
  );
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'materials', materialsSubTab: 'videos' }),
    '/class/2020/materials/videos'
  );
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class9A, activeClassTab: 'assignments' }),
    '/class/2023A/assignments'
  );
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'practice' }),
    '/class/2020/practice'
  );
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'practice', subPage: 'questions' }),
    '/class/2020/practice/questions'
  );
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'attendance' }),
    '/class/2020/attendance'
  );
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'attendance', subPage: '2026-11-19' }),
    '/class/2020/attendance/2026-11-19'
  );
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'attendance', subPage: 'invalid' }),
    '/class/2020/attendance'
  );
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'forum' }),
    '/class/2020/forum'
  );
});

test('parseAppRoutePath parses clean extensionless paths and legacy .html paths accurately', () => {
  assert.equal(parseAppRoutePath('/overview').page, 'home');
  assert.equal(parseAppRoutePath('/overview.html').page, 'home');
  assert.equal(parseAppRoutePath('/login').page, 'home');
  assert.equal(parseAppRoutePath('/login.html').page, 'home');
  assert.equal(parseAppRoutePath('/app').page, 'home');
  assert.equal(parseAppRoutePath('/app.html').page, 'home');
  assert.equal(parseAppRoutePath('/class').page, 'classes');
  assert.equal(parseAppRoutePath('/class.html').page, 'classes');
  assert.equal(parseAppRoutePath('/archive').page, 'archive');
  assert.equal(parseAppRoutePath('/archive.html').page, 'archive');
  assert.equal(parseAppRoutePath('/settings').page, 'settings');
  assert.equal(parseAppRoutePath('/settings').subPage, null);
  assert.equal(parseAppRoutePath('/settings/profile').page, 'settings');
  assert.equal(parseAppRoutePath('/settings/profile').subPage, null);
  assert.equal(parseAppRoutePath('/settings/learning').page, 'settings');
  assert.equal(parseAppRoutePath('/settings/learning').subPage, null);
  assert.equal(parseAppRoutePath('/settings/security').subPage, 'security');
  assert.equal(parseAppRoutePath('/settings/privacy').subPage, 'privacy');
  assert.equal(parseAppRoutePath('/account').page, 'settings');
  assert.equal(parseAppRoutePath('/profile').page, 'settings');
  assert.equal(parseAppRoutePath('/tai-khoan').page, 'settings');
  assert.equal(parseAppRoutePath('/admin').page, 'admin');
  assert.equal(parseAppRoutePath('/admin').subPage, null);
  assert.equal(parseAppRoutePath('/admin/staff').page, 'admin');
  assert.equal(parseAppRoutePath('/admin/staff').subPage, 'staff');
  assert.equal(parseAppRoutePath('/admin/staff-requests').subPage, 'staff');
  assert.equal(parseAppRoutePath('/admin/enrollments').page, 'admin');
  assert.equal(parseAppRoutePath('/admin/enrollments').subPage, 'enrollments');
  assert.equal(parseAppRoutePath('/enrollments').page, 'enrollments');
  assert.equal(parseAppRoutePath('/onboarding').page, 'onboarding');
  assert.equal(parseAppRoutePath('/onboarding.html').page, 'onboarding');

  const r2020 = parseAppRoutePath('/class/2020');
  assert.equal(r2020.page, 'classes');
  assert.equal(r2020.cohortSlug, '2020');
  assert.equal(r2020.classTab, 'notices');
  assert.equal(r2020.isClassEntry, true);

  const r2023A = parseAppRoutePath('/class/2023A');
  assert.equal(r2023A.page, 'classes');
  assert.equal(r2023A.cohortSlug, '2023A');
  assert.equal(r2023A.classTab, 'notices');
  assert.equal(r2023A.isClassEntry, true);

  const rNotif = parseAppRoutePath('/class/2020/notifications');
  assert.equal(rNotif.page, 'classes');
  assert.equal(rNotif.cohortSlug, '2020');
  assert.equal(rNotif.classTab, 'notices');
  assert.equal(rNotif.isClassEntry, false);

  const rMatFiles = parseAppRoutePath('/class/2020/materials');
  assert.equal(rMatFiles.page, 'classes');
  assert.equal(rMatFiles.cohortSlug, '2020');
  assert.equal(rMatFiles.classTab, 'materials');
  assert.equal(rMatFiles.materialsSubTab, 'files');
  assert.equal(rMatFiles.isClassEntry, false);

  const rMatVideos = parseAppRoutePath('/class/2020/materials/videos');
  assert.equal(rMatVideos.page, 'classes');
  assert.equal(rMatVideos.cohortSlug, '2020');
  assert.equal(rMatVideos.classTab, 'materials');
  assert.equal(rMatVideos.materialsSubTab, 'videos');
  assert.equal(rMatVideos.isClassEntry, false);

  const rQuestions = parseAppRoutePath('/class/2023A/practice/questions');
  assert.equal(rQuestions.page, 'classes');
  assert.equal(rQuestions.cohortSlug, '2023A');
  assert.equal(rQuestions.classTab, 'practice');
  assert.equal(rQuestions.subPage, 'questions');
  assert.equal(rQuestions.isClassEntry, false);

  const rAttendance = parseAppRoutePath('/class/2020/attendance/2026-11-19');
  assert.equal(rAttendance.page, 'classes');
  assert.equal(rAttendance.cohortSlug, '2020');
  assert.equal(rAttendance.classTab, 'attendance');
  assert.equal(rAttendance.subPage, '2026-11-19');
  assert.equal(rAttendance.isClassEntry, false);

  const rAttendanceInvalid = parseAppRoutePath('/class/2020/attendance/bad-date');
  assert.equal(rAttendanceInvalid.classTab, 'attendance');
  assert.equal(rAttendanceInvalid.subPage, null);
});

test('promoteClassName advances grades 6..11 while preserving section letters and caps at 12', () => {
  assert.equal(promoteClassName('Lớp 6'), 'Lớp 7');
  assert.equal(promoteClassName('Lớp 6A'), 'Lớp 7A');
  assert.equal(promoteClassName('Lớp 9B'), 'Lớp 10B');
  assert.equal(promoteClassName('Lớp 11'), 'Lớp 12');
  assert.equal(promoteClassName('Lớp 12'), null);
  assert.equal(promoteClassName('Lớp 12A'), null);
});

test('planSchoolYearCohortTransition archives Grade 12, promotes Grades 6..11 with invariant cohort slugs, and creates new Grade 6 cohort', () => {
  const plan = planSchoolYearCohortTransition(sampleClasses, 2026, [{ name: 'Lớp 6' }]);

  assert.equal(plan.currentStartYear, 2026);
  assert.equal(plan.nextStartYear, 2027);
  assert.equal(plan.nextSchoolYear.id, 'year-2027-2028');
  assert.equal(plan.nextSchoolYear.name, '2027 - 2028');

  // Grade 12 is archived and keeps its 2020 cohort slug permanently
  assert.equal(plan.toArchive.length, 1);
  assert.equal(plan.toArchive[0].id, 'class-12a1');
  assert.equal(plan.toArchive[0].cohortSlug, '2020');
  const archivedClass12 = {
    ...sampleClasses.find(c => c.id === 'class-12a1'),
    ...plan.toArchive[0].patch
  };
  assert.equal(archivedClass12.archived, true);
  assert.equal(classCohortSlug(archivedClass12), '2020');

  // Grades 6..11 (9 classes) are promoted in-place and keep their exact cohort slugs!
  assert.equal(plan.toPromote.length, 9);
  for (const p of plan.toPromote) {
    const original = sampleClasses.find(c => c.id === p.id);
    const originalSlug = classCohortSlug(original);
    const promoted = { ...original, ...p.patch };
    assert.equal(classCohortSlug(promoted), originalSlug, `Cohort slug changed after promotion for ${original.name} -> ${promoted.name}`);
  }

  // Specifically verify Lớp 6 (2026) -> Lớp 7 in 2027-2028 still has cohort slug 2026
  const promoted6 = plan.toPromote.find(p => p.id === 'class-6a');
  assert.equal(promoted6.toName, 'Lớp 7');
  assert.equal(promoted6.cohortSlug, '2026');

  // New Grade 6 in 2027-2028 gets cohort slug 2027
  assert.equal(plan.toCreate.length, 1);
  assert.equal(plan.toCreate[0].row.name, 'Lớp 6');
  assert.equal(plan.toCreate[0].cohortSlug, '2027');
  assert.equal(classCohortSlug(plan.toCreate[0].row), '2027');
});

test('planSchoolYearCohortTransition supports A/B sections for new Grade 6 cohort', () => {
  const plan = planSchoolYearCohortTransition(sampleClasses, 2026, [
    { name: 'Lớp 6A' },
    { name: 'Lớp 6B' }
  ]);
  assert.equal(plan.toCreate.length, 2);
  assert.equal(plan.toCreate[0].cohortSlug, '2027A');
  assert.equal(plan.toCreate[1].cohortSlug, '2027B');
});

test('generateScheduleDates generates 50 session dates following the class fixed weekly schedule', () => {
  // Monday (day 1) 18:00-20:00 starting from 2026-09-07 (which is a Monday)
  const slots = [{ day: 1, start: '18:00', end: '20:00' }];
  const generated = generateScheduleDates({
    scheduleSlots: slots,
    startDate: '2026-09-07',
    count: DEFAULT_COURSE_SESSIONS_COUNT
  });
  assert.equal(generated.length, 50);
  assert.equal(generated[0].sessionNumber, 1);
  assert.equal(generated[0].date, '2026-09-07');
  assert.equal(generated[1].date, '2026-09-14');
  // Session 9 on weekly Monday starting 2026-09-07 is 2026-11-02
  assert.equal(generated[8].sessionNumber, 9);
  assert.equal(generated[8].date, '2026-11-02');
  assert.equal(generated[9].sessionNumber, 10);
  assert.equal(generated[9].date, '2026-11-09');
});

test('rescheduleCourseSessions cascades subsequent sessions when a session is postponed by 1 week (e.g. 2026-11-02 -> 2026-11-09)', () => {
  const slots = [{ day: 1, start: '18:00', end: '20:00' }];
  const initialCatalog = buildClassSessionsCatalog({
    classId: 'class-12a1',
    classRecord: {
      id: 'class-12a1',
      school_year_id: 'year-2026-2027',
      schedule_slots: slots
    },
    lessons: [],
    totalSessions: 50,
    startDate: '2026-09-07'
  });

  // Verify Buổi 9 is 2026-11-02 and Buổi 10 is 2026-11-09 before postponement
  const s9Before = initialCatalog.sessions.find(s => s.sessionNumber === 9);
  const s10Before = initialCatalog.sessions.find(s => s.sessionNumber === 10);
  const s50Before = initialCatalog.sessions.find(s => s.sessionNumber === 50);
  assert.equal(s9Before.date, '2026-11-02');
  assert.equal(s10Before.date, '2026-11-09');

  // Postpone Buổi 9 from 2026-11-02 to 2026-11-09 (1 week later because 02/11 was off)
  const result = rescheduleCourseSessions({
    sessions: initialCatalog.sessions,
    sessionNumber: 9,
    newDate: '2026-11-09',
    scheduleSlots: slots
  });

  assert.equal(result.cascaded, true);
  assert.equal(result.deltaDays, 7);

  // Buổi 1..8 remain unchanged
  assert.equal(result.sessions[0].date, '2026-09-07');
  assert.equal(result.sessions[7].date, '2026-10-26');

  // Buổi 9 is now 2026-11-09
  const s9After = result.sessions.find(s => s.sessionNumber === 9);
  assert.equal(s9After.date, '2026-11-09');

  // Buổi 10 automatically shifted from 2026-11-09 to 2026-11-16!
  const s10After = result.sessions.find(s => s.sessionNumber === 10);
  assert.equal(s10After.date, '2026-11-16');

  // Buổi 11 automatically shifted from 2026-11-16 to 2026-11-23!
  const s11After = result.sessions.find(s => s.sessionNumber === 11);
  assert.equal(s11After.date, '2026-11-23');

  // Buổi 50 also shifted by 1 week
  const s50After = result.sessions.find(s => s.sessionNumber === 50);
  assert.notEqual(s50After.date, s50Before.date);
  assert.equal(result.changedSessions.length, 42); // Buổi 9 through Buổi 50 (42 sessions updated)
});

test('rescheduleCourseSessions allows minor within-week adjustment (e.g. 2026-11-02 -> 2026-11-04) without cascading subsequent sessions by default', () => {
  const slots = [{ day: 1, start: '18:00', end: '20:00' }];
  const initialCatalog = buildClassSessionsCatalog({
    classId: 'class-12a1',
    classRecord: {
      id: 'class-12a1',
      school_year_id: 'year-2026-2027',
      schedule_slots: slots
    },
    lessons: [],
    totalSessions: 50,
    startDate: '2026-09-07'
  });

  const result = rescheduleCourseSessions({
    sessions: initialCatalog.sessions,
    sessionNumber: 9,
    newDate: '2026-11-04',
    scheduleSlots: slots
  });

  assert.equal(result.cascaded, false);
  assert.equal(result.changedSessions.length, 1);
  assert.equal(result.sessions.find(s => s.sessionNumber === 9).date, '2026-11-04');
  assert.equal(result.sessions.find(s => s.sessionNumber === 10).date, '2026-11-09');
});

test('encodeSessionTopicMeta, decodeSessionTopicMeta, and assignment session tags round-trip cleanly', () => {
  const encodedTopic = encodeSessionTopicMeta({
    cleanTopic: 'Khảo sát hàm số',
    driveVideoFileId: 'file-123',
    sessionNumber: 12,
    date: '2026-11-23',
    start: '18:00',
    end: '20:00',
    customDate: true
  });
  const decodedTopic = decodeSessionTopicMeta(encodedTopic);
  assert.equal(decodedTopic.cleanTopic, 'Khảo sát hàm số');
  assert.equal(decodedTopic.driveVideoFileId, 'file-123');
  assert.equal(decodedTopic.sessionNumber, 12);
  assert.equal(decodedTopic.date, '2026-11-23');
  assert.equal(decodedTopic.start, '18:00');
  assert.equal(decodedTopic.end, '20:00');
  assert.equal(decodedTopic.customDate, true);

  const encodedHw = encodeAssignmentSessionInstructions({
    sessionNumber: 12,
    lessonId: 'ses-class-12a1-12',
    cleanInstructions: 'Làm bài 1 đến bài 5 trang 42.'
  });
  const decodedHw = decodeAssignmentSessionInstructions(encodedHw);
  assert.equal(decodedHw.sessionNumber, 12);
  assert.equal(decodedHw.lessonId, 'ses-class-12a1-12');
  assert.equal(decodedHw.cleanInstructions, 'Làm bài 1 đến bài 5 trang 42.');
});

test('dedicated session routes (/class/<slug>/materials/buoi-<N>) and cover image separation work cleanly', () => {
  const class12 = sampleClasses.find(c => c.id === 'class-12a1');
  assert.equal(
    buildAppRoutePath({ page: 'classes', selectedClass: class12, activeClassTab: 'materials', subPage: 'buoi-7' }),
    '/class/2020/materials/buoi-7'
  );

  const parsed = parseAppRoutePath('/class/2020/materials/buoi-7');
  assert.equal(parsed.page, 'classes');
  assert.equal(parsed.classSlug, '2020');
  assert.equal(parsed.classTab, 'materials');
  assert.equal(parsed.subPage, 'buoi-7');

  const catalog = buildClassSessionsCatalog({
    classId: 'class-12a1',
    classRecord: class12,
    lessons: [
      { id: 'lesson-1', title: 'Buổi 1: Hàm số bậc ba', topic: encodeSessionTopicMeta({ sessionNumber: 1 }) }
    ],
    lessonFiles: [
      { id: 'doc-1', lesson_id: 'lesson-1', name: 'Đề cương Buổi 1.pdf', content_type: 'application/pdf', created_at: '2026-11-07T08:00:00Z' },
      { id: 'cov-old', lesson_id: 'lesson-1', name: '__ltch_cover__.png', content_type: 'image/png', created_at: '2026-11-07T08:05:00Z' },
      { id: 'cov-new', lesson_id: 'lesson-1', name: '__ltch_cover__.webp', content_type: 'image/webp', created_at: '2026-11-07T09:30:00Z' },
      { id: 'vid-1', lesson_id: 'lesson-1', name: 'Bài giảng đạo hàm.mp4', content_type: 'video/mp4', created_at: '2026-11-07T09:00:00Z' }
    ]
  });

  const session1 = catalog.sessions.find(s => s.sessionNumber === 1);
  assert.equal(session1.coverFileId, 'cov-new');
  assert.deepEqual(session1.files.map(f => f.id), ['doc-1']);
  assert.deepEqual(session1.videos.map(v => v.id), ['vid-1']);
});

test('forum sub-page deep links preserve case for post IDs in buildAppRoutePath and parseAppRoutePath', () => {
  const klass = { id: 'c12', name: 'Lớp 12', school_year_id: 'year-2026-2027' };
  const routePath = buildAppRoutePath({
    nav: 'classes',
    klass,
    allClasses: [klass],
    classTab: 'forum',
    subPage: 'PostId_Case123'
  });
  assert.equal(routePath, '/class/2020/forum/PostId_Case123');
  const parsed = parseAppRoutePath(routePath);
  assert.equal(parsed.page, 'classes');
  assert.equal(parsed.classSlug, '2020');
  assert.equal(parsed.classTab, 'forum');
  assert.equal(parsed.subPage, 'PostId_Case123');
});



