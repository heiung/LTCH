import { data } from './policy.mjs';
import { withNoticeFiles } from './notice-queries.mjs';
import { decodeSubmissionRecord } from '../shared/submission-metadata.mjs';
import { decodeForumPostMeta } from '../shared/forum-metadata.mjs';
import {
  classGrade,
  sortClasses,
  parseSessionLessonTitle,
  decodeAssignmentSessionInstructions,
  timeZone
} from '../shared/classroom.mjs';

const ROLE_ORDER = ['admin', 'teacher', 'assistant', 'student', 'parent'];

export async function readOverview(db, classes, now = Date.now()) {
  const ids = classes.map(c => c.id);
  let noticeQuery = db.from('ltch_notices').select('id,class_id,scope,title,body,created_at').eq('status', 'published');
  noticeQuery = ids.length ? noticeQuery.or(`scope.eq.all,class_id.in.(${ids.join(',')})`) : noticeQuery.eq('scope', 'all');
  const [assignments, notices] = await Promise.all([
    ids.length ? db.from('ltch_assignments').select('id,class_id,title,instructions,opens_at,closes_at').in('class_id', ids).eq('status', 'published').gte('closes_at', now).order('closes_at').limit(20) : Promise.resolve({ data: [], error: null }),
    noticeQuery.order('created_at', { ascending: false }).limit(10)
  ]);
  return { assignments: data(assignments), notices: await withNoticeFiles(db, data(notices)) };
}

function isMissingColumnLikeError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return ['42703', 'PGRST204', '42P01'].includes(code) || /does not exist|schema cache|Could not find/i.test(message);
}

async function safeRows(promise, label = 'overview') {
  try {
    const res = await promise;
    if (res?.error) {
      console.warn('LTCH_OVERVIEW_SUBQUERY_WARN', label, String(res.error.code || ''));
      return [];
    }
    return Array.isArray(res?.data) ? res.data : [];
  } catch {
    console.warn('LTCH_OVERVIEW_SUBQUERY_WARN', label);
    return [];
  }
}

async function safeSelectWithFallback(buildQueryFn, fullCols, fallbackCols, label = 'overview') {
  try {
    let res = await buildQueryFn(fullCols);
    if (res?.error && isMissingColumnLikeError(res.error)) {
      res = await buildQueryFn(fallbackCols);
    }
    if (res?.error) {
      console.warn('LTCH_OVERVIEW_SUBQUERY_WARN', label, String(res.error.code || ''));
      return [];
    }
    return Array.isArray(res?.data) ? res.data : [];
  } catch {
    console.warn('LTCH_OVERVIEW_SUBQUERY_WARN', label);
    return [];
  }
}

