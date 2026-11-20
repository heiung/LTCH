// Hệ thống Phòng luyện & Quản lý ngân hàng đề THPTQG · HSA · TSA cho Lớp Toán Cô Hạnh (LTCH)
import { randomUUID } from 'node:crypto';
import { ApiError, data, demand, id, isAdmin, staffCan, string } from './policy.mjs';
import { json, readJson } from './http.mjs';
import { missingPracticeImageIds, restorePracticeImages } from '../shared/practice-media.mjs';
import {
  attachSignedPracticeMediaUrls,
  clearPracticeDriveCaches,
  compactQuestionStub,
  hydrateQuestionsFromPack,
  isPracticeDriveConfigured,
  loadExamQuestionsFromDrive,
  savePracticeExamPackToDrive,
  stagePracticeDriveAssets,
  trashPracticeExamOnDrive
} from './practice-drive.mjs';
import { configuredDrive } from './lesson-storage.mjs';
import {
  HSA_COMBINATIONS,
  checkExamStructure,
  projectVisibleQuestion,
  validateQuestions
} from './questions.mjs';
import { classGrade } from '../shared/classroom.mjs';
import practiceEngine from '../public/practice-engine.js';

const { scoreQuestion, roundScore } = practiceEngine;

export const EXAM_TYPES = ['thptqg', 'hsa', 'tsa'];
export const GRACE_PERIOD_MS = 10_000; // 10 giây ân hạn mạng khi hết giờ
export const HSA_WAIT_SECONDS = 120; // 120 giây màn hình chờ chuyển phần HSA

export const EXAM_SECTION_CONFIG = {
  thptqg: [
    { key: 'part_1', title: 'Phần I. Trắc nghiệm 4 phương án', durationMinutes: 90, questionCount: 12 },
    { key: 'part_2', title: 'Phần II. Trắc nghiệm Đúng/Sai', durationMinutes: 90, questionCount: 4 },
    { key: 'part_3', title: 'Phần III. Trả lời ngắn', durationMinutes: 90, questionCount: 6 }
  ],
  hsa: [
    { key: 'part_1', title: 'Phần 1: Toán học & Xử lý số liệu', durationMinutes: 75, questionCount: 50 },
    { key: 'part_2', title: 'Phần 2: Ngôn ngữ - Văn học', durationMinutes: 60, questionCount: 50 },
    { key: 'part_3', title: 'Phần 3: Khoa học / Tiếng Anh', durationMinutes: 60, questionCount: 50 }
  ],
  tsa: [
    { key: 'part_1', title: 'Phần 1: Tư duy Toán học', durationMinutes: 60, questionCount: 40 },
    { key: 'part_2', title: 'Phần 2: Tư duy Đọc hiểu', durationMinutes: 30, questionCount: 20 },
    { key: 'part_3', title: 'Phần 3: Tư duy Khoa học / Giải quyết vấn đề', durationMinutes: 60, questionCount: 40 }
  ]
};

export function resolveClassGradeNumber(klass) {
  if (Number.isInteger(klass?.grade) && klass.grade >= 6 && klass.grade <= 12) {
    return klass.grade;
  }
  const parsed = Number(classGrade(klass?.name || ''));
  return Number.isInteger(parsed) && parsed >= 6 && parsed <= 12 ? parsed : null;
}

export function isMissingSchemaError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703', '42883'].includes(code)) return true;
  const msg = String(error.message || error.details || '');
  return /schema cache|does not exist|Could not find the/i.test(msg);
}

export function matchesPracticeGradePool(exam, grade) {
  const g = Number(grade);
  if (![10, 11, 12].includes(g)) return true;
  const type = String(exam?.examType ?? exam?.exam_type ?? '').toLowerCase();
  if (type === 'tsa') return g === 11 || g === 12;
  return (Number(exam?.targetGrade ?? exam?.target_grade) || 12) === g;
}

export function canManagePracticePool(actor, activeClasses = [], examType, targetGrade = null) {
  if (!actor || actor.status !== 'active' || !Array.isArray(actor.roles)) return false;
  if (isAdmin(actor) || actor.roles.includes('teacher')) return true;
  if (!actor.roles.includes('assistant')) return false;

  const manageableGrades = new Set();
  for (const c of activeClasses) {
    if (c.archived) continue;
    if (staffCan(actor, c.id, 'practice.manage')) {
      const g = resolveClassGradeNumber(c);
      if (g) manageableGrades.add(g);
    }
  }

  const normType = String(examType || '').toLowerCase();
  if (normType === 'thptqg') {
    const g = Number(targetGrade);
    if ([10, 11, 12].includes(g)) return manageableGrades.has(g);
    return [10, 11, 12].some((x) => manageableGrades.has(x));
  }
  if (normType === 'hsa') {
    return manageableGrades.has(12);
  }
  if (normType === 'tsa') {
    return manageableGrades.has(11) || manageableGrades.has(12);
  }
  return false;
}

export function computeManageablePools(actor, activeClasses = []) {
  return {
    thptqg_10: canManagePracticePool(actor, activeClasses, 'thptqg', 10),
    thptqg_11: canManagePracticePool(actor, activeClasses, 'thptqg', 11),
    thptqg_12: canManagePracticePool(actor, activeClasses, 'thptqg', 12),
    hsa: canManagePracticePool(actor, activeClasses, 'hsa', 12),
    tsa: canManagePracticePool(actor, activeClasses, 'tsa', 12)
  };
}

export async function computePracticeAccess(db, actor) {
  const [classesRes, yearsRes] = await Promise.all([
    db.from('ltch_classes').select('*').limit(300),
    db.from('ltch_school_years').select('*').order('starts_on', { ascending: false }).limit(50)
  ]);
  const allClasses = data(classesRes) || [];
  const schoolYears = data(yearsRes) || [];
  const activeClasses = allClasses.filter((c) => !c.archived);
  const classById = new Map(allClasses.map((c) => [c.id, c]));

  const currentSchoolYear =
    schoolYears.find((y) => activeClasses.some((c) => c.school_year_id === y.id)) ||
    schoolYears[0] || { id: 'year-2026-2027', name: '2026 - 2027', starts_on: '2026-08-01', ends_on: '2027-06-30' };
  const examYear = Number(String(currentSchoolYear.ends_on || '2027-06-30').slice(0, 4)) || 2027;

  const roles = Array.isArray(actor?.roles) ? actor.roles : [];
  const isStaff = roles.some((r) => ['admin', 'teacher', 'assistant'].includes(r));
  const manageablePools = computeManageablePools(actor, activeClasses);
  const canManageAny = Object.values(manageablePools).some(Boolean);

  // Tìm danh sách học sinh mục tiêu (chính học sinh đó hoặc con của phụ huynh)
  const studentMemberships = (actor?.memberships || []).filter(
    (m) => m.member_role === 'student' && (m.status === 'active' || !m.status)
  );
  const childMemberships = (actor?.childMemberships || []).filter(
    (m) => m.member_role === 'student' && (m.status === 'active' || !m.status)
  );
  const effectiveStudentMemberships = studentMemberships.length ? studentMemberships : childMemberships;

  const activeGradesSet = new Set();
  const archivedGradesSet = new Set();
  const archivedPools = [];

  for (const m of effectiveStudentMemberships) {
    const klass = classById.get(m.class_id);
    if (!klass) continue;
    const g = resolveClassGradeNumber(klass);
    if (!g) continue;
    if (klass.archived) {
      archivedGradesSet.add(g);
      archivedPools.push({
        grade: g,
        schoolYearId: klass.school_year_id,
        classId: klass.id,
        className: klass.name
      });
    } else {
      activeGradesSet.add(g);
    }
  }

  const histRes = await db
      .from('ltch_student_grade_history')
      .select('*')
      .eq('uid', actor.uid)
      .order('grade', { ascending: true });
  const historyRows = isMissingSchemaError(histRes?.error) ? [] : (data(histRes) || []);

  for (const h of historyRows) {
    if (Number.isInteger(h.grade)) {
      archivedGradesSet.add(h.grade);
      if (!archivedPools.some((p) => p.grade === h.grade && p.schoolYearId === h.school_year_id)) {
        archivedPools.push({
          grade: h.grade,
          schoolYearId: h.school_year_id,
          classId: h.class_id || null
        });
      }
    }
  }

  const activeGrades = [...activeGradesSet].sort((a, b) => a - b);
  const maxActiveGrade = activeGrades.length ? Math.max(...activeGrades) : null;
  const isAlumni = !isStaff && activeGrades.length === 0 && archivedGradesSet.has(12);

  const isTeacher = roles.includes('teacher');
  const staffGradesSet = new Set();
  const allowedRoomsSet = new Set();
  if (isStaff) {
    if (isAdmin(actor) || isTeacher) {
      allowedRoomsSet.add('thptqg');
      allowedRoomsSet.add('hsa');
      allowedRoomsSet.add('tsa');
      staffGradesSet.add(10);
      staffGradesSet.add(11);
      staffGradesSet.add(12);
    } else {
      for (const g of [10, 11, 12]) {
        if (manageablePools[`thptqg_${g}`]) {
          allowedRoomsSet.add('thptqg');
          staffGradesSet.add(g);
        }
      }
      if (manageablePools.hsa) {
        allowedRoomsSet.add('hsa');
        staffGradesSet.add(12);
      }
      if (manageablePools.tsa) allowedRoomsSet.add('tsa');
      // Cho phép trợ giảng xem sảnh nếu thuộc lớp THPT đang hoạt động
      for (const m of actor?.memberships || []) {
        if (m.status && m.status !== 'active') continue;
        const c = classById.get(m.class_id);
        if (!c || c.archived) continue;
        const g = resolveClassGradeNumber(c);
        if (g === 10) {
          allowedRoomsSet.add('thptqg');
          staffGradesSet.add(10);
        }
        if (g === 11) {
          allowedRoomsSet.add('thptqg');
          allowedRoomsSet.add('tsa');
          staffGradesSet.add(11);
        }
        if (g === 12) {
          allowedRoomsSet.add('thptqg');
          allowedRoomsSet.add('hsa');
          allowedRoomsSet.add('tsa');
          staffGradesSet.add(12);
        }
      }
    }
  } else if (!isAlumni) {
    for (const g of activeGrades) {
      if (g === 10) allowedRoomsSet.add('thptqg');
      if (g === 11) {
        allowedRoomsSet.add('thptqg');
        allowedRoomsSet.add('tsa');
      }
      if (g === 12) {
        allowedRoomsSet.add('thptqg');
        allowedRoomsSet.add('hsa');
        allowedRoomsSet.add('tsa');
      }
    }
  }
  const staffGrades = [...staffGradesSet].sort((a, b) => a - b);

  // Kho đã học: chỉ chứa các khối nhỏ hơn khối đang theo học hiện tại
  const pastGradePools = maxActiveGrade
    ? archivedPools.filter((p) => p.grade >= 10 && p.grade < maxActiveGrade)
    : [];

  let accountInfo = { displayName: actor.display_name || actor.email || actor.uid, studentCode: actor.student_code || null };
  {
    const accRes = await db
      .from('ltch_accounts')
      .select('display_name,student_code')
      .eq('uid', actor.uid)
      .maybeSingle();
    const account = isMissingSchemaError(accRes?.error) ? null : data(accRes);
    if (account) {
      accountInfo = {
        displayName: account.display_name || accountInfo.displayName,
        studentCode: account.student_code || accountInfo.studentCode
      };
    }
  }

  return {
    isAdmin: isAdmin(actor),
    isTeacher,
    isStaff,
    canManageAny,
    isStudent: roles.includes('student'),
    isAlumni,
    activeGrades,
    staffGrades,
    allowedRooms: [...allowedRoomsSet],
    pastGradePools,
    manageablePools,
    currentSchoolYearId: currentSchoolYear.id,
    currentSchoolYearName: currentSchoolYear.name,
    examYear,
    schoolYears,
    activeClasses,
    displayName: accountInfo.displayName,
    studentCode: accountInfo.studentCode
  };
}

// Trộn câu hỏi bảo toàn cụm ngữ liệu (Cluster-aware shuffle)
export function shuffleArray(items, rng = Math.random) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getQuestionPassageClusterKey(q) {
  if (!q || typeof q !== 'object') return null;
  const sec = String(q.section || 'part_1');
  const subj = String(q.subject || '');
  if (q.clusterId) return `cid:${sec}:${subj}:${q.clusterId}`;
  if (q.passageId) return `pid:${sec}:${subj}:${q.passageId}`;
  const rawPassage = typeof q.passageContent === 'string' ? q.passageContent.trim() : '';
  if (rawPassage) {
    return `ptxt:${sec}:${subj}:${rawPassage.slice(0, 160)}`;
  }
  return null;
}

export function rewritePassageQuestionNumbers(passageText, clusterNumbers, passageIndex = 0) {
  if (!passageText || typeof passageText !== 'string' || !Array.isArray(clusterNumbers) || !clusterNumbers.length) {
    return passageText;
  }
  const first = clusterNumbers[0];
  const last = clusterNumbers[clusterNumbers.length - 1];
  let out = passageText;

  if (passageIndex >= 1) {
    out = out.replace(
      /^(\s*(?:<[^>]+>\s*)*Reading\s+comprehension\s+)\d+/i,
      (_, p1) => `${p1}${passageIndex}`
    );
  }

  out = out.replace(
    /(trả\s+lời(?:\s+cho)?\s+các\s+câu(?:\s+hỏi)?(?:\s+sau)?\s+)\d+(?:\s*,\s*\d+)+/gi,
    (_, p1) => `${p1}${clusterNumbers.join(', ')}`
  );

  out = out.replace(
    /((?:trả\s+lời(?:\s+cho)?\s+)?(?:các\s+)?câu(?:\s+hỏi)?(?:\s+sau)?\s+từ(?:\s+câu)?\s+)\d+(\s*(?:[-–—]|đến|tới)(?:\s+câu)?\s*)\d+/gi,
    (_, p1, sep) => (first === last ? `${p1}${first}` : `${p1}${first}${sep}${last}`)
  );

  out = out.replace(
    /(^\s*(?:<[^>]+>\s*)*câu(?:\s+hỏi)?\s+)\d+(\s*(?:[-–—]|đến|tới)(?:\s+câu)?\s*)\d+/gim,
    (_, p1, sep) => (first === last ? `${p1}${first}` : `${p1}${first}${sep}${last}`)
  );

  out = out.replace(
    /((?:answer\s+(?:each\s+question|the\s+questions|questions?)|questions?)\s+from\s+)\d+(\s*(?:to|[-–—])\s*)\d+/gi,
    (_, p1, sep) => (first === last ? `${p1}${first}` : `${p1}${first}${sep}${last}`)
  );

  out = out.replace(
    /(\bquestions?\s+)\d+(\s*(?:to|[-–—])\s*)\d+/gi,
    (_, p1, sep) => (first === last ? `${p1}${first}` : `${p1}${first}${sep}${last}`)
  );

  return out;
}

