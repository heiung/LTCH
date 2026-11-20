export const timeZone = 'Asia/Ho_Chi_Minh';
export const weekDays = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
const collator = new Intl.Collator('vi', {numeric: true, sensitivity: 'base'});

export function className(name) {
  return String(name).trim().replace(/^(Lớp\s*)?(10|11|12)\s*A([12])(?=\s|\(|$)/i, (_, prefix, grade, section) => `${prefix || ''}${grade}${section === '1' ? 'A' : 'B'}`);
}

export function classGrade(name) {
  return Number(/^(?:Lớp\s*)?(1[012]|[6-9])(?=\s*[A-Z]|\s|$)/i.exec(className(name))?.[1]) || 99;
}

export function promoteClassName(name) {
  const norm = className(name || '');
  const grade = classGrade(norm);
  if (grade < 6 || grade >= 12) return null;
  const match = /^(Lớp\s*)?(1[01]|[6-9])(\s*[A-Z]\b.*|\b.*)?$/i.exec(norm);
  if (!match) return `Lớp ${grade + 1}`;
  const prefix = match[1] ? 'Lớp ' : 'Lớp ';
  const suffix = (match[3] || '').trim();
  return `${prefix}${grade + 1}${suffix}`;
}

export function planSchoolYearCohortTransition(activeClasses = [], currentStartYear = null, newGrade6Specs = ['Lớp 6']) {
  const startYear = Number.isInteger(currentStartYear) && currentStartYear >= 2000
    ? currentStartYear
    : (activeClasses.length ? Math.max(...activeClasses.map(c => schoolYearStart(c))) : 2026);
  const nextStartYear = startYear + 1;
  const nextEndYear = nextStartYear + 1;
  const nextSchoolYearId = `year-${nextStartYear}-${nextEndYear}`;
  const nextSchoolYearName = `${nextStartYear} - ${nextEndYear}`;

  const sorted = sortClasses(activeClasses.filter(c => !c.archived));
  const toArchive = [];
  const toPromote = [];

  for (const c of sorted) {
    const grade = classGrade(c.name);
    const slug = classCohortSlug(c, sorted);
    const currentYearId = c.schoolYearId || c.school_year_id || `year-${startYear}-${startYear + 1}`;
    if (grade === 12) {
      toArchive.push({
        id: c.id,
        name: className(c.name),
        schoolYearId: currentYearId,
        cohortSlug: slug,
        routePath: `/class/${slug}`,
        patch: { archived: true, enrollment_open: false }
      });
    } else if (grade >= 6 && grade <= 11) {
      const nextName = promoteClassName(c.name);
      toPromote.push({
        id: c.id,
        fromName: className(c.name),
        toName: nextName,
        fromGrade: grade,
        toGrade: grade + 1,
        fromSchoolYearId: currentYearId,
        toSchoolYearId: nextSchoolYearId,
        cohortSlug: slug,
        routePath: `/class/${slug}`,
        patch: { name: nextName, school_year_id: nextSchoolYearId }
      });
    }
  }

  const normalizedSpecs = (Array.isArray(newGrade6Specs) && newGrade6Specs.length ? newGrade6Specs : ['Lớp 6'])
    .map(s => className(String(typeof s === 'object' && s !== null ? (s.name || '') : (s || '')).trim()))
    .filter(Boolean);
  const tempGrade6List = normalizedSpecs.map((name, idx) => ({
    id: `new-grade6-${idx + 1}`,
    name: classGrade(name) === 6 ? name : `Lớp 6${normalizedSpecs.length > 1 ? String.fromCharCode(65 + idx) : ''}`,
    schoolYearId: nextSchoolYearId,
    school_year_id: nextSchoolYearId
  }));
  const toCreateGrade6 = tempGrade6List.map(item => {
    const slug = classCohortSlug(item, tempGrade6List);
    return {
      name: item.name,
      schoolYearId: nextSchoolYearId,
      cohortSlug: slug,
      routePath: `/class/${slug}`,
      row: {
        name: item.name,
        school_year_id: nextSchoolYearId,
        archived: false,
        enrollment_open: true
      }
    };
  });

  return {
    currentStartYear: startYear,
    sourceStartYear: startYear,
    nextStartYear,
    nextEndYear,
    nextSchoolYearId,
    nextSchoolYearName,
    nextSchoolYear: {
      id: nextSchoolYearId,
      name: nextSchoolYearName,
      starts_on: `${nextStartYear}-08-01`,
      ends_on: `${nextEndYear}-05-31`
    },
    startsOn: `${nextStartYear}-08-01`,
    endsOn: `${nextEndYear}-05-31`,
    toArchive,
    toPromote,
    toCreateGrade6,
    toCreate: toCreateGrade6
  };
}

export function sortClasses(items) {
  return items.map(c => ({...c, name: className(c.name)})).sort((a, b) => classGrade(a.name) - classGrade(b.name) || collator.compare(a.name, b.name) || collator.compare(a.id, b.id));
}

export function groupClasses(items) {
  const sorted = sortClasses(items);
  const grades = [6, 7, 8, 9, 10, 11, 12];
  const groups = grades.map(grade => ({optgroup: `Khối ${grade} · ${grade < 10 ? 'THCS' : 'THPT'}`, options: sorted.filter(c => classGrade(c.name) === grade).map(c => ({value: c.id, label: c.name}))})).filter(g => g.options.length);
  const others = sorted.filter(c => !grades.includes(classGrade(c.name)));
  if (others.length) groups.push({optgroup: 'Lớp chuyên đề khác', options: others.map(c => ({value: c.id, label: c.name}))});
  return groups;
}

export function validateSchedule(slots) {
  if (!Array.isArray(slots) || slots.length > 14) throw Error('Lịch học có tối đa 14 buổi trong tuần.');
  const result = slots.map(slot => {
    if (!slot || !Number.isInteger(slot.day) || slot.day < 1 || slot.day > 7 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot.end) || slot.end <= slot.start) throw Error('Chọn thứ, giờ bắt đầu và giờ kết thúc hợp lệ. Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.');
    return {day: slot.day, start: slot.start, end: slot.end};
  }).sort((a, b) => a.day - b.day || collator.compare(a.start, b.start));
  for (let i = 1; i < result.length; i++) if (result[i].day === result[i-1].day && result[i].start < result[i-1].end) throw Error('Các buổi học cùng ngày không được trùng giờ.');
  return result;
}

export function scheduleText(slots) {
  return validateSchedule(slots).map(s => `${weekDays[s.day - 1]} · ${s.start}–${s.end}`).join('; ');
}

export function schoolYearStart(schoolYearOrClass) {
  const raw = typeof schoolYearOrClass === 'object' && schoolYearOrClass !== null
    ? (schoolYearOrClass.schoolYearId || schoolYearOrClass.school_year_id || schoolYearOrClass.schoolYearName || '')
    : String(schoolYearOrClass || '');
  const match = /(20\d{2})/.exec(String(raw || ''));
  return match ? Number(match[1]) : 2026;
}