function vnDateDaysAgo(now, days) {
  const ts = (Number.isFinite(Number(now)) ? Number(now) : Date.now()) - days * 86_400_000;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

function truncateText(text, max = 140) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…` : clean;
}

function extractSessionNumFromAssignment(assignment) {
  const decoded = decodeAssignmentSessionInstructions(assignment?.instructions || '');
  if (decoded?.sessionNumber) return Number(decoded.sessionNumber);
  const parsed = parseSessionLessonTitle(assignment?.title || '');
  return parsed?.sessionNumber ? Number(parsed.sessionNumber) : null;
}

function resolveEffectiveRole(actor, requestedRole) {
  const allowed = Array.isArray(actor?.roles) ? actor.roles : [];
  const req = String(requestedRole || '').trim();
  if (req && allowed.includes(req)) return req;
  for (const candidate of ROLE_ORDER) {
    if (allowed.includes(candidate)) return candidate;
  }
  return 'student';
}

function scopeClassesForRole(actor, allClasses, effectiveRole) {
  const list = Array.isArray(allClasses) ? allClasses : [];
  const memberships = Array.isArray(actor?.memberships) ? actor.memberships : [];
  if (effectiveRole === 'admin' && Array.isArray(actor?.roles) && actor.roles.includes('admin')) {
    return sortClasses(list);
  }
  if (effectiveRole === 'parent') {
    const allowedIds = new Set((actor?.childMemberships || []).map(m => m.class_id));
    return sortClasses(list.filter(c => allowedIds.has(c.id)));
  }
  const allowedIds = new Set(
    memberships
      .filter(m => m?.member_role === effectiveRole && (!m.status || m.status === 'active'))
      .map(m => m.class_id)
  );
  return sortClasses(list.filter(c => allowedIds.has(c.id)));
}

function summarizeAttendanceRows(rows = []) {
  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;
  for (const row of rows) {
    if (row?.status === 'present') present++;
    else if (row?.status === 'late') late++;
    else if (row?.status === 'excused') excused++;
    else if (row?.status === 'absent') absent++;
  }
  const total = present + late + absent + excused;
  const ratePct = total > 0 ? Math.round(((present + late) / total) * 100) : null;
  return { ratePct, present, late, absent, excused, total };
}

function summarizePracticeAttempts(rows = []) {
  const valid = rows.filter(
    r =>
      r?.is_preview !== true &&
      String(r?.status || 'submitted') !== 'in_progress' &&
      Number(r?.max_score) > 0 &&
      Number.isFinite(Number(r?.score))
  );
  if (!valid.length) return { count: 0, avgScore10: null, validRows: [] };
  let sum10 = 0;
  for (const r of valid) {
    sum10 += (Number(r.score) / Number(r.max_score)) * 10;
  }
  const avgScore10 = Math.round((sum10 / valid.length) * 10) / 10;
  return { count: valid.length, avgScore10, validRows: valid };
}

function deduplicateLatestSubmissions(rows = [], keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const ts = Number(row?.stored_at || row?.created_at || 0);
    const prev = map.get(key);
    if (!prev || ts > Number(prev.stored_at || prev.created_at || 0)) {
      map.set(key, row);
    }
  }
  return [...map.values()];
}

async function readStaffDashboard(db, actor, scopedClasses, effectiveRole, now) {
  const classIds = scopedClasses.map(c => c.id);
  const classMap = new Map(scopedClasses.map(c => [c.id, c]));
  const canReviewEnrollments =
    effectiveRole === 'admin' || (effectiveRole === 'teacher' && classIds.length > 0);
  const canCheckPractice =
    effectiveRole === 'admin' ||
    scopedClasses.some(c => classGrade(c.name) >= 10) ||
    (actor?.memberships || []).some(
      m => m?.member_role === 'assistant' && Array.isArray(m.permissions) && m.permissions.includes('practice.manage')
    );

  const since30d = vnDateDaysAgo(now, 30);
  const since7dTs = now - 7 * 86_400_000;

  let enrollQuery = canReviewEnrollments
    ? db
        .from('ltch_enrollment_requests')
        .select('id,uid,applicant_role,class_id,full_name,status,created_at,updated_at')
        .in('status', ['pending', 'needs_revision'])
    : null;
  if (enrollQuery && effectiveRole === 'teacher') {
    enrollQuery = enrollQuery.in('class_id', classIds);
  }
  if (enrollQuery) {
    enrollQuery = enrollQuery.order('created_at', { ascending: false }).limit(20);
  }

  const [
    upcomingAssignments,
    recentAssignments,
    memberships,
    attendance30d,
    lessonFiles,
    lessons,
    pendingEnrollments,
    forumPosts,
    practiceAttempts7dRaw,
    openQuestionReports
  ] = await Promise.all([
    classIds.length
      ? safeRows(
          db
            .from('ltch_assignments')
            .select('id,class_id,title,instructions,opens_at,closes_at')
            .in('class_id', classIds)
            .eq('status', 'published')
            .gte('closes_at', now)
            .order('closes_at')
            .limit(20),
          'staff_upcoming_assignments'
        )
      : [],
    classIds.length
      ? safeRows(
          db
            .from('ltch_assignments')
            .select('id,class_id,title,instructions,opens_at,closes_at')
            .in('class_id', classIds)
            .eq('status', 'published')
            .order('closes_at', { ascending: false })
            .limit(40),
          'staff_recent_assignments'
        )
      : [],
    classIds.length
      ? safeRows(
          db
            .from('ltch_class_memberships')
            .select('class_id,uid')
            .in('class_id', classIds)
            .eq('member_role', 'student')
            .eq('status', 'active')
            .limit(1000),
          'staff_memberships'
        )
      : [],
    classIds.length
      ? safeRows(
          db
            .from('ltch_attendance')
            .select('class_id,student_uid,lesson_date,status,updated_at')
            .in('class_id', classIds)
            .gte('lesson_date', since30d)
            .order('updated_at', { ascending: false })
            .limit(1000),
          'staff_attendance_30d'
        )
      : [],
    classIds.length
      ? safeRows(
          db
            .from('ltch_lesson_files')
            .select('id,lesson_id,class_id,name,content_type,created_at')
            .in('class_id', classIds)
            .eq('status', 'stored')
            .order('created_at', { ascending: false })
            .limit(500),
          'staff_lesson_files'
        )
      : [],
    classIds.length
      ? safeRows(
          db
            .from('ltch_lessons')
            .select('id,class_id,title,topic,created_at')
            .in('class_id', classIds)
            .order('created_at', { ascending: false })
            .limit(300),
          'staff_lessons'
        )
      : [],
    enrollQuery ? safeRows(enrollQuery, 'staff_enrollments') : [],
    classIds.length
      ? safeRows(
          db
            .from('ltch_forum_posts')
            .select('id,class_id,author_uid,title,body,created_at')
            .in('class_id', classIds)
            .order('created_at', { ascending: false })
            .limit(40),
          'staff_forum_posts'
        )
      : [],
    canCheckPractice
      ? safeSelectWithFallback(
          cols =>
            db
              .from('ltch_practice_attempts')
              .select(cols)
              .gte('submitted_at', since7dTs)
              .order('submitted_at', { ascending: false })
              .limit(200),
          'id,exam_id,uid,submitted_at,score,max_score,status,is_preview',
          'id,exam_id,uid,submitted_at,score,max_score',
          'staff_practice_attempts_7d'
        )
      : [],
    canCheckPractice
      ? safeRows(
          db
            .from('ltch_question_reports')
            .select('id,exam_id,category,status,created_at')
            .in('status', ['new', 'in_progress'])
            .order('created_at', { ascending: false })
            .limit(20),
          'staff_question_reports'
        )
      : []
  ]);

  const assignmentMap = new Map();
  for (const a of [...recentAssignments, ...upcomingAssignments]) {
    if (a?.id) assignmentMap.set(a.id, a);
  }
  const allAssignmentIds = [...assignmentMap.keys()];
  const forumPostIds = forumPosts.map(p => p.id).filter(Boolean);
  const practiceExamIds =
    canCheckPractice && effectiveRole !== 'admin'
      ? [...new Set(practiceAttempts7dRaw.map(r => r.exam_id).filter(Boolean))]
      : [];

  const [submissionsRaw, forumComments, practiceExamsMeta] = await Promise.all([
    allAssignmentIds.length
      ? safeRows(
          db
            .from('ltch_submissions')
            .select('id,assignment_id,uid,status,stored_at,created_at,feedback')
            .in('assignment_id', allAssignmentIds)
            .eq('status', 'stored')
            .order('stored_at', { ascending: false })
            .limit(500),
          'staff_submissions'
        )
      : [],
    forumPostIds.length
      ? safeRows(
          db
            .from('ltch_forum_comments')
            .select('id,post_id,author_uid,created_at')
            .in('post_id', forumPostIds)
            .limit(200),
          'staff_forum_comments'
        )
      : [],
    practiceExamIds.length
      ? safeSelectWithFallback(
          cols => db.from('ltch_exams').select(cols).in('id', practiceExamIds).limit(200),
          'id,class_id,exam_type',
          'id,class_id',
          'staff_practice_exams'
        )
      : []
  ]);

  let scopedPracticeAttempts = practiceAttempts7dRaw;
  if (canCheckPractice && effectiveRole !== 'admin') {
    const classIdSet = new Set(classIds);
    const examMetaMap = new Map(practiceExamsMeta.map(e => [e.id, e]));
    scopedPracticeAttempts = practiceAttempts7dRaw.filter(att => {
      const ex = examMetaMap.get(att.exam_id);
      if (!ex) return false;
      return classIdSet.has(ex.class_id) || ['thptqg', 'hsa', 'tsa'].includes(String(ex.exam_type || '').toLowerCase());
    });
  }
  const practice7dRawSummary = summarizePracticeAttempts(scopedPracticeAttempts);
  const practice7dSummary = {
    count: practice7dRawSummary.count,
    avgScore10: practice7dRawSummary.avgScore10
  };

  // Deduplicate stored submissions per (assignment_id, uid) so resubmissions are never double-counted
  const latestSubmissions = deduplicateLatestSubmissions(
    submissionsRaw,
    s => (s?.assignment_id && s?.uid ? `${s.assignment_id}:${s.uid}` : null)
  ).map(s => {
    const decoded = decodeSubmissionRecord(s);
    const assignment = assignmentMap.get(s.assignment_id);
    const hasFeedback = Boolean(decoded.feedback);
    return {
      ...s,
      class_id: assignment?.class_id || null,
      assignmentTitle: assignment?.title || 'Bài tập về nhà',
      sessionNumber: assignment ? extractSessionNumFromAssignment(assignment) : null,
      hasFeedback,
      ts: Number(s.stored_at || s.created_at || 0)
    };
  });

  latestSubmissions.sort((a, b) => b.ts - a.ts);

  // Batch fetch display names only for recent submissions and recent forum posts (max 40 UIDs)
  const referencedUids = [
    ...new Set([
      ...latestSubmissions.slice(0, 12).map(s => s.uid),
      ...forumPosts.slice(0, 12).map(p => p.author_uid)
    ].filter(Boolean))
  ].slice(0, 40);

  const accountRows = referencedUids.length
    ? await safeRows(
        db.from('ltch_accounts').select('uid,display_name').in('uid', referencedUids).limit(40),
        'staff_account_names'
      )
    : [];
  const nameMap = new Map(accountRows.map(a => [a.uid, a.display_name || 'Thành viên']));

  const studentsByClass = new Map();
  const allStudentUids = new Set();
  for (const m of memberships) {
    if (!m?.class_id || !m?.uid) continue;
    allStudentUids.add(m.uid);
    if (!studentsByClass.has(m.class_id)) studentsByClass.set(m.class_id, new Set());
    studentsByClass.get(m.class_id).add(m.uid);
  }

  const attendance30dSummary = summarizeAttendanceRows(attendance30d);

  // Per-assignment submission & grading stats
  const submissionsByAssignment = new Map();
  for (const sub of latestSubmissions) {
    if (!submissionsByAssignment.has(sub.assignment_id)) submissionsByAssignment.set(sub.assignment_id, []);
    submissionsByAssignment.get(sub.assignment_id).push(sub);
  }

  const assignmentStats = {};
  for (const a of upcomingAssignments) {
    const subs = submissionsByAssignment.get(a.id) || [];
    const expectedStudents = studentsByClass.get(a.class_id)?.size || 0;
    const ungradedInAssignment = subs.filter(s => !s.hasFeedback).length;
    assignmentStats[a.id] = {
      submittedCount: subs.length,
      ungradedCount: ungradedInAssignment,
      expectedStudents
    };
  }

  const ungradedSubmissions = latestSubmissions.filter(s => !s.hasFeedback);

  // Forum comment count & decoded meta per post
  const commentCountByPost = new Map();
  for (const c of forumComments) {
    if (!c?.post_id) continue;
    commentCountByPost.set(c.post_id, (commentCountByPost.get(c.post_id) || 0) + 1);
  }
  const forumMetaMap = new Map(
    forumPosts.map(p => [p.id, decodeForumPostMeta(p.body || '', p.title || '')])
  );

  // Action Queue (max 8 items)
  const actionQueue = [];
  const sortedEnrollments = [...pendingEnrollments].sort((a, b) => {
    const aPrio = a.status === 'pending' ? 0 : 1;
    const bPrio = b.status === 'pending' ? 0 : 1;
    return aPrio - bPrio || (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
  });
  for (const r of sortedEnrollments.slice(0, 3)) {
    const cName = classMap.get(r.class_id)?.name || 'Lớp học';
    const roleLabel = r.applicant_role === 'parent' ? 'Phụ huynh' : 'Học sinh';
    actionQueue.push({
      type: 'enrollment',
      id: r.id,
      title: r.full_name || 'Hồ sơ đăng ký mới',
      subtitle: `${cName} · ${roleLabel}`,
      badge: r.status === 'pending' ? 'Chờ duyệt' : 'Chờ bổ sung',
      timestamp: Date.parse(r.created_at) || now,
      target: { page: 'enrollments' }
    });
  }

  // Group ungraded submissions by assignment
  const ungradedByAssignment = new Map();
  for (const s of ungradedSubmissions) {
    const prev = ungradedByAssignment.get(s.assignment_id);
    if (!prev) {
      ungradedByAssignment.set(s.assignment_id, {
        assignmentId: s.assignment_id,
        classId: s.class_id,
        title: s.assignmentTitle,
        sessionNumber: s.sessionNumber,
        count: 1,
        latestTs: s.ts
      });
    } else {
      prev.count++;
      if (s.ts > prev.latestTs) prev.latestTs = s.ts;
    }
  }
  const topUngradedAssignments = [...ungradedByAssignment.values()]
    .sort((a, b) => b.count - a.count || b.latestTs - a.latestTs)
    .slice(0, 3);
  for (const item of topUngradedAssignments) {
    const cName = classMap.get(item.classId)?.name || 'Lớp học';
    actionQueue.push({
      type: 'grading',
      id: item.assignmentId,
      title: item.title,
      subtitle: `${cName} · ${item.count} bài chờ nhận xét`,
      badge: `${item.count} chờ chấm`,
      timestamp: item.latestTs || now,
      target: {
        classId: item.classId,
        tab: 'assignments',
        subPage: item.sessionNumber ? `buoi-${item.sessionNumber}` : null
      }
    });
  }

  if (openQuestionReports.length > 0) {
    actionQueue.push({
      type: 'question_report',
      id: 'q-reports',
      title: `${openQuestionReports.length} báo lỗi câu hỏi phòng luyện`,
      subtitle: 'Cần rà soát nội dung / đáp án trong Phòng luyện',
      badge: `${openQuestionReports.length} báo lỗi`,
      timestamp: Number(openQuestionReports[0]?.created_at || now),
      target: { page: 'practice' }
    });
  }

  const unansweredThreshold = now - 14 * 86_400_000;
  const allUnansweredForum = forumPosts.filter(p => {
    const meta = forumMetaMap.get(p.id);
    return (
      !meta?.resolved &&
      !meta?.acceptedCommentId &&
      !meta?.locked &&
      (commentCountByPost.get(p.id) || 0) === 0
    );
  });
  const unansweredPosts = allUnansweredForum
    .filter(p => Number(p.created_at || 0) >= unansweredThreshold)
    .slice(0, 2);
  for (const p of unansweredPosts) {
    const cName = classMap.get(p.class_id)?.name || 'Lớp học';
    const authorName = nameMap.get(p.author_uid) || 'Thành viên';
    actionQueue.push({
      type: 'forum',
      id: p.id,
      title: p.title,
      subtitle: `${cName} · ${authorName} chưa có phản hồi`,
      badge: 'Chưa trả lời',
      timestamp: Number(p.created_at || now),
      target: { classId: p.class_id, tab: 'forum', subPage: p.id }
    });
  }

  // Class Health Matrix (per-class operational overview)
  const lessonsWithFilesByClass = new Map();
  const lessonMap = new Map(lessons.map(l => [l.id, l]));
  const latestFileByLesson = new Map();
  for (const f of lessonFiles) {
    if (!f?.class_id || !f?.lesson_id) continue;
    if (!lessonsWithFilesByClass.has(f.class_id)) lessonsWithFilesByClass.set(f.class_id, new Set());
    lessonsWithFilesByClass.get(f.class_id).add(f.lesson_id);

    const ts = Number(f.created_at || 0);
    const prev = latestFileByLesson.get(f.lesson_id);
    if (!prev || ts > prev.ts) {
      latestFileByLesson.set(f.lesson_id, {
        lessonId: f.lesson_id,
        classId: f.class_id,
        fileName: f.name,
        ts
      });
    }
  }

  const classHealth = scopedClasses.map(c => {
    const studentCount = studentsByClass.get(c.id)?.size || 0;
    const classAttRows = attendance30d.filter(r => r.class_id === c.id);
    const attSummary = summarizeAttendanceRows(classAttRows);
    const lessonWithFilesCount = lessonsWithFilesByClass.get(c.id)?.size || 0;
    const openAssignmentsCount = upcomingAssignments.filter(a => a.class_id === c.id).length;
    const ungradedClassCount = ungradedSubmissions.filter(s => s.class_id === c.id).length;
    const unansweredForumClassCount = allUnansweredForum.filter(p => p.class_id === c.id).length;
    return {
      classId: c.id,
      className: c.name,
      studentCount,
      attendanceRatePct: attSummary.ratePct,
      attendanceTotal: attSummary.total,
      attendanceAbsent: attSummary.absent + attSummary.excused,
      lessonWithFilesCount,
      openAssignmentsCount,
      ungradedCount: ungradedClassCount,
      unansweredForumCount: unansweredForumClassCount
    };
  });

  // Recent Activity Feed (max 6)
  const activityPool = [];
  for (const s of latestSubmissions.slice(0, 4)) {
    const cName = classMap.get(s.class_id)?.name || 'Lớp học';
    const studentName = nameMap.get(s.uid) || 'Học sinh';
    activityPool.push({
      type: 'submission',
      id: `sub-${s.id}`,
      title: `${studentName} đã nộp bài`,
      subtitle: `${cName} · ${s.assignmentTitle}`,
      statusLabel: s.hasFeedback ? 'Đã nhận xét' : 'Chờ nhận xét',
      timestamp: s.ts,
      target: {
        classId: s.class_id,
        tab: 'assignments',
        subPage: s.sessionNumber ? `buoi-${s.sessionNumber}` : null
      }
    });
  }
  for (const p of forumPosts.slice(0, 4)) {
    const cName = classMap.get(p.class_id)?.name || 'Lớp học';
    const authorName = nameMap.get(p.author_uid) || 'Thành viên';
    const cCount = commentCountByPost.get(p.id) || 0;
    const meta = forumMetaMap.get(p.id);
    activityPool.push({
      type: 'forum_post',
      id: `forum-${p.id}`,
      title: p.title,
      subtitle: `${cName} · ${authorName}`,
      statusLabel: meta?.resolved ? 'Đã giải đáp' : cCount ? `${cCount} bình luận` : 'Chờ giải đáp',
      timestamp: Number(p.created_at || 0),
      target: { classId: p.class_id, tab: 'forum', subPage: p.id }
    });
  }
  const latestLessonEntries = [...latestFileByLesson.values()].sort((a, b) => b.ts - a.ts).slice(0, 4);
  for (const lf of latestLessonEntries) {
    const lesson = lessonMap.get(lf.lessonId);
    if (!lesson) continue;
    const cName = classMap.get(lf.classId)?.name || 'Lớp học';
    const parsedTitle = parseSessionLessonTitle(lesson.title || '');
    activityPool.push({
      type: 'lesson_file',
      id: `lesson-${lf.lessonId}`,
      title: lesson.title || 'Bài giảng mới',
      subtitle: `${cName} · ${lf.fileName}`,
      statusLabel: 'Học liệu mới',
      timestamp: lf.ts,
      target: {
        classId: lf.classId,
        tab: 'materials',
        subPage: parsedTitle.sessionNumber ? `buoi-${parsedTitle.sessionNumber}` : null
      }
    });
  }
  activityPool.sort((a, b) => b.timestamp - a.timestamp);

  return {
    assignments: upcomingAssignments,
    notices: [],
    dashboard: {
      role: effectiveRole,
      mode: 'staff',
      generatedAt: now,
      canReviewEnrollments,
      canCheckPractice,
      kpis: {
        activeStudents: allStudentUids.size,
        classCount: scopedClasses.length,
        attendance30d: attendance30dSummary,
        ungradedCount: ungradedSubmissions.length,
        openAssignmentsCount: upcomingAssignments.length,
        pendingEnrollmentsCount: pendingEnrollments.length,
        openQuestionReportsCount: openQuestionReports.length,
        unansweredForumCount: allUnansweredForum.length,
        practice7d: practice7dSummary
      },
      actionQueue: actionQueue.slice(0, 8),
      assignmentStats,
      classHealth,
      recentActivity: activityPool.slice(0, 6)
    }
  };
}

async function readLearnerDashboard(db, actor, scopedClasses, effectiveRole, now) {
  const isParent = effectiveRole === 'parent';
  const classIds = scopedClasses.map(c => c.id);
  const classMap = new Map(scopedClasses.map(c => [c.id, c]));
  const targetUids = isParent
    ? [...new Set((actor?.linkedStudentIds || []).filter(Boolean))]
    : [actor?.uid].filter(Boolean);

  if (!targetUids.length) {
    return {
      assignments: [],
      notices: [],
      dashboard: {
        role: effectiveRole,
        mode: effectiveRole,
        generatedAt: now,
        ...(isParent ? { children: [] } : {}),
        kpis: {
          attendance: summarizeAttendanceRows([]),
          homework: { totalOpen: 0, submittedOpen: 0, pendingOpen: 0, gradedTotal: 0 },
          practice: { attemptCount: 0, avgScore10: null, latestScore: null, latestMaxScore: null, latestExamTitle: '' },
          materials: { lessonsWithFilesCount: 0, latestLessonTitle: '', latestSessionNumber: null, latestClassId: null }
        },
        assignmentStatus: {},
        recentLessons: [],
        recentFeedback: [],
        recentPractice: [],
        recentAttendance: []
      }
    };
  }

  const [
    upcomingAssignments,
    submissionsRaw,
    attendanceRows,
    attemptsRaw,
    lessons,
    lessonFiles,
    childAccounts,
    studentForumPosts
  ] = await Promise.all([
    classIds.length
      ? safeRows(
          db
            .from('ltch_assignments')
            .select('id,class_id,title,instructions,opens_at,closes_at')
            .in('class_id', classIds)
            .eq('status', 'published')
            .gte('closes_at', now)
            .order('closes_at')
            .limit(20),
          `${effectiveRole}_upcoming_assignments`
        )
      : [],
    safeRows(
      db
        .from('ltch_submissions')
        .select('id,assignment_id,uid,status,stored_at,created_at,feedback')
        .in('uid', targetUids)
        .eq('status', 'stored')
        .order('stored_at', { ascending: false })
        .limit(100),
      `${effectiveRole}_submissions`
    ),
    classIds.length
      ? safeRows(
          db
            .from('ltch_attendance')
            .select('class_id,student_uid,lesson_date,status,note,updated_at')
            .in('student_uid', targetUids)
            .in('class_id', classIds)
            .order('lesson_date', { ascending: false })
            .limit(60),
          `${effectiveRole}_attendance`
        )
      : [],
    safeSelectWithFallback(
      cols =>
        db
          .from('ltch_practice_attempts')
          .select(cols)
          .in('uid', targetUids)
          .order('submitted_at', { ascending: false })
          .limit(30),
      'id,exam_id,uid,submitted_at,score,max_score,status,is_preview',
      'id,exam_id,uid,submitted_at,score,max_score',
      `${effectiveRole}_practice_attempts`
    ),
    classIds.length
      ? safeRows(
          db
            .from('ltch_lessons')
            .select('id,class_id,title,topic,created_at')
            .in('class_id', classIds)
            .order('created_at', { ascending: false })
            .limit(80),
          `${effectiveRole}_lessons`
        )
      : [],
    classIds.length
      ? safeRows(
          db
            .from('ltch_lesson_files')
            .select('id,lesson_id,class_id,name,content_type,created_at')
            .in('class_id', classIds)
            .eq('status', 'stored')
            .order('created_at', { ascending: false })
            .limit(200),
          `${effectiveRole}_lesson_files`
        )
      : [],
    isParent
      ? safeRows(
          db.from('ltch_accounts').select('uid,display_name,student_code').in('uid', targetUids).limit(10),
          'parent_child_accounts'
        )
      : [],
    !isParent && classIds.length
      ? safeRows(
          db
            .from('ltch_forum_posts')
            .select('id,class_id,author_uid,title,body,created_at')
            .in('class_id', classIds)
            .order('created_at', { ascending: false })
            .limit(20),
          'student_forum_posts'
        )
      : []
  ]);

  const upcomingMap = new Map(upcomingAssignments.map(a => [a.id, a]));
  const latestSubs = deduplicateLatestSubmissions(
    submissionsRaw,
    s => (s?.assignment_id && s?.uid ? `${s.assignment_id}:${s.uid}` : null)
  ).map(s => {
    const decoded = decodeSubmissionRecord(s);
    return {
      ...s,
      feedbackText: decoded.feedback,
      ts: Number(s.stored_at || s.created_at || 0)
    };
  });
  latestSubs.sort((a, b) => b.ts - a.ts);

  const extraAssignmentIds = [
    ...new Set(
      latestSubs
        .filter(s => s.feedbackText && !upcomingMap.has(s.assignment_id))
        .map(s => s.assignment_id)
        .filter(Boolean)
    )
  ].slice(0, 20);

  const practiceSummary = summarizePracticeAttempts(attemptsRaw);
  const examIds = [...new Set(practiceSummary.validRows.map(a => a.exam_id).filter(Boolean))].slice(0, 30);

  const studentForumPostIds = !isParent ? studentForumPosts.map(p => p.id).filter(Boolean) : [];
  const studentForumAuthorUids = !isParent ? [...new Set(studentForumPosts.map(p => p.author_uid).filter(Boolean))].slice(0, 30) : [];

  const [extraAssignments, examRows, studentForumComments, studentForumAuthors] = await Promise.all([
    extraAssignmentIds.length
      ? safeRows(
          db
            .from('ltch_assignments')
            .select('id,class_id,title,instructions')
            .in('id', extraAssignmentIds)
            .limit(20),
          `${effectiveRole}_extra_assignments`
        )
      : [],
    examIds.length
      ? safeSelectWithFallback(
          cols => db.from('ltch_exams').select(cols).in('id', examIds).limit(30),
          'id,class_id,title,exam_type',
          'id,class_id,title',
          `${effectiveRole}_exams`
        )
      : [],
    studentForumPostIds.length
      ? safeRows(
          db
            .from('ltch_forum_comments')
            .select('id,post_id,author_uid,created_at')
            .in('post_id', studentForumPostIds)
            .limit(200),
          'student_forum_comments'
        )
      : [],
    studentForumAuthorUids.length
      ? safeRows(
          db
            .from('ltch_accounts')
            .select('uid,display_name')
            .in('uid', studentForumAuthorUids)
            .limit(30),
          'student_forum_authors'
        )
      : []
  ]);

  const fullAssignmentMap = new Map(upcomingMap);
  for (const a of extraAssignments) {
    if (a?.id) fullAssignmentMap.set(a.id, a);
  }
  const examMap = new Map(examRows.map(e => [e.id, e]));
  const childNameMap = new Map(childAccounts.map(a => [a.uid, a.display_name || 'Học sinh']));

  const assignmentStatus = {};
  for (const a of upcomingAssignments) {
    const matching = latestSubs.filter(s => s.assignment_id === a.id);
    if (!matching.length) {
      assignmentStatus[a.id] = { status: 'missing', storedAt: null, feedbackPreview: '' };
    } else {
      const graded = matching.find(s => Boolean(s.feedbackText));
      const picked = graded || matching[0];
      assignmentStatus[a.id] = {
        status: picked.feedbackText ? 'graded' : 'submitted',
        storedAt: picked.ts || null,
        feedbackPreview: picked.feedbackText ? truncateText(picked.feedbackText, 120) : '',
        ...(isParent ? { studentName: childNameMap.get(picked.uid) || 'Học sinh' } : {})
      };
    }
  }

  let submittedOpen = 0;
  let pendingOpen = 0;
  for (const a of upcomingAssignments) {
    const st = assignmentStatus[a.id]?.status;
    if (st === 'submitted' || st === 'graded') submittedOpen++;
    else pendingOpen++;
  }
  const gradedTotal = latestSubs.filter(s => Boolean(s.feedbackText)).length;

  const attendanceSummary = summarizeAttendanceRows(attendanceRows);
  const recentAttendance = attendanceRows.slice(0, isParent ? 6 : 5).map(r => ({
    lessonDate: r.lesson_date,
    classId: r.class_id,
    className: classMap.get(r.class_id)?.name || 'Lớp học',
    status: r.status,
    note: truncateText(r.note, 100),
    ...(isParent ? { studentName: childNameMap.get(r.student_uid) || 'Học sinh' } : {})
  }));

  // Group stored lesson files by lesson
  const filesByLesson = new Map();
  for (const f of lessonFiles) {
    if (!f?.lesson_id) continue;
    if (!filesByLesson.has(f.lesson_id)) filesByLesson.set(f.lesson_id, []);
    filesByLesson.get(f.lesson_id).push(f);
  }
  const recentLessons = [];
  for (const l of lessons) {
    const attached = filesByLesson.get(l.id) || [];
    if (!attached.length) continue;
    let videoCount = 0;
    let docCount = 0;
    let latestFileAt = Number(l.created_at || 0);
    for (const f of attached) {
      if (String(f.content_type || '').toLowerCase().startsWith('video/')) videoCount++;
      else docCount++;
      const fTs = Number(f.created_at || 0);
      if (fTs > latestFileAt) latestFileAt = fTs;
    }
    const parsedTitle = parseSessionLessonTitle(l.title || '');
    recentLessons.push({
      lessonId: l.id,
      classId: l.class_id,
      className: classMap.get(l.class_id)?.name || 'Lớp học',
      title: l.title || 'Buổi học',
      sessionNumber: parsedTitle.sessionNumber || null,
      videoCount,
      docCount,
      latestFileAt
    });
  }
  recentLessons.sort((a, b) => b.latestFileAt - a.latestFileAt);

  const recentFeedback = latestSubs
    .filter(s => Boolean(s.feedbackText))
    .slice(0, 4)
    .map(s => {
      const a = fullAssignmentMap.get(s.assignment_id);
      const classId = a?.class_id || null;
      return {
        assignmentId: s.assignment_id,
        classId,
        className: classId ? classMap.get(classId)?.name || 'Lớp học' : 'Lớp học',
        assignmentTitle: a?.title || 'Bài tập về nhà',
        sessionNumber: a ? extractSessionNumFromAssignment(a) : null,
        feedbackPreview: truncateText(s.feedbackText, 140),
        storedAt: s.ts,
        ...(isParent ? { studentName: childNameMap.get(s.uid) || 'Học sinh' } : {})
      };
    });

  const sortedValidAttempts = [...practiceSummary.validRows].sort(
    (a, b) => Number(b.submitted_at || 0) - Number(a.submitted_at || 0)
  );
  const recentPractice = sortedValidAttempts.slice(0, 4).map(att => {
    const ex = examMap.get(att.exam_id);
    return {
      attemptId: att.id,
      examId: att.exam_id,
      examTitle: ex?.title || 'Đề luyện tập',
      examType: ex?.exam_type || 'class',
      classId: ex?.class_id || null,
      score: Number(att.score),
      maxScore: Number(att.max_score),
      submittedAt: Number(att.submitted_at || 0),
      ...(isParent ? { studentName: childNameMap.get(att.uid) || 'Học sinh' } : {})
    };
  });

  const latestAttempt = recentPractice[0] || null;
  const topLesson = recentLessons[0] || null;

  let recentForumPosts;
  let forumKpi;
  if (!isParent) {
    const forumAuthorMap = new Map(studentForumAuthors.map(a => [a.uid, a.display_name || 'Thành viên']));
    const commentsByPost = new Map();
    for (const c of studentForumComments) {
      if (!c?.post_id) continue;
      if (!commentsByPost.has(c.post_id)) commentsByPost.set(c.post_id, []);
      commentsByPost.get(c.post_id).push(c);
    }
    let openCount = 0;
    let myPostsCount = 0;
    let myAnsweredCount = 0;
    const mappedPosts = studentForumPosts.map(p => {
      const meta = decodeForumPostMeta(p.body || '', p.title || '');
      const postComments = commentsByPost.get(p.id) || [];
      const commentCount = postComments.length;
      const isMine = p.author_uid === actor?.uid;
      const isSolved = Boolean(meta.resolved || meta.acceptedCommentId);
      if (!isSolved) openCount++;
      if (isMine) {
        myPostsCount++;
        if (isSolved || commentCount > 0) myAnsweredCount++;
      }
      let latestActivityAt = Number(p.created_at || 0);
      for (const c of postComments) {
        const ts = Number(c.created_at || 0);
        if (ts > latestActivityAt) latestActivityAt = ts;
      }
      return {
        postId: p.id,
        classId: p.class_id,
        className: classMap.get(p.class_id)?.name || 'Lớp học',
        title: p.title || 'Câu hỏi thảo luận',
        authorName: forumAuthorMap.get(p.author_uid) || 'Thành viên',
        isMine,
        category: meta.category,
        sessionNumber: meta.sessionNumber,
        resolved: isSolved,
        pinned: Boolean(meta.pinned),
        commentCount,
        createdAt: Number(p.created_at || 0),
        latestActivityAt,
        target: { classId: p.class_id, tab: 'forum', subPage: p.id }
      };
    });
    mappedPosts.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.latestActivityAt - a.latestActivityAt ||
        b.createdAt - a.createdAt
    );
    recentForumPosts = mappedPosts.slice(0, 4);
    forumKpi = {
      recentCount: studentForumPosts.length,
      openCount,
      myPostsCount,
      myAnsweredCount
    };
  }

  const childrenProfiles = isParent
    ? targetUids.map(uid => {
        const acct = childAccounts.find(a => a.uid === uid);
        const childClassIds = [...new Set((actor?.childMemberships || []).filter(m => m.uid === uid).map(m => m.class_id))];
        return {
          uid,
          name: acct?.display_name || 'Học sinh',
          studentCode: acct?.student_code || null,
          classIds: childClassIds,
          classNames: childClassIds.map(cid => classMap.get(cid)?.name).filter(Boolean)
        };
      })
    : undefined;

  return {
    assignments: upcomingAssignments,
    notices: [],
    dashboard: {
      role: effectiveRole,
      mode: effectiveRole,
      generatedAt: now,
      ...(isParent ? { children: childrenProfiles } : {}),
      kpis: {
        attendance: attendanceSummary,
        homework: {
          totalOpen: upcomingAssignments.length,
          submittedOpen,
          pendingOpen,
          gradedTotal
        },
        practice: {
          attemptCount: practiceSummary.count,
          avgScore10: practiceSummary.avgScore10,
          latestScore: latestAttempt ? latestAttempt.score : null,
          latestMaxScore: latestAttempt ? latestAttempt.maxScore : null,
          latestExamTitle: latestAttempt ? latestAttempt.examTitle : ''
        },
        materials: {
          lessonsWithFilesCount: recentLessons.length,
          latestLessonTitle: topLesson ? topLesson.title : '',
          latestSessionNumber: topLesson ? topLesson.sessionNumber : null,
          latestClassId: topLesson ? topLesson.classId : null
        },
        ...(!isParent ? { forum: forumKpi } : {}),
        gradedCount: gradedTotal
      },
      assignmentStatus,
      recentLessons: recentLessons.slice(0, 4),
      recentFeedback,
      recentPractice,
      recentAttendance,
      ...(!isParent ? { recentForumPosts } : {})
    }
  };
}

export async function readOverviewDashboard(db, actor, classes = [], { viewRole = '', now = Date.now() } = {}) {
  const effectiveRole = resolveEffectiveRole(actor, viewRole);
  const scopedClasses = scopeClassesForRole(actor, classes, effectiveRole);
  if (['admin', 'teacher', 'assistant'].includes(effectiveRole)) {
    return readStaffDashboard(db, actor, scopedClasses, effectiveRole, now);
  }
  return readLearnerDashboard(db, actor, scopedClasses, effectiveRole, now);
}