export function sanitizeQuestionPromptNumberPrefix(promptText) {
  if (!promptText || typeof promptText !== 'string') return promptText;
  return promptText.replace(
    /^(\s*(?:<(?:strong|b|em|i|u)>\s*)*)(?:Câu(?:\s+hỏi)?|Question)\s+\d+\s*[.:](\s*(?:<\/(?:strong|b|em|i|u)>\s*)*)\s*/i,
    (full, openTags, closeTags) => {
      const openCount = (openTags.match(/</g) || []).length;
      const closeCount = (closeTags.match(/<\//g) || []).length;
      return openCount === closeCount ? '' : openTags;
    }
  );
}

export function renumberShuffledExamQuestions(questions, { examType = 'thptqg', practiceMode = null } = {}) {
  if (!Array.isArray(questions) || !questions.length) return [];
  const normType = String(examType || 'thptqg').toLowerCase();
  const distinctSections = new Set(questions.map((q) => q?.section || 'part_1'));
  const hasHighHsaDisplayNum =
    normType === 'hsa' && questions.some((q) => Number(q?.displayNumber) >= 51);
  const isFullHsa =
    normType === 'hsa' &&
    (practiceMode === 'full' || distinctSections.size > 1 || hasHighHsaDisplayNum);

  const secOffsets = {
    part_1: 1,
    part_2: isFullHsa ? 51 : 1,
    part_3: isFullHsa ? 101 : 1
  };
  const secCounts = { part_1: 0, part_2: 0, part_3: 0 };
  let globalCounter = 1;

  const out = questions.map((q) => {
    if (!q || typeof q !== 'object') return q;
    const sec = q.section || 'part_1';
    let displayNumber;
    if (normType === 'thptqg') {
      displayNumber = globalCounter++;
    } else {
      const base = secOffsets[sec] || 1;
      const offset = secCounts[sec] || 0;
      secCounts[sec] = offset + 1;
      displayNumber = base + offset;
    }
    const nextQ = {
      ...q,
      section: sec,
      displayNumber
    };
    if (typeof nextQ.prompt === 'string' && nextQ.prompt) {
      nextQ.prompt = sanitizeQuestionPromptNumberPrefix(nextQ.prompt);
    }
    return nextQ;
  });

  const clusterGroups = new Map();
  let syntheticClusterSeq = 0;
  for (const q of out) {
    if (!q || typeof q !== 'object') continue;
    const cKey = getQuestionPassageClusterKey(q);
    if (!cKey) continue;
    if (!clusterGroups.has(cKey)) {
      syntheticClusterSeq++;
      clusterGroups.set(cKey, {
        seq: syntheticClusterSeq,
        secSubjKey: `${q.section || 'part_1'}:${q.subject || ''}`,
        items: []
      });
    }
    clusterGroups.get(cKey).items.push(q);
  }

  const passageCountByScope = new Map();
  for (const group of clusterGroups.values()) {
    const scopeIdx = (passageCountByScope.get(group.secSubjKey) || 0) + 1;
    passageCountByScope.set(group.secSubjKey, scopeIdx);
    const nums = group.items.map((item) => item.displayNumber);
    const sharedPassageId =
      group.items.find((item) => item.passageId)?.passageId || `passage_auto_${group.seq}`;
    const sharedClusterId =
      group.items.find((item) => item.clusterId)?.clusterId || `cluster_auto_${group.seq}`;

    for (const item of group.items) {
      if (!item.passageId && item.passageContent) item.passageId = sharedPassageId;
      if (!item.clusterId && item.passageContent) item.clusterId = sharedClusterId;
      if (typeof item.passageContent === 'string' && item.passageContent) {
        item.passageContent = rewritePassageQuestionNumbers(item.passageContent, nums, scopeIdx);
      }
    }
  }

  return out;
}

export function shuffleUnitsPreservingClusters(questions, rng = Math.random) {
  const units = [];
  const clusterMap = new Map();

  for (const q of questions) {
    const clusterKey = getQuestionPassageClusterKey(q);
    if (!clusterKey) {
      units.push([q]);
    } else if (clusterMap.has(clusterKey)) {
      clusterMap.get(clusterKey).push(q);
    } else {
      const group = [q];
      clusterMap.set(clusterKey, group);
      units.push(group);
    }
  }

  for (const unit of units) {
    if (unit.length > 1) {
      unit.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    }
  }

  return shuffleArray(units, rng).flat();
}

export function selectAndShuffleSectionQuestions(examType, allQuestions, sectionKey, options = {}) {
  const rng = options.rng || Math.random;
  const normType = String(examType || 'thptqg').toLowerCase();

  if (normType === 'thptqg') {
    const sections = ['part_1', 'part_2', 'part_3'];
    const out = [];
    for (const sec of sections) {
      if (sectionKey && sectionKey !== 'all' && sec !== sectionKey) continue;
      const inSec = allQuestions.filter((q) => (q.section || 'part_1') === sec);
      const shuffled = shuffleUnitsPreservingClusters(inSec, rng);
      for (const q of shuffled) {
        out.push({ ...q, section: sec });
      }
    }
    return renumberShuffledExamQuestions(out, {
      examType: 'thptqg',
      practiceMode: options.practiceMode || 'full'
    });
  }

  if (normType === 'hsa' && sectionKey === 'part_3') {
    const comboCode = String(options.selectedCombination || 'Q01').trim();
    const inPart3 = allQuestions.filter((q) => (q.section || 'part_3') === 'part_3');

    if (comboCode.toLowerCase() === 'english') {
      const engQuestions = inPart3.filter((q) => (q.subject || '').toLowerCase() === 'english');
      const source = engQuestions.length ? engQuestions : inPart3;
      const shuffled = shuffleUnitsPreservingClusters(source, rng)
        .slice(0, 50)
        .map((q) => ({ ...q, section: 'part_3' }));
      return renumberShuffledExamQuestions(shuffled, {
        examType: 'hsa',
        practiceMode: options.practiceMode
      });
    }

    const comboEntry =
      HSA_COMBINATIONS.find((c) => c.code.toUpperCase() === comboCode.toUpperCase()) ||
      HSA_COMBINATIONS[0];
    const subjects = comboEntry.subjects;
    const bySubj = subjects.map((subj) => ({
      subj,
      list: inPart3.filter((q) => (q.subject || '').toLowerCase() === subj)
    }));

    const totalRaw = bySubj.reduce((acc, s) => acc + s.list.length, 0);
    // Nếu tổng số câu của 3 môn > 50 (chuẩn 3 × 17 = 51 câu), loại ngẫu nhiên 1 câu đơn lẻ để còn 50 câu
    let dropSubj = null;
    if (totalRaw > 50) {
      const candidates = bySubj.filter((s) => s.list.some((q) => !getQuestionPassageClusterKey(q)));
      if (candidates.length > 0) {
        dropSubj = candidates[Math.floor(rng() * candidates.length)].subj;
      }
    }

    const out = [];
    for (let sIdx = 0; sIdx < bySubj.length; sIdx++) {
      const { subj, list } = bySubj[sIdx];
      let pool = [...list];
      if (subj === dropSubj) {
        const standaloneIndices = pool
          .map((q, i) => (!getQuestionPassageClusterKey(q) ? i : -1))
          .filter((i) => i >= 0);
        if (standaloneIndices.length > 0) {
          const dropIndex = standaloneIndices[Math.floor(rng() * standaloneIndices.length)];
          pool.splice(dropIndex, 1);
        }
      }
      const shuffled = shuffleUnitsPreservingClusters(pool, rng);
      shuffled.forEach((q) => {
        out.push({
          ...q,
          section: 'part_3',
          subject: subj
        });
      });
    }
    return renumberShuffledExamQuestions(out, {
      examType: 'hsa',
      practiceMode: options.practiceMode
    });
  }

  // HSA Phần 1, 2 hoặc TSA Phần 1, 2, 3
  const inSec = allQuestions
    .filter((q) => (q.section || 'part_1') === sectionKey)
    .map((q) => ({ ...q, section: sectionKey }));
  const shuffled = shuffleUnitsPreservingClusters(inSec, rng);
  return renumberShuffledExamQuestions(shuffled, {
    examType: normType,
    practiceMode: options.practiceMode
  });
}

export function gradeAttemptQuestions(attemptQuestions = [], responses = {}) {
  let score = 0;
  let max = 0;
  const results = [];
  const bySection = {};

  for (const q of attemptQuestions) {
    const r = scoreQuestion(q, responses?.[q.id]);
    const earned = Number(r.score ?? 0);
    const maxPts = Number(r.max ?? q.points ?? 1);
    score = roundScore(score + earned);
    max = roundScore(max + maxPts);
    const secKey = q.section || 'part_1';
    if (!bySection[secKey]) {
      bySection[secKey] = {
        section: secKey,
        total: 0,
        answered: 0,
        correct: 0,
        wrong: 0,
        skipped: 0,
        earned: 0,
        max: 0
      };
    }
    const secStat = bySection[secKey];
    secStat.total += 1;
    secStat.max = roundScore(secStat.max + maxPts);
    secStat.earned = roundScore(secStat.earned + earned);

    const rawResp = responses?.[q.id];
    const isAnswered =
      rawResp !== undefined &&
      rawResp !== null &&
      rawResp !== '' &&
      !(Array.isArray(rawResp) && rawResp.every((v) => v === null || v === undefined || v === '')) &&
      !(typeof rawResp === 'object' && !Array.isArray(rawResp) && Object.values(rawResp).every((v) => !v));

    if (!isAnswered) {
      secStat.skipped += 1;
    } else if (r.correct) {
      secStat.correct += 1;
      secStat.answered += 1;
    } else {
      secStat.wrong += 1;
      secStat.answered += 1;
    }

    results.push({
      id: q.id,
      ...r,
      earned,
      points: maxPts,
      displayNumber: q.displayNumber || q.order || results.length + 1,
      section: secKey,
      subject: q.subject || '',
      type: q.type,
      questionCode: q.questionCode || q.question_code || null,
      answered: isAnswered
    });
  }

  return {
    score,
    max,
    results,
    sectionSummary: Object.values(bySection)
  };
}

export function projectSolutionQuestion(q) {
  return {
    id: q.id,
    displayNumber: q.displayNumber || q.order || 1,
    questionCode: q.questionCode || q.question_code || null,
    version: q.version || 1,
    section: q.section || 'part_1',
    subject: q.subject || '',
    clusterId: q.clusterId || null,
    passageId: q.passageId || null,
    passageContent: q.passageContent || '',
    passageMedia: q.passageMedia || [],
    type: q.type,
    prompt: q.prompt,
    points: q.points,
    options: q.options || undefined,
    statements: q.statements || undefined,
    blanks: q.blanks || undefined,
    cards: q.cards || undefined,
    answer: q.answer !== undefined ? q.answer : undefined,
    answers: q.answers !== undefined ? q.answers : undefined,
    accepted: q.accepted !== undefined ? q.accepted : undefined,
    solution: q.solution || '',
    media: q.media || []
  };
}

export function normalizeExamRow(row) {
  if (!row || typeof row !== 'object') return null;
  const rawQuestions = Array.isArray(row.questions) ? row.questions : [];
  const meta =
    rawQuestions[0] && typeof rawQuestions[0]._examMeta === 'object' && rawQuestions[0]._examMeta
      ? rawQuestions[0]._examMeta
      : {};
  let inferredType = row.exam_type || meta.examType || '';
  if (!inferredType && typeof row.id === 'string') {
    const m = /^exam_(thptqg|hsa|tsa)_/i.exec(row.id);
    if (m) inferredType = m[1].toLowerCase();
  }
  const examType = String(inferredType || '').toLowerCase();
  const cleanQuestions = rawQuestions.map((q, idx) => {
    if (idx === 0 && q && typeof q === 'object' && '_examMeta' in q) {
      const { _examMeta, ...rest } = q;
      return rest;
    }
    return q;
  });
  return {
    ...row,
    exam_type: examType,
    exam_code: row.exam_code ?? meta.examCode ?? '01',
    exam_mode: row.exam_mode ?? meta.examMode ?? 'full',
    target_grade: Number(row.target_grade ?? meta.targetGrade ?? 12) || 12,
    school_year_id: row.school_year_id ?? meta.schoolYearId ?? null,
    duration_minutes:
      Number(row.duration_minutes ?? meta.durationMinutes) ||
      (examType === 'thptqg' ? 90 : examType === 'hsa' ? 195 : 150),
    section_config: row.section_config ?? row.sections ?? meta.sectionConfig ?? EXAM_SECTION_CONFIG[examType] ?? [],
    updated_at: row.updated_at ?? meta.updatedAt ?? row.opens_at,
    shared_school_year_ids: Array.isArray(meta.sharedSchoolYearIds) ? meta.sharedSchoolYearIds : [],
    questions: cleanQuestions,
    _examMeta: meta
  };
}

export function normalizeExamSummaryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const meta = row.exam_meta && typeof row.exam_meta === 'object' ? row.exam_meta : {};
  let inferredType = (row.exam_type && row.exam_type !== 'class' ? row.exam_type : '') || meta.examType || row.exam_type || '';
  if ((!inferredType || inferredType === 'class') && typeof row.id === 'string') {
    const m = /^exam_(thptqg|hsa|tsa)_/i.exec(row.id);
    if (m) inferredType = m[1].toLowerCase();
  }
  const examType = String(inferredType || '').toLowerCase();
  return {
    ...row,
    exam_type: examType,
    exam_code: row.exam_code ?? meta.examCode ?? '01',
    exam_mode: row.exam_mode ?? meta.examMode ?? 'full',
    target_grade: Number(row.target_grade ?? meta.targetGrade ?? 12) || 12,
    school_year_id: row.school_year_id ?? meta.schoolYearId ?? null,
    duration_minutes:
      Number(row.duration_minutes ?? meta.durationMinutes) ||
      (examType === 'thptqg' ? 90 : examType === 'hsa' ? 195 : 150),
    section_config: row.section_config ?? row.sections ?? meta.sectionConfig ?? EXAM_SECTION_CONFIG[examType] ?? [],
    updated_at: row.updated_at ?? meta.updatedAt ?? row.opens_at,
    shared_school_year_ids: Array.isArray(meta.sharedSchoolYearIds) ? meta.sharedSchoolYearIds : [],
    questions: [],
    _summaryCounts: {
      total: Number(row.total_questions) || 0,
      part_1: Number(row.part_1_count) || 0,
      part_2: Number(row.part_2_count) || 0,
      part_3: Number(row.part_3_count) || 0
    },
    _examMeta: meta
  };
}

export function attachExamMetaToQuestions(questions, examMeta) {
  const qs = Array.isArray(questions) ? questions : [];
  if (!qs.length) return qs;
  return qs.map((q, idx) => {
    if (idx === 0) {
      const { _examMeta, ...rest } = q || {};
      return { ...rest, _examMeta: examMeta };
    }
    if (q && typeof q === 'object' && '_examMeta' in q) {
      const { _examMeta, ...rest } = q;
      return rest;
    }
    return q;
  });
}

export async function resolveFallbackClassId(db, activeClasses = [], targetGrade = 12) {
  const list = Array.isArray(activeClasses) && activeClasses.length
    ? activeClasses
    : ((await db.from('ltch_classes').select('*').limit(50)).data || []);
  const byGrade = list.find((c) => resolveClassGradeNumber(c) === Number(targetGrade));
  if (byGrade?.id) return byGrade.id;
  if (list[0]?.id) return list[0].id;
  return 'class-12a';
}

function examPayload(examRow) {
  const prevMeta = (examRow.driveMeta && typeof examRow.driveMeta === 'object')
    ? examRow.driveMeta
    : (examRow._examMeta && typeof examRow._examMeta === 'object' ? examRow._examMeta : {});
  const driveMetaFields = prevMeta.storage === 'drive'
    ? {
        storage: 'drive',
        driveFolderId: prevMeta.driveFolderId || null,
        driveSourceFolderId: prevMeta.driveSourceFolderId || null,
        driveVideoFolderId: prevMeta.driveVideoFolderId || null,
        driveDocFolderId: prevMeta.driveDocFolderId || null,
        driveMediaFolderId: prevMeta.driveMediaFolderId || null,
        drivePackFileId: prevMeta.drivePackFileId || null,
        drivePackSha256: prevMeta.drivePackSha256 || null,
        drivePackSize: Number(prevMeta.drivePackSize) || 0,
        sourceFiles: Array.isArray(prevMeta.sourceFiles) ? prevMeta.sourceFiles : []
      }
    : {};
  const examMeta = {
    ...driveMetaFields,
    examType: examRow.exam_type,
    examCode: examRow.exam_code || '01',
    examMode: examRow.exam_mode || 'full',
    targetGrade: Number(examRow.target_grade) || 12,
    schoolYearId: examRow.school_year_id || null,
    durationMinutes: Number(examRow.duration_minutes) || 90,
    sectionConfig: examRow.section_config || EXAM_SECTION_CONFIG[examRow.exam_type] || [],
    updatedAt: examRow.updated_at || Date.now(),
    sharedSchoolYearIds: Array.isArray(examRow.shared_school_year_ids) ? examRow.shared_school_year_ids : []
  };
  const questionsWithMeta = attachExamMetaToQuestions(examRow.questions, examMeta);
  const now = Date.now();
  const opensAt = Number(examRow.opens_at) || now;
  const closesAt = Number(examRow.closes_at) > opensAt ? Number(examRow.closes_at) : opensAt + 365 * 86400_000;
  const payload = {
    id: examRow.id,
    class_id: examRow.class_id || null,
    title: examRow.title,
    status: examRow.status || 'draft',
    opens_at: opensAt,
    closes_at: closesAt,
    results_at: Number(examRow.results_at) || opensAt,
    solutions_at: Number(examRow.solutions_at) || opensAt,
    questions: questionsWithMeta,
    created_by: examRow.created_by,
    exam_type: examRow.exam_type,
    exam_code: examMeta.examCode,
    duration_minutes: examMeta.durationMinutes,
    sections: examMeta.sectionConfig,
    target_grade: examMeta.targetGrade,
    school_year_id: examMeta.schoolYearId,
    updated_at: examMeta.updatedAt
  };
  return payload;
}

async function saveExamFallbackToBaseTable(db, examRow, activeClasses = []) {
  const payload = examPayload(examRow);
  const classId = payload.class_id || (await resolveFallbackClassId(db, activeClasses, payload.target_grade));
  const midRes = await db.from('ltch_exams').upsert({ ...payload, class_id: classId });
  if (!isMissingSchemaError(midRes?.error)) {
    return midRes;
  }
  const baseRow = {
    id: payload.id,
    class_id: classId,
    title: payload.title,
    status: payload.status,
    opens_at: payload.opens_at,
    closes_at: payload.closes_at,
    results_at: payload.results_at,
    solutions_at: payload.solutions_at,
    questions: payload.questions,
    created_by: payload.created_by
  };
  return db.from('ltch_exams').upsert(baseRow);
}

export async function saveExamRowToDb(db, examRow, activeClasses = []) {
  const rpcRes = await db.rpc('ltch_save_room_exam',{p_exam:examPayload(examRow),p_bank:[],p_versions:[],p_expected_updated:examRow._expectedUpdatedAt ?? null});
  if (isMissingSchemaError(rpcRes?.error)) {
    return saveExamFallbackToBaseTable(db, examRow, activeClasses);
  }
  return rpcRes;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

function stripEphemeralQuestionFields(q) {
  if (!q || typeof q !== 'object') return q;
  const { version, question_code, ...rest } = q;
  const normalizeMediaList = (list) =>
    Array.isArray(list)
      ? list.map((m) => {
          if (!m || typeof m !== 'object') return m;
          const next = { id: m.id };
          if (m.sha256) next.sha256 = m.sha256;
          if (m.driveFileId) next.driveFileId = m.driveFileId;
          if (m.mimeType) next.mimeType = m.mimeType;
          if (m.inSolution) next.inSolution = true;
          if (!m.sha256 && !m.driveFileId && m.dataUrl) next.dataUrl = m.dataUrl;
          return next;
        })
      : undefined;
  const next = { ...rest };
  if (q.media) next.media = normalizeMediaList(q.media);
  if (q.passageMedia) next.passageMedia = normalizeMediaList(q.passageMedia);
  return next;
}

async function selectInChunks(db, tableName, columns, column, values, chunkSize = 80) {
  const list = [...new Set((values || []).filter(Boolean))];
  const out = [];
  for (let i = 0; i < list.length; i += chunkSize) {
    const res = await db.from(tableName).select(columns).in(column, list.slice(i, i + chunkSize));
    if (res?.error) {
      if (isMissingSchemaError(res.error)) return [];
      data(res);
    }
    if (Array.isArray(res?.data)) out.push(...res.data);
  }
  return out;
}

async function loadQuestionBankAndVersionState(db, examId, questions) {
  const codes = [...new Set((questions || []).map((q) => q?.questionCode || q?.question_code).filter(Boolean))];
  const slotCandidates = (questions || []).map((q, idx) => `qb_${examId}_${q?.id || `q_${idx + 1}`}`);
  const [bankByCodeRows, bankBySlotRows, versionRows] = await Promise.all([
    selectInChunks(db, 'ltch_question_bank', 'id,question_code,version,question', 'question_code', codes, 80),
    selectInChunks(db, 'ltch_question_bank', 'id,question_code', 'id', slotCandidates, 80),
    selectInChunks(db, 'ltch_question_versions', 'question_code,version,question', 'question_code', codes, 80)
  ]);

  const bankByCode = new Map();
  const occupiedSlotById = new Map();
  for (const row of bankByCodeRows) {
    if (row?.question_code) bankByCode.set(row.question_code, row);
    if (row?.id && row?.question_code) occupiedSlotById.set(row.id, row.question_code);
  }
  for (const row of bankBySlotRows) {
    if (row?.id && row?.question_code) occupiedSlotById.set(row.id, row.question_code);
  }

  const versionsByCode = new Map();
  for (const row of versionRows) {
    if (!row?.question_code) continue;
    const ver = Number(row.version) || 1;
    let verMap = versionsByCode.get(row.question_code);
    if (!verMap) {
      verMap = new Map();
      versionsByCode.set(row.question_code, verMap);
    }
    verMap.set(ver, row.question);
  }

  return { bankByCode, occupiedSlotById, versionsByCode };
}

async function reconcileQuestionsWithBankAndVersions(
  db,
  examId,
  questions,
  { preloaded = null, forDriveStub = false } = {}
) {
  const list = Array.isArray(questions) ? questions : [];
  const state = preloaded || (await loadQuestionBankAndVersionState(db, examId, list));
  const occupiedSlotById = new Map(state.occupiedSlotById);
  const bankIdsByCode = new Map();
  const comparable = (obj) => (forDriveStub ? compactQuestionStub(obj) : obj);

  const reconciledQuestions = list.map((q, idx) => {
    const qCode = q.questionCode || q.question_code;
    const existingBank = state.bankByCode.get(qCode);
    const verMap = state.versionsByCode.get(qCode);
    const maxSavedVer = verMap && verMap.size ? Math.max(...verMap.keys()) : 0;
    let finalVersion = Math.max(Number(q.version) || 1, Number(existingBank?.version) || 1, maxSavedVer);
    while (
      verMap &&
      verMap.has(finalVersion) &&
      canonicalJson(verMap.get(finalVersion)) !== canonicalJson(comparable({ ...q, version: finalVersion }))
    ) {
      finalVersion += 1;
    }

    const qId = q.id || `q_${idx + 1}`;
    const defaultSlotId = `qb_${examId}_${qId}`;
    const occupantCode = occupiedSlotById.get(defaultSlotId);
    let bankRowId =
      existingBank?.id ||
      (!occupantCode || occupantCode === qCode ? defaultSlotId : `qb_${examId}_${qCode}`);
    if (occupiedSlotById.has(bankRowId) && occupiedSlotById.get(bankRowId) !== qCode) {
      bankRowId = `qb_${examId}_${qCode}_${idx + 1}`;
    }
    occupiedSlotById.set(bankRowId, qCode);
    bankIdsByCode.set(qCode, bankRowId);

    return {
      ...q,
      version: finalVersion
    };
  });

  return { reconciledQuestions, bankIdsByCode, state };
}

async function saveExamAndQuestionVersions(
  db,
  examRow,
  actor,
  now,
  editReason,
  expectedUpdatedAt = null,
  activeClasses = [],
  preloadedState = null
) {
  const { reconciledQuestions, bankIdsByCode } = await reconcileQuestionsWithBankAndVersions(
    db,
    examRow.id,
    examRow.questions || [],
    { preloaded: preloadedState, forDriveStub: false }
  );
  const bank = reconciledQuestions.map((q) => {
    const qCode = q.questionCode || q.question_code;
    return {
      id: bankIdsByCode.get(qCode) || `qb_${examRow.id}_${q.id}`,
      class_id: null,
      question_code: qCode,
      exam_type: examRow.exam_type,
      target_grade: examRow.target_grade,
      school_year_id: examRow.school_year_id,
      version: Number(q.version) || 1,
      topic: '',
      question: q,
      status: 'active',
      created_by: actor.uid,
      created_at: now
    };
  });
  const versions = reconciledQuestions.map((q) => ({
    question_code: q.questionCode || q.question_code,
    version: Number(q.version) || 1,
    question: q,
    edit_reason: editReason,
    created_by: actor.uid,
    created_at: now
  }));
  const rpcRes = await db.rpc('ltch_save_room_exam', {
    p_exam: examPayload({ ...examRow, questions: reconciledQuestions }),
    p_bank: bank,
    p_versions: versions,
    p_expected_updated: expectedUpdatedAt
  });
  if (isMissingSchemaError(rpcRes?.error)) {
    data(await saveExamFallbackToBaseTable(db, examRow, activeClasses));
    return;
  }
  if (String(rpcRes?.error?.message || '').includes('LTCH_EXAM_CONFLICT')) {
    throw new ApiError(409, 'Đề thi vừa được cập nhật ở phiên khác. Vui lòng tải lại rồi thử lại.');
  }
  data(rpcRes);
}

export function normalizeAttemptRow(row) {
  if (!row || typeof row !== 'object') return null;
  const rawResp = row.responses && typeof row.responses === 'object' ? row.responses : {};
  const meta = rawResp._attemptMeta && typeof rawResp._attemptMeta === 'object' ? rawResp._attemptMeta : {};
  const cleanResponses = {};
  for (const [k, v] of Object.entries(rawResp)) {
    if (k !== '_attemptMeta' && k !== '_questionReports') {
      cleanResponses[k] = v;
    }
  }
  const status = meta.status === 'submitted' ? 'submitted' : (row.status ?? meta.status ?? 'submitted');
  return {
    ...row,
    attempt_no: Number(row.attempt_no ?? meta.attemptNo ?? 1) || 1,
    is_preview: Boolean(row.is_preview ?? meta.isPreview ?? false),
    practice_mode: row.practice_mode ?? meta.practiceMode ?? 'full',
    section_key: row.section_key ?? row.selected_section ?? meta.sectionKey ?? 'all',
    selected_combination: row.selected_combination ?? meta.selectedCombination ?? null,
    status,
    started_at: Number(row.started_at ?? meta.startedAt ?? row.submitted_at ?? Date.now()),
    expires_at: Number(row.expires_at ?? row.deadline_at ?? meta.expiresAt ?? 0),
    submitted_at: status === 'in_progress' ? null : Number(meta.submittedAt ?? row.submitted_at ?? Date.now()),
    active_device_token: row.active_device_token ?? meta.activeDeviceToken ?? null,
    section_states: row.section_states ?? meta.sectionStates ?? {},
    attempt_questions:
      Array.isArray(row.attempt_questions) && row.attempt_questions.length
        ? row.attempt_questions
        : Array.isArray(meta.attemptQuestions)
          ? meta.attemptQuestions
          : [],
    responses: cleanResponses,
      draft_meta: row.draft_meta ?? meta.draftMeta ?? { flagged: [], currentQuestionId: null },
    draft_updated_at: Number(row.draft_updated_at ?? meta.draftUpdatedAt ?? row.submitted_at ?? Date.now()),
    revision: Number(row.revision ?? meta.revision ?? 1) || 1,
    _questionReports: Array.isArray(rawResp._questionReports) ? rawResp._questionReports : []
  };
}

const ATTEMPT_HEADER_COLUMNS = 'id,exam_id,uid,submitted_at,score,max_score';
const ATTEMPT_HEADER_TYPED_COLUMNS = 'is_preview,practice_mode,selected_section,selected_combination,status,started_at,deadline_at,section_states';
const ATTEMPT_HEADER_META_FIELDS = ['attemptNo', 'isPreview', 'practiceMode', 'sectionKey', 'selectedCombination', 'status', 'startedAt', 'expiresAt', 'submittedAt', 'sectionStates'];
const ATTEMPT_HEADER_META_COLUMNS = ATTEMPT_HEADER_META_FIELDS.map(key => `legacy_${key}:responses->_attemptMeta->${key}`).join(',');

async function readAttemptHeaders(db, { uid, examIds }) {
  const read = columns => db.from('ltch_practice_attempts').select(columns).eq('uid', uid).in('exam_id', examIds);
  const result = await read(`${ATTEMPT_HEADER_COLUMNS},${ATTEMPT_HEADER_TYPED_COLUMNS},${ATTEMPT_HEADER_META_COLUMNS}`);
  const rows = data(isMissingSchemaError(result?.error)
    ? await read(`${ATTEMPT_HEADER_COLUMNS},${ATTEMPT_HEADER_META_COLUMNS}`)
    : result) || [];
  return rows.map(row => {
    const header = { ...row };
    const meta = { ...row.responses?._attemptMeta };
    for (const key of ATTEMPT_HEADER_META_FIELDS) {
      const alias = `legacy_${key}`;
      if (row[alias] !== null && row[alias] !== undefined) meta[key] = row[alias];
      delete header[alias];
    }
    return { ...normalizeAttemptRow({ ...header, responses: { _attemptMeta: meta } }), storedStatus: row.status };
  });
}

async function readFullAttempt(db, { id, uid, exam_id }) {
  return normalizeAttemptRow(data(await db.from('ltch_practice_attempts').select('*')
    .eq('id', id).eq('uid', uid).eq('exam_id', exam_id).maybeSingle()));
}

function isPastAttemptDeadline(attempt, now) {
  return attempt.expires_at > 0 && now > attempt.expires_at + GRACE_PERIOD_MS;
}

export function packAttemptResponsesWithMeta(attemptObj, { includeQuestions = false } = {}) {
  const clean = {};
  if (attemptObj.responses && typeof attemptObj.responses === 'object') {
    for (const [k, v] of Object.entries(attemptObj.responses)) {
      if (k !== '_attemptMeta' && k !== '_questionReports') {
        clean[k] = v;
      }
    }
  }
  const meta = {
    attemptNo: Number(attemptObj.attempt_no ?? 1),
    isPreview: Boolean(attemptObj.is_preview),
    practiceMode: attemptObj.practice_mode || 'full',
    sectionKey: attemptObj.section_key || 'all',
    selectedCombination: attemptObj.selected_combination || null,
    status: attemptObj.status || 'in_progress',
    startedAt: Number(attemptObj.started_at || Date.now()),
    expiresAt: Number(attemptObj.expires_at || 0),
    submittedAt: attemptObj.submitted_at ? Number(attemptObj.submitted_at) : null,
    activeDeviceToken: attemptObj.active_device_token || null,
    sectionStates: attemptObj.section_states || {},
    ...(includeQuestions
      ? { attemptQuestions: Array.isArray(attemptObj.attempt_questions) ? attemptObj.attempt_questions : [] }
      : {}),
    draftMeta: attemptObj.draft_meta || { flagged: [], currentQuestionId: null },
    draftUpdatedAt: Number(attemptObj.draft_updated_at || Date.now()),
    revision: Number(attemptObj.revision ?? 1) || 1
  };
  return {
    ...clean,
    _attemptMeta: meta,
    ...(Array.isArray(attemptObj._questionReports) && attemptObj._questionReports.length
      ? { _questionReports: attemptObj._questionReports }
      : {})
  };
}

export async function saveAttemptRowToDb(db, attemptObj, { isInsert = false } = {}) {
  const revision = Number(attemptObj.revision ?? 1);
  demand(Number.isSafeInteger(revision) && revision > 0, 409, 'Phiên bản bài làm không hợp lệ.');
  const nextRevision = isInsert ? 1 : revision + 1;
  const packedResponses = packAttemptResponsesWithMeta({ ...attemptObj, revision: nextRevision }, { includeQuestions: false });
  const fallbackPackedResponses = packAttemptResponsesWithMeta({ ...attemptObj, revision: nextRevision }, { includeQuestions: true });
  const status = attemptObj.status || 'in_progress';
  const fallbackMax = Math.max(
    1,
    Number(attemptObj.max_score) ||
      (Array.isArray(attemptObj.attempt_questions) && attemptObj.attempt_questions.length
        ? attemptObj.attempt_questions.length
        : 10)
  );
  const safeScore = Math.max(0, Math.min(fallbackMax, Number(attemptObj.score ?? 0) || 0));
  const fullRow = {
    id: attemptObj.id,
    exam_id: attemptObj.exam_id,
    uid: attemptObj.uid,
    is_preview: Boolean(attemptObj.is_preview),
    practice_mode: attemptObj.practice_mode || 'full',
    selected_section: attemptObj.section_key === 'all' ? null : (attemptObj.section_key || null),
    selected_combination: attemptObj.selected_combination || null,
    status,
    started_at: Number(attemptObj.started_at || Date.now()),
    deadline_at: Number(attemptObj.expires_at || 0) || null,
    submitted_at: status === 'submitted' ? Number(attemptObj.submitted_at || Date.now()) : (attemptObj.submitted_at ?? null),
    active_device_token: attemptObj.active_device_token || null,
    section_states: attemptObj.section_states || {},
    attempt_questions: Array.isArray(attemptObj.attempt_questions) ? attemptObj.attempt_questions : [],
    responses: packedResponses,
    draft_meta: attemptObj.draft_meta || { flagged: [], currentQuestionId: null },
    score: status === 'submitted' ? safeScore : Number(attemptObj.score ?? 0),
    max_score: status === 'submitted' ? fallbackMax : Number(attemptObj.max_score ?? 0),
    results: Array.isArray(attemptObj.results) ? attemptObj.results : [],
    revision: nextRevision
  };
  const { revision: _rev, ...rowWithoutRevision } = fullRow;
  const baseRow = {
    id: attemptObj.id,
    exam_id: attemptObj.exam_id,
    uid: attemptObj.uid,
    submitted_at: Number(attemptObj.submitted_at || attemptObj.started_at || Date.now()),
    responses: fallbackPackedResponses,
    score: safeScore,
    max_score: fallbackMax,
    results: Array.isArray(attemptObj.results) ? attemptObj.results : []
  };
  if (isInsert) {
    const result = await db.from('ltch_practice_attempts').insert(fullRow);
    if (isMissingSchemaError(result?.error)) {
      const midRes = await db.from('ltch_practice_attempts').insert(rowWithoutRevision);
      if (isMissingSchemaError(midRes?.error)) {
        const fbRes = await db.from('ltch_practice_attempts').insert(baseRow);
        data(fbRes);
        return fbRes;
      }
      data(midRes);
      return midRes;
    }
    data(result);
    return result;
  }
  const result = await db.from('ltch_practice_attempts').update(fullRow)
    .eq('id', attemptObj.id).eq('uid', attemptObj.uid).eq('revision', revision).select('id');
  if (isMissingSchemaError(result?.error)) {
    const midRes = await db.from('ltch_practice_attempts').update(rowWithoutRevision)
      .eq('id', attemptObj.id).eq('uid', attemptObj.uid);
    if (isMissingSchemaError(midRes?.error)) {
      const fbRes = await db.from('ltch_practice_attempts').update(baseRow)
        .eq('id', attemptObj.id).eq('uid', attemptObj.uid);
      data(fbRes);
      return fbRes;
    }
    data(midRes);
    return midRes;
  }
  const rows = data(result);
  demand(Array.isArray(rows) && rows.length === 1, 409, 'Bài làm đã thay đổi. Vui lòng tải lại.');
  return result;
}

export function hydrateAttemptQuestionsMediaFromExam(exam, attemptQuestions) {
  if (!exam || !Array.isArray(exam.questions) || !Array.isArray(attemptQuestions)) {
    return attemptQuestions || [];
  }
  const sourceQuestions = (exam._examMeta?.storage === 'drive' || attemptQuestions.some(q => q && !q.prompt))
    ? hydrateQuestionsFromPack(attemptQuestions, exam.questions)
    : attemptQuestions;
  const examQById = new Map();
  const examQByOrder = new Map();
  const examQByPrompt = new Map();
  for (const eq of exam.questions) {
    if (eq?.id) examQById.set(eq.id, eq);
    if (eq?.questionCode) examQById.set(eq.questionCode, eq);
    if (eq?.order) examQByOrder.set(Number(eq.order), eq);
    if (typeof eq?.prompt === 'string' && eq.prompt.trim()) {
      examQByPrompt.set(eq.prompt.trim().slice(0, 120), eq);
    }
  }
  const hydratedList = sourceQuestions.map((aq) => {
    const promptKey = typeof aq?.prompt === 'string' ? aq.prompt.trim().slice(0, 120) : '';
    const eq =
      examQById.get(aq.id) ||
      examQById.get(aq.questionCode) ||
      (aq.order ? examQByOrder.get(Number(aq.order)) : null) ||
      (promptKey ? examQByPrompt.get(promptKey) : null);
    if (!eq) return aq;
    const nextQ = { ...aq };
    if (Array.isArray(eq.media) && eq.media.length) {
      const mediaById = new Map(eq.media.map((m) => [m.id, m]));
      nextQ.media = (Array.isArray(aq.media) && aq.media.length ? aq.media : eq.media).map((m, idx) => {
        const ref = mediaById.get(m.id) || eq.media[idx];
        if (!ref) return m;
        return { ...ref, ...m, ...(ref.dataUrl && !m.dataUrl ? { dataUrl: ref.dataUrl } : {}) };
      });
    }
    if (Array.isArray(eq.passageMedia) && eq.passageMedia.length) {
      const pMediaById = new Map(eq.passageMedia.map((m) => [m.id, m]));
      nextQ.passageMedia = (Array.isArray(aq.passageMedia) && aq.passageMedia.length ? aq.passageMedia : eq.passageMedia).map((m, idx) => {
        const ref = pMediaById.get(m.id) || eq.passageMedia[idx];
        if (!ref) return m;
        return { ...ref, ...m, ...(ref.dataUrl && !m.dataUrl ? { dataUrl: ref.dataUrl } : {}) };
      });
    }
    const recovered = new Map([...(eq.media || []), ...(eq.passageMedia || [])]
      .filter(item => item.dataUrl).map(item => [item.id, item.dataUrl]));
    return recovered.size ? restorePracticeImages([nextQ], recovered)[0] : nextQ;
  });
  return renumberShuffledExamQuestions(hydratedList, {
    examType: exam.exam_type || exam.examType || 'thptqg'
  });
}

export async function finalizeAttemptInDb(db, rawAttempt, finalResponses, now = Date.now(), exam = null) {
  const attempt = normalizeAttemptRow(rawAttempt) || rawAttempt;
  const rawAttemptQuestions = Array.isArray(attempt.attempt_questions) ? attempt.attempt_questions : [];
  const attemptQuestions = exam ? hydrateAttemptQuestionsMediaFromExam(exam, rawAttemptQuestions) : rawAttemptQuestions;
  const isDriveExam = exam?._examMeta?.storage === 'drive' || (rawAttemptQuestions.length > 0 && rawAttemptQuestions.every(q => q && !q.prompt));
  const storedAttemptQuestions = isDriveExam ? attemptQuestions.map(compactQuestionStub) : attemptQuestions;
  const mergedResponses = { ...(attempt.responses || {}), ...(finalResponses || {}) };
  delete mergedResponses._attemptMeta;
  delete mergedResponses._questionReports;
  const graded = gradeAttemptQuestions(attemptQuestions, mergedResponses);
  const startedAt = Number(attempt.started_at) || now;
  const submittedAt = now;
  const timeSpentSeconds = Math.max(1, Math.round((submittedAt - startedAt) / 1000));

  const sectionStates = { ...(attempt.section_states || {}) };
  for (const [k, st] of Object.entries(sectionStates)) {
    if (st && st.status !== 'submitted') {
      sectionStates[k] = { ...st, status: 'submitted', submittedAt };
    }
  }

  const safeMax = Math.max(1, Number(graded.max) || (attemptQuestions.length || 1));
  const updatedAttemptObj = {
    ...attempt,
    attempt_questions: storedAttemptQuestions,
    status: 'submitted',
    submitted_at: submittedAt,
    responses: mergedResponses,
    score: graded.score,
    max_score: safeMax,
    results: graded.results,
    section_states: sectionStates,
    draft_updated_at: submittedAt
  };

  await saveAttemptRowToDb(db, updatedAttemptObj, { isInsert: false });

  return {
    attemptId: attempt.id,
    examId: attempt.exam_id,
    uid: attempt.uid,
    attemptNo: attempt.attempt_no || 1,
    isPreview: Boolean(attempt.is_preview),
    practiceMode: attempt.practice_mode || 'full',
    sectionKey: attempt.section_key || 'all',
    selectedCombination: attempt.selected_combination || null,
    status: 'submitted',
    startedAt,
    submittedAt,
    timeSpentSeconds,
    score: graded.score,
    max: graded.max,
    results: graded.results,
    sectionSummary: graded.sectionSummary,
    responses: mergedResponses,
    questions: attemptQuestions.map(projectSolutionQuestion)
  };
}

export async function autoFinalizeExpiredAttempt(db, rawAttempt, now = Date.now(), exam = null) {
  const attempt = normalizeAttemptRow(rawAttempt) || rawAttempt;
  if (!attempt || attempt.status !== 'in_progress') return attempt;
  if (isPastAttemptDeadline(attempt, now)) {
    return finalizeAttemptInDb(db, attempt, attempt.responses || {}, Math.min(now, attempt.expires_at), exam);
  }
  return attempt;
}

function buildInitialAttemptState(exam, { practiceMode, sectionKey, selectedCombination, now }) {
  const examType = String(exam.exam_type || 'thptqg').toLowerCase();
  const rawQuestions = Array.isArray(exam.questions) ? exam.questions : [];
  const sectionStates = {};
  let attemptQuestions = [];
  let currentSection = 'part_1';
  let expiresAt = now + (Number(exam.duration_minutes) || 90) * 60_000;

  if (examType === 'thptqg') {
    const durationMs = (Number(exam.duration_minutes) || 90) * 60_000;
    expiresAt = now + durationMs;
    currentSection = 'all';
    attemptQuestions = selectAndShuffleSectionQuestions('thptqg', rawQuestions, 'all');
    sectionStates.all = {
      status: 'in_progress',
      startedAt: now,
      expiresAt,
      durationMinutes: Number(exam.duration_minutes) || 90
    };
  } else if (examType === 'hsa') {
    const sections = practiceMode === 'section' ? [sectionKey || 'part_1'] : ['part_1', 'part_2', 'part_3'];
    currentSection = sections[0];
    let totalMinutes = 0;

    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const cfg = EXAM_SECTION_CONFIG.hsa.find((c) => c.key === sec) || EXAM_SECTION_CONFIG.hsa[0];
      totalMinutes += cfg.durationMinutes;

      if (i === 0) {
        // Bắt đầu ở màn hình chờ 120 giây chuẩn HSA
        const waitExpiresAt = now + HSA_WAIT_SECONDS * 1000;
        sectionStates[sec] = {
          status: 'waiting',
          waitStartedAt: now,
          waitExpiresAt,
          startedAt: null,
          expiresAt: null,
          durationMinutes: cfg.durationMinutes
        };
        if (sec !== 'part_3') {
          attemptQuestions.push(
            ...selectAndShuffleSectionQuestions('hsa', rawQuestions, sec, { practiceMode })
          );
        } else if (selectedCombination) {
          attemptQuestions.push(
            ...selectAndShuffleSectionQuestions('hsa', rawQuestions, 'part_3', {
              practiceMode,
              selectedCombination
            })
          );
        }
      } else {
        sectionStates[sec] = {
          status: 'locked',
          startedAt: null,
          expiresAt: null,
          durationMinutes: cfg.durationMinutes
        };
        if (sec !== 'part_3') {
          attemptQuestions.push(
            ...selectAndShuffleSectionQuestions('hsa', rawQuestions, sec, { practiceMode })
          );
        }
      }
    }
    expiresAt = now + (totalMinutes + sections.length * 3) * 60_000;
  } else if (examType === 'tsa') {
    const sections = practiceMode === 'section' ? [sectionKey || 'part_1'] : ['part_1', 'part_2', 'part_3'];
    currentSection = sections[0];
    let totalMinutes = 0;

    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const cfg = EXAM_SECTION_CONFIG.tsa.find((c) => c.key === sec) || EXAM_SECTION_CONFIG.tsa[0];
      totalMinutes += cfg.durationMinutes;
      const secQuestions = selectAndShuffleSectionQuestions('tsa', rawQuestions, sec, { practiceMode });
      attemptQuestions.push(...secQuestions);

      if (i === 0) {
        const secExpires = now + cfg.durationMinutes * 60_000;
        sectionStates[sec] = {
          status: 'in_progress',
          startedAt: now,
          expiresAt: secExpires,
          durationMinutes: cfg.durationMinutes
        };
        if (practiceMode === 'section') expiresAt = secExpires;
      } else {
        sectionStates[sec] = {
          status: 'locked',
          startedAt: null,
          expiresAt: null,
          durationMinutes: cfg.durationMinutes
        };
      }
    }
    if (practiceMode === 'full') {
      expiresAt = now + totalMinutes * 60_000;
    }
  }

  return {
    sectionStates,
    attemptQuestions,
    currentSection,
    expiresAt
  };
}