export function classCohortSlug(klass, allClasses = []) {
  if (!klass || typeof klass !== 'object') return 'class';
  const norm = className(klass.name || '');
  const grade = classGrade(norm);
  if (grade < 6 || grade > 12) {
    return String(klass.id || 'class').replace(/[^A-Za-z0-9_-]/g, '');
  }
  const startYear = schoolYearStart(klass);
  const grade6Year = startYear - (grade - 6);
  const secMatch = /^(?:Lớp\s*)?(?:1[012]|[6-9])\s*([A-Z])\b/i.exec(norm);
  const letter = secMatch ? secMatch[1].toUpperCase() : '';
  const yearKey = klass.schoolYearId || klass.school_year_id || '';
  const sameGrade = Array.isArray(allClasses)
    ? allClasses.filter(item => item && classGrade(item.name) === grade && (item.schoolYearId || item.school_year_id || '') === yearKey)
    : [];
  if (letter) {
    return `${grade6Year}${letter}`;
  }
  if (sameGrade.length > 1) {
    const sortedSame = sortClasses(sameGrade);
    const idx = sortedSame.findIndex(item => item.id === klass.id);
    if (idx >= 0) return `${grade6Year}${String.fromCharCode(65 + idx)}`;
  }
  return String(grade6Year);
}

export function findClassByCohortSlug(arg1, arg2 = []) {
  const classes = Array.isArray(arg1) ? arg1 : (Array.isArray(arg2) ? arg2 : []);
  const slug = Array.isArray(arg1) ? arg2 : arg1;
  const clean = String(slug || '').trim().replace(/\.html$/i, '');
  if (!clean || !Array.isArray(classes) || !classes.length) return null;
  const upper = clean.toUpperCase();
  for (const c of classes) {
    if (classCohortSlug(c, classes).toUpperCase() === upper) return c;
  }
  const yearOnlyMatch = /^(20\d{2})([A-Z])?$/i.exec(clean);
  if (yearOnlyMatch) {
    const targetYear = Number(yearOnlyMatch[1]);
    const targetLetter = (yearOnlyMatch[2] || '').toUpperCase();
    const candidates = classes.filter(c => {
      const g = classGrade(c.name);
      if (g < 6 || g > 12) return false;
      const y6 = schoolYearStart(c) - (g - 6);
      return y6 === targetYear;
    });
    if (targetLetter) {
      const exactLetter = candidates.find(c => {
        const m = /^(?:Lớp\s*)?(?:1[012]|[6-9])\s*([A-Z])\b/i.exec(className(c.name));
        return m && m[1].toUpperCase() === targetLetter;
      });
      if (exactLetter) return exactLetter;
    }
    if (candidates.length === 1) return candidates[0];
  }
  return classes.find(c => String(c.id || '').toLowerCase() === clean.toLowerCase()) || null;
}

const TAB_TO_SEGMENT = {
  notices: 'notifications',
  operations: 'operations',
  materials: 'materials',
  assignments: 'assignments',
  practice: 'practice',
  attendance: 'attendance',
  forum: 'forum'
};

const SEGMENT_TO_TAB = {
  notifications: 'notices',
  notices: 'notices',
  operations: 'operations',
  materials: 'materials',
  assignments: 'assignments',
  practice: 'practice',
  attendance: 'attendance',
  forum: 'forum'
};

export function parsePracticeSubPage(subPage = '') {
  const raw = String(subPage || '').trim().replace(/^\/+|\/+$/g, '');
  if (!raw) return { examType: null, examId: null, isSolutionPage: false };
  const twoSeg = /^(thptqg|hsa|tsa|past)\/([A-Za-z0-9_-]{1,128})$/i.exec(raw);
  if (twoSeg) {
    return {
      examType: twoSeg[1].toLowerCase(),
      examId: twoSeg[2],
      isSolutionPage: true
    };
  }
  const lower = raw.toLowerCase();
  if (['thptqg', 'hsa', 'tsa', 'past'].includes(lower)) {
    return { examType: lower, examId: null, isSolutionPage: false };
  }
  return { examType: null, examId: null, isSolutionPage: false };
}

export const SETTINGS_SUBPAGES = ['profile', 'security', 'privacy'];

export function normalizeSettingsSubPage(subPage = null) {
  const clean = String(subPage || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
  if (!clean || clean === 'profile' || clean === 'learning') return null;
  return SETTINGS_SUBPAGES.includes(clean) ? clean : null;
}

export function buildAppRoutePath({
  nav,
  page,
  klass,
  selectedClass,
  allClasses = [],
  classTab,
  activeClassTab,
  isClassEntry = false,
  materialsSubTab = 'files',
  subPage = null
} = {}) {
  const resolvedNav = nav || page || 'home';
  const resolvedClass = klass || selectedClass || null;
  const resolvedTab = classTab !== undefined ? classTab : (activeClassTab || null);
  if (resolvedNav === 'settings') {
    const normalized = normalizeSettingsSubPage(subPage);
    return normalized ? `/settings/${normalized}` : '/settings';
  }
  if (resolvedNav === 'admin') {
    if (subPage === 'staff') return '/admin/staff';
    if (subPage === 'enrollments') return '/admin/enrollments';
    return '/admin';
  }
  if (resolvedNav === 'enrollments') return '/enrollments';
  if (resolvedNav === 'onboarding') return '/onboarding';
  if (resolvedNav === 'archive') return '/archive';
  if (resolvedNav === 'practice') {
    const parsedPractice = parsePracticeSubPage(subPage);
    if (parsedPractice.isSolutionPage) {
      return `/practice/${parsedPractice.examType}/${parsedPractice.examId}`;
    }
    if (parsedPractice.examType) {
      return `/practice/${parsedPractice.examType}`;
    }
    return '/practice';
  }
  if (resolvedNav === 'classes') {
    if (!resolvedClass) return '/class';
    const slug = classCohortSlug(resolvedClass, allClasses);
    if (isClassEntry || !resolvedTab) return `/class/${slug}`;
    if ((resolvedTab === 'materials' || resolvedTab === 'assignments') && typeof subPage === 'string' && /^buoi-\d{1,3}$/i.test(subPage)) {
      const seg = TAB_TO_SEGMENT[resolvedTab] || resolvedTab;
      return `/class/${slug}/${seg}/${subPage.toLowerCase()}`;
    }
    if (resolvedTab === 'materials' && materialsSubTab === 'videos') {
      return `/class/${slug}/materials/videos`;
    }
    if (resolvedTab === 'practice' && typeof subPage === 'string') {
      if (subPage.toLowerCase() === 'questions') {
        return `/class/${slug}/practice/questions`;
      }
      const parsedPractice = parsePracticeSubPage(subPage);
      if (parsedPractice.isSolutionPage) {
        return `/class/${slug}/practice/${parsedPractice.examType}/${parsedPractice.examId}`;
      }
      if (parsedPractice.examType) {
        return `/class/${slug}/practice/${parsedPractice.examType}`;
      }
    }
    if (resolvedTab === 'attendance' && typeof subPage === 'string') {
      const parsedDate = parseIsoDateParts(subPage);
      if (parsedDate) {
        return `/class/${slug}/attendance/${parsedDate.iso}`;
      }
    }
    if (resolvedTab === 'forum' && typeof subPage === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(subPage.trim())) {
      return `/class/${slug}/forum/${subPage.trim()}`;
    }
    const seg = TAB_TO_SEGMENT[resolvedTab] || 'notifications';
    return `/class/${slug}/${seg}`;
  }
  return '/overview';
}

export function parseAppRoutePath(pathname = '/') {
  const raw = String(pathname || '/').trim().replace(/\/+$/, '') || '/';
  const lower = raw.toLowerCase();
  if (lower === '/' || lower === '/login' || lower === '/login.html' || lower === '/app' || lower === '/app.html' || lower === '/overview' || lower === '/overview.html') {
    return { page: 'home', nav: 'home', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: null };
  }
  if (lower === '/class' || lower === '/class.html' || lower === '/classes' || lower === '/classes.html') {
    return { page: 'classes', nav: 'classes', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: null };
  }
  if (lower === '/settings' || lower === '/settings.html' || lower === '/account' || lower === '/account.html' || lower === '/profile' || lower === '/profile.html' || lower === '/tai-khoan' || lower === '/tai-khoan.html') {
    return { page: 'settings', nav: 'settings', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: null };
  }
  const settingsSubMatch = /^\/settings\/(profile|learning|security|privacy)(?:\.html)?$/i.exec(lower);
  if (settingsSubMatch) {
    return { page: 'settings', nav: 'settings', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: normalizeSettingsSubPage(settingsSubMatch[1]) };
  }
  if (lower === '/admin' || lower === '/admin.html') {
    return { page: 'admin', nav: 'admin', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: null };
  }
  if (lower === '/admin/staff' || lower === '/admin/staff.html' || lower === '/admin/staff-requests') {
    return { page: 'admin', nav: 'admin', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: 'staff' };
  }
  if (lower === '/admin/enrollments' || lower === '/admin/enrollments.html') {
    return { page: 'admin', nav: 'admin', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: 'enrollments' };
  }
  if (lower === '/enrollments' || lower === '/enrollments.html') {
    return { page: 'enrollments', nav: 'enrollments', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: null };
  }
  if (lower === '/onboarding' || lower === '/onboarding.html') {
    return { page: 'onboarding', nav: 'onboarding', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: null };
  }
  if (lower === '/archive' || lower === '/archive.html' || lower === '/class/archive' || lower === '/class/archive.html') {
    return { page: 'archive', nav: 'archive', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: null };
  }
  const practiceMatch = /^\/practice(?:\/(thptqg|hsa|tsa|past)(?:\/([A-Za-z0-9_-]{1,128}))?)?(?:\.html)?$/i.exec(raw);
  if (practiceMatch) {
    let subPage = null;
    if (practiceMatch[1]) {
      const track = practiceMatch[1].toLowerCase();
      subPage = practiceMatch[2] ? `${track}/${practiceMatch[2]}` : track;
    }
    return {
      page: 'practice',
      nav: 'practice',
      cohortSlug: null,
      classSlug: null,
      classTab: null,
      isClassEntry: false,
      materialsSubTab: 'files',
      subPage
    };
  }

  const classEntryMatch = /^\/class\/([A-Za-z0-9_-]+?)(?:\.html)?$/i.exec(raw);
  if (classEntryMatch) {
    return {
      page: 'classes',
      nav: 'classes',
      cohortSlug: classEntryMatch[1],
      classSlug: classEntryMatch[1],
      classTab: 'notices',
      isClassEntry: true,
      materialsSubTab: 'files',
      subPage: null
    };
  }

  const classSubMatch = /^\/class\/([A-Za-z0-9_-]+)\/([a-z]+)(?:\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]{1,128}))?)?(?:\.html)?$/i.exec(raw);
  if (classSubMatch) {
    const classSlug = classSubMatch[1];
    const seg1 = classSubMatch[2].toLowerCase();
    const seg2Raw = classSubMatch[3] || '';
    const seg3Raw = classSubMatch[4] || '';
    const seg2 = seg2Raw.toLowerCase();
    const classTab = SEGMENT_TO_TAB[seg1] || 'notices';
    let materialsSubTab = 'files';
    let subPage = null;
    if (classTab === 'materials' || classTab === 'assignments') {
      const sessMatch = /^(?:buoi|session)-(\d{1,3})$/i.exec(seg2);
      if (sessMatch) {
        const sNum = Number(sessMatch[1]);
        if (sNum >= 1 && sNum <= 200) subPage = `buoi-${sNum}`;
      } else if (classTab === 'materials' && (seg2 === 'videos' || seg2 === 'video')) {
        materialsSubTab = 'videos';
      }
    }
    if (classTab === 'practice') {
      if (seg2 === 'questions' || seg2 === 'bank') {
        subPage = 'questions';
      } else if (['thptqg', 'hsa', 'tsa', 'past'].includes(seg2)) {
        subPage = seg3Raw ? `${seg2}/${seg3Raw}` : seg2;
      }
    }
    if (classTab === 'attendance' && seg2Raw) {
      const parsedDate = parseIsoDateParts(seg2Raw);
      if (parsedDate) subPage = parsedDate.iso;
    }
    if (classTab === 'forum' && seg2Raw && /^[A-Za-z0-9_-]{1,128}$/.test(seg2Raw)) {
      subPage = seg2Raw;
    }
    return {
      page: 'classes',
      nav: 'classes',
      cohortSlug: classSlug,
      classSlug,
      classTab,
      isClassEntry: false,
      materialsSubTab,
      subPage
    };
  }

  return { page: 'home', nav: 'home', cohortSlug: null, classSlug: null, classTab: null, isClassEntry: false, materialsSubTab: 'files', subPage: null };
}

export const DEFAULT_COURSE_SESSIONS_COUNT = 50;