function getVisibleQuestionsForAttempt(examType, attemptQuestions, sectionStates, currentSection) {
  const normType = String(examType || 'thptqg').toLowerCase();
  if (normType === 'thptqg') {
    return attemptQuestions.map((q) => ({
      ...projectVisibleQuestion(q),
      displayNumber: q.displayNumber || q.order || 1
    }));
  }
  const st = sectionStates?.[currentSection];
  // Khi đang ở màn hình chờ 120s (waiting), chưa trả nội dung câu hỏi về client
  if (!st || st.status === 'waiting' || st.status === 'locked') {
    return [];
  }
  return attemptQuestions
    .filter((q) => (q.section || 'part_1') === currentSection)
    .map((q) => ({
      ...projectVisibleQuestion(q),
      displayNumber: q.displayNumber || q.order || 1
    }));
}

function resolveCurrentSection(examType, sectionStates = {}) {
  if (String(examType || 'thptqg').toLowerCase() === 'thptqg') return 'all';
  for (const key of ['part_1', 'part_2', 'part_3']) {
    const st = sectionStates[key];
    if (st && (st.status === 'in_progress' || st.status === 'waiting')) return key;
  }
  const keys = Object.keys(sectionStates);
  return keys[keys.length - 1] || 'part_1';
}

function serializeActiveAttemptForClient(exam, attempt, now = Date.now(), mediaOpts = null) {
  const examType = String(exam.exam_type || 'thptqg').toLowerCase();
  const sectionStates = attempt.section_states || {};
  const currentSection = resolveCurrentSection(examType, sectionStates);
  const rawAttemptQuestions = Array.isArray(attempt.attempt_questions) ? attempt.attempt_questions : [];
  const attemptQuestions = hydrateAttemptQuestionsMediaFromExam(exam, rawAttemptQuestions);
  let visibleQuestions = getVisibleQuestionsForAttempt(
    examType,
    attemptQuestions,
    sectionStates,
    currentSection
  );
  if (mediaOpts?.env) {
    visibleQuestions = attachSignedPracticeMediaUrls(visibleQuestions, { ...mediaOpts, now });
  }

  return {
    attemptId: attempt.id,
    examId: exam.id,
    examTitle: exam.title,
    examCode: exam.exam_code || '',
    examType,
    targetGrade: exam.target_grade || 12,
    practiceMode: attempt.practice_mode || 'full',
    sectionKey: attempt.section_key || 'all',
    selectedCombination: attempt.selected_combination || null,
    isPreview: Boolean(attempt.is_preview),
    status: attempt.status,
    serverNow: now,
    startedAt: Number(attempt.started_at) || now,
    expiresAt: Number(attempt.expires_at) || now + 5400_000,
    currentSection,
    sectionStates,
    responses: attempt.responses || {},
    draftMeta: attempt.draft_meta || {},
    visibleQuestions,
    totalQuestionCount: attemptQuestions.length
  };
}