export function parseIsoDateParts(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utcMs = Date.UTC(year, month - 1, day);
  const dt = new Date(utcMs);
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day) return null;
  return { year, month, day, utcMs, iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

export function isoDayOfWeek(dateStr) {
  const parts = parseIsoDateParts(dateStr);
  if (!parts) return null;
  const utcDay = new Date(parts.utcMs).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

export function addIsoDays(dateStr, deltaDays) {
  const parts = parseIsoDateParts(dateStr);
  if (!parts || !Number.isFinite(deltaDays)) return null;
  const nextMs = parts.utcMs + Math.round(deltaDays) * 86400000;
  return new Date(nextMs).toISOString().slice(0, 10);
}

export function diffIsoDays(fromIso, toIso) {
  const a = parseIsoDateParts(fromIso);
  const b = parseIsoDateParts(toIso);
  if (!a || !b) return 0;
  return Math.round((b.utcMs - a.utcMs) / 86400000);
}

export function formatSessionDateVi(dateStr, { includeWeekday = true, start = '', end = '' } = {}) {
  const parts = parseIsoDateParts(dateStr);
  if (!parts) return 'Chưa xếp ngày';
  const dow = isoDayOfWeek(parts.iso);
  const dayLabel = dow ? weekDays[dow - 1] : '';
  const dmy = `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`;
  const base = includeWeekday && dayLabel ? `${dayLabel}, ${dmy}` : dmy;
  if (start && end) return `${base} · ${start}–${end}`;
  if (start) return `${base} · ${start}`;
  return base;
}

export function normalizeScheduleSlotsSafe(slots) {
  if (!Array.isArray(slots)) return [];
  try {
    return validateSchedule(slots);
  } catch {
    return slots
      .filter(s => s && Number.isInteger(Number(s.day)) && Number(s.day) >= 1 && Number(s.day) <= 7 && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(s.start || '')) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(s.end || '')) && String(s.end) > String(s.start))
      .map(s => ({ day: Number(s.day), start: String(s.start), end: String(s.end) }))
      .sort((a, b) => a.day - b.day || collator.compare(a.start, b.start));
  }
}

export function generateScheduleDates({ scheduleSlots = [], startDate = '2026-09-01', count = DEFAULT_COURSE_SESSIONS_COUNT } = {}) {
  const validStart = parseIsoDateParts(startDate)?.iso || '2026-09-01';
  const targetCount = Math.max(1, Math.min(200, Number(count) || DEFAULT_COURSE_SESSIONS_COUNT));
  const validSlots = normalizeScheduleSlotsSafe(scheduleSlots);
  const results = [];

  if (validSlots.length > 0) {
    let dayOffset = 0;
    const maxOffset = targetCount * 14 + 366;
    while (results.length < targetCount && dayOffset <= maxOffset) {
      const curDate = addIsoDays(validStart, dayOffset);
      const dow = isoDayOfWeek(curDate);
      for (const slot of validSlots) {
        if (slot.day === dow) {
          results.push({
            sessionNumber: results.length + 1,
            date: curDate,
            day: dow,
            dayLabel: weekDays[dow - 1],
            start: slot.start,
            end: slot.end
          });
          if (results.length >= targetCount) break;
        }
      }
      dayOffset++;
    }
    return results;
  }

  for (let i = 0; i < targetCount; i++) {
    const curDate = addIsoDays(validStart, i * 7);
    const dow = isoDayOfWeek(curDate);
    results.push({
      sessionNumber: i + 1,
      date: curDate,
      day: dow,
      dayLabel: weekDays[dow - 1],
      start: '',
      end: ''
    });
  }
  return results;
}

export function lessonSessionId(classId, sessionNumber) {
  const safeClass = String(classId || 'class').replace(/[^A-Za-z0-9_-]/g, '');
  const num = Math.max(1, Math.min(999, Math.trunc(Number(sessionNumber) || 1)));
  return `ses-${safeClass}-${String(num).padStart(2, '0')}`;
}

export function parseSessionLessonTitle(rawTitle = '', fallbackSessionNumber = null) {
  const raw = String(rawTitle || '').trim();
  const m = /^Buổi\s+(\d{1,3})(?:\s*[:·\-–—]\s*(.*))?$/i.exec(raw);
  if (m) {
    return {
      sessionNumber: Number(m[1]),
      lessonName: String(m[2] || '').trim()
    };
  }
  return {
    sessionNumber: Number.isInteger(fallbackSessionNumber) && fallbackSessionNumber > 0 ? fallbackSessionNumber : null,
    lessonName: raw
  };
}

export function formatSessionLessonTitle(sessionNumber, lessonName = '') {
  const num = Math.max(1, Math.trunc(Number(sessionNumber) || 1));
  const parsed = parseSessionLessonTitle(lessonName, num);
  const cleanName = parsed.lessonName.trim();
  return cleanName ? `Buổi ${num}: ${cleanName}` : `Buổi ${num}`;
}

const SESSION_META_REGEX = /(?:^|\s)\|\|s:(\d{1,3})\|d:([0-9-]{0,10})\|t:([0-9:-]{0,11})(?:\|c:([01]))?(?:\|x:([01]))?(?=\s|$)/i;

export function decodeSessionTopicMeta(rawTopic = '', rawTitle = '') {
  const str = String(rawTopic || '').trim();
  const titleParsed = parseSessionLessonTitle(rawTitle);
  const match = SESSION_META_REGEX.exec(str);
  let sessionNumber = titleParsed.sessionNumber;
  let date = '';
  let start = '';
  let end = '';
  let customDate = false;
  let explicit = false;
  let rest = str;

  if (match) {
    sessionNumber = Number(match[1]) || sessionNumber;
    date = parseIsoDateParts(match[2])?.iso || '';
    if (match[3] && /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(match[3])) {
      const [s, e] = match[3].split('-');
      start = s;
      end = e;
    }
    customDate = match[4] === '1';
    explicit = match[5] === '1';
    rest = str.replace(match[0], ' ').trim();
  }

  let driveVideoFileId = null;
  const driveMatch = /(?:^|[\s·|—–\-:;]+)drive-video:([A-Za-z0-9_-]{1,128})/i.exec(rest);
  if (driveMatch) {
    driveVideoFileId = driveMatch[1];
    rest = rest.replace(/drive-video:[A-Za-z0-9_-]{1,128}/gi, '');
  }

  const cleanTopic = rest
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/^[\s·|—–\-:;]+|[\s·|—–\-:;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    sessionNumber,
    lessonName: titleParsed.lessonName,
    cleanTopic,
    date,
    start,
    end,
    customDate,
    explicit,
    driveVideoFileId
  };
}

export function isExplicitOrPopulatedSession({ meta, fileCount = 0, hasLinkedAssignment = false } = {}) {
  return Boolean(
    meta?.explicit ||
    meta?.lessonName ||
    meta?.cleanTopic ||
    meta?.customDate ||
    meta?.driveVideoFileId ||
    Number(fileCount) > 0 ||
    hasLinkedAssignment
  );
}

export function encodeSessionTopicMeta({
  cleanTopic = '',
  sessionNumber = 1,
  date = '',
  start = '',
  end = '',
  customDate = false,
  explicit = false,
  driveVideoFileId = ''
} = {}) {
  const decoded = decodeSessionTopicMeta(cleanTopic);
  const baseTopic = decoded.cleanTopic;
  const finalDriveId = driveVideoFileId || decoded.driveVideoFileId || '';
  const num = Math.max(1, Math.min(999, Math.trunc(Number(sessionNumber) || 1)));
  const safeDate = parseIsoDateParts(date)?.iso || '';
  const safeTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) && end > start
    ? `${start}-${end}`
    : '';
  const metaTag = `||s:${num}|d:${safeDate}|t:${safeTime}|c:${customDate ? 1 : 0}${explicit ? '|x:1' : ''}`;
  const videoTag = finalDriveId ? ` · drive-video:${finalDriveId}` : '';
  const maxTopicLen = Math.max(0, 200 - metaTag.length - videoTag.length - 1);
  const trimmedTopic = baseTopic.slice(0, maxTopicLen).trim();
  return `${trimmedTopic}${videoTag}${trimmedTopic || videoTag ? ' ' : ''}${metaTag}`.slice(0, 200);
}

export function rescheduleCourseSessions(
  sessionsOrConfig = [],
  targetSessionNumberArg = undefined,
  newDateIsoArg = undefined,
  optionsArg = {}
) {
  let sessions = sessionsOrConfig;
  let targetSessionNumber = targetSessionNumberArg;
  let newDateIso = newDateIsoArg;
  let opts = optionsArg || {};

  if (
    sessionsOrConfig &&
    typeof sessionsOrConfig === 'object' &&
    !Array.isArray(sessionsOrConfig)
  ) {
    sessions = sessionsOrConfig.sessions || [];
    targetSessionNumber = sessionsOrConfig.sessionNumber ?? sessionsOrConfig.targetSessionNumber;
    newDateIso = sessionsOrConfig.newDate ?? sessionsOrConfig.newDateIso;
    opts = sessionsOrConfig;
  }

  const {
    scheduleSlots = [],
    newStart = opts.start,
    newEnd = opts.end,
    newLessonName = opts.lessonName,
    newTopic = opts.cleanTopic,
    cascade = null
  } = opts;

  const validNewDate = parseIsoDateParts(newDateIso)?.iso;
  if (!validNewDate) throw Error('Ngày học không hợp lệ.');

  const sorted = [...sessions]
    .map(s => ({ ...s, sessionNumber: Number(s.sessionNumber) }))
    .sort((a, b) => a.sessionNumber - b.sessionNumber);

  const idx = sorted.findIndex(s => s.sessionNumber === Number(targetSessionNumber));
  if (idx < 0) throw Error('Không tìm thấy buổi học cần chỉnh sửa.');

  const target = sorted[idx];
  const oldDate = parseIsoDateParts(target.date)?.iso || '';
  const deltaDays = oldDate ? diffIsoDays(oldDate, validNewDate) : 0;
  const nextSession = sorted[idx + 1] || null;
  const nextOldDate = nextSession ? (parseIsoDateParts(nextSession.date)?.iso || '') : '';

  const shouldCascade = typeof cascade === 'boolean'
    ? (cascade && validNewDate !== oldDate)
    : Boolean(
        oldDate &&
        validNewDate !== oldDate &&
        (deltaDays >= 7 || (nextOldDate && validNewDate >= nextOldDate))
      );

  const validSlots = normalizeScheduleSlotsSafe(scheduleSlots);
  const targetDow = isoDayOfWeek(validNewDate);
  const matchingTargetSlot = validSlots.find(s => s.day === targetDow) || validSlots[0] || null;

  const updatedTarget = {
    ...target,
    date: validNewDate,
    day: targetDow,
    dayLabel: targetDow ? weekDays[targetDow - 1] : '',
    start: newStart !== undefined ? newStart : (target.start || matchingTargetSlot?.start || ''),
    end: newEnd !== undefined ? newEnd : (target.end || matchingTargetSlot?.end || ''),
    lessonName: newLessonName !== undefined ? String(newLessonName).trim() : (target.lessonName || ''),
    cleanTopic: newTopic !== undefined ? String(newTopic).trim() : (target.cleanTopic || ''),
    customDate: true
  };
  updatedTarget.title = formatSessionLessonTitle(updatedTarget.sessionNumber, updatedTarget.lessonName);
  sorted[idx] = updatedTarget;

  const changedSessions = [updatedTarget];
  let shiftedCount = 0;
  if (shouldCascade && idx < sorted.length - 1) {
    const remainingCount = sorted.length - (idx + 1);
    if (validSlots.length > 0) {
      const nextDates = generateScheduleDates({
        scheduleSlots: validSlots,
        startDate: addIsoDays(validNewDate, 1),
        count: remainingCount
      });
      for (let j = 0; j < remainingCount; j++) {
        const s = sorted[idx + 1 + j];
        const nextSlot = nextDates[j];
        const updatedNext = {
          ...s,
          date: nextSlot.date,
          day: nextSlot.day,
          dayLabel: nextSlot.dayLabel,
          start: nextSlot.start || s.start || '',
          end: nextSlot.end || s.end || ''
        };
        sorted[idx + 1 + j] = updatedNext;
        changedSessions.push(updatedNext);
        shiftedCount++;
      }
    } else {
      const shiftStep = deltaDays > 0 ? deltaDays : 7;
      let prevDate = validNewDate;
      for (let j = idx + 1; j < sorted.length; j++) {
        const s = sorted[j];
        const candidate = s.date ? addIsoDays(s.date, shiftStep) : addIsoDays(prevDate, 7);
        const finalDate = candidate && candidate > prevDate ? candidate : addIsoDays(prevDate, 7);
        const dow = isoDayOfWeek(finalDate);
        const updatedNext = {
          ...s,
          date: finalDate,
          day: dow,
          dayLabel: dow ? weekDays[dow - 1] : ''
        };
        sorted[j] = updatedNext;
        changedSessions.push(updatedNext);
        prevDate = finalDate;
        shiftedCount++;
      }
    }
  }

  return {
    sessions: sorted,
    changedSessions,
    cascaded: shouldCascade,
    shiftedCount,
    deltaDays,
    oldDate,
    newDate: validNewDate
  };
}

export function encodeAssignmentSessionInstructions({
  sessionNumber,
  lessonId = '',
  fileIds = null,
  instructions = '',
  cleanInstructions = ''
} = {}) {
  const raw = instructions || cleanInstructions || '';
  const decoded = decodeAssignmentSessionInstructions(raw);
  const clean = decoded.cleanInstructions;
  const num = Number(sessionNumber);
  if (!Number.isInteger(num) || num < 1) return clean;
  const safeLesson = typeof lessonId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(lessonId) ? `|lesson:${lessonId}` : '';
  const effectiveFiles = Array.isArray(fileIds) ? fileIds : decoded.fileIds;
  const safeFiles = Array.isArray(effectiveFiles)
    ? effectiveFiles.filter(f => typeof f === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(f))
    : [];
  const filesPart = safeFiles.length ? `|files:${[...new Set(safeFiles)].join(',')}` : '';
  const header = `[[buoi:${num}${safeLesson}${filesPart}]]`;
  return clean ? `${header}\n${clean}` : header;
}