async function allocateQuestionCodes(db, count) {
  if (count <= 0) return [];
  const rpcRes = await db.rpc('ltch_reserve_question_codes', { p_count: count });
  if (isMissingSchemaError(rpcRes?.error)) {
    const base = Date.now() % 1_000_000_000;
    return Array.from({ length: count }, (_, idx) => `LTCH-${base * 1000 + idx + 1}`);
  }
  const codes = data(rpcRes);
  demand(Array.isArray(codes) && codes.length === count && new Set(codes).size === count && codes.every(code => /^LTCH-\d+$/.test(code)), 503, 'Không thể cấp mã câu hỏi.');
  return codes;
}

export async function recordStudentGradeHistoryBeforeTransition(db, classesToRecord = [], now = Date.now()) {
    const validClasses = classesToRecord.filter((c) => {
      const g = resolveClassGradeNumber(c);
      return g && g >= 6 && g <= 12 && c.school_year_id;
    });
    if (!validClasses.length) return;
    const classIds = validClasses.map((c) => c.id);
    const classMap = new Map(validClasses.map((c) => [c.id, c]));
    const memRes = await db
      .from('ltch_class_memberships')
      .select('uid,class_id')
      .in('class_id', classIds)
      .eq('member_role', 'student')
      .eq('status', 'active');
    const memberships = data(memRes);
    if (!Array.isArray(memberships) || !memberships.length) return;

    const rows = [];
    for (const m of memberships) {
      const klass = classMap.get(m.class_id);
      const grade = resolveClassGradeNumber(klass);
      if (!klass || !grade) continue;
      rows.push({
        uid: m.uid,
        school_year_id: klass.school_year_id,
        grade,
        class_id: klass.id,
        recorded_at: now
      });
    }
    if (rows.length) {
      const upRes = await db
        .from('ltch_student_grade_history')
        .upsert(rows, { onConflict: 'uid,school_year_id,grade' });
      if (!isMissingSchemaError(upRes?.error)) {
        data(upRes);
      }
    }
}

export async function loadSharedExamIdsForYear(db, exams = [], currentSchoolYearId) {
  const sharedExamIds = new Set();
  if (!currentSchoolYearId) return sharedExamIds;
  for (const ex of exams || []) {
    if (Array.isArray(ex?.shared_school_year_ids) && ex.shared_school_year_ids.includes(currentSchoolYearId)) {
      sharedExamIds.add(ex.id);
    }
  }
  const examIds = (exams || []).map((ex) => ex?.id).filter(Boolean);
  let query = db.from('ltch_exam_year_shares').select('exam_id').eq('school_year_id', currentSchoolYearId);
  if (examIds.length === 1) query = query.eq('exam_id', examIds[0]);
  const sharesRes = await query;
  const shares = isMissingSchemaError(sharesRes?.error) ? [] : (data(sharesRes) || []);
  for (const s of shares) {
    if (s?.exam_id) sharedExamIds.add(s.exam_id);
  }
  return sharedExamIds;
}

export function isStudentAllowedExam(access, exam, sharedExamIds = new Set()) {
  if (access.isAlumni) return false;
  const examType = String(exam.exam_type || '').toLowerCase();
  if (!EXAM_TYPES.includes(examType)) return false;

  if (access.isStaff) {
    if (access.isAdmin || access.isTeacher) return true;
    const targetGrade = Number(exam.target_grade) || 12;
    const staffGrades = Array.isArray(access.staffGrades) ? access.staffGrades : [];
    const canManageExam =
      examType === 'thptqg'
        ? Boolean(access.manageablePools?.[`thptqg_${targetGrade}`])
        : Boolean(access.manageablePools?.[examType]);
    if (exam.status !== 'published' && !canManageExam) return false;
    if (examType === 'tsa') {
      return Boolean(access.manageablePools?.tsa) || staffGrades.includes(11) || staffGrades.includes(12);
    }
    if (examType === 'hsa') {
      return Boolean(access.manageablePools?.hsa) || staffGrades.includes(targetGrade);
    }
    return canManageExam || staffGrades.includes(targetGrade);
  }

  if (exam.status !== 'published') return false;

  const isCurrentOrSharedYear =
    !exam.school_year_id ||
    exam.school_year_id === access.currentSchoolYearId ||
    sharedExamIds.has(exam.id);

  if (examType === 'thptqg') {
    const g = Number(exam.target_grade) || 12;
    if (access.activeGrades.includes(g) && isCurrentOrSharedYear) return true;
    if (access.pastGradePools.some((p) => p.grade === g)) return true;
    return false;
  }

  if (examType === 'hsa') {
    return access.activeGrades.includes(12) && isCurrentOrSharedYear;
  }

  if (examType === 'tsa') {
    if ((access.activeGrades.includes(11) || access.activeGrades.includes(12)) && isCurrentOrSharedYear) {
      return true;
    }
    if (access.pastGradePools.some((p) => p.grade === 11)) return true;
    return false;
  }

  return false;
}

async function deleteInChunks(db, tableName, column, values, ignoreMissing = true, chunkSize = 200) {
  const list = [...new Set((values || []).filter(Boolean))];
  for (let i = 0; i < list.length; i += chunkSize) {
    const res = await db.from(tableName).delete().in(column, list.slice(i, i + chunkSize));
    if (res?.error) {
      if (ignoreMissing && isMissingSchemaError(res.error)) return;
      data(res);
    }
  }
}

const UTF8_ENCODER = new TextEncoder();
const measureUtf8Bytes = (value) => UTF8_ENCODER.encode(String(value || '')).length;