export function decodeAssignmentSessionInstructions(rawInstructions = '') {
  const str = String(rawInstructions || '');
  const m = /^\[\[buoi:(\d{1,3})(?:\|lesson:([A-Za-z0-9_-]{1,128}))?(?:\|files:([A-Za-z0-9_,-]+))?\]\](?:\r?\n)?([\s\S]*)$/i.exec(str);
  if (!m) {
    return {
      sessionNumber: null,
      lessonId: null,
      fileIds: [],
      cleanInstructions: str
    };
  }
  const fileIds = m[3]
    ? m[3].split(',').map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]{1,128}$/.test(s))
    : [];
  return {
    sessionNumber: Number(m[1]),
    lessonId: m[2] || null,
    fileIds,
    cleanInstructions: m[4] || ''
  };
}

function partitionLessonMediaFiles(rawFiles = [], { includeHomework = false } = {}) {
  const documentFiles = [];
  const videoFiles = [];
  const homeworkFiles = [];
  const coverFiles = [];
  for (const f of rawFiles) {
    const fName = String(f.name || '');
    if (/^__ltch_cover__/i.test(fName)) {
      coverFiles.push(f);
      continue;
    }
    if (includeHomework && /^(?:__ltch_hw__|\[BTVN\]\s*)/i.test(fName)) {
      const cleanHwName = fName.replace(/^(?:__ltch_hw__|\[BTVN\]\s*)/i, '').trim() || fName;
      homeworkFiles.push({ ...f, name: cleanHwName, rawName: fName });
      continue;
    }
    const isVid = /^video\//i.test(String(f.content_type || '')) || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(fName);
    if (isVid) videoFiles.push(f);
    else documentFiles.push(f);
  }
  const toTs = val => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    const str = String(val || '').trim();
    if (!str) return 0;
    if (/^\d+$/.test(str)) return Number(str);
    const parsed = Date.parse(str);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  coverFiles.sort((a, b) => toTs(a.created_at) - toTs(b.created_at));
  return {
    documentFiles,
    videoFiles,
    homeworkFiles,
    latestCover: coverFiles.at(-1) || null
  };
}

export function buildClassSessionsCatalog({
  classId,
  classRecord = null,
  scheduleSlots = undefined,
  startDate = '2026-09-01',
  lessons = [],
  lessonFiles = [],
  targetCount = undefined,
  totalSessions = undefined,
  onlyExplicit = false,
  linkedSessionNumbers = null,
  driveFolderKeys = null
} = {}) {
  const rawSlots = scheduleSlots !== undefined ? scheduleSlots : (classRecord?.schedule_slots || []);
  const validSlots = normalizeScheduleSlotsSafe(rawSlots);
  const requestedCount = targetCount ?? totalSessions ?? DEFAULT_COURSE_SESSIONS_COUNT;
  const filesByLessonId = new Map();
  for (const f of lessonFiles || []) {
    if (!f || !f.lesson_id) continue;
    if (!filesByLessonId.has(f.lesson_id)) filesByLessonId.set(f.lesson_id, []);
    filesByLessonId.get(f.lesson_id).push(f);
  }

  const sessionRowByNumber = new Map();
  const unassignedLessons = [];

  for (const row of lessons || []) {
    if (!row || typeof row !== 'object') continue;
    if (isPracticeSolutionLesson(row)) continue;
    const meta = decodeSessionTopicMeta(row.topic, row.title);
    if (meta.driveVideoFileId === 'pending') continue;
    let num = meta.sessionNumber;
    if (!num) {
      const idMatch = /^ses-[A-Za-z0-9_-]+-(\d{2,3})$/i.exec(String(row.id || ''));
      if (idMatch) num = Number(idMatch[1]);
    }
    if (num && num >= 1 && num <= 200) {
      if (
        onlyExplicit &&
        !isExplicitOrPopulatedSession({
          meta,
          fileCount: (filesByLessonId.get(row.id) || []).length,
          hasLinkedAssignment: Boolean(linkedSessionNumbers?.has?.(num))
        })
      ) {
        continue;
      }
      if (!sessionRowByNumber.has(num)) {
        sessionRowByNumber.set(num, { row, meta });
      }
    } else {
      unassignedLessons.push({ row, meta });
    }
  }

  if (onlyExplicit && linkedSessionNumbers) {
    for (const linkedNum of linkedSessionNumbers) {
      if (Number.isInteger(linkedNum) && linkedNum >= 1 && linkedNum <= 200 && !sessionRowByNumber.has(linkedNum)) {
        sessionRowByNumber.set(linkedNum, { row: null, meta: decodeSessionTopicMeta('', '') });
      }
    }
  }

  const maxExistingNum = sessionRowByNumber.size ? Math.max(...sessionRowByNumber.keys()) : 0;
  const count = Math.max(requestedCount, maxExistingNum, DEFAULT_COURSE_SESSIONS_COUNT);
  const targetNumbers = onlyExplicit
    ? [...sessionRowByNumber.keys()].sort((a, b) => a - b)
    : Array.from({ length: count }, (_, idx) => idx + 1);

  const firstNum = targetNumbers[0] || 1;
  const firstSavedDate = sessionRowByNumber.get(firstNum)?.meta?.date;
  const anchorStart = parseIsoDateParts(firstSavedDate)?.iso || parseIsoDateParts(startDate)?.iso || '2026-09-01';
  const initialDates = generateScheduleDates({ scheduleSlots: validSlots, startDate: anchorStart, count: 1 });
  let prevDate = initialDates[0]?.date || anchorStart;

  const sessions = [];
  for (let idx = 0; idx < targetNumbers.length; idx++) {
    const num = targetNumbers[idx];
    const existing = sessionRowByNumber.get(num) || null;
    let slotInfo;
    if (idx === 0) {
      if (existing?.meta?.date) {
        const d = existing.meta.date;
        const dow = isoDayOfWeek(d);
        const matchSlot = validSlots.find(s => s.day === dow) || validSlots[0] || null;
        slotInfo = {
          date: d,
          day: dow,
          dayLabel: dow ? weekDays[dow - 1] : '',
          start: existing.meta.start || matchSlot?.start || '',
          end: existing.meta.end || matchSlot?.end || ''
        };
      } else {
        slotInfo = initialDates[0];
      }
    } else if (existing?.meta?.date) {
      const d = existing.meta.date;
      const dow = isoDayOfWeek(d);
      const matchSlot = validSlots.find(s => s.day === dow) || validSlots[0] || null;
      slotInfo = {
        date: d,
        day: dow,
        dayLabel: dow ? weekDays[dow - 1] : '',
        start: existing.meta.start || matchSlot?.start || '',
        end: existing.meta.end || matchSlot?.end || ''
      };
    } else {
      const nextGenerated = generateScheduleDates({
        scheduleSlots: validSlots,
        startDate: addIsoDays(prevDate, 1),
        count: 1
      })[0];
      slotInfo = nextGenerated;
    }

    prevDate = slotInfo.date;
    const lessonId = existing?.row?.id || lessonSessionId(classId, num);
    const rawFiles = [...(filesByLessonId.get(lessonId) || [])];
    const { documentFiles, videoFiles, homeworkFiles, latestCover } = partitionLessonMediaFiles(rawFiles, { includeHomework: true });
    const lessonName = existing ? existing.meta.lessonName : '';
    const cleanTopic = existing ? existing.meta.cleanTopic : '';
    const driveVideoFileId = existing?.meta?.driveVideoFileId || videoFiles[0]?.id || null;

    sessions.push({
      sessionNumber: num,
      lessonId,
      persisted: Boolean(existing?.row),
      explicit: Boolean(onlyExplicit || existing?.meta?.explicit),
      driveSynced: Boolean(driveFolderKeys?.has?.(`lesson:${lessonId}`)),
      hasLessonRecord: Boolean(existing?.row && (documentFiles.length || videoFiles.length || homeworkFiles.length)),
      title: formatSessionLessonTitle(num, lessonName),
      lessonName,
      cleanTopic,
      rawTopic: existing?.row?.topic || '',
      driveVideoFileId,
      coverFileId: latestCover?.id || null,
      date: slotInfo.date,
      day: slotInfo.day,
      dayLabel: slotInfo.dayLabel,
      start: slotInfo.start || '',
      end: slotInfo.end || '',
      customDate: Boolean(existing?.meta?.customDate),
      formattedDate: formatSessionDateVi(slotInfo.date, {
        includeWeekday: true,
        start: slotInfo.start || '',
        end: slotInfo.end || ''
      }),
      files: documentFiles,
      videos: videoFiles,
      homeworkFiles,
      createdAt: existing?.row?.created_at || null
    });
  }

  Object.defineProperty(sessions, 'sessions', { value: sessions, enumerable: false });
  Object.defineProperty(sessions, 'unmatchedLessons', {
    value: unassignedLessons.map(u => u.row),
    enumerable: false
  });
  return sessions;
}

export const DEFAULT_PRACTICE_SOLUTIONS_COUNT = 50;
const PRACTICE_SOLUTION_ID_REGEX = /^psol-[A-Za-z0-9_-]+-(\d{2,3})$/i;
const PRACTICE_SOLUTION_META_REGEX = /(?:^|\s)\|\|p:(\d{1,3})\|d:([0-9-]{0,10})\|k:([a-z0-9_-]{0,16})(?=\s|$)/i;
const VALID_PRACTICE_SOLUTION_TAGS = new Set(['thptqg', 'hsa', 'tsa']);

export function practiceSolutionLessonId(classId, itemNumber) {
  const safeClass = String(classId || 'class').replace(/[^A-Za-z0-9_-]/g, '');
  const num = Math.max(1, Math.min(999, Math.trunc(Number(itemNumber) || 1)));
  return `psol-${safeClass}-${String(num).padStart(2, '0')}`;
}

export const practiceSolutionId = practiceSolutionLessonId;

export function isPracticeSolutionLesson(rowOrId) {
  if (!rowOrId) return false;
  if (typeof rowOrId === 'string') {
    return PRACTICE_SOLUTION_ID_REGEX.test(rowOrId) || PRACTICE_SOLUTION_META_REGEX.test(rowOrId);
  }
  if (typeof rowOrId === 'object') {
    const idStr = String(rowOrId.id || rowOrId.lessonId || rowOrId.lesson_id || '');
    const topicStr = String(rowOrId.topic || rowOrId.rawTopic || '');
    return PRACTICE_SOLUTION_ID_REGEX.test(idStr) || PRACTICE_SOLUTION_META_REGEX.test(topicStr);
  }
  return false;
}

export function parsePracticeSolutionTitle(rawTitle = '', fallbackNumber = null) {
  const raw = String(rawTitle || '').trim();
  const m = /^Đề\s+(\d{1,3})(?:\s*[:·\-–—]\s*(.*))?$/i.exec(raw);
  if (m) {
    return {
      itemNumber: Number(m[1]),
      solutionName: String(m[2] || '').trim()
    };
  }
  return {
    itemNumber: Number.isInteger(fallbackNumber) && fallbackNumber > 0 ? fallbackNumber : null,
    solutionName: raw
  };
}

export function formatPracticeSolutionTitle(itemNumber, solutionName = '') {
  const num = Math.max(1, Math.trunc(Number(itemNumber) || 1));
  const parsed = parsePracticeSolutionTitle(solutionName, num);
  const cleanName = parsed.solutionName.trim();
  return cleanName ? `Đề ${num}: ${cleanName}` : `Đề ${num}`;
}

export function decodePracticeSolutionTopicMeta(rawTopic = '', rawTitle = '') {
  const str = String(rawTopic || '').trim();
  const titleParsed = parsePracticeSolutionTitle(rawTitle);
  const match = PRACTICE_SOLUTION_META_REGEX.exec(str);
  let itemNumber = titleParsed.itemNumber;
  let date = '';
  let examTag = '';
  let rest = str;

  if (match) {
    itemNumber = Number(match[1]) || itemNumber;
    date = parseIsoDateParts(match[2])?.iso || '';
    const candidateTag = String(match[3] || '').trim().toLowerCase();
    examTag = VALID_PRACTICE_SOLUTION_TAGS.has(candidateTag) ? candidateTag : '';
    rest = str.replace(match[0], ' ').trim();
  }

  let driveVideoFileId = null;
  const driveMatch = /(?:^|[\s·|—–\-:;]+)drive-video:([A-Za-z0-9_-]{1,128})/i.exec(rest);
  if (driveMatch) {
    driveVideoFileId = driveMatch[1];
    rest = rest.replace(/drive-video:[A-Za-z0-9_-]{1,128}/gi, '');
  }

  const cleanTopic = rest
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/^[\s·|—–\-:;]+|[\s·|—–\-:;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    itemNumber,
    solutionName: titleParsed.solutionName,
    cleanTopic,
    date,
    examTag,
    driveVideoFileId
  };
}