function measureJsonRows(rows) {
  let jsonBytes = 0;
  let inlineDataUrlCount = 0;
  for (const r of rows) {
    const s = JSON.stringify(r || {});
    jsonBytes += measureUtf8Bytes(s);
    const matches = s.match(/data:image\//gi);
    if (matches) inlineDataUrlCount += matches.length;
  }
  return { count: rows.length, jsonBytes, inlineDataUrlCount };
}

async function selectLightRowsPaged(buildQuery, pageSize = 1000, maxPages = 5) {
  const first = buildQuery();
  if (typeof first?.range !== 'function') {
    return first.limit(pageSize * maxPages);
  }
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const res = await buildQuery().range(page * pageSize, (page + 1) * pageSize - 1);
    if (res?.error) return { data: null, error: res.error };
    const batch = Array.isArray(res?.data) ? res.data : [];
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return { data: all, error: null };
}

async function listAllRoomExamSummaries(db) {
  if (typeof db.rpc === 'function') {
    const rpcRes = await db.rpc('ltch_list_room_exams', { p_published_only: false });
    if (rpcRes && !rpcRes.error && Array.isArray(rpcRes.data)) {
      return rpcRes.data
        .map(normalizeExamSummaryRow)
        .filter((e) => e && (EXAM_TYPES.includes(e.exam_type) || /^exam_(thptqg|hsa|tsa)_/i.test(e.id)));
    }
  }
  let res = await db
    .from('ltch_exams')
    .select('id,class_id,title,status,opens_at,exam_type,target_grade,updated_at')
    .limit(500);
  if (isMissingSchemaError(res?.error)) {
    res = await db.from('ltch_exams').select('*').limit(200);
  }
  return (data(res) || [])
    .map(normalizeExamRow)
    .filter((e) => e && (EXAM_TYPES.includes(e.exam_type) || /^exam_(thptqg|hsa|tsa)_/i.test(e.id)));
}

async function measureTableSampleByKeys(db, tableName, keyColumn, keys, totalCount, { chunkSize = 120, state }) {
  const uniqueKeys = [...new Set((keys || []).filter(Boolean))];
  const stats = { count: totalCount, jsonBytes: 0, inlineDataUrlCount: 0 };
  for (let i = 0; i < uniqueKeys.length; i += chunkSize) {
    if (state.fetchedBytes >= state.maxBytes || state.subrequestsUsed >= state.maxSubrequests) {
      state.approximate = true;
      break;
    }
    state.subrequestsUsed += 1;
    const res = await db.from(tableName).select('*').in(keyColumn, uniqueKeys.slice(i, i + chunkSize));
    if (res?.error) {
      if (isMissingSchemaError(res.error)) {
        return { count: 0, jsonBytes: 0, inlineDataUrlCount: 0 };
      }
      state.approximate = true;
      break;
    }
    const m = measureJsonRows(res?.data || []);
    stats.jsonBytes += m.jsonBytes;
    stats.inlineDataUrlCount += m.inlineDataUrlCount;
    state.fetchedBytes += m.jsonBytes;
  }
  return stats;
}

export async function practiceRooms(request, path, { db, actor, env, openDrive }) {
  const method = request.method;
  const now = Date.now();

  // 1. Sảnh Phòng luyện & Danh sách bộ đề
  if (path === '/api/practice/rooms' && method === 'GET') {
    const access = await computePracticeAccess(db, actor);
    const gradeParam = Number(new URL(request.url).searchParams.get('grade'));
    const requestedGrade = [10, 11, 12].includes(gradeParam) ? gradeParam : null;
    const gradeRoomScope =
      requestedGrade === 10
        ? ['thptqg']
        : requestedGrade === 11
          ? ['thptqg', 'tsa']
          : requestedGrade === 12
            ? ['thptqg', 'hsa', 'tsa']
            : null;
    const scopedAllowedRooms = gradeRoomScope
      ? access.allowedRooms.filter((r) => gradeRoomScope.includes(r))
      : access.allowedRooms;
    const scopedPastGradePools = requestedGrade
      ? (access.pastGradePools || []).filter((p) => p.grade < requestedGrade)
      : access.pastGradePools || [];

    if (access.isAlumni) {
      return json({
        access,
        exams: [],
        attemptsByExam: {}
      });
    }

    let rawExams = null;
    if (typeof db.rpc === 'function') {
      const rpcExamsRes = await db.rpc('ltch_list_room_exams', { p_published_only: !access.isStaff });
      if (rpcExamsRes && !rpcExamsRes.error && Array.isArray(rpcExamsRes.data)) {
        rawExams = rpcExamsRes.data
          .map(normalizeExamSummaryRow)
          .filter((e) => e && EXAM_TYPES.includes(e.exam_type));
      }
    }
    if (!rawExams) {
      let examsQuery = db
        .from('ltch_exams')
        .select('*')
        .order('opens_at', { ascending: false })
        .limit(300);

      if (!access.isStaff) {
        examsQuery = examsQuery.eq('status', 'published');
      }

      rawExams = (data(await examsQuery) || [])
        .map(normalizeExamRow)
        .filter((e) => e && EXAM_TYPES.includes(e.exam_type));
    }

    // Kiểm tra các đề năm cũ được bật chia sẻ cho năm học hiện tại
    const sharesRes = await db.from('ltch_exam_year_shares').select('*');
    const allShares = isMissingSchemaError(sharesRes?.error) ? [] : (data(sharesRes) || []);
    const sharedExamIds = await loadSharedExamIdsForYear(db, rawExams, access.currentSchoolYearId);

    const isExamInPastPoolForStudent = (exam) => {
      if (access.isStaff) return false;
      const t = String(exam.exam_type || '').toLowerCase();
      const tg = Number(exam.target_grade) || 12;
      return (
        (t === 'thptqg' && !access.activeGrades.includes(tg)) ||
        (t === 'tsa' && !access.activeGrades.includes(11) && !access.activeGrades.includes(12))
      );
    };

    const visibleExams = rawExams.filter((e) => {
      if (!isStudentAllowedExam(access, e, sharedExamIds)) return false;
      if (!requestedGrade) return true;
      const tg = Number(e.target_grade) || 12;
      if (isExamInPastPoolForStudent(e)) {
        return scopedPastGradePools.some((p) => p.grade === tg);
      }
      return matchesPracticeGradePool(e, requestedGrade);
    });
    const examIds = visibleExams.map((e) => e.id);

    const solutionCountsByExam = new Map();
    if (examIds.length > 0) {
      const solFilesRes = await db
        .from('ltch_practice_solution_files')
        .select('exam_id,file_kind')
        .in('exam_id', examIds)
        .eq('status', 'stored');
      if (!isMissingSchemaError(solFilesRes?.error)) {
        for (const row of data(solFilesRes) || []) {
          if (!row?.exam_id) continue;
          const cur = solutionCountsByExam.get(row.exam_id) || { video: 0, document: 0, examFile: 0 };
          if (row.file_kind === 'video') cur.video += 1;
          else if (row.file_kind === 'document') cur.document += 1;
          else if (row.file_kind === 'exam_file') cur.examFile += 1;
          solutionCountsByExam.set(row.exam_id, cur);
        }
      }
    }

    // Tải lịch sử làm bài của học sinh và thống kê tổng lượt làm bài
    let userAttempts = [];
    let attemptCountsByExam = {};
    if (examIds.length > 0) {
      userAttempts = (await readAttemptHeaders(db, { uid: actor.uid, examIds }))
        .filter(attempt => !attempt.is_preview)
        .sort((x, y) => x.attempt_no - y.attempt_no);

      const statsRes = await db.rpc('ltch_practice_stats',{p_exam_ids:examIds});
      if (isMissingSchemaError(statsRes?.error)) {
        try {
          const allAttRes = await db
            .from('ltch_practice_attempts')
            .select('exam_id,uid,score,max_score,submitted_at,responses')
            .in('exam_id', examIds);
          const allAttRows = (!allAttRes?.error && Array.isArray(allAttRes?.data)) ? allAttRes.data : [];
          for (const rawRow of allAttRows) {
            const norm = normalizeAttemptRow(rawRow);
            if (norm && !norm.is_preview && norm.status === 'submitted') {
              attemptCountsByExam[norm.exam_id] = (attemptCountsByExam[norm.exam_id] || 0) + 1;
            }
          }
        } catch {}
      } else {
        const stats = data(statsRes) || [];
        for(const row of stats)attemptCountsByExam[row.exam_id]=Number(row.total)||0;
      }
    }

    // Tự động chấm và đóng các lượt làm dở đã quá hạn
    const attemptsByExam = {};
    for (let a of userAttempts) {
      if (a.status === 'in_progress' && isPastAttemptDeadline(a, now)) {
        try {
          const fullAttempt = await readFullAttempt(db, a);
          const finalized = fullAttempt && await autoFinalizeExpiredAttempt(db, fullAttempt, now);
          if (finalized && finalized.status === 'submitted') {
            a = {
              ...a,
              status: 'submitted',
              submitted_at: finalized.submittedAt,
              score: finalized.score,
              max_score: finalized.max
            };
          }
        } catch {}
      }
      if (!attemptsByExam[a.exam_id]) {
        attemptsByExam[a.exam_id] = { inProgressAttempt: null, history: [] };
      }
      if (a.status === 'in_progress' && !a.is_preview) {
        attemptsByExam[a.exam_id].inProgressAttempt = {
          attemptId: a.id,
          attemptNo: a.attempt_no || 1,
          practiceMode: a.practice_mode || 'full',
          sectionKey: a.section_key || 'all',
          selectedCombination: a.selected_combination || null,
          startedAt: a.started_at,
          expiresAt: a.expires_at,
          sectionStates: a.section_states || {}
        };
      } else if (a.status === 'submitted' && !a.is_preview) {
        const startedAt = Number(a.started_at) || Number(a.submitted_at) || now;
        const submittedAt = Number(a.submitted_at) || now;
        attemptsByExam[a.exam_id].history.push({
          attemptId: a.id,
          attemptNo: a.attempt_no || attemptsByExam[a.exam_id].history.length + 1,
          practiceMode: a.practice_mode || 'full',
          sectionKey: a.section_key || 'all',
          selectedCombination: a.selected_combination || null,
          startedAt,
          submittedAt,
          timeSpentSeconds: Math.max(1, Math.round((submittedAt - startedAt) / 1000)),
          score: Number(a.score ?? 0),
          max: Number(a.max_score ?? 0)
        });
      }
    }

    const formattedExams = visibleExams.map((e) => {
      const qs = Array.isArray(e.questions) ? e.questions : [];
      const rawQuestionCount = e._summaryCounts ? e._summaryCounts.total : qs.length;
      const examType = String(e.exam_type || 'thptqg').toLowerCase();
      const targetGrade = Number(e.target_grade) || 12;
      const isPastPool =
        !access.isStaff &&
        ((examType === 'thptqg' && !access.activeGrades.includes(targetGrade)) ||
          (examType === 'tsa' && !access.activeGrades.includes(11) && !access.activeGrades.includes(12)));

      const sectionCounts = e._summaryCounts
        ? {
            part_1: e._summaryCounts.part_1,
            part_2: e._summaryCounts.part_2,
            part_3: e._summaryCounts.part_3
          }
        : {
            part_1: qs.filter((q) => (q.section || 'part_1') === 'part_1').length,
            part_2: qs.filter((q) => q.section === 'part_2').length,
            part_3: qs.filter((q) => q.section === 'part_3').length
          };

      const availableSections = Object.entries(sectionCounts)
        .filter(([, cnt]) => cnt > 0)
        .map(([k]) => k);

      const mergedShares = new Set([
        ...allShares.filter((s) => s.exam_id === e.id).map((s) => s.school_year_id),
        ...(Array.isArray(e.shared_school_year_ids) ? e.shared_school_year_ids : [])
      ]);
      const solCounts = solutionCountsByExam.get(e.id) || { video: 0, document: 0, examFile: 0 };
      const sourceFilesCount = (Array.isArray(e._examMeta?.sourceFiles) ? e._examMeta.sourceFiles.length : 0) + solCounts.examFile;

      return {
        id: e.id,
        title: e.title,
        examCode: e.exam_code || '',
        examType,
        examMode: e.exam_mode || 'full',
        targetGrade,
        schoolYearId: e.school_year_id || access.currentSchoolYearId,
        durationMinutes: Number(e.duration_minutes) || (examType === 'thptqg' ? 90 : examType === 'hsa' ? 195 : 150),
        status: e.status,
        questionCount: examType === 'hsa' && rawQuestionCount > 150 ? 150 : rawQuestionCount,
        rawQuestionCount,
        sectionCounts,
        availableSections,
        attemptCount: attemptCountsByExam[e.id] || 0,
        solutionVideoCount: solCounts.video,
        solutionDocCount: solCounts.document,
        sourceFileCount: sourceFilesCount,
        hasSolution: solCounts.video + solCounts.document > 0,
        isPastPool,
        sharedSchoolYearIds: [...mergedShares],
        canManage: canManagePracticePool(actor, access.activeClasses, examType, targetGrade),
        opensAt: e.opens_at,
        updatedAt: e.updated_at || e.opens_at
      };
    });

    return json({
      access: {
        isAdmin: access.isAdmin,
        isTeacher: access.isTeacher,
        isStaff: access.isStaff,
        canManageAny: access.canManageAny,
        isStudent: access.isStudent,
        isAlumni: access.isAlumni,
        activeGrades: access.activeGrades,
        staffGrades: access.staffGrades,
        allowedRooms: scopedAllowedRooms,
        pastGradePools: scopedPastGradePools,
        manageablePools: access.manageablePools,
        currentSchoolYearId: access.currentSchoolYearId,
        currentSchoolYearName: access.currentSchoolYearName,
        examYear: access.examYear,
        schoolYears: access.schoolYears,
        displayName: access.displayName,
        studentCode: access.studentCode
      },
      exams: formattedExams,
      attemptsByExam
    });
  }

  // 2. Bắt đầu hoặc tiếp tục bài thi: POST /api/exams/:examId/start
  const startMatch = /^\/api\/exams\/([A-Za-z0-9_-]{1,128})\/start$/.exec(path);
  if (startMatch && method === 'POST') {
    const examId = id(startMatch[1]);
    const b = await readJson(request, 16384);
    let exam = normalizeExamRow(data(await db.from('ltch_exams').select('*').eq('id', examId).maybeSingle()));
    demand(exam && EXAM_TYPES.includes(String(exam.exam_type || '').toLowerCase()), 404, 'Không tìm thấy đề luyện.');

    const access = await computePracticeAccess(db, actor);
    const examType = String(exam.exam_type).toLowerCase();
    const isPreview = Boolean(b.isPreview);

    if (isPreview) {
      demand(
        canManagePracticePool(actor, access.activeClasses, examType, exam.target_grade),
        403,
        'Bạn không có quyền làm thử đề này.'
      );
    } else {
      const sharedExamIds = await loadSharedExamIdsForYear(db, [exam], access.currentSchoolYearId);
      demand(
        isStudentAllowedExam(access, exam, sharedExamIds),
        403,
        access.isAlumni
          ? 'Tài khoản cựu học sinh đã hoàn thành khóa học nên không còn quyền truy cập phòng luyện.'
          : 'Bạn không có quyền làm đề này.'
      );
    }

    const practiceMode = b.practiceMode === 'section' ? 'section' : 'full';
    const sectionKey =
      examType === 'thptqg'
        ? 'all'
        : practiceMode === 'section'
          ? ['part_1', 'part_2', 'part_3'].includes(b.sectionKey)
            ? b.sectionKey
            : 'part_1'
          : 'all';
    const selectedCombination =
      typeof b.selectedCombination === 'string' && b.selectedCombination.trim()
        ? b.selectedCombination.trim()
        : null;

    if (examType === 'hsa' && practiceMode === 'section' && sectionKey === 'part_3') {
      demand(
        selectedCombination &&
          HSA_COMBINATIONS.some((c) => c.code.toLowerCase() === selectedCombination.toLowerCase()),
        400,
        'Vui lòng chọn tổ hợp 3 môn Khoa học (Q01–Q10) hoặc Tiếng Anh cho Phần 3 HSA.'
      );
    }

    exam = await loadExamQuestionsFromDrive(exam, { env, openDrive });
    const mediaOpts = { env, requestUrl: request.url };
    const isDriveExam = exam._examMeta?.storage === 'drive';

    // Kiểm tra bài đang làm dở của học sinh
    const userAttempts = (await readAttemptHeaders(db, { uid: actor.uid, examIds: [examId] }))
      .filter(attempt => attempt.is_preview === isPreview);

    for (const att of userAttempts) {
      if (att.status === 'in_progress') {
        const isExpired = isPastAttemptDeadline(att, now);
        if (isExpired) {
          try {
            const fullAttempt = await readFullAttempt(db, att);
            if (!fullAttempt || (await autoFinalizeExpiredAttempt(db, fullAttempt, now, exam)).status === 'submitted') continue;
          } catch {}
        }
        const isSameModeAndSection = att.practice_mode === practiceMode && (att.section_key || 'all') === sectionKey;
        if (isExpired || b.forceRestart || (!b.resume && !isSameModeAndSection)) {
          await db.from('ltch_practice_attempts').delete().eq('id', att.id).eq('uid', actor.uid);
          att._deleted = true;
          continue;
        }
        if (b.resume === true || isSameModeAndSection) {
          const fullAttempt = await readFullAttempt(db, att);
          if (!fullAttempt || fullAttempt.status !== 'in_progress') continue;
          const newToken = randomUUID();
          const resumedAtt = { ...fullAttempt, active_device_token: newToken };
          await saveAttemptRowToDb(db, resumedAtt, { isInsert: false });
          return json({
            ...serializeActiveAttemptForClient(exam, resumedAtt, now, mediaOpts),
            activeDeviceToken: newToken,
            resumed: true
          });
        }
      } else if (att.status === 'submitted' && att.storedStatus === 'in_progress') {
        try {
          const fullAttempt = await readFullAttempt(db, att);
          if (fullAttempt) await saveAttemptRowToDb(db, fullAttempt, { isInsert: false });
        } catch {}
      }
    }

    const nonPreviewCount = userAttempts.filter((a) => !a.is_preview && !a._deleted).length;
    const attemptNo = isPreview ? 0 : nonPreviewCount + 1;
    const attemptId = `att_${randomUUID().replace(/-/g, '')}`;
    const activeDeviceToken = randomUUID();

    const init = buildInitialAttemptState(exam, {
      practiceMode,
      sectionKey,
      selectedCombination,
      now
    });

    const newAttemptRow = {
      id: attemptId,
      exam_id: examId,
      uid: actor.uid,
      attempt_no: attemptNo,
      is_preview: isPreview,
      practice_mode: practiceMode,
      section_key: sectionKey,
      selected_combination: selectedCombination,
      status: 'in_progress',
      started_at: now,
      expires_at: init.expiresAt,
      submitted_at: null,
      active_device_token: activeDeviceToken,
      section_states: init.sectionStates,
      attempt_questions: isDriveExam ? init.attemptQuestions.map(compactQuestionStub) : init.attemptQuestions,
      responses: {},
      draft_meta: { flagged: [], currentQuestionId: null },
      draft_updated_at: now,
      score: 0,
      max_score: 0,
      results: []
    };

    data(await saveAttemptRowToDb(db, newAttemptRow, { isInsert: true }));

    return json(
      {
        ...serializeActiveAttemptForClient(exam, newAttemptRow, now, mediaOpts),
        activeDeviceToken,
        resumed: false
      },
      201
    );
  }

  // 3. Lưu nháp tự động: POST /api/exams/:examId/draft
  const draftMatch = /^\/api\/exams\/([A-Za-z0-9_-]{1,128})\/draft$/.exec(path);
  if (draftMatch && method === 'POST') {
    const examId = id(draftMatch[1]);
    const b = await readJson(request, 131072);
    const attemptId = id(b.attemptId);

    const attempt = normalizeAttemptRow(
      data(
        await db
          .from('ltch_practice_attempts')
          .select('*')
          .eq('id', attemptId)
          .eq('exam_id', examId)
          .maybeSingle()
      )
    );
    demand(attempt && attempt.uid === actor.uid, 404, 'Không tìm thấy lượt làm bài.');
    if (attempt.status !== 'in_progress') {
      return json({ ok: false, status: attempt.status, serverNow: now }, 409);
    }
    if (attempt.active_device_token && attempt.active_device_token !== b.activeDeviceToken) {
      return json(
        {
          code: 'DEVICE_SUPERSEDED',
          error: 'Bài thi đã được mở trên một thiết bị hoặc tab mới hơn.'
        },
        409
      );
    }

    demand(!attempt.expires_at || now <= attempt.expires_at + GRACE_PERIOD_MS, 409, 'Bài thi đã hết thời gian.');
    // Chỉ cho phép cập nhật đáp án của các câu thuộc phần đang mở (in_progress)
    const sectionStates = attempt.section_states || {};
    const attemptQuestions = Array.isArray(attempt.attempt_questions) ? attempt.attempt_questions : [];
    const allowedQuestionIds = new Set(
      attemptQuestions
        .filter((q) => {
          if (sectionStates.all?.status === 'in_progress') return !sectionStates.all.expiresAt || now <= sectionStates.all.expiresAt + GRACE_PERIOD_MS;
          const st = sectionStates[q.section || 'part_1'];
          return st && st.status === 'in_progress' && (!st.expiresAt || now <= st.expiresAt + GRACE_PERIOD_MS);
        })
        .map((q) => q.id)
    );

    const nextResponses = { ...(attempt.responses || {}) };
    if (b.responses && typeof b.responses === 'object') {
      for (const [qId, val] of Object.entries(b.responses)) {
        if (allowedQuestionIds.has(qId)) {
          nextResponses[qId] = val;
        }
      }
    }

    const nextDraftMeta =
      b.draftMeta && typeof b.draftMeta === 'object'
        ? {
            flagged: Array.isArray(b.draftMeta.flagged) ? b.draftMeta.flagged.slice(0, 200) : [],
            currentQuestionId:
              typeof b.draftMeta.currentQuestionId === 'string'
                ? b.draftMeta.currentQuestionId.slice(0, 64)
                : null
          }
        : attempt.draft_meta || {};

    await saveAttemptRowToDb(
      db,
      {
        ...attempt,
        responses: nextResponses,
        draft_meta: nextDraftMeta,
        draft_updated_at: now
      },
      { isInsert: false }
    );

    return json({ ok: true, serverNow: now, draftUpdatedAt: now });
  }

  // 4. Chuyển phần thi / Bắt đầu phần thi (HSA 120s waiting, chọn tổ hợp Phần 3, TSA chuyển phần): POST /api/exams/:examId/section
  const sectionMatch = /^\/api\/exams\/([A-Za-z0-9_-]{1,128})\/section$/.exec(path);
  if (sectionMatch && method === 'POST') {
    const examId = id(sectionMatch[1]);
    const b = await readJson(request, 131072);
    const attemptId = id(b.attemptId);

    const [examRes, attRes] = await Promise.all([
      db.from('ltch_exams').select('*').eq('id', examId).maybeSingle(),
      db.from('ltch_practice_attempts').select('*').eq('id', attemptId).eq('exam_id', examId).maybeSingle()
    ]);
    let exam = normalizeExamRow(data(examRes));
    const attempt = normalizeAttemptRow(data(attRes));
    demand(exam && attempt && attempt.uid === actor.uid, 404, 'Không tìm thấy bài làm.');
    demand(attempt.status === 'in_progress', 409, 'Bài thi đã kết thúc.');

    if (attempt.active_device_token && attempt.active_device_token !== b.activeDeviceToken) {
      return json(
        {
          code: 'DEVICE_SUPERSEDED',
          error: 'Bài thi đã được mở trên một thiết bị hoặc tab mới hơn.'
        },
        409
      );
    }

    demand(!attempt.expires_at || now <= attempt.expires_at + GRACE_PERIOD_MS, 409, 'Bài thi đã hết thời gian.');
    exam = await loadExamQuestionsFromDrive(exam, { env, openDrive });
    const mediaOpts = { env, requestUrl: request.url };
    const isDriveExam = exam._examMeta?.storage === 'drive';
    const examType = String(exam.exam_type || 'thptqg').toLowerCase();
    const sectionStates = { ...(attempt.section_states || {}) };
    let attemptQuestions = Array.isArray(attempt.attempt_questions) ? [...attempt.attempt_questions] : [];
    let selectedCombination = attempt.selected_combination || null;
    const targetSection = b.sectionKey || resolveCurrentSection(examType, sectionStates);

    if (b.action === 'start_section') {
      const st = sectionStates[targetSection];
      demand(st && (st.status === 'waiting' || st.status === 'in_progress'), 400, 'Phần thi không ở trạng thái sẵn sàng bắt đầu.');
      demand(targetSection === resolveCurrentSection(examType, sectionStates), 409, 'Phần thi không ở trạng thái sẵn sàng bắt đầu.');

      if (examType === 'hsa' && targetSection === 'part_3') {
        const combo = String(b.selectedCombination || selectedCombination || '').trim();
        demand(
          combo && HSA_COMBINATIONS.some((c) => c.code.toLowerCase() === combo.toLowerCase()),
          400,
          'Vui lòng chọn tổ hợp 3 môn Khoa học (Q01–Q10) hoặc Tiếng Anh trước khi bắt đầu Phần 3.'
        );
        const combinationChanged = combo.toLowerCase() !== String(selectedCombination || '').toLowerCase();
        demand(st.status === 'waiting' || !combinationChanged, 409, 'Không thể đổi tổ hợp sau khi Phần 3 đã bắt đầu.');
        if (st.status === 'waiting') {
          const hasPart3Questions = attemptQuestions.some((q) => q.section === 'part_3');
          if (combinationChanged || !hasPart3Questions) {
            const part3Questions = selectAndShuffleSectionQuestions('hsa', exam.questions || [], 'part_3', {
              practiceMode: attempt.practice_mode,
              selectedCombination: combo
            });
            const part3Stored = isDriveExam ? part3Questions.map(compactQuestionStub) : part3Questions;
            attemptQuestions = [...attemptQuestions.filter(q => q.section !== 'part_3'), ...part3Stored];
          }
          selectedCombination = combo;
        }
      }

      if (st.status === 'waiting') {
        const durMs = (Number(st.durationMinutes) || 60) * 60_000;
        sectionStates[targetSection] = {
          ...st,
          status: 'in_progress',
          startedAt: now,
          expiresAt: now + durMs
        };
      }

      const updatedAttempt = {
        ...attempt,
        selected_combination: selectedCombination,
        section_states: sectionStates,
        attempt_questions: isDriveExam ? attemptQuestions.map(compactQuestionStub) : attemptQuestions,
        draft_updated_at: now
      };

      await saveAttemptRowToDb(db, updatedAttempt, { isInsert: false });

      return json(serializeActiveAttemptForClient(exam, updatedAttempt, now, mediaOpts));
    }

    if (b.action === 'submit_section') {
      const currentSec = resolveCurrentSection(examType, sectionStates);
      const st = sectionStates[currentSec];
      demand(st && st.status === 'in_progress', 400, 'Không xác định được phần thi hiện tại.');

      // Lưu đáp án của phần hiện tại trước khi khóa
      const nextResponses = { ...(attempt.responses || {}) };
      if ((!st.expiresAt || now <= st.expiresAt + GRACE_PERIOD_MS) && b.responses && typeof b.responses === 'object') {
        const secQIds = new Set(
          attemptQuestions.filter((q) => (q.section || 'part_1') === currentSec).map((q) => q.id)
        );
        for (const [qId, val] of Object.entries(b.responses)) {
          if (secQIds.has(qId)) nextResponses[qId] = val;
        }
      }

      sectionStates[currentSec] = {
        ...st,
        status: 'submitted',
        submittedAt: now
      };

      // Tìm phần thi kế tiếp (nếu thi cả đề)
      const orderedKeys = ['part_1', 'part_2', 'part_3'].filter((k) => sectionStates[k]);
      const nextSecKey = orderedKeys.find((k) => sectionStates[k].status === 'locked');

      if (!nextSecKey) {
        // Đã hoàn thành phần cuối cùng -> Chấm điểm và nộp bài luôn
        const finalized = await finalizeAttemptInDb(
          db,
          { ...attempt, section_states: sectionStates, responses: nextResponses },
          nextResponses,
          now,
          exam
        );
        return json({
          ...finalized,
          questions: attachSignedPracticeMediaUrls(finalized.questions, mediaOpts),
          completedAllSections: true
        });
      }

      const nextCfg = sectionStates[nextSecKey];
      if (examType === 'hsa') {
        sectionStates[nextSecKey] = {
          ...nextCfg,
          status: 'waiting',
          waitStartedAt: now,
          waitExpiresAt: now + HSA_WAIT_SECONDS * 1000
        };
      } else {
        const durMs = (Number(nextCfg.durationMinutes) || 60) * 60_000;
        sectionStates[nextSecKey] = {
          ...nextCfg,
          status: 'in_progress',
          startedAt: now,
          expiresAt: now + durMs
        };
      }

      const updatedAttempt = {
        ...attempt,
        section_states: sectionStates,
        responses: nextResponses,
        draft_updated_at: now
      };

      await saveAttemptRowToDb(db, updatedAttempt, { isInsert: false });

      return json({
        ...serializeActiveAttemptForClient(exam, updatedAttempt, now, mediaOpts),
        completedAllSections: false
      });
    }

    throw new ApiError(400, 'Thao tác phần thi không hợp lệ.');
  }

  // 5. Nộp bài thi: POST /api/exams/:examId/submit
  const submitMatch = /^\/api\/exams\/([A-Za-z0-9_-]{1,128})\/submit$/.exec(path);
  if (submitMatch && method === 'POST') {
    const examId = id(submitMatch[1]);
    const b = await readJson(request, 131072);
    const attemptId = id(b.attemptId);

    const [examRes, attRes] = await Promise.all([
      db.from('ltch_exams').select('*').eq('id', examId).maybeSingle(),
      db.from('ltch_practice_attempts').select('*').eq('id', attemptId).eq('exam_id', examId).maybeSingle()
    ]);
    let exam = normalizeExamRow(data(examRes));
    const attempt = normalizeAttemptRow(data(attRes));
    demand(exam && attempt && attempt.uid === actor.uid, 404, 'Không tìm thấy bài thi.');

    exam = await loadExamQuestionsFromDrive(exam, { env, openDrive });
    const mediaOpts = { env, requestUrl: request.url };

    // Idempotent: nếu bài đã nộp trước đó thì trả về ngay kết quả
    if (attempt.status === 'submitted') {
      const rawAttemptQuestions = Array.isArray(attempt.attempt_questions) ? attempt.attempt_questions : [];
      const attemptQuestions = hydrateAttemptQuestionsMediaFromExam(exam, rawAttemptQuestions);
      const graded = gradeAttemptQuestions(attemptQuestions, attempt.responses || {});
      const startedAt = Number(attempt.started_at) || Number(attempt.submitted_at) || now;
      const submittedAt = Number(attempt.submitted_at) || now;
      return json({
        attemptId: attempt.id,
        examId: exam.id,
        examTitle: exam.title,
        examCode: exam.exam_code || '',
        examType: String(exam.exam_type || 'thptqg').toLowerCase(),
        attemptNo: attempt.attempt_no || 1,
        isPreview: Boolean(attempt.is_preview),
        practiceMode: attempt.practice_mode || 'full',
        sectionKey: attempt.section_key || 'all',
        selectedCombination: attempt.selected_combination || null,
        status: 'submitted',
        startedAt,
        submittedAt,
        timeSpentSeconds: Math.max(1, Math.round((submittedAt - startedAt) / 1000)),
        score: Number(attempt.score ?? graded.score),
        max: Number(attempt.max_score ?? graded.max),
        results: Array.isArray(attempt.results) && attempt.results.length ? attempt.results : graded.results,
        sectionSummary: graded.sectionSummary,
        responses: attempt.responses || {},
        questions: attachSignedPracticeMediaUrls(attemptQuestions.map(projectSolutionQuestion), mediaOpts)
      });
    }

    demand(!attempt.active_device_token || attempt.active_device_token === b.activeDeviceToken, 409, 'Bài thi đã được mở trên một thiết bị hoặc tab mới hơn.');

    const expiresAt = Number(attempt.expires_at) || 0;
    const withinGrace = expiresAt === 0 || now <= expiresAt + GRACE_PERIOD_MS;

    // Chỉ nhận đáp án gửi kèm nếu trong thời hạn (+10s grace) và thuộc phần đang mở
    const mergedResponses = { ...(attempt.responses || {}) };
    if (withinGrace && b.responses && typeof b.responses === 'object') {
      const sectionStates = attempt.section_states || {};
      const attemptQuestions = Array.isArray(attempt.attempt_questions) ? attempt.attempt_questions : [];
      const openQIds = new Set(
        attemptQuestions
          .filter((q) => {
            if (sectionStates.all?.status === 'in_progress') return !sectionStates.all.expiresAt || now <= sectionStates.all.expiresAt + GRACE_PERIOD_MS;
            const st = sectionStates[q.section || 'part_1'];
            return st && st.status === 'in_progress' && (!st.expiresAt || now <= st.expiresAt + GRACE_PERIOD_MS);
          })
          .map((q) => q.id)
      );
      for (const [qId, val] of Object.entries(b.responses)) {
        if (openQIds.has(qId)) mergedResponses[qId] = val;
      }
    }

    const finalized = await finalizeAttemptInDb(
      db,
      attempt,
      mergedResponses,
      withinGrace ? now : Math.min(now, expiresAt),
      exam
    );

    return json({
      ...finalized,
      questions: attachSignedPracticeMediaUrls(finalized.questions, mediaOpts),
      examTitle: exam.title,
      examCode: exam.exam_code || '',
      examType: String(exam.exam_type || 'thptqg').toLowerCase()
    });
  }

  // 5b. Xem chi tiết kết quả & lời giải một lần làm bài: GET /api/practice/exams/:examId/attempts/:attemptId
  const resultMatch =
    /^\/api\/practice\/exams\/([A-Za-z0-9_-]{1,128})\/attempts\/([A-Za-z0-9_-]{4,100})$/.exec(path) ||
    /^\/api\/exams\/([A-Za-z0-9_-]{1,128})\/attempts\/([A-Za-z0-9_-]{4,100})$/.exec(path);
  if (resultMatch && method === 'GET') {
    const examId = id(resultMatch[1]);
    const attemptId = id(resultMatch[2]);

    const [examRes, attRes] = await Promise.all([
      db.from('ltch_exams').select('*').eq('id', examId).maybeSingle(),
      db.from('ltch_practice_attempts').select('*').eq('id', attemptId).eq('exam_id', examId).maybeSingle()
    ]);
    let exam = normalizeExamRow(data(examRes));
    let attempt = normalizeAttemptRow(data(attRes));
    if (!exam || !EXAM_TYPES.includes(String(exam.exam_type || '').toLowerCase())) {
      return null; // Nhường cho hệ thống đề theo lớp cũ (nếu có)
    }
    demand(attempt, 404, 'Không tìm thấy lượt làm bài.');

    if (attempt.uid !== actor.uid && !isAdmin(actor)) {
      const memberships = data(await db.from('ltch_class_memberships').select('class_id').eq('uid', attempt.uid).eq('member_role', 'student').eq('status', 'active')) || [];
      demand(memberships.some(m => staffCan(actor, m.class_id, 'practice.manage')), 403, 'Bạn không có quyền xem kết quả lượt làm bài này.');
    }

    exam = await loadExamQuestionsFromDrive(exam, { env, openDrive });
    const mediaOpts = { env, requestUrl: request.url };

    if (attempt.status === 'in_progress') {
      await autoFinalizeExpiredAttempt(db, attempt, now, exam);
      attempt = normalizeAttemptRow(data(await db.from('ltch_practice_attempts').select('*').eq('id', attemptId).eq('exam_id', examId).maybeSingle()));
    }
    demand(attempt?.status === 'submitted', 409, 'Bài thi chưa kết thúc.');

    const rawAttemptQuestions = Array.isArray(attempt.attempt_questions) && attempt.attempt_questions.length
      ? attempt.attempt_questions
      : Array.isArray(exam.questions)
        ? exam.questions
        : [];
    const attemptQuestions = hydrateAttemptQuestionsMediaFromExam(exam, rawAttemptQuestions);
    const graded = gradeAttemptQuestions(attemptQuestions, attempt.responses || {});
    const startedAt = Number(attempt.started_at) || Number(attempt.submitted_at) || now;
    const submittedAt = Number(attempt.submitted_at) || now;

    // Lấy danh sách các lần làm bài của học sinh trên đề này + phổ điểm
    let history = [];
    const buckets = [
      { label: '0 - 20%', count: 0 },
      { label: '20 - 40%', count: 0 },
      { label: '40 - 60%', count: 0 },
      { label: '60 - 80%', count: 0 },
      { label: '80 - 100%', count: 0 }
    ];
    {
      const rows = await readAttemptHeaders(db, { uid: attempt.uid, examIds: [examId] });
      const normalizedList = rows
        .filter((r) => r && r.status === 'submitted')
        .sort((a, b) => (Number(a.attempt_no) || 0) - (Number(b.attempt_no) || 0));
      for (const r of normalizedList) {
        if (r.uid === attempt.uid && !r.is_preview) {
            const st = Number(r.started_at) || Number(r.submitted_at) || now;
            const sb = Number(r.submitted_at) || now;
            history.push({
              attemptId: r.id,
              attemptNo: r.attempt_no || history.length + 1,
              practiceMode: r.practice_mode || 'full',
              sectionKey: r.section_key || 'all',
              selectedCombination: r.selected_combination || null,
              submittedAt: sb,
              timeSpentSeconds: Math.max(1, Math.round((sb - st) / 1000)),
              score: Number(r.score ?? 0),
              max: Number(r.max_score ?? 0)
            });
          }
        }
    }
    const statsRes = await db.rpc('ltch_practice_stats',{p_exam_ids:[examId]});
    if (isMissingSchemaError(statsRes?.error)) {
      try {
        const allAttRes = await db.from('ltch_practice_attempts').select('exam_id,uid,score,max_score,submitted_at,responses').eq('exam_id', examId).limit(500);
        const allRows = (!allAttRes?.error && Array.isArray(allAttRes?.data)) ? allAttRes.data : [];
        for (const rawRow of allRows) {
          const norm = normalizeAttemptRow(rawRow);
          if (norm && !norm.is_preview && norm.status === 'submitted') {
            const maxScore = Number(norm.max_score) || 0;
            const sc = Number(norm.score) || 0;
            const ratio = maxScore > 0 ? sc / maxScore : 0;
            const idx = ratio < 0.2 ? 0 : ratio < 0.4 ? 1 : ratio < 0.6 ? 2 : ratio < 0.8 ? 3 : 4;
            buckets[idx].count += 1;
          }
        }
      } catch {}
    } else {
      const stats = data(statsRes) || [];
      for(let i=0;i<buckets.length;i++)buckets[i].count=Number(stats[0]?.[`b${i}`])||0;
    }

    return json({
      attemptId: attempt.id,
      examId: exam.id,
      examTitle: exam.title,
      examCode: exam.exam_code || '',
      examType: String(exam.exam_type || 'thptqg').toLowerCase(),
      targetGrade: exam.target_grade || 12,
      attemptNo: attempt.attempt_no || 1,
      isPreview: Boolean(attempt.is_preview),
      practiceMode: attempt.practice_mode || 'full',
      sectionKey: attempt.section_key || 'all',
      selectedCombination: attempt.selected_combination || null,
      status: attempt.status,
      startedAt,
      submittedAt,
      timeSpentSeconds: Math.max(1, Math.round((submittedAt - startedAt) / 1000)),
      score: Number(attempt.score ?? graded.score),
      max: Number(attempt.max_score ?? graded.max),
      results: Array.isArray(attempt.results) && attempt.results.length ? attempt.results : graded.results,
      sectionSummary: graded.sectionSummary,
      responses: attempt.responses || {},
      questions: attachSignedPracticeMediaUrls(attemptQuestions.map(projectSolutionQuestion), mediaOpts),
      history,
      distribution: buckets
    });
  }

  // 6. Báo lỗi câu hỏi (#LTCH-xxxx): POST /api/practice/report-error
  if (path === '/api/practice/report-error' && method === 'POST') {
    const b = await readJson(request, 16384);
    const attemptId = id(b.attemptId);
    const examId = id(b.examId);
    const note = string(b.note, 2000);
    demand(note.length >= 5, 400, 'Nội dung báo lỗi phải có ít nhất 5 ký tự.');
    const questionId = string(b.questionId || '', 64, true);

    const attempt = normalizeAttemptRow(
      data(
        await db
          .from('ltch_practice_attempts')
          .select('*')
          .eq('id', attemptId)
          .eq('exam_id', examId)
          .maybeSingle()
      )
    );
    demand(
      attempt && attempt.uid === actor.uid && ['in_progress', 'submitted'].includes(attempt.status),
      403,
      'Chỉ được báo lỗi câu hỏi trong bài thi bạn đang làm hoặc đã nộp.'
    );

    const attemptQuestions = Array.isArray(attempt.attempt_questions) ? attempt.attempt_questions : [];
    const reportedCode = typeof b.questionCode === 'string' ? b.questionCode.trim() : '';
    const targetQ =
      attemptQuestions.find((q) => q.id === questionId) ||
      (reportedCode && attemptQuestions.find((q) => (q.questionCode || q.question_code) === reportedCode)) ||
      null;
    const questionCode =
      targetQ?.questionCode ||
      targetQ?.question_code;
    demand(targetQ && typeof questionCode === 'string' && questionCode.length > 0, 400, 'Không tìm thấy câu hỏi trong bài làm.');

    const reportRow = {
      id: `rep_${randomUUID().replace(/-/g, '')}`,
      attempt_id: attempt.id,
      exam_id: examId,
      question_code: questionCode,
      question_version: Number(targetQ?.version) || 1,
      reported_by: actor.uid,
      description: note,
      category: 'other',
      status: 'new',
      created_at: now
    };

    const repRes = await db
      .from('ltch_question_reports')
      .upsert(reportRow, { onConflict: 'attempt_id,question_code' });
    if (isMissingSchemaError(repRes?.error) || String(repRes?.error?.code || '') === '23503') {
      const existingReports = Array.isArray(attempt._questionReports) ? [...attempt._questionReports] : [];
      const existingIdx = existingReports.findIndex((r) => r.question_code === questionCode);
      const fallbackReport = {
        ...reportRow,
        note,
        status: 'open'
      };
      if (existingIdx >= 0) existingReports[existingIdx] = fallbackReport;
      else existingReports.push(fallbackReport);
      await saveAttemptRowToDb(db, { ...attempt, _questionReports: existingReports }, { isInsert: false });
    } else {
      data(repRes);
    }

    return json({ ok: true, questionCode }, 201);
  }

  // 7. Quản trị Đề thi & Đăng tải Word (.docx): /api/admin/practice/exams
  const adminExamDetailMatch = /^\/api\/admin\/practice\/exams\/([A-Za-z0-9_-]{1,128})$/.exec(path);
  if (adminExamDetailMatch && method === 'GET') {
    const examId = id(adminExamDetailMatch[1]);
    const access = await computePracticeAccess(db, actor);
    demand(access.isStaff, 403, 'Chỉ giáo viên, trợ giảng hoặc quản trị viên mới có quyền truy cập.');
    let exam = normalizeExamRow(data(await db.from('ltch_exams').select('*').eq('id', examId).maybeSingle()));
    demand(exam, 404, 'Không tìm thấy đề thi.');
    demand(
      canManagePracticePool(actor, access.activeClasses, exam.exam_type, exam.target_grade),
      403,
      'Bạn không có quyền quản lý kho đề này.'
    );
    exam = await loadExamQuestionsFromDrive(exam, { env, openDrive });
    exam = {
      ...exam,
      questions: attachSignedPracticeMediaUrls(exam.questions, { env, requestUrl: request.url })
    };
    const sharesRes = await db.from('ltch_exam_year_shares').select('*').eq('exam_id', examId);
    let shares = isMissingSchemaError(sharesRes?.error) ? [] : (data(sharesRes) || []);
    if (!shares.length && Array.isArray(exam.shared_school_year_ids)) {
      shares = exam.shared_school_year_ids.map((sy) => ({
        exam_id: examId,
        school_year_id: sy,
        is_enabled: true
      }));
    }
    return json({ exam, shares });
  }

  if (path === '/api/admin/practice/exams' && method === 'POST') {
    const access = await computePracticeAccess(db, actor);
    demand(access.isStaff, 403, 'Chỉ giáo viên, trợ giảng hoặc quản trị viên mới có quyền quản lý đề.');
    // Cho phép payload tới 10 MB để lưu trọn bộ đề 150-235 câu hoặc tải lô tệp lên Drive
    const b = await readJson(request, 10_000_000);
    const action = String(b.action || 'save_draft');
    const mediaOpts = { env, requestUrl: request.url };
    const useDrive = isPracticeDriveConfigured(env, openDrive);

    if (action === 'storage_diagnostics') {
      demand(isAdmin(actor), 403, 'Chỉ Quản trị viên mới có quyền xem chẩn đoán lưu trữ.');
      const summaries = await listAllRoomExamSummaries(db);
      const roomExamIds = summaries.map((s) => s.id);
      const [bankKeysRes, examQRes, attemptKeysRes] = await Promise.all([
        selectLightRowsPaged(() => db.from('ltch_question_bank').select('id,question_code,exam_type')),
        roomExamIds.length
          ? selectLightRowsPaged(() => db.from('ltch_exam_questions').select('exam_id,question_code').in('exam_id', roomExamIds))
          : Promise.resolve({ data: [], error: null }),
        roomExamIds.length
          ? selectLightRowsPaged(() => db.from('ltch_practice_attempts').select('id,exam_id').in('exam_id', roomExamIds))
          : Promise.resolve({ data: [], error: null })
      ]);

      const allBankKeys = isMissingSchemaError(bankKeysRes?.error) ? [] : (data(bankKeysRes) || []);
      const examQRows = isMissingSchemaError(examQRes?.error) ? [] : (data(examQRes) || []);
      const attemptKeyRows = isMissingSchemaError(attemptKeysRes?.error) ? [] : (data(attemptKeysRes) || []);

      const roomCodes = new Set();
      for (const r of examQRows) {
        if (r?.question_code) roomCodes.add(r.question_code);
      }
      const bankById = new Map();
      const recordMatchingBank = (r) => {
        if (!r?.id || bankById.has(r.id)) return;
        bankById.set(r.id, r);
        if (r.question_code) roomCodes.add(r.question_code);
      };
      for (const r of allBankKeys) {
        if (
          EXAM_TYPES.includes(String(r.exam_type || '').toLowerCase()) ||
          roomCodes.has(r.question_code) ||
          roomExamIds.some((exId) => String(r.id || '').startsWith(`qb_${exId}_`))
        ) {
          recordMatchingBank(r);
        }
      }

      const state = {
        fetchedBytes: 0,
        subrequestsUsed: 0,
        approximate: false,
        maxBytes: 6_000_000,
        maxSubrequests: 22
      };
      const examStats = { count: 0, jsonBytes: 0, inlineDataUrlCount: 0 };
      const examItems = [];

      for (const s of summaries) {
        let fetchedExam = null;
        if (state.fetchedBytes < state.maxBytes && state.subrequestsUsed < state.maxSubrequests) {
          state.subrequestsUsed += 1;
          const exRes = await db.from('ltch_exams').select('*').eq('id', s.id).maybeSingle();
          if (!exRes?.error && exRes?.data) {
            fetchedExam = exRes.data;
          } else if (exRes?.error) {
            state.approximate = true;
          }
        } else {
          state.approximate = true;
        }

        if (fetchedExam) {
          const norm = normalizeExamRow(fetchedExam);
          for (const q of norm.questions || []) {
            const code = q?.questionCode || q?.question_code;
            if (code) roomCodes.add(code);
          }
          const m = measureJsonRows([fetchedExam]);
          examStats.count += 1;
          examStats.jsonBytes += m.jsonBytes;
          examStats.inlineDataUrlCount += m.inlineDataUrlCount;
          state.fetchedBytes += m.jsonBytes;
          examItems.push({
            id: norm.id,
            title: norm.title,
            examType: norm.exam_type,
            status: norm.status,
            storage: norm._examMeta?.storage || 'inline',
            questionCount: Array.isArray(norm.questions) ? norm.questions.length : 0,
            dbRowBytes: measureUtf8Bytes(JSON.stringify(norm.questions || [])),
            driveFolderId: norm._examMeta?.driveFolderId || null,
            drivePackFileId: norm._examMeta?.drivePackFileId || null,
            sourceFilesCount: Array.isArray(norm._examMeta?.sourceFiles) ? norm._examMeta.sourceFiles.length : 0
          });
        } else {
          examStats.count += 1;
          examItems.push({
            id: s.id,
            title: s.title,
            examType: s.exam_type,
            status: s.status,
            storage: s._examMeta?.storage || 'inline',
            questionCount: Number(s._summaryCounts?.total || s.total_questions || (Array.isArray(s.questions) ? s.questions.length : 0) || 0),
            dbRowBytes: 0,
            driveFolderId: s._examMeta?.driveFolderId || null,
            drivePackFileId: s._examMeta?.drivePackFileId || null,
            sourceFilesCount: Array.isArray(s._examMeta?.sourceFiles) ? s._examMeta.sourceFiles.length : 0,
            approximate: true
          });
        }
      }

      for (const r of allBankKeys) {
        if (roomCodes.has(r.question_code)) {
          recordMatchingBank(r);
        }
      }

      const codeList = [...roomCodes];
      let totalVersionCount = 0;
      let versionsMissing = false;
      for (let i = 0; i < codeList.length; i += 250) {
        const vKeyRes = await db
          .from('ltch_question_versions')
          .select('question_code,version')
          .in('question_code', codeList.slice(i, i + 250));
        if (vKeyRes?.error) {
          if (isMissingSchemaError(vKeyRes.error)) {
            versionsMissing = true;
            break;
          }
          state.approximate = true;
          break;
        }
        totalVersionCount += Array.isArray(vKeyRes?.data) ? vKeyRes.data.length : 0;
      }

      const bankIds = [...bankById.keys()];
      const attemptIds = attemptKeyRows.map((r) => r.id).filter(Boolean);
      const bankStats = await measureTableSampleByKeys(db, 'ltch_question_bank', 'id', bankIds, bankIds.length, {
        chunkSize: 120,
        state
      });
      const versionStats = versionsMissing
        ? { count: 0, jsonBytes: 0, inlineDataUrlCount: 0 }
        : await measureTableSampleByKeys(db, 'ltch_question_versions', 'question_code', codeList, totalVersionCount, {
            chunkSize: 120,
            state
          });
      const attemptStats = await measureTableSampleByKeys(db, 'ltch_practice_attempts', 'id', attemptIds, attemptIds.length, {
        chunkSize: 60,
        state
      });

      return json({
        ok: true,
        examsCount: examItems.length,
        approximate: state.approximate,
        totalDbJsonBytes: examStats.jsonBytes + bankStats.jsonBytes + versionStats.jsonBytes + attemptStats.jsonBytes,
        inlineDataUrlCount:
          examStats.inlineDataUrlCount +
          bankStats.inlineDataUrlCount +
          versionStats.inlineDataUrlCount +
          attemptStats.inlineDataUrlCount,
        tables: {
          ltch_exams: examStats,
          ltch_question_bank: bankStats,
          ltch_question_versions: versionStats,
          ltch_practice_attempts: attemptStats
        },
        exams: examItems
      });
    }

    if (action === 'purge_all_room_exams') {
      demand(isAdmin(actor), 403, 'Chỉ Quản trị viên mới có quyền xóa sạch dữ liệu phòng luyện.');

      if (b.incremental === true) {
        const summaries = await listAllRoomExamSummaries(db);
        const roomExamIds = summaries.map((s) => s.id);

        if (roomExamIds.length > 0) {
          const attRes = await db.from('ltch_practice_attempts').select('id').in('exam_id', roomExamIds).limit(200);
          const attRows = isMissingSchemaError(attRes?.error) ? [] : (data(attRes) || []);
          if (attRows.length > 0) {
            const batchIds = attRows.slice(0, 3).map((r) => r.id).filter(Boolean);
            await deleteInChunks(db, 'ltch_question_reports', 'attempt_id', batchIds, true, 10);
            for (const aid of batchIds) {
              await deleteInChunks(db, 'ltch_practice_attempts', 'id', [aid], true, 1);
            }
            return json({
              ok: true,
              done: false,
              phase: 'attempts',
              deletedAttempts: batchIds.length,
              remainingAttempts: Math.max(0, attRows.length - batchIds.length),
              remainingExams: roomExamIds.length
            });
          }

          const target = summaries[0];
          const examFolderKeys = [
            `practice:source:${target.id}`,
            `practice:sol-video:${target.id}`,
            `practice:sol-doc:${target.id}`,
            `practice:media:${target.id}`,
            `practice:exam:${target.id}`
          ];
          if (useDrive) {
            const fRes = await db.from('ltch_drive_folders').select('*').in('folder_key', examFolderKeys);
            const fRows = isMissingSchemaError(fRes?.error) ? [] : (data(fRes) || []);
            const driveFolderIds = new Set();
            const orphanPackIds = new Set();
            for (const r of fRows) {
              if (r.folder_key === `practice:exam:${target.id}` && r.drive_folder_id) {
                driveFolderIds.add(r.drive_folder_id);
              }
            }
            if (target._examMeta?.driveFolderId) driveFolderIds.add(target._examMeta.driveFolderId);
            else if (target._examMeta?.drivePackFileId) orphanPackIds.add(target._examMeta.drivePackFileId);

            if (driveFolderIds.size > 0 || orphanPackIds.size > 0) {
              const drive = await (openDrive || configuredDrive)(env);
              for (const fid of driveFolderIds) {
                try { await drive.trash({ id: fid }); } catch (err) { if (err?.code !== 'not_found') throw err; }
              }
              for (const pid of orphanPackIds) {
                try { await drive.trash({ id: pid }); } catch (err) { if (err?.code !== 'not_found') throw err; }
              }
            }
            if (fRows.length > 0) {
              await deleteInChunks(db, 'ltch_drive_folders', 'folder_key', fRows.map((r) => r.folder_key), true, 10);
            }
          }

          await deleteInChunks(db, 'ltch_practice_solution_files', 'exam_id', [target.id], true, 50);
          await deleteInChunks(db, 'ltch_practice_solutions', 'exam_id', [target.id], true, 50);
          await deleteInChunks(db, 'ltch_question_reports', 'exam_id', [target.id], true, 50);
          await deleteInChunks(db, 'ltch_practice_attempts', 'exam_id', [target.id], true, 50);
          await deleteInChunks(db, 'ltch_exam_year_shares', 'exam_id', [target.id], true, 50);
          await deleteInChunks(db, 'ltch_exam_questions', 'exam_id', [target.id], true, 50);
          await deleteInChunks(db, 'ltch_legacy_question_codes', 'exam_id', [target.id], true, 50);
          await deleteInChunks(db, 'ltch_question_imports', 'exam_id', [target.id], true, 50);
          await deleteInChunks(db, 'ltch_exams', 'id', [target.id], false, 1);
          clearPracticeDriveCaches();
          return json({
            ok: true,
            done: false,
            phase: 'exams',
            deletedExamId: target.id,
            deletedExamTitle: target.title,
            remainingExams: summaries.length - 1
          });
        }

        const bankRes = await selectLightRowsPaged(() => db.from('ltch_question_bank').select('id,question_code,exam_type'));
        const bankRows = isMissingSchemaError(bankRes?.error) ? [] : (data(bankRes) || []);
        const roomBank = bankRows.filter(
          (r) =>
            EXAM_TYPES.includes(String(r.exam_type || '').toLowerCase()) ||
            /^qb_exam_(thptqg|hsa|tsa)_/i.test(String(r.id || ''))
        );
        if (roomBank.length > 0) {
          const slice = roomBank.slice(0, 60);
          const codes = slice.map((r) => r.question_code).filter(Boolean);
          const ids = slice.map((r) => r.id).filter(Boolean);
          await deleteInChunks(db, 'ltch_question_reports', 'question_code', codes, true, 30);
          await deleteInChunks(db, 'ltch_exam_questions', 'question_code', codes, true, 30);
          await deleteInChunks(db, 'ltch_question_versions', 'question_code', codes, true, 30);
          await deleteInChunks(db, 'ltch_question_bank', 'id', ids, true, 30);
          await deleteInChunks(db, 'ltch_question_bank', 'question_code', codes, true, 30);
          if (roomBank.length > slice.length) {
            return json({
              ok: true,
              done: false,
              phase: 'bank',
              deletedQuestions: slice.length,
              remainingQuestions: roomBank.length - slice.length
            });
          }
        }

        const foldersRes = await db.from('ltch_drive_folders').select('*').limit(1000);
        const folderRows = isMissingSchemaError(foldersRes?.error) ? [] : (data(foldersRes) || []);
        const practiceFolderRows = folderRows.filter((r) => {
          const k = String(r.folder_key || '');
          return (
            k.startsWith('practice:exam:') ||
            k.startsWith('practice:media:') ||
            k.startsWith('practice:source:') ||
            k.startsWith('practice:sol-video:') ||
            k.startsWith('practice:sol-doc:')
          );
        });
        if (useDrive && practiceFolderRows.length > 0) {
          const driveFolderIds = new Set(
            practiceFolderRows
              .filter((r) => String(r.folder_key || '').startsWith('practice:exam:') && r.drive_folder_id)
              .map((r) => r.drive_folder_id)
          );
          if (driveFolderIds.size > 0) {
            const drive = await (openDrive || configuredDrive)(env);
            for (const fid of driveFolderIds) {
              try { await drive.trash({ id: fid }); } catch (err) { if (err?.code !== 'not_found') throw err; }
            }
          }
          await deleteInChunks(db, 'ltch_drive_folders', 'folder_key', practiceFolderRows.map((r) => r.folder_key), true, 50);
        }
        await deleteInChunks(db, 'ltch_question_imports', 'exam_type', EXAM_TYPES, true, 10);
        clearPracticeDriveCaches();
        return json({
          ok: true,
          done: true,
          phase: 'complete',
          deletedQuestions: roomBank.length,
          remainingExams: 0,
          remainingQuestions: 0
        });
      }

      const summaries = await listAllRoomExamSummaries(db);
      const roomExamIds = summaries.map((s) => s.id);
      const [bankRes, foldersRes, examQRes, legacyCodesRes] = await Promise.all([
        selectLightRowsPaged(() => db.from('ltch_question_bank').select('id,question_code,exam_type')),
        db.from('ltch_drive_folders').select('*').limit(1000),
        roomExamIds.length
          ? selectLightRowsPaged(() => db.from('ltch_exam_questions').select('exam_id,question_code').in('exam_id', roomExamIds))
          : Promise.resolve({ data: [], error: null }),
        roomExamIds.length
          ? selectLightRowsPaged(() => db.from('ltch_legacy_question_codes').select('exam_id,old_code,new_code').in('exam_id', roomExamIds))
          : Promise.resolve({ data: [], error: null })
      ]);

      const bankRows = isMissingSchemaError(bankRes?.error) ? [] : (data(bankRes) || []);
      const folderRows = isMissingSchemaError(foldersRes?.error) ? [] : (data(foldersRes) || []);
      const examQRows = isMissingSchemaError(examQRes?.error) ? [] : (data(examQRes) || []);
      const legacyCodeRows = isMissingSchemaError(legacyCodesRes?.error) ? [] : (data(legacyCodesRes) || []);

      const roomQuestionCodes = new Set();
      const examIdsWithDiscoveredCodes = new Set();
      for (const r of examQRows) {
        if (r?.exam_id) examIdsWithDiscoveredCodes.add(r.exam_id);
        if (r?.question_code) roomQuestionCodes.add(r.question_code);
      }
      for (const r of legacyCodeRows) {
        if (r?.old_code) roomQuestionCodes.add(r.old_code);
        if (r?.new_code) roomQuestionCodes.add(r.new_code);
      }

      const matchingBankIds = new Set();
      for (const r of bankRows) {
        const matchedExamId = roomExamIds.find((exId) => String(r.id || '').startsWith(`qb_${exId}_`));
        if (matchedExamId) examIdsWithDiscoveredCodes.add(matchedExamId);
        if (
          EXAM_TYPES.includes(String(r.exam_type || '').toLowerCase()) ||
          Boolean(matchedExamId) ||
          roomQuestionCodes.has(r.question_code)
        ) {
          if (r.id) matchingBankIds.add(r.id);
          if (r.question_code) roomQuestionCodes.add(r.question_code);
        }
      }

      const extraMetaByExamId = new Map();
      for (const s of summaries) {
        if (!examIdsWithDiscoveredCodes.has(s.id) && !s._summaryCounts) {
          const exRes = await db.from('ltch_exams').select('id,questions').eq('id', s.id).maybeSingle();
          if (!exRes?.error && exRes?.data) {
            const norm = normalizeExamRow(exRes.data);
            if (norm?._examMeta) extraMetaByExamId.set(s.id, norm._examMeta);
            for (const q of norm?.questions || []) {
              const code = q?.questionCode || q?.question_code;
              if (code) roomQuestionCodes.add(code);
            }
          }
        }
      }
      for (const r of bankRows) {
        if (roomQuestionCodes.has(r.question_code) && r.id) {
          matchingBankIds.add(r.id);
        }
      }

      const practiceFolderRows = folderRows.filter((r) => {
        const k = String(r.folder_key || '');
        return (
          k.startsWith('practice:exam:') ||
          k.startsWith('practice:media:') ||
          k.startsWith('practice:source:') ||
          k.startsWith('practice:sol-video:') ||
          k.startsWith('practice:sol-doc:')
        );
      });

      if (useDrive) {
        const driveFolderIds = new Set();
        const orphanPackFileIds = new Set();
        for (const r of practiceFolderRows) {
          if (String(r.folder_key || '').startsWith('practice:exam:') && r.drive_folder_id) {
            driveFolderIds.add(r.drive_folder_id);
          }
        }
        for (const s of summaries) {
          const meta = extraMetaByExamId.get(s.id) || s._examMeta;
          if (meta?.driveFolderId) driveFolderIds.add(meta.driveFolderId);
          else if (meta?.drivePackFileId) orphanPackFileIds.add(meta.drivePackFileId);
        }
        if (driveFolderIds.size > 0 || orphanPackFileIds.size > 0) {
          const drive = await (openDrive || configuredDrive)(env);
          for (const fid of driveFolderIds) {
            try { await drive.trash({ id: fid }); } catch (err) { if (err?.code !== 'not_found') throw err; }
          }
          for (const pid of orphanPackFileIds) {
            try { await drive.trash({ id: pid }); } catch (err) { if (err?.code !== 'not_found') throw err; }
          }
        }
        await deleteInChunks(db, 'ltch_drive_folders', 'folder_key', practiceFolderRows.map((r) => r.folder_key));
      }

      const allCodes = [...roomQuestionCodes];
      await deleteInChunks(db, 'ltch_practice_solution_files', 'exam_id', roomExamIds, true, 50);
      await deleteInChunks(db, 'ltch_practice_solutions', 'exam_id', roomExamIds, true, 50);
      await deleteInChunks(db, 'ltch_question_reports', 'exam_id', roomExamIds, true, 50);
      await deleteInChunks(db, 'ltch_question_reports', 'question_code', allCodes, true, 50);
      await deleteInChunks(db, 'ltch_practice_attempts', 'exam_id', roomExamIds, true, 5);
      await deleteInChunks(db, 'ltch_exam_year_shares', 'exam_id', roomExamIds, true, 50);
      await deleteInChunks(db, 'ltch_exam_questions', 'exam_id', roomExamIds, true, 50);
      await deleteInChunks(db, 'ltch_exam_questions', 'question_code', allCodes, true, 50);
      await deleteInChunks(db, 'ltch_legacy_question_codes', 'exam_id', roomExamIds, true, 50);
      await deleteInChunks(db, 'ltch_question_versions', 'question_code', allCodes, true, 50);
      await deleteInChunks(db, 'ltch_question_bank', 'question_code', allCodes, true, 50);
      await deleteInChunks(db, 'ltch_question_bank', 'id', [...matchingBankIds], true, 50);
      await deleteInChunks(db, 'ltch_question_imports', 'exam_id', roomExamIds, true, 50);
      await deleteInChunks(db, 'ltch_question_imports', 'exam_type', EXAM_TYPES, true, 50);
      await deleteInChunks(db, 'ltch_exams', 'id', roomExamIds, false, 5);

      clearPracticeDriveCaches();
      return json({
        ok: true,
        purgedExams: roomExamIds.length,
        purgedQuestionCodes: allCodes.length,
        purgedDriveFolders: practiceFolderRows.length
      });
    }

    if (action === 'clean_orphan_drive_folders') {
      demand(isAdmin(actor), 403, 'Chỉ Quản trị viên mới có quyền dọn thư mục Drive mồ côi.');
      demand(useDrive, 503, 'Google Drive chưa được cấu hình để dọn dẹp.');

      const summaries = await listAllRoomExamSummaries(db);
      const activeExamIds = new Set(summaries.map((s) => s.id));
      const foldersRes = await db.from('ltch_drive_folders').select('*').limit(1000);
      const folderRows = isMissingSchemaError(foldersRes?.error) ? [] : (data(foldersRes) || []);

      const prefixes = [
        'practice:exam:',
        'practice:source:',
        'practice:sol-video:',
        'practice:sol-doc:',
        'practice:media:'
      ];
      const byOrphanExamId = new Map();
      for (const row of folderRows) {
        const key = String(row?.folder_key || '');
        const matchedPrefix = prefixes.find((p) => key.startsWith(p));
        if (!matchedPrefix) continue;
        const examId = key.slice(matchedPrefix.length);
        if (!examId || activeExamIds.has(examId)) continue;
        let list = byOrphanExamId.get(examId);
        if (!list) {
          list = [];
          byOrphanExamId.set(examId, list);
        }
        list.push(row);
      }

      if (byOrphanExamId.size > 0) {
        const extraRes = await db.from('ltch_exams').select('id').in('id', [...byOrphanExamId.keys()]);
        if (!isMissingSchemaError(extraRes?.error)) {
          for (const row of (data(extraRes) || [])) {
            if (row?.id) byOrphanExamId.delete(row.id);
          }
        }
      }

      const batchEntries = [...byOrphanExamId.entries()].slice(0, 6);
      if (batchEntries.length === 0) {
        return json({
          ok: true,
          cleanedExamFolders: 0,
          cleanedFolderKeys: 0,
          remainingOrphanExams: 0
        });
      }

      const drive = await (openDrive || configuredDrive)(env);
      const keysToDelete = [];
      for (const [examId, rows] of batchEntries) {
        const examFolderRow = rows.find((r) => r.folder_key === `practice:exam:${examId}` && r.drive_folder_id);
        const idsToTrash = examFolderRow
          ? [examFolderRow.drive_folder_id]
          : rows.map((r) => r.drive_folder_id).filter(Boolean);
        for (const fid of idsToTrash) {
          try { await drive.trash({ id: fid }); } catch (err) { if (err?.code !== 'not_found') throw err; }
        }
        for (const r of rows) {
          if (r?.folder_key) keysToDelete.push(r.folder_key);
        }
      }

      await deleteInChunks(db, 'ltch_drive_folders', 'folder_key', keysToDelete, true, 50);
      clearPracticeDriveCaches();
      return json({
        ok: true,
        cleanedExamFolders: batchEntries.length,
        cleanedFolderKeys: keysToDelete.length,
        remainingOrphanExams: Math.max(0, byOrphanExamId.size - batchEntries.length)
      });
    }

    if (action === 'prune_non_docx_exam_sources') {
      demand(isAdmin(actor), 403, 'Chỉ Quản trị viên mới có quyền dọn tệp nguồn tạm.');
      demand(useDrive, 503, 'Google Drive chưa được cấu hình để dọn dẹp.');

      const summaries = await listAllRoomExamSummaries(db);
      const solRes = await db.from('ltch_practice_solution_files').select('drive_file_id').limit(2000);
      const solRows = isMissingSchemaError(solRes?.error) ? [] : (data(solRes) || []);
      const protectedIds = new Set(solRows.map((r) => r?.drive_file_id).filter(Boolean));
      const isDocxSource = (sf) => {
        const name = String(sf?.name || '').trim();
        const mime = String(sf?.mimeType || '').trim().toLowerCase();
        return /\.docx$/i.test(name) || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      };

      const candidates = summaries.filter((s) =>
        Array.isArray(s._examMeta?.sourceFiles) &&
        s._examMeta.sourceFiles.some((sf) => sf?.driveFileId && !isDocxSource(sf) && !protectedIds.has(sf.driveFileId))
      );
      const batch = candidates.slice(0, 2);
      if (batch.length === 0) {
        return json({
          ok: true,
          updatedExams: 0,
          trashedFiles: 0,
          remainingExams: 0
        });
      }

      const drive = await (openDrive || configuredDrive)(env);
      let updatedExams = 0;
      let trashedFiles = 0;
      for (const cand of batch) {
        const exam = normalizeExamRow(data(await db.from('ltch_exams').select('*').eq('id', cand.id).maybeSingle()));
        if (!exam) continue;
        const prevSources = Array.isArray(exam._examMeta?.sourceFiles) ? exam._examMeta.sourceFiles : [];
        const keepSources = [];
        const removeSources = [];
        for (const sf of prevSources) {
          if (!sf?.driveFileId) continue;
          if (isDocxSource(sf) || protectedIds.has(sf.driveFileId)) {
            keepSources.push(sf);
          } else {
            removeSources.push(sf);
          }
        }
        for (const sf of removeSources) {
          try {
            await drive.trash({ id: sf.driveFileId });
            trashedFiles++;
          } catch (err) {
            if (err?.code !== 'not_found') throw err;
          }
        }
        const nextUpdatedAt = Math.max(Date.now(), Number(exam.updated_at || 0) + 1);
        const nextMeta = { ...exam._examMeta, sourceFiles: keepSources };
        data(
          await saveExamRowToDb(
            db,
            {
              ...exam,
              driveMeta: nextMeta,
              _expectedUpdatedAt: exam.updated_at,
              updated_at: nextUpdatedAt
            },
            access.activeClasses
          )
        );
        updatedExams++;
      }

      clearPracticeDriveCaches();
      return json({
        ok: true,
        updatedExams,
        trashedFiles,
        remainingExams: Math.max(0, candidates.length - batch.length)
      });
    }

    if (action === 'stage_drive_assets') {
      demand(useDrive, 503, 'Google Drive chưa được cấu hình để lưu trữ bộ đề.');
      const examType = String(b.examType || 'thptqg').toLowerCase();
      demand(EXAM_TYPES.includes(examType), 400, 'Kỳ thi phải là THPTQG, HSA hoặc TSA.');
      const targetGrade = examType === 'thptqg' ? (Number(b.targetGrade) || 12) : 12;
      demand([10, 11, 12].includes(targetGrade), 400, 'Khối lớp của đề phải là 10, 11 hoặc 12.');
      demand(
        canManagePracticePool(actor, access.activeClasses, examType, targetGrade),
        403,
        `Bạn không có quyền tải tệp cho kho ${examType.toUpperCase()} khối ${targetGrade}.`
      );
      const examId = b.examId ? id(b.examId) : `exam_${examType}_${randomUUID().slice(0, 8)}`;
      if (b.examId) {
        const existing = normalizeExamRow(data(await db.from('ltch_exams').select('*').eq('id', examId).maybeSingle()));
        if (existing) {
          demand(
            canManagePracticePool(actor, access.activeClasses, existing.exam_type, existing.target_grade),
            403,
            'Bạn không có quyền sửa bộ đề này.'
          );
        } else {
          demand(
            new RegExp(`^exam_${examType}_[A-Za-z0-9_-]{4,64}$`).test(examId),
            400,
            'Mã bộ đề mới không hợp lệ.'
          );
        }
      }
      const staged = await stagePracticeDriveAssets({
        db,
        env,
        openDrive: openDrive || configuredDrive,
        examId,
        examType,
        title: string(b.title || `Đề ${examType.toUpperCase()}`, 250),
        assets: b.assets
      });
      const signedAssets = staged.assets.map((asset) => {
        if (asset.kind !== 'image') return asset;
        const [signedWrapper] = attachSignedPracticeMediaUrls([{ media: [asset] }], mediaOpts);
        return signedWrapper?.media?.[0] || asset;
      });
      return json({
        ok: true,
        examId,
        examFolderId: staged.examFolderId,
        mediaFolderId: staged.mediaFolderId,
        assets: signedAssets
      });
    }

    if (action === 'restore_media') {
      const examId = id(b.examId);
      let exam = normalizeExamRow(data(await db.from('ltch_exams').select('*').eq('id', examId).maybeSingle()));
      demand(exam, 404, 'Không tìm thấy đề thi.');
      demand(canManagePracticePool(actor, access.activeClasses, exam.exam_type, exam.target_grade), 403, 'Bạn không có quyền sửa hình của đề này.');
      exam = await loadExamQuestionsFromDrive(exam, { env, openDrive });
      const missing = missingPracticeImageIds(exam.questions);
      demand(Array.isArray(b.images) && b.images.length > 0 && b.images.length <= 100, 400, 'Vui lòng chọn từ 1 đến 100 ảnh.');
      const replacements = new Map();
      for (const image of b.images) {
        const imageId = image?.id;
        const src = image?.dataUrl;
        demand(typeof imageId === 'string' && missing.has(imageId) && !replacements.has(imageId), 409, 'Mã ảnh bị trùng hoặc đề đã thay đổi. Hãy mở lại đề.');
        demand(typeof src === 'string' && src.length <= 2_796_232 &&
          /^data:image\/(?:png;base64,iVBORw0KGgo|jpeg;base64,\/9j\/)[A-Za-z0-9+/]*={0,2}$/.test(src),
        400, 'Ảnh phải là PNG/JPG có dung lượng tối đa 2 MB.');
        replacements.set(imageId, src);
      }
      const nextQuestions = restorePracticeImages(exam.questions, replacements);
      const nextUpdatedAt = Math.max(now, Number(exam.updated_at || 0) + 1);
      if (useDrive && exam._examMeta?.storage === 'drive') {
        const packResult = await savePracticeExamPackToDrive({
          db,
          env,
          openDrive: openDrive || configuredDrive,
          examRow: { ...exam, updated_at: nextUpdatedAt },
          enrichedQuestions: nextQuestions,
          sourceFiles: exam._examMeta?.sourceFiles || [],
          previousExam: exam
        });
        data(await saveExamRowToDb(db, {
          ...exam,
          questions: packResult.stubs,
          driveMeta: packResult.driveMeta,
          _expectedUpdatedAt: exam.updated_at,
          updated_at: nextUpdatedAt
        }, access.activeClasses));
        if (packResult.oldPackFileId) {
          try { await (await (openDrive || configuredDrive)(env)).trash({ id: packResult.oldPackFileId }); } catch {}
        }
        return json({
          ok: true,
          restored: replacements.size,
          questions: attachSignedPracticeMediaUrls(packResult.packQuestions, mediaOpts)
        });
      }
      data(await saveExamRowToDb(db, {
        ...exam, questions: nextQuestions, _expectedUpdatedAt: exam.updated_at,
        updated_at: nextUpdatedAt
      }, access.activeClasses));
      return json({ ok: true, restored: replacements.size, questions: nextQuestions });
    }

    if (action === 'toggle_share') {
      const examId = id(b.examId);
      const schoolYearId = id(b.schoolYearId);
      const isEnabled = Boolean(b.isEnabled);
      const exam = normalizeExamRow(data(await db.from('ltch_exams').select('*').eq('id', examId).maybeSingle()));
      demand(exam, 404, 'Không tìm thấy đề thi.');
      demand(
        canManagePracticePool(actor, access.activeClasses, exam.exam_type, exam.target_grade),
        403,
        'Bạn không có quyền chia sẻ đề thi này.'
      );
      const targetGrade = Number(exam.target_grade) || 12;
      demand(targetGrade >= 10 && targetGrade <= 12, 400, 'Khối lớp không hợp lệ.');
      if (isEnabled) {
        const upRes = await db.from('ltch_exam_year_shares').upsert({ exam_id: examId, school_year_id: schoolYearId, target_grade: targetGrade, enabled_by: actor.uid, enabled_at: now }, { onConflict: 'exam_id,school_year_id,target_grade' });
        if (isMissingSchemaError(upRes?.error)) {
          const nextShared = [...new Set([...(exam.shared_school_year_ids || []), schoolYearId])];
          data(await saveExamRowToDb(db, { ...exam, shared_school_year_ids: nextShared, _expectedUpdatedAt: exam.updated_at, updated_at: Math.max(now, Number(exam.updated_at || 0) + 1) }, access.activeClasses));
        } else {
          data(upRes);
        }
      } else {
        if (exam.shared_school_year_ids.includes(schoolYearId)) {
          data(await saveExamRowToDb(db, { ...exam, shared_school_year_ids: exam.shared_school_year_ids.filter(year => year !== schoolYearId), _expectedUpdatedAt:exam.updated_at, updated_at: Math.max(now,Number(exam.updated_at||0)+1) }, access.activeClasses));
        }
        const delRes = await db.from('ltch_exam_year_shares').delete().eq('exam_id', examId).eq('school_year_id', schoolYearId);
        if (!isMissingSchemaError(delRes?.error)) {
          data(delRes);
        }
      }
      return json({ ok: true, examId, schoolYearId, isEnabled });
    }

    if (action === 'change_status') {
      const examId = id(b.examId);
      const nextStatus = String(b.status || '');
      demand(['draft', 'published', 'archived'].includes(nextStatus), 400, 'Trạng thái đề không hợp lệ.');
      const exam = normalizeExamRow(data(await db.from('ltch_exams').select('*').eq('id', examId).maybeSingle()));
      demand(exam, 404, 'Không tìm thấy đề thi.');
      demand(
        canManagePracticePool(actor, access.activeClasses, exam.exam_type, exam.target_grade),
        403,
        'Bạn không có quyền thay đổi trạng thái đề thi này.'
      );
      if (nextStatus === 'published' && !b.allowPartialStructure) {
        const fullExam = await loadExamQuestionsFromDrive(exam, { env, openDrive });
        const check = checkExamStructure(exam.exam_type || 'thptqg', fullExam.questions || [], {
          requireFull: (exam.exam_mode || 'full') === 'full'
        });
        demand(check.valid, 400, check.errors[0] || 'Cấu trúc đề chưa đủ điều kiện phát hành.');
      }
      data(
        await saveExamRowToDb(
          db,
          { ...exam, status: nextStatus, _expectedUpdatedAt:exam.updated_at, updated_at: Math.max(now,Number(exam.updated_at||0)+1) },
          access.activeClasses
        )
      );
      return json({ ok: true, examId, status: nextStatus });
    }

    if (action === 'delete_draft' || action === 'delete_exam') {
      const examId = id(b.examId);
      const exam = normalizeExamRow(data(await db.from('ltch_exams').select('*').eq('id', examId).maybeSingle()));
      demand(exam, 404, 'Không tìm thấy đề thi.');
      demand(
        canManagePracticePool(actor, access.activeClasses, exam.exam_type, exam.target_grade),
        403,
        'Bạn không có quyền xóa đề này.'
      );
      if (action === 'delete_draft') {
        demand(exam.status === 'draft', 400, 'Chỉ được xóa đề đang ở trạng thái Bản nháp.');
      }

      const questionCodes = (exam.questions || [])
        .map((q) => q?.questionCode || q?.question_code)
        .filter(Boolean);

      const safeDeleteByExamId = async (tableName) => {
        const res = await db.from(tableName).delete().eq('exam_id', examId);
        if (res?.error && !isMissingSchemaError(res.error)) data(res);
      };
      await safeDeleteByExamId('ltch_practice_solution_files');
      await safeDeleteByExamId('ltch_practice_solutions');
      await safeDeleteByExamId('ltch_question_reports');
      await safeDeleteByExamId('ltch_practice_attempts');
      await safeDeleteByExamId('ltch_exam_year_shares');
      await safeDeleteByExamId('ltch_exam_questions');
      await safeDeleteByExamId('ltch_legacy_question_codes');

      let delQuery = db.from('ltch_exams').delete().eq('id', examId);
      if (action === 'delete_draft') delQuery = delQuery.eq('status', 'draft');
      if (exam.updated_at !== undefined && exam.updated_at !== null) {
        delQuery = delQuery.eq('updated_at', exam.updated_at);
      }
      const delRes = await delQuery.select('id');
      if (isMissingSchemaError(delRes?.error)) {
        let fallback = db.from('ltch_exams').delete().eq('id', examId);
        if (action === 'delete_draft') fallback = fallback.eq('status', 'draft');
        data(await fallback);
      } else {
        const removed = data(delRes);
        demand(Array.isArray(removed) && removed.length === 1, 409, 'Đề thi vừa thay đổi. Hãy tải lại.');
      }

      await deleteInChunks(db, 'ltch_question_versions', 'question_code', questionCodes);
      await deleteInChunks(db, 'ltch_question_bank', 'question_code', questionCodes);

      if (useDrive) {
        await trashPracticeExamOnDrive({
          db,
          env,
          openDrive: openDrive || configuredDrive,
          examId,
          driveFolderId: exam._examMeta?.driveFolderId,
          drivePackFileId: exam._examMeta?.drivePackFileId
        });
      }

      return json({ ok: true, deletedExamId: examId });
    }

    // action === 'save_draft' | 'publish'
    const examType = String(b.examType || 'thptqg').toLowerCase();
    demand(EXAM_TYPES.includes(examType), 400, 'Kỳ thi phải là THPTQG, HSA hoặc TSA.');
    const targetGrade = examType === 'thptqg' ? (Number(b.targetGrade) || 12) : 12;
    demand([10, 11, 12].includes(targetGrade), 400, 'Khối lớp của đề phải là 10, 11 hoặc 12.');
    demand(
      canManagePracticePool(actor, access.activeClasses, examType, targetGrade),
      403,
      `Bạn không có quyền đăng tải hoặc chỉnh sửa đề cho kho ${examType.toUpperCase()} khối ${targetGrade}.`
    );
    const examId = b.examId ? id(b.examId) : `exam_${examType}_${randomUUID().slice(0, 8)}`;
    let previousExam = null;
    let expectedPreviousUpdatedAt = null;
    if (b.examId) {
      const rawPrevExam = data(await db.from('ltch_exams').select('*').eq('id', examId).maybeSingle());
      previousExam = normalizeExamRow(rawPrevExam);
      if (previousExam) {
        demand(canManagePracticePool(actor, access.activeClasses, previousExam.exam_type, previousExam.target_grade), 403, 'Bạn không có quyền chỉnh sửa đề thi này.');
        if (rawPrevExam.updated_at === null || rawPrevExam.updated_at === undefined) {
          const backfilledUpdatedAt = Number(previousExam.updated_at) || now;
          const backfillRes = await db
            .from('ltch_exams')
            .update({ updated_at: backfilledUpdatedAt })
            .eq('id', examId);
          if (!isMissingSchemaError(backfillRes?.error)) {
            data(backfillRes);
            previousExam.updated_at = backfilledUpdatedAt;
            expectedPreviousUpdatedAt = backfilledUpdatedAt;
          }
        } else {
          expectedPreviousUpdatedAt = rawPrevExam.updated_at;
        }
        if (previousExam._examMeta?.storage === 'drive') {
          previousExam = await loadExamQuestionsFromDrive(previousExam, { env, openDrive });
        }
      } else {
        demand(
          Boolean(b.isNewExam) && new RegExp(`^exam_${examType}_[A-Za-z0-9_-]{4,64}$`).test(examId),
          404,
          'Không tìm thấy đề thi.'
        );
      }
    }

    const title = string(b.title, 250);
    const examCode = string(b.examCode || '01', 40, true);
    const examMode = b.examMode === 'section' ? 'section' : 'full';
    const schoolYearId =
      typeof b.schoolYearId === 'string' && b.schoolYearId.trim()
        ? id(b.schoolYearId.trim())
        : access.currentSchoolYearId;
    const durationMinutes =
      Number.isInteger(b.durationMinutes) && b.durationMinutes >= 5 && b.durationMinutes <= 300
        ? b.durationMinutes
        : examType === 'thptqg'
          ? 90
          : examType === 'hsa'
            ? 195
            : 150;

    const validatedQuestions = validateQuestions(b.questions, { examType });
    const structureCheck = checkExamStructure(examType, validatedQuestions, {
      requireFull: action === 'publish' && examMode === 'full' && !b.allowPartialStructure
    });
    if (action === 'publish' && !structureCheck.valid) {
      throw new ApiError(400, structureCheck.errors[0] || 'Đề chưa đủ cấu trúc câu hỏi để phát hành.');
    }

    const prevByCode = new Map();
    const prevBySlotId = new Map();
    if (previousExam && Array.isArray(previousExam.questions)) {
      previousExam.questions.forEach((pq, idx) => {
        const c = pq?.questionCode || pq?.question_code;
        if (c) {
          prevByCode.set(c, pq);
          if (previousExam.exam_type === examType) {
            const slotKey = pq?.id || `q_${idx + 1}`;
            if (!prevBySlotId.has(slotKey)) prevBySlotId.set(slotKey, c);
          }
        }
      });
    }

    const usedCodes = new Set(
      validatedQuestions.map((q) => q.questionCode || q.question_code).filter(Boolean)
    );
    const resolvedInputQuestions = validatedQuestions.map((q, idx) => {
      const explicitCode = q.questionCode || q.question_code;
      if (explicitCode) return q;
      const slotKey = q.id || `q_${idx + 1}`;
      const inheritedCode = prevBySlotId.get(slotKey);
      if (inheritedCode && !usedCodes.has(inheritedCode)) {
        usedCodes.add(inheritedCode);
        return { ...q, questionCode: inheritedCode };
      }
      return q;
    });

    // Cấp mã định danh #LTCH-xxxx cho các câu hỏi chưa có mã
    const missingCodeCount = resolvedInputQuestions.filter((q) => !q.questionCode && !q.question_code).length;
    const newCodes = missingCodeCount > 0 ? await allocateQuestionCodes(db, missingCodeCount) : [];
    let codeCursor = 0;

    const enrichedQuestions = resolvedInputQuestions.map((q, idx) => {
      const qCode = q.questionCode || q.question_code || newCodes[codeCursor++];
      const prevQ = prevByCode.get(qCode);
      const baseQ = {
        ...q,
        id: q.id || `q_${idx + 1}`,
        order: idx + 1,
        questionCode: qCode,
        version: Math.max(Number(q.version) || 1, Number(prevQ?.version) || 1)
      };
      if (prevQ && canonicalJson(stripEphemeralQuestionFields(prevQ)) !== canonicalJson(stripEphemeralQuestionFields(baseQ))) {
        baseQ.version = Math.max(baseQ.version, (Number(prevQ.version) || 1) + 1);
      }
      return baseQ;
    });

    const nextStatus = action === 'publish' ? 'published' : 'draft';
    const opensAt = Number.isSafeInteger(b.opensAt) ? b.opensAt : now;
    const closesAt = Number.isSafeInteger(b.closesAt) ? b.closesAt : now + 365 * 86400_000;
    const updatedAt = previousExam ? Math.max(now, Number(previousExam.updated_at || 0) + 1) : now;

    if (useDrive) {
      const preReconciled = await reconcileQuestionsWithBankAndVersions(db, examId, enrichedQuestions, {
        forDriveStub: true
      });
      const examRowBase = {
        id: examId,
        class_id: null,
        title,
        exam_code: examCode,
        exam_type: examType,
        exam_mode: examMode,
        target_grade: targetGrade,
        school_year_id: schoolYearId,
        duration_minutes: durationMinutes,
        section_config: EXAM_SECTION_CONFIG[examType] || [],
        status: nextStatus,
        opens_at: opensAt,
        closes_at: closesAt,
        results_at: opensAt,
        solutions_at: opensAt,
        created_by: previousExam?.created_by || actor.uid,
        updated_at: updatedAt
      };
      const packResult = await savePracticeExamPackToDrive({
        db,
        env,
        openDrive: openDrive || configuredDrive,
        examRow: examRowBase,
        enrichedQuestions: preReconciled.reconciledQuestions,
        sourceFiles: b.sourceFiles || [],
        previousExam
      });
      await saveExamAndQuestionVersions(
        db,
        { ...examRowBase, questions: packResult.stubs, driveMeta: packResult.driveMeta },
        actor,
        now,
        'Khởi tạo/cập nhật từ trình đăng tải đề (Drive)',
        expectedPreviousUpdatedAt,
        access.activeClasses,
        preReconciled.state
      );
      if (packResult.oldPackFileId) {
        try { await (await (openDrive || configuredDrive)(env)).trash({ id: packResult.oldPackFileId }); } catch {}
      }
      return json(
        {
          ok: true,
          examId,
          status: nextStatus,
          questionCount: enrichedQuestions.length,
          structure: structureCheck,
          questions: attachSignedPracticeMediaUrls(packResult.packQuestions, mediaOpts)
        },
        201
      );
    }

    const examRow = {
      id: examId,
      class_id: null,
      title,
      exam_code: examCode,
      exam_type: examType,
      exam_mode: examMode,
      target_grade: targetGrade,
      school_year_id: schoolYearId,
      duration_minutes: durationMinutes,
      section_config: EXAM_SECTION_CONFIG[examType] || [],
      status: nextStatus,
      opens_at: opensAt,
      closes_at: closesAt,
      results_at: opensAt,
      solutions_at: opensAt,
      questions: enrichedQuestions,
      created_by: previousExam?.created_by || actor.uid,
      updated_at: updatedAt
    };

    await saveExamAndQuestionVersions(db, examRow, actor, now, 'Khởi tạo/cập nhật từ trình đăng tải đề', expectedPreviousUpdatedAt, access.activeClasses);

    return json(
      {
        ok: true,
        examId,
        status: nextStatus,
        questionCount: enrichedQuestions.length,
        structure: structureCheck,
        questions: enrichedQuestions
      },
      201
    );
  }

  // 8. Quản lý Kho câu hỏi & Phiên bản câu hỏi (v1 -> v2 + chấm lại): /api/admin/practice/questions
  if (path === '/api/admin/practice/questions') {
    const access = await computePracticeAccess(db, actor);
    demand(access.isStaff && access.canManageAny, 403, 'Bạn không có quyền quản lý ngân hàng câu hỏi.');
    const mediaOpts = { env, requestUrl: request.url };
    const useDrive = isPracticeDriveConfigured(env, openDrive);

    if (method === 'GET') {
      const sp = new URL(request.url).searchParams;
      const examTypeFilter = sp.get('examType')?.toLowerCase() || '';
      const qSearch = (sp.get('q') || '').trim().toLowerCase();

      const examsRes = await db
        .from('ltch_exams')
        .select('*')
        .order('opens_at', { ascending: false })
        .limit(100);
      const exams = (data(examsRes) || [])
        .map(normalizeExamRow)
        .filter((e) => e && EXAM_TYPES.includes(e.exam_type));

      const items = [];
      for (const rawEx of exams) {
        if (examTypeFilter && rawEx.exam_type !== examTypeFilter) continue;
        if (!canManagePracticePool(actor, access.activeClasses, rawEx.exam_type, rawEx.target_grade)) continue;
        const ex = await loadExamQuestionsFromDrive(rawEx, { env, openDrive });
        const qs = Array.isArray(ex.questions) ? ex.questions : [];
        for (const q of qs) {
          const code = String(q.questionCode || q.question_code || '').toLowerCase();
          const prompt = String(q.prompt || '').toLowerCase();
          if (qSearch && !code.includes(qSearch) && !prompt.includes(qSearch)) continue;
          const [signedQ] = attachSignedPracticeMediaUrls([q], mediaOpts);
          items.push({
            examId: ex.id,
            examTitle: ex.title,
            examCode: ex.exam_code || '',
            examType: ex.exam_type,
            targetGrade: ex.target_grade,
            question: signedQ || q
          });
          if (items.length >= 200) break;
        }
        if (items.length >= 200) break;
      }
      return json({ items });
    }

    demand(method === 'POST', 405);
    const b = await readJson(request, 262144);
    const examId = id(b.examId);
    const questionId = string(b.questionId, 64);

    let exam = normalizeExamRow(data(await db.from('ltch_exams').select('*').eq('id', examId).maybeSingle()));
    demand(exam, 404, 'Không tìm thấy đề chứa câu hỏi này.');
    demand(
      canManagePracticePool(actor, access.activeClasses, exam.exam_type, exam.target_grade),
      403,
      'Bạn không có quyền sửa câu hỏi thuộc kho đề này.'
    );
    exam = await loadExamQuestionsFromDrive(exam, { env, openDrive });

    const questions = Array.isArray(exam.questions) ? [...exam.questions] : [];
    const requestedCode = typeof b.questionCode === 'string' ? b.questionCode.trim() : '';
    let idx = questions.findIndex((q) => q.id === questionId);
    if (idx < 0 && requestedCode) {
      idx = questions.findIndex((q) => (q.questionCode || q.question_code) === requestedCode);
    }
    demand(idx >= 0, 404, 'Không tìm thấy câu hỏi trong đề.');

    const oldQ = questions[idx];
    const validated = validateQuestions([{ ...oldQ, ...b.question, id: oldQ.id }], {
      examType: String(exam.exam_type || 'thptqg').toLowerCase()
    })[0];
    const nextVersion = (Number(oldQ.version) || 1) + 1;
    const updatedQ = {
      ...oldQ,
      ...validated,
      id: oldQ.id,
      order: oldQ.order || idx + 1,
      questionCode: oldQ.questionCode || oldQ.question_code || `LTCH-${idx + 1}`,
      version: nextVersion
    };
    questions[idx] = updatedQ;
    const nextUpdatedAt = Math.max(now, Number(exam.updated_at || 0) + 1);
    const editNote = string(b.changeNote || 'Cập nhật nội dung/đáp án câu hỏi', 500, true);

    if (useDrive && exam._examMeta?.storage === 'drive') {
      const packResult = await savePracticeExamPackToDrive({
        db,
        env,
        openDrive: openDrive || configuredDrive,
        examRow: { ...exam, updated_at: nextUpdatedAt },
        enrichedQuestions: questions,
        sourceFiles: exam._examMeta?.sourceFiles || [],
        previousExam: exam
      });
      await saveExamAndQuestionVersions(
        db,
        { ...exam, questions: packResult.stubs, driveMeta: packResult.driveMeta, updated_at: nextUpdatedAt },
        actor,
        now,
        editNote,
        exam.updated_at,
        access.activeClasses
      );
      if (packResult.oldPackFileId) {
        try { await (await (openDrive || configuredDrive)(env)).trash({ id: packResult.oldPackFileId }); } catch {}
      }
    } else {
      await saveExamAndQuestionVersions(db, { ...exam, questions, updated_at: nextUpdatedAt }, actor, now, editNote, exam.updated_at, access.activeClasses);
    }

    // Nếu giáo viên chọn "Chấm lại các bài đã nộp bị ảnh hưởng bởi đáp án câu này"
    let regradedCount = 0;
    if (b.regradeAffectedAttempts) {
      const isDriveExam = exam._examMeta?.storage === 'drive' || useDrive;
      const attRes = await db
        .from('ltch_practice_attempts')
        .select('*')
        .eq('exam_id', examId);
      const submittedAttempts = (data(attRes) || []).map(normalizeAttemptRow).filter((a) => a && a.status === 'submitted');
      for (const att of submittedAttempts) {
        const attQs = Array.isArray(att.attempt_questions) ? [...att.attempt_questions] : [];
        const aIdx = attQs.findIndex(
          (aq) => aq.id === updatedQ.id || aq.questionCode === updatedQ.questionCode
        );
        if (aIdx >= 0) {
          const replacement = isDriveExam ? compactQuestionStub(updatedQ) : updatedQ;
          attQs[aIdx] = { ...attQs[aIdx], ...replacement, displayNumber: attQs[aIdx].displayNumber };
          const regraded = gradeAttemptQuestions(attQs, att.responses || {});
          await saveAttemptRowToDb(
            db,
            {
              ...att,
              attempt_questions: attQs,
              score: regraded.score,
              max_score: regraded.max,
              results: regraded.results
            },
            { isInsert: false }
          );
          regradedCount++;
        }
      }
    }

    const [signedUpdatedQ] = attachSignedPracticeMediaUrls([updatedQ], mediaOpts);
    return json({ ok: true, question: signedUpdatedQ || updatedQ, version: nextVersion, regradedCount });
  }

  // 9. Quản lý Báo lỗi câu hỏi của học sinh: /api/admin/practice/reports
  if (path === '/api/admin/practice/reports') {
    const access = await computePracticeAccess(db, actor);
    demand(access.isStaff && access.canManageAny, 403, 'Bạn không có quyền quản lý báo lỗi câu hỏi.');

    if (method === 'GET') {
      let reports = [];
      {
        const repRes = await db
          .from('ltch_question_reports')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        const repRows = isMissingSchemaError(repRes?.error) ? [] : (data(repRes) || []);
        reports = repRows.map(r => ({ ...r, note: r.description, status: r.status === 'fixed' ? 'resolved' : r.status === 'rejected' ? 'dismissed' : 'open' }));
      }
      try {
        let attQuery = db
          .from('ltch_practice_attempts')
          .select('id,exam_id,uid,submitted_at,legacy_reports:responses->_questionReports');
        if (typeof attQuery.not === 'function') {
          attQuery = attQuery.not('responses->_questionReports', 'is', null);
        }
        const attRes = await attQuery.limit(300);
        if (!attRes.error && Array.isArray(attRes.data)) {
          for (const rawRow of attRes.data) {
            const list = Array.isArray(rawRow.legacy_reports)
              ? rawRow.legacy_reports
              : Array.isArray(rawRow.responses?._questionReports)
                ? rawRow.responses._questionReports
                : [];
            for (const r of list) {
              if (!reports.some((x) => x.id === r.id)) reports.push(r);
            }
          }
        }
      } catch {}
      reports.sort((a, b) => (Number(b.created_at) || 0) - (Number(a.created_at) || 0));
      return json({ items: reports });
    }

    demand(method === 'POST', 405);
    const b = await readJson(request, 16384);
    const reportId = id(b.reportId);
    const status = ['resolved', 'dismissed', 'open'].includes(b.status) ? b.status : 'resolved';
    const resolutionNote = string(b.resolutionNote || '', 2000, true);

    const databaseStatus = status === 'resolved' ? 'fixed' : status === 'dismissed' ? 'rejected' : 'new';
    const updRes = await db
      .from('ltch_question_reports')
      .update({
        status: databaseStatus,
        resolution_note: resolutionNote,
        resolved_by: actor.uid,
        resolved_at: now
      })
      .eq('id', reportId).select('id');

    const updatedReports = isMissingSchemaError(updRes?.error) ? [] : (data(updRes) || []);
    if (!updatedReports.length) {
      const attRes = await db.from('ltch_practice_attempts').select('*').limit(300);
      let found = false;
      if (!attRes.error && Array.isArray(attRes.data)) {
        for (const rawRow of attRes.data) {
          const norm = normalizeAttemptRow(rawRow);
          if (norm && Array.isArray(norm._questionReports)) {
            const idx = norm._questionReports.findIndex((r) => r.id === reportId);
            if (idx >= 0) {
              const nextReports = [...norm._questionReports];
              nextReports[idx] = {
                ...nextReports[idx],
                status,
                resolution_note: resolutionNote,
                resolved_by: actor.uid,
                resolved_at: now
              };
              await saveAttemptRowToDb(db, { ...norm, _questionReports: nextReports }, { isInsert: false });
              found = true;
              break;
            }
          }
        }
      }
      demand(found, 404, 'Không tìm thấy báo lỗi.');
    }

    return json({ ok: true, reportId, status });
  }

  return null;
}