export function encodePracticeSolutionTopicMeta({
  cleanTopic = '',
  itemNumber = 1,
  date = '',
  examTag = '',
  driveVideoFileId = ''
} = {}) {
  const decoded = decodePracticeSolutionTopicMeta(cleanTopic);
  const baseTopic = decoded.cleanTopic;
  const finalDriveId = driveVideoFileId || decoded.driveVideoFileId || '';
  const num = Math.max(1, Math.min(999, Math.trunc(Number(itemNumber) || 1)));
  const safeDate = parseIsoDateParts(date)?.iso || '';
  const normalizedTag = String(examTag || '').trim().toLowerCase();
  const safeTag = VALID_PRACTICE_SOLUTION_TAGS.has(normalizedTag) ? normalizedTag : '';
  const metaTag = `||p:${num}|d:${safeDate}|k:${safeTag}`;
  const videoTag = finalDriveId ? ` · drive-video:${finalDriveId}` : '';
  const maxTopicLen = Math.max(0, 200 - metaTag.length - videoTag.length - 1);
  const trimmedTopic = baseTopic.slice(0, maxTopicLen).trim();
  return `${trimmedTopic}${videoTag}${trimmedTopic || videoTag ? ' ' : ''}${metaTag}`.slice(0, 200);
}

/**
 * Dựng danh mục các đề chữa bài luyện (tách biệt hoàn toàn khỏi danh mục buổi học & bài giảng).
 */
export function buildPracticeSolutionsCatalog({
  classId,
  solutions = [],
  solutionFiles = [],
  lessons = [],
  lessonFiles = [],
  targetCount = DEFAULT_PRACTICE_SOLUTIONS_COUNT
} = {}) {
  const requestedCount = Number(targetCount) || DEFAULT_PRACTICE_SOLUTIONS_COUNT;
  const allFiles = Array.isArray(solutionFiles) && solutionFiles.length
    ? solutionFiles
    : (Array.isArray(lessonFiles) ? lessonFiles : []);

  const filesBySolutionId = new Map();
  for (const f of allFiles) {
    if (!f) continue;
    const ownerId = f.solution_id || f.lesson_id;
    if (!ownerId) continue;
    if (!filesBySolutionId.has(ownerId)) filesBySolutionId.set(ownerId, []);
    filesBySolutionId.get(ownerId).push(f);
  }

  const rowByNumber = new Map();
  const hasStructuredSolutions = Array.isArray(solutions) && solutions.length > 0;
  const sourceRows = hasStructuredSolutions ? solutions : (Array.isArray(lessons) ? lessons : []);

  for (const row of sourceRows) {
    if (!row || typeof row !== 'object') continue;
    if (hasStructuredSolutions || 'item_number' in row || 'solution_name' in row || 'solution_date' in row || 'exam_tag' in row) {
      let num = Number(row.item_number);
      if (!num || !Number.isInteger(num)) {
        const idMatch = PRACTICE_SOLUTION_ID_REGEX.exec(String(row.id || ''));
        if (idMatch) num = Number(idMatch[1]);
      }
      if (!num || num < 1 || num > 200 || rowByNumber.has(num)) continue;
      const parsedTitle = parsePracticeSolutionTitle(row.title || '', num);
      const solutionName = typeof row.solution_name === 'string' && row.solution_name.trim()
        ? row.solution_name.trim()
        : parsedTitle.solutionName;
      const candidateTag = String(row.exam_tag || '').trim().toLowerCase();
      const examTag = VALID_PRACTICE_SOLUTION_TAGS.has(candidateTag) ? candidateTag : '';
      const date = parseIsoDateParts(row.solution_date || '')?.iso || '';
      const cleanTopic = String(row.topic || '').trim();
      rowByNumber.set(num, {
        row,
        structured: true,
        meta: {
          itemNumber: num,
          solutionName,
          cleanTopic,
          date,
          examTag,
          driveVideoFileId: null
        }
      });
      continue;
    }

    if (!isPracticeSolutionLesson(row)) continue;
    const meta = decodePracticeSolutionTopicMeta(row.topic, row.title);
    if (meta.driveVideoFileId === 'pending') continue;
    let num = meta.itemNumber;
    if (!num) {
      const idMatch = PRACTICE_SOLUTION_ID_REGEX.exec(String(row.id || ''));
      if (idMatch) num = Number(idMatch[1]);
    }
    if (num && num >= 1 && num <= 200 && !rowByNumber.has(num)) {
      rowByNumber.set(num, { row, structured: false, meta });
    }
  }

  const maxExistingNum = rowByNumber.size ? Math.max(...rowByNumber.keys()) : 0;
  const count = Math.max(requestedCount, maxExistingNum, DEFAULT_PRACTICE_SOLUTIONS_COUNT);

  const items = [];
  for (let num = 1; num <= count; num++) {
    const existing = rowByNumber.get(num) || null;
    const solutionId = existing?.row?.id || practiceSolutionLessonId(classId, num);
    const rawFiles = [...(filesBySolutionId.get(solutionId) || [])];

    const hasExplicitKinds = rawFiles.some(f => typeof f.file_kind === 'string' && f.file_kind);
    let documentFiles = [];
    let videoFiles = [];
    let latestCover = null;

    if (hasExplicitKinds) {
      for (const f of rawFiles) {
        if (f.file_kind === 'cover' || /^__ltch_cover__/i.test(String(f.name || ''))) {
          if (!latestCover || (Number(f.created_at) || 0) >= (Number(latestCover.created_at) || 0)) {
            latestCover = f;
          }
        } else if (f.file_kind === 'video') {
          videoFiles.push(f);
        } else {
          documentFiles.push(f);
        }
      }
    } else {
      const partitioned = partitionLessonMediaFiles(rawFiles, { includeHomework: false });
      documentFiles = partitioned.documentFiles;
      videoFiles = partitioned.videoFiles;
      latestCover = partitioned.latestCover;
    }

    const solutionName = existing ? existing.meta.solutionName : '';
    const cleanTopic = existing ? existing.meta.cleanTopic : '';
    const date = existing ? existing.meta.date : '';
    const examTag = existing ? existing.meta.examTag : '';
    const driveVideoFileId = existing?.meta?.driveVideoFileId || videoFiles[0]?.id || null;

    items.push({
      itemNumber: num,
      solutionId,
      lessonId: solutionId,
      persisted: Boolean(existing),
      hasSolutionRecord: Boolean(existing && (documentFiles.length || videoFiles.length)),
      title: formatPracticeSolutionTitle(num, solutionName),
      solutionName,
      cleanTopic,
      rawTopic: existing?.row?.topic || '',
      examTag,
      driveVideoFileId,
      coverFileId: latestCover?.id || null,
      date,
      formattedDate: date ? formatSessionDateVi(date, { includeWeekday: true }) : '',
      files: documentFiles,
      videos: videoFiles,
      createdAt: existing?.row?.created_at || null
    });
  }

  return items;
}
