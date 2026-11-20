import {initializeApp} from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  EmailAuthProvider,
  linkWithCredential,
  updatePassword
} from 'firebase/auth';
import {firebaseConfig, apiBase} from './config.js';
import {noticeMediaTypes, noticeMediaAccept, noticeMediaType, noticeMaxImageBytes, noticeMaxVideoBytes} from '../shared/notice-media.mjs';
import {createApiTransport} from './api-transport.mjs';
import {createAuthState} from './auth-state.mjs';
import {createLessonUploadRetry} from './lesson-upload-retry.mjs';
import {availableViewRoles, navigationForView, classesForView, tabsForView, directClassForView, classNavigationForView, workspaceForView, viewerForWorkspace} from './role-view.mjs';
import {
  sortClasses,
  groupClasses,
  classGrade,
  className,
  validateSchedule,
  scheduleText,
  weekDays,
  schoolYearStart,
  classCohortSlug,
  findClassByCohortSlug,
  planSchoolYearCohortTransition,
  buildAppRoutePath,
  parseAppRoutePath,
  DEFAULT_COURSE_SESSIONS_COUNT,
  parseIsoDateParts,
  addIsoDays,
  diffIsoDays,
  formatSessionDateVi,
  normalizeScheduleSlotsSafe,
  generateScheduleDates,
  lessonSessionId,
  formatSessionLessonTitle,
  parseSessionLessonTitle,
  rescheduleCourseSessions,
  encodeAssignmentSessionInstructions,
  decodeAssignmentSessionInstructions,
  buildClassSessionsCatalog,
  parsePracticeSubPage,
  normalizeSettingsSubPage
} from '../shared/classroom.mjs';
import {
  ACCOUNT_TABS,
  ROLE_DESCRIPTIONS,
  PARENT_RELATION_LABELS,
  SUPPORT_EMAIL,
  resolveAccountTab,
  shouldShowRoleSwitcher,
  isStaffRoleList,
  shouldShowLinkedParentsCard,
  shouldShowLinkedStudentsCard,
  formatUserInitials,
  validateDisplayName,
  validateContactPhone,
  evaluatePasswordPolicy,
  describeAuthProviders,
  formatVietnamDate,
  formatIsoDob,
  normalizeAccountProfile,
  buildSupportMailtoHref,
  buildSupportCopyBundle
} from './account-workspace.mjs';
import {
  SUBMISSION_ALLOWED_TYPES,
  SUBMISSION_MAX_FILES,
  SUBMISSION_MAX_FILE_BYTES,
  SUBMISSION_MAX_TOTAL_BYTES,
  SUBMISSION_MAX_NOTE_LENGTH,
  normalizeSubmissionMimeType
} from '../shared/submission-metadata.mjs';
import {cropRegion, drawAvatar} from './avatar-crop.mjs';
import {renderForumText} from './forum-math.mjs';
import {createQuestionMathEditor} from './question-math-editor.mjs';
import {
  mediaIcon,
  parseLessonTopicAndVideo,
  classifyLessonFile,
  formatFileSize,
  createDriveVideoLectureElement,
  populateDrivePreviewPanel,
  mountDriveStylePdfViewer,
  syncTheaterBodyLock
} from './lesson-media-viewer.mjs';
import {
  normalizeSearchText,
  sortStudentsRoster,
  getVietnamTodayIso,
  renderStaffAttendanceWorkspace,
  renderLearnerAttendanceWorkspace
} from './attendance-workspace.mjs';
import {setupOtpSixBoxInput} from './otp-code-input.mjs';
import {initCustomSelectObserver, upgradeAllSelectsIn, closeActiveCustomSelect} from './custom-select.mjs';
import {createActionMenu, closeActiveActionMenu} from './action-menu.mjs';
import {resolveUserWatermarkText, watermarkDownloadedBlob} from './document-watermark.mjs';
import {renderPracticeRoomsPortal} from './practice-rooms.mjs';
import {
  NOTICE_CATEGORIES,
  encodeNoticeMeta,
  decodeNoticeMeta,
  renderClassNoticesWorkspace,
  renderClassOperationsWorkspace,
  invalidateOpsForumStatsCache
} from './notices-workspace.mjs';
import { renderForumWorkspace } from './forum-workspace.mjs';
import { getForumCategoryMeta, formatRelativeForumTimeVi } from '../shared/forum-metadata.mjs';
import {
  ASSISTANT_PERMISSION_CHOICES,
  normalizeMemberships,
  groupStudentsForAdmin,
  groupStaffForAdmin,
  groupParentLinks,
  summarizeAccountAssignments,
  renderAdminMembershipsWorkspace
} from './admin-memberships.mjs';
import {
  getVietnamNowParts,
  buildUpcomingScheduleItems,
  describeAssignmentUrgency,
  filterOverviewClasses,
  formatAttendanceStatusMeta,
  formatVnIsoDate,
  formatRelativeTimeVi,
  formatScore10,
  describeSubmissionStatusMeta
} from './overview-workspace.mjs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const auth = getAuth(initializeApp(firebaseConfig));
const requestApi = createApiTransport(apiBase);
const authState = createAuthState();
const lessonUploadRetry = createLessonUploadRetry();

const $ = id => document.getElementById(id);
let contentVersion = 0;
let session = null, sessionUid = null, challenge = null, register = false, me = null, classes = [], archivedClasses = [], selectedClass = null, workspace = null, viewRole = null, activeNav = 'home';
let workspaceSource = null, activeClassTab = null, activeMaterialsSubTab = 'files', activePracticeSubPage = null, activeAdminSubPage = null, activeSettingsTab = 'profile', activeAdminTab = 'approvals', suppressHistoryPush = false, viewVersion = 0;
let pendingForumContext = null;
const defaultAdminMembershipUiState = () => ({
  subTab: 'students',
  studentViewMode: 'class',
  studentClassFilter: 'all',
  studentStatusFilter: 'active',
  studentClassScope: 'active_open',
  studentSearch: '',
  staffSearch: '',
  parentStatus: 'active',
  parentSearch: '',
  expandedClassIds: []
});
let adminMembershipUiState = defaultAdminMembershipUiState();
const defaultAdminAccountUiState = () => ({search: '', roleFilter: 'all', statusFilter: 'all', visibleLimit: 20});
let adminAccountUiState = defaultAdminAccountUiState();
const isStaffView = () => ['admin', 'teacher', 'assistant'].includes(viewRole);
const visibleClasses = () => classesForView(me, viewRole, classes);
const allAccessibleClasses = () => [...visibleClasses(), ...(isStaffView() ? classesForView(me, viewRole, archivedClasses) : [])];

function readSavedViewRole() {
  try { return sessionStorage.getItem('ltch_view_role') || null; } catch { return null; }
}

function saveViewRole(role) {
  try {
    if (role) sessionStorage.setItem('ltch_view_role', role);
    else sessionStorage.removeItem('ltch_view_role');
  } catch {}
}

const POST_LOGIN_ROUTE_KEY = 'ltch_post_login_route';

function normalizePostLoginRoute(rawPath, rawHash = '') {
  if (typeof rawPath !== 'string') return null;
  let clean = rawPath.trim().split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (!/^\/(?!\/)[A-Za-z0-9/_.-]{1,180}$/.test(clean) || clean.includes('..')) return null;
  if (/\.html$/i.test(clean)) {
    clean = clean.replace(/\/index\.html$/i, '/') || '/';
    if (clean !== '/') clean = clean.replace(/\.html$/i, '');
  }
  const lower = clean.toLowerCase();
  const hash = String(rawHash || '').trim().toLowerCase();
  if (lower === '/admin' && hash === '#staff-requests') clean = '/admin/staff';
  else if (lower === '/admin' && hash === '#enrollment-requests') clean = '/admin/enrollments';
  if (['/', '/index', '/app', '/login', '/overview'].includes(clean.toLowerCase())) return null;
  const parsed = parseAppRoutePath(clean);
  if (parsed.page === 'home' && !parsed.cohortSlug) return null;
  if (parsed.page === 'admin') {
    return parsed.subPage === 'staff' ? '/admin/staff' : parsed.subPage === 'enrollments' ? '/admin/enrollments' : '/admin';
  }
  if (parsed.page === 'enrollments') return '/enrollments';
  if (parsed.page === 'onboarding') return '/onboarding';
  if (['classes', 'practice', 'archive', 'settings'].includes(parsed.page)) return clean;
  return null;
}

function readSavedPostLoginRoute() {
  try { return normalizePostLoginRoute(sessionStorage.getItem(POST_LOGIN_ROUTE_KEY)); } catch { return null; }
}

function savePostLoginRoute(path) {
  const normalized = normalizePostLoginRoute(path);
  try {
    if (normalized) sessionStorage.setItem(POST_LOGIN_ROUTE_KEY, normalized);
    else sessionStorage.removeItem(POST_LOGIN_ROUTE_KEY);
  } catch {}
  return normalized;
}

function resolveRequestedRoutePath({clearSaved = false} = {}) {
  const currentPathname = typeof window !== 'undefined' ? window.location.pathname : '/overview';
  const currentHash = typeof window !== 'undefined' ? window.location.hash : '';
  const searchNext = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') : null;
  const fromCurrent = normalizePostLoginRoute(currentPathname, currentHash);
  const fromPending = normalizePostLoginRoute(pendingInitialRoutePath);
  const fromSearch = normalizePostLoginRoute(searchNext);
  const fromSaved = readSavedPostLoginRoute();
  const isLoginShell = ['/', '/index', '/index.html', '/app', '/app.html', '/login', '/login.html'].includes(currentPathname.toLowerCase());
  const resolved = fromCurrent || (isLoginShell ? (fromPending || fromSearch || fromSaved) : null) || currentPathname;
  if (clearSaved) {
    pendingInitialRoutePath = null;
    savePostLoginRoute(null);
  }
  return resolved;
}

let pendingInitialRoutePath = null;

if (typeof window !== 'undefined' && window.history) {
  const rawInit = window.location.pathname;
  const nextParam = new URLSearchParams(window.location.search).get('next');
  const isInitLoginShell = ['/', '/index', '/index.html', '/app', '/app.html', '/login', '/login.html'].includes(rawInit.toLowerCase());
  const detectedInitial = normalizePostLoginRoute(rawInit, window.location.hash)
    || (isInitLoginShell ? (normalizePostLoginRoute(nextParam) || readSavedPostLoginRoute()) : null);
  if (detectedInitial) {
    pendingInitialRoutePath = savePostLoginRoute(detectedInitial);
  }
  if (rawInit === '/app' || rawInit === '/app.html' || rawInit === '/login.html') {
    const loginTarget = detectedInitial ? `/login?next=${encodeURIComponent(detectedInitial)}` : ('/login' + window.location.search + window.location.hash);
    try {
      window.history.replaceState({path: loginTarget}, '', loginTarget);
    } catch {}
  } else if (/\.html$/i.test(rawInit)) {
    const cleanInitialPath = rawInit.replace(/\/index\.html$/i, '/') || '/';
    const strippedPath = cleanInitialPath === '/' ? '/' : cleanInitialPath.replace(/\.html$/i, '');
    try {
      window.history.replaceState({path: strippedPath}, '', strippedPath + window.location.search + window.location.hash);
    } catch {}
  }
}

function syncLoginUrl() {
  if (typeof window === 'undefined' || !window.history) return;
  const nextRoute = normalizePostLoginRoute(pendingInitialRoutePath) || readSavedPostLoginRoute();
  const target = nextRoute ? `/login?next=${encodeURIComponent(nextRoute)}` : '/login';
  if ((window.location.pathname + window.location.search) !== target) {
    try {
      window.history.replaceState({path: target}, '', target);
    } catch {}
  }
}

function syncBrowserUrl({replace = false, isClassEntry = false, subPage = (activeNav === 'admin' ? activeAdminSubPage : activeNav === 'practice' ? activePracticeSubPage : activeNav === 'settings' ? (activeSettingsTab === 'profile' ? null : activeSettingsTab) : null)} = {}) {
  if (typeof window === 'undefined' || !window.history || !me) return;
  const targetPath = buildAppRoutePath({
    page: activeNav,
    selectedClass,
    allClasses: selectedClass?.archived ? archivedClasses : classes,
    activeClassTab,
    materialsSubTab: activeMaterialsSubTab,
    subPage,
    isClassEntry
  });
  if (!targetPath) return;
  if (window.location.pathname === targetPath && !window.location.search) return;
  try {
    if (replace || suppressHistoryPush) {
      window.history.replaceState({path: targetPath}, '', targetPath);
    } else {
      window.history.pushState({path: targetPath}, '', targetPath);
    }
  } catch {}
}
const directClass = () => directClassForView(me, viewRole, classes, selectedClass);
const classTabs = [
  ['operations', 'Điều hành', 'dashboard'],
  ['notices', 'Thông báo', 'notice'],
  ['materials', 'Bài giảng', 'material'],
  ['assignments', 'Bài tập', 'assignment'],
  ['practice', 'Phòng luyện', 'practice'],
  ['attendance', 'Điểm danh', 'attendance'],
  ['forum', 'Diễn đàn', 'message']
];
let myEnrollment = null;
let authBusy = true;
let resendAt = 0;
let googleRedirecting = false;
let fieldSequence = 0;
let dialogReturnFocus = null;
let otpShouldFocus = false;

const labels = {
  admin: 'Quản trị viên',
  teacher: 'Giáo viên',
  assistant: 'Trợ giảng',
  student: 'Học sinh',
  parent: 'Phụ huynh'
};

const fmt = v => v ? new Date(v).toLocaleString('vi-VN', {hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric'}) : '';

function icon(name) {
  const map = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    class: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    notice: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    material: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    assignment: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>',
    practice: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
    attendance: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="m9 16 2 2 4-4"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    checkDouble: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    key: '<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    externalLink: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    chevronRight: '<polyline points="9 18 15 12 9 6"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    archive: '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/>'
  };
  const body = map[name];
  if (!body) return null;
  const wrap = document.createElement('span');
  wrap.className = 'icon-wrap';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return wrap;
}

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k in n) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

let statusDismissTimer = null;
let resendTimer = null;

function status(message = '', error = false, type = '') {
  const st = $('status');
  if (!st) return;
  if (statusDismissTimer) {
    clearTimeout(statusDismissTimer);
    statusDismissTimer = null;
  }
  if (!message) {
    st.replaceChildren();
    st.className = '';
    st.textContent = '';
    return;
  }
  const isLd = (message === 'Đang xử lý…' || message.startsWith('Đang ') || type === 'loading') && !error;
  const isSucc = type === 'success' || (!error && !isLd && (message.includes('thành công') || message.includes('Đã gửi') || message.includes('Đã lưu') || message.includes('Đã duyệt')));

  st.className = error ? 'error' : isLd ? 'loading' : isSucc ? 'success' : '';
  st.replaceChildren();

  if (isLd) {
    st.append(el('span', {class: 'toast-spinner'}));
  } else if (error) {
    const ic = el('span', {class: 'toast-icon'});
    ic.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    st.append(ic);
  } else if (isSucc) {
    const ic = el('span', {class: 'toast-icon'});
    ic.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    st.append(ic);
  }

  st.append(el('span', {class: 'toast-text', text: message}));

  const closeBtn = el('button', {
    type: 'button',
    class: 'toast-close',
    'aria-label': 'Đóng thông báo',
    onclick: () => status('')
  }, '×');
  if (!isLd) st.append(closeBtn);

  if (isSucc) {
    statusDismissTimer = setTimeout(() => {
      status('');
    }, 4500);
  }
}

async function run(task) {
  status('Đang xử lý…', false, 'loading');
  try {
    await task();
    const st = $('status');
    if (st && st.querySelector('.toast-text')?.textContent === 'Đang xử lý…') status('');
  } catch (e) {
    status(friendly(e), true);
  }
}

const mobileMenu = window.matchMedia('(max-width: 900px)');
function closeWorkspaceMenu(returnFocus = false) {
  const sidebar = $('workspace-sidebar');
  sidebar.classList.remove('is-open');
  sidebar.inert = mobileMenu.matches;
  sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal'); sidebar.removeAttribute('aria-labelledby');
  $('workspace-menu-backdrop').classList.remove('is-visible');
  $('workspace-menu-toggle').setAttribute('aria-expanded', 'false');
  document.querySelector('header.top').inert = false;
  $('content').inert = false;
  document.body.classList.remove('workspace-menu-open');
  if (returnFocus && mobileMenu.matches && !$('workspace').hidden) $('workspace-menu-toggle').focus();
}

$('workspace-menu-toggle').onclick = () => {
  if (!mobileMenu.matches) return;
  const sidebar = $('workspace-sidebar');
  sidebar.inert = false;
  sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-modal', 'true'); sidebar.setAttribute('aria-labelledby', 'workspace-drawer-title');
  sidebar.classList.add('is-open');
  $('workspace-menu-backdrop').classList.add('is-visible');
  $('workspace-menu-toggle').setAttribute('aria-expanded', 'true');
  document.querySelector('header.top').inert = true;
  $('content').inert = true;
  document.body.classList.add('workspace-menu-open');
  $('workspace-menu-close').focus({preventScroll: true});
};
$('workspace-menu-close').onclick = () => closeWorkspaceMenu(true);
$('workspace-menu-backdrop').onclick = () => closeWorkspaceMenu(true);
$('workspace-sidebar').addEventListener('keydown', event => {
  if (event.key === 'Escape') {event.preventDefault(); closeWorkspaceMenu(true); return;}
  if (event.key !== 'Tab' || !$('workspace-sidebar').classList.contains('is-open')) return;
  const controls = [...$('workspace-sidebar').querySelectorAll('button:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), a[href]')].filter(node => node.getClientRects().length);
  if (!controls.length) return;
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
  else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
});
document.querySelector('header .brand').onclick = event => {
  if (session && me) {event.preventDefault(); run(async () => {closeWorkspaceMenu(); await navigateTo('home'); focusContent();});}
};
mobileMenu.addEventListener('change', () => closeWorkspaceMenu());
closeWorkspaceMenu();
$('editor').addEventListener('close', () => {
  $('editor-content').querySelectorAll('.drive-video-lecture-panel').forEach(panelNode => {
    panelNode._ltchDisposeVideo?.();
  });
  $('editor-content').querySelectorAll('iframe').forEach(frame => {
    frame.src = 'about:blank';
    frame.remove();
  });
  syncTheaterBodyLock();
  const target = dialogReturnFocus;
  dialogReturnFocus = null;
  if (target?.isConnected && !target.disabled) target.focus();
});

function focusContent() {
  const target = $('content').querySelector('h1') || $('content');
  target.tabIndex = -1;
  target.focus({preventScroll: true});
}

function formNotice(form) {
  let notice = form.querySelector(':scope > .form-error');
  if (!notice) {
    notice = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
    form.prepend(notice);
  }
  return notice;
}

function showFormError(form, message) {
  const notice = formNotice(form);
  notice.textContent = message;
  notice.hidden = !message;
  if (message) notice.focus();
}

function attachFieldFeedback(input, labelText) {
  if (!input || !('validity' in input)) return el('span', {hidden: true});
  const safeLabel = String(labelText || 'thông tin');
  input.id ||= `ltch-field-${++fieldSequence}`;
  const error = el('span', {class: 'field-error', id: input.id + '-error', hidden: true});
  input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
  const update = () => {
    const validity = input.validity;
    let message = '';
    if (!validity.valid) {
      if (validity.valueMissing) {
        if (input.type === 'file') message = 'Vui lòng chọn tệp.';
        else if (input.tagName === 'SELECT') message = `Vui lòng chọn ${safeLabel.toLowerCase()}.`;
        else message = `Vui lòng nhập ${safeLabel.toLowerCase()}.`;
      }
      else if (validity.typeMismatch && input.type === 'email') message = 'Vui lòng nhập địa chỉ email hợp lệ.';
      else if (validity.tooShort) message = `Cần ít nhất ${input.minLength} ký tự.`;
      else if (input.name === 'code') message = 'Nhập đủ 6 chữ số của mã xác minh.';
      else message = `Vui lòng kiểm tra lại ${safeLabel.toLowerCase()}.`;
    }
    error.textContent = message;
    error.hidden = !message;
    input.setAttribute('aria-invalid', String(!!message));
  };
  input.addEventListener('invalid', update);
  if (input.type === 'file' || input.tagName === 'SELECT') input.addEventListener('invalid', event => {
    event.preventDefault();
    if (input.form?.querySelector(':invalid') === input) input.focus();
  });
  input.addEventListener('blur', () => {if (input.value || input.getAttribute('aria-invalid') === 'true') update();});
  input.addEventListener('input', () => {if (input.getAttribute('aria-invalid') === 'true') update();});
  input.addEventListener('change', () => {if (input.getAttribute('aria-invalid') === 'true') update();});
  return error;
}

function validateFormFields(formEl, errorEl) {
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }
  if (formEl && typeof formEl.checkValidity === 'function' && !formEl.checkValidity()) {
    const firstInvalid = formEl.querySelector(':invalid');
    if (firstInvalid) firstInvalid.focus();
    return false;
  }
  return true;
}

setupOtpSixBoxInput($('otp-form'));
initCustomSelectObserver();
for (const input of document.querySelectorAll('#email-form input, #otp-form input[name="code"]')) {
  const label = input.closest('label');
  label.append(attachFieldFeedback(input, label.querySelector('span').textContent));
}
for (const form of [$('email-form'), $('otp-form')]) {
  formNotice(form);
  form.addEventListener('input', () => showFormError(form, ''));
}

function updateAuthControls() {
  document.querySelectorAll('#login button, #login input, #otp-panel button, #otp-panel input, #logout').forEach(control => {
    control.disabled = authBusy;
  });
  $('resend').disabled = authBusy || Date.now() < resendAt;
  $('otp-form').querySelector('[type="submit"]').disabled = authBusy || !challenge;
  $('login').setAttribute('aria-busy', String(authBusy));
  $('otp-panel').setAttribute('aria-busy', String(authBusy));
  if (!authBusy && otpShouldFocus && challenge && !$('otp-panel').hidden) {
    otpShouldFocus = false;
    $('otp-form').elements.code.focus();
  }
}

function showAppLoadError(error) {
  closeWorkspaceMenu();
  document.querySelector('.auth-wrapper').hidden = false;
  $('login').hidden = true;
  $('otp-panel').hidden = true;
  $('workspace').hidden = true;
  $('onboarding-panel').hidden = true;
  $('pending-panel').hidden = false;
  $('logout').hidden = false;
  $('pending-panel').replaceChildren(
    el('h1', {text: error.status === 403 ? 'Tài khoản chưa được cấp quyền' : 'Chưa tải được lớp học'}),
    el('p', {text: friendly(error)}),
    btn('Thử tải lại', () => runAuth(loadApp), true),
    btn('Đổi tài khoản', () => runAuth(() => logout({keepPostLoginRoute: error.status === 403 && Boolean(pendingInitialRoutePath || readSavedPostLoginRoute())})))
  );
}

async function runAuth(task, errorForm = null) {
  if (authBusy) return;
  authBusy = true;
  updateAuthControls();
  status('Đang xử lý…', false, 'loading');
  if (errorForm) showFormError(errorForm, '');
  try {
    await task();
    if ($('status').querySelector('.toast-text')?.textContent === 'Đang xử lý…') status('');
  } catch (error) {
    if (Number.isFinite(error.retryAfter)) startOtpCountdown(error.retryAfter);
    if (session && auth.currentUser) {
      showAppLoadError(error);
      status(friendly(error), true);
    } else if (errorForm) {
      status('');
      showFormError(errorForm, friendly(error));
    } else status(friendly(error), true);
  } finally {
    authBusy = false;
    updateAuthControls();
  }
}

function friendly(e) {
  const map = {
    'INVALID_OTP': 'Mã xác minh không đúng hoặc đã hết hạn. Vui lòng kiểm tra mã hoặc yêu cầu mã mới.',
    'OTP_COOLDOWN': 'Vui lòng đợi hết thời gian đếm ngược trước khi gửi lại mã.',
    'OTP_DELIVERY_FAILED': 'Chưa gửi được email xác minh. Vui lòng đợi hết thời gian đếm ngược rồi gửi lại.',
    'AUTH_RATE_LIMITED': 'Có quá nhiều yêu cầu đăng nhập. Vui lòng đợi một lát rồi thử lại.',
    'IDENTITY_REQUIRED': 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    'Database request failed': 'Chưa kết nối được dữ liệu lớp học. Vui lòng thử lại sau ít phút.',
    'auth/cancelled-popup-request': 'Một cửa sổ đăng nhập khác đã được mở. Vui lòng hoàn tất trong cửa sổ đó.',
    'auth/popup-closed-by-user': 'Cửa sổ đăng nhập Google đã đóng trước khi hoàn tất.',
    'auth/popup-blocked': 'Trình duyệt đã chặn cửa sổ đăng nhập. Vui lòng cấp quyền mở popup cho trang này.',
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
    'auth/user-not-found': 'Không tìm thấy tài khoản với email này.',
    'auth/wrong-password': 'Mật khẩu không chính xác.',
    'auth/email-already-in-use': 'Email này đã có tài khoản. Hãy đăng nhập.',
    'auth/weak-password': 'Mật khẩu chưa đủ mạnh. Cần ít nhất 8 ký tự.',
    'auth/too-many-requests': 'Có quá nhiều yêu cầu gửi mã hoặc đăng nhập. Vui lòng đợi trong giây lát.',
    'auth/unauthorized-domain': 'Địa chỉ website chưa được kích hoạt cho Google Sign-in.',
    'auth/network-request-failed': 'Lỗi kết nối mạng. Vui lòng kiểm tra đường truyền Internet.',
    'auth/requires-recent-login': 'Vui lòng đăng nhập lại trước khi thực hiện đổi mật khẩu.',
    'Try again later': 'Vui lòng đợi 1 phút trước khi yêu cầu gửi lại mã xác minh mới.',
    'Delivery failed': 'Không thể gửi mã xác minh đến email của bạn. Vui lòng thử lại sau.',
    'Invalid or expired code': 'Mã xác minh OTP không đúng hoặc đã hết hạn (5 phút).',
    'Authentication required': 'Phiên đăng nhập đã hết hạn hoặc chưa xác thực danh tính. Vui lòng thử lại.',
    'Vui lòng thử lại sau.': 'Hệ thống đang bận hoặc có quá nhiều yêu cầu. Vui lòng đợi 1 phút rồi thử lại.'
  };
  return map[e.code] || map[e.message] || e.message || 'Không thể xử lý yêu cầu.';
}

function startOtpCountdown(seconds = 60) {
  const btn = $('resend');
  if (!btn) return;
  if (resendTimer) clearInterval(resendTimer);
  resendAt = Date.now() + Math.max(0, seconds) * 1000;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    if (remaining <= 0) {
      clearInterval(resendTimer);
      resendTimer = null;
      btn.disabled = authBusy;
      btn.textContent = 'Gửi lại mã xác minh';
    } else {
      btn.disabled = true;
      btn.textContent = `Gửi lại mã sau (${remaining}s)`;
    }
  };
  resendTimer = setInterval(tick, 1000);
  tick();
}

async function api(path, {method = 'GET', body, raw = false, identity = false, blob = false, timeoutMs, retry, idempotent = false} = {}) {
  const headers = {};
  if (!auth.currentUser) throw Error('Authentication required');
  if (identity) {
    headers.authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  } else {
    if (!session || sessionUid !== auth.currentUser.uid) throw Error('Vui lòng hoàn tất xác minh mã OTP để truy cập.');
    headers.authorization = `Session ${session.token}`;
    headers['x-firebase-token'] = await auth.currentUser.getIdToken();
  }
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (raw) {
    payload = body;
    headers['content-type'] = body.type || 'application/octet-stream';
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await requestApi(path, {method, headers, body: payload, blob, timeoutMs, retry, idempotent});
  if (!res.ok) {
    const data = res.data;
    if (res.status === 401 && !identity) {
      await logout({revoke: false, keepPostLoginRoute: $('workspace')?.hidden !== false});
    }
    const error = Error(data.error || 'Dịch vụ tạm thời không phản hồi.');
    Object.assign(error, {status: res.status, code: data.code, retryAfter: data.retryAfter});
    throw error;
  }
  return res.data;
}

async function beginOtp() {
  if (!auth.currentUser) throw Error('Chưa nhận diện được tài khoản. Vui lòng thử lại.');
  showOtpChallenge();
  status(`Đang gửi mã xác minh OTP đến hộp thư ${auth.currentUser.email}…`, false, 'loading');
  challenge = await api('/api/auth/begin', {method: 'POST', identity: true, timeoutMs: 35000});
  challenge.resendAt ??= Date.now() + 60000;
  session = null;
  sessionUid = null;
  authState.save(auth.currentUser.uid, {challenge});
  status('Đã gửi mã 6 chữ số (kiểm tra cả Thư rác nếu chưa thấy).', false, 'success');
  showOtpChallenge();
}

function showOtpChallenge() {
  closeWorkspaceMenu();
  otpShouldFocus = true;
  document.querySelector('.auth-wrapper').hidden = false;
  $('login').hidden = true;
  $('otp-panel').hidden = false;
  $('onboarding-panel').hidden = true;
  $('pending-panel').hidden = true;
  $('workspace').hidden = true;
  $('otp-description').replaceChildren(
    el('span', {class: 'otp-instruction', text: challenge ? 'Nhập mã đã gửi đến:' : 'Gửi mã xác minh đến:'}),
    el('strong', {class: 'otp-email', text: auth.currentUser.email}),
    el('span', {class: 'otp-hint', text: challenge ? 'Hiệu lực 5 phút · Kiểm tra cả Thư rác (Spam).' : 'Để tiếp tục đăng nhập.'})
  );
  $('otp-form').reset();
  showFormError($('otp-form'), '');
  $('otp-form').elements.code.setAttribute('aria-invalid', 'false');
  $('otp-form').querySelectorAll('.field-error').forEach(error => {error.textContent = ''; error.hidden = true;});
  startOtpCountdown(challenge ? Math.max(0, (challenge.resendAt - Date.now()) / 1000) : 0);
}

async function redirectGoogle(provider) {
  if (googleRedirecting) return;
  googleRedirecting = true;
  try {
    authState.setRedirectPending(true);
    status('Đang chuyển sang đăng nhập Google…');
    await signInWithRedirect(auth, provider);
  } catch (error) {
    googleRedirecting = false;
    authState.setRedirectPending(false);
    throw error;
  }
}

$('google').onclick = () => runAuth(async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    status('Đang mở cửa sổ đăng nhập Google…');
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked') {
      await redirectGoogle(provider);
      return;
    }
    if (googleRedirecting) return;
    if (err.code === 'auth/popup-closed-by-user') {
      status('Cửa sổ đăng nhập Google đã đóng.');
      return;
    }
    throw err;
  }
  if (googleRedirecting) return;
  await beginOtp();
});

$('toggle-register').onclick = () => {
  register = !register;
  $('confirm-label').hidden = !register;
  $('email-form').elements.confirm.required = register;
  if ($('register-consent-label')) $('register-consent-label').hidden = !register;
  if ($('email-form').elements.consent) { $('email-form').elements.consent.required = register; if (!register) $('email-form').elements.consent.checked = false; }
  $('email-form').elements.password.autocomplete = register ? 'new-password' : 'current-password';
  const authHeading = document.querySelector('#login .auth-header h1');
  if (authHeading) authHeading.textContent = register ? 'Đăng ký tài khoản' : 'Đăng nhập lớp học';
  if ($('reset-password')) $('reset-password').hidden = register;
  $('email-submit').textContent = register ? 'Đăng ký tài khoản' : 'Đăng nhập';
  $('toggle-register').textContent = register ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký mới';
};

$('email-form').onsubmit = e => {
  e.preventDefault();
  runAuth(async () => {
    const f = e.target;
    if (register) {
      if (f.elements.password.value !== f.elements.confirm.value) throw Error('Hai mật khẩu không trùng khớp.');
      if (f.elements.consent && !f.elements.consent.checked) throw Error('Vui lòng đọc và đồng ý với Chính sách bảo vệ dữ liệu cá nhân trước khi đăng ký.');
      await createUserWithEmailAndPassword(auth, f.elements.email.value, f.elements.password.value);
    } else {
      await signInWithEmailAndPassword(auth, f.elements.email.value, f.elements.password.value);
    }
    f.reset();
    await beginOtp();
  }, e.target);
};

$('reset-password').onclick = () => runAuth(async () => {
  const email = $('email-form').elements.email.value;
  if (!email) throw Error('Vui lòng nhập địa chỉ email vào ô trên trước khi yêu cầu đặt lại mật khẩu.');
  await sendPasswordResetEmail(auth, email);
  status('Hướng dẫn đặt lại mật khẩu đã được gửi đến email nếu tài khoản tồn tại.');
});

$('otp-form').onsubmit = e => {
  e.preventDefault();
  runAuth(async () => {
    if (!challenge || Date.now() >= challenge.expiresAt) throw Error('Invalid or expired code');
    session = await api('/api/auth/complete', {
      method: 'POST',
      identity: true,
      body: {challengeId: challenge.challengeId, code: e.target.elements.code.value},
      timeoutMs: 25000
    });
    challenge = null;
    sessionUid = auth.currentUser.uid;
    authState.save(sessionUid, {session});
    e.target.reset();
    await loadApp();
  }, e.target);
};

$('resend').onclick = () => {if (Date.now() >= resendAt) return runAuth(beginOtp);};
$('cancel-auth').onclick = () => runAuth(() => logout());
$('logout').onclick = () => runAuth(() => logout());

async function logout({revoke = true, keepPostLoginRoute = false} = {}) {
  closeWorkspaceMenu();
  if (resendTimer) {
    clearInterval(resendTimer);
    resendTimer = null;
  }
  const resendBtn = $('resend');
  if (resendBtn) {
    resendBtn.disabled = false;
    resendBtn.textContent = 'Gửi lại mã xác minh';
  }
  const oldSession = session;
  const oldUser = auth.currentUser;
  const revokeToken = revoke && oldSession && oldUser ? oldUser.getIdToken().catch(() => null) : null;
  authState.clear();
  authState.setRedirectPending(false);
  session = null;
  sessionUid = null;
  challenge = null;
  resendAt = 0;
  me = null;
  classes = [];
  workspace = null;
  selectedClass = workspaceSource = activeClassTab = activePracticeSubPage = activeAdminSubPage = viewRole = null;
  activeSettingsTab = 'profile';
  activeAdminTab = 'approvals';
  adminMembershipUiState = defaultAdminMembershipUiState();
  adminAccountUiState = defaultAdminAccountUiState();
  saveViewRole(null);
  activeNav = 'home';
  viewVersion++;
  contentVersion++;
  myEnrollment = null;
  if (!keepPostLoginRoute) {
    pendingInitialRoutePath = null;
    savePostLoginRoute(null);
  }
  await signOut(auth);
  syncLoginUrl();
  document.querySelector('.auth-wrapper').hidden = false;
  $('login').hidden = false;
  $('otp-panel').hidden = true;
  $('onboarding-panel').hidden = true;
  $('pending-panel').hidden = true;
  $('workspace').hidden = true;
  $('logout').hidden = true;
  const headerAccountBtn = $('header-account-btn');
  if (headerAccountBtn) {
    headerAccountBtn.hidden = true;
    headerAccountBtn.removeAttribute('aria-current');
  }
  const headerInitials = $('header-account-initials');
  if (headerInitials) headerInitials.textContent = '';
  $('account-label').textContent = '';
  const sc = $('auth-showcase');
  if (sc) sc.hidden = false;
  const badgeContainer = $('user-badge-container');
  if (badgeContainer) {
    badgeContainer.hidden = true;
    badgeContainer.innerHTML = '<span id="account-label"></span>';
  }
  if ($('editor').open) $('editor').close();
  // Revoke the server session without keeping the sign-out screen waiting.
  if (revokeToken) {
    revokeToken.then(token => token && requestApi('/api/auth/logout', {method: 'POST', idempotent: true, headers: {authorization: `Session ${oldSession.token}`, 'x-firebase-token': token}, timeoutMs: 5000})).catch(() => {});
  }
}

function btn(text, action, primary = false, iconName = null) {
  const button = el('button', {
    type: 'button',
    class: primary ? 'primary' : '',
    onclick: async () => {
      const dialogWasOpen = $('editor').open;
      button.disabled = true;
      try {
        await run(action);
      } finally {
        button.disabled = false;
        if (!dialogWasOpen && $('editor').open) dialogReturnFocus = button;
      }
    }
  });
  if (iconName) {
    const ic = icon(iconName);
    if (ic) button.append(ic);
  }
  button.append(el('span', {text}));
  return button;
}

function heading(title, subtitle, ...actions) {
  return el('div', {class: 'page-heading'},
    el('div', {},
      el('h1', {text: title}),
      subtitle ? el('p', {text: subtitle, class: 'muted'}) : null
    ),
    el('div', {class: 'actions'}, actions)
  );
}

function empty(text) {
  return el('p', {text, class: 'empty'});
}

function content(...nodes) {
  contentVersion++;
  closeActiveCustomSelect({restoreFocus: false});
  closeActiveActionMenu({restoreFocus: false});
  $('class-body')?._ltchForumDispose?.();
  $('content').querySelectorAll('.drive-video-lecture-panel').forEach(panelNode => {
    panelNode._ltchDisposeVideo?.();
  });
  $('content').replaceChildren(...nodes.flat().filter(node => node !== null && node !== undefined));
  syncTheaterBodyLock();
  upgradeAllSelectsIn($('content'));
}

function field(name, label, type = 'text', value = '', options = {}) {
  let input;
  if (type === 'select') {
    input = el('select', {name, required: options.required !== false});
    for (const item of options.items || []) {
      if (item.optgroup) {
        const group = el('optgroup', {label: item.optgroup});
        for (const sub of item.options || []) group.append(el('option', {value: sub.value, text: sub.label}));
        input.append(group);
      } else {
        input.append(el('option', {value: item.value, text: item.label}));
      }
    }
    input.value = value;
  } else if (type === 'textarea') {
    input = el('textarea', {name, value, maxLength: options.max || 20000, required: options.required !== false, placeholder: options.placeholder || ''});
  } else {
    input = el('input', {name, type, value, required: options.required !== false, placeholder: options.placeholder || '', ...options});
  }
  const title = el('span', {class: 'field-label'}, label,
    input.required ? el('span', {class: 'required-mark', 'aria-hidden': 'true', text: ' *'}) : null);
  if (type === 'file') {
    input.classList.add('file-picker-input');
    input.setAttribute('aria-label', label);
    const selection = el('span', {class: 'file-picker-selection', 'aria-live': 'polite', text: 'Chưa có tệp nào được chọn'});
    const surface = el('span', {class: 'file-picker-surface'},
      el('span', {class: 'file-picker-action'}, icon('material'), el('span', {text: options.multiple ? 'Chọn các tệp' : 'Chọn tệp'})),
      selection);
    input.addEventListener('change', () => {
      const files = [...input.files];
      selection.textContent = files.length ? files.map(file => file.name).join(', ') : 'Chưa có tệp nào được chọn';
    });
    return {label: el('label', {class: 'file-picker'}, title, input, surface, attachFieldFeedback(input, label)), input};
  }
  return {label: el('label', {}, title, input, attachFieldFeedback(input, label)), input};
}

function form(fields, submitText, onSave) {
  const controls = {}, f = el('form');
  for (const spec of fields) {
    const item = field(...spec);
    controls[spec[0]] = item.input;
    f.append(item.label);
  }
  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const submit = el('button', {type: 'submit', class: 'primary wide', text: submitText});
  f.prepend(error);
  f.append(submit);
  const clearError = () => {error.textContent = ''; error.hidden = true;};
  f.addEventListener('input', clearError);
  f.addEventListener('change', clearError);
  f.onsubmit = async e => {
    e.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    error.hidden = true;
    try {
      await onSave(Object.fromEntries(Object.entries(controls).map(([k, v]) => [k, v.value])), f);
    } catch (e) {
      error.textContent = friendly(e);
      error.hidden = false;
      error.focus();
    } finally {
      submit.disabled = false;
    }
  };
  return f;
}

function modal(title, body) {
  closeActiveCustomSelect({restoreFocus: false});
  $('editor-content').replaceChildren(el('h2', {id: 'editor-title', text: title}), body);
  if (!$('editor').open) $('editor').showModal();
  upgradeAllSelectsIn($('editor-content'));
}

function scheduleFields(slots = [], enabled = true, {autoAddDefaultRow = false} = {}) {
  const rows = [], list = el('div', {class: 'schedule-rows'});
  const add = (slot = {}) => {
    if (rows.length >= 14) return;
    const day = field('day', 'Ngày học trong tuần', 'select', slot.day || '', {items: [{value: '', label: 'Chọn thứ'}, ...weekDays.map((label, i) => ({value: i + 1, label}))]});
    const start = field('start', 'Giờ bắt đầu', 'time', slot.start || '18:00');
    const end = field('end', 'Giờ kết thúc', 'time', slot.end || '20:00');
    const entry = {day: day.input, start: start.input, end: end.input};
    const remove = btn('Xóa buổi', () => {rows.splice(rows.indexOf(entry), 1); row.remove(); addButton.disabled = false; addButton.focus();});
    const row = el('div', {class: 'schedule-row'}, day.label, start.label, end.label, remove);
    rows.push(entry); list.append(row); addButton.disabled = rows.length >= 14;
  };
  const addButton = btn('Thêm buổi học', () => {add(); rows.at(-1)?.day.focus();}, false, 'plus');
  const reminder = el('input', {type: 'checkbox', checked: enabled});
  const root = el('fieldset', {class: 'schedule-fields'},
    el('legend', {text: 'Lịch học cố định hằng tuần'}),
    el('p', {class: 'meta', text: 'Giờ Việt Nam (UTC+7). Chọn thứ và khung giờ cố định cho từng buổi trong tuần; hệ thống tự động tính ngày cụ thể cho ~50 buổi học trong năm.'}),
    list, addButton,
    el('label', {class: 'check'}, reminder, 'Gửi email nhắc học trước 30 phút cho học sinh trong lớp')
  );
  if (slots && slots.length) {
    for (const slot of slots) add(slot);
  } else if (autoAddDefaultRow) {
    add({day: 1, start: '18:00', end: '20:00'});
  }
  return {
    root,
    read: () => ({
      scheduleSlots: validateSchedule(
        rows
          .filter(row => row.day.value || row.start.value || row.end.value)
          .map(row => ({day: Number(row.day.value), start: row.start.value, end: row.end.value}))
      ),
      remindersEnabled: reminder.checked
    })
  };
}

function scheduleEditor(klass = workspace?.class || selectedClass, {startDate = null, totalSessions = DEFAULT_COURSE_SESSIONS_COUNT, onSaved = null} = {}) {
  if (!klass) return;
  const existingSlots = klass.schedule_slots || klass.scheduleSlots || [];
  const controls = scheduleFields(existingSlots, klass.reminders_enabled ?? klass.remindersEnabled ?? true, {autoAddDefaultRow: true});
  const defaultStart = parseIsoDateParts(startDate)?.iso || `${schoolYearStart(klass)}-09-01`;
  const startField = field('courseStartDate', 'Ngày bắt đầu Buổi 1 của năm học', 'date', defaultStart);
  const countField = field('totalSessions', 'Tổng số buổi học dự kiến trong năm', 'number', String(totalSessions || DEFAULT_COURSE_SESSIONS_COUNT), {
    min: 10,
    max: 150
  });
  const syncCheckbox = el('input', {type: 'checkbox', checked: true});
  const syncBox = el('div', {class: 'session-sync-options'},
    el('div', {class: 'form-grid-2'}, startField.label, countField.label),
    el('label', {class: 'check'},
      syncCheckbox,
      'Tự động cập nhật ngày học cho toàn bộ danh sách Buổi học (Buổi 1 → Buổi 50) theo lịch cố định này'
    )
  );
  const version = viewVersion;
  const f = form([], 'Lưu lịch cố định & Đồng bộ buổi học', async () => {
    const schedulePayload = controls.read();
    await api(`/api/classes/${klass.id}/schedule`, {
      method: 'POST',
      body: {
        ...schedulePayload,
        version: klass.schedule_revision ?? klass.scheduleRevision ?? 0
      }
    });
    if (syncCheckbox.checked) {
      await api(`/api/classes/${klass.id}/sessions`, {
        method: 'POST',
        body: {
          action: 'sync_from_schedule',
          startDate: startField.input.value,
          totalSessions: Number(countField.input.value) || DEFAULT_COURSE_SESSIONS_COUNT
        }
      });
    }
    classes = sortClasses((await api('/api/classes')).items);
    if (version !== viewVersion) return;
    $('editor').close();
    if (typeof onSaved === 'function') {
      await onSaved();
    } else if (activeClassTab) {
      await refreshClass(activeClassTab);
    } else {
      await adminPage();
    }
    status(syncCheckbox.checked ? 'Đã lưu lịch học cố định và tự động cập nhật ngày cho các buổi học.' : 'Đã lưu lịch học cố định và cài đặt nhắc trước giờ học.');
  });
  f.querySelector('button[type=submit]').before(controls.root, syncBox);
  modal(`Lịch học cố định · ${klass.name}`, f);
}

function newClassForm(years) {
  const schedule = scheduleFields();
  const f = form([
    ['name', 'Tên lớp học (VD: Lớp 6A, Lớp 12B)'],
    ['schoolYearId', 'Năm học', 'select', years[0]?.id || '', {items: years.map(y => ({value: y.id, label: y.name}))}]
  ], 'Tạo lớp học', async b => {
    await api('/api/admin/classes', {method: 'POST', body: {...b, ...schedule.read()}});
    classes = sortClasses((await api('/api/classes')).items);
    await adminPage();
  });
  f.querySelector('button[type=submit]').before(schedule.root);
  return f;
}

/**
 * AUTO-ROUTING LOGIC
 * Tự động kiểm tra trạng thái tài khoản:
 * 1. Admin / Teacher -> Vào thẳng Workspace
 * 2. Đã duyệt và active -> Vào thẳng Workspace
 * 3. Đang chờ duyệt -> Màn hình Chờ Quản trị viên duyệt
 * 4. Yêu cầu sửa -> Mở Form kèm lời nhắn cảnh báo từ Admin
 * 5. Mới tinh (chưa có đơn) -> Mở Form đăng ký vào lớp
 */
async function loadApp() {
  const initial = await api('/api/bootstrap');
  if (initial.accountStatus === 'pending') {
    me = null;
    classes = [];
    await handleUnassignedAccount();
    return;
  }
  if (initial.accountStatus !== 'active' || !initial.me || !Array.isArray(initial.classes)) throw Error('Dịch vụ trả về dữ liệu không hợp lệ. Vui lòng thử lại.');
  me = initial.me;
  classes = sortClasses(initial.classes);

  // Active accounts without a class see the empty workspace, not a new registration.
  const roles = availableViewRoles(me);
  const savedRole = readSavedViewRole();
  viewRole = roles.includes('admin')
    ? 'admin'
    : (roles.includes(viewRole) ? viewRole : (savedRole && roles.includes(savedRole) ? savedRole : roles[0]));
  saveViewRole(viewRole);
  activeNav = 'home';
  activeClassTab = null;
  activePracticeSubPage = null;
  activeAdminSubPage = null;
  selectedClass = workspaceSource = workspace = null;
  viewVersion++;
  await showWorkspaceView(initial.overview);
}

async function ensureArchivedClassesLoaded() {
  if (!isStaffView()) return [];
  try {
    const res = await api('/api/classes/cohorts');
    if (Array.isArray(res.archivedClasses)) {
      archivedClasses = res.archivedClasses.map(c => ({...c, archived: true}));
    }
  } catch {}
  return archivedClasses;
}

function prependAdminSwitchNotice(panel, targetPath) {
  if (!panel || !targetPath) return;
  panel.querySelector('.route-switch-account-banner')?.remove();
  const normalized = savePostLoginRoute(targetPath);
  if (!normalized) return;
  pendingInitialRoutePath = normalized;
  const accountEmail = auth.currentUser?.email;
  const banner = el('div', {class: 'notice route-switch-account-banner', role: 'status'},
    el('strong', {text: 'Bạn đang mở trang dành cho Quản trị viên'}),
    el('p', {
      class: 'meta',
      text: accountEmail
        ? `Trình duyệt hiện đang đăng nhập bằng tài khoản "${accountEmail}" (chưa có quyền Quản trị). Hãy chuyển sang tài khoản Quản trị để mở đúng trang xét duyệt.`
        : 'Tài khoản hiện tại chưa có quyền Quản trị. Hãy chuyển sang tài khoản Quản trị để mở đúng trang xét duyệt.'
    }),
    el('div', {class: 'actions'},
      btn('Chuyển sang tài khoản Quản trị', () => runAuth(() => {
        pendingInitialRoutePath = savePostLoginRoute(normalized);
        return logout({keepPostLoginRoute: true});
      }), true)
    )
  );
  panel.prepend(banner);
}

async function restoreRouteFromLocation(initialOverview = null, {replaceUrl = true} = {}) {
  const pathname = resolveRequestedRoutePath({clearSaved: true});
  const route = parseAppRoutePath(pathname);
  const pages = navigationForView(me, viewRole);

  if (route.page === 'admin') {
    if (availableViewRoles(me).includes('admin')) {
      if (viewRole !== 'admin') {
        viewRole = 'admin';
        saveViewRole(viewRole);
      }
      await navigateTo('admin', {replaceUrl, subPage: route.subPage || null});
      return;
    }
    if (route.subPage === 'enrollments' && availableViewRoles(me).includes('teacher') && navigationForView(me, 'teacher').includes('enrollments')) {
      if (viewRole !== 'teacher') {
        viewRole = 'teacher';
        saveViewRole(viewRole);
      }
      await navigateTo('enrollments', {replaceUrl});
      return;
    }
  }

  if (route.page === 'enrollments') {
    if (availableViewRoles(me).includes('admin')) {
      if (viewRole !== 'admin') {
        viewRole = 'admin';
        saveViewRole(viewRole);
      }
      await navigateTo('admin', {replaceUrl: true, subPage: 'enrollments'});
      return;
    }
    if (availableViewRoles(me).includes('teacher') && navigationForView(me, 'teacher').includes('enrollments')) {
      if (viewRole !== 'teacher') {
        viewRole = 'teacher';
        saveViewRole(viewRole);
      }
      await navigateTo('enrollments', {replaceUrl});
      return;
    }
  }

  if (route.page === 'classes' && route.cohortSlug) {
    let targetClass = findClassByCohortSlug(visibleClasses(), route.cohortSlug);
    if (!targetClass && isStaffView()) {
      await ensureArchivedClassesLoaded();
      targetClass = findClassByCohortSlug(archivedClasses, route.cohortSlug);
    }
    if (!targetClass) {
      const candidateRoles = availableViewRoles(me).filter(r => r !== viewRole && me.roles.includes(r));
      for (const candidateRole of candidateRoles) {
        const matched = findClassByCohortSlug(classesForView(me, candidateRole, classes), route.cohortSlug);
        if (matched) {
          viewRole = candidateRole;
          saveViewRole(viewRole);
          targetClass = matched;
          break;
        }
      }
      if (!targetClass && !isStaffView()) {
        const staffCandidate = availableViewRoles(me).find(r => ['admin', 'teacher', 'assistant'].includes(r) && me.roles.includes(r));
        if (staffCandidate) {
          const prevRole = viewRole;
          viewRole = staffCandidate;
          await ensureArchivedClassesLoaded();
          const archivedMatch = findClassByCohortSlug(classesForView(me, staffCandidate, archivedClasses), route.cohortSlug);
          if (archivedMatch) {
            saveViewRole(viewRole);
            targetClass = archivedMatch;
          } else {
            viewRole = prevRole;
          }
        }
      }
    }
    if (targetClass) {
      let nextTab = route.classTab || 'notices';
      if (!tabsForView(viewRole, targetClass).includes(nextTab) && me.roles.includes('admin') && viewRole !== 'admin') {
        viewRole = 'admin';
        saveViewRole(viewRole);
      }
      const isEntry = Boolean(route.isClassEntry);
      if (isEntry && viewRole === 'admin') {
        nextTab = 'operations';
      }
      if (route.materialsSubTab) activeMaterialsSubTab = route.materialsSubTab;
      if (workspace && workspaceSource && selectedClass?.id === targetClass.id) {
        activeNav = 'classes';
        classView(nextTab, {isClassEntry: isEntry, subPage: route.subPage || null, replaceUrl});
        return;
      }
      await openClass(targetClass, nextTab, {
        isClassEntry: isEntry,
        materialsSubTab: route.materialsSubTab || 'files',
        subPage: route.subPage || null,
        replaceUrl
      });
      return;
    }
    if (pages.includes('classes')) {
      await navigateTo('classes', {replaceUrl: true});
      return;
    }
  }

  if (route.page === 'classes') {
    if (pages.includes('classes')) {
      await navigateTo('classes', {replaceUrl});
      return;
    }
    const singleClass = directClass();
    if (singleClass) {
      await openClass(singleClass, 'notices', {isClassEntry: true, replaceUrl: true});
      return;
    }
  }

  if (route.page === 'practice') {
    await navigateTo('practice', {replaceUrl, subPage: route.subPage || null});
    return;
  }

  if (route.page === 'archive' && isStaffView()) {
    await navigateTo('archive', {replaceUrl});
    return;
  }

  if (route.page === 'settings' && pages.includes('settings')) {
    await navigateTo('settings', {replaceUrl, subPage: route.subPage || null});
    return;
  }

  if (route.page === 'onboarding') {
    const learnerClass = directClass();
    if (learnerClass) {
      await openClass(learnerClass, 'notices', {isClassEntry: true, replaceUrl: true});
      status('Tài khoản của bạn đã được kích hoạt vào lớp học.');
      return;
    }
  }

  activeNav = 'home';
  activeClassTab = null;
  activePracticeSubPage = null;
  activeAdminSubPage = null;
  selectedClass = workspaceSource = workspace = null;
  navigation();
  syncBrowserUrl({replace: true});
  await home(initialOverview);
  if ((route.page === 'admin' && route.subPage) || route.page === 'enrollments') {
    prependAdminSwitchNotice($('content'), pathname);
  } else if (route.page === 'onboarding') {
    status('Tài khoản của bạn đã được kích hoạt.');
  }
}

function syncAccountIdentityUI() {
  if (!me) return;
  const initials = formatUserInitials(me.name, 'LT');
  const badgeContainer = $('user-badge-container');
  const currentLabel = labels[viewRole] || 'Thành viên';
  if (badgeContainer) {
    const existingAvatar = badgeContainer.querySelector('.user-avatar');
    const existingAccountLabel = $('account-label');
    if (existingAvatar && existingAccountLabel) {
      existingAvatar.textContent = initials;
      existingAccountLabel.textContent = me.name;
      existingAccountLabel.title = me.name;
    } else {
      badgeContainer.replaceChildren(
        el('span', {class: 'user-avatar', 'aria-hidden': 'true', text: initials}),
        el('span', {class: 'user-identity'},
          el('span', {id: 'account-label', text: me.name, title: me.name}),
          el('span', {id: 'current-role-label', class: 'user-role', text: currentLabel}),
          el('span', {id: 'user-badge-cohort-label', class: 'user-cohort-meta', hidden: true})
        ),
        el('span', {class: 'user-badge-chevron', 'aria-hidden': 'true'}, icon('chevronRight'))
      );
    }
    badgeContainer.hidden = false;
    badgeContainer.setAttribute('aria-label', `Tài khoản cá nhân · ${me.name}`);
    badgeContainer.title = `Tài khoản cá nhân · ${me.name}`;
    badgeContainer.onclick = () => run(async () => {closeWorkspaceMenu(); await navigateTo('settings'); focusContent();});
  } else if ($('account-label')) {
    $('account-label').textContent = me.name;
    $('account-label').title = me.name;
  }

  const headerAccountBtn = $('header-account-btn');
  const headerInitials = $('header-account-initials');
  if (headerAccountBtn) {
    headerAccountBtn.hidden = false;
    headerAccountBtn.setAttribute('aria-label', `Tài khoản cá nhân · ${me.name}`);
    headerAccountBtn.title = `Tài khoản cá nhân · ${me.name}`;
    if (activeNav === 'settings') headerAccountBtn.setAttribute('aria-current', 'page');
    else headerAccountBtn.removeAttribute('aria-current');
    headerAccountBtn.onclick = () => run(async () => {closeWorkspaceMenu(); await navigateTo('settings'); focusContent();});
  }
  if (headerInitials) headerInitials.textContent = initials;
}

async function showWorkspaceView(initialOverview = null) {
  document.querySelector('.auth-wrapper').hidden = true;
  $('login').hidden = true;
  $('otp-panel').hidden = true;
  $('onboarding-panel').hidden = true;
  $('pending-panel').hidden = true;
  const sc = $('auth-showcase');
  if (sc) sc.hidden = true;
  $('workspace').hidden = false;
  $('logout').hidden = false;

  syncAccountIdentityUI();

  await restoreRouteFromLocation(initialOverview, {replaceUrl: true});
}

async function handleUnassignedAccount() {
  closeWorkspaceMenu();
  document.querySelector('.auth-wrapper').hidden = false;
  const res = await api('/api/enrollment/my-status');
  myEnrollment = res;
  $('login').hidden = true;
  $('otp-panel').hidden = true;
  $('workspace').hidden = true;
  $('logout').hidden = false;

  const requestedPath = resolveRequestedRoutePath({clearSaved: false});
  const requestedRoute = parseAppRoutePath(requestedPath);
  const isAdminLink = ['admin', 'enrollments'].includes(requestedRoute.page);

  if (res.hasRequest) {
    if (res.status === 'needs_revision') {
      if (requestedRoute.page === 'onboarding') {
        pendingInitialRoutePath = null;
        savePostLoginRoute(null);
      }
      await showOnboardingForm(res.request, true);
      if (requestedRoute.page === 'onboarding' && typeof window !== 'undefined' && window.history && window.location.pathname !== '/onboarding') {
        try { window.history.replaceState({path: '/onboarding'}, '', '/onboarding'); } catch {}
      }
      if (isAdminLink) prependAdminSwitchNotice($('onboarding-panel'), requestedPath);
    } else if (res.status === 'pending') {
      if (requestedRoute.page === 'onboarding') {
        pendingInitialRoutePath = null;
        savePostLoginRoute(null);
        await showOnboardingForm(res.request, false);
        if (typeof window !== 'undefined' && window.history && window.location.pathname !== '/onboarding') {
          try { window.history.replaceState({path: '/onboarding'}, '', '/onboarding'); } catch {}
        }
      } else {
        showPendingScreen(res.request);
      }
      if (isAdminLink) prependAdminSwitchNotice(requestedRoute.page === 'onboarding' ? $('onboarding-panel') : $('pending-panel'), requestedPath);
    } else if (res.status === 'approved') {
      const [profile, classList] = await Promise.all([api('/api/me'), api('/api/classes')]);
      me = profile;
      classes = sortClasses(classList.items);
      viewRole = me.roles.includes('admin') ? 'admin' : me.roles[0];
      saveViewRole(viewRole);
      await showWorkspaceView();
    } else {
      const error = Error('Hồ sơ chưa được chấp nhận. Vui lòng liên hệ quản trị viên để được hỗ trợ.');
      error.status = 403;
      throw error;
    }
  } else if (res.status === 'staff_pending') {
    showStaffPending(res.staffRole);
    if (isAdminLink) prependAdminSwitchNotice($('pending-panel'), requestedPath);
  } else {
    showRoleChoice();
    if (isAdminLink) prependAdminSwitchNotice($('onboarding-panel'), requestedPath);
  }
}

function showRoleChoice() {
  const sc = $('auth-showcase'); if (sc) sc.hidden = true;
  $('pending-panel').hidden = true;
  const panel = $('onboarding-panel'); panel.hidden = false;
  panel.replaceChildren(
    el('div', {class: 'auth-header'},
      el('span', {class: 'auth-badge', text: 'Lớp Toán cô Hạnh'}),
      el('h1', {text: 'Bạn tham gia với vai trò nào?'}),
      el('p', {class: 'muted', text: 'Chọn vai trò để tiếp tục. Giáo viên và trợ giảng sẽ được quản trị viên xét duyệt.'})
    ),
    el('div', {class: 'role-choice-grid'},
      ...[['student','Học sinh'],['parent','Phụ huynh'],['teacher','Giáo viên'],['assistant','Trợ giảng']].map(([role,label]) =>
        btn(label, () => role === 'student' || role === 'parent'
          ? showOnboardingForm(null, false, role)
          : showStaffConfirmation(role), false))
    )
  );
}

function showStaffConfirmation(role) {
  const panel = $('onboarding-panel');
  const staffConsentInput = el('input', {type: 'checkbox', name: 'staffConsent'});
  const staffConsentLabel = el('label', {class: 'consent-check'},
    staffConsentInput,
    el('span', {},
      'Tôi đồng ý để Lớp Toán cô Hạnh sử dụng tên hiển thị và địa chỉ email tài khoản nhằm xét duyệt và phân công giảng dạy theo ',
      el('a', {href: '/chinh-sach-bao-mat.html', target: '_blank', rel: 'noopener', text: 'Chính sách bảo vệ dữ liệu cá nhân'}),
      '.'
    )
  );
  panel.replaceChildren(
    el('div', {class: 'auth-header'},
      el('span', {class: 'auth-badge', text: 'Yêu cầu xét duyệt'}),
      el('h1', {text: `Tham gia với vai trò ${labels[role].toLowerCase()}`}),
      el('p', {class: 'muted', text: 'Hệ thống sẽ gửi tên và email tài khoản đến quản trị viên để kiểm tra và phân công.'})
    ),
    staffConsentLabel,
    el('div', {class: 'actions pending-actions'},
      btn('Gửi yêu cầu', () => {
        if (!staffConsentInput.checked) throw Error('Vui lòng đồng ý với Chính sách bảo vệ dữ liệu cá nhân trước khi gửi yêu cầu.');
        return requestStaffRole(role);
      }, true),
      btn('Chọn lại vai trò', showRoleChoice)
    )
  );
}

async function requestStaffRole(role) {
  const result = await api('/api/enrollment/staff-request', {method: 'POST', body: {role}, timeoutMs: 35000});
  showStaffPending(role, result.notificationStatus);
}

function showStaffPending(role, notificationStatus = '') {
  $('onboarding-panel').hidden = true;
  const panel = $('pending-panel'); panel.hidden = false;
  const title = labels[role] || 'Nhân sự';
  panel.replaceChildren(
    el('span', {class: 'auth-badge', text: 'Đang chờ xét duyệt'}),
    el('h1', {text: `Yêu cầu ${title.toLowerCase()}`}),
    el('p', {text: 'Yêu cầu đã được ghi nhận trong trang quản trị. Quản trị viên sẽ kiểm tra và phân công lớp sau khi duyệt.'}),
    notificationStatus === 'sent' ? el('p', {class: 'meta', text: 'Đã gửi thông báo đến quản trị viên.'}) : null,
    notificationStatus === 'not_sent' ? el('p', {class: 'meta', text: 'Yêu cầu đã được ghi nhận; chưa gửi được email thông báo. Bạn có thể thử gửi lại.'}) : null,
    el('div', {class: 'actions pending-actions'},
      btn('Kiểm tra trạng thái', () => runAuth(loadApp), true),
      btn('Gửi lại thông báo', () => requestStaffRole(role)),
      btn('Đăng xuất', () => logout())
    )
  );
  const requestedPath = resolveRequestedRoutePath({clearSaved: false});
  if (['admin', 'enrollments'].includes(parseAppRoutePath(requestedPath).page)) {
    prependAdminSwitchNotice(panel, requestedPath);
  }
}

function openAvatarCrop(file, returnFocus, onApply) {
  const sourceUrl = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    if (!returnFocus.isConnected) { URL.revokeObjectURL(sourceUrl); return; }
    const canvas = el('canvas', {class: 'crop-preview', width: 512, height: 512, 'aria-label': 'Ảnh xem trước sau khi căn chỉnh'});
    const zoom = el('input', {type: 'range', min: '1', max: '3', step: '0.01', value: '1', 'aria-label': 'Phóng to ảnh'});
    const horizontal = el('input', {type: 'range', min: '0', max: '100', step: '1', value: '50', 'aria-label': 'Vị trí ngang'});
    const vertical = el('input', {type: 'range', min: '0', max: '100', step: '1', value: '50', 'aria-label': 'Vị trí dọc'});
    const render = () => drawAvatar(canvas, image, Number(zoom.value), Number(horizontal.value), Number(vertical.value));
    for (const input of [zoom, horizontal, vertical]) input.addEventListener('input', render);
    const control = (text, input) => el('label', {class: 'crop-control'}, el('span', {text}), input);
    const body = el('div', {class: 'crop-editor'},
      el('p', {class: 'meta', text: 'Kéo ảnh trực tiếp trong khung lưới để đặt khuôn mặt vào giữa vòng tròn.'}),
      el('div', {class: 'crop-stage'}, canvas),
      el('div', {class: 'crop-controls'}, control('Phóng to', zoom),
        el('details', {class: 'crop-position-controls'},
          el('summary', {text: 'Điều chỉnh vị trí chính xác'}),
          control('Vị trí ngang', horizontal), control('Vị trí dọc', vertical))),
      el('div', {class: 'actions'},
        btn('Dùng ảnh này', async () => {
          const output = document.createElement('canvas'); output.width = output.height = 512;
          drawAvatar(output, image, Number(zoom.value), Number(horizontal.value), Number(vertical.value));
          const blob = await new Promise(resolve => output.toBlob(resolve, 'image/jpeg', 0.9));
          if (!blob) throw Error('Không thể lưu ảnh đã chỉnh. Vui lòng chọn lại ảnh.');
          if (!$('editor').open || !returnFocus.isConnected) return;
          onApply(new File([blob], 'anh-nhan-dien.jpg', {type: 'image/jpeg'}));
          $('editor').close();
        }, true),
        btn('Hủy', () => $('editor').close())
      )
    );
    let drag = null;
    canvas.addEventListener('pointerdown', event => {
      drag = {x: event.clientX, y: event.clientY, horizontal: Number(horizontal.value), vertical: Number(vertical.value)};
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag) return;
      const region = cropRegion(image.naturalWidth, image.naturalHeight, Number(zoom.value), 50, 50);
      const width = canvas.getBoundingClientRect().width;
      const move = (start, delta, space) => space > 0 ? Math.max(0, Math.min(100, start - delta * region.size / width / space * 100)) : start;
      horizontal.value = move(drag.horizontal, event.clientX - drag.x, image.naturalWidth - region.size);
      vertical.value = move(drag.vertical, event.clientY - drag.y, image.naturalHeight - region.size);
      render();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { drag = null; });
    $('editor').addEventListener('close', () => URL.revokeObjectURL(sourceUrl), {once: true});
    dialogReturnFocus = returnFocus;
    modal('Căn chỉnh ảnh nhận diện', body);
    render();
  };
  image.onerror = () => { URL.revokeObjectURL(sourceUrl); status('Không đọc được ảnh. Vui lòng chọn ảnh JPG hoặc PNG khác.', true); };
  image.src = sourceUrl;
}

/** Biểu mẫu học sinh và phụ huynh. */
async function showOnboardingForm(existingData = null, isRevision = false, selectedRole = 'student') {
  document.querySelector('.auth-wrapper').hidden = false;
  $('pending-panel').hidden = true;
  const sc = $('auth-showcase');
  if (sc) sc.hidden = true;
  const panel = $('onboarding-panel');
  panel.hidden = false;
  panel.replaceChildren();

  // Danh mục đăng ký được đọc từ server; không tạo lớp giả.
  const catalog = await api('/api/enrollment/catalog');
  const availableClasses = catalog.classes || [];
  const availableYears = catalog.years || [];
  // Header
  panel.append(
    el('div', {class: 'auth-header'},
      el('span', {class: 'auth-badge', text: isRevision ? 'Cập nhật thông tin hồ sơ' : 'Bước 1 / 2 · Đăng ký vào lớp'}),
      el('p', {class: 'kicker', text: 'Lớp Toán cô Hạnh'}),
      el('h1', {text: isRevision ? 'Hoàn thiện hồ sơ học tập' : 'Đăng ký tham gia Lớp Toán cô Hạnh'}),
      el('p', {class: 'muted', text: isRevision ? 'Quản trị viên đã gửi phản hồi yêu cầu điều chỉnh. Em vui lòng xem lời nhắn bên dưới và cập nhật lại.' : 'Để cô Hạnh và Quản trị viên xếp đúng lớp và bảo đảm quyền lợi học tập, em vui lòng điền đầy đủ các thông tin bên dưới.'})
    )
  );

  if (!existingData) panel.append(btn('← Chọn lại vai trò', showRoleChoice));

  // Nếu là yêu cầu chỉnh sửa: Hiển thị Hộp cảnh báo màu cam nổi bật
  const notes = existingData?.adminNotes || existingData?.admin_notes || myEnrollment?.adminNotes || myEnrollment?.admin_notes;
  if (isRevision && notes) {
    panel.append(
      el('div', {class: 'revision-alert'},
        el('strong', {text: 'Yêu cầu chỉnh sửa từ Quản trị viên:'}),
        el('p', {text: notes})
      )
    );
  }

  // Khung chọn ảnh nhận diện (Avatar Upload)
  let photoDataUrl = existingData?.hasPhoto ? 'existing-photo' : null;
  let croppedPhoto = null;
  if (existingData?.photoUrl) photoDataUrl = /^(blob:|data:)/.test(existingData.photoUrl) ? existingData.photoUrl : URL.createObjectURL(await api(existingData.photoUrl, {blob:true}));
  const avatarInput = el('input', {type: 'file', accept: 'image/jpeg,image/png', style: 'display: none;'});
  const previewImg = el('img', {class: 'avatar-preview-img', alt: 'Ảnh nhận diện', src: photoDataUrl || '', hidden: !photoDataUrl});
  const uploadPrompt = el('div', {class: 'avatar-upload-prompt', hidden: !!photoDataUrl},
    icon('camera'),
    el('span', {text: 'Thêm ảnh (không bắt buộc)'})
  );
  const avatarBox = el('button', {type: 'button', class: 'avatar-preview-box', 'aria-label': 'Chọn ảnh nhận diện', title: 'Nhấn để chọn ảnh rõ mặt'}, previewImg, uploadPrompt);

  avatarBox.onclick = () => avatarInput.click();
  avatarInput.onchange = e => {
    const file = e.target.files[0];
    avatarInput.value = '';
    if (file) {
      if (file.size > 5_000_000 || !['image/jpeg', 'image/png'].includes(file.type)) {
        status('Vui lòng chọn ảnh JPG hoặc PNG tối đa 5 MB.', true);
        return;
      }
      openAvatarCrop(file, avatarBox, result => {
        croppedPhoto = result;
        if (photoDataUrl?.startsWith('blob:')) URL.revokeObjectURL(photoDataUrl);
        photoDataUrl = URL.createObjectURL(result);
        previewImg.src = photoDataUrl;
        previewImg.hidden = false;
        uploadPrompt.hidden = true;
        avatarBox.setAttribute('aria-label', 'Thay đổi ảnh nhận diện');
      });
    }
  };

  panel.append(
    el('div', {class: 'avatar-upload-container'},
      avatarBox,
      avatarInput,
      el('p', {class: 'avatar-upload-hint', text: 'Ảnh không bắt buộc. Nếu muốn thêm ảnh, chọn JPG hoặc PNG tối đa 5 MB.'})
    )
  );

  // Form thông tin
  const formElem = el('form');
  const applicantField = field('applicantRole', 'Bạn đăng ký với vai trò', 'select', existingData?.applicantRole || selectedRole, {items: [{value: 'student', label: 'Học sinh'}, {value: 'parent', label: 'Phụ huynh'}]});
  formElem.append(applicantField.label, el('p', {class: 'meta', text: 'Phụ huynh điền thông tin học sinh cần theo dõi; quản trị viên sẽ xác minh và liên kết với học sinh trong lớp.'}));

  // Mục 1: Chọn Năm học & Lớp học
  formElem.append(el('div', {class: 'form-section-title', text: '1. Chọn Năm học & Lớp học đăng ký'}));

  // Nhóm các lớp theo Khối (6, 7, 8, 9, 10, 11, 12)
  const classGroups = groupClasses(availableClasses);

  const yearField = field('schoolYearId', 'Năm học', 'select', existingData?.schoolYearId || availableYears[0]?.id || '', {
    items: availableYears.map(y => ({value:y.id,label:y.name}))
  });
  const classField = field('classId', 'Lớp học mong muốn', 'select', existingData?.classId || availableClasses[0]?.id || '', {
    items: classGroups
  });

  const updateClassOptions = () => {
    const previous = existingData?.classId || classField.input.value;
    const filtered = sortClasses(availableClasses.filter(c => c.school_year_id === yearField.input.value));
    const groups = [];
    for (const group of groupClasses(filtered)) {
      const og = el('optgroup', {label: group.optgroup});
      group.options.forEach(c => og.append(el('option', {value: c.value, text: c.label})));
      groups.push(og);
    }
    classField.input.replaceChildren(...groups);
    if (filtered.some(c => c.id === previous)) classField.input.value = previous;
  };
  yearField.input.onchange = updateClassOptions;
  updateClassOptions();
  formElem.append(el('div', {class: 'form-grid-2'}, yearField.label, classField.label));
  if (!availableClasses.length) formElem.append(el('p', {class:'form-error',text:'Hiện chưa có lớp mở đăng ký. Vui lòng liên hệ quản trị viên.'}));

  // Mục 2: Thông tin Học sinh
  formElem.append(el('div', {class: 'form-section-title', text: '2. Thông tin Học sinh'}));

  const nameField = field('fullName', 'Họ và tên học sinh (chính xác theo khai sinh)', 'text', existingData?.fullName || me?.name || '', {
    placeholder: 'Ví dụ: Nguyễn Văn An'
  });
  const dobField = field('dateOfBirth', 'Ngày tháng năm sinh', 'date', existingData?.dateOfBirth || '', {required: true});
  const schoolField = field('schoolName', 'Trường THCS / THPT hiện đang theo học', 'text', existingData?.schoolName || '', {
    placeholder: 'Ví dụ: THPT Chu Văn An, THCS Giảng Võ...'
  });
  const studentPhoneField = field('studentPhone', 'Số điện thoại học sinh', 'tel', existingData?.studentPhone || '', {
    required: false,
    placeholder: '09xx xxx xxx'
  });

  formElem.append(
    nameField.label,
    el('div', {class: 'form-grid-2'}, dobField.label, schoolField.label),
    studentPhoneField.label
  );

  // Mục 3: Thông tin Phụ huynh
  formElem.append(el('div', {class: 'form-section-title', text: '3. Thông tin Phụ huynh liên hệ & Điểm danh'}));

  const parentNameField = field('parentName', 'Họ và tên Bố / Mẹ / Người giám hộ', 'text', existingData?.parentName || '', {
    placeholder: 'Ví dụ: Nguyễn Thị Mai'
  });
  const parentPhoneField = field('parentPhone', 'Số điện thoại phụ huynh', 'tel', existingData?.parentPhone || '', {
    maxLength: 30,
    placeholder: '09xx xxx xxx'
  });
  const relationField = field('parentRelation', 'Mối quan hệ', 'select', existingData?.parentRelation || 'mother', {
    items: [
      {value: 'mother', label: 'Mẹ'},
      {value: 'father', label: 'Bố'},
      {value: 'guardian', label: 'Người giám hộ'}
    ]
  });

  formElem.append(
    el('div', {class: 'form-grid-2'}, parentNameField.label, relationField.label),
    parentPhoneField.label
  );

  const consentPrivacyInput = el('input', {type: 'checkbox', name: 'consentPrivacy', required: true});
  const consentPrivacyLabel = el('label', {class: 'consent-check'},
    consentPrivacyInput,
    el('span', {},
      'Tôi đồng ý để Lớp Toán cô Hạnh thu thập và xử lý các thông tin trong hồ sơ trên cho mục đích xét duyệt xếp lớp, quản lý chuyên cần và kết nối học tập theo ',
      el('a', {href: '/chinh-sach-bao-mat.html', target: '_blank', rel: 'noopener', text: 'Chính sách bảo vệ dữ liệu cá nhân'}),
      ' (đối với học sinh dưới 16 tuổi, việc đăng ký đã có sự đồng ý của cha mẹ hoặc người giám hộ nêu tại Mục 3).'
    )
  );

  const errorP = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const submitBtn = el('button', {
    type: 'submit',
    class: 'primary wide',
    style: 'margin-top: 14px; height: 48px; font-size: 1.05rem;',
    text: isRevision ? 'Gửi lại hồ sơ để xét duyệt' : 'Gửi hồ sơ đăng ký vào lớp'
  });

  formElem.prepend(errorP);
  formElem.append(consentPrivacyLabel, submitBtn);

  formElem.onsubmit = async e => {
    e.preventDefault();
    errorP.textContent = '';
    errorP.hidden = true;
    submitBtn.disabled = true;

    if (!consentPrivacyInput.checked) {
      errorP.textContent = 'Vui lòng đọc và đồng ý với Chính sách bảo vệ dữ liệu cá nhân trước khi gửi hồ sơ.';
      errorP.hidden = false;
      submitBtn.disabled = false;
      consentPrivacyInput.focus();
      return;
    }

    // Validate số điện thoại phụ huynh
    const pPhone = parentPhoneField.input.value.trim();
    if (!/^[0-9+() -]{8,30}$/.test(pPhone)) {
      errorP.textContent = 'Số điện thoại phụ huynh chưa hợp lệ. Vui lòng nhập số điện thoại chính xác.';
      errorP.hidden = false;
      submitBtn.disabled = false;
      parentPhoneField.input.focus();
      return;
    }

    try {
      const payload = {
        applicantRole: applicantField.input.value,
        schoolYearId: yearField.input.value,
        classId: classField.input.value,
        fullName: nameField.input.value.trim(),
        dateOfBirth: dobField.input.value,
        schoolName: schoolField.input.value.trim(),
        studentPhone: studentPhoneField.input.value.trim(),
        parentName: parentNameField.input.value.trim(),
        parentPhone: pPhone,
        parentRelation: relationField.input.value,
        photoUrl: photoDataUrl
      };

      const data = new FormData(); for (const [key,value] of Object.entries(payload)) if (key !== 'photoUrl') data.append(key,value); if (croppedPhoto) data.append('photo',croppedPhoto);
      data.append('consentPrivacy', 'true');
      data.append('policyVersion', '1.0');
      const result = await api('/api/enrollment/submit', {method: 'POST', body: data});
      myEnrollment = {hasRequest: true, status: 'pending', request: {...payload, className: availableClasses.find(c => c.id === payload.classId)?.name || payload.classId, createdAt: Date.now()}};
      showPendingScreen(myEnrollment.request);
    } catch (err) {
      errorP.textContent = err.message || 'Không thể gửi hồ sơ. Vui lòng thử lại.';
      errorP.hidden = false;
      errorP.focus();
    } finally {
      submitBtn.disabled = false;
    }
  };

  panel.append(formElem);
}

/**
 * MÀN HÌNH CHỜ XÉT DUYỆT (PENDING GATE)
 * Thông điệp lịch sự, thẻ tóm tắt đơn, nút "Yêu cầu Quản trị viên duyệt gấp"
 */
function showPendingScreen(req) {
  const aw = document.querySelector('.auth-wrapper');
  if (aw) aw.hidden = false;
  $('onboarding-panel').hidden = true;
  const sc = $('auth-showcase');
  if (sc) sc.hidden = true;
  const panel = $('pending-panel');
  panel.hidden = false;
  panel.replaceChildren();

  panel.append(
    el('div', {class: 'pending-badge'}, icon('clock'), el('span', {text: 'Trạng thái: Đang chờ Quản trị viên xét duyệt'})),
    el('h1', {style: 'font-size: 1.6rem; color: var(--primary-dark); margin-bottom: 8px;', text: 'Hồ sơ đã được gửi thành công!'}),
    el('p', {class: 'muted', text: 'Hồ sơ đăng ký của bạn đang được Quản trị viên xem xét duyệt vào lớp học. Khi được duyệt, hệ thống sẽ tự động gửi email thông báo chúc mừng về hộp thư của bạn.'}),

    // Thẻ tóm tắt thông tin đã nộp
    el('div', {class: 'student-summary-box'},
      authenticatedAvatar(req.photoUrl, req.fullName, 'student-summary-avatar'),
      el('div', {class: 'student-summary-info'},
        el('strong', {text: req.fullName || 'Học sinh'}),
        el('p', {text: `Vai trò đăng ký: ${labels[req.applicantRole || 'student']}`}),
        el('p', {text: `Lớp đăng ký: ${req.className || req.classId || 'Chưa rõ'}`}),
        el('p', {text: `Trường: ${req.schoolName || 'Chưa cập nhật'}`}),
        el('p', {text: `Phụ huynh: ${req.parentName || ''} · ${req.parentPhone || ''}`})
      )
    ),

    // Nút Yêu cầu Quản trị viên duyệt gấp
    el('button', {
      class: 'button urgent-btn wide',
      onclick: async () => {
        try {
          await run(async () => {
            const result = await api('/api/enrollment/urgent-notify', {method: 'POST'});
            status(result.notificationStatus === 'sent' ? 'Đã gửi thông báo ưu tiên đến quản trị viên.' : 'Đã ghi nhận yêu cầu; email thông báo đang chờ gửi.');
          });
        } catch (e) {
          status(e.message, true);
        }
      }
    }, icon('alert'), el('span', {text: 'Yêu cầu Quản trị viên duyệt gấp'})),

    el('div', {class: 'actions pending-actions'},
      btn('Kiểm tra trạng thái', () => runAuth(loadApp), true),
      btn('Sửa hồ sơ', () => showOnboardingForm(req, false)),
      btn('Đăng xuất', logout)
    )
  );
}

function navBtn(iconName, text, action, isActive = false) {
  const b = el('button', {
    type: 'button',
    class: isActive ? 'active' : '',
    'aria-current': isActive ? 'page' : 'false',
    onclick: async () => {
      closeWorkspaceMenu();
      await run(action);
      focusContent();
    }
  });
  const ic = icon(iconName);
  if (ic) b.append(ic);
  b.append(el('span', {text}));
  return b;
}

function navigation() {
  const names = {home: 'Tổng quan', classes: 'Lớp học', practice: 'Phòng luyện', archive: 'Kho lưu trữ', settings: 'Tài khoản cá nhân', admin: 'Quản trị hệ thống', enrollments: 'Duyệt hồ sơ vào lớp'};
  const basePages = navigationForView(me, viewRole);
  const hasHighSchoolClass = visibleClasses().some(c => {
    const g = classGrade(c.name);
    return g >= 10 && g <= 12;
  });
  const pages = isStaffView()
    ? basePages.flatMap(p => (p === 'classes' ? ['classes', 'archive'] : [p]))
    : (viewRole === 'student' && hasHighSchoolClass)
      ? basePages.flatMap(p => (p === 'classes' ? ['classes', 'practice'] : [p]))
      : basePages;
  if ((activeNav !== 'practice' || viewRole === 'parent') && !pages.includes(activeNav)) activeNav = 'home';
  const navClassesPool = isStaffView() ? [...classes, ...archivedClasses] : classes;
  const classNav = classNavigationForView(me, viewRole, navClassesPool, {selectedClass, activeNav, hasWorkspace: Boolean(workspace)});
  const currentClass = classNav?.direct ? classNav.class : null;
  const roleLabelEl = $('current-role-label');
  const cohortBadgeEl = $('user-badge-cohort-label');
  if (viewRole === 'student' || viewRole === 'parent') {
    const learnerClasses = classNav?.class
      ? [classNav.class]
      : !me?.roles?.includes('admin')
        ? classesForView(me, viewRole, classes)
        : selectedClass
          ? [selectedClass]
          : [];
    if (learnerClasses.length) {
      const classNamesText = learnerClasses.map(c => c.name).join(', ');
      const cohortText = learnerClasses
        .map(c => `Niên khóa ${classCohortSlug(c, navClassesPool)}`)
        .join(' · ');
      if (roleLabelEl) {
        roleLabelEl.textContent = `${labels[viewRole]} · ${classNamesText}`;
        roleLabelEl.title = `${labels[viewRole]} · ${classNamesText}`;
      }
      if (cohortBadgeEl) {
        cohortBadgeEl.textContent = cohortText;
        cohortBadgeEl.title = cohortText;
        cohortBadgeEl.hidden = false;
      }
    } else {
      if (roleLabelEl) roleLabelEl.textContent = labels[viewRole];
      if (cohortBadgeEl) {
        cohortBadgeEl.textContent = '';
        cohortBadgeEl.hidden = true;
      }
    }
  } else {
    if (roleLabelEl) roleLabelEl.textContent = labels[viewRole];
    if (cohortBadgeEl) {
      cohortBadgeEl.textContent = '';
      cohortBadgeEl.hidden = true;
    }
  }
  if (activeNav === 'settings') $('user-badge-container')?.setAttribute('aria-current', 'page');
  else $('user-badge-container')?.removeAttribute('aria-current');
  const headerAccountBtn = $('header-account-btn');
  if (headerAccountBtn) {
    if (activeNav === 'settings') headerAccountBtn.setAttribute('aria-current', 'page');
    else headerAccountBtn.removeAttribute('aria-current');
  }
  const nav = $('navigation');
  const buttons = [];
  const isLearnerRole = viewRole === 'student' || viewRole === 'parent';
  const addClassNavigation = () => {
    if (!classNav) return;
    const items = classTabs.filter(([key]) => classNav.tabs.includes(key)).map(([key, label, iconName]) => {
      const button = navBtn(iconName, label, () => {
        if (workspace && selectedClass?.id === classNav.class.id) classView(key);
        else return openClass(classNav.class, key);
      }, activeNav === 'classes' && activeClassTab === key);
      if (!isLearnerRole) button.classList.add('class-nav-item');
      return button;
    });
    if (isLearnerRole) {
      buttons.push(...items);
      return;
    }
    const navSlug = classCohortSlug(classNav.class, navClassesPool);
    buttons.push(
      el(
        'div',
        {class: 'class-nav-group', role: 'group', 'aria-label': `Các mục của ${classNav.class.name}`},
        el(
          'div',
          {class: 'nav-class-label'},
          el('span', {class: 'nav-class-name', text: classNav.class.name}),
          el('span', {class: 'nav-class-cohort', text: `Niên khóa ${navSlug}`})
        ),
        ...items
      )
    );
  };
  for (const page of pages.filter(page => page !== 'settings')) {
    if (!(currentClass && (page === 'classes' || page === 'practice'))) {
      const active = activeNav === page && (page !== 'classes' || !activeClassTab);
      buttons.push(navBtn({home: 'dashboard', classes: 'class', practice: 'practice', archive: 'archive', admin: 'admin', enrollments: 'assignment'}[page], names[page], () => navigateTo(page), active));
    }
    if ((currentClass && page === 'home') || (!currentClass && page === 'classes')) addClassNavigation();
  }
  nav.replaceChildren(...buttons);
}

async function navigateTo(page, {replaceUrl = false, subPage = null} = {}) {
  const allowedPages = navigationForView(me, viewRole);
  if (page === 'archive' && isStaffView()) {
    // Allowed dedicated Archive tab for staff
  } else if (page === 'practice' && (viewRole === 'student' || isStaffView())) {
    // Allowed dedicated Practice Rooms portal (THPTQG / HSA / TSA / Chữa đề luyện)
  } else if (!allowedPages.includes(page)) {
    page = 'home';
  }
  if (page === 'classes') {
    const learnerClass = directClass();
    if (learnerClass) return openClass(learnerClass, 'notices', {isClassEntry: true, replaceUrl});
  }
  activeNav = page;
  activeClassTab = null;
  activePracticeSubPage = page === 'practice' ? (subPage || null) : null;
  activeAdminSubPage = page === 'admin' ? (subPage || null) : null;
  if (page === 'settings') activeSettingsTab = resolveAccountTab(subPage);
  selectedClass = workspaceSource = workspace = null;
  viewVersion++;
  navigation();
  syncBrowserUrl({
    replace: replaceUrl,
    subPage: page === 'admin' ? activeAdminSubPage : page === 'settings' ? (activeSettingsTab === 'profile' ? null : activeSettingsTab) : activePracticeSubPage
  });
  if (page === 'classes') await classesView();
  else if (page === 'practice') await practiceView(activePracticeSubPage);
  else if (page === 'archive') await archiveView();
  else if (page === 'settings') await settings(activeSettingsTab);
  else if (page === 'admin' || page === 'enrollments') await adminPage({focusSection: page === 'enrollments' ? 'enrollments' : activeAdminSubPage});
  else await home();
}

let pendingAutoOpenExamId = null;

async function practiceView(subPage = activePracticeSubPage) {
  const parsedSub = parsePracticeSubPage(subPage);
  if (parsedSub.isSolutionPage) {
    activePracticeSubPage = `${parsedSub.examType}/${parsedSub.examId}`;
  } else {
    activePracticeSubPage = parsedSub.examType;
  }

  const host = el('div', {class: 'ltch-practice-page-root'});
  content(host);

  if (parsedSub.isSolutionPage && parsedSub.examId) {
    const solutionsHost = el('div', {class: 'ltch-practice-solutions-wrap is-dedicated-standalone'});
    host.append(solutionsHost);
    await renderExamSolutionPage({
      container: solutionsHost,
      examType: parsedSub.examType,
      examId: parsedSub.examId,
      isArchived: false,
      onBackToRoom: () => {
        const backSub = parsedSub.examType || null;
        activePracticeSubPage = backSub;
        syncBrowserUrl({replace: false, subPage: backSub});
        practiceView(backSub);
      },
      onSwitchExam: (nextExamId) => {
        const track = parsedSub.examType || 'thptqg';
        const nextSub = `${track}/${nextExamId}`;
        activePracticeSubPage = nextSub;
        syncBrowserUrl({replace: false, subPage: nextSub});
        practiceView(nextSub);
      },
      onStartExam: (examObj) => {
        pendingAutoOpenExamId = examObj.id;
        const targetTrack = parsedSub.examType === 'past' ? 'past' : String(examObj?.examType || parsedSub.examType || 'thptqg').toLowerCase();
        activePracticeSubPage = targetTrack;
        syncBrowserUrl({replace: false, subPage: targetTrack});
        practiceView(targetTrack);
      }
    });
    return;
  }

  const roomsHost = el('div', {class: 'ltch-class-practice-rooms-wrap'});
  host.append(roomsHost);

  const autoOpenExamId = pendingAutoOpenExamId;
  pendingAutoOpenExamId = null;

  await renderPracticeRoomsPortal({
    container: roomsHost,
    api,
    status,
    viewerRole: viewRole,
    initialExamType: parsedSub.examType,
    autoOpenExamId,
    onNavigateExamType: (nextType) => {
      activePracticeSubPage = nextType || null;
      syncBrowserUrl({replace: false, subPage: nextType || null});
    },
    onOpenExamSolution: (ex) => {
      const track = ex?.isPastPool ? 'past' : String(ex?.examType || parsedSub.examType || 'thptqg').toLowerCase();
      const nextSub = `${track}/${ex.id}`;
      activePracticeSubPage = nextSub;
      syncBrowserUrl({replace: false, subPage: nextSub});
      practiceView(nextSub);
      window.scrollTo?.({top: 0, behavior: 'smooth'});
    }
  });
}

function loadingPage(title) {
  content(heading(title), el('p', {class: 'meta', role: 'status', text: 'Đang tải dữ liệu…'}));
  return viewVersion;
}

function renderClassScheduleBlock(c, {archivedMode = false} = {}) {
  const rawSchedule = String(c?.schedule || '').trim();
  const slots = rawSchedule
    ? rawSchedule.split(';').map(s => s.trim()).filter(Boolean)
    : [];

  if (!slots.length) {
    const emptyText = archivedMode
      ? (c?.schoolYearName
          ? `${c.schoolYearName} · Dữ liệu được bảo lưu nguyên vẹn.`
          : 'Dữ liệu lớp học được bảo lưu nguyên vẹn.')
      : 'Lịch học sẽ được giáo viên thông báo cụ thể.';
    return el('div', {class: 'class-schedule-box is-empty'},
      icon('attendance'),
      el('span', {class: 'class-schedule-empty-text', text: emptyText})
    );
  }

  return el('div', {class: 'class-schedule-box'},
    el('div', {class: 'class-schedule-list'},
      ...slots.map(slot => {
        let day = slot;
        let time = '';
        const dotParts = slot.split('·').map(p => p.trim()).filter(Boolean);
        if (dotParts.length >= 2) {
          day = dotParts[0];
          time = dotParts.slice(1).join(' · ');
        } else {
          const colonMatch = /^([^:]+?):\s+(.+)$/.exec(slot);
          if (colonMatch) {
            day = colonMatch[1].trim();
            time = colonMatch[2].trim();
          }
        }
        return el('div', {class: 'class-schedule-item'},
          el('span', {class: 'class-schedule-day', text: day}),
          time ? el('span', {class: 'class-schedule-time', text: time}) : null
        );
      })
    )
  );
}

function classList(headingTag = 'h3', items = visibleClasses(), {archivedMode = false} = {}) {
  if (!items.length) {
    return empty(archivedMode
      ? 'Kho lưu trữ hiện chưa có lớp của niên khóa trước.'
      : 'Bạn chưa được phân công hoặc liên kết với lớp học ở góc nhìn này.');
  }
  const sorted = sortClasses(items);
  return el('div', {class: 'class-grid'}, sorted.map(c => {
    const grade = classGrade(c.name);
    const level = grade >= 6 && grade <= 9 ? 'THCS' : grade >= 10 && grade <= 12 ? 'THPT' : null;
    const slug = classCohortSlug(c, sorted);
    const badgeRow = el('div', {class: 'class-card-badges'},
      level ? el('span', {class: `badge class-level class-level-${level.toLowerCase()}`, text: level}) : null,
      el('span', {class: archivedMode ? 'badge badge-warning' : 'badge badge-info', text: `Niên khóa ${slug}`}),
      archivedMode ? el('span', {class: 'badge badge-error', text: 'Đã lưu trữ'}) : null
    );
    const actionsRow = el('div', {class: 'actions class-card-actions'},
      btn(archivedMode ? 'Xem lớp lưu trữ' : 'Vào lớp học', () => openClass(c, viewRole === 'admin' ? 'operations' : 'notices', {isClassEntry: true}), !archivedMode),
      !archivedMode && isStaffView()
        ? btn('Điểm danh', () => openClass(c, 'attendance'), false, 'attendance')
        : null
    );
    if (archivedMode && viewRole === 'admin') {
      actionsRow.append(
        createActionMenu({
          iconOnly: true,
          ariaLabel: `Thao tác ${c.name}`,
          variant: 'outline',
          items: [
            {
              label: 'Khôi phục lớp',
              icon: 'refresh',
              onSelect: () => run(async () => {
                await api('/api/classes/cohorts', {method: 'POST', idempotent: true, body: {action: 'restore_class', classId: c.id}});
                classes = sortClasses((await api('/api/classes')).items);
                status(`Đã khôi phục ${c.name} (Niên khóa ${slug}) về danh sách lớp đang học.`, false, 'success');
                await archiveView();
              })
            },
            {
              label: 'Xóa vĩnh viễn',
              icon: 'trash',
              danger: true,
              dividerBefore: true,
              onSelect: () => run(async () => {
                await api('/api/classes/cohorts', {method: 'POST', body: {action: 'delete_archived_class', classId: c.id}});
                status(`Đã xóa ${c.name} (Niên khóa ${slug}) khỏi kho lưu trữ.`, false, 'success');
                await archiveView();
              })
            }
          ]
        })
      );
    }
    return el('article', {class: `class-card${archivedMode ? ' is-archived-card' : ''}`},
      el('div', {class: 'class-card-top'},
        badgeRow,
        el(headingTag, {text: c.name}),
        renderClassScheduleBlock(c, {archivedMode})
      ),
      actionsRow
    );
  }));
}

function openCreateCohortClassModal(years = []) {
  const defaultYearId = years[0]?.id || classes[0]?.schoolYearId || 'year-2026-2027';
  const schedule = scheduleFields();
  const nameField = field('name', 'Tên lớp học mới (VD: Lớp 6, Lớp 6A, Lớp 6B, Lớp 7A...)', 'text', 'Lớp 6', {maxLength: 120});
  const yearField = years.length
    ? field('schoolYearId', 'Năm học áp dụng', 'select', defaultYearId, {items: years.map(y => ({value: y.id, label: y.name}))})
    : null;
  const slugPreview = el('p', {class: 'notice', role: 'status'});
  const updatePreview = () => {
    const rawName = className(nameField.input.value.trim() || 'Lớp 6');
    const yId = yearField ? yearField.input.value : defaultYearId;
    const slug = classCohortSlug({id: 'preview', name: rawName, schoolYearId: yId}, [...classes, {id: 'preview', name: rawName, schoolYearId: yId}]);
    slugPreview.textContent = `Đuôi đường dẫn tự động của lớp này: /class/${slug} (sẽ đi theo lớp suốt các năm học cho đến khi vào kho lưu trữ).`;
  };
  nameField.input.addEventListener('input', updatePreview);
  if (yearField) yearField.input.addEventListener('change', updatePreview);
  updatePreview();

  const errorP = el('p', {class: 'form-error', role: 'alert', hidden: true});
  const submitBtn = el('button', {type: 'submit', class: 'primary wide', text: 'Tạo lớp học'});
  const f = el('form', {},
    errorP,
    nameField.label,
    yearField ? yearField.label : null,
    slugPreview,
    schedule.root,
    submitBtn
  );
  f.onsubmit = async e => {
    e.preventDefault();
    errorP.hidden = true;
    submitBtn.disabled = true;
    try {
      const payload = {
        action: 'create_class',
        name: nameField.input.value.trim(),
        schoolYearId: yearField ? yearField.input.value : defaultYearId,
        ...schedule.read()
      };
      const res = await api('/api/classes/cohorts', {method: 'POST', body: payload});
      classes = sortClasses((await api('/api/classes')).items);
      $('editor').close();
      status(`Đã tạo ${res.item.name} với đường dẫn ${res.item.routePath}.`, false, 'success');
      if (activeNav === 'admin' || activeNav === 'enrollments') await adminPage();
      else await classesView();
    } catch (err) {
      errorP.textContent = friendly(err);
      errorP.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  };
  modal('Thêm lớp học mới', f);
}

function openAdvanceSchoolYearModal() {
  const modeSelect = field('grade6Mode', 'Cấu trúc khóa Lớp 6 mới tuyển sinh cho năm học tới', 'select', 'single', {
    items: [
      {value: 'single', label: '1 lớp Lớp 6 (ví dụ: Lớp 6)'},
      {value: 'double', label: '2 lớp Lớp 6A & Lớp 6B'}
    ]
  });
  const previewBox = el('div', {class: 'cohort-transition-preview'});
  const confirmCheck = el('input', {type: 'checkbox'});
  const submitBtn = el('button', {type: 'submit', class: 'primary wide', text: 'Xác nhận chuyển năm học', disabled: true});
  confirmCheck.addEventListener('change', () => { submitBtn.disabled = !confirmCheck.checked; });

  const renderPlanPreview = () => {
    const specs = modeSelect.input.value === 'double' ? ['Lớp 6A', 'Lớp 6B'] : ['Lớp 6'];
    const plan = planSchoolYearCohortTransition(classes, null, specs);
    previewBox.replaceChildren(
      el('div', {class: 'notice'},
        el('strong', {text: `Năm học mới sẽ khởi tạo: ${plan.nextSchoolYearName}`}),
        el('p', {class: 'meta', text: 'Đuôi đường dẫn (/class/<niên-khóa>) của từng lớp đang học được giữ nguyên tuyệt đối khi lên lớp.'})
      ),
      el('h3', {text: '1. Đưa Lớp 12 năm học trước vào Kho lưu trữ niên khóa:'}),
      plan.toArchive.length
        ? el('div', {}, ...plan.toArchive.map(a => el('p', {class: 'meta', text: `• ${a.name} (Niên khóa ${a.cohortSlug}) ➔ Đưa vào Kho lưu trữ (${a.routePath}) · Admin/Giáo viên/Trợ giảng mở xem lại bất kỳ lúc nào.`})))
        : el('p', {class: 'meta', text: '• Không có lớp 12 nào cần lưu trữ.'}),
      el('h3', {text: '2. Tự động nâng khối các lớp 6 → 11 (giữ nguyên đuôi đường dẫn):'}),
      plan.toPromote.length
        ? el('div', {}, ...plan.toPromote.map(p => el('p', {class: 'meta', text: `• ${p.fromName} ➔ ${p.toName} · Giữ nguyên đuôi ${p.routePath} (Niên khóa ${p.cohortSlug})`})))
        : el('p', {class: 'meta', text: '• Không có lớp 6–11 nào.'}),
      el('h3', {text: `3. Mở khóa Lớp 6 mới (${plan.nextSchoolYearName}):`}),
      el('div', {}, ...plan.toCreateGrade6.map(g => el('p', {class: 'meta', text: `• Tạo mới ${g.name} ➔ Tự động cấp đuôi mới ${g.routePath} (Niên khóa ${g.cohortSlug}) & tạo thư mục Google Drive.`})))
    );
    return {specs, plan};
  };

  modeSelect.input.addEventListener('change', renderPlanPreview);
  renderPlanPreview();

  const errorP = el('p', {class: 'form-error', role: 'alert', hidden: true});
  const f = el('form', {},
    errorP,
    modeSelect.label,
    previewBox,
    el('label', {class: 'check'}, confirmCheck, 'Tôi đã kiểm tra và xác nhận thực hiện chuyển sang năm học mới, lưu trữ Lớp 12 cũ và thêm khóa Lớp 6 mới'),
    submitBtn
  );

  f.onsubmit = async e => {
    e.preventDefault();
    errorP.hidden = true;
    submitBtn.disabled = true;
    try {
      const specs = modeSelect.input.value === 'double' ? ['Lớp 6A', 'Lớp 6B'] : ['Lớp 6'];
      const res = await api('/api/classes/cohorts', {
        method: 'POST',
        body: {action: 'advance_school_year', newGrade6Classes: specs}
      });
      classes = sortClasses((await api('/api/classes')).items);
      $('editor').close();
      status(`Đã chuyển sang năm học ${res.plan.nextSchoolYearName}, đưa Lớp 12 cũ vào Kho lưu trữ và tạo khóa Lớp 6 mới!`, false, 'success');
      if (activeNav === 'admin' || activeNav === 'enrollments') await adminPage();
      else await classesView();
    } catch (err) {
      errorP.textContent = friendly(err);
      errorP.hidden = false;
      submitBtn.disabled = !confirmCheck.checked;
    }
  };

  modal('Chuyển năm học mới & Thêm khóa Lớp 6', f);
}

async function classesView() {
  const items = visibleClasses();
  const staff = isStaffView();

  content(
    heading('Lớp học'),
    classList('h2', items)
  );

  if (staff && !window._ltchYearsCache) {
    api('/api/classes/cohorts').then(cohortData => {
      window._ltchYearsCache = cohortData.years || [];
      archivedClasses = (cohortData.archivedClasses || []).map(c => ({...c, archived: true}));
    }).catch(() => {});
  }
}

async function archiveView() {
  const version = loadingPage('Kho lưu trữ các niên khóa trước');
  try {
    const cohortData = await api('/api/classes/cohorts');
    if (version !== viewVersion) return;
    window._ltchYearsCache = cohortData.years || [];
    archivedClasses = (cohortData.archivedClasses || []).map(c => ({...c, archived: true}));
    content(
      heading(
        'Kho lưu trữ các niên khóa trước',
        'Lưu trữ các lớp đã hoàn thành chương trình từ những niên khóa trước.',
        btn(viewRole === 'admin' ? 'Về Quản trị hệ thống' : 'Về danh sách Lớp đang học', () => navigateTo(viewRole === 'admin' ? 'admin' : 'classes'), false, viewRole === 'admin' ? 'admin' : 'class')
      ),
      classList('h2', archivedClasses, {archivedMode: true})
    );
  } catch (err) {
    if (version !== viewVersion) return;
    content(
      heading('Kho lưu trữ các niên khóa trước'),
      el('p', {class: 'form-error', role: 'alert', text: friendly(err)}),
      btn('Thử lại', () => archiveView(), false, 'refresh')
    );
  }
}

function buildOverviewPanelHead({ iconName, title, countText = '', actionEl = null }) {
  return el(
    'div',
    { class: 'overview-panel-head' },
    el(
      'div',
      { class: 'overview-panel-title-wrap' },
      el('span', { class: 'overview-panel-icon', 'aria-hidden': 'true' }, icon(iconName)),
      el('h2', { text: title }),
      countText ? el('span', { class: 'overview-count-pill', text: countText }) : null
    ),
    actionEl || null
  );
}

async function home(initialOverview = null) {
  const items = visibleClasses();
  const sortedItems = sortClasses(items);
  const currentClass = directClass();
  const visibleIds = new Set(items.map(c => c.id));
  const staffMode = isStaffView();
  const isParentView = viewRole === 'parent';
  const nowTs = Date.now();
  const nowParts = getVietnamNowParts(nowTs);
  const scheduleItems = buildUpcomingScheduleItems(sortedItems, nowTs);
  const findClassById = cid => classes.find(c => c.id === cid) || sortedItems.find(c => c.id === cid) || null;

  function openEnrollmentPage() {
    if (viewRole === 'admin') return navigateTo('admin', { subPage: 'enrollments' });
    return navigateTo('enrollments');
  }

  function openDashboardTarget(target) {
    if (!target || typeof target !== 'object') return;
    if (target.page === 'enrollments') return openEnrollmentPage();
    if (target.page === 'practice') return navigateTo('practice', target.subPage ? { subPage: target.subPage } : {});
    if (target.page) return navigateTo(target.page, target.subPage ? { subPage: target.subPage } : {});
    if (target.classId) {
      const targetClass = findClassById(target.classId);
      if (targetClass) {
        return openClass(targetClass, target.tab || 'notices', {
          isClassEntry: staffMode && target.tab === 'operations',
          subPage: target.subPage || null
        });
      }
    }
  }

  const baseHeroSummary = currentClass
    ? `${currentClass.name} · Niên khóa ${classCohortSlug(currentClass, classes)}`
    : sortedItems.length
      ? `${staffMode ? 'Đang phụ trách' : 'Đang theo dõi'} ${sortedItems.length} lớp học hoạt động.`
      : 'Chưa có lớp học nào được gắn cho vai trò hiện tại.';

  const heroSummaryEl = el('p', { class: 'overview-hero-summary', text: baseHeroSummary });
  const accountBtn = el(
    'button',
    {
      type: 'button',
      class: 'overview-hero-account-btn',
      onclick: () => run(() => navigateTo('settings'))
    },
    icon('user'),
    el('span', { text: 'Tài khoản' })
  );
  const refreshBtn = el(
    'button',
    {
      type: 'button',
      class: 'overview-hero-refresh-btn',
      onclick: () => run(() => loadOverviewDashboard())
    },
    icon('refresh'),
    el('span', { text: 'Cập nhật' })
  );

  const heroSection = el(
    'section',
    { class: 'welcome-card overview-hero' },
    el(
      'div',
      { class: 'overview-hero-main' },
      el(
        'div',
        { class: 'overview-hero-meta' },
        el('span', { class: 'welcome-badge', text: labels[viewRole] }),
        el('span', { class: 'overview-date-chip' }, icon('attendance'), el('span', { text: nowParts.dateLabel }))
      ),
      el('h1', { text: `Xin chào, ${me.name}!` }),
      heroSummaryEl
    ),
    el('div', { class: 'overview-hero-actions' }, accountBtn, refreshBtn)
  );

  const errorBannerHost = el('div', { class: 'overview-error-host' });
  const kpiSection = el('section', {
    id: 'overview-kpi-section',
    class: 'overview-kpi-grid',
    'aria-label': 'Chỉ số tổng quan'
  });

  const actionQueueSection = staffMode
    ? el('section', { id: 'overview-action-queue', class: 'overview-panel overview-action-panel' })
    : null;
  const assignmentsSection = el('section', {
    id: 'overview-assignments-section',
    class: 'overview-panel overview-assignments-panel'
  });
  const activitySection = staffMode
    ? el('section', { id: 'overview-activity-section', class: 'overview-panel overview-activity-panel' })
    : null;
  const lessonsSection = viewRole === 'student'
    ? el('section', { id: 'overview-lessons-section', class: 'overview-panel overview-lessons-panel' })
    : null;
  const parentAttendanceSection = isParentView
    ? el('section', { id: 'overview-attendance-section', class: 'overview-panel overview-attendance-panel' })
    : null;
  const resultsSection = !staffMode
    ? el('section', { id: 'overview-results-section', class: 'overview-panel overview-results-panel' })
    : null;

  const scheduleSection = el('section', {
    id: 'overview-schedule-section',
    class: 'overview-panel overview-schedule-panel'
  });
  const sideInsightSection = el('section', {
    id: 'overview-side-insight',
    class: 'overview-panel overview-insight-panel'
  });
  const studentForumSection = viewRole === 'student'
    ? el('section', { id: 'overview-forum-section', class: 'overview-panel overview-forum-panel' })
    : null;
  const classHealthSection = !currentClass && staffMode
    ? el('section', { id: 'overview-class-health-section', class: 'overview-panel overview-health-section' })
    : null;

  function buildKpiCard({ label, value, sub, iconName, accent = 'primary', onClick = null, clickHint = '' }) {
    const body = el(
      'div',
      { class: `overview-kpi-card is-accent-${accent}` },
      el(
        'div',
        { class: 'overview-kpi-top' },
        el('span', { class: 'overview-kpi-label', text: label }),
        el('span', { class: 'overview-kpi-icon', 'aria-hidden': 'true' }, icon(iconName))
      ),
      el('strong', { class: 'overview-kpi-value', text: value }),
      el('span', { class: 'overview-kpi-sub', text: sub }),
      onClick
        ? el('button', {
            type: 'button',
            class: 'overview-kpi-btn',
            text: clickHint || 'Xem ngay',
            onclick: onClick
          })
        : null
    );
    return body;
  }

  function renderHeroSummary(dashboard = null, hwCount = 0) {
    if (!dashboard) {
      heroSummaryEl.textContent = baseHeroSummary;
      return;
    }
    const kpis = dashboard.kpis || {};
    if (dashboard.mode === 'staff') {
      const queueCount = Array.isArray(dashboard.actionQueue) ? dashboard.actionQueue.length : 0;
      const parts = [
        `Phụ trách ${kpis.classCount ?? sortedItems.length} lớp hoạt động`,
        `${kpis.activeStudents ?? 0} học sinh`
      ];
      if (queueCount > 0) parts.push(`${queueCount} đầu việc cần xử lý`);
      else if (kpis.attendance30d?.ratePct != null) parts.push(`Chuyên cần 30 ngày đạt ${kpis.attendance30d.ratePct}%`);
      heroSummaryEl.textContent = `${parts.join(' · ')}.`;
      return;
    }
    if (dashboard.mode === 'parent') {
      const childrenList = Array.isArray(dashboard.children) ? dashboard.children : [];
      const firstChild = childrenList[0];
      const childSummary = childrenList.length > 1
        ? `Đang theo dõi ${childrenList.length} học sinh`
        : firstChild
          ? `Theo dõi: ${firstChild.name}${firstChild.classNames?.length ? ` (${firstChild.classNames.join(', ')})` : ''}`
          : baseHeroSummary;
      const attPct = kpis.attendance?.ratePct;
      const pendingHw = kpis.homework?.pendingOpen ?? hwCount;
      const parts = [childSummary];
      if (attPct != null) parts.push(`Chuyên cần ${attPct}%`);
      if (pendingHw > 0) parts.push(`${pendingHw} bài tập con chưa nộp`);
      heroSummaryEl.textContent = `${parts.join(' · ')}.`;
      return;
    }
    const pendingHw = kpis.homework?.pendingOpen ?? hwCount;
    const parts = [currentClass ? `${currentClass.name} · Niên khóa ${classCohortSlug(currentClass, classes)}` : baseHeroSummary];
    if (kpis.attendance?.ratePct != null) parts.push(`Chuyên cần ${kpis.attendance.ratePct}%`);
    if (pendingHw > 0) parts.push(`Còn ${pendingHw} bài tập chưa nộp`);
    else if (hwCount === 0) parts.push('Chưa có bài tập sắp đến hạn');
    heroSummaryEl.textContent = `${parts.join(' · ')}.`;
  }

  function renderKpiSection(dashboard = null, { loading = false } = {}) {
    if (loading || !dashboard) {
      const skeletonTitles = staffMode
        ? ['Học sinh đang học', 'Chuyên cần 30 ngày', 'Bài chờ nhận xét', 'Đầu việc / Luyện đề']
        : isParentView
          ? ['Chuyên cần của con', 'Tiến độ bài tập', 'Nhận xét giáo viên', 'Kết quả luyện đề']
          : ['Tỷ lệ chuyên cần', 'Bài tập đang mở', 'Phòng luyện', 'Học liệu đã đăng'];
      kpiSection.replaceChildren(
        ...skeletonTitles.map(title =>
          buildKpiCard({
            label: title,
            value: '…',
            sub: 'Đang tổng hợp dữ liệu',
            iconName: 'clock',
            accent: 'neutral'
          })
        )
      );
      return;
    }

    const kpis = dashboard.kpis || {};
    const cards = [];

    if (dashboard.mode === 'staff') {
      const att = kpis.attendance30d || {};
      const practice7d = kpis.practice7d || {};
      const lowHealthClass = (dashboard.classHealth || [])
        .filter(c => c.attendanceTotal > 0 && c.attendanceRatePct !== null && c.attendanceRatePct < 85)
        .sort((a, b) => a.attendanceRatePct - b.attendanceRatePct)[0] || null;
      const lowClassTarget = lowHealthClass ? findClassById(lowHealthClass.classId) : null;
      cards.push(
        buildKpiCard({
          label: 'Học sinh đang học',
          value: String(kpis.activeStudents ?? 0),
          sub: `Trên ${kpis.classCount ?? sortedItems.length} lớp hoạt động`,
          iconName: 'user',
          accent: 'primary'
        }),
        buildKpiCard({
          label: 'Chuyên cần 30 ngày',
          value: att.ratePct != null ? `${att.ratePct}%` : '—',
          sub: att.total ? `${att.present} có mặt · ${att.late} muộn · ${att.absent + att.excused} vắng` : 'Chưa có dữ liệu điểm danh',
          iconName: 'attendance',
          accent: att.ratePct != null && att.ratePct >= 85 ? 'success' : att.ratePct != null ? 'warn' : 'neutral',
          onClick: lowClassTarget
            ? () => openClass(lowClassTarget, 'attendance')
            : sortedItems.length === 1
              ? () => openClass(sortedItems[0], 'attendance')
              : sortedItems.length > 1
                ? () => {
                    if (classHealthSection) classHealthSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    else navigateTo('classes');
                  }
                : null,
          clickHint: lowClassTarget ? `Kiểm tra ${lowClassTarget.name}` : 'Xem chuyên cần'
        }),
        buildKpiCard({
          label: 'Bài chờ nhận xét',
          value: String(kpis.ungradedCount ?? 0),
          sub: `Từ ${kpis.openAssignmentsCount ?? 0} bài tập đang mở`,
          iconName: 'assignment',
          accent: (kpis.ungradedCount || 0) > 0 ? 'warn' : 'success'
        })
      );

      if (dashboard.canReviewEnrollments) {
        const pendingEnroll = kpis.pendingEnrollmentsCount ?? 0;
        const practiceSub = dashboard.canCheckPractice && practice7d.count
          ? `${practice7d.count} lượt luyện đề (7 ngày)`
          : pendingEnroll > 0
            ? 'Cần xem xét & xếp lớp'
            : 'Chưa có hồ sơ mới chờ duyệt';
        cards.push(
          buildKpiCard({
            label: 'Hồ sơ chờ duyệt',
            value: String(pendingEnroll),
            sub: practiceSub,
            iconName: 'admin',
            accent: pendingEnroll > 0 ? 'warn' : 'info',
            onClick: pendingEnroll > 0 ? () => run(() => openEnrollmentPage()) : null,
            clickHint: 'Duyệt hồ sơ'
          })
        );
      } else {
        cards.push(
          buildKpiCard({
            label: 'Luyện đề 7 ngày',
            value: `${practice7d.count ?? 0} lượt`,
            sub: practice7d.avgScore10 != null ? `Điểm TB ${formatScore10(practice7d.avgScore10, 10)}` : 'Chưa có bài làm 7 ngày qua',
            iconName: 'practice',
            accent: 'info'
          })
        );
      }
    } else if (dashboard.mode === 'parent') {
      const att = kpis.attendance || {};
      const hw = kpis.homework || {};
      const prac = kpis.practice || {};
      const primaryClass = currentClass || sortedItems[0] || null;
      const latestFb = Array.isArray(dashboard.recentFeedback) ? dashboard.recentFeedback[0] : null;
      cards.push(
        buildKpiCard({
          label: 'Chuyên cần của con',
          value: att.ratePct != null ? `${att.ratePct}%` : '—',
          sub: att.total ? `${att.present} có mặt · ${att.late} muộn · ${att.absent + att.excused} vắng` : 'Chưa có buổi điểm danh nào',
          iconName: 'attendance',
          accent: att.ratePct != null && att.ratePct >= 85 ? 'success' : att.ratePct != null ? 'warn' : 'neutral',
          onClick: primaryClass ? () => openClass(primaryClass, 'attendance') : null,
          clickHint: 'Xem nhật ký'
        }),
        buildKpiCard({
          label: 'Tiến độ bài tập',
          value: hw.totalOpen ? `${hw.submittedOpen}/${hw.totalOpen}` : '0/0',
          sub: hw.pendingOpen > 0 ? `Con còn ${hw.pendingOpen} bài chưa nộp` : hw.totalOpen > 0 ? 'Con đã nộp đủ bài tập đang mở' : 'Không có bài tập đang mở',
          iconName: 'assignment',
          accent: hw.pendingOpen > 0 ? 'warn' : 'success'
        }),
        buildKpiCard({
          label: 'Nhận xét giáo viên',
          value: `${kpis.gradedCount ?? 0} bài`,
          sub: latestFb ? `Mới nhất: ${latestFb.assignmentTitle}` : 'Chưa có nhận xét mới',
          iconName: 'check',
          accent: 'primary'
        }),
        buildKpiCard({
          label: 'Kết quả luyện đề',
          value: prac.avgScore10 != null ? formatScore10(prac.avgScore10, 10) : '—',
          sub: prac.attemptCount ? `${prac.attemptCount} đề đã hoàn thành` : 'Chưa có lượt luyện đề',
          iconName: 'practice',
          accent: 'info'
        })
      );
    } else {
      const att = kpis.attendance || {};
      const hw = kpis.homework || {};
      const prac = kpis.practice || {};
      const mat = kpis.materials || {};
      const primaryClass = currentClass || sortedItems[0] || null;
      cards.push(
        buildKpiCard({
          label: 'Tỷ lệ chuyên cần',
          value: att.ratePct != null ? `${att.ratePct}%` : '—',
          sub: att.total ? `${att.present + att.late}/${att.total} buổi đi học` : 'Chưa có dữ liệu điểm danh',
          iconName: 'attendance',
          accent: att.ratePct != null && att.ratePct >= 85 ? 'success' : att.ratePct != null ? 'warn' : 'neutral',
          onClick: primaryClass ? () => openClass(primaryClass, 'attendance') : null,
          clickHint: 'Xem nhật ký'
        }),
        buildKpiCard({
          label: 'Bài tập đang mở',
          value: hw.totalOpen ? `${hw.submittedOpen}/${hw.totalOpen}` : '0/0',
          sub: hw.pendingOpen > 0 ? `Còn ${hw.pendingOpen} bài chưa nộp` : hw.totalOpen > 0 ? 'Đã hoàn thành bài tập mở' : 'Chưa có bài tập mới',
          iconName: 'assignment',
          accent: hw.pendingOpen > 0 ? 'warn' : 'success'
        }),
        buildKpiCard({
          label: 'Phòng luyện',
          value: prac.avgScore10 != null ? formatScore10(prac.avgScore10, 10) : '—',
          sub: prac.attemptCount ? `${prac.attemptCount} đề đã hoàn thành` : 'Chưa có lượt làm đề',
          iconName: 'practice',
          accent: 'info'
        }),
        buildKpiCard({
          label: 'Học liệu đã đăng',
          value: `${mat.lessonsWithFilesCount ?? 0} buổi`,
          sub: mat.latestLessonTitle ? `Mới nhất: ${mat.latestLessonTitle}` : 'Chưa có video hoặc tài liệu',
          iconName: 'material',
          accent: 'primary'
        })
      );
    }

    kpiSection.replaceChildren(...cards);
  }

  function renderActionQueuePanel(dashboard = null, { loading = false } = {}) {
    if (!actionQueueSection) return;
    const queue = Array.isArray(dashboard?.actionQueue) ? dashboard.actionQueue : [];
    const head = buildOverviewPanelHead({
      iconName: 'alert',
      title: 'Việc cần xử lý ngay',
      countText: !loading && dashboard ? String(queue.length) : ''
    });

    if (loading || !dashboard) {
      actionQueueSection.replaceChildren(head, el('p', { class: 'meta overview-loading-note', role: 'status', text: 'Đang kiểm tra hồ sơ chờ duyệt và bài nộp chưa chấm…' }));
      return;
    }

    if (!queue.length) {
      actionQueueSection.replaceChildren(
        head,
        el(
          'div',
          { class: 'overview-clear-state' },
          icon('check'),
          el('span', { text: 'Không còn hồ sơ chờ duyệt hay bài nộp chờ chấm. Mọi đầu việc đều đã xử lý xong.' })
        )
      );
      return;
    }

    const actionBtnLabel = type => {
      if (type === 'enrollment') return 'Duyệt hồ sơ';
      if (type === 'grading') return 'Chấm bài';
      if (type === 'question_report') return 'Kiểm tra';
      if (type === 'forum') return 'Trả lời';
      return 'Mở ngay';
    };
    const toneClass = type => {
      if (type === 'enrollment' || type === 'question_report') return 'is-urgent';
      if (type === 'grading') return 'is-warn';
      return 'is-info';
    };

    const listEl = el('div', { class: 'overview-action-list' });
    for (const item of queue) {
      listEl.append(
        el(
          'div',
          { class: `overview-action-item ${toneClass(item.type)}` },
          el(
            'div',
            { class: 'overview-action-main' },
            el(
              'div',
              { class: 'overview-action-badges' },
              el('span', { class: `overview-action-badge ${toneClass(item.type)}`, text: item.badge }),
              item.timestamp ? el('span', { class: 'meta overview-time-meta', text: formatRelativeTimeVi(item.timestamp, nowTs) }) : null
            ),
            el('strong', { class: 'overview-action-title', text: item.title }),
            el('p', { class: 'meta overview-action-sub', text: item.subtitle })
          ),
          el('button', {
            type: 'button',
            class: 'overview-action-btn',
            text: actionBtnLabel(item.type),
            onclick: () => run(() => openDashboardTarget(item.target))
          })
        )
      );
    }

    actionQueueSection.replaceChildren(head, listEl);
  }

  function renderSchedulePanel() {
    let showAllSchedule = false;
    const titleText = staffMode ? 'Lịch dạy trong tuần' : 'Lịch học trong tuần';
    const countText = scheduleItems.length ? `${scheduleItems.length} ca` : '';
    const head = buildOverviewPanelHead({
      iconName: 'attendance',
      title: titleText,
      countText
    });
    const body = el('div', { class: 'overview-schedule-body' });

    function drawSchedule() {
      body.replaceChildren();
      if (!scheduleItems.length) {
        body.append(empty(staffMode ? 'Chưa có lớp nào được thiết lập lịch cố định.' : 'Giáo viên chưa cập nhật lịch học cố định.'));
        return;
      }
      const listEl = el('div', { class: 'overview-schedule-list' });
      const visibleList = showAllSchedule ? scheduleItems : scheduleItems.slice(0, 6);
      for (const slot of visibleList) {
        const statusBadgeText =
          slot.status === 'live'
            ? 'Đang diễn ra'
            : slot.status === 'today'
              ? 'Hôm nay'
              : slot.status === 'tomorrow'
                ? 'Ngày mai'
                : slot.dayName;
        const targetTab = staffMode ? 'operations' : isParentView ? 'attendance' : 'materials';
        const actionLabel = staffMode ? 'Mở lớp' : isParentView ? 'Điểm danh' : 'Bài giảng';
        const showQuickAtt = staffMode && (slot.status === 'live' || slot.status === 'today');
        const scheduleActionEl = showQuickAtt
          ? el(
              'div',
              { class: 'overview-schedule-actions' },
              el('button', {
                type: 'button',
                class: 'overview-inline-link-btn is-accent',
                text: 'Điểm danh',
                onclick: () => openClass(slot.classObj, 'attendance', { subPage: nowParts.isoDate })
              }),
              el('button', {
                type: 'button',
                class: 'overview-inline-link-btn',
                text: 'Mở lớp',
                onclick: () => openClass(slot.classObj, 'operations', { isClassEntry: true })
              })
            )
          : el('button', {
              type: 'button',
              class: 'overview-inline-link-btn',
              text: actionLabel,
              onclick: () => openClass(slot.classObj, targetTab, { isClassEntry: staffMode })
            });
        listEl.append(
          el(
            'div',
            { class: `overview-schedule-item${slot.status === 'live' ? ' is-live' : slot.status === 'today' ? ' is-today' : ''}` },
            el(
              'div',
              { class: 'overview-schedule-day-col' },
              el('span', { class: 'overview-schedule-day-badge', text: statusBadgeText }),
              el('span', { class: 'overview-schedule-time', text: slot.timeRange })
            ),
            el(
              'div',
              { class: 'overview-schedule-main' },
              el('strong', { text: slot.className }),
              slot.relativeDayLabel !== slot.dayName
                ? el('span', { class: 'meta', text: slot.dayName })
                : null
            ),
            scheduleActionEl
          )
        );
      }
      body.append(listEl);

      if (scheduleItems.length > 6) {
        body.append(
          el('button', {
            type: 'button',
            class: 'overview-panel-expand-btn',
            text: showAllSchedule ? 'Thu gọn lịch tuần' : `Xem tất cả ${scheduleItems.length} ca trong tuần`,
            onclick: () => {
              showAllSchedule = !showAllSchedule;
              drawSchedule();
            }
          })
        );
      }
    }

    drawSchedule();
    scheduleSection.replaceChildren(head, body);
  }

  function renderAssignmentsPanel(overviewData = null, { loading = false, errorMsg = '', onRetry = null } = {}) {
    const hwList = Array.isArray(overviewData?.assignments) ? overviewData.assignments : [];
    const dashboard = overviewData?.dashboard || null;
    const panelTitle = isParentView ? 'Bài tập sắp đến hạn của con' : 'Bài tập sắp đến hạn';
    const head = buildOverviewPanelHead({
      iconName: 'assignment',
      title: panelTitle,
      countText: !loading && !errorMsg ? String(hwList.length) : ''
    });

    if (loading) {
      assignmentsSection.replaceChildren(head, el('p', { class: 'meta overview-loading-note', role: 'status', text: 'Đang tải danh sách bài tập sắp đến hạn…' }));
      return;
    }
    if (errorMsg && !hwList.length) {
      assignmentsSection.replaceChildren(
        head,
        el('div', { class: 'overview-inline-error' }, el('p', { class: 'form-error', role: 'alert', text: errorMsg }), onRetry ? btn('Thử lại', onRetry, false, 'refresh') : null)
      );
      return;
    }

    const listNodes = [];
    for (const a of hwList) {
      const classObj = findClassById(a.class_id);
      const urgency = describeAssignmentUrgency(a, nowTs);
      const decoded = a.instructions ? decodeAssignmentSessionInstructions(a.instructions) : null;
      const sessionNum = decoded?.sessionNumber ? Number(decoded.sessionNumber) : null;

      // Dữ liệu tiến độ nộp bài thực tế từ dashboard (nếu đã tải xong)
      const staffStat = dashboard?.mode === 'staff' ? dashboard.assignmentStats?.[a.id] : null;
      const learnerStat = dashboard && dashboard.mode !== 'staff' ? dashboard.assignmentStatus?.[a.id] : null;
      const subMeta = learnerStat ? describeSubmissionStatusMeta(learnerStat, { isParent: isParentView }) : null;

      let actionLabel = staffMode ? 'Xem & chấm bài' : 'Xem bài tập';
      if (viewRole === 'student') {
        actionLabel = learnerStat && (learnerStat.status === 'submitted' || learnerStat.status === 'graded')
          ? 'Xem bài nộp'
          : 'Nộp bài';
      }

      let staffProgressBlock = null;
      if (staffStat) {
        const expected = Math.max(staffStat.expectedStudents || 0, staffStat.submittedCount || 0, 1);
        const submitted = Math.max(0, staffStat.submittedCount || 0);
        const labelText = staffStat.expectedStudents > 0
          ? `${submitted}/${staffStat.expectedStudents} HS đã nộp${staffStat.ungradedCount ? ` · ${staffStat.ungradedCount} chờ chấm` : ''}`
          : `${submitted} bài đã nộp${staffStat.ungradedCount ? ` · ${staffStat.ungradedCount} chờ chấm` : ''}`;
        staffProgressBlock = el(
          'div',
          { class: 'overview-assignment-progress' },
          el('progress', {
            class: `overview-progress${submitted >= expected && staffStat.expectedStudents > 0 ? ' is-complete' : ''}`,
            value: String(Math.min(submitted, expected)),
            max: String(expected),
            'aria-label': labelText
          }),
          el('span', { class: 'overview-assignment-progress-text', text: labelText })
        );
      }

      const learnerFeedbackLine = learnerStat?.feedbackPreview
        ? el('p', { class: 'overview-assignment-feedback', text: `Nhận xét GV: "${learnerStat.feedbackPreview}"` })
        : null;

      listNodes.push(
        el(
          'article',
          { class: `row overview-assignment-row is-tone-${urgency.tone}` },
          el(
            'div',
            { class: 'overview-assignment-info' },
            el(
              'div',
              { class: 'overview-assignment-badges' },
              sortedItems.length > 1 && classObj?.name
                ? el('span', { class: 'overview-class-pill', text: classObj.name })
                : null,
              el('span', { class: `overview-urgency-pill is-${urgency.tone}`, text: urgency.badgeText }),
              subMeta ? el('span', { class: `overview-submission-pill is-${subMeta.tone}`, text: subMeta.label }) : null
            ),
            el('h3', { text: a.title }),
            el('p', { class: 'meta', text: `Hạn nộp: ${fmt(a.closes_at)} · ${urgency.detailText}` }),
            staffProgressBlock,
            learnerFeedbackLine
          ),
          btn(
            actionLabel,
            () => openClass(classObj, 'assignments', sessionNum ? { subPage: `buoi-${sessionNum}` } : {}),
            false,
            'assignment'
          )
        )
      );
    }

    if (!listNodes.length) {
      listNodes.push(empty('Không có bài tập sắp đến hạn.'));
    }
    assignmentsSection.replaceChildren(head, ...listNodes);
  }

  function renderActivityPanel(dashboard = null, { loading = false } = {}) {
    if (!activitySection) return;
    const itemsList = Array.isArray(dashboard?.recentActivity) ? dashboard.recentActivity : [];
    const head = buildOverviewPanelHead({
      iconName: 'clock',
      title: 'Hoạt động học tập gần đây',
      countText: !loading && dashboard ? String(itemsList.length) : ''
    });

    if (loading || !dashboard) {
      activitySection.replaceChildren(head, el('p', { class: 'meta overview-loading-note', role: 'status', text: 'Đang tải dòng hoạt động gần đây…' }));
      return;
    }

    if (!itemsList.length) {
      activitySection.replaceChildren(head, empty('Chưa ghi nhận bài nộp, thảo luận hoặc học liệu mới gần đây.'));
      return;
    }

    const iconForType = t => (t === 'submission' ? 'assignment' : t === 'forum_post' ? 'message' : 'material');
    const listEl = el('div', { class: 'overview-activity-list' });
    for (const act of itemsList) {
      listEl.append(
        el(
          'div',
          { class: 'overview-activity-item' },
          el('span', { class: `overview-activity-dot is-${act.type}`, 'aria-hidden': 'true' }, icon(iconForType(act.type))),
          el(
            'div',
            { class: 'overview-activity-main' },
            el('strong', { text: act.title }),
            el('p', { class: 'meta', text: act.subtitle })
          ),
          el(
            'div',
            { class: 'overview-activity-side' },
            act.statusLabel ? el('span', { class: 'overview-activity-status', text: act.statusLabel }) : null,
            act.timestamp ? el('span', { class: 'meta overview-time-meta', text: formatRelativeTimeVi(act.timestamp, nowTs) }) : null
          ),
          el('button', {
            type: 'button',
            class: 'overview-inline-link-btn',
            text: 'Xem',
            onclick: () => run(() => openDashboardTarget(act.target))
          })
        )
      );
    }
    activitySection.replaceChildren(head, listEl);
  }

  function renderLessonsPanel(dashboard = null, { loading = false } = {}) {
    if (!lessonsSection) return;
    const lessonsList = Array.isArray(dashboard?.recentLessons) ? dashboard.recentLessons : [];
    const primaryClass = currentClass || sortedItems[0] || null;
    const headAction = primaryClass
      ? el('button', {
          type: 'button',
          class: 'overview-inline-link-btn',
          text: 'Tất cả bài giảng',
          onclick: () => openClass(primaryClass, 'materials')
        })
      : null;
    const head = buildOverviewPanelHead({
      iconName: 'material',
      title: 'Tiếp tục học · Học liệu mới nhất',
      countText: !loading && dashboard ? String(lessonsList.length) : '',
      actionEl: headAction
    });

    if (loading || !dashboard) {
      lessonsSection.replaceChildren(head, el('p', { class: 'meta overview-loading-note', role: 'status', text: 'Đang tải danh sách học liệu mới…' }));
      return;
    }

    if (!lessonsList.length) {
      lessonsSection.replaceChildren(head, empty('Giáo viên chưa đăng tải video hoặc tài liệu mới.'));
      return;
    }

    const listEl = el('div', { class: 'overview-lesson-list' });
    for (const lesson of lessonsList) {
      const counts = [];
      if (lesson.videoCount) counts.push(`${lesson.videoCount} video`);
      if (lesson.docCount) counts.push(`${lesson.docCount} tài liệu`);
      const targetClass = findClassById(lesson.classId);
      const lessonBadges = [
        sortedItems.length > 1 && lesson.className
          ? el('span', { class: 'overview-class-pill', text: lesson.className })
          : null,
        lesson.latestFileAt
          ? el('span', { class: 'meta overview-time-meta', text: formatRelativeTimeVi(lesson.latestFileAt, nowTs) })
          : null
      ].filter(Boolean);
      listEl.append(
        el(
          'div',
          { class: 'overview-lesson-item' },
          el(
            'div',
            { class: 'overview-lesson-main' },
            lessonBadges.length ? el('div', { class: 'overview-assignment-badges' }, ...lessonBadges) : null,
            el('strong', { text: lesson.title }),
            el('p', { class: 'meta', text: counts.join(' · ') || 'Đã cập nhật học liệu' })
          ),
          targetClass
            ? el('button', {
                type: 'button',
                class: 'overview-inline-link-btn',
                text: 'Vào học',
                onclick: () => openClass(targetClass, 'materials', lesson.sessionNumber ? { subPage: `buoi-${lesson.sessionNumber}` } : {})
              })
            : null
        )
      );
    }
    lessonsSection.replaceChildren(head, listEl);
  }

  function renderParentAttendancePanel(dashboard = null, { loading = false } = {}) {
    if (!parentAttendanceSection) return;
    const rows = Array.isArray(dashboard?.recentAttendance) ? dashboard.recentAttendance : [];
    const primaryClass = currentClass || sortedItems[0] || null;
    const headAction = primaryClass
      ? el('button', {
          type: 'button',
          class: 'overview-inline-link-btn',
          text: 'Xem bảng điểm danh',
          onclick: () => openClass(primaryClass, 'attendance')
        })
      : null;
    const head = buildOverviewPanelHead({
      iconName: 'attendance',
      title: 'Điểm danh gần đây của con',
      countText: !loading && dashboard ? String(rows.length) : '',
      actionEl: headAction
    });

    if (loading || !dashboard) {
      parentAttendanceSection.replaceChildren(head, el('p', { class: 'meta overview-loading-note', role: 'status', text: 'Đang tải lịch sử chuyên cần của con…' }));
      return;
    }

    if (!rows.length) {
      parentAttendanceSection.replaceChildren(head, empty('Chưa có bản ghi điểm danh nào của con.'));
      return;
    }

    const listEl = el('div', { class: 'overview-attendance-list' });
    for (const r of rows) {
      const meta = formatAttendanceStatusMeta(r.status);
      const targetClass = findClassById(r.classId) || primaryClass;
      listEl.append(
        el(
          'div',
          { class: 'overview-attendance-item' },
          el(
            'div',
            { class: 'overview-attendance-left' },
            el('strong', { class: 'overview-att-date', text: formatVnIsoDate(r.lessonDate) }),
            sortedItems.length > 1 && r.className ? el('span', { class: 'overview-class-pill', text: r.className }) : null,
            r.studentName ? el('span', { class: 'meta', text: r.studentName }) : null
          ),
          r.note
            ? el('div', { class: 'overview-attendance-mid' }, el('span', { class: 'meta', text: r.note }))
            : null,
          el(
            'div',
            { class: 'overview-attendance-right' },
            el('span', { class: `overview-att-pill is-${meta.tone}`, text: meta.label }),
            targetClass
              ? el('button', {
                  type: 'button',
                  class: 'overview-inline-link-btn',
                  text: 'Chi tiết',
                  onclick: () => openClass(targetClass, 'attendance', { subPage: r.lessonDate })
                })
              : null
          )
        )
      );
    }
    parentAttendanceSection.replaceChildren(head, listEl);
  }

  function renderResultsPanel(dashboard = null, { loading = false } = {}) {
    if (!resultsSection) return;
    const feedbacks = Array.isArray(dashboard?.recentFeedback) ? dashboard.recentFeedback : [];
    const practices = Array.isArray(dashboard?.recentPractice) ? dashboard.recentPractice : [];
    const totalCount = feedbacks.length + practices.length;
    const head = buildOverviewPanelHead({
      iconName: 'check',
      title: 'Nhận xét giáo viên & Kết quả luyện đề',
      countText: !loading && dashboard ? String(totalCount) : ''
    });

    if (loading || !dashboard) {
      resultsSection.replaceChildren(head, el('p', { class: 'meta overview-loading-note', role: 'status', text: 'Đang tải nhận xét và kết quả luyện đề…' }));
      return;
    }

    if (!totalCount) {
      resultsSection.replaceChildren(head, empty('Chưa có bài nộp được nhận xét hoặc lượt luyện đề nào.'));
      return;
    }

    const listEl = el('div', { class: 'overview-result-list' });
    for (const fb of feedbacks) {
      const cObj = findClassById(fb.classId);
      listEl.append(
        el(
          'div',
          { class: 'overview-result-item' },
          el(
            'div',
            { class: 'overview-result-main' },
            el(
              'div',
              { class: 'overview-assignment-badges' },
              el('span', { class: 'overview-submission-pill is-graded', text: 'Nhận xét BTVN' }),
              sortedItems.length > 1 && fb.className ? el('span', { class: 'overview-class-pill', text: fb.className }) : null,
              fb.studentName ? el('span', { class: 'overview-session-pill', text: fb.studentName }) : null
            ),
            el('strong', { text: fb.assignmentTitle }),
            el('p', { class: 'overview-result-quote', text: `"${fb.feedbackPreview}"` })
          ),
          cObj
            ? el('button', {
                type: 'button',
                class: 'overview-inline-link-btn',
                text: 'Xem bài',
                onclick: () => openClass(cObj, 'assignments', fb.sessionNumber ? { subPage: `buoi-${fb.sessionNumber}` } : {})
              })
            : null
        )
      );
    }

    for (const pr of practices) {
      const scoreLabel = formatScore10(pr.score, pr.maxScore);
      const roomType = ['thptqg', 'hsa', 'tsa'].includes(String(pr.examType || '').toLowerCase())
        ? String(pr.examType).toLowerCase()
        : null;
      const targetClass = pr.classId ? findClassById(pr.classId) : null;
      const canOpenPractice = viewRole === 'student' || staffMode;
      listEl.append(
        el(
          'div',
          { class: 'overview-result-item' },
          el(
            'div',
            { class: 'overview-result-main' },
            el(
              'div',
              { class: 'overview-assignment-badges' },
              el('span', { class: 'overview-practice-score-pill', text: `Điểm: ${scoreLabel}` }),
              pr.studentName ? el('span', { class: 'overview-session-pill', text: pr.studentName }) : null,
              pr.submittedAt ? el('span', { class: 'meta overview-time-meta', text: formatRelativeTimeVi(pr.submittedAt, nowTs) }) : null
            ),
            el('strong', { text: pr.examTitle })
          ),
          canOpenPractice && (roomType || targetClass)
            ? el('button', {
                type: 'button',
                class: 'overview-inline-link-btn',
                text: 'Phòng luyện',
                onclick: () =>
                  roomType
                    ? navigateTo('practice', { subPage: roomType })
                    : openClass(targetClass, 'practice')
              })
            : null
        )
      );
    }

    resultsSection.replaceChildren(head, listEl);
  }

  function renderSideInsightPanel(dashboard = null, { loading = false } = {}) {
    if (staffMode) {
      const head = buildOverviewPanelHead({
        iconName: 'attendance',
        title: 'Thống kê chuyên cần 30 ngày'
      });
      if (loading || !dashboard) {
        sideInsightSection.replaceChildren(head, el('p', { class: 'meta overview-loading-note', role: 'status', text: 'Đang tổng hợp chuyên cần…' }));
        return;
      }
      const att = dashboard.kpis?.attendance30d || {};
      if (!att.total) {
        sideInsightSection.replaceChildren(head, empty('Chưa có lượt điểm danh nào trong 30 ngày qua.'));
        return;
      }
      const lowClasses = (dashboard.classHealth || [])
        .filter(c => c.attendanceTotal > 0 && c.attendanceRatePct !== null && c.attendanceRatePct < 85)
        .slice(0, 3);

      const breakdown = el(
        'div',
        { class: 'overview-att-breakdown' },
        el('div', { class: 'overview-att-bar-head' }, el('span', { class: 'meta', text: 'Tỷ lệ đi học (Có mặt + Muộn)' }), el('strong', { text: `${att.ratePct}%` })),
        el('progress', {
          class: `overview-progress${att.ratePct >= 85 ? ' is-complete' : ' is-warn'}`,
          value: String(att.ratePct),
          max: '100',
          'aria-label': `Chuyên cần 30 ngày ${att.ratePct}%`
        }),
        el(
          'div',
          { class: 'overview-att-stat-grid' },
          el('div', { class: 'overview-att-stat-cell is-present' }, el('span', { text: 'Có mặt' }), el('strong', { text: String(att.present) })),
          el('div', { class: 'overview-att-stat-cell is-late' }, el('span', { text: 'Đi muộn' }), el('strong', { text: String(att.late) })),
          el('div', { class: 'overview-att-stat-cell is-excused' }, el('span', { text: 'Vắng phép' }), el('strong', { text: String(att.excused) })),
          el('div', { class: 'overview-att-stat-cell is-absent' }, el('span', { text: 'Không phép' }), el('strong', { text: String(att.absent) }))
        )
      );

      let lowBlock = null;
      if (lowClasses.length) {
        lowBlock = el(
          'div',
          { class: 'overview-low-att-box' },
          el('strong', { class: 'overview-low-att-title', text: 'Lớp cần lưu ý chuyên cần (< 85%)' }),
          ...lowClasses.map(c =>
            el(
              'div',
              { class: 'overview-low-att-row' },
              el('span', { text: `${c.className} · ${c.attendanceRatePct}% (${c.attendanceAbsent} vắng)` }),
              el('button', {
                type: 'button',
                class: 'overview-inline-link-btn',
                text: 'Kiểm tra',
                onclick: () => openClass(findClassById(c.classId), 'attendance')
              })
            )
          )
        );
      }
      sideInsightSection.replaceChildren(...[head, breakdown, lowBlock].filter(Boolean));
      return;
    }

    if (isParentView) {
      const primaryClass = currentClass || sortedItems[0] || null;
      const head = buildOverviewPanelHead({
        iconName: 'user',
        title: 'Học sinh đang theo dõi',
        actionEl: primaryClass
          ? el('button', {
              type: 'button',
              class: 'overview-inline-link-btn',
              text: 'Điểm danh',
              onclick: () => openClass(primaryClass, 'attendance')
            })
          : null
      });
      if (loading || !dashboard) {
        sideInsightSection.replaceChildren(head, el('p', { class: 'meta overview-loading-note', role: 'status', text: 'Đang tải thông tin học sinh…' }));
        return;
      }
      const childrenList = Array.isArray(dashboard.children) ? dashboard.children : [];
      if (!childrenList.length) {
        sideInsightSection.replaceChildren(head, empty('Tài khoản phụ huynh chưa được liên kết với học sinh nào.'));
        return;
      }
      const att = dashboard.kpis?.attendance || {};
      const childNodes = childrenList.map(child => {
        const initials = formatUserInitials(child.name, 'HS');
        return el(
          'div',
          { class: 'overview-child-card' },
          el('span', { class: 'user-avatar', text: initials }),
          el(
            'div',
            { class: 'overview-child-info' },
            el('strong', { text: child.name }),
            el('span', {
              class: 'meta',
              text: `${child.classNames?.length ? child.classNames.join(', ') : 'Chưa xếp lớp'}${child.studentCode ? ` · Mã HS: ${child.studentCode}` : ''}`
            })
          )
        );
      });
      const attSummaryBlock = att.total
        ? el(
            'div',
            { class: 'overview-att-breakdown' },
            el('div', { class: 'overview-att-bar-head' }, el('span', { class: 'meta', text: 'Tổng hợp chuyên cần' }), el('strong', { text: `${att.ratePct}%` })),
            el('progress', {
              class: `overview-progress${att.ratePct >= 85 ? ' is-complete' : ' is-warn'}`,
              value: String(att.ratePct),
              max: '100',
              'aria-label': `Chuyên cần của con ${att.ratePct}%`
            }),
            el(
              'div',
              { class: 'overview-att-stat-grid' },
              el('div', { class: 'overview-att-stat-cell is-present' }, el('span', { text: 'Có mặt' }), el('strong', { text: String(att.present) })),
              el('div', { class: 'overview-att-stat-cell is-late' }, el('span', { text: 'Đi muộn' }), el('strong', { text: String(att.late) })),
              el('div', { class: 'overview-att-stat-cell is-excused' }, el('span', { text: 'Vắng phép' }), el('strong', { text: String(att.excused) })),
              el('div', { class: 'overview-att-stat-cell is-absent' }, el('span', { text: 'Không phép' }), el('strong', { text: String(att.absent) }))
            )
          )
        : null;
      sideInsightSection.replaceChildren(...[head, ...childNodes, attSummaryBlock].filter(Boolean));
      return;
    }

    // Student View -> Chuyên cần gần đây
    const primaryClass = currentClass || sortedItems[0] || null;
    const head = buildOverviewPanelHead({
      iconName: 'attendance',
      title: 'Chuyên cần gần đây',
      actionEl: primaryClass
        ? el('button', {
            type: 'button',
            class: 'overview-inline-link-btn',
            text: 'Chi tiết',
            onclick: () => openClass(primaryClass, 'attendance')
          })
        : null
    });
    if (loading || !dashboard) {
      sideInsightSection.replaceChildren(head, el('p', { class: 'meta overview-loading-note', role: 'status', text: 'Đang tải chuyên cần gần đây…' }));
      return;
    }
    const att = dashboard.kpis?.attendance || {};
    const rows = Array.isArray(dashboard.recentAttendance) ? dashboard.recentAttendance : [];
    if (!att.total && !rows.length) {
      sideInsightSection.replaceChildren(head, empty('Chưa có dữ liệu điểm danh cá nhân.'));
      return;
    }
    const barBlock = att.total
      ? el(
          'div',
          { class: 'overview-att-breakdown' },
          el('div', { class: 'overview-att-bar-head' }, el('span', { class: 'meta', text: `${att.present + att.late}/${att.total} buổi đi học` }), el('strong', { text: `${att.ratePct}%` })),
          el('progress', {
            class: `overview-progress${att.ratePct >= 85 ? ' is-complete' : ' is-warn'}`,
            value: String(att.ratePct),
            max: '100',
            'aria-label': `Chuyên cần cá nhân ${att.ratePct}%`
          })
        )
      : null;
    const recentList = el('div', { class: 'overview-attendance-list is-compact' });
    for (const r of rows) {
      const meta = formatAttendanceStatusMeta(r.status);
      const targetClass = findClassById(r.classId) || primaryClass;
      recentList.append(
        el(
          'div',
          { class: 'overview-attendance-item' },
          el('div', { class: 'overview-attendance-left' }, el('strong', { class: 'overview-att-date', text: formatVnIsoDate(r.lessonDate) }), r.note ? el('span', { class: 'meta', text: r.note }) : null),
          el(
            'div',
            { class: 'overview-attendance-right' },
            el('span', { class: `overview-att-pill is-${meta.tone}`, text: meta.label }),
            targetClass
              ? el('button', {
                  type: 'button',
                  class: 'overview-inline-link-btn',
                  text: 'Xem',
                  onclick: () => openClass(targetClass, 'attendance', { subPage: r.lessonDate })
                })
              : null
          )
        )
      );
    }
    sideInsightSection.replaceChildren(...[head, barBlock, recentList].filter(Boolean));
  }

  function renderStudentForumPanel(dashboard = null, { loading = false } = {}) {
    if (!studentForumSection) return;
    const primaryClass = currentClass || sortedItems[0] || null;
    const posts = Array.isArray(dashboard?.recentForumPosts) ? dashboard.recentForumPosts : [];
    const head = buildOverviewPanelHead({
      iconName: 'message',
      title: 'Diễn đàn lớp học',
      countText: !loading && dashboard ? String(posts.length) : '',
      actionEl: primaryClass
        ? el('button', {
            type: 'button',
            class: 'overview-inline-link-btn',
            text: 'Vào diễn đàn',
            onclick: () => openClass(primaryClass, 'forum')
          })
        : null
    });

    if (loading || !dashboard) {
      studentForumSection.replaceChildren(
        head,
        el('p', { class: 'meta overview-loading-note', role: 'status', text: 'Đang tải thảo luận gần đây…' })
      );
      return;
    }

    const askQuickBtn = primaryClass
      ? el(
          'button',
          {
            type: 'button',
            class: 'overview-forum-ask-btn',
            onclick: () => {
              pendingForumContext = { classId: primaryClass.id, openComposer: true };
              openClass(primaryClass, 'forum');
            }
          },
          icon('plus'),
          el('span', { text: 'Đặt câu hỏi cho lớp' })
        )
      : null;

    if (!posts.length) {
      studentForumSection.replaceChildren(
        ...[head, empty('Lớp chưa có câu hỏi thảo luận gần đây.'), askQuickBtn].filter(Boolean)
      );
      return;
    }

    const listEl = el('div', { class: 'overview-forum-list' });
    for (const post of posts) {
      const catMeta = getForumCategoryMeta(post.category);
      const replyText = post.commentCount > 0 ? `${post.commentCount} phản hồi` : 'Chưa có trả lời';
      const relTime = formatRelativeForumTimeVi(post.latestActivityAt || post.createdAt, nowTs);
      listEl.append(
        el(
          'div',
          { class: 'overview-forum-item' },
          el(
            'div',
            { class: 'overview-forum-main' },
            el(
              'div',
              { class: 'overview-assignment-badges' },
              el('span', {
                class: `overview-submission-pill ${post.resolved ? 'is-graded' : 'is-pending'}`,
                text: post.resolved ? 'Đã giải đáp' : 'Chờ giải đáp'
              }),
              el('span', { class: 'overview-session-pill', text: catMeta.pillLabel }),
              post.isMine ? el('span', { class: 'overview-class-pill', text: 'Câu của bạn' }) : null,
              sortedItems.length > 1 && post.className
                ? el('span', { class: 'overview-class-pill', text: post.className })
                : null
            ),
            el('strong', { text: post.title }),
            el('p', {
              class: 'meta',
              text: [post.authorName, replyText, relTime].filter(Boolean).join(' · ')
            })
          ),
          el('button', {
            type: 'button',
            class: 'overview-inline-link-btn',
            text: 'Xem',
            onclick: () => run(() => openDashboardTarget(post.target))
          })
        )
      );
    }

    studentForumSection.replaceChildren(...[head, listEl, askQuickBtn].filter(Boolean));
  }

  let levelFilter = 'all';
  let latestDashboardData = null;

  function renderClassHealthBand(dashboard = latestDashboardData) {
    if (!classHealthSection) return;
    if (dashboard) latestDashboardData = dashboard;
    const hasThcs = sortedItems.some(c => {
      const g = classGrade(c.name);
      return g >= 6 && g <= 9;
    });
    const hasThpt = sortedItems.some(c => {
      const g = classGrade(c.name);
      return g >= 10 && g <= 12;
    });
    const healthMap = new Map((latestDashboardData?.classHealth || []).map(h => [h.classId, h]));

    const head = buildOverviewPanelHead({
      iconName: 'class',
      title: 'Tình hình hoạt động theo từng lớp',
      countText: String(sortedItems.length)
    });

    const filterBar = hasThcs && hasThpt
      ? el('div', { class: 'overview-filter-bar', role: 'group', 'aria-label': 'Lọc lớp theo cấp học' })
      : null;
    const listHost = el('div', { class: 'overview-health-body' });

    function drawHealth() {
      const filtered = filterOverviewClasses(sortedItems, levelFilter);
      if (filterBar) {
        const defs = [
          ['all', `Tất cả (${sortedItems.length})`],
          ['thcs', 'THCS (6–9)'],
          ['thpt', 'THPT (10–12)']
        ];
        filterBar.replaceChildren(
          ...defs.map(([key, text]) =>
            el('button', {
              type: 'button',
              class: `overview-filter-pill${levelFilter === key ? ' is-active' : ''}`,
              'aria-pressed': String(levelFilter === key),
              text,
              onclick: () => {
                levelFilter = key;
                drawHealth();
              }
            })
          )
        );
      }

      if (!filtered.length) {
        listHost.replaceChildren(
          empty(sortedItems.length ? 'Không có lớp phù hợp bộ lọc cấp học này.' : 'Bạn chưa được phân công vào lớp học nào.')
        );
        return;
      }

      const listEl = el(
        'div',
        { class: 'overview-health-list' },
        el(
          'div',
          { class: 'overview-health-head', 'aria-hidden': 'true' },
          el('span', { text: 'Lớp học' }),
          el('span', { text: 'Sĩ số' }),
          el('span', { text: 'Chuyên cần' }),
          el('span', { text: 'Học liệu' }),
          el('span', { text: 'BTVN & Chấm bài' }),
          el('span', { text: '' })
        )
      );

      for (const c of filtered) {
        const grade = classGrade(c.name);
        const level = grade >= 6 && grade <= 9 ? 'THCS' : grade >= 10 && grade <= 12 ? 'THPT' : null;
        const slug = classCohortSlug(c, sortedItems);
        const h = healthMap.get(c.id);
        const studentValue = h ? `${h.studentCount} HS` : '—';
        const attValue = h ? (h.attendanceRatePct != null ? `${h.attendanceRatePct}%` : 'Chưa có') : '—';
        const attWarn = Boolean(h && h.attendanceRatePct != null && h.attendanceRatePct < 85);
        const lessonValue = h ? `${h.lessonWithFilesCount} buổi` : '—';
        const hwValue = h
          ? `${h.openAssignmentsCount} mở${h.ungradedCount ? ` · ${h.ungradedCount} chờ chấm` : ''}`
          : '—';

        listEl.append(
          el(
            'article',
            { class: 'overview-health-row' },
            el(
              'div',
              { class: 'overview-health-class' },
              el('strong', { text: c.name }),
              el(
                'div',
                { class: 'overview-health-badges' },
                level ? el('span', { class: `badge class-level class-level-${level.toLowerCase()}`, text: level }) : null,
                el('span', { class: 'badge badge-info', text: `Niên khóa ${slug}` })
              )
            ),
            el('div', { class: 'overview-health-metric' }, el('span', { class: 'overview-health-metric-label', text: 'Sĩ số' }), el('strong', { text: studentValue })),
            el('div', { class: `overview-health-metric${attWarn ? ' is-warn' : ''}` }, el('span', { class: 'overview-health-metric-label', text: 'Chuyên cần' }), el('strong', { text: attValue })),
            el('div', { class: 'overview-health-metric' }, el('span', { class: 'overview-health-metric-label', text: 'Học liệu' }), el('strong', { text: lessonValue })),
            el('div', { class: 'overview-health-metric' }, el('span', { class: 'overview-health-metric-label', text: 'BTVN' }), el('strong', { text: hwValue })),
            el(
              'div',
              { class: 'overview-health-action' },
              h?.unansweredForumCount > 0
                ? el('button', {
                    type: 'button',
                    class: 'overview-inline-link-btn overview-health-forum-pill',
                    text: `${h.unansweredForumCount} hỏi đáp chờ`,
                    onclick: () => {
                      pendingForumContext = { classId: c.id, statusFilter: 'waiting' };
                      openClass(c, 'forum');
                    }
                  })
                : null,
              el('button', {
                type: 'button',
                class: 'overview-inline-link-btn is-accent',
                text: 'Điểm danh',
                onclick: () => openClass(c, 'attendance')
              }),
              el('button', {
                type: 'button',
                class: 'overview-inline-link-btn',
                text: 'Mở lớp',
                onclick: () => openClass(c, viewRole === 'admin' ? 'operations' : 'notices', { isClassEntry: true })
              })
            )
          )
        );
      }

      listHost.replaceChildren(listEl);
    }

    drawHealth();
    classHealthSection.replaceChildren(...[head, filterBar, listHost].filter(Boolean));
  }

  renderSchedulePanel();

  const primaryCol = staffMode
    ? el('div', { class: 'overview-primary-col' }, actionQueueSection, assignmentsSection, activitySection)
    : isParentView
      ? el('div', { class: 'overview-primary-col' }, parentAttendanceSection, assignmentsSection, resultsSection)
      : el('div', { class: 'overview-primary-col' }, assignmentsSection, lessonsSection, resultsSection);

  const sideCol = el('div', { class: 'overview-side-col' }, scheduleSection, sideInsightSection, studentForumSection);
  const workspaceGrid = el('div', { class: 'overview-workspace-grid' }, primaryCol, sideCol);
  const root = el(
    'div',
    { class: 'overview-page-root' },
    heroSection,
    errorBannerHost,
    kpiSection,
    workspaceGrid,
    classHealthSection
  );

  const filterOverviewPayload = raw => ({
    assignments: Array.isArray(raw?.assignments) ? raw.assignments.filter(a => visibleIds.has(a.class_id)) : [],
    dashboard: raw?.dashboard || null
  });

  // Hiển thị ngay khung giao diện + bài tập bootstrap (nếu có) và lịch học, rồi nạp số liệu trực tiếp
  const seeded = initialOverview ? filterOverviewPayload(initialOverview) : null;
  renderKpiSection(seeded?.dashboard || null, { loading: !seeded?.dashboard });
  if (staffMode) {
    renderActionQueuePanel(seeded?.dashboard || null, { loading: !seeded?.dashboard });
    renderActivityPanel(seeded?.dashboard || null, { loading: !seeded?.dashboard });
    renderClassHealthBand(seeded?.dashboard || null);
  } else if (isParentView) {
    renderParentAttendancePanel(seeded?.dashboard || null, { loading: !seeded?.dashboard });
    renderResultsPanel(seeded?.dashboard || null, { loading: !seeded?.dashboard });
  } else {
    renderLessonsPanel(seeded?.dashboard || null, { loading: !seeded?.dashboard });
    renderResultsPanel(seeded?.dashboard || null, { loading: !seeded?.dashboard });
    renderStudentForumPanel(seeded?.dashboard || null, { loading: !seeded?.dashboard });
  }
  renderSideInsightPanel(seeded?.dashboard || null, { loading: !seeded?.dashboard });
  renderAssignmentsPanel(seeded, { loading: !seeded });
  if (seeded?.dashboard) {
    renderHeroSummary(seeded.dashboard, seeded.assignments.length);
  }

  content(root);

  const version = contentVersion;
  async function loadOverviewDashboard() {
    errorBannerHost.replaceChildren();
    refreshBtn.disabled = true;
    try {
      const response = await api(`/api/overview?role=${encodeURIComponent(viewRole || '')}`);
      if (version !== contentVersion) return;
      const payload = filterOverviewPayload(response);
      renderHeroSummary(payload.dashboard, payload.assignments.length);
      renderKpiSection(payload.dashboard, { loading: false });
      renderAssignmentsPanel(payload, { loading: false });
      if (staffMode) {
        renderActionQueuePanel(payload.dashboard, { loading: false });
        renderActivityPanel(payload.dashboard, { loading: false });
        renderClassHealthBand(payload.dashboard);
      } else if (isParentView) {
        renderParentAttendancePanel(payload.dashboard, { loading: false });
        renderResultsPanel(payload.dashboard, { loading: false });
      } else {
        renderLessonsPanel(payload.dashboard, { loading: false });
        renderResultsPanel(payload.dashboard, { loading: false });
        renderStudentForumPanel(payload.dashboard, { loading: false });
      }
      renderSideInsightPanel(payload.dashboard, { loading: false });
    } catch (err) {
      if (version !== contentVersion) return;
      const errMsg = friendly(err);
      if (!seeded) {
        renderAssignmentsPanel(null, { errorMsg: errMsg, onRetry: () => loadOverviewDashboard() });
        renderKpiSection(null, { loading: false });
      } else {
        errorBannerHost.replaceChildren(
          el(
            'div',
            { class: 'overview-panel overview-inline-error', role: 'alert' },
            el('p', { class: 'form-error', text: errMsg }),
            btn('Thử lại', () => loadOverviewDashboard(), false, 'refresh')
          )
        );
      }
      if (staffMode) {
        renderActionQueuePanel({ actionQueue: [] }, { loading: false });
        renderActivityPanel({ recentActivity: [] }, { loading: false });
      } else if (isParentView) {
        renderParentAttendancePanel({ recentAttendance: [] }, { loading: false });
        renderResultsPanel({ recentFeedback: [], recentPractice: [] }, { loading: false });
      } else {
        renderLessonsPanel({ recentLessons: [] }, { loading: false });
        renderResultsPanel({ recentFeedback: [], recentPractice: [] }, { loading: false });
        renderStudentForumPanel({ recentForumPosts: [] }, { loading: false });
      }
      renderSideInsightPanel({ kpis: {}, children: [], recentAttendance: [] }, { loading: false });
    } finally {
      if (version === contentVersion) refreshBtn.disabled = false;
    }
  }

  await loadOverviewDashboard();
}

async function openClass(c, tab = 'notices', {isClassEntry = false, materialsSubTab = null, subPage = null, replaceUrl = false} = {}) {
  if (!c || !allAccessibleClasses().some(item => item.id === c.id)) return;
  viewVersion++;
  activeNav = 'classes';
  activeClassTab = tab;
  activePracticeSubPage = subPage;
  activeAdminSubPage = null;
  if (materialsSubTab === 'files' || materialsSubTab === 'videos') {
    activeMaterialsSubTab = materialsSubTab;
  }
  selectedClass = c;
  workspaceSource = workspace = null;
  navigation();
  syncBrowserUrl({replace: replaceUrl, isClassEntry, subPage});
  const version = loadingPage(c.name);
  const source = await api(`/api/classes/${c.id}/workspace`);
  if (version !== viewVersion) return;
  me = viewerForWorkspace(me, source);
  if (!availableViewRoles(me).includes(viewRole)) {
    viewRole = availableViewRoles(me)[0];
    saveViewRole(viewRole);
  }
  if (!allAccessibleClasses().some(item => item.id === c.id) && !(source.class?.archived && isStaffView())) {
    await navigateTo('home', {replaceUrl: true});
    status('Quyền truy cập lớp đã thay đổi. Danh sách được cập nhật theo phân công hiện tại.');
    return;
  }
  navigation();
  workspaceSource = source;
  workspace = workspaceForView(me, viewRole, source);
  classView(tab, {isClassEntry, subPage, replaceUrl: true});
}

async function refreshClass(tab, {subPage = activePracticeSubPage} = {}) {
  invalidateClassSessionsCatalogCache(selectedClass?.id);
  await openClass(selectedClass, tab, {subPage, replaceUrl: true});
}

const person = uid => uid === me.uid ? 'Bạn' : workspace.people?.find(p => p.uid === uid)?.display_name || workspace.members?.find(m => m.uid === uid)?.name || 'Thành viên';

const localTime = v => new Date(v - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function classView(active, {isClassEntry = false, subPage = null, replaceUrl = false} = {}) {
  const allowedTabs = tabsForView(viewRole, workspace.class);
  if (!allowedTabs.includes(active)) active = allowedTabs[0];
  activeClassTab = active;
  activePracticeSubPage = subPage;
  viewVersion++;
  navigation();
  syncBrowserUrl({replace: replaceUrl, isClassEntry, subPage});
  const isArchived = Boolean(workspace.class.archived || selectedClass?.archived);
  const cohortSlug = classCohortSlug(workspace.class, isArchived ? archivedClasses : classes);
  const archiveBanner = isArchived ? el('div', {class: 'notice archived-class-banner'},
    el('div', {class: 'archived-class-banner-copy'},
      el('strong', {text: `Kho lưu trữ niên khóa ${cohortSlug}`}),
      el('p', {class: 'meta', text: 'Đây là dữ liệu lưu trữ của niên khóa đã hoàn thành chương trình. Quản trị viên, Giáo viên và Trợ giảng có thể xem lại toàn bộ học liệu, bài giảng, bài tập, đề thi, điểm danh và diễn đàn.'})
    ),
    isStaffView() ? btn('Về Kho lưu trữ', () => navigateTo('archive'), false, 'class') : null
  ) : null;
  const cleanSubPage = String(subPage || '').trim();
  const isDedicatedSessionPage =
    ((active === 'materials' || active === 'assignments') && /^buoi-\d{1,3}$/i.test(cleanSubPage)) ||
    (active === 'practice' && parsePracticeSubPage(cleanSubPage).isSolutionPage);
  content(
    archiveBanner,
    el('div', {id: 'class-body', class: `class-subtab-body is-tab-${active}${isDedicatedSessionPage ? ' is-dedicated-session-body' : ''}`})
  );

  const root = $('class-body'), staffView = ['admin', 'teacher', 'assistant'].includes(viewRole), p = workspace.permissions;

  if (active === 'forum') {
    const canWrite = Boolean(viewRole === 'student' ? p.student : staffView && p.messages);
    const canModerate = Boolean(staffView && p.messages);
    const contextForClass =
      pendingForumContext && pendingForumContext.classId === selectedClass.id
        ? pendingForumContext
        : null;
    pendingForumContext = null;
    renderForumWorkspace({
      root,
      classId: selectedClass.id,
      className: workspace.class?.name || selectedClass.name || 'Lớp học',
      cohortSlug,
      viewRole,
      currentUid: me.uid,
      isArchived,
      canWrite,
      canModerate,
      subPage: cleanSubPage || null,
      initialContext: contextForClass,
      api,
      status,
      friendly,
      fmt,
      icon,
      btn,
      empty,
      modal,
      closeModal: () => {
        if ($('editor')?.open) $('editor').close();
      },
      upgradeSelects: container => upgradeAllSelectsIn(container),
      download,
      openAttachmentPreview: openForumAttachmentPreview,
      createQuestionMathEditor,
      renderMathText: renderForumText,
      loadSessions: () => loadClassSessionsCatalog(selectedClass.id),
      onNavigatePost: nextPostId => {
        activePracticeSubPage = nextPostId || null;
        syncBrowserUrl({replace: false, isClassEntry: false, subPage: nextPostId || null});
      },
      onOpenSessionTarget: (sessionNum, targetTab) => {
        classView(targetTab, {subPage: `buoi-${sessionNum}`});
        window.scrollTo?.({top: 0, behavior: 'smooth'});
      },
      onForumMutated: () => invalidateOpsForumStatsCache()
    });
    return;
  }

  if (active === 'operations') {
    renderClassOperationsWorkspace({
      root,
      workspace,
      api,
      isArchived,
      cohortSlug,
      fmt,
      icon,
      btn,
      onOpenScheduleEditor: klass => scheduleEditor(klass),
      onSwitchTab: targetTab => classView(targetTab)
    });
    return;
  }

  if (active === 'notices') {
    renderClassNoticesWorkspace({
      root,
      workspace,
      viewRole,
      staffView,
      isArchived,
      cohortSlug,
      fmt,
      icon,
      btn,
      empty,
      personResolver: person,
      renderMathText: renderForumText,
      renderAttachments: renderNoticeAttachments,
      onOpenScheduleEditor: klass => scheduleEditor(klass),
      onOpenNoticeModal: (existingNotice, presets = {}) => openNoticeComposerModal(existingNotice, presets),
      onMarkNoticeRead: async item => {
        if (!item?.id) return null;
        try {
          const res = await api(`/api/notices/${encodeURIComponent(item.id)}/read`, {
            method: 'POST',
            idempotent: true
          });
          const seenAt = Number(res?.seenAt) || Date.now();
          const syncSeen = list => {
            const target = Array.isArray(list) ? list.find(n => n?.id === item.id) : null;
            if (target) target.viewer_seen_at = seenAt;
          };
          syncSeen(workspace?.notices);
          syncSeen(workspaceSource?.notices);
          status('Đã xác nhận đã xem thông báo.', false, 'success');
          return {seenAt};
        } catch (err) {
          status(friendly(err), true);
          throw err;
        }
      },
      onInspectNoticeReads: (item, onSummaryUpdated) => openNoticeReadsModal(item, onSummaryUpdated),
      onTogglePinNotice: async item => {
        if (!selectedClass?.id || !item?.id) return;
        const nextPinned = !item.pinned;
        const encodedBody = encodeNoticeMeta({
          category: item.category,
          pinned: nextPinned,
          body: item.cleanBody
        });
        await api(`/api/notices/${encodeURIComponent(item.id)}/edit`, {
          method: 'POST',
          body: {
            title: item.title,
            body: encodedBody
          }
        });
        await refreshClass('notices');
        status(nextPinned ? 'Đã ghim thông báo lên đầu bảng tin.' : 'Đã bỏ ghim thông báo.', false, 'success');
      }
    });
  }

  if (active === 'materials') {
    const canWriteMaterials = Boolean(p.materials && staffView);
    const sessionsHost = el('div', {class: 'sessions-materials-page-root'});
    root.append(sessionsHost);

    renderSplitMaterialsAndLessons({
      filesSection: sessionsHost,
      classId: selectedClass.id,
      canWrite: canWriteMaterials,
      canManageSchedule: Boolean(!isArchived && p.schedule && staffView),
      subPage
    });
  }

  if (active === 'assignments') {
    const canWriteAssignments = Boolean((p.assignments || p.materials) && staffView);
    renderSessionBasedAssignments({
      root,
      classId: selectedClass.id,
      canWrite: canWriteAssignments,
      staffView,
      p,
      subPage
    });
  }

  if (active === 'practice') {
    const grade = Number.isInteger(workspace.class?.grade) ? workspace.class.grade : classGrade(workspace.class.name);
    const isHighSchoolClass = grade >= 10 && grade <= 12;
    const parsedSub = parsePracticeSubPage(subPage);

    if (parsedSub.isSolutionPage && parsedSub.examId) {
      const solutionsHost = el('div', {class: 'ltch-practice-solutions-wrap is-dedicated-standalone'});
      root.append(solutionsHost);
      renderExamSolutionPage({
        container: solutionsHost,
        examType: parsedSub.examType,
        examId: parsedSub.examId,
        classGradeFilter: isHighSchoolClass ? grade : null,
        isArchived,
        onBackToRoom: () => {
          classView('practice', {subPage: parsedSub.examType || null});
          window.scrollTo?.({top: 0, behavior: 'smooth'});
        },
        onSwitchExam: (nextExamId) => {
          const track = parsedSub.examType || 'thptqg';
          classView('practice', {subPage: `${track}/${nextExamId}`});
          window.scrollTo?.({top: 0, behavior: 'smooth'});
        },
        onStartExam: (examObj) => {
          pendingAutoOpenExamId = examObj.id;
          const targetTrack = parsedSub.examType === 'past' ? 'past' : String(examObj?.examType || parsedSub.examType || 'thptqg').toLowerCase();
          classView('practice', {subPage: targetTrack});
          window.scrollTo?.({top: 0, behavior: 'smooth'});
        }
      });
      return;
    }

    if (isHighSchoolClass) {
      const roomsHost = el('div', {class: 'ltch-class-practice-rooms-wrap'});
      root.append(roomsHost);
      const autoOpenExamId = pendingAutoOpenExamId;
      pendingAutoOpenExamId = null;
      renderPracticeRoomsPortal({
        container: roomsHost,
        api,
        status,
        classGrade: grade,
        viewerRole: viewRole,
        initialExamType: parsedSub.examType,
        autoOpenExamId,
        onNavigateExamType: (nextType) => {
          activePracticeSubPage = nextType || null;
          syncBrowserUrl({replace: false, isClassEntry: false, subPage: nextType || null});
        },
        onOpenExamSolution: (ex) => {
          const track = ex?.isPastPool ? 'past' : String(ex?.examType || parsedSub.examType || 'thptqg').toLowerCase();
          classView('practice', {subPage: `${track}/${ex.id}`});
          window.scrollTo?.({top: 0, behavior: 'smooth'});
        }
      });
    } else {
      root.append(empty('Phòng luyện THPTQG · HSA · TSA dành cho các lớp THPT (Khối 10, 11, 12).'));
    }
  }

  if (active === 'attendance') {
    const initialDate = parseIsoDateParts(subPage)?.iso || null;
    if (staffView) {
      const students = (workspace.members || []).filter(m => m.member_role === 'student');
      renderStaffAttendanceWorkspace({
        root,
        classId: selectedClass.id,
        classInfo: workspace.class,
        isArchived,
        students,
        attendanceRows: workspace.attendance,
        canWrite: Boolean(!isArchived && p.attendance && staffView),
        initialDate,
        sessionsLoader: () => loadClassSessionsCatalog(selectedClass.id),
        personResolver: person,
        onSaveRecord: async payload => {
          const result = await api(`/api/classes/${selectedClass.id}/attendance`, {method: 'POST', body: payload});
          const id = `${selectedClass.id}_${payload.studentUid}_${payload.date}`;
          const record = {
            id,
            class_id: selectedClass.id,
            student_uid: payload.studentUid,
            lesson_date: payload.date,
            status: payload.status,
            note: payload.note || '',
            updated_at: Date.now()
          };
          if (workspaceSource && Array.isArray(workspaceSource.attendance)) {
            const idx = workspaceSource.attendance.findIndex(
              r => r.student_uid === payload.studentUid && r.lesson_date === payload.date
            );
            if (idx >= 0) workspaceSource.attendance[idx] = record;
            else workspaceSource.attendance.unshift(record);
          }
          if (workspace && Array.isArray(workspace.attendance) && workspace.attendance !== workspaceSource?.attendance) {
            const idx = workspace.attendance.findIndex(
              r => r.student_uid === payload.studentUid && r.lesson_date === payload.date
            );
            if (idx >= 0) workspace.attendance[idx] = record;
            else workspace.attendance.unshift(record);
          }
          return result;
        },
        onOpenHistoryModal: modal,
        onDateChange: nextDate => {
          activePracticeSubPage = nextDate || null;
          syncBrowserUrl({replace: false, isClassEntry: false, subPage: nextDate || null});
        },
        onOpenSessionLink: (targetTab, sessionNumber) => {
          classView(targetTab, {subPage: `buoi-${sessionNumber}`});
          window.scrollTo?.({top: 0, behavior: 'smooth'});
        },
        onStatusToast: (msg, isError = false, kind = '') => status(msg, isError, kind)
      });
      return;
    }

    const linkedChildren = viewRole === 'parent'
      ? (me.childMemberships || [])
          .filter(m => m.class_id === selectedClass.id)
          .map(m => ({uid: m.uid, name: person(m.uid)}))
      : [];

    renderLearnerAttendanceWorkspace({
      root,
      classId: selectedClass.id,
      classInfo: workspace.class,
      viewRole,
      attendanceRows: workspace.attendance || [],
      linkedChildren,
      initialDate,
      sessionsLoader: () => loadClassSessionsCatalog(selectedClass.id),
      personResolver: person,
      onOpenSessionLink: (targetTab, sessionNumber) => {
        classView(targetTab, {subPage: `buoi-${sessionNumber}`});
        window.scrollTo?.({top: 0, behavior: 'smooth'});
      }
    });
  }

}

// The forum uses authenticated previews/downloads; file URLs never expose storage keys.
async function openForumAttachmentPreview({path, downloadPath, name, contentType = '', size = 0, existingBlob = null}) {
  const safeName = name || 'Tệp đính kèm';
  const dlPath = downloadPath || path;
  const dlSlug = safeName.replace(/\.(pdf|jpe?g|png)$/i, '');
  let closed = false;
  let activeObjectUrl = null;
  let activePdfCtrl = null;
  let activeLoadingTask = null;
  let imageDegStep = 0;

  const cleanup = () => {
    activePdfCtrl?.destroy?.();
    activePdfCtrl = null;
    activeLoadingTask?.destroy?.().catch?.(() => {});
    activeLoadingTask = null;
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
  };

  const stageHost = el(
    'div',
    {class: 'submission-gallery-stage'},
    el(
      'div',
      {class: 'media-loading-card'},
      el('span', {class: 'media-spinner', 'aria-hidden': 'true'}),
      el('p', {role: 'status', text: `Đang tải "${safeName}"…`})
    )
  );
  const actionsHost = el(
    'div',
    {class: 'submission-gallery-actions'},
    btn('Tải xuống', () => download(dlPath, dlSlug, contentType), false, 'download')
  );
  const container = el('div', {class: 'submission-gallery-modal'}, stageHost, actionsHost);
  modal(safeName, container);
  $('editor').addEventListener(
    'close',
    () => {
      closed = true;
      cleanup();
    },
    {once: true}
  );

  try {
    const blob = existingBlob instanceof Blob ? existingBlob : await api(path, {blob: true});
    if (closed || !container.isConnected) return;
    if (!blob || !blob.size) throw Error('Không tải được tệp đính kèm.');

    const sig = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    const looksLikePdf =
      contentType === 'application/pdf' ||
      /\.pdf$/i.test(safeName) ||
      (sig.length === 5 && String.fromCharCode(...sig) === '%PDF-');

    if (looksLikePdf) {
      const panel = el('div', {class: 'media-viewer-panel pdf-viewer-panel is-inline', 'aria-busy': 'true'});
      stageHost.replaceChildren(panel);
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      activeLoadingTask = pdfjs.getDocument({
        data: new Uint8Array(await blob.arrayBuffer()),
        isEvalSupported: false,
        disableFontFace: true,
        enableXfa: false,
        maxImageSize: 16000000,
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/'
      });
      const doc = await activeLoadingTask.promise;
      if (closed || !panel.isConnected) return;
      activePdfCtrl = await mountDriveStylePdfViewer({
        panel,
        name: safeName,
        doc,
        compact: true,
        isClosed: () => closed || !panel.isConnected,
        onDownload: () => download(dlPath, dlSlug, contentType, {existingBlob: blob, existingPdfDoc: doc})
      });
      return;
    }

    activeObjectUrl = URL.createObjectURL(blob);
    const imgNode = el('img', {
      src: activeObjectUrl,
      alt: safeName,
      class: 'submission-preview-img is-rot-0',
      draggable: false
    });
    const rotateBtn = el(
      'button',
      {
        type: 'button',
        class: 'submission-preview-rotate-btn',
        onclick: () => {
          imgNode.classList.remove(`is-rot-${(imageDegStep % 4) * 90}`);
          imageDegStep = (imageDegStep + 1) % 4;
          imgNode.classList.add(`is-rot-${(imageDegStep % 4) * 90}`);
        }
      },
      mediaIcon('rotateCw'),
      el('span', {text: 'Xoay 90°'})
    );
    const topBar = el(
      'div',
      {class: 'submission-preview-bar'},
      el('strong', {class: 'submission-preview-filename', text: safeName}),
      size ? el('span', {class: 'meta', text: formatFileSize(size)}) : null,
      rotateBtn
    );
    stageHost.replaceChildren(
      el('div', {class: 'submission-preview-card'}, topBar, el('div', {class: 'submission-preview-image-stage'}, imgNode))
    );
  } catch (err) {
    if (!closed && stageHost.isConnected) {
      stageHost.replaceChildren(
        el(
          'div',
          {class: 'media-error-card'},
          el('p', {class: 'form-error', role: 'alert', text: friendly(err)}),
          btn('Tải về máy', () => download(dlPath, dlSlug, contentType), false, 'download')
        )
      );
    }
  }
}

let pendingAutoOpenSessionMode = null; // { classId, sessionNumber, mode: 'lecture' | 'document' }

const examSolutionFilesBasePath = (examId) =>
  `/api/practice/exams/${encodeURIComponent(examId)}/solutions/files`;

function resolveItemFilesBasePath(classId, itemId, filesBasePath = null) {
  return filesBasePath || `/api/classes/${classId}/lessons/${itemId}/files`;
}

function openSessionEditorModal(arg1, sessionArg = null, allSessionsArg = [], onSavedArg = null) {
  const isConfigObj = arg1 && typeof arg1 === 'object' && !Array.isArray(arg1);
  const classId = isConfigObj ? arg1.classId : arg1;
  const session = isConfigObj ? arg1.session : sessionArg;
  const allSessions = isConfigObj ? (arg1.allSessions || []) : (allSessionsArg || []);
  const scheduleSlots = isConfigObj ? (arg1.scheduleSlots || workspace?.class?.schedule_slots || []) : (workspace?.class?.schedule_slots || []);
  const onSaved = isConfigObj ? arg1.onSaved : onSavedArg;
  const num = session.sessionNumber;
  const nameField = field('lessonName', `Tên buổi học (Buổi ${num})`, 'text', session.lessonName || '', {
    required: false,
    maxLength: 180,
    placeholder: 'VD: Khảo sát sự biến thiên và vẽ đồ thị hàm số'
  });
  const topicField = field('cleanTopic', 'Chuyên đề / Chương Toán', 'text', session.cleanTopic || '', {
    required: false,
    maxLength: 120,
    placeholder: 'VD: Giải tích 12 - Chương 1'
  });
  const dateField = field('date', `Ngày học Buổi ${num}`, 'date', session.date || new Date().toLocaleDateString('en-CA'));
  const startField = field('start', 'Giờ bắt đầu', 'time', session.start || '18:00', {required: false});
  const endField = field('end', 'Giờ kết thúc', 'time', session.end || '20:00', {required: false});

  const hasLaterSessions = num < allSessions.length;
  const cascadeCheck = el('input', {type: 'checkbox', checked: false});
  let userToggledCascade = false;
  cascadeCheck.addEventListener('change', () => {
    userToggledCascade = true;
    updateCascadePreview();
  });

  const cascadePreviewBox = el('div', {class: 'notice session-cascade-preview', hidden: true});
  const cascadeOptionWrap = hasLaterSessions
    ? el('div', {class: 'session-cascade-box'},
        el('label', {class: 'check'},
          cascadeCheck,
          `Tự động lùi lịch các buổi tiếp theo (Buổi ${num + 1} → Buổi ${allSessions.length}) khi dời ngày học buổi này`
        ),
        cascadePreviewBox
      )
    : el('div');

  function updateCascadePreview() {
    if (!hasLaterSessions) return;
    const newDate = dateField.input.value;
    const oldDate = session.date;
    if (!newDate || newDate === oldDate || !parseIsoDateParts(newDate)) {
      cascadePreviewBox.hidden = true;
      return;
    }
    const deltaDays = oldDate ? diffIsoDays(oldDate, newDate) : 0;
    const nextSession = allSessions.find(s => s.sessionNumber === num + 1);
    const autoShouldCascade = Boolean(deltaDays >= 7 || (nextSession?.date && newDate >= nextSession.date));
    if (!userToggledCascade) {
      cascadeCheck.checked = autoShouldCascade;
    }
    cascadePreviewBox.hidden = false;
    cascadePreviewBox.replaceChildren();
    if (cascadeCheck.checked) {
      try {
        const preview = rescheduleCourseSessions(allSessions, num, newDate, {
          scheduleSlots,
          cascade: true
        });
        const sampleShifted = preview.sessions.filter(s => s.sessionNumber > num).slice(0, 4);
        cascadePreviewBox.append(
          el('strong', {text: `Buổi ${num} đổi từ ${formatSessionDateVi(oldDate, {includeWeekday: false})} sang ${formatSessionDateVi(newDate)} → Tự động lùi ${preview.shiftedCount} buổi tiếp theo:`}),
          el('div', {class: 'session-cascade-list'},
            ...sampleShifted.map(s => {
              const orig = allSessions.find(o => o.sessionNumber === s.sessionNumber);
              return el('p', {
                class: 'meta',
                text: `• Buổi ${s.sessionNumber}${s.lessonName ? ` (${s.lessonName})` : ''}: ${formatSessionDateVi(orig?.date, {includeWeekday: false})} ➔ ${formatSessionDateVi(s.date, {includeWeekday: true, start: s.start, end: s.end})}`
              });
            }),
            preview.shiftedCount > 4
              ? el('p', {class: 'meta', text: `• ... và ${preview.shiftedCount - 4} buổi tiếp theo (đến Buổi ${allSessions.length}) tự động lùi tương ứng.`})
              : null
          )
        );
      } catch {
        cascadePreviewBox.hidden = true;
      }
    } else {
      cascadePreviewBox.append(
        el('p', {
          class: 'meta',
          text: `Chỉ đổi ngày riêng cho Buổi ${num} sang ${formatSessionDateVi(newDate)}. Lịch của các buổi từ Buổi ${num + 1} trở đi được giữ nguyên.`
        })
      );
    }
  }

  dateField.input.addEventListener('change', updateCascadePreview);
  dateField.input.addEventListener('input', updateCascadePreview);

  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const submit = el('button', {type: 'submit', class: 'primary wide', text: `Lưu thông tin Buổi ${num}`});
  const f = el('form', {},
    error,
    nameField.label,
    topicField.label,
    dateField.label,
    el('div', {class: 'form-grid-2'}, startField.label, endField.label),
    cascadeOptionWrap,
    submit
  );

  f.onsubmit = async event => {
    event.preventDefault();
    if (!validateFormFields(f, error)) return;
    submit.disabled = true;
    error.hidden = true;
    try {
      const res = await api(`/api/classes/${classId}/sessions`, {
        method: 'POST',
        body: {
          action: 'update_session',
          sessionNumber: num,
          lessonName: nameField.input.value.trim(),
          cleanTopic: topicField.input.value.trim(),
          date: dateField.input.value,
          start: startField.input.value,
          end: endField.input.value,
          cascade: hasLaterSessions ? cascadeCheck.checked : false
        }
      });
      $('editor').close();
      if (typeof onSaved === 'function') await onSaved(res);
      status(
        res.cascaded
          ? `Đã cập nhật Buổi ${num} (${formatSessionDateVi(res.newDate, {includeWeekday: false})}) và tự động lùi lịch ${res.shiftedCount} buổi học tiếp theo.`
          : `Đã lưu thông tin Buổi ${num}.`,
        false,
        'success'
      );
    } catch (e) {
      error.textContent = friendly(e);
      error.hidden = false;
      error.focus();
    } finally {
      submit.disabled = false;
    }
  };

  const sessionDateBadge = session.formattedDate || session.date || session.sessionDate || '';
  modal(sessionDateBadge ? `Cập nhật Buổi ${num} · ${sessionDateBadge}` : `Cập nhật Buổi ${num}`, f);
}

function openCreateSessionModal(classId, allSessions = [], onCreated = null) {
  const existingNums = new Set((allSessions || []).map(s => Number(s.sessionNumber)).filter(Boolean));
  const nextNum = allSessions.length ? Math.max(...existingNums) + 1 : 1;
  const scheduleSlots = workspace?.class?.schedule_slots || [];
  const todayIso = new Date().toLocaleDateString('en-CA');
  const lastDate = allSessions.at(-1)?.date;
  const anchorDate = lastDate ? addIsoDays(lastDate, 1) : todayIso;
  const defaultSlot = generateScheduleDates({scheduleSlots, startDate: anchorDate, count: 1})[0] || {
    date: anchorDate,
    start: '18:00',
    end: '20:00'
  };

  const numField = field('sessionNumber', 'Số thứ tự buổi học', 'number', String(nextNum), {
    min: 1,
    max: 200,
    step: 1
  });
  const nameField = field('lessonName', 'Tên buổi học / Bài dạy', 'text', '', {
    required: true,
    maxLength: 180,
    placeholder: 'VD: Tính đơn điệu và cực trị của hàm số'
  });
  const topicField = field('cleanTopic', 'Chuyên đề / Chương Toán (tuỳ chọn)', 'text', '', {
    required: false,
    maxLength: 120,
    placeholder: 'VD: Giải tích 12 - Chương 1'
  });
  const dateField = field('date', 'Ngày học', 'date', defaultSlot.date || todayIso);
  const startField = field('start', 'Giờ bắt đầu', 'time', defaultSlot.start || '18:00', {required: false});
  const endField = field('end', 'Giờ kết thúc', 'time', defaultSlot.end || '20:00', {required: false});

  const driveBanner = el(
    'div',
    {class: 'notice session-modal-banner'},
    el('strong', {text: 'Liên kết tự động với Google Drive'}),
    el('p', {
      class: 'meta',
      text: 'Khi nhấn Tạo buổi học, hệ thống tự động tạo thư mục riêng của buổi này trong thư mục lớp trên Google Drive để lưu chung video bài giảng, tài liệu và đề bài tập.'
    })
  );

  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const submit = el('button', {type: 'submit', class: 'primary wide', text: 'Tạo buổi học & Thư mục Drive'});
  const f = el(
    'form',
    {},
    error,
    driveBanner,
    numField.label,
    nameField.label,
    topicField.label,
    dateField.label,
    el('div', {class: 'form-grid-2'}, startField.label, endField.label),
    submit
  );

  f.onsubmit = async event => {
    event.preventDefault();
    if (!validateFormFields(f, error)) return;
    const chosenNum = Number(numField.input.value);
    if (!Number.isInteger(chosenNum) || chosenNum < 1 || chosenNum > 200) {
      error.textContent = 'Số thứ tự buổi học phải từ 1 đến 200.';
      error.hidden = false;
      numField.input.focus();
      return;
    }
    if (existingNums.has(chosenNum)) {
      error.textContent = `Buổi ${chosenNum} đã tồn tại. Vui lòng chọn số buổi khác.`;
      error.hidden = false;
      numField.input.focus();
      return;
    }
    submit.disabled = true;
    error.hidden = true;
    try {
      const res = await api(`/api/classes/${classId}/sessions`, {
        method: 'POST',
        body: {
          action: 'add_session',
          sessionNumber: chosenNum,
          lessonName: nameField.input.value.trim(),
          cleanTopic: topicField.input.value.trim(),
          date: dateField.input.value,
          start: startField.input.value,
          end: endField.input.value
        }
      });
      invalidateClassSessionsCatalogCache(classId);
      $('editor').close();
      if (typeof onCreated === 'function') await onCreated(res.session, res);
      status(
        res.driveSynced
          ? `Đã tạo Buổi ${chosenNum} và khởi tạo thư mục trên Google Drive.`
          : `Đã tạo Buổi ${chosenNum}.`,
        false,
        'success'
      );
    } catch (e) {
      error.textContent = friendly(e);
      error.hidden = false;
      error.focus();
    } finally {
      submit.disabled = false;
    }
  };

  modal('Tạo buổi học mới', f);
}

function confirmDeleteSession(classId, session, onDeleted = null) {
  const num = session.sessionNumber;
  const titleText = session.lessonName ? `Buổi ${num}: ${session.lessonName}` : `Buổi ${num}`;
  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const confirmBtn = el('button', {
    type: 'button',
    class: 'danger wide',
    text: 'Xóa buổi học & Thư mục Drive',
    onclick: async () => {
      confirmBtn.disabled = true;
      error.hidden = true;
      try {
        await api(`/api/classes/${classId}/sessions`, {
          method: 'POST',
          body: {action: 'delete_session', sessionNumber: num}
        });
        invalidateClassSessionsCatalogCache(classId);
        $('editor').close();
        if (typeof onDeleted === 'function') await onDeleted();
        status(`Đã xóa ${titleText} và chuyển thư mục Google Drive vào thùng rác.`, false, 'success');
      } catch (e) {
        error.textContent = friendly(e);
        error.hidden = false;
      } finally {
        confirmBtn.disabled = false;
      }
    }
  });
  const box = el(
    'div',
    {class: 'session-delete-confirm-box'},
    error,
    el('div', {class: 'notice session-modal-banner'},
      el('strong', {text: titleText}),
      el('p', {
        class: 'meta',
        text: 'Thao tác này sẽ chuyển thư mục Google Drive của buổi học cùng toàn bộ video bài giảng, tài liệu và đề BTVN bên trong vào thùng rác, đồng thời lưu trữ đợt nộp bài gắn với buổi này.'
      })
    ),
    confirmBtn
  );
  modal(`Xóa ${titleText}`, box);
}

function confirmDeleteSessionFile(classId, session, file, onDeleted = null) {
  const fileNameText = file?.name || 'Tệp đính kèm';
  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const confirmBtn = el('button', {
    type: 'button',
    class: 'danger wide',
    text: 'Xóa tệp & chuyển vào thùng rác Drive',
    onclick: async () => {
      confirmBtn.disabled = true;
      error.hidden = true;
      try {
        await api(`/api/classes/${classId}/sessions`, {
          method: 'POST',
          body: {action: 'delete_file', fileId: file.id}
        });
        invalidateClassSessionsCatalogCache(classId);
        $('editor').close();
        if (typeof onDeleted === 'function') await onDeleted();
        status(`Đã xóa tệp "${fileNameText}" khỏi buổi học và Google Drive.`, false, 'success');
      } catch (e) {
        error.textContent = friendly(e);
        error.hidden = false;
      } finally {
        confirmBtn.disabled = false;
      }
    }
  });
  const box = el(
    'div',
    {class: 'session-delete-confirm-box'},
    error,
    el('div', {class: 'notice session-modal-banner'},
      el('strong', {text: fileNameText}),
      el('p', {
        class: 'meta',
        text: `Tệp sẽ bị gỡ khỏi Buổi ${session.sessionNumber} trên website và chuyển vào thùng rác trên Google Drive.`
      })
    ),
    confirmBtn
  );
  modal('Xóa tệp khỏi buổi học', box);
}

function createSessionPickerField(allSessions = []) {
  const list = Array.isArray(allSessions) ? allSessions : [];
  const nextNewNum = list.length ? Math.max(...list.map(s => Number(s.sessionNumber) || 0)) + 1 : 1;
  const nearest = findNearestScheduledSession(list);
  const defaultNum = nearest ? nearest.sessionNumber : nextNewNum;
  const items = [
    ...list.map(s => ({
      value: String(s.sessionNumber),
      label: `Buổi ${s.sessionNumber}${s.lessonName ? `: ${s.lessonName}` : ''} (${formatSessionDateVi(s.date, {includeWeekday: true})})`
    })),
    {
      value: String(nextNewNum),
      label: `+ Tạo mới Buổi ${nextNewNum} (tự khởi tạo thư mục Drive)`
    }
  ];
  return field('sessionNumber', 'Chọn Buổi học (lưu vào thư mục Google Drive tương ứng)', 'select', String(defaultNum), {
    items
  });
}

function buildDriveTreePreviewCard(classNameText) {
  return el(
    'div',
    {class: 'drive-structure-preview-card session-grid-card'},
    el(
      'div',
      {class: 'drive-preview-head'},
      mediaIcon('folder') || icon('material'),
      el('h3', {class: 'materials-panel-title', text: 'Cấu trúc đồng bộ Google Drive'})
    ),
    el('p', {
      class: 'meta',
      text: 'Mỗi buổi học tạo trên website tương ứng 1 thư mục riêng trong lớp trên Google Drive:'
    }),
    el(
      'div',
      {class: 'drive-tree-list'},
      el('div', {class: 'drive-tree-node is-root'}, el('strong', {text: 'Lớp Toán cô Hạnh'})),
      el('div', {class: 'drive-tree-node is-class'}, el('strong', {text: classNameText || 'Thư mục lớp học'})),
      el(
        'div',
        {class: 'drive-tree-node is-session'},
        el('strong', {text: 'Buổi 1, Buổi 2…'}),
        el('span', {class: 'meta', text: 'Lưu chung Video bài giảng, Tài liệu PDF & Đề BTVN'})
      )
    )
  );
}

function buildCustomUploadFileName(customTitle, originalFileName, index = 0, total = 1) {
  const clean = String(customTitle || '').trim();
  const orig = String(originalFileName || 'tai-lieu').trim();
  if (!clean) return orig;
  const extMatch = /(\.[A-Za-z0-9]{1,10})$/.exec(orig);
  const ext = extMatch ? extMatch[1] : '';
  const baseWithoutExt = ext && clean.toLowerCase().endsWith(ext.toLowerCase())
    ? clean.slice(0, clean.length - ext.length).trim()
    : clean;
  const numbered = total > 1 ? `${baseWithoutExt} (${index + 1})` : baseWithoutExt;
  return `${numbered}${ext}`;
}

const MAX_DOCUMENT_UPLOAD_BYTES = 100 * 1024 * 1024;
const DIRECT_DRIVE_CHUNK_BYTES = 16 * 1024 * 1024;

function putChunkDirectToDrive({sessionUrl, contentType, offset, end, totalSize, blob, onByteProgress}) {
  if (typeof XMLHttpRequest !== 'function') {
    return fetch(sessionUrl, {
      method: 'PUT',
      headers: {
        'content-type': contentType || 'application/octet-stream',
        'content-range': `bytes ${offset}-${end - 1}/${totalSize}`
      },
      body: blob,
      mode: 'cors',
      credentials: 'omit'
    }).then(res => ({status: res.status, rangeHeader: res.headers.get('range') || ''}));
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastEmitAt = 0;
    xhr.open('PUT', sessionUrl, true);
    xhr.withCredentials = false;
    xhr.timeout = 180000;
    xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
    xhr.setRequestHeader('Content-Range', `bytes ${offset}-${end - 1}/${totalSize}`);
    if (xhr.upload && typeof onByteProgress === 'function') {
      xhr.upload.onprogress = ev => {
        if (!ev.lengthComputable) return;
        const now = Date.now();
        if (now - lastEmitAt < 120 && ev.loaded < ev.total) return;
        lastEmitAt = now;
        onByteProgress(Math.min(end, offset + ev.loaded));
      };
    }
    xhr.onload = () => {
      let rangeHeader = '';
      try {
        rangeHeader = xhr.getResponseHeader('range') || '';
      } catch {}
      resolve({status: xhr.status, rangeHeader});
    };
    xhr.onerror = () => reject(Error('Lỗi kết nối khi truyền trực tiếp lên Google Drive.'));
    xhr.ontimeout = () => reject(Error('Hết thời gian chờ đoạn tải lên Google Drive.'));
    xhr.onabort = () => reject(Error('Luồng tải lên Google Drive đã bị ngắt.'));
    xhr.send(blob);
  });
}

async function uploadLessonDocumentFile({
  classId,
  lessonId,
  file,
  retry,
  onProgress,
  filesBasePath = null,
  fileKind = 'document',
  assignmentId = null
}) {
  const basePath = resolveItemFilesBasePath(classId, lessonId, filesBasePath);
  if (file.size <= 10_000_000) {
    const body = new FormData();
    body.set('file', file);
    body.set('requestId', retry.requestId);
    if (fileKind) body.set('fileKind', fileKind);
    if (assignmentId) body.set('assignmentId', assignmentId);
    const res = await api(basePath, {method: 'POST', body});
    return res?.id || null;
  }
  const sha256 = await computeVideoFingerprint(file);
  const docType = String(file.type || '').trim() || 'application/octet-stream';
  const startRes = await api(basePath, {
    method: 'POST',
    body: {
      mode: 'resumable',
      isVideoLecture: false,
      fileKind,
      ...(assignmentId ? {assignmentId} : {}),
      name: file.name,
      contentType: docType,
      size: file.size,
      sha256,
      requestId: retry.requestId
    }
  });
  const serverChunkSize = startRes.chunkSize || 8 * 1024 * 1024;
  const sessionUrl = typeof startRes.sessionUrl === 'string' && startRes.sessionUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files')
    ? startRes.sessionUrl
    : null;
  let directDisabled = !sessionUrl;
  const totalSize = file.size;
  let offset = startRes.state === 'uploaded' ? totalSize : 0;
  let finalized = startRes.state === 'uploaded';
  const chunkPath = `${basePath}/${startRes.id}/chunks`;

  while (offset < totalSize) {
    const stepSize = !directDisabled && sessionUrl ? DIRECT_DRIVE_CHUNK_BYTES : serverChunkSize;
    const end = Math.min(offset + stepSize, totalSize);
    const chunkBlob = file.slice(offset, end, 'application/octet-stream');
    const pct = Math.min(99, Math.round((offset / totalSize) * 100));
    if (onProgress) onProgress(pct);

    if (!directDisabled && sessionUrl) {
      try {
        const directRes = await putChunkDirectToDrive({
          sessionUrl,
          contentType: docType,
          offset,
          end,
          totalSize,
          blob: chunkBlob,
          onByteProgress: loadedAbs => {
            if (onProgress) onProgress(Math.min(99, Math.round((loadedAbs / totalSize) * 100)));
          }
        });
        if (directRes.status === 308) {
          const m = /^bytes=0-(\d+)$/i.exec(directRes.rangeHeader || '');
          const confirmed = m ? Number(m[1]) + 1 : end;
          offset = confirmed > offset ? confirmed : end;
          continue;
        }
        if (directRes.status === 200 || directRes.status === 201) {
          offset = totalSize;
          break;
        }
        if (offset === 0) directDisabled = true;
        else throw Error('Phản hồi từ Google Drive không hợp lệ.');
      } catch (err) {
        if (offset === 0) directDisabled = true;
        else throw err;
      }
    }

    const fallbackEnd = Math.min(offset + serverChunkSize, totalSize);
    const fallbackBlob = fallbackEnd === end ? chunkBlob : file.slice(offset, fallbackEnd, 'application/octet-stream');
    const qs = `?offset=${offset}&uploadToken=${encodeURIComponent(startRes.uploadToken)}`;
    const chunkRes = await api(`${chunkPath}${qs}`, {method: 'POST', body: fallbackBlob, raw: true, timeoutMs: 120000});
    if (chunkRes.state === 'uploaded') {
      offset = totalSize;
      finalized = true;
      break;
    }
    const nextOffset = Number.isSafeInteger(chunkRes.offset) ? chunkRes.offset : fallbackEnd;
    if (nextOffset <= offset) throw Error('Máy chủ chưa xác nhận được tiến độ đoạn dữ liệu vừa gửi.');
    offset = nextOffset;
  }
  if (!finalized) {
    const qs = `?status=1&uploadToken=${encodeURIComponent(startRes.uploadToken)}`;
    const finRes = await api(`${chunkPath}${qs}`, {method: 'POST', timeoutMs: 45000});
    if (!finRes || finRes.state !== 'uploaded') {
      throw Error('Chưa thể hoàn tất lưu tệp trên máy chủ. Vui lòng thử lại.');
    }
  }
  return startRes.id || null;
}

async function uploadDriveDocumentBatch({
  classId,
  lessonId,
  entries,
  customTitle = '',
  notice,
  fileLabel = 'tệp',
  filesBasePath = null,
  fileKind = 'document'
}) {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.done) continue;
    const uploadFileName = buildCustomUploadFileName(customTitle, entry.file.name, i, entries.length);
    const uploadFileObj = uploadFileName !== entry.file.name
      ? new File([entry.file], uploadFileName, {type: entry.file.type || 'application/octet-stream', lastModified: entry.file.lastModified})
      : entry.file;
    notice.textContent = `Đang chuẩn bị ${fileLabel} ${i + 1}/${entries.length}: ${uploadFileObj.name}`;
    entry.retry ??= await lessonUploadRetry.prepare({
      uid: auth.currentUser?.uid || me?.uid || 'staff',
      classId,
      lessonId,
      file: uploadFileObj
    });
    notice.textContent = `Đang tải ${fileLabel} ${i + 1}/${entries.length}: ${uploadFileObj.name}`;
    await uploadLessonDocumentFile({
      classId,
      lessonId,
      file: uploadFileObj,
      retry: entry.retry,
      filesBasePath,
      fileKind,
      onProgress: pct => {
        notice.textContent = `Đang tải ${fileLabel} ${i + 1}/${entries.length}: ${uploadFileObj.name} (${pct}%)…`;
      }
    });
    entry.done = true;
    lessonUploadRetry.complete(entry.retry.key);
  }
}

function lessonFileSetCreatorModal(classId, onSaved, {session = null, allSessions = []} = {}) {
  let entries = [];
  let ensuredLesson = null;

  const sessionSelectField = !session ? createSessionPickerField(allSessions) : null;

  const activeSession = () => {
    if (session) return session;
    const chosenNum = Number(sessionSelectField?.input.value || 1);
    return allSessions.find(s => s.sessionNumber === chosenNum) || {sessionNumber: chosenNum, lessonName: '', cleanTopic: '', date: ''};
  };

  const titleField = field('title', 'Tên tài liệu hiển thị (khác với tên buổi học; để trống nếu giữ tên tệp gốc)', 'text', '', {
    required: false,
    maxLength: 180,
    placeholder: 'VD: Phiếu lý thuyết & Bài tập tự luyện Hàm số'
  });
  const topicField = field('topic', 'Chuyên đề Toán (tuỳ chọn)', 'text', session?.cleanTopic || '', {
    required: false,
    maxLength: 120,
    placeholder: 'VD: Giải tích 12'
  });
  const picker = field('files', 'Chọn tệp Tài liệu (mỗi tệp tối đa 100 MB)', 'file', '', {
    required: true,
    multiple: true
  });

  if (sessionSelectField) {
    sessionSelectField.input.addEventListener('change', () => {
      const cur = activeSession();
      if (!topicField.input.value.trim() && cur.cleanTopic) topicField.input.value = cur.cleanTopic;
    });
  }

  const sessionBanner = session
    ? el('div', {class: 'notice session-modal-banner'},
        el('strong', {text: `Buổi ${session.sessionNumber}${session.lessonName ? `: ${session.lessonName}` : ''} · ${session.formattedDate}`}),
        el('p', {class: 'meta', text: 'Tên tài liệu đặt ở dưới là tên riêng của tệp tài liệu, độc lập với tên buổi học.'})
      )
    : null;

  const notice = el('p', {
    class: 'meta',
    role: 'status',
    'aria-live': 'polite',
    text: 'Hỗ trợ PDF, Word, Excel, Ảnh và các định dạng tài liệu học tập.'
  });
  const sharing = el('p', {
    class: 'meta',
    text: 'Tài liệu được bảo mật nội bộ trong lớp học, hạn chế chia sẻ liên kết ra ngoài.'
  });
  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const submit = el('button', {type: 'submit', class: 'primary wide', text: 'Lưu tài liệu'});
  const f = el('form', {},
    error,
    sessionBanner,
    sessionSelectField ? sessionSelectField.label : null,
    titleField.label,
    topicField.label,
    picker.label,
    notice,
    sharing,
    submit
  );
  picker.input.addEventListener('change', () => {
    entries = [...picker.input.files].map(file => ({file, done: false}));
    error.hidden = true;
    notice.textContent = entries.length
      ? `Đã chọn ${entries.length} tệp đính kèm.`
      : 'Hỗ trợ PDF, Word, Excel, Ảnh và các định dạng tài liệu học tập.';
  });
  f.onsubmit = async event => {
    event.preventDefault();
    if (!validateFormFields(f, error)) return;
    submit.disabled = true;
    titleField.input.disabled = true;
    topicField.input.disabled = true;
    if (sessionSelectField) sessionSelectField.input.disabled = true;
    picker.input.disabled = true;
    error.hidden = true;
    try {
      if (!entries.length || entries.some(entry => !entry.file.size || entry.file.size > MAX_DOCUMENT_UPLOAD_BYTES)) {
        throw Error('Vui lòng chọn ít nhất một tệp có dữ liệu, mỗi tệp tối đa 100 MB.');
      }
      const customDocTitle = titleField.input.value.trim();
      const cleanTopicVal = topicField.input.value.trim();
      if (!ensuredLesson) {
        const targetSess = activeSession();
        if (targetSess?.sessionNumber) {
          const ensured = await api(`/api/classes/${classId}/sessions`, {
            method: 'POST',
            body: {
              action: 'ensure_session',
              sessionNumber: targetSess.sessionNumber,
              ...(cleanTopicVal ? {cleanTopic: cleanTopicVal} : {})
            }
          });
          ensuredLesson = {id: ensured.session.lessonId, title: ensured.session.title};
        } else {
          const res = await api(`/api/classes/${classId}/lessons`, {
            method: 'POST',
            body: {
              title: customDocTitle || 'Tài liệu học tập',
              topic: cleanTopicVal
            }
          });
          ensuredLesson = {id: res.id, title: customDocTitle || 'Tài liệu học tập'};
        }
      }
      await uploadDriveDocumentBatch({
        classId,
        lessonId: ensuredLesson.id,
        entries,
        customTitle: customDocTitle,
        notice,
        fileLabel: 'tệp'
      });
      $('editor').close();
      await onSaved();
      status('Đã lưu Tài liệu vào buổi học.', false, 'success');
    } catch (e) {
      error.textContent = friendly(e);
      error.hidden = false;
      error.focus();
    } finally {
      submit.disabled = false;
      if (!ensuredLesson) {
        titleField.input.disabled = false;
        topicField.input.disabled = false;
        if (sessionSelectField) sessionSelectField.input.disabled = false;
      }
      picker.input.disabled = false;
    }
  };
  modal(session ? `Tải Tài liệu · Buổi ${session.sessionNumber}` : 'Tải Tài liệu vào Buổi học', f);
}

function sessionHomeworkUploadModal(classId, onSaved, {session = null, allSessions = [], existingAssignment = null} = {}) {
  let entries = [];
  let ensuredLesson = null;

  const sessionSelectField = !session ? createSessionPickerField(allSessions) : null;

  const activeSession = () => {
    if (session) return session;
    const chosenNum = Number(sessionSelectField?.input.value || 1);
    return allSessions.find(s => s.sessionNumber === chosenNum) || {sessionNumber: chosenNum, lessonName: '', cleanTopic: '', date: ''};
  };

  const start = existingAssignment?.opens_at || Date.now();
  const end = existingAssignment?.closes_at || start + 7 * 86400000;
  const curSess = activeSession();
  const defaultHwTitle = existingAssignment?.title || (curSess?.lessonName
    ? `BTVN Buổi ${curSess.sessionNumber}: ${curSess.lessonName}`
    : `Bài tập về nhà Buổi ${curSess?.sessionNumber || 1}`);

  const titleField = field('title', 'Tên phiếu bài tập / tiêu đề BTVN', 'text', defaultHwTitle, {
    required: false,
    maxLength: 180,
    placeholder: 'VD: Phiếu bài tập tự luyện Hàm số - Buổi 1'
  });
  const picker = field('files', 'Đề bài tập đính kèm (PDF, Word, Ảnh… tối đa 100 MB/tệp)', 'file', '', {
    required: false,
    multiple: true
  });
  const instructionsField = field('instructions', 'Hướng dẫn / Ghi chú giao bài tập', 'textarea', existingAssignment?.cleanInstructions || '', {
    required: false,
    max: 5000,
    placeholder: 'VD: Học sinh làm các bài 1, 2, 4 trang 2 in trong file đính kèm và chụp ảnh nộp bài trước buổi học tiếp theo...'
  });
  const opensAtField = field('opensAt', 'Mở nhận bài nộp từ', 'datetime-local', localTime(start), {required: true});
  const closesAtField = field('closesAt', 'Hạn chót nộp bài', 'datetime-local', localTime(end), {required: true});

  if (sessionSelectField) {
    sessionSelectField.input.addEventListener('change', () => {
      const s = activeSession();
      if (!existingAssignment) {
        titleField.input.value = s.lessonName
          ? `BTVN Buổi ${s.sessionNumber}: ${s.lessonName}`
          : `Bài tập về nhà Buổi ${s.sessionNumber}`;
      }
    });
  }

  const sessionBanner = session
    ? el('div', {class: 'notice session-modal-banner'},
        el('strong', {text: `Buổi ${session.sessionNumber}${session.lessonName ? `: ${session.lessonName}` : ''} · ${session.formattedDate || formatSessionDateVi(session.date)}`}),
        el('p', {class: 'meta', text: 'Đề bài và hướng dẫn làm bài sẽ hiển thị trực tiếp cho học sinh trong buổi học này.'})
      )
    : null;

  const notice = el('p', {
    class: 'meta',
    role: 'status',
    'aria-live': 'polite',
    text: 'Có thể đính kèm tệp đề bài tập đồng thời ghi chú hướng dẫn và hạn nộp bài cho học sinh.'
  });
  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const submit = el('button', {type: 'submit', class: 'primary wide', text: 'Lưu bài tập'});
  const f = el('form', {},
    error,
    sessionBanner,
    sessionSelectField ? sessionSelectField.label : null,
    titleField.label,
    picker.label,
    instructionsField.label,
    el('div', {class: 'form-grid-2'}, opensAtField.label, closesAtField.label),
    notice,
    submit
  );

  picker.input.addEventListener('change', () => {
    entries = [...picker.input.files].map(file => ({file, done: false}));
    error.hidden = true;
    notice.textContent = entries.length
      ? `Đã chọn ${entries.length} tệp đề bài tập đính kèm.`
      : 'Có thể đính kèm tệp đề bài tập đồng thời ghi chú hướng dẫn và hạn nộp bài cho học sinh.';
  });

  f.onsubmit = async event => {
    event.preventDefault();
    if (!validateFormFields(f, error)) return;
    const customTitle = titleField.input.value.trim();
    const cleanInstructions = instructionsField.input.value.trim();

    if (!entries.length && !cleanInstructions && !customTitle) {
      error.textContent = 'Vui lòng chọn tệp bài tập tải lên Drive hoặc nhập chú thích hướng dẫn làm bài.';
      error.hidden = false;
      error.focus();
      return;
    }
    if (entries.some(entry => !entry.file.size || entry.file.size > MAX_DOCUMENT_UPLOAD_BYTES)) {
      error.textContent = 'Mỗi tệp bài tập đính kèm tối đa 100 MB và phải có dữ liệu.';
      error.hidden = false;
      error.focus();
      return;
    }

    submit.disabled = true;
    titleField.input.disabled = true;
    instructionsField.input.disabled = true;
    opensAtField.input.disabled = true;
    closesAtField.input.disabled = true;
    if (sessionSelectField) sessionSelectField.input.disabled = true;
    picker.input.disabled = true;
    error.hidden = true;

    try {
      const targetSess = activeSession();
      const chosenNum = Number(targetSess?.sessionNumber) || 1;
      if (!ensuredLesson) {
        const ensured = await api(`/api/classes/${classId}/sessions`, {
          method: 'POST',
          body: {
            action: 'ensure_session',
            sessionNumber: chosenNum
          }
        });
        ensuredLesson = {id: ensured.session.lessonId, title: ensured.session.title};
      }

      const effectiveTitle = customTitle || (targetSess?.lessonName
        ? `BTVN Buổi ${chosenNum}: ${targetSess.lessonName}`
        : `Bài tập về nhà Buổi ${chosenNum}`);
      const opensAtTs = new Date(opensAtField.input.value).getTime();
      const closesAtTs = new Date(closesAtField.input.value).getTime();
      const existingFileIds = Array.isArray(existingAssignment?.fileIds) ? existingAssignment.fileIds : [];
      let targetAssignmentId = existingAssignment?.id || null;

      if (!targetAssignmentId) {
        notice.textContent = 'Đang tạo bài tập và thư mục con trên Google Drive…';
        const created = await api(`/api/classes/${classId}/assignments`, {
          method: 'POST',
          body: {
            title: effectiveTitle,
            instructions: encodeAssignmentSessionInstructions({
              sessionNumber: chosenNum,
              lessonId: ensuredLesson.id,
              fileIds: existingFileIds,
              cleanInstructions
            }),
            opensAt: opensAtTs,
            closesAt: closesAtTs
          }
        });
        targetAssignmentId = created?.id || null;
      }

      const uploadedFileIds = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.done) continue;
        const baseFileName = buildCustomUploadFileName(customTitle, entry.file.name, i, entries.length);
        const hwPrefixedName = /^(?:__ltch_hw__|\[BTVN\]\s*)/i.test(baseFileName)
          ? baseFileName
          : `[BTVN] ${baseFileName}`;
        const uploadFileObj = new File([entry.file], hwPrefixedName, {
          type: entry.file.type || 'application/octet-stream',
          lastModified: entry.file.lastModified
        });
        notice.textContent = `Đang chuẩn bị tệp bài tập ${i + 1}/${entries.length}: ${baseFileName}`;
        entry.retry ??= await lessonUploadRetry.prepare({
          uid: auth.currentUser?.uid || me?.uid || 'staff',
          classId,
          lessonId: ensuredLesson.id,
          file: uploadFileObj
        });
        notice.textContent = `Đang tải tệp bài tập ${i + 1}/${entries.length} lên thư mục bài tập trên Drive…`;
        const fileId = await uploadLessonDocumentFile({
          classId,
          lessonId: ensuredLesson.id,
          assignmentId: targetAssignmentId,
          file: uploadFileObj,
          retry: entry.retry,
          onProgress: pct => {
            notice.textContent = `Đang tải tệp bài tập ${i + 1}/${entries.length} lên Google Drive (${pct}%)…`;
          }
        });
        if (fileId) uploadedFileIds.push(fileId);
        entry.done = true;
        lessonUploadRetry.complete(entry.retry.key);
      }

      const mergedFileIds = [...new Set([...existingFileIds, ...uploadedFileIds])];
      if (targetAssignmentId && (existingAssignment?.id || uploadedFileIds.length > 0)) {
        notice.textContent = 'Đang lưu ghi chú và thời hạn nộp bài…';
        await api(`/api/classes/${classId}/assignments/${targetAssignmentId}`, {
          method: 'POST',
          body: {
            title: effectiveTitle,
            instructions: encodeAssignmentSessionInstructions({
              sessionNumber: chosenNum,
              lessonId: ensuredLesson.id,
              fileIds: mergedFileIds,
              cleanInstructions
            }),
            opensAt: opensAtTs,
            closesAt: closesAtTs,
            status: existingAssignment?.status || 'published'
          }
        });
      }

      $('editor').close();
      await onSaved();
      status('Đã lưu bài tập vào thư mục Google Drive của buổi học.', false, 'success');
    } catch (e) {
      error.textContent = friendly(e);
      error.hidden = false;
      error.focus();
    } finally {
      submit.disabled = false;
      titleField.input.disabled = false;
      instructionsField.input.disabled = false;
      opensAtField.input.disabled = false;
      closesAtField.input.disabled = false;
      if (sessionSelectField) sessionSelectField.input.disabled = false;
      picker.input.disabled = false;
    }
  };

  modal(session ? `Tải Bài tập & Ghi chú · Buổi ${session.sessionNumber}` : 'Tải Bài tập & Ghi chú theo Buổi học', f);
}

function inferVideoMimeType(file) {
  const raw = String(file?.type || '').trim().toLowerCase();
  if (/^video\/[a-z0-9.+-]+$/.test(raw)) return raw;
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.mov')) return 'video/quicktime';
  if (name.endsWith('.mkv')) return 'video/x-matroska';
  if (name.endsWith('.avi')) return 'video/x-msvideo';
  return 'video/mp4';
}

async function computeVideoFingerprint(file) {
  const sliceBytes = new Uint8Array(await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer());
  const metaBytes = new TextEncoder().encode(`|size:${file.size}|name:${file.name}`);
  const combined = new Uint8Array(sliceBytes.byteLength + metaBytes.byteLength);
  combined.set(sliceBytes, 0);
  combined.set(metaBytes, sliceBytes.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', combined);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function uploadDriveVideoResumable({
  classId,
  lessonId,
  file,
  cleanTitle = '',
  progressBar,
  progressLabel,
  uploadState = {session: null},
  finalizingText = 'Đã tải 100% dữ liệu lên Google Drive! Đang xác thực và gắn video…',
  completedText = 'Đã tải xong 100%! Đang hoàn tất liên kết…',
  filesBasePath = null,
  fileKind = 'video'
}) {
  const basePath = resolveItemFilesBasePath(classId, lessonId, filesBasePath);
  if (!uploadState.session) {
    const sha256 = await computeVideoFingerprint(file);
    const uploadVideoName = buildCustomUploadFileName(cleanTitle, file.name, 0, 1);
    const retry = await lessonUploadRetry.prepare({
      uid: auth.currentUser?.uid || me?.uid || 'staff',
      classId,
      lessonId,
      file,
      fingerprint: sha256
    });
    const freshRequestId = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : retry.requestId;
    const videoType = inferVideoMimeType(file);
    const startRes = await api(basePath, {
      method: 'POST',
      body: {
        mode: 'resumable',
        isVideoLecture: true,
        fileKind,
        name: uploadVideoName,
        contentType: videoType,
        size: file.size,
        sha256,
        requestId: freshRequestId
      }
    });
    uploadState.session = {
      fileId: startRes.id,
      uploadToken: startRes.uploadToken,
      sessionUrl: typeof startRes.sessionUrl === 'string' && startRes.sessionUrl.startsWith('https://www.googleapis.com/upload/drive/v3/files') ? startRes.sessionUrl : null,
      hasBinaryEndpoint: Boolean(startRes.sessionUrl),
      directDisabled: false,
      videoType,
      chunkSize: startRes.chunkSize || 8 * 1024 * 1024,
      totalSize: file.size,
      offset: startRes.state === 'uploaded' ? file.size : 0,
      finalizedOnServer: startRes.state === 'uploaded',
      retryKey: retry.key
    };
  }

  let uploadSession = uploadState.session;
  const chunkPath = `${basePath}/${uploadSession.fileId}/chunks`;
  const maxChunkRetries = 6;
  let unchangedAttempts = 0;
  let chunksSentInRun = 0;
  const pauseUpload = ms => new Promise(resolve => setTimeout(resolve, ms));
  const rotateWorkerIsolates = () => {
    for (let i = 0; i < 3; i++) {
      fetch(`${apiBase}/api/health`, {mode: 'cors', credentials: 'omit', cache: 'no-store'}).catch(() => null);
    }
  };
  const queryServerStatus = async () => {
    if (uploadSession.hasBinaryEndpoint) {
      const qs = `?status=1&uploadToken=${encodeURIComponent(uploadSession.uploadToken)}`;
      return api(`${chunkPath}${qs}`, {method: 'POST', timeoutMs: 45000});
    }
    const statusFd = new FormData();
    statusFd.set('uploadToken', uploadSession.uploadToken);
    statusFd.set('status', '1');
    return api(chunkPath, {method: 'POST', body: statusFd, timeoutMs: 45000});
  };

  while (uploadSession.offset < uploadSession.totalSize) {
    const prevOffset = uploadSession.offset;
    const isDirect = Boolean(uploadSession.sessionUrl && !uploadSession.directDisabled);
    const activeChunkSize = isDirect ? Math.max(uploadSession.chunkSize, DIRECT_DRIVE_CHUNK_BYTES) : uploadSession.chunkSize;
    const totalChunks = Math.max(1, Math.ceil(uploadSession.totalSize / activeChunkSize));
    const end = Math.min(prevOffset + activeChunkSize, uploadSession.totalSize);
    const chunkBlob = file.slice(prevOffset, end, 'application/octet-stream');
    const currentChunkIndex = Math.min(totalChunks, Math.floor(prevOffset / activeChunkSize) + 1);
    const pct = Math.min(99, Math.round((prevOffset / uploadSession.totalSize) * 100));
    progressBar.value = pct;
    progressLabel.textContent = `Đang tải video lên Google Drive: ${pct}% (${formatFileSize(prevOffset)} / ${formatFileSize(uploadSession.totalSize)}) · Phần ${currentChunkIndex}/${totalChunks}…`;

    try {
      if (isDirect) {
        try {
          const directRes = await putChunkDirectToDrive({
            sessionUrl: uploadSession.sessionUrl,
            contentType: uploadSession.videoType || 'video/mp4',
            offset: prevOffset,
            end,
            totalSize: uploadSession.totalSize,
            blob: chunkBlob,
            onByteProgress: loadedAbs => {
              const livePct = Math.min(99, Math.round((loadedAbs / uploadSession.totalSize) * 100));
              progressBar.value = livePct;
              progressLabel.textContent = `Đang tải video lên Google Drive: ${livePct}% (${formatFileSize(loadedAbs)} / ${formatFileSize(uploadSession.totalSize)}) · Phần ${currentChunkIndex}/${totalChunks}…`;
            }
          });
          if (directRes.status === 308) {
            const m = /^bytes=0-(\d+)$/i.exec(directRes.rangeHeader || '');
            const confirmed = m ? Number(m[1]) + 1 : end;
            uploadSession.offset = confirmed > prevOffset ? confirmed : end;
            unchangedAttempts = 0;
            chunksSentInRun++;
            continue;
          }
          if (directRes.status === 200 || directRes.status === 201) {
            uploadSession.offset = uploadSession.totalSize;
            unchangedAttempts = 0;
            break;
          }
          if (prevOffset === 0) {
            uploadSession.directDisabled = true;
          } else {
            throw Error('Phản hồi từ Google Drive không hợp lệ.');
          }
        } catch (directErr) {
          if (prevOffset === 0) {
            uploadSession.directDisabled = true;
          } else {
            throw directErr;
          }
        }
      }

      const fallbackEnd = Math.min(prevOffset + uploadSession.chunkSize, uploadSession.totalSize);
      const fallbackBlob = fallbackEnd === end ? chunkBlob : file.slice(prevOffset, fallbackEnd, 'application/octet-stream');
      let chunkRes;
      if (uploadSession.hasBinaryEndpoint) {
        const qs = `?offset=${prevOffset}&uploadToken=${encodeURIComponent(uploadSession.uploadToken)}`;
        chunkRes = await api(`${chunkPath}${qs}`, {method: 'POST', body: fallbackBlob, raw: true, timeoutMs: 120000});
      } else {
        if (chunksSentInRun > 0 && chunksSentInRun % 5 === 0) {
          rotateWorkerIsolates();
          await pauseUpload(120);
        }
        const fd = new FormData();
        fd.set('uploadToken', uploadSession.uploadToken);
        fd.set('offset', String(prevOffset));
        fd.set('chunk', fallbackBlob, 'chunk.bin');
        chunkRes = await api(chunkPath, {method: 'POST', body: fd, timeoutMs: 120000});
      }

      if (chunkRes.state === 'uploaded') {
        uploadSession.offset = uploadSession.totalSize;
        uploadSession.finalizedOnServer = true;
        break;
      }
      const nextOffset = Number.isSafeInteger(chunkRes.offset) ? chunkRes.offset : fallbackEnd;
      if (nextOffset <= prevOffset) {
        throw Error('Máy chủ chưa xác nhận được tiến độ đoạn dữ liệu vừa gửi.');
      }
      uploadSession.offset = nextOffset;
      unchangedAttempts = 0;
      chunksSentInRun++;
      if (uploadSession.offset < uploadSession.totalSize && !uploadSession.hasBinaryEndpoint) {
        await pauseUpload(chunksSentInRun % 5 === 0 ? 1200 : 300);
      }
    } catch (chunkErr) {
      unchangedAttempts++;
      const isMemoryOrGatewayErr = chunkErr?.status === 413 || chunkErr?.status === 503;
      const waitMs = !uploadSession.hasBinaryEndpoint && isMemoryOrGatewayErr
        ? Math.min(32000, 8000 * unchangedAttempts)
        : Math.min(12000, 2500 * unchangedAttempts);
      progressLabel.textContent = `Đang đồng bộ lại luồng tải tại ${pct}% (${formatFileSize(prevOffset)} / ${formatFileSize(uploadSession.totalSize)}) · Thử lại ${unchangedAttempts}/${maxChunkRetries}…`;
      await pauseUpload(waitMs);
      if (!uploadSession.hasBinaryEndpoint) {
        rotateWorkerIsolates();
        await pauseUpload(150);
      }

      const statusRes = await queryServerStatus().catch(() => null);
      if (statusRes && statusRes.state === 'uploaded') {
        uploadSession.offset = uploadSession.totalSize;
        uploadSession.finalizedOnServer = true;
        break;
      }
      if (statusRes && Number.isSafeInteger(statusRes.offset)) {
        if (statusRes.offset > prevOffset) {
          uploadSession.offset = statusRes.offset;
          unchangedAttempts = 0;
          await pauseUpload(500);
          continue;
        }
        uploadSession.offset = statusRes.offset;
      }
      if (unchangedAttempts >= maxChunkRetries) {
        uploadState.session = null;
        throw chunkErr;
      }
      await pauseUpload(800);
    }
  }

  if (!uploadSession.finalizedOnServer) {
    progressBar.value = 99;
    progressLabel.textContent = finalizingText;
    let finalized = false;
    for (let finTry = 0; finTry < 3; finTry++) {
      const finRes = await queryServerStatus().catch(() => null);
      if (finRes && finRes.state === 'uploaded') {
        finalized = true;
        break;
      }
      await pauseUpload(1500 * (finTry + 1));
    }
    if (!finalized) {
      const lastCheck = await queryServerStatus();
      if (!lastCheck || lastCheck.state !== 'uploaded') {
        throw Error('Chưa thể hoàn tất liên kết video trên máy chủ. Vui lòng nhấn Lưu lần nữa.');
      }
    }
  }

  progressBar.value = 100;
  progressLabel.textContent = completedText;
  if (uploadSession.retryKey) lessonUploadRetry.complete(uploadSession.retryKey);
}

function lessonVideoCreatorModal(classId, onSaved, {session = null, allSessions = []} = {}) {
  let selectedFile = null;
  let ensuredLesson = null;
  const uploadState = {session: null};

  const sessionSelectField = !session ? createSessionPickerField(allSessions) : null;

  const activeSession = () => {
    if (session) return session;
    const chosenNum = Number(sessionSelectField?.input.value || 1);
    return allSessions.find(s => s.sessionNumber === chosenNum) || {sessionNumber: chosenNum, lessonName: '', cleanTopic: '', date: ''};
  };

  const titleField = field('title', 'Tên bài giảng hiển thị (khác với tên buổi học; để trống nếu giữ tên tệp gốc)', 'text', '', {
    required: false,
    maxLength: 180,
    placeholder: 'VD: Bài giảng phần 1 – Tính đơn điệu hàm số'
  });
  const topicField = field('topic', 'Chuyên đề Toán (tuỳ chọn)', 'text', session?.cleanTopic || '', {
    required: false,
    maxLength: 120,
    placeholder: 'VD: Giải tích 12 - Chương 1'
  });
  const picker = field('videoFile', 'Chọn tệp Video bài giảng (.mp4, .mov, .webm, .mkv – tối đa 5 GB)', 'file', '', {
    required: true,
    accept: 'video/mp4,video/webm,video/quicktime,video/x-matroska,video/*,.mp4,.mov,.webm,.mkv,.m4v'
  });

  if (sessionSelectField) {
    sessionSelectField.input.addEventListener('change', () => {
      const cur = activeSession();
      if (!topicField.input.value.trim() && cur.cleanTopic) topicField.input.value = cur.cleanTopic;
    });
  }

  const sessionBanner = session
    ? el('div', {class: 'notice session-modal-banner'},
        el('strong', {text: `Buổi ${session.sessionNumber}${session.lessonName ? `: ${session.lessonName}` : ''} · ${session.formattedDate}`}),
        el('p', {class: 'meta', text: 'Tên bài giảng đặt ở dưới là tên riêng của video bài giảng, độc lập với tên buổi học.'})
      )
    : null;

  const notice = el('p', {
    class: 'meta',
    role: 'status',
    'aria-live': 'polite',
    text: 'Video sẽ được tải thẳng vào thư mục lớp trên Google Drive (5 TB) và nhúng bằng khung phát Google Drive bảo mật nội bộ.'
  });
  const progressWrap = el('div', {class: 'video-upload-progress', hidden: true});
  const progressBar = el('progress', {class: 'video-upload-meter', max: '100', value: '0'});
  const progressLabel = el('p', {class: 'meta video-upload-status', role: 'status', 'aria-live': 'polite', text: 'Đang chuẩn bị tải video…'});
  progressWrap.append(progressBar, progressLabel);

  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const submit = el('button', {type: 'submit', class: 'primary wide', text: 'Lưu bài giảng'});
  const f = el('form', {},
    error,
    sessionBanner,
    sessionSelectField ? sessionSelectField.label : null,
    titleField.label,
    topicField.label,
    picker.label,
    progressWrap,
    notice,
    submit
  );

  picker.input.addEventListener('change', () => {
    selectedFile = picker.input.files?.[0] || null;
    uploadState.session = null;
    error.hidden = true;
    if (selectedFile) {
      notice.textContent = `Đã chọn video: ${selectedFile.name} (${formatFileSize(selectedFile.size)})`;
    } else {
      notice.textContent = 'Video sẽ được tải thẳng vào thư mục lớp trên Google Drive (5 TB) và nhúng bằng khung phát Google Drive bảo mật nội bộ.';
    }
  });

  f.onsubmit = async event => {
    event.preventDefault();
    if (!validateFormFields(f, error)) return;
    submit.disabled = true;
    titleField.input.disabled = true;
    topicField.input.disabled = true;
    if (sessionSelectField) sessionSelectField.input.disabled = true;
    picker.input.disabled = true;
    error.hidden = true;

    try {
      const maxVideoSize = 5 * 1024 * 1024 * 1024;
      if (!selectedFile || !selectedFile.size || selectedFile.size > maxVideoSize) {
        throw Error('Vui lòng chọn tệp video bài giảng có dữ liệu (tối đa 5 GB).');
      }

      progressWrap.hidden = false;
      progressBar.value = 0;
      progressLabel.textContent = 'Đang kiểm tra tệp và khởi tạo thư mục buổi học trên Google Drive…';

      const cleanTitle = titleField.input.value.trim();
      const cleanTopic = topicField.input.value.trim();

      if (!ensuredLesson) {
        const targetSess = activeSession();
        if (targetSess?.sessionNumber) {
          const ensured = await api(`/api/classes/${classId}/sessions`, {
            method: 'POST',
            body: {
              action: 'ensure_session',
              sessionNumber: targetSess.sessionNumber,
              ...(cleanTopic ? {cleanTopic} : {})
            }
          });
          ensuredLesson = {id: ensured.session.lessonId, title: ensured.session.title};
        } else {
          const pendingTopic = cleanTopic ? `${cleanTopic} · drive-video:pending` : 'drive-video:pending';
          const res = await api(`/api/classes/${classId}/lessons`, {
            method: 'POST',
            body: {
              title: cleanTitle || selectedFile.name,
              topic: pendingTopic
            }
          });
          ensuredLesson = {id: res.id, title: cleanTitle || selectedFile.name};
        }
      }

      await uploadDriveVideoResumable({
        classId,
        lessonId: ensuredLesson.id,
        file: selectedFile,
        cleanTitle,
        progressBar,
        progressLabel,
        uploadState,
        finalizingText: 'Đã tải 100% dữ liệu lên Google Drive! Đang xác thực và gắn video vào buổi học…',
        completedText: 'Đã tải xong 100%! Đang hoàn tất liên kết bài giảng…'
      });

      $('editor').close();
      await onSaved();
      status('Đã tải Video bài giảng vào buổi học trên Google Drive.', false, 'success');
    } catch (e) {
      error.textContent = friendly(e);
      error.hidden = false;
      error.focus();
    } finally {
      submit.disabled = false;
      if (!ensuredLesson) {
        titleField.input.disabled = false;
        topicField.input.disabled = false;
        if (sessionSelectField) sessionSelectField.input.disabled = false;
      }
      picker.input.disabled = false;
    }
  };

  modal(session ? `Tải Video bài giảng · Buổi ${session.sessionNumber}` : 'Thêm Video bài giảng vào Buổi học', f);
}

async function loadAuthorizedVideoStreamUrl(videoBasePath) {
  const res = await api(`${videoBasePath}/stream`);
  const apiOrigin = new URL(apiBase).origin;
  const resolved = new URL(res.url, apiOrigin);
  if (resolved.origin !== apiOrigin || resolved.pathname !== '/api/video-media') {
    throw Error('Địa chỉ luồng phát video không hợp lệ.');
  }
  return resolved.href;
}

function previewDriveVideoLecture(title, topic, previewPath) {
  const panel = createDriveVideoLectureElement({
    title,
    topic,
    loadStreamUrl: () => loadAuthorizedVideoStreamUrl(previewPath),
    inline: false
  });
  modal(title, panel);
}

function buildVideoLectureCard({title, cleanTopic, driveVideoPath, createdAt}) {
  const inlineVideoSlot = el('div', {class: 'lesson-inline-video-slot', hidden: true});
  const openModalPlayer = () => {
    if (driveVideoPath) {
      previewDriveVideoLecture(title, cleanTopic, driveVideoPath);
    }
  };

  const inlinePlayBtn = el(
    'button',
    {
      type: 'button',
      class: 'media-lecture-trigger',
      'aria-expanded': 'false',
      onclick: () => {
        if (!driveVideoPath) return;
        const opening = inlineVideoSlot.hidden;
        inlineVideoSlot.hidden = !opening;
        inlinePlayBtn.setAttribute('aria-expanded', String(opening));
        inlinePlayBtn.classList.toggle('is-active', opening);
        if (opening) {
          const closeInlineAndOpenModal = () => {
            inlineVideoSlot.querySelectorAll('.drive-video-lecture-panel').forEach(p => p._ltchDisposeVideo?.());
            inlineVideoSlot.hidden = true;
            inlinePlayBtn.setAttribute('aria-expanded', 'false');
            inlinePlayBtn.classList.remove('is-active');
            inlineVideoSlot.replaceChildren();
            openModalPlayer();
          };
          inlineVideoSlot.replaceChildren(
            createDriveVideoLectureElement({
              title,
              topic: cleanTopic,
              loadStreamUrl: () => loadAuthorizedVideoStreamUrl(driveVideoPath),
              inline: true,
              onOpenModal: closeInlineAndOpenModal
            })
          );
        } else {
          inlineVideoSlot.querySelectorAll('.drive-video-lecture-panel').forEach(p => p._ltchDisposeVideo?.());
          inlineVideoSlot.replaceChildren();
        }
      }
    },
    mediaIcon('play'),
    el('span', {text: 'Xem bài giảng'})
  );

  const modalPlayBtn = el(
    'button',
    {
      type: 'button',
      class: 'media-toolbar-btn',
      onclick: openModalPlayer
    },
    mediaIcon('expand'),
    el('span', {text: 'Mở khung rộng'})
  );

  const badges = el(
    'div',
    {class: 'lesson-card-badges'},
    el('span', {class: 'badge badge-info lesson-topic-badge', text: cleanTopic || 'Bài giảng Toán'}),
    el(
      'span',
      {class: 'media-source-pill media-source-drive'},
      mediaIcon('video'),
      el('span', {text: 'Video Google Drive'})
    ),
    createdAt ? el('span', {class: 'lesson-date-meta', text: fmt(createdAt)}) : null
  );

  return el(
    'article',
    {class: 'row lesson-card video-lecture-card'},
    el(
      'div',
      {class: 'lesson-card-header'},
      el(
        'div',
        {class: 'lesson-card-identity'},
        badges,
        el('h3', {class: 'lesson-card-title', text: title})
      ),
      el('div', {class: 'actions lesson-card-actions'}, inlinePlayBtn, modalPlayBtn)
    ),
    inlineVideoSlot
  );
}

let activeSessionRangeFilter = 'auto';
let activeSessionSearchQuery = '';
let activeCurriculumClassId = null;
let activeMaterialsViewMode = 'published';
let activeMaterialsMediaFilter = 'all';
let activeHomeworkViewMode = 'board';
let activeHomeworkStatusFilter = 'all';
const classSessionsCatalogCache = new Map();

function syncCurriculumWorkspaceClass(classId) {
  if (!classId || activeCurriculumClassId === classId) return;
  activeCurriculumClassId = classId;
  activeMaterialsViewMode = 'published';
  activeMaterialsMediaFilter = 'all';
  activeHomeworkViewMode = 'board';
  activeHomeworkStatusFilter = 'all';
  activeSessionSearchQuery = '';
  activeSessionRangeFilter = 'auto';
}

function findNearestScheduledSession(sessions = []) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) return null;
  const todayIso = new Date().toLocaleDateString('en-CA');
  let closest = null;
  let closestDiff = Infinity;
  for (const s of list) {
    if (!s?.date) continue;
    const absDiff = Math.abs(diffIsoDays(s.date, todayIso));
    if (!Number.isFinite(absDiff)) continue;
    if (
      absDiff < closestDiff ||
      (absDiff === closestDiff && s.date >= todayIso && closest?.date < todayIso)
    ) {
      closestDiff = absDiff;
      closest = s;
    }
  }
  return closest || list[0];
}

function pickNearbyScheduleWindow(sessions = [], anchorSession = null, count = 4) {
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) return [];
  const anchorNum = anchorSession?.sessionNumber || list[0].sessionNumber;
  const idx = Math.max(0, list.findIndex(s => s.sessionNumber === anchorNum));
  const start = Math.max(0, Math.min(idx - 1, Math.max(0, list.length - count)));
  return list.slice(start, start + count);
}

function invalidateClassSessionsCatalogCache(classId = null) {
  if (classId) classSessionsCatalogCache.delete(classId);
  else classSessionsCatalogCache.clear();
}

function resolveEffectiveSessionRange(range, sessions = [], hasContentFn = null) {
  if (range && range !== 'auto') return range;
  const list = Array.isArray(sessions) ? sessions : [];
  let targetSessionNumber = null;
  if (typeof hasContentFn === 'function') {
    for (const s of list) {
      if (hasContentFn(s) && (!targetSessionNumber || s.sessionNumber > targetSessionNumber)) {
        targetSessionNumber = s.sessionNumber;
      }
    }
  }
  if (!targetSessionNumber) {
    const todayIso = new Date().toLocaleDateString('en-CA');
    let bestDiff = Infinity;
    for (const s of list) {
      if (!s?.date) continue;
      const diff = Math.abs(diffIsoDays(s.date, todayIso));
      if (Number.isFinite(diff) && diff < bestDiff) {
        bestDiff = diff;
        targetSessionNumber = s.sessionNumber;
      }
    }
  }
  const n = Math.max(1, Number(targetSessionNumber) || 1);
  if (n <= 10) return '1-10';
  if (n <= 20) return '11-20';
  if (n <= 30) return '21-30';
  if (n <= 40) return '31-40';
  return '41-50';
}

async function loadClassSessionsCatalog(classId, {forceRefresh = false} = {}) {
  if (!forceRefresh && classSessionsCatalogCache.has(classId)) {
    const cached = classSessionsCatalogCache.get(classId);
    if (Date.now() - cached.at < 45000) {
      return cached.data;
    }
  }
  try {
    const res = await api(`/api/classes/${classId}/sessions`);
    if (Array.isArray(res?.sessions)) {
      classSessionsCatalogCache.set(classId, {at: Date.now(), data: res});
      return res;
    }
  } catch {}
  const fallback = buildClassSessionsCatalog({
    classId,
    classRecord: workspace?.class || selectedClass || {},
    lessons: [],
    onlyExplicit: true
  });
  return {
    sessions: fallback.sessions,
    unmatchedLessons: fallback.unmatchedLessons,
    scheduleSlots: workspace?.class?.schedule_slots || [],
    scheduleText: workspace?.class?.schedule || ''
  };
}

function filterSessionsByRangeAndQuery(sessions, {range = 'all', query = '', hasContentFn = null} = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (sessions || []).filter(session => {
    if (!q) {
      if (range === 'with_content' && typeof hasContentFn === 'function') {
        if (!hasContentFn(session)) return false;
      } else if (/^\d+-\d+$/.test(range)) {
        const [minStr, maxStr] = range.split('-');
        const min = Number(minStr);
        const max = Number(maxStr);
        if (session.sessionNumber < min || session.sessionNumber > max) return false;
      }
    }
    if (!q) return true;
    const haystack = [
      `buổi ${session.sessionNumber}`,
      `buoi ${session.sessionNumber}`,
      String(session.sessionNumber),
      session.title || '',
      session.lessonName || '',
      session.cleanTopic || '',
      session.date || '',
      formatSessionDateVi(session.date),
      ...(session.videos || []).map(v => v.title || ''),
      ...(session.files || []).map(f => f.name || ''),
      ...(session.homeworkFiles || []).map(f => f.name || '')
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

function buildSessionNavigationToolbar({
  sessions,
  onFilterChange,
  primaryActionButton = null
}) {
  const totalCount = sessions.length || DEFAULT_COURSE_SESSIONS_COUNT;
  if (activeSessionRangeFilter === 'with_content') {
    activeSessionRangeFilter = 'all';
  }

  const ranges = [
    ['all', `Tất cả (${totalCount} buổi)`],
    ['1-10', 'Buổi 1 – 10'],
    ['11-20', 'Buổi 11 – 20'],
    ['21-30', 'Buổi 21 – 30'],
    ['31-40', 'Buổi 31 – 40'],
    ['41-50', `Buổi 41 – ${Math.max(50, totalCount)}`]
  ];

  const rangePillsHost = el('div', {class: 'session-range-pills', role: 'group', 'aria-label': 'Lọc theo chặng buổi học'});
  const rangeButtons = [];

  function syncRangeButtons() {
    for (const [btnNode, key] of rangeButtons) {
      const isActive = activeSessionRangeFilter === key;
      btnNode.classList.toggle('is-active', isActive);
      btnNode.setAttribute('aria-pressed', String(isActive));
    }
  }

  for (const [key, label] of ranges) {
    const b = el('button', {
      type: 'button',
      class: 'session-range-pill',
      text: label,
      'aria-pressed': String(activeSessionRangeFilter === key),
      onclick: () => {
        activeSessionRangeFilter = key;
        syncRangeButtons();
        onFilterChange?.();
      }
    });
    rangeButtons.push([b, key]);
    rangePillsHost.append(b);
  }
  syncRangeButtons();

  const searchInput = el('input', {
    type: 'search',
    class: 'session-search-input',
    value: activeSessionSearchQuery,
    placeholder: 'Tìm theo buổi (VD: Buổi 5), tên bài giảng, chuyên đề hoặc ngày học...'
  });
  searchInput.addEventListener('input', () => {
    activeSessionSearchQuery = searchInput.value;
    onFilterChange?.();
  });

  const filterBar = el(
    'div',
    {class: 'session-filter-bar'},
    rangePillsHost,
    el('div', {class: 'session-search-wrap'}, searchInput)
  );

  return el(
    'div',
    {class: 'session-navigation-shell'},
    primaryActionButton ? el('div', {class: 'actions'}, primaryActionButton) : null,
    filterBar
  );
}

let activeSessionSortOrder = 'order_asc';

function collectLessonVideos(item, classId, fallbackLabel = 'Bài giảng', {filesBasePath = null} = {}) {
  const itemId = item.solutionId || item.lessonId;
  const basePath = resolveItemFilesBasePath(classId, itemId, filesBasePath);
  const videoEntries = [];
  if (Array.isArray(item.videos) && item.videos.length) {
    for (const v of item.videos) {
      if (!v?.id) continue;
      videoEntries.push({
        id: v.id,
        name: v.name || fallbackLabel,
        driveVideoPath: `${basePath}/${v.id}`
      });
    }
  } else if (item.driveVideoFileId && item.driveVideoFileId !== 'pending') {
    videoEntries.push({
      id: item.driveVideoFileId,
      name: fallbackLabel,
      driveVideoPath: `${basePath}/${item.driveVideoFileId}`
    });
  }
  return videoEntries;
}

function mountInlineDocumentViewer(hostNode, file, path, alive = () => true, {linkPreview = Boolean(workspace?.lessonsLinkPreview), compact = false} = {}) {
  let closed = false;
  let loadingTask = null;
  let viewerCtrl = null;
  let imageObjectUrl = null;
  const isPdf = file.content_type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  const isImage = /^image\/(jpeg|png|webp|gif)$/i.test(String(file.content_type || '')) || /\.(jpe?g|png|webp|gif)$/i.test(file.name || '');

  const cleanup = () => {
    closed = true;
    viewerCtrl?.destroy?.();
    loadingTask?.destroy?.().catch?.(() => {});
    if (imageObjectUrl) {
      URL.revokeObjectURL(imageObjectUrl);
      imageObjectUrl = null;
    }
  };

  if (isPdf) {
    const panel = el(
      'div',
      {class: 'media-viewer-panel pdf-viewer-panel is-inline', 'aria-busy': 'true'},
      el(
        'div',
        {class: 'media-loading-card'},
        el('span', {class: 'media-spinner', 'aria-hidden': 'true'}),
        el('p', {role: 'status', text: `Đang mở tệp "${file.name}"…`})
      )
    );
    hostNode.replaceChildren(panel);

    (async () => {
      try {
        const blob = await api(path, {blob: true});
        const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
        if (blob.size > MAX_DOCUMENT_UPLOAD_BYTES || signature.length !== 5 || String.fromCharCode(...signature) !== '%PDF-') {
          throw Error('Tệp không có định dạng PDF hợp lệ.');
        }
        if (closed || !alive() || !panel.isConnected) return;
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
        loadingTask = pdfjs.getDocument({
          data: new Uint8Array(await blob.arrayBuffer()),
          isEvalSupported: false,
          disableFontFace: true,
          enableXfa: false,
          maxImageSize: 16000000,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          wasmUrl: '/pdfjs/wasm/'
        });
        const doc = await loadingTask.promise;
        if (closed || !alive() || !panel.isConnected) return;
        viewerCtrl = await mountDriveStylePdfViewer({
          panel,
          name: file.name,
          doc,
          compact,
          isClosed: () => closed || !panel.isConnected,
          onDownload: () => download(path, file.name, '', {existingBlob: blob, existingPdfDoc: doc})
        });
      } catch (error) {
        if (!closed && panel.isConnected) {
          panel.setAttribute('aria-busy', 'false');
          panel.replaceChildren(
            el(
              'div',
              {class: 'media-error-card'},
              el('p', {class: 'form-error', role: 'alert', text: friendly(error)}),
              btn('Tải về máy', () => download(path, file.name, ''), false, 'download')
            )
          );
        }
      }
    })();
    return cleanup;
  }

  if (isImage) {
    const panel = el(
      'div',
      {class: 'media-viewer-panel inline-image-viewer-panel is-inline', 'aria-busy': 'true'},
      el(
        'div',
        {class: 'media-loading-card'},
        el('span', {class: 'media-spinner', 'aria-hidden': 'true'}),
        el('p', {role: 'status', text: `Đang mở hình ảnh "${file.name}"…`})
      )
    );
    hostNode.replaceChildren(panel);

    (async () => {
      try {
        const blob = await api(path, {blob: true});
        if (!blob || !blob.size) throw Error('Không tải được hình ảnh.');
        if (closed || !alive() || !panel.isConnected) return;
        imageObjectUrl = URL.createObjectURL(blob);
        const toolbar = el(
          'div',
          {class: 'inline-image-viewer-toolbar'},
          el('strong', {class: 'inline-image-viewer-name', text: file.name}),
          btn('Tải về máy', () => download(path, file.name, file.content_type || '', {existingBlob: blob}), false, 'download')
        );
        const imgNode = el('img', {
          src: imageObjectUrl,
          alt: file.name,
          class: 'inline-image-viewer-img',
          draggable: false
        });
        panel.setAttribute('aria-busy', 'false');
        panel.replaceChildren(toolbar, el('div', {class: 'inline-image-viewer-stage'}, imgNode));
      } catch (error) {
        if (!closed && panel.isConnected) {
          panel.setAttribute('aria-busy', 'false');
          panel.replaceChildren(
            el(
              'div',
              {class: 'media-error-card'},
              el('p', {class: 'form-error', role: 'alert', text: friendly(error)}),
              btn('Tải về máy', () => download(path, file.name, ''), false, 'download')
            )
          );
        }
      }
    })();
    return cleanup;
  }

  const panel = el(
    'div',
    {class: 'drive-preview-panel media-viewer-panel is-inline', 'aria-busy': 'true'},
    el(
      'div',
      {class: 'media-loading-card'},
      el('span', {class: 'media-spinner', 'aria-hidden': 'true'}),
      el('p', {role: 'status', text: `Đang mở tệp "${file.name}"…`})
    )
  );
  hostNode.replaceChildren(panel);

  async function loadDriveDoc(method = 'GET') {
    if (closed || !alive() || !panel.isConnected) return;
    panel.setAttribute('aria-busy', 'true');
    try {
      const result = await api(`${path}/preview`, {method});
      const url = new URL(result.url);
      if (
        url.origin !== 'https://drive.google.com' ||
        !/^\/file\/d\/[A-Za-z0-9_-]{1,200}\/preview$/.test(url.pathname) ||
        url.search ||
        url.hash
      ) {
        throw Error('Địa chỉ tệp không hợp lệ.');
      }
      if (closed || !alive() || !panel.isConnected) return;
      panel.replaceChildren();
      populateDrivePreviewPanel({
        panel,
        urlHref: url.href,
        path,
        name: file.name,
        type: file.content_type,
        onDownload: download,
        onPreviewPdf: previewPdf,
        onReload: () => loadDriveDoc('GET')
      });
    } catch (error) {
      if (closed || !panel.isConnected) return;
      const fileInfo = classifyLessonFile(file.name, file.content_type);
      const actions = el('div', {class: 'actions'}, btn('Tải về máy', () => download(path, file.name, ''), true, 'download'));
      if (error.status === 409 && me?.roles?.includes('admin') && viewRole === 'admin') {
        const warning = el('p', {
          class: 'notice',
          text: 'Bật xem trực tuyến qua liên kết cho phép hiển thị tệp định dạng này ngay trong khung xem.'
        });
        const consent = el('input', {type: 'checkbox'});
        const activate = btn('Bật khung xem trực tuyến', () => loadDriveDoc('POST'), false);
        activate.disabled = true;
        consent.addEventListener('change', () => {
          activate.disabled = !consent.checked;
        });
        panel.replaceChildren(
          el(
            'div',
            {class: 'media-error-card'},
            el('strong', {text: `${file.name} (${fileInfo.label})`}),
            warning,
            el('label', {class: 'check'}, consent, 'Tôi đồng ý bật xem trực tuyến tệp này.'),
            activate,
            actions
          )
        );
      } else {
        panel.replaceChildren(
          el(
            'div',
            {class: 'media-error-card'},
            el('strong', {text: `${file.name} (${fileInfo.label})`}),
            el('p', {class: 'meta', text: linkPreview ? friendly(error) : 'Định dạng tệp này hỗ trợ tải trực tiếp về máy tính/điện thoại để học tập.'}),
            actions
          )
        );
      }
    } finally {
      if (!closed && panel.isConnected) panel.setAttribute('aria-busy', 'false');
    }
  }

  if (linkPreview) {
    loadDriveDoc('GET');
  } else {
    const fileInfo = classifyLessonFile(file.name, file.content_type);
    panel.setAttribute('aria-busy', 'false');
    panel.replaceChildren(
      el(
        'div',
        {class: 'media-error-card'},
        el('strong', {text: `${file.name} (${fileInfo.label})`}),
        el('p', {class: 'meta', text: 'Tệp đã sẵn sàng. Nhấn nút bên dưới để tải về máy.'}),
        el('div', {class: 'actions'}, btn('Tải về máy', () => download(path, file.name, ''), true, 'download'))
      )
    );
  }

  return cleanup;
}

async function renderSplitMaterialsAndLessons({filesSection, classId, canWrite, canManageSchedule = false, subPage = null}) {
  const version = viewVersion;
  const alive = () =>
    filesSection.isConnected &&
    version === viewVersion &&
    selectedClass?.id === classId &&
    activeClassTab === 'materials';

  filesSection.replaceChildren(el('p', {class: 'meta', role: 'status', text: 'Đang tải danh sách buổi học…'}));
  const catalogData = await loadClassSessionsCatalog(classId);
  if (!alive()) return;
  syncCurriculumWorkspaceClass(classId);
  filesSection.classList.add('sessions-materials-page-root');
  filesSection.replaceChildren();

  const allSessions = catalogData.sessions || [];
  const unmatchedLessons = catalogData.unmatchedLessons || [];

  const sessionMatch = typeof subPage === 'string' ? /^buoi-(\d{1,3})$/i.exec(subPage.trim()) : null;
  const activeSessionNum = sessionMatch ? Number(sessionMatch[1]) : null;

  function collectSessionVideos(session) {
    const fallback = session.lessonName ? `Bài giảng: ${session.lessonName}` : `Bài giảng Buổi ${session.sessionNumber}`;
    return collectLessonVideos(session, classId, fallback);
  }

  function openSessionPage(sessionNumber) {
    classView('materials', {subPage: `buoi-${sessionNumber}`});
    window.scrollTo?.({top: 0, behavior: 'smooth'});
  }

  // =========================================================================
  // TRANG RIÊNG CỦA TỪNG BUỔI HỌC (/class/<slug>/materials/buoi-<N>)
  // =========================================================================
  if (activeSessionNum) {
    const targetSession = allSessions.find(s => s.sessionNumber === activeSessionNum);
    if (!targetSession) {
      filesSection.append(
        el(
          'div',
          {class: 'session-empty-mode-card'},
          el('p', {text: `Không tìm thấy Buổi ${activeSessionNum} trong lộ trình lớp học.`}),
          btn('Về danh sách buổi', () => classView('materials', {subPage: null}), true)
        )
      );
      return;
    }

    const num = targetSession.sessionNumber;
    const sortedByNum = [...allSessions].sort((a, b) => a.sessionNumber - b.sessionNumber);
    const curIdx = sortedByNum.findIndex(s => s.sessionNumber === num);
    const prevSess = curIdx > 0 ? sortedByNum[curIdx - 1] : null;
    const nextSess = curIdx >= 0 && curIdx < sortedByNum.length - 1 ? sortedByNum[curIdx + 1] : null;

    const dateLabel = formatSessionDateVi(targetSession.date, {
      includeWeekday: true,
      start: targetSession.start,
      end: targetSession.end
    });

    const videoEntries = collectSessionVideos(targetSession);
    const docFiles = Array.isArray(targetSession.files) ? targetSession.files : [];
    const hasLecture = videoEntries.length > 0;
    const hasDocs = docFiles.length > 0;

    let activeViewerCleanup = null;
    let currentMode = null;
    let selectedVideoIdx = 0;
    let selectedDocIdx = 0;

    const viewerStageHost = el('div', {class: 'session-inline-viewer-host', hidden: true});

    const clearViewer = () => {
      if (typeof activeViewerCleanup === 'function') {
        activeViewerCleanup();
        activeViewerCleanup = null;
      }
      viewerStageHost.querySelectorAll('.drive-video-lecture-panel').forEach(panelNode => {
        panelNode._ltchDisposeVideo?.();
      });
      viewerStageHost.replaceChildren();
      viewerStageHost.hidden = true;
      syncTheaterBodyLock();
    };

    const shortDateLabel = targetSession.date
      ? formatSessionDateVi(targetSession.date, {includeWeekday: false})
      : 'Chưa xếp ngày';

    const sessionPageTitle = targetSession.lessonName
      ? `Buổi ${num}: ${targetSession.lessonName}`
      : `Buổi ${num}`;

    const breadcrumbGridIcon = el('span', {class: 'ltch-breadcrumb-icon', 'aria-hidden': 'true'});
    breadcrumbGridIcon.innerHTML =
      '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="6" height="6" rx="1.4"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.4"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.4"/><rect x="11.5" y="11.5" width="6" height="6" rx="1.4"/></svg>';

    const sessionSwitcherSelect = el(
      'select',
      {
        class: 'ltch-breadcrumb-select',
        'aria-label': 'Chuyển nhanh sang buổi học khác',
        onchange: e => {
          const nextNum = Number(e.target.value);
          if (!nextNum || nextNum === num) return;
          clearViewer();
          openSessionPage(nextNum);
        }
      },
      ...allSessions.map(s => {
        const sDate = s.date ? formatSessionDateVi(s.date, {includeWeekday: false}) : '';
        const sLabel = s.lessonName
          ? `Buổi ${s.sessionNumber}: ${s.lessonName}`
          : sDate
            ? `Buổi ${s.sessionNumber} · ${sDate}`
            : `Buổi ${s.sessionNumber}`;
        return el('option', {
          value: String(s.sessionNumber),
          selected: s.sessionNumber === num,
          text: sLabel
        });
      })
    );
    sessionSwitcherSelect.value = String(num);

    const breadcrumbNav = el(
      'nav',
      {class: 'ltch-breadcrumb-nav', 'aria-label': 'Điều hướng buổi học'},
      el(
        'button',
        {
          type: 'button',
          class: 'ltch-breadcrumb-root',
          onclick: () => {
            clearViewer();
            classView('materials', {subPage: null});
          }
        },
        breadcrumbGridIcon,
        el('span', {text: 'Tất cả buổi học'})
      ),
      el('span', {class: 'ltch-breadcrumb-sep', 'aria-hidden': 'true', text: '/'}),
      sessionSwitcherSelect
    );

    const titleGroup = el(
      'div',
      {class: 'session-unboxed-title-group'},
      el('h2', {
        class: `session-unboxed-title${targetSession.lessonName ? '' : ' is-unnamed-session'}`,
        text: sessionPageTitle,
        title: sessionPageTitle
      }),
      el('span', {
        class: `session-date-badge${targetSession.customDate ? ' is-custom-date' : ''}`,
        text: shortDateLabel,
        title: dateLabel || shortDateLabel
      }),
      targetSession.cleanTopic
        ? el('span', {class: 'badge badge-info lesson-topic-badge', text: targetSession.cleanTopic})
        : null
    );

    const lectureModeBtn = el(
      'button',
      {
        type: 'button',
        class: `session-mode-btn${hasLecture ? ' has-data' : ''}`,
        'aria-pressed': 'false',
        onclick: () => selectMode('lecture')
      },
      mediaIcon('play'),
      el('span', {text: 'Bài giảng'})
    );

    const docModeBtn = el(
      'button',
      {
        type: 'button',
        class: `session-mode-btn${hasDocs ? ' has-data' : ''}`,
        'aria-pressed': 'false',
        onclick: () => selectMode('document')
      },
      mediaIcon('material'),
      el('span', {text: 'Tài liệu'})
    );

    const splitModeBtn = hasLecture && hasDocs
      ? el(
          'button',
          {
            type: 'button',
            class: 'session-mode-btn has-data',
            'aria-pressed': 'false',
            onclick: () => selectMode('split')
          },
          mediaIcon('split'),
          el('span', {text: 'Song song'})
        )
      : null;

    const modeChoices = el(
      'div',
      {class: 'session-mode-choices', role: 'group', 'aria-label': `Chọn Bài giảng hoặc Tài liệu của Buổi ${num}`},
      lectureModeBtn,
      docModeBtn,
      splitModeBtn
    );

    const staffUploadBar = canWrite ? el('div', {class: 'session-compact-staff-actions'}) : null;
    if (staffUploadBar) {
      const manageItems = [];
      if (workspace.lessonsEnabled) {
        manageItems.push({
          label: 'Tải Bài giảng',
          icon: 'plus',
          onSelect: () =>
            lessonVideoCreatorModal(
              classId,
              async () => {
                invalidateClassSessionsCatalogCache(classId);
                pendingAutoOpenSessionMode = {classId, sessionNumber: num, mode: 'lecture'};
                if (alive()) await refreshClass('materials', {subPage: `buoi-${num}`});
              },
              {session: targetSession, allSessions}
            )
        });
      }
      manageItems.push(
        {
          label: 'Tải Tài liệu',
          icon: 'plus',
          onSelect: () =>
            lessonFileSetCreatorModal(
              classId,
              async () => {
                invalidateClassSessionsCatalogCache(classId);
                pendingAutoOpenSessionMode = {classId, sessionNumber: num, mode: 'document'};
                if (alive()) await refreshClass('materials', {subPage: `buoi-${num}`});
              },
              {session: targetSession, allSessions}
            )
        },
        {
          label: 'Sửa tên / lịch buổi',
          icon: 'edit',
          dividerBefore: true,
          onSelect: () =>
            openSessionEditorModal(classId, targetSession, allSessions, async () => {
              invalidateClassSessionsCatalogCache(classId);
              if (alive()) await refreshClass('materials', {subPage: `buoi-${num}`});
            })
        },
        ...(workspace.permissions?.attendance && !(workspace?.class?.archived || selectedClass?.archived) && targetSession.date
          ? [{
              label: 'Điểm danh buổi này',
              icon: 'check',
              dividerBefore: true,
              onSelect: () => {
                clearViewer();
                classView('attendance', {subPage: targetSession.date});
              }
            }]
          : []),
        {
          label: 'Xóa buổi học & thư mục Drive',
          icon: 'trash',
          danger: true,
          dividerBefore: true,
          onSelect: () =>
            confirmDeleteSession(classId, targetSession, async () => {
              if (alive()) await refreshClass('materials', {subPage: null});
            })
        }
      );
      staffUploadBar.append(
        createActionMenu({
          label: 'Quản lý buổi',
          ariaLabel: `Quản lý Buổi ${num}`,
          iconName: 'settings',
          iconOnly: true,
          variant: 'outline',
          items: manageItems
        })
      );
    }

    const sessionStepNav = el(
      'div',
      {class: 'ltch-breadcrumb-step-nav'},
      el('button', {
        type: 'button',
        class: 'ltch-step-nav-btn',
        disabled: !prevSess,
        text: '← Buổi trước',
        onclick: () => {
          if (!prevSess) return;
          clearViewer();
          openSessionPage(prevSess.sessionNumber);
        }
      }),
      el('button', {
        type: 'button',
        class: 'ltch-step-nav-btn',
        disabled: !nextSess,
        text: 'Buổi tiếp →',
        onclick: () => {
          if (!nextSess) return;
          clearViewer();
          openSessionPage(nextSess.sessionNumber);
        }
      })
    );

    const compactTopbar = el(
      'header',
      {class: 'session-unboxed-header'},
      el('div', {class: 'session-detail-nav-row'}, breadcrumbNav, sessionStepNav),
      el(
        'div',
        {class: 'session-unboxed-main-row'},
        titleGroup,
        el('div', {class: 'session-compact-controls'}, modeChoices, staffUploadBar)
      )
    );

    function renderLectureMode() {
      clearViewer();
      viewerStageHost.hidden = false;
      if (!hasLecture) {
        viewerStageHost.replaceChildren(
          el(
            'div',
            {class: 'session-empty-mode-card'},
            el('p', {text: `Buổi ${num} hiện chưa có video bài giảng.`}),
            canWrite && workspace.lessonsEnabled
              ? btn(
                  'Tải bài giảng',
                  () =>
                    lessonVideoCreatorModal(
                      classId,
                      async () => {
                        invalidateClassSessionsCatalogCache(classId);
                        pendingAutoOpenSessionMode = {classId, sessionNumber: num, mode: 'lecture'};
                        if (alive()) await refreshClass('materials', {subPage: `buoi-${num}`});
                      },
                      {session: targetSession, allSessions}
                    ),
                  true,
                  'plus'
                )
              : null
          )
        );
        return;
      }

      const chosen = videoEntries[Math.min(selectedVideoIdx, videoEntries.length - 1)] || videoEntries[0];
      const chosenVideoRow = (targetSession.videos || []).find(v => v.id === chosen.id) || (targetSession.videos || [])[selectedVideoIdx] || null;
      const lectureTopic = targetSession.cleanTopic || dateLabel;
      const itemSubbar = videoEntries.length > 1 || (canWrite && chosenVideoRow)
        ? el(
            'div',
            {class: 'session-doc-selector-bar is-below-viewer'},
            videoEntries.length > 1
              ? el(
                  'div',
                  {class: 'session-item-pills', role: 'tablist', 'aria-label': 'Chọn video bài giảng trong buổi'},
                  ...videoEntries.map((v, idx) =>
                    el('button', {
                      type: 'button',
                      class: `session-item-pill${idx === selectedVideoIdx ? ' is-active' : ''}`,
                      text: v.name,
                      onclick: () => {
                        selectedVideoIdx = idx;
                        renderLectureMode();
                      }
                    })
                  )
                )
              : el(
                  'div',
                  {class: 'session-active-item-caption'},
                  mediaIcon('play'),
                  el('strong', {text: chosen.name, title: chosen.name})
                ),
            canWrite && chosenVideoRow
              ? el(
                  'button',
                  {
                    type: 'button',
                    class: 'session-file-delete-btn danger',
                    onclick: () =>
                      confirmDeleteSessionFile(classId, targetSession, chosenVideoRow, async () => {
                        if (alive()) await refreshClass('materials', {subPage: `buoi-${num}`});
                      })
                  },
                  mediaIcon('trash'),
                  el('span', {text: 'Xóa video khỏi Drive'})
                )
              : null
          )
        : null;

      const videoNode = createDriveVideoLectureElement({
        title: chosen.name,
        topic: lectureTopic,
        loadStreamUrl: () => loadAuthorizedVideoStreamUrl(chosen.driveVideoPath),
        inline: true,
        playlist: videoEntries,
        activeIndex: Math.min(selectedVideoIdx, Math.max(0, videoEntries.length - 1)),
        onSelectPlaylist: idx => {
          selectedVideoIdx = idx;
          renderLectureMode();
        }
      });

      viewerStageHost.replaceChildren(...[videoNode, itemSubbar].filter(Boolean));
    }

    function renderDocumentMode() {
      clearViewer();
      viewerStageHost.hidden = false;
      if (!hasDocs) {
        viewerStageHost.replaceChildren(
          el(
            'div',
            {class: 'session-empty-mode-card'},
            el('p', {text: `Buổi ${num} hiện chưa có tệp tài liệu nào.`}),
            canWrite
              ? btn(
                  'Tải tài liệu',
                  () =>
                    lessonFileSetCreatorModal(
                      classId,
                      async () => {
                        invalidateClassSessionsCatalogCache(classId);
                        pendingAutoOpenSessionMode = {classId, sessionNumber: num, mode: 'document'};
                        if (alive()) await refreshClass('materials', {subPage: `buoi-${num}`});
                      },
                      {session: targetSession, allSessions}
                    ),
                  true,
                  'plus'
                )
              : null
          )
        );
        return;
      }

      const chosenDoc = docFiles[Math.min(selectedDocIdx, docFiles.length - 1)] || docFiles[0];
      const docPath = `/api/classes/${classId}/lessons/${targetSession.lessonId}/files/${chosenDoc.id}`;
      const docMountBox = el('div', {class: 'session-doc-viewer-mount'});

      const docSelectorRow = docFiles.length > 1 || canWrite
        ? el(
            'div',
            {class: 'session-doc-selector-bar is-below-viewer'},
            docFiles.length > 1
              ? el(
                  'div',
                  {class: 'session-item-pills', role: 'tablist', 'aria-label': 'Chọn tài liệu trong buổi'},
                  ...docFiles.map((d, idx) =>
                    el('button', {
                      type: 'button',
                      class: `session-item-pill${idx === selectedDocIdx ? ' is-active' : ''}`,
                      text: d.name,
                      onclick: () => {
                        selectedDocIdx = idx;
                        renderDocumentMode();
                      }
                    })
                  )
                )
              : el(
                  'div',
                  {class: 'session-active-item-caption'},
                  mediaIcon('pdf') || icon('material'),
                  el('strong', {text: chosenDoc.name, title: chosenDoc.name}),
                  chosenDoc.file_size ? el('span', {class: 'meta', text: `(${formatFileSize(chosenDoc.file_size)})`}) : null
                ),
            canWrite
              ? el(
                  'button',
                  {
                    type: 'button',
                    class: 'session-file-delete-btn danger',
                    onclick: () =>
                      confirmDeleteSessionFile(classId, targetSession, chosenDoc, async () => {
                        if (alive()) await refreshClass('materials', {subPage: `buoi-${num}`});
                      })
                  },
                  mediaIcon('trash'),
                  el('span', {text: 'Xóa tệp khỏi Drive'})
                )
              : null
          )
        : null;

      viewerStageHost.replaceChildren(...[docMountBox, docSelectorRow].filter(Boolean));
      activeViewerCleanup = mountInlineDocumentViewer(docMountBox, chosenDoc, docPath);
    }

    function renderSplitStudyMode() {
      clearViewer();
      viewerStageHost.hidden = false;
      if (!hasLecture || !hasDocs) {
        if (hasDocs) renderDocumentMode();
        else renderLectureMode();
        return;
      }

      const safeVidIdx = Math.min(selectedVideoIdx, Math.max(0, videoEntries.length - 1));
      const chosenVideo = videoEntries[safeVidIdx] || videoEntries[0];
      const lectureTopic = targetSession.cleanTopic || dateLabel;
      const videoNode = createDriveVideoLectureElement({
        title: chosenVideo.name,
        topic: lectureTopic,
        loadStreamUrl: () => loadAuthorizedVideoStreamUrl(chosenVideo.driveVideoPath),
        inline: true,
        playlist: videoEntries,
        activeIndex: safeVidIdx,
        onSelectPlaylist: idx => {
          selectedVideoIdx = idx;
          renderSplitStudyMode();
        }
      });

      const safeDocIdx = Math.min(selectedDocIdx, Math.max(0, docFiles.length - 1));
      const chosenDoc = docFiles[safeDocIdx] || docFiles[0];
      const docPath = `/api/classes/${classId}/lessons/${targetSession.lessonId}/files/${chosenDoc.id}`;
      const docMountBox = el('div', {class: 'session-doc-viewer-mount'});
      const splitDocTabs = docFiles.length > 1
        ? el(
            'div',
            {class: 'session-doc-selector-bar is-below-viewer'},
            el(
              'div',
              {class: 'session-item-pills', role: 'tablist', 'aria-label': 'Chọn tài liệu học song song'},
              ...docFiles.map((d, idx) =>
                el('button', {
                  type: 'button',
                  class: `session-item-pill${idx === safeDocIdx ? ' is-active' : ''}`,
                  text: d.name,
                  onclick: () => {
                    selectedDocIdx = idx;
                    renderSplitStudyMode();
                  }
                })
              )
            )
          )
        : null;

      viewerStageHost.replaceChildren(
        el(
          'div',
          {class: 'session-split-study-grid'},
          el('div', {class: 'session-split-video-pane'}, videoNode),
          el('div', {class: 'session-split-doc-pane'}, ...[docMountBox, splitDocTabs].filter(Boolean))
        )
      );
      activeViewerCleanup = mountInlineDocumentViewer(docMountBox, chosenDoc, docPath, alive, {compact: true});
    }

    function selectMode(nextMode = 'lecture') {
      currentMode = nextMode === 'split' && hasLecture && hasDocs
        ? 'split'
        : nextMode === 'document'
          ? 'document'
          : 'lecture';
      const isLec = currentMode === 'lecture';
      const isDoc = currentMode === 'document';
      const isSplit = currentMode === 'split';
      lectureModeBtn.classList.toggle('is-active', isLec);
      lectureModeBtn.setAttribute('aria-pressed', String(isLec));
      docModeBtn.classList.toggle('is-active', isDoc);
      docModeBtn.setAttribute('aria-pressed', String(isDoc));
      if (splitModeBtn) {
        splitModeBtn.classList.toggle('is-active', isSplit);
        splitModeBtn.setAttribute('aria-pressed', String(isSplit));
      }

      if (isSplit) renderSplitStudyMode();
      else if (isDoc) renderDocumentMode();
      else renderLectureMode();
    }

    filesSection.append(
      el('div', {class: 'session-dedicated-page'}, compactTopbar, viewerStageHost)
    );

    if (
      pendingAutoOpenSessionMode &&
      pendingAutoOpenSessionMode.classId === classId &&
      pendingAutoOpenSessionMode.sessionNumber === num
    ) {
      const modeToOpen = pendingAutoOpenSessionMode.mode;
      pendingAutoOpenSessionMode = null;
      selectMode(modeToOpen);
    } else {
      selectMode(!hasLecture && hasDocs ? 'document' : 'lecture');
    }

    return;
  }

  // =========================================================================
  // TRANG CHỦ BÀI GIẢNG — LỘ TRÌNH HỌC LIỆU & VIDEO (COURSE SYLLABUS & MEDIA HUB)
  // =========================================================================
  const sessionHasAnyContent = session =>
    Boolean(
      session.driveVideoFileId ||
      (Array.isArray(session.videos) && session.videos.length) ||
      (Array.isArray(session.files) && session.files.length) ||
      session.hasLessonRecord ||
      session.lessonName ||
      session.cleanTopic
    );

  const reloadMaterials = async () => {
    invalidateClassSessionsCatalogCache(classId);
    if (alive()) await refreshClass('materials');
  };

  // Học liệu bổ sung chưa gắn buổi học cụ thể
  const legacyMaterialsList = el('div', {class: 'lesson-catalog-list legacy-materials-footer-list'});
  for (const lesson of unmatchedLessons) {
    const {cleanTopic, driveVideoFileId} = parseLessonTopicAndVideo(lesson);
    if (driveVideoFileId === 'pending') continue;
    if (!driveVideoFileId) {
      const details = el('div', {class: 'lesson-files'});
      const filesBtn = btn(
        'Xem tệp đính kèm',
        async () => {
          if (details.childNodes.length) {
            details.replaceChildren();
            filesBtn.classList.remove('is-active');
            return;
          }
          filesBtn.classList.add('is-active');
          await renderLessonFiles(details, classId, lesson, canWrite, alive);
        },
        false,
        'material'
      );
      legacyMaterialsList.append(
        el(
          'article',
          {class: 'row lesson-card file-set-card'},
          el(
            'div',
            {class: 'lesson-card-header'},
            el(
              'div',
              {class: 'lesson-card-identity'},
              el(
                'div',
                {class: 'lesson-card-badges'},
                el('span', {class: 'badge badge-info', text: cleanTopic || 'Học liệu bổ sung'}),
                lesson.created_at ? el('span', {class: 'lesson-date-meta', text: fmt(lesson.created_at)}) : null
              ),
              el('h3', {class: 'lesson-card-title', text: lesson.title})
            ),
            el('div', {class: 'actions'}, filesBtn)
          ),
          details
        )
      );
    }
  }

  const publishedSessions = allSessions.filter(sessionHasAnyContent);
  const mediaPublishedSessions = allSessions.filter(
    s => collectSessionVideos(s).length > 0 || (Array.isArray(s.files) && s.files.length > 0)
  );
  const hasLegacyMaterials = legacyMaterialsList.childNodes.length > 0;
  const scheduleSummaryText = String(catalogData.scheduleText || workspace.class?.schedule || '').trim();

  const searchIconSpan = el('span', {class: 'notices-search-icon', 'aria-hidden': 'true'});
  searchIconSpan.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  const overviewBodyHost = el('div', {class: 'materials-overview-body'});

  const materialsCommandActions = canWrite
    ? el(
        'div',
        {class: 'subtab-command-actions'},
        btn('Tạo buổi học mới', () => openCreateSessionModal(classId, allSessions, reloadMaterials), true, 'plus'),
        workspace.lessonsEnabled
          ? btn(
              'Đăng video bài giảng',
              () => lessonVideoCreatorModal(classId, reloadMaterials, {allSessions}),
              false,
              'practice'
            )
          : null,
        btn(
          'Tải tài liệu',
          () => lessonFileSetCreatorModal(classId, reloadMaterials, {allSessions}),
          false,
          'material'
        )
      )
    : null;

  const materialsSubtitleNode = scheduleSummaryText
    ? el('p', {class: 'notices-hero-schedule'}, icon('attendance'), el('span', {text: `Lịch cố định: ${scheduleSummaryText}`}))
    : el('p', {
        class: 'subtab-command-subtitle',
        text: 'Mỗi buổi học được liên kết trực tiếp với thư mục riêng trên Google Drive để lưu video và tài liệu.'
      });

  const materialsCommandBar = el(
    'div',
    {class: 'subtab-command-bar materials-hero-bar'},
    el(
      'div',
      {class: 'subtab-command-info'},
      el('div', {class: 'subtab-command-title-row'}, el('h1', {class: 'subtab-command-title', text: `Bài giảng ${workspace.class?.name || 'lớp học'}`})),
      materialsSubtitleNode
    ),
    materialsCommandActions
  );

  function buildSyllabusModuleCard(session) {
    const videos = collectSessionVideos(session);
    const docs = Array.isArray(session.files) ? session.files : [];
    const vCount = videos.length;
    const dCount = docs.length;
    const hasItems = vCount + dCount > 0;
    const isPopulated = hasItems || Boolean(session.lessonName) || Boolean(session.cleanTopic);

    const shortDate = session.date
      ? formatSessionDateVi(session.date, {includeWeekday: false})
      : 'Chưa xếp lịch';
    const fullDate = session.date
      ? formatSessionDateVi(session.date, {includeWeekday: true})
      : 'Chưa xếp lịch';

    const cardTitleText = session.lessonName
      ? session.lessonName
      : hasItems
        ? 'Tài liệu & bài giảng buổi học'
        : `Buổi ${session.sessionNumber}`;

    const indexBox = el(
      'button',
      {
        type: 'button',
        class: `syllabus-index-box${hasItems ? ' has-items' : isPopulated ? ' is-named' : ''}`,
        'aria-label': `Mở chi tiết Buổi ${session.sessionNumber}`,
        onclick: () => openSessionPage(session.sessionNumber)
      },
      el('span', {class: 'syllabus-index-label', text: 'Buổi'}),
      el('strong', {class: 'syllabus-index-num', text: String(session.sessionNumber).padStart(2, '0')})
    );

    const metaHeadRow = el(
      'div',
      {class: 'syllabus-card-meta'},
      session.cleanTopic ? el('span', {class: 'badge badge-info session-topic-chip', text: session.cleanTopic}) : null,
      el('span', {class: 'syllabus-card-date', text: fullDate, title: shortDate})
    );

    const titleHeading = el('h3', {
      class: `syllabus-card-title${session.lessonName || hasItems ? '' : ' is-unnamed'}`,
      text: cardTitleText,
      title: cardTitleText,
      onclick: () => openSessionPage(session.sessionNumber)
    });

    const resourcePills = el('div', {class: 'syllabus-resource-pills'});
    if (vCount > 0) {
      resourcePills.append(
        el(
          'button',
          {
            type: 'button',
            class: 'syllabus-resource-pill is-video',
            onclick: () => {
              pendingAutoOpenSessionMode = {classId, sessionNumber: session.sessionNumber, mode: 'lecture'};
              openSessionPage(session.sessionNumber);
            }
          },
          mediaIcon('play') || icon('practice'),
          el('span', {text: 'Video bài giảng'})
        )
      );
    }
    if (dCount > 0) {
      resourcePills.append(
        el(
          'button',
          {
            type: 'button',
            class: 'syllabus-resource-pill is-doc',
            onclick: () => {
              pendingAutoOpenSessionMode = {classId, sessionNumber: session.sessionNumber, mode: 'document'};
              openSessionPage(session.sessionNumber);
            }
          },
          icon('material'),
          el('span', {text: 'Tài liệu học tập'})
        )
      );
    }
    if (!hasItems) {
      resourcePills.append(
        el('span', {class: 'syllabus-resource-empty', text: 'Chưa đính kèm video hoặc tài liệu'})
      );
    }

    const bodyCol = el('div', {class: 'syllabus-card-body'}, metaHeadRow, titleHeading, resourcePills);

    const enterLabel = hasItems
      ? vCount > 0
        ? 'Vào học'
        : 'Xem tài liệu'
      : canWrite
        ? '+ Thêm học liệu'
        : 'Chi tiết';

    const staffMenuItems = canWrite
      ? [
          ...(workspace.lessonsEnabled
            ? [
                {
                  label: 'Đăng video bài giảng',
                  icon: 'play',
                  onSelect: () => lessonVideoCreatorModal(classId, reloadMaterials, {session, allSessions})
                }
              ]
            : []),
          {
            label: 'Tải tài liệu học tập',
            icon: 'file',
            onSelect: () => lessonFileSetCreatorModal(classId, reloadMaterials, {session, allSessions})
          },
          {
            label: 'Đổi tên / chuyên đề buổi',
            icon: 'edit',
            dividerBefore: true,
            onSelect: () => openSessionEditorModal(classId, session, allSessions, reloadMaterials)
          },
          {
            label: 'Xóa buổi học & thư mục Drive',
            icon: 'trash',
            danger: true,
            dividerBefore: true,
            onSelect: () => confirmDeleteSession(classId, session, reloadMaterials)
          }
        ]
      : [];

    const actionsCol = el(
      'div',
      {class: 'syllabus-card-actions'},
      el('button', {
        type: 'button',
        class: `syllabus-enter-btn${hasItems ? ' is-filled' : ' is-ghost'}`,
        text: enterLabel,
        onclick: () => openSessionPage(session.sessionNumber)
      }),
      staffMenuItems.length
        ? createActionMenu({
            iconOnly: true,
            ariaLabel: `Tác vụ Buổi ${session.sessionNumber}`,
            variant: 'outline',
            items: staffMenuItems
          })
        : null
    );

    return el(
      'article',
      {
        class: `materials-syllabus-card session-grid-card${isPopulated ? ' is-populated' : ' is-empty-session'}`
      },
      indexBox,
      bodyCol,
      actionsCol
    );
  }

  function renderMaterialsOverviewBody() {
    overviewBodyHost.replaceChildren();

    if (allSessions.length === 0 && !hasLegacyMaterials) {
      if (canWrite) {
        const quickActionsGrid = el(
          'div',
          {class: 'materials-quick-actions'},
          el(
            'button',
            {
              type: 'button',
              class: 'materials-quick-card',
              onclick: () => openCreateSessionModal(classId, allSessions, reloadMaterials)
            },
            el('span', {class: 'quick-card-icon is-edit', 'aria-hidden': 'true'}, icon('plus')),
            el(
              'span',
              {class: 'quick-card-text'},
              el('strong', {text: 'Tạo buổi học mới & Thư mục Drive'}),
              el('span', {
                class: 'meta',
                text: 'Tạo Buổi 1 trong lớp và khởi tạo tự động thư mục tương ứng trên Google Drive'
              })
            )
          ),
          workspace.lessonsEnabled
            ? el(
                'button',
                {
                  type: 'button',
                  class: 'materials-quick-card',
                  onclick: () => lessonVideoCreatorModal(classId, reloadMaterials, {allSessions})
                },
                el('span', {class: 'quick-card-icon is-video', 'aria-hidden': 'true'}, mediaIcon('play') || icon('practice')),
                el(
                  'span',
                  {class: 'quick-card-text'},
                  el('strong', {text: 'Đăng video bài giảng (tạo nhanh Buổi 1)'}),
                  el('span', {class: 'meta', text: 'Tải video ghi hình trực tiếp vào thư mục Buổi 1 trên Google Drive'})
                )
              )
            : null,
          el(
            'button',
            {
              type: 'button',
              class: 'materials-quick-card',
              onclick: () => lessonFileSetCreatorModal(classId, reloadMaterials, {allSessions})
            },
            el('span', {class: 'quick-card-icon is-doc', 'aria-hidden': 'true'}, icon('material')),
            el(
              'span',
              {class: 'quick-card-text'},
              el('strong', {text: 'Tải tài liệu PDF / Word (tạo nhanh Buổi 1)'}),
              el('span', {class: 'meta', text: 'Đính kèm đề cương, phiếu lý thuyết vào thư mục Buổi 1 trên Drive'})
            )
          )
        );

        overviewBodyHost.append(
          el(
            'section',
            {class: 'materials-studio-board', 'aria-label': 'Khởi tạo buổi học và đồng bộ Drive'},
            el(
              'div',
              {class: 'materials-studio-main'},
              el(
                'div',
                {class: 'materials-studio-head'},
                el('div', {class: 'notices-empty-icon-wrap is-materials-tint', 'aria-hidden': 'true'}, icon('material')),
                el(
                  'div',
                  {class: 'materials-studio-copy'},
                  el('h2', {class: 'materials-studio-title', text: 'Lớp học chưa có buổi học nào được tạo'}),
                  el('p', {
                    class: 'materials-studio-desc',
                    text: 'Tạo buổi học đầu tiên để hệ thống tự động khởi tạo thư mục riêng trên Google Drive, giúp mọi video bài giảng, tài liệu và đề BTVN lưu trữ gọn đúng buổi.'
                  })
                )
              ),
              quickActionsGrid
            ),
            el(
              'div',
              {class: 'materials-upcoming-panel'},
              buildDriveTreePreviewCard(workspace.class?.name || 'Thư mục lớp học')
            )
          )
        );
        return;
      }

      overviewBodyHost.append(
        el(
          'section',
          {class: 'materials-student-empty-board session-grid-card'},
          el(
            'div',
            {class: 'notices-empty-header'},
            el('div', {class: 'notices-empty-icon-wrap is-materials-tint', 'aria-hidden': 'true'}, icon('material')),
            el('h2', {class: 'notices-empty-title', text: 'Chưa có bài giảng hoặc tài liệu nào'}),
            el('p', {
              class: 'notices-empty-desc',
              text: 'Giáo viên chưa tạo buổi học mới cho lớp. Khi có video ghi hình hoặc tài liệu PDF được đăng tải, nội dung sẽ hiển thị tại đây.'
            })
          )
        )
      );
      return;
    }

    if (mediaPublishedSessions.length > 0) {
      const latestSession = [...mediaPublishedSessions].sort((a, b) => b.sessionNumber - a.sessionNumber)[0];
      const latestVideos = collectSessionVideos(latestSession);
      const latestDocs = Array.isArray(latestSession.files) ? latestSession.files : [];
      const latestTitle = latestSession.lessonName || 'Bài giảng & Tài liệu buổi học';
      const latestDateText = formatSessionDateVi(latestSession.date, {includeWeekday: true});

      overviewBodyHost.append(
        el(
          'section',
          {class: 'materials-spotlight-banner', 'aria-label': 'Bài giảng mới nhất'},
          el(
            'div',
            {class: 'materials-spotlight-main'},
            el(
              'div',
              {class: 'materials-spotlight-eyebrow'},
              el('span', {class: 'spotlight-eyebrow-pill', text: 'Bài giảng mới nhất'}),
              el('span', {class: 'session-num-pill is-materials has-items', text: `Buổi ${latestSession.sessionNumber}`}),
              latestSession.cleanTopic
                ? el('span', {class: 'badge badge-info session-topic-chip', text: latestSession.cleanTopic})
                : null,
              el('span', {class: 'syllabus-card-date', text: latestDateText})
            ),
            el('h2', {class: 'materials-spotlight-title', text: latestTitle}),
            el(
              'div',
              {class: 'syllabus-resource-pills'},
              latestVideos.length
                ? el('span', {class: 'syllabus-resource-pill is-video is-static'}, mediaIcon('play') || icon('practice'), el('span', {text: 'Có video bài giảng'}))
                : null,
              latestDocs.length
                ? el('span', {class: 'syllabus-resource-pill is-doc is-static'}, icon('material'), el('span', {text: 'Có tài liệu PDF / Học liệu'}))
                : null
            )
          ),
          el(
            'div',
            {class: 'materials-spotlight-actions'},
            el('button', {
              type: 'button',
              class: 'primary',
              text: 'Vào học ngay',
              onclick: () => openSessionPage(latestSession.sessionNumber)
            }),
            latestVideos.length && latestDocs.length
              ? el('button', {
                  type: 'button',
                  text: 'Mở tài liệu',
                  onclick: () => {
                    pendingAutoOpenSessionMode = {
                      classId,
                      sessionNumber: latestSession.sessionNumber,
                      mode: 'document'
                    };
                    openSessionPage(latestSession.sessionNumber);
                  }
                })
              : null
          )
        )
      );
    }

    if (allSessions.length > 0) {
      const matSearchInput = el('input', {
        type: 'search',
        class: 'notices-search-input',
        value: activeSessionSearchQuery,
        placeholder: 'Tìm tên bài giảng, chuyên đề hoặc số buổi học…',
        'aria-label': 'Tìm kiếm bài giảng và tài liệu'
      });
      const clearSearchBtn = el(
        'button',
        {
          type: 'button',
          class: 'notices-search-clear',
          'aria-label': 'Xóa từ khóa tìm kiếm',
          hidden: !String(activeSessionSearchQuery || '').trim(),
          onclick: () => {
            activeSessionSearchQuery = '';
            matSearchInput.value = '';
            clearSearchBtn.hidden = true;
            renderSyllabusList();
            matSearchInput.focus();
          }
        },
        el('span', {text: 'Xóa'})
      );

      const pillsWrap = el('div', {
        class: 'curriculum-filter-pills',
        role: 'group',
        'aria-label': 'Lọc buổi học theo định dạng học liệu'
      });

      const syllabusGrid = el('div', {class: 'materials-syllabus-grid'});

      function effectiveFilterKey() {
        if (!canWrite && activeMaterialsMediaFilter === 'no_media') return 'all';
        return activeMaterialsMediaFilter || 'all';
      }

      function renderFilterPills() {
        pillsWrap.replaceChildren();
        const curKey = effectiveFilterKey();
        const filterDefs = [
          ['all', 'Tất cả buổi học'],
          ['video', 'Có video bài giảng'],
          ['doc', 'Có tài liệu PDF'],
          ...(canWrite ? [['no_media', 'Chưa tải học liệu']] : [])
        ];
        for (const [key, labelText] of filterDefs) {
          const isAct = curKey === key;
          pillsWrap.append(
            el('button', {
              type: 'button',
              class: `curriculum-filter-pill${isAct ? ' is-active' : ''}`,
              'aria-pressed': String(isAct),
              text: labelText,
              onclick: () => {
                activeMaterialsMediaFilter = key;
                renderFilterPills();
                renderSyllabusList();
              }
            })
          );
        }
      }

      function renderSyllabusList() {
        syllabusGrid.replaceChildren();
        const curKey = effectiveFilterKey();
        const listToRender = filterSessionsByRangeAndQuery(allSessions, {
          range: 'all',
          query: activeSessionSearchQuery,
          hasContentFn: sessionHasAnyContent
        })
          .filter(s => {
            const vCount = collectSessionVideos(s).length;
            const dCount = Array.isArray(s.files) ? s.files.length : 0;
            if (curKey === 'video') return vCount > 0;
            if (curKey === 'doc') return dCount > 0;
            if (curKey === 'no_media') return vCount === 0 && dCount === 0;
            return true;
          })
          .sort((a, b) => a.sessionNumber - b.sessionNumber);

        if (!listToRender.length) {
          const resetBtn = el('button', {
            type: 'button',
            class: 'primary',
            text: 'Xem tất cả buổi học',
            onclick: () => {
              activeSessionSearchQuery = '';
              activeMaterialsMediaFilter = 'all';
              matSearchInput.value = '';
              clearSearchBtn.hidden = true;
              renderFilterPills();
              renderSyllabusList();
            }
          });
          syllabusGrid.append(
            el(
              'div',
              {class: 'session-grid-empty-wrap session-grid-card'},
              empty('Không tìm thấy buổi học hoặc bài giảng nào khớp với bộ lọc hiện tại.'),
              resetBtn
            )
          );
          return;
        }

        for (const session of listToRender) {
          syllabusGrid.append(buildSyllabusModuleCard(session));
        }
      }

      matSearchInput.addEventListener('input', () => {
        activeSessionSearchQuery = matSearchInput.value;
        clearSearchBtn.hidden = !activeSessionSearchQuery.trim();
        renderSyllabusList();
      });

      const filterToolbar = el(
        'section',
        {class: 'curriculum-filter-bar', 'aria-label': 'Tìm kiếm và lọc bài giảng'},
        el(
          'label',
          {class: 'notices-search-box'},
          searchIconSpan,
          matSearchInput,
          clearSearchBtn
        ),
        pillsWrap
      );

      renderFilterPills();
      renderSyllabusList();
      overviewBodyHost.append(filterToolbar, syllabusGrid);
    }

    if (hasLegacyMaterials) {
      overviewBodyHost.append(
        el(
          'section',
          {class: 'legacy-materials-footer-section'},
          el('h2', {class: 'curriculum-section-heading', text: 'Học liệu bổ sung'}),
          legacyMaterialsList
        )
      );
    }
  }

  filesSection.append(materialsCommandBar, overviewBodyHost);
  renderMaterialsOverviewBody();
}

async function renderSessionBasedAssignments({root, classId, canWrite, staffView, p, subPage = null}) {
  const version = viewVersion;
  const alive = () =>
    root.isConnected &&
    version === viewVersion &&
    selectedClass?.id === classId &&
    activeClassTab === 'assignments';

  const catalogData = await loadClassSessionsCatalog(classId);
  if (!alive()) return;
  syncCurriculumWorkspaceClass(classId);
  const allSessions = catalogData.sessions || [];
  const hwRoot = el('div', {class: 'assignments-sessions-page-root'});
  root.append(hwRoot);

  const reloadAssignments = async (nextSubPage = null) => {
    invalidateClassSessionsCatalogCache(classId);
    if (alive()) await refreshClass('assignments', nextSubPage ? {subPage: nextSubPage} : undefined);
  };

  const assignmentsBySession = new Map();
  const generalAssignments = [];

  for (const a of workspace.assignments || []) {
    if (a.status === 'archived' && !workspace.class?.archived) continue;
    const decoded = decodeAssignmentSessionInstructions(a.instructions || '');
    let sessionNum = decoded.sessionNumber;
    if (!sessionNum) {
      const parsedTitle = parseSessionLessonTitle(a.title || '');
      if (parsedTitle.sessionNumber) sessionNum = parsedTitle.sessionNumber;
    }
    const enriched = {
      ...a,
      cleanInstructions: decoded.cleanInstructions,
      fileIds: decoded.fileIds || [],
      sessionNumber: sessionNum
    };
    if (sessionNum && sessionNum >= 1 && sessionNum <= Math.max(allSessions.length, DEFAULT_COURSE_SESSIONS_COUNT)) {
      if (!assignmentsBySession.has(sessionNum)) assignmentsBySession.set(sessionNum, []);
      assignmentsBySession.get(sessionNum).push(enriched);
    } else {
      generalAssignments.push(enriched);
    }
  }

  function openHomeworkSessionPage(sessionNumber) {
    classView('assignments', {subPage: `buoi-${sessionNumber}`});
    window.scrollTo?.({top: 0, behavior: 'smooth'});
  }

  function getSubmissionFilesList(s) {
    if (Array.isArray(s?.files) && s.files.length) {
      return s.files.map((f, idx) => ({
        index: Number.isInteger(f.index) ? f.index : idx,
        name: f.name || `Tệp ${idx + 1}`,
        content_type: f.content_type || f.contentType || s.content_type || 'application/octet-stream',
        size: Number(f.size) || 0
      }));
    }
    const ext = SUBMISSION_ALLOWED_TYPES[s?.content_type] || 'pdf';
    return [
      {
        index: 0,
        name: s?.file_name || `bai-nop-${s?.id || 1}.${ext}`,
        content_type: s?.content_type || 'application/pdf',
        size: Number(s?.file_size) || 0
      }
    ];
  }

  function openSubmissionFeedbackModal(s, activeSubPage = null) {
    const notePreview = s.note
      ? el(
          'div',
          {class: 'submission-student-note'},
          el('strong', {text: 'Ghi chú của học sinh: '}),
          el('span', {text: s.note})
        )
      : null;
    const body = el('div', {class: 'submission-feedback-modal-body'});
    if (notePreview) body.append(notePreview);
    body.append(
      form(
        [['feedback', 'Nhận xét và điểm số của giáo viên / trợ giảng', 'textarea', s.feedback || '', {required: false}]],
        'Lưu nhận xét',
        async b => {
          await api(`/api/submissions/${s.id}/feedback`, {method: 'POST', body: b});
          $('editor').close();
          if (alive()) await refreshClass('assignments', activeSubPage ? {subPage: activeSubPage} : undefined);
        }
      )
    );
    modal(`Nhận xét bài nộp · ${person(s.uid)}`, body);
  }

  function openSubmissionPreviewModal(s, startIndex = 0, {activeSubPage = null} = {}) {
    const files = getSubmissionFilesList(s);
    if (!files.length) return;
    let activeIdx = Math.max(0, Math.min(Number(startIndex) || 0, files.length - 1));
    let closed = false;
    let activeObjectUrl = null;
    let activePdfCtrl = null;
    let activeLoadingTask = null;
    let imageDegStep = 0;

    const cleanupMedia = () => {
      activePdfCtrl?.destroy?.();
      activePdfCtrl = null;
      activeLoadingTask?.destroy?.().catch?.(() => {});
      activeLoadingTask = null;
      if (activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl);
        activeObjectUrl = null;
      }
    };

    const metaRow = el(
      'div',
      {class: 'submission-gallery-meta'},
      el('span', {class: 'meta', text: `Nộp lúc: ${fmt(s.created_at || s.submitted_at)}`}),
      el('span', {class: 'submission-file-count-chip', text: `${files.length} tệp đính kèm`}),
      s.file_size ? el('span', {class: 'meta', text: `Tổng: ${formatFileSize(s.file_size)}`}) : null
    );

    const noteCallout = s.note
      ? el(
          'div',
          {class: 'submission-student-note'},
          el('strong', {text: 'Ghi chú học sinh: '}),
          el('span', {text: s.note})
        )
      : null;
    const feedbackCallout = s.feedback
      ? el(
          'div',
          {class: 'submission-feedback'},
          el('strong', {text: 'Nhận xét GV: '}),
          el('span', {text: s.feedback})
        )
      : null;

    const tabsHost = el('div', {class: 'submission-gallery-tabs'});
    const stageHost = el('div', {class: 'submission-gallery-stage'});
    const actionsHost = el('div', {class: 'submission-gallery-actions'});
    const container = el(
      'div',
      {class: 'submission-gallery-modal'},
      metaRow,
      noteCallout,
      feedbackCallout,
      files.length > 1 ? tabsHost : null,
      stageHost,
      actionsHost
    );

    modal(`Bài nộp · ${person(s.uid)}`, container);
    $('editor').addEventListener(
      'close',
      () => {
        closed = true;
        cleanupMedia();
      },
      {once: true}
    );

    function renderTabsAndActions() {
      const currentFile = files[activeIdx] || files[0];
      if (files.length > 1) {
        const prevBtn = el(
          'button',
          {
            type: 'button',
            class: 'submission-gallery-nav-btn',
            'aria-label': 'Tệp trước',
            disabled: activeIdx <= 0,
            onclick: () => {
              if (activeIdx > 0) loadFileAt(activeIdx - 1);
            }
          },
          mediaIcon('chevronLeft')
        );
        const nextBtn = el(
          'button',
          {
            type: 'button',
            class: 'submission-gallery-nav-btn',
            'aria-label': 'Tệp tiếp theo',
            disabled: activeIdx >= files.length - 1,
            onclick: () => {
              if (activeIdx < files.length - 1) loadFileAt(activeIdx + 1);
            }
          },
          mediaIcon('chevronRight')
        );
        const pills = el(
          'div',
          {class: 'submission-gallery-pills', role: 'tablist', 'aria-label': 'Danh sách tệp bài nộp'},
          ...files.map((f, idx) =>
            el('button', {
              type: 'button',
              class: `session-item-pill${idx === activeIdx ? ' is-active' : ''}`,
              text: `${idx + 1}. ${f.name}`,
              title: f.name,
              onclick: () => {
                if (idx !== activeIdx) loadFileAt(idx);
              }
            })
          )
        );
        tabsHost.replaceChildren(prevBtn, pills, nextBtn);
      }

      const actionNodes = [
        btn(
          'Tải tệp hiện tại',
          () => download(`/api/submissions/${s.id}/file?index=${currentFile.index}`, currentFile.name, currentFile.content_type),
          false,
          'download'
        ),
        canWrite
          ? btn('Nhận xét / Chấm bài', () => openSubmissionFeedbackModal(s, activeSubPage), true, 'edit')
          : null
      ].filter(Boolean);
      actionsHost.replaceChildren(...actionNodes);
    }

    async function loadFileAt(nextIdx) {
      activeIdx = Math.max(0, Math.min(nextIdx, files.length - 1));
      imageDegStep = 0;
      const currentFile = files[activeIdx];
      renderTabsAndActions();
      cleanupMedia();

      const loadingBox = el(
        'div',
        {class: 'media-loading-card'},
        el('span', {class: 'media-spinner', 'aria-hidden': 'true'}),
        el('p', {role: 'status', text: `Đang tải "${currentFile.name}"…`})
      );
      stageHost.replaceChildren(loadingBox);

      try {
        const blob = await api(`/api/submissions/${s.id}/file?index=${currentFile.index}&inline=1`, {blob: true});
        if (closed || !container.isConnected) return;
        if (!blob || !blob.size) throw Error('Không tải được tệp bài nộp.');

        const sig = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
        const looksLikePdf =
          currentFile.content_type === 'application/pdf' ||
          /\.pdf$/i.test(currentFile.name) ||
          (sig.length === 5 && String.fromCharCode(...sig) === '%PDF-');

        if (looksLikePdf) {
          const panel = el('div', {class: 'media-viewer-panel pdf-viewer-panel is-inline', 'aria-busy': 'true'});
          stageHost.replaceChildren(panel);
          pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
          activeLoadingTask = pdfjs.getDocument({
            data: new Uint8Array(await blob.arrayBuffer()),
            isEvalSupported: false,
            disableFontFace: true,
            enableXfa: false,
            maxImageSize: 16000000,
            cMapUrl: '/pdfjs/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: '/pdfjs/standard_fonts/',
            wasmUrl: '/pdfjs/wasm/'
          });
          const doc = await activeLoadingTask.promise;
          if (closed || !panel.isConnected) return;
          activePdfCtrl = await mountDriveStylePdfViewer({
            panel,
            name: currentFile.name,
            doc,
            compact: true,
            isClosed: () => closed || !panel.isConnected,
            onDownload: () => download(`/api/submissions/${s.id}/file?index=${currentFile.index}`, currentFile.name, currentFile.content_type, {existingBlob: blob, existingPdfDoc: doc})
          });
          return;
        }

        activeObjectUrl = URL.createObjectURL(blob);
        const imgNode = el('img', {
          src: activeObjectUrl,
          alt: currentFile.name,
          class: 'submission-preview-img is-rot-0',
          draggable: false
        });
        const rotateBtn = el(
          'button',
          {
            type: 'button',
            class: 'submission-preview-rotate-btn',
            onclick: () => {
              imgNode.classList.remove(`is-rot-${(imageDegStep % 4) * 90}`);
              imageDegStep = (imageDegStep + 1) % 4;
              imgNode.classList.add(`is-rot-${(imageDegStep % 4) * 90}`);
            }
          },
          mediaIcon('rotateCw'),
          el('span', {text: 'Xoay 90°'})
        );
        const topBar = el(
          'div',
          {class: 'submission-preview-bar'},
          el('strong', {class: 'submission-preview-filename', text: currentFile.name}),
          currentFile.size ? el('span', {class: 'meta', text: formatFileSize(currentFile.size)}) : null,
          rotateBtn
        );
        const imgStage = el('div', {class: 'submission-preview-image-stage'}, imgNode);
        stageHost.replaceChildren(el('div', {class: 'submission-preview-card'}, topBar, imgStage));
      } catch (err) {
        if (!closed && stageHost.isConnected) {
          stageHost.replaceChildren(
            el(
              'div',
              {class: 'media-error-card'},
              el('p', {class: 'form-error', role: 'alert', text: friendly(err)}),
              btn(
                'Tải về máy',
                () => download(`/api/submissions/${s.id}/file?index=${currentFile.index}`, currentFile.name, currentFile.content_type),
                false,
                'download'
              )
            )
          );
        }
      }
    }

    loadFileAt(activeIdx);
  }

  function appendAssignmentSubmissionControls(container, a, isOpen, {activeSubPage = null} = {}) {
    const submissionsForAssignment = (workspace.submissions || []).filter(s => s.assignment_id === a.id);
    const hasMySubmission = Boolean(me?.uid && submissionsForAssignment.some(s => s.uid === me.uid));

    if (p.student && viewRole === 'student' && isOpen) {
      const f = el('form', {class: 'assignment-submit-form'});
      const errNode = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
      const uidSuffix = `${String(a.id || 'asn').replace(/[^A-Za-z0-9_-]/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
      const fileInputId = `sub-files-${uidSuffix}`;
      const noteInputId = `sub-note-${uidSuffix}`;

      let selectedItems = [];
      let isSubmitting = false;

      const hiddenFileInput = el('input', {
        id: fileInputId,
        type: 'file',
        name: 'files',
        multiple: true,
        accept: 'image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf',
        class: 'sr-only'
      });

      const pickBtnText = el('span', {text: 'Chọn nhiều ảnh / PDF'});
      const pickBtn = el(
        'button',
        {
          type: 'button',
          class: 'submission-pick-btn',
          onclick: () => {
            if (!isSubmitting) hiddenFileInput.click();
          }
        },
        icon('camera'),
        pickBtnText
      );

      const dropHint = el('span', {
        class: 'submission-dropzone-hint',
        text: `Chọn hoặc kéo thả tối đa ${SUBMISSION_MAX_FILES} ảnh nhỏ (JPG, PNG, WebP) / PDF · Mỗi tệp ≤ 10 MB, tổng ≤ 25 MB · Có thể dán ảnh (Ctrl+V)`
      });

      const dropZone = el(
        'div',
        {class: 'submission-dropzone'},
        hiddenFileInput,
        el('div', {class: 'submission-dropzone-actions'}, pickBtn),
        dropHint
      );

      const selectedWrap = el('div', {class: 'submission-selected-wrap', hidden: true});
      const selectedSummary = el('strong', {class: 'submission-selected-summary'});
      const clearAllBtn = el('button', {
        type: 'button',
        class: 'submission-clear-btn',
        text: 'Xóa tất cả',
        onclick: () => {
          if (isSubmitting) return;
          for (const item of selectedItems) {
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          }
          selectedItems = [];
          errNode.hidden = true;
          renderSelectedFiles();
        }
      });
      const selectedGrid = el('div', {class: 'submission-selected-grid'});
      selectedWrap.append(
        el('div', {class: 'submission-selected-header'}, selectedSummary, clearAllBtn),
        selectedGrid
      );

      const noteCounter = el('span', {
        class: 'submission-note-counter',
        text: `0 / ${SUBMISSION_MAX_NOTE_LENGTH}`
      });
      const noteInput = el('textarea', {
        id: noteInputId,
        name: 'note',
        class: 'submission-note-textarea',
        rows: 3,
        maxLength: SUBMISSION_MAX_NOTE_LENGTH,
        placeholder: 'VD: Em chụp 3 trang bài giải từ bài 20 đến bài 100, câu 45 em làm theo cách khác ạ...'
      });
      noteInput.addEventListener('input', () => {
        noteCounter.textContent = `${noteInput.value.length} / ${SUBMISSION_MAX_NOTE_LENGTH}`;
      });
      const noteField = el(
        'div',
        {class: 'submission-note-field'},
        el(
          'div',
          {class: 'submission-note-head'},
          el('label', {for: noteInputId, text: 'Ghi chú khi nộp bài (không bắt buộc)'}),
          noteCounter
        ),
        noteInput
      );

      const statusLine = el('p', {class: 'submission-upload-status', role: 'status', 'aria-live': 'polite', hidden: true});
      const submitBtn = el('button', {
        type: 'submit',
        class: 'primary wide',
        text: hasMySubmission ? 'Nộp bổ sung / Nộp lại' : 'Nộp bài tập'
      });

      function showFormError(message) {
        errNode.textContent = message;
        errNode.hidden = false;
      }

      function renderSelectedFiles() {
        const count = selectedItems.length;
        const totalSize = selectedItems.reduce((sum, item) => sum + (item.file?.size || 0), 0);
        pickBtnText.textContent = count ? `Thêm ảnh / tệp (${count}/${SUBMISSION_MAX_FILES})` : 'Chọn nhiều ảnh / PDF';
        selectedWrap.hidden = count === 0;
        selectedSummary.textContent = `Đã chọn ${count}/${SUBMISSION_MAX_FILES} tệp · ${formatFileSize(totalSize)}`;

        if (!count) {
          selectedGrid.replaceChildren();
          return;
        }

        const cards = selectedItems.map((item, idx) => {
          const thumbMedia = item.isImage && item.previewUrl
            ? el('img', {src: item.previewUrl, alt: item.file.name, class: 'submission-thumb-img', draggable: false})
            : el('div', {class: 'submission-thumb-pdf-badge'}, mediaIcon('pdf'), el('span', {text: 'PDF'}));

          const moveLeftBtn = el('button', {
            type: 'button',
            class: 'submission-thumb-act-btn',
            text: '←',
            disabled: isSubmitting || idx === 0,
            'aria-label': `Di chuyển "${item.file.name}" lên trước`,
            title: 'Chuyển lên trước',
            onclick: () => {
              if (idx <= 0 || isSubmitting) return;
              const prev = selectedItems[idx - 1];
              selectedItems[idx - 1] = selectedItems[idx];
              selectedItems[idx] = prev;
              renderSelectedFiles();
            }
          });
          const moveRightBtn = el('button', {
            type: 'button',
            class: 'submission-thumb-act-btn',
            text: '→',
            disabled: isSubmitting || idx === selectedItems.length - 1,
            'aria-label': `Di chuyển "${item.file.name}" ra sau`,
            title: 'Chuyển ra sau',
            onclick: () => {
              if (idx >= selectedItems.length - 1 || isSubmitting) return;
              const next = selectedItems[idx + 1];
              selectedItems[idx + 1] = selectedItems[idx];
              selectedItems[idx] = next;
              renderSelectedFiles();
            }
          });
          const removeBtn = el('button', {
            type: 'button',
            class: 'submission-thumb-act-btn is-remove',
            text: '×',
            disabled: isSubmitting,
            'aria-label': `Xóa "${item.file.name}" khỏi danh sách`,
            title: 'Xóa tệp',
            onclick: () => {
              if (isSubmitting) return;
              if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
              selectedItems.splice(idx, 1);
              errNode.hidden = true;
              renderSelectedFiles();
            }
          });

          return el(
            'div',
            {class: 'submission-thumb-card'},
            el(
              'div',
              {class: 'submission-thumb-media'},
              thumbMedia,
              el('span', {class: 'submission-thumb-order', text: `Trang ${idx + 1}`})
            ),
            el(
              'div',
              {class: 'submission-thumb-meta'},
              el('span', {class: 'submission-thumb-name', text: item.file.name, title: item.file.name}),
              el('span', {class: 'submission-thumb-size', text: formatFileSize(item.file.size)})
            ),
            el('div', {class: 'submission-thumb-actions'}, moveLeftBtn, moveRightBtn, removeBtn)
          );
        });
        selectedGrid.replaceChildren(...cards);
      }

      function addIncomingFiles(fileList) {
        const incoming = [...(fileList || [])].filter(Boolean);
        if (!incoming.length) return;
        errNode.hidden = true;

        const warnings = [];
        let totalSize = selectedItems.reduce((sum, item) => sum + (item.file?.size || 0), 0);

        for (const file of incoming) {
          if (selectedItems.length >= SUBMISSION_MAX_FILES) {
            warnings.push(`Chỉ được đính kèm tối đa ${SUBMISSION_MAX_FILES} tệp trong mỗi lần nộp.`);
            break;
          }
          const dup = selectedItems.some(
            item =>
              item.file.name === file.name &&
              item.file.size === file.size &&
              item.file.lastModified === file.lastModified
          );
          if (dup) continue;

          const mime = normalizeSubmissionMimeType(file.type, file.name);
          if (!mime) {
            warnings.push(`Tệp "${file.name}" không phải ảnh (JPG, PNG, WebP) hoặc PDF.`);
            continue;
          }
          if (!file.size || file.size > SUBMISSION_MAX_FILE_BYTES) {
            warnings.push(`Tệp "${file.name}" vượt quá giới hạn 10 MB/tệp.`);
            continue;
          }
          if (totalSize + file.size > SUBMISSION_MAX_TOTAL_BYTES) {
            warnings.push(`Tổng dung lượng các tệp vượt quá 25 MB.`);
            break;
          }

          totalSize += file.size;
          const isImage = mime.startsWith('image/');
          selectedItems.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            file,
            mime,
            isImage,
            previewUrl: isImage ? URL.createObjectURL(file) : null
          });
        }

        if (warnings.length) showFormError(warnings[0]);
        renderSelectedFiles();
      }

      hiddenFileInput.addEventListener('change', () => {
        addIncomingFiles(hiddenFileInput.files);
        hiddenFileInput.value = '';
      });

      dropZone.addEventListener('dragenter', ev => {
        ev.preventDefault();
        if (!isSubmitting) dropZone.classList.add('is-dragover');
      });
      dropZone.addEventListener('dragover', ev => {
        ev.preventDefault();
        if (!isSubmitting) dropZone.classList.add('is-dragover');
      });
      dropZone.addEventListener('dragleave', ev => {
        if (!dropZone.contains(ev.relatedTarget)) dropZone.classList.remove('is-dragover');
      });
      dropZone.addEventListener('drop', ev => {
        ev.preventDefault();
        dropZone.classList.remove('is-dragover');
        if (!isSubmitting && ev.dataTransfer?.files?.length) {
          addIncomingFiles(ev.dataTransfer.files);
        }
      });

      f.addEventListener('paste', ev => {
        if (isSubmitting) return;
        const pastedFiles = [...(ev.clipboardData?.files || [])].filter(
          file => file && (file.type?.startsWith('image/') || file.type === 'application/pdf')
        );
        if (pastedFiles.length) {
          ev.preventDefault();
          addIncomingFiles(pastedFiles);
        }
      });

      f.append(
        errNode,
        el('label', {class: 'submission-section-label', for: fileInputId, text: 'Đính kèm bài làm (nhiều ảnh JPG, PNG, WebP hoặc PDF)'}),
        dropZone,
        selectedWrap,
        noteField,
        statusLine,
        submitBtn
      );

      f.onsubmit = async ev => {
        ev.preventDefault();
        errNode.hidden = true;
        if (!selectedItems.length) {
          showFormError('Vui lòng chọn ít nhất 1 ảnh hoặc tệp PDF bài làm trước khi nộp.');
          errNode.focus();
          return;
        }
        const trimmedNote = noteInput.value.trim();
        if (trimmedNote.length > SUBMISSION_MAX_NOTE_LENGTH) {
          showFormError(`Ghi chú nộp bài tối đa ${SUBMISSION_MAX_NOTE_LENGTH} ký tự.`);
          noteInput.focus();
          return;
        }

        isSubmitting = true;
        submitBtn.disabled = true;
        clearAllBtn.disabled = true;
        pickBtn.disabled = true;
        noteInput.readOnly = true;
        statusLine.textContent = `Đang tải lên ${selectedItems.length} tệp bài làm…`;
        statusLine.hidden = false;
        renderSelectedFiles();

        try {
          const fd = new FormData();
          for (const item of selectedItems) {
            fd.append('files', item.file, item.file.name);
          }
          fd.append('note', trimmedNote);
          await api(`/api/assignments/${a.id}/submissions`, {method: 'POST', body: fd, timeoutMs: 60000});
          for (const item of selectedItems) {
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
          }
          selectedItems = [];
          status('Đã nộp bài tập thành công.', false, 'success');
          if (alive()) await refreshClass('assignments', activeSubPage ? {subPage: activeSubPage} : undefined);
        } catch (err) {
          errNode.textContent = friendly(err);
          errNode.hidden = false;
          errNode.focus();
        } finally {
          isSubmitting = false;
          submitBtn.disabled = false;
          clearAllBtn.disabled = false;
          pickBtn.disabled = false;
          noteInput.readOnly = false;
          statusLine.hidden = true;
          renderSelectedFiles();
        }
      };

      container.append(f);
    }

    if (submissionsForAssignment.length) {
      const subList = el('div', {class: 'assignment-submissions-list'});
      for (const s of submissionsForAssignment) {
        const files = getSubmissionFilesList(s);
        const filesStrip = files.length
          ? el(
              'div',
              {class: 'submission-files-strip'},
              ...files.map(file =>
                el(
                  'div',
                  {class: 'submission-file-pill'},
                  el(
                    'div',
                    {class: 'submission-file-pill-info'},
                    file.content_type?.startsWith('image/') ? mediaIcon('image') : mediaIcon('pdf') || icon('material'),
                    el('span', {class: 'submission-file-pill-name', text: file.name, title: file.name}),
                    file.size ? el('span', {class: 'meta', text: formatFileSize(file.size)}) : null
                  ),
                  s.status === 'stored'
                    ? el(
                        'div',
                        {class: 'submission-file-pill-actions'},
                        el('button', {
                          type: 'button',
                          class: 'submission-file-mini-btn',
                          text: 'Xem',
                          onclick: () => openSubmissionPreviewModal(s, file.index, {activeSubPage})
                        }),
                        el('button', {
                          type: 'button',
                          class: 'submission-file-mini-btn',
                          text: 'Tải',
                          onclick: () => download(`/api/submissions/${s.id}/file?index=${file.index}`, file.name, file.content_type)
                        })
                      )
                    : null
                )
              )
            )
          : null;

        const rowActions = el(
          'div',
          {class: 'actions'},
          s.status === 'stored'
            ? btn(
                files.length > 1 ? `Xem ${files.length} tệp` : 'Xem bài nộp',
                () => openSubmissionPreviewModal(s, 0, {activeSubPage}),
                false,
                'material'
              )
            : null,
          s.status === 'stored' && files.length === 1
            ? btn(
                'Tải xuống',
                () => download(`/api/submissions/${s.id}/file?index=${files[0].index}`, files[0].name, files[0].content_type),
                false,
                'download'
              )
            : null,
          canWrite
            ? btn('Nhận xét / Chấm bài', () => openSubmissionFeedbackModal(s, activeSubPage), false, 'edit')
            : null
        );

        subList.append(
          el(
            'div',
            {class: 'submission-row'},
            el(
              'div',
              {class: 'submission-info'},
              el(
                'div',
                {class: 'submission-row-head'},
                el('strong', {text: `Bài nộp: ${person(s.uid)}`}),
                el('span', {
                  class: 'submission-file-count-chip',
                  text: `${files.length} tệp${s.file_size ? ` · ${formatFileSize(s.file_size)}` : ''}`
                })
              ),
              el('span', {class: 'meta', text: `Nộp lúc: ${fmt(s.created_at || s.submitted_at)}`}),
              s.note
                ? el(
                    'div',
                    {class: 'submission-student-note'},
                    el('strong', {text: 'Ghi chú học sinh: '}),
                    el('span', {text: s.note})
                  )
                : null,
              s.feedback
                ? el(
                    'div',
                    {class: 'submission-feedback'},
                    el('strong', {text: 'Nhận xét GV: '}),
                    el('span', {text: s.feedback})
                  )
                : null,
              filesStrip
            ),
            rowActions
          )
        );
      }
      container.append(subList);
    }
  }

  function renderAssignmentItemCard(a, session, {activeSubPage = null} = {}) {
    const now = Date.now();
    const isOpen = a.status !== 'archived' && now >= a.opens_at && now < a.closes_at;
    const statusBadgeClass =
      a.status === 'archived' ? 'badge-error' : isOpen ? 'badge-success' : 'badge-warning';
    const statusBadgeText =
      a.status === 'archived' ? 'Đã lưu trữ' : isOpen ? 'Đang mở nộp bài' : 'Đã đóng hạn nộp';

    const card = el(
      'div',
      {class: 'session-assignment-item'},
      el(
        'div',
        {class: 'session-assignment-top'},
        el(
          'div',
          {class: 'lesson-card-badges'},
          el('span', {class: `badge ${statusBadgeClass}`, text: statusBadgeText}),
          el('span', {class: 'meta', text: `Mở: ${fmt(a.opens_at)} · Hạn nộp: ${fmt(a.closes_at)}`})
        ),
        canWrite
          ? btn(
              'Chỉnh sửa bài tập',
              () => contentEditor('assignments', a, {session, allSessions}),
              false,
              'edit'
            )
          : null
      ),
      el('h3', {class: 'session-assignment-title', text: a.title}),
      a.cleanInstructions
        ? el('p', {class: 'session-assignment-instructions', text: a.cleanInstructions})
        : null
    );

    appendAssignmentSubmissionControls(card, a, isOpen, {activeSubPage});

    return card;
  }

  // =========================================================================
  // TRANG RIÊNG CỦA TỪNG BUỔI BÀI TẬP (/class/<slug>/assignments/buoi-<N>)
  // =========================================================================
  const subSessionMatch = /^buoi-(\d{1,3})$/i.exec(String(subPage || '').trim());
  const activeSessionNum = subSessionMatch ? Number(subSessionMatch[1]) : null;

  if (activeSessionNum) {
    const targetSession = allSessions.find(s => s.sessionNumber === activeSessionNum);
    if (!targetSession) {
      hwRoot.append(
        el(
          'div',
          {class: 'session-empty-mode-card'},
          el('p', {text: `Không tìm thấy Buổi ${activeSessionNum} trong lộ trình lớp học.`}),
          btn('Về danh sách buổi', () => classView('assignments', {subPage: null}), true)
        )
      );
      return;
    }

    const num = targetSession.sessionNumber;
    const sortedByNum = [...allSessions].sort((a, b) => a.sessionNumber - b.sessionNumber);
    const curIdx = sortedByNum.findIndex(s => s.sessionNumber === num);
    const prevSess = curIdx > 0 ? sortedByNum[curIdx - 1] : null;
    const nextSess = curIdx >= 0 && curIdx < sortedByNum.length - 1 ? sortedByNum[curIdx + 1] : null;
    const sessionAssignments = assignmentsBySession.get(num) || [];
    const hwFiles = Array.isArray(targetSession.homeworkFiles) ? targetSession.homeworkFiles : [];
    const hasAnyHomework = hwFiles.length > 0 || sessionAssignments.length > 0;
    let activeHwDocIndex = 0;

    const dateLabel = formatSessionDateVi(targetSession.date, {
      includeWeekday: true,
      start: targetSession.start,
      end: targetSession.end
    });
    const shortDateLabel = targetSession.date
      ? formatSessionDateVi(targetSession.date, {includeWeekday: false})
      : 'Chưa xếp ngày';
    const sessionPageTitle = targetSession.lessonName
      ? `Buổi ${num}: ${targetSession.lessonName}`
      : `Buổi ${num}`;

    const hwBreadcrumbIcon = el('span', {class: 'ltch-breadcrumb-icon', 'aria-hidden': 'true'});
    hwBreadcrumbIcon.innerHTML =
      '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="6" height="6" rx="1.4"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.4"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.4"/><rect x="11.5" y="11.5" width="6" height="6" rx="1.4"/></svg>';

    const hwSessionSwitcherSelect = el(
      'select',
      {
        class: 'ltch-breadcrumb-select',
        'aria-label': 'Chuyển nhanh sang buổi bài tập khác',
        onchange: e => {
          const nextNum = Number(e.target.value);
          if (!nextNum || nextNum === num) return;
          openHomeworkSessionPage(nextNum);
        }
      },
      ...allSessions.map(s => {
        const sDate = s.date ? formatSessionDateVi(s.date, {includeWeekday: false}) : '';
        const sLabel = s.lessonName
          ? `Buổi ${s.sessionNumber}: ${s.lessonName}`
          : sDate
            ? `Buổi ${s.sessionNumber} · ${sDate}`
            : `Buổi ${s.sessionNumber}`;
        return el('option', {
          value: String(s.sessionNumber),
          selected: s.sessionNumber === num,
          text: sLabel
        });
      })
    );
    hwSessionSwitcherSelect.value = String(num);

    const hwBreadcrumbNav = el(
      'nav',
      {class: 'ltch-breadcrumb-nav', 'aria-label': 'Điều hướng bài tập theo buổi'},
      el(
        'button',
        {
          type: 'button',
          class: 'ltch-breadcrumb-root',
          onclick: () => classView('assignments', {subPage: null})
        },
        hwBreadcrumbIcon,
        el('span', {text: 'Tất cả bài tập'})
      ),
      el('span', {class: 'ltch-breadcrumb-sep', 'aria-hidden': 'true', text: '/'}),
      hwSessionSwitcherSelect
    );

    const detailNowTs = Date.now();
    const hasOpenSessionAssignment = sessionAssignments.some(
      a => a.status !== 'archived' && detailNowTs >= a.opens_at && detailNowTs < a.closes_at
    );
    const hwStatusBadge = hasOpenSessionAssignment
      ? el('span', {class: 'badge badge-success', text: 'Đang mở nộp bài'})
      : hasAnyHomework
        ? el('span', {class: 'badge badge-info', text: 'Đã giao bài tập'})
        : el('span', {class: 'badge', text: 'Chưa giao bài tập'});

    const hwTitleGroup = el(
      'div',
      {class: 'session-unboxed-title-group'},
      el('h2', {
        class: `session-unboxed-title${targetSession.lessonName ? '' : ' is-unnamed-session'}`,
        text: sessionPageTitle,
        title: sessionPageTitle
      }),
      el('span', {
        class: `session-date-badge${targetSession.customDate ? ' is-custom-date' : ''}`,
        text: shortDateLabel,
        title: dateLabel || shortDateLabel
      }),
      targetSession.cleanTopic
        ? el('span', {class: 'badge badge-info lesson-topic-badge', text: targetSession.cleanTopic})
        : null,
      hwStatusBadge
    );

    const openHomeworkUploader = () =>
      sessionHomeworkUploadModal(
        classId,
        async () => {
          await reloadAssignments(`buoi-${num}`);
        },
        {
          session: targetSession,
          allSessions,
          existingAssignment: null
        }
      );

    const staffActionsBar = canWrite ? el('div', {class: 'session-compact-staff-actions'}) : null;
    if (staffActionsBar) {
      staffActionsBar.append(
        btn('Tạo bài tập mới', openHomeworkUploader, true, 'plus'),
        createActionMenu({
          label: 'Tác vụ buổi',
          variant: 'outline',
          items: [
            {
              label: 'Ghi chú / Hạn nộp',
              icon: 'edit',
              onSelect: () => assignmentEditor({session: targetSession, allSessions})
            },
            {
              label: 'Sửa buổi',
              icon: 'calendar',
              onSelect: () =>
                openSessionEditorModal(classId, targetSession, allSessions, async () => {
                  await reloadAssignments(`buoi-${num}`);
                })
            },
            ...(p?.attendance && !(workspace?.class?.archived || selectedClass?.archived) && targetSession.date
              ? [{
                  label: 'Điểm danh buổi này',
                  icon: 'check',
                  dividerBefore: true,
                  onSelect: () => classView('attendance', {subPage: targetSession.date})
                }]
              : []),
            {
              label: 'Xóa buổi học & thư mục Drive',
              icon: 'trash',
              danger: true,
              dividerBefore: true,
              onSelect: () =>
                confirmDeleteSession(classId, targetSession, async () => {
                  await reloadAssignments(null);
                })
            }
          ]
        })
      );
    }

    const hwStepNav = el(
      'div',
      {class: 'ltch-breadcrumb-step-nav'},
      el('button', {
        type: 'button',
        class: 'ltch-step-nav-btn',
        disabled: !prevSess,
        text: '← Buổi trước',
        onclick: () => {
          if (!prevSess) return;
          openHomeworkSessionPage(prevSess.sessionNumber);
        }
      }),
      el('button', {
        type: 'button',
        class: 'ltch-step-nav-btn',
        disabled: !nextSess,
        text: 'Buổi tiếp →',
        onclick: () => {
          if (!nextSess) return;
          openHomeworkSessionPage(nextSess.sessionNumber);
        }
      })
    );

    const hwForumBtn = tabsForView(viewRole, workspace?.class || selectedClass).includes('forum')
      ? el(
          'button',
          {
            type: 'button',
            class: 'session-forum-link-btn',
            onclick: () => {
              pendingForumContext = {classId, sessionNumber: num, category: 'homework'};
              classView('forum');
              window.scrollTo?.({top: 0, behavior: 'smooth'});
            }
          },
          icon('message'),
          el('span', {text: `${staffView ? 'Thảo luận' : 'Hỏi bài'} Buổi ${num}`})
        )
      : null;

    const compactTopbar = el(
      'header',
      {class: 'session-unboxed-header'},
      el('div', {class: 'session-detail-nav-row'}, hwBreadcrumbNav, hwStepNav),
      el(
        'div',
        {class: 'session-unboxed-main-row'},
        hwTitleGroup,
        hwForumBtn || staffActionsBar
          ? el('div', {class: 'session-compact-controls'}, hwForumBtn, staffActionsBar)
          : null
      )
    );

    const hwStage = el('div', {class: 'session-inline-viewer-host'});
    let activeHwDocCleanup = null;

    function renderHomeworkStage() {
      activeHwDocCleanup?.();
      activeHwDocCleanup = null;
      hwStage.replaceChildren();

      if (!hasAnyHomework) {
        hwStage.append(
          el(
            'div',
            {class: 'session-empty-mode-card'},
            el('strong', {text: `Buổi ${num} chưa có bài tập về nhà`}),
            el('p', {
              class: 'meta',
              text: canWrite
                ? 'Nhấn nút bên dưới để đính kèm đề bài tập và thiết lập hướng dẫn, thời hạn nộp bài cho buổi học này.'
                : 'Giáo viên chưa đăng tải bài tập về nhà cho buổi học này.'
            }),
            canWrite
              ? el(
                  'div',
                  {class: 'actions'},
                  btn('Tải bài tập', openHomeworkUploader, true, 'plus')
                )
              : null
          )
        );
        return;
      }

      const activePageSlug = `buoi-${num}`;
      const assignmentsBlock = sessionAssignments.length
        ? el(
            'div',
            {class: 'session-assignments-body'},
            ...sessionAssignments.map(a => renderAssignmentItemCard(a, targetSession, {activeSubPage: activePageSlug}))
          )
        : null;

      let docsBlock = null;
      let chosenDoc = null;
      let docPath = null;
      let docMountBox = null;

      if (hwFiles.length) {
        chosenDoc = hwFiles[Math.min(activeHwDocIndex, hwFiles.length - 1)] || hwFiles[0];
        docPath = `/api/classes/${classId}/lessons/${chosenDoc.lessonId || targetSession.lessonId}/files/${chosenDoc.id}`;
        docMountBox = el('div', {class: 'session-doc-viewer-mount'});
        const showDocSelectorBar = hwFiles.length > 1 || canWrite;

        const docSelectorRow = showDocSelectorBar
          ? el(
              'div',
              {class: 'session-doc-selector-bar is-below-viewer'},
              hwFiles.length > 1
                ? el(
                    'div',
                    {class: 'session-item-pills', role: 'tablist', 'aria-label': 'Chọn file bài tập trong buổi'},
                    ...hwFiles.map((f, idx) =>
                      el('button', {
                        type: 'button',
                        class: `session-item-pill${idx === activeHwDocIndex ? ' is-active' : ''}`,
                        text: f.name || `Bài tập ${idx + 1}`,
                        onclick: () => {
                          activeHwDocIndex = idx;
                          renderHomeworkStage();
                        }
                      })
                    )
                  )
                : el(
                    'div',
                    {class: 'session-active-item-caption'},
                    mediaIcon('pdf') || icon('material'),
                    el('strong', {text: chosenDoc.name || 'Phiếu bài tập về nhà', title: chosenDoc.name || 'Phiếu bài tập về nhà'}),
                    chosenDoc.size ? el('span', {class: 'meta', text: `(${formatFileSize(chosenDoc.size)})`}) : null
                  ),
              canWrite
                ? el(
                    'button',
                    {
                      type: 'button',
                      class: 'session-file-delete-btn danger',
                      onclick: () =>
                        confirmDeleteSessionFile(classId, targetSession, chosenDoc, async () => {
                          await reloadAssignments(activePageSlug);
                        })
                    },
                    mediaIcon('trash'),
                    el('span', {text: 'Xóa tệp khỏi Drive'})
                  )
                : null
            )
          : null;

        docsBlock = el('div', {class: 'assignment-split-doc-pane'}, docMountBox, docSelectorRow);
      }

      const isSplitView = Boolean(assignmentsBlock && docsBlock);
      if (isSplitView) {
        hwStage.append(
          el(
            'div',
            {class: 'assignment-split-workspace'},
            el('div', {class: 'assignment-split-left'}, assignmentsBlock),
            el('div', {class: 'assignment-split-right'}, docsBlock)
          )
        );
      } else {
        if (assignmentsBlock) hwStage.append(assignmentsBlock);
        if (docsBlock) hwStage.append(docsBlock);
      }

      if (docMountBox && chosenDoc && docPath) {
        activeHwDocCleanup = mountInlineDocumentViewer(docMountBox, chosenDoc, docPath, alive, {
          compact: isSplitView
        });
      }
    }

    renderHomeworkStage();
    hwRoot.append(el('div', {class: 'session-dedicated-page'}, compactTopbar, hwStage));
    return;
  }

  // =========================================================================
  // TRANG CHỦ BÀI TẬP — BẢNG ĐIỀU PHỐI BÀI TẬP, HẠN NỘP & ĐỒNG BỘ DRIVE
  // =========================================================================
  const nowTs = Date.now();
  const scheduleSummaryText = String(catalogData.scheduleText || workspace.class?.schedule || '').trim();

  const allAssignedTasks = [];
  for (const a of generalAssignments) {
    allAssignedTasks.push({
      id: `assign-${a.id}`,
      kind: 'assignment',
      assignment: a,
      session: null,
      hwFiles: []
    });
  }
  for (const session of allSessions) {
    const sAssigns = assignmentsBySession.get(session.sessionNumber) || [];
    const hwFiles = Array.isArray(session.homeworkFiles) ? session.homeworkFiles : [];
    if (sAssigns.length > 0) {
      for (const a of sAssigns) {
        const assignFiles = Array.isArray(a.fileIds) && a.fileIds.length
          ? hwFiles.filter(f => a.fileIds.includes(f.id))
          : hwFiles;
        allAssignedTasks.push({
          id: `assign-${a.id}`,
          kind: 'assignment',
          assignment: a,
          session,
          hwFiles: assignFiles
        });
      }
    } else if (hwFiles.length > 0) {
      allAssignedTasks.push({
        id: `ws-${session.sessionNumber}`,
        kind: 'worksheet_only',
        assignment: null,
        session,
        hwFiles
      });
    } else if (canWrite) {
      allAssignedTasks.push({
        id: `ready-${session.sessionNumber}`,
        kind: 'ready_session',
        assignment: null,
        session,
        hwFiles: []
      });
    }
  }

  for (const task of allAssignedTasks) {
    const a = task.assignment;
    const isOpen = Boolean(a && a.status !== 'archived' && nowTs >= a.opens_at && nowTs < a.closes_at);
    const isDueSoon = Boolean(isOpen && a.closes_at - nowTs <= 48 * 3600 * 1000);
    const mySub =
      viewRole === 'student' && a
        ? (workspace.submissions || []).find(s => s.assignment_id === a.id && (!me?.uid || s.uid === me.uid)) || null
        : null;
    task.isOpen = isOpen;
    task.isDueSoon = isDueSoon;
    task.mySub = mySub;
    task.rankBucket = isOpen && !mySub
      ? 0
      : isOpen && mySub
        ? 1
        : task.kind === 'worksheet_only'
          ? 2
          : task.kind === 'ready_session'
            ? 3
            : 4;
  }

  allAssignedTasks.sort((a, b) => {
    if (a.rankBucket !== b.rankBucket) return a.rankBucket - b.rankBucket;
    if (a.rankBucket <= 1) {
      return (Number(a.assignment?.closes_at) || Infinity) - (Number(b.assignment?.closes_at) || Infinity);
    }
    if (a.rankBucket === 2) {
      return (b.session?.sessionNumber || 0) - (a.session?.sessionNumber || 0);
    }
    if (a.rankBucket === 3) {
      return (a.session?.sessionNumber || 0) - (b.session?.sessionNumber || 0);
    }
    const closesDiff = (Number(b.assignment?.closes_at) || 0) - (Number(a.assignment?.closes_at) || 0);
    if (closesDiff !== 0) return closesDiff;
    return (b.session?.sessionNumber || 0) - (a.session?.sessionNumber || 0);
  });

  const hwSearchIcon = el('span', {class: 'notices-search-icon', 'aria-hidden': 'true'});
  hwSearchIcon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  const hwBodyHost = el('div', {class: 'homework-overview-body'});

  const hwCommandActions = canWrite
    ? el(
        'div',
        {class: 'subtab-command-actions'},
        btn('Tạo buổi học mới', () => openCreateSessionModal(classId, allSessions, () => reloadAssignments()), true, 'plus')
      )
    : null;

  const hwCommandBar = el(
    'div',
    {class: 'subtab-command-bar assignments-hero-bar'},
    el(
      'div',
      {class: 'subtab-command-info'},
      el('div', {class: 'subtab-command-title-row'}, el('h1', {class: 'subtab-command-title', text: `Bài tập ${workspace.class?.name || 'lớp học'}`})),
      el('p', {
        class: 'subtab-command-subtitle',
        text: 'Phiếu bài tập về nhà đồng bộ theo từng thư mục buổi trên Google Drive, hạn nộp trực tuyến và nhận xét chấm bài.'
      })
    ),
    hwCommandActions
  );

  function buildHomeworkTaskCard(task) {
    const a = task.assignment;
    const s = task.session;
    const isOpen = task.isOpen;
    const isDueSoon = task.isDueSoon;
    const mySub = task.mySub;

    let toneClass = 'is-task-closed';
    if (task.kind === 'ready_session') {
      toneClass = 'is-ready-session';
    } else if (mySub) {
      toneClass = 'is-task-submitted';
    } else if (isOpen) {
      toneClass = isDueSoon ? 'is-task-due-soon' : 'is-task-open';
    } else if (!a) {
      toneClass = 'is-task-open';
    }

    const staffMenu = canWrite
      ? createActionMenu({
          iconOnly: true,
          ariaLabel: `Tác vụ bài tập ${a?.title || (s ? `Buổi ${s.sessionNumber}` : '')}`.trim(),
          variant: 'outline',
          items: [
            ...(a
              ? [
                  {
                    label: 'Chỉnh sửa hạn nộp / Ghi chú',
                    icon: 'edit',
                    onSelect: () => contentEditor('assignments', a, {session: s, allSessions})
                  }
                ]
              : []),
            ...(s
              ? [
                  {
                    label: task.kind === 'ready_session' ? 'Tải đề & Giao BTVN' : 'Đính kèm thêm đề BTVN',
                    icon: 'plus',
                    onSelect: () =>
                      sessionHomeworkUploadModal(classId, () => reloadAssignments(), {
                        session: s,
                        allSessions,
                        existingAssignment: a
                      })
                  },
                  {
                    label: 'Xóa buổi học & thư mục Drive',
                    icon: 'trash',
                    danger: true,
                    dividerBefore: true,
                    onSelect: () => confirmDeleteSession(classId, s, () => reloadAssignments())
                  }
                ]
              : [])
          ]
        })
      : null;

    const cardTitle = a?.title
      ? a.title
      : task.kind === 'ready_session'
        ? (s?.lessonName || `Buổi ${s?.sessionNumber || ''}`)
        : s?.lessonName
          ? `BTVN: ${s.lessonName}`
          : `Phiếu bài tập Buổi ${s?.sessionNumber || ''}`;

    const metaRight = (a?.closes_at || staffMenu)
      ? el(
          'div',
          {class: 'homework-task-meta-right'},
          a?.closes_at
            ? el('span', {
                class: `homework-deadline-chip${isDueSoon && !mySub ? ' is-urgent' : ''}`,
                text: `Hạn nộp: ${fmt(a.closes_at)}`
              })
            : null,
          staffMenu
        )
      : null;

    const topMetaRow = el(
      'div',
      {class: 'homework-task-top'},
      el('h2', {class: 'homework-task-title', text: cardTitle}),
      metaRight
    );

    const bodyStack = el(
      'div',
      {class: 'homework-task-body'},
      a?.cleanInstructions
        ? el('p', {class: 'homework-task-instructions', text: a.cleanInstructions})
        : task.kind === 'ready_session'
          ? el('p', {
              class: 'homework-task-instructions',
              text: 'Thư mục Google Drive của buổi học đã sẵn sàng. Nhấn để tải phiếu bài tập PDF/Word và mở đợt nộp bài cho học sinh.'
            })
          : null,
      task.hwFiles.length > 0 && s
        ? el(
            'div',
            {class: 'syllabus-resource-pills'},
            ...task.hwFiles.map(f =>
              el(
                'button',
                {
                  type: 'button',
                  class: 'syllabus-resource-pill is-doc',
                  onclick: () => openHomeworkSessionPage(s.sessionNumber)
                },
                icon('material'),
                el('span', {text: f.name || 'Phiếu bài tập đính kèm'})
              )
            )
          )
        : null,
      mySub?.feedback && s
        ? el(
            'div',
            {class: 'homework-feedback-callout'},
            el('strong', {text: 'Nhận xét của giáo viên: '}),
            el('span', {text: mySub.feedback})
          )
        : null
    );

    const footerEl = el('div', {class: 'homework-task-footer'});
    if ((task.kind === 'ready_session' || task.kind === 'worksheet_only') && s && canWrite) {
      footerEl.append(
        el(
          'div',
          {class: 'actions'},
          el('button', {
            type: 'button',
            class: 'primary',
            text: '+ Tải đề & Giao BTVN',
            onclick: () =>
              sessionHomeworkUploadModal(classId, () => reloadAssignments(), {
                session: s,
                allSessions
              })
          }),
          el('button', {
            type: 'button',
            text: 'Mở buổi',
            onclick: () => openHomeworkSessionPage(s.sessionNumber)
          })
        )
      );
    } else if (s && canWrite) {
      footerEl.append(
        el(
          'div',
          {class: 'actions'},
          el('button', {
            type: 'button',
            class: 'primary',
            text: 'Mở trang thu & chấm bài',
            onclick: () => openHomeworkSessionPage(s.sessionNumber)
          }),
          el('button', {
            type: 'button',
            text: '+ Tạo bài tập mới',
            onclick: () =>
              sessionHomeworkUploadModal(classId, () => reloadAssignments(), {
                session: s,
                allSessions,
                existingAssignment: null
              })
          })
        )
      );
    } else if (s) {
      let actionLabel = 'Xem chi tiết bài tập';
      let isPrimaryCta = false;
      if (viewRole === 'student') {
        if (isOpen && !mySub) {
          actionLabel = 'Nộp bài';
          isPrimaryCta = true;
        } else if (mySub) {
          actionLabel = 'Xem bài đã nộp';
        } else {
          actionLabel = 'Xem đề bài tập';
        }
      }
      footerEl.append(
        el('button', {
          type: 'button',
          class: isPrimaryCta ? 'primary' : '',
          text: actionLabel,
          onclick: () => openHomeworkSessionPage(s.sessionNumber)
        })
      );
    } else if (a) {
      appendAssignmentSubmissionControls(footerEl, a, isOpen);
    }

    return el(
      'article',
      {class: `homework-task-card session-grid-card ${toneClass}${!s ? ' is-general-task' : ''}`},
      topMetaRow,
      bodyStack.childNodes.length ? bodyStack : null,
      footerEl.childNodes.length ? footerEl : null
    );
  }

  function renderHomeworkOverviewBody() {
    hwBodyHost.replaceChildren();

    if (allSessions.length === 0 && generalAssignments.length === 0) {
      if (canWrite) {
        const workflowSteps = el(
          'div',
          {class: 'homework-workflow-steps'},
          el(
            'div',
            {class: 'homework-workflow-step'},
            el('span', {class: 'workflow-step-badge', text: 'Bước 1'}),
            el(
              'div',
              {class: 'workflow-step-copy'},
              el('strong', {text: 'Tạo buổi học & Thư mục Drive'}),
              el('span', {text: 'Tạo Buổi 1 trên website để tự khởi tạo thư mục lớp trên Google Drive'})
            )
          ),
          el(
            'div',
            {class: 'homework-workflow-step'},
            el('span', {class: 'workflow-step-badge', text: 'Bước 2'}),
            el(
              'div',
              {class: 'workflow-step-copy'},
              el('strong', {text: 'Tải phiếu BTVN & Đặt hạn nộp'}),
              el('span', {text: 'Tệp bài tập lưu trực tiếp vào thư mục Buổi tương ứng trên Drive'})
            )
          ),
          el(
            'div',
            {class: 'homework-workflow-step'},
            el('span', {class: 'workflow-step-badge', text: 'Bước 3'}),
            el(
              'div',
              {class: 'workflow-step-copy'},
              el('strong', {text: 'Thu bài & Chấm nhận xét'}),
              el('span', {text: 'Xem bài làm học sinh nộp lên và gửi lời phê trực tiếp'})
            )
          )
        );

        hwBodyHost.append(
          el(
            'section',
            {class: 'homework-studio-board', 'aria-label': 'Bảng điều phối giao bài tập và liên kết Drive'},
            el(
              'div',
              {class: 'homework-studio-main'},
              el(
                'div',
                {class: 'materials-studio-head'},
                el('div', {class: 'notices-empty-icon-wrap is-homework-tint', 'aria-hidden': 'true'}, icon('assignment')),
                el(
                  'div',
                  {class: 'materials-studio-copy'},
                  el('h2', {class: 'materials-studio-title', text: 'Lớp học chưa có buổi học hoặc bài tập nào'}),
                  el('p', {
                    class: 'materials-studio-desc',
                    text: 'Tạo buổi học đầu tiên hoặc giao nhanh phiếu BTVN để tự động khởi tạo thư mục trên Google Drive và mở cổng nộp bài trực tuyến cho học sinh.'
                  })
                )
              ),
              workflowSteps,
              el(
                'div',
                {class: 'homework-studio-cta-row'},
                btn('Tạo Buổi 1 & Thư mục Drive', () => openCreateSessionModal(classId, allSessions, () => reloadAssignments()), true, 'plus'),
                btn(
                  'Giao bài tập Buổi 1',
                  () => sessionHomeworkUploadModal(classId, () => reloadAssignments(), {allSessions}),
                  false,
                  'material'
                ),
                btn(
                  'Bài tập chung',
                  () => assignmentEditor({allSessions}),
                  false,
                  'edit'
                )
              )
            ),
            el(
              'div',
              {class: 'homework-quick-sessions-panel'},
              buildDriveTreePreviewCard(workspace.class?.name || 'Thư mục lớp học')
            )
          )
        );
        return;
      }

      hwBodyHost.append(
        el(
          'section',
          {class: 'homework-student-zero-card session-grid-card'},
          el('div', {class: 'notices-empty-icon-wrap is-homework-zero-tint', 'aria-hidden': 'true'}, icon('assignment')),
          el('h2', {class: 'notices-empty-title', text: 'Hiện chưa có bài tập về nhà nào cần nộp'}),
          el('p', {
            class: 'notices-empty-desc',
            text: 'Lớp học hiện chưa có phiếu bài tập tự luyện hoặc đợt nộp bài đang mở. Khi giáo viên giao bài mới, đề bài và hạn nộp sẽ hiển thị ngay tại đây.'
          }),
          scheduleSummaryText
            ? el(
                'p',
                {class: 'homework-zero-schedule'},
                icon('attendance'),
                el('span', {text: `Lịch cố định: ${scheduleSummaryText}`})
              )
            : null
        )
      );
      return;
    }

    if (allAssignedTasks.length === 0) {
      hwBodyHost.append(
        el(
          'section',
          {class: 'homework-student-zero-card session-grid-card'},
          el('div', {class: 'notices-empty-icon-wrap is-homework-zero-tint', 'aria-hidden': 'true'}, icon('assignment')),
          el('h2', {class: 'notices-empty-title', text: 'Hiện chưa có bài tập về nhà nào cần nộp'}),
          el('p', {
            class: 'notices-empty-desc',
            text: 'Giáo viên chưa giao phiếu bài tập cho các buổi học vừa tạo. Khi có đề bài mới hoặc hạn nộp mở, thông tin sẽ hiển thị ngay tại đây.'
          }),
          scheduleSummaryText
            ? el(
                'p',
                {class: 'homework-zero-schedule'},
                icon('attendance'),
                el('span', {text: `Lịch cố định: ${scheduleSummaryText}`})
              )
            : null
        )
      );
      return;
    }

    // Chế độ Bảng Bài tập khi lớp đã có buổi học hoặc BTVN
    let hwQuery = '';
    const taskSearchInput = el('input', {
      type: 'search',
      class: 'notices-search-input',
      placeholder: 'Tìm tên bài tập, hướng dẫn hoặc số buổi học…',
      'aria-label': 'Tìm kiếm bài tập về nhà'
    });
    const clearTaskSearchBtn = el(
      'button',
      {
        type: 'button',
        class: 'notices-search-clear',
        'aria-label': 'Xóa từ khóa tìm kiếm',
        hidden: true,
        onclick: () => {
          hwQuery = '';
          taskSearchInput.value = '';
          clearTaskSearchBtn.hidden = true;
          renderTaskCards();
          taskSearchInput.focus();
        }
      },
      el('span', {text: 'Xóa'})
    );

    const statusPillsWrap = el('div', {
      class: 'curriculum-filter-pills',
      role: 'group',
      'aria-label': 'Lọc bài tập theo trạng thái'
    });
    const boardGrid = el('div', {class: 'homework-board-grid'});

    const statusFilterDefs = [
      ['all', 'Tất cả buổi & BTVN'],
      ['open', 'Đang mở nộp'],
      ...(viewRole === 'student'
        ? [
            ['unsubmitted', 'Chưa nộp'],
            ['submitted', 'Đã nộp & Nhận xét']
          ]
        : [
            ['unassigned', 'Chưa giao BTVN'],
            ['closed', 'Đã đóng hạn']
          ])
    ];

    function effectiveHwFilterKey() {
      const validKeys = new Set(statusFilterDefs.map(([k]) => k));
      return validKeys.has(activeHomeworkStatusFilter) ? activeHomeworkStatusFilter : 'all';
    }

    function renderStatusPills() {
      statusPillsWrap.replaceChildren();
      const curKey = effectiveHwFilterKey();
      for (const [key, labelText] of statusFilterDefs) {
        const isAct = curKey === key;
        statusPillsWrap.append(
          el('button', {
            type: 'button',
            class: `curriculum-filter-pill${isAct ? ' is-active' : ''}`,
            'aria-pressed': String(isAct),
            text: labelText,
            onclick: () => {
              activeHomeworkStatusFilter = key;
              renderStatusPills();
              renderTaskCards();
            }
          })
        );
      }
    }

    function renderTaskCards() {
      boardGrid.replaceChildren();
      const q = hwQuery.trim().toLowerCase();
      const curKey = effectiveHwFilterKey();
      const matching = allAssignedTasks.filter(t => {
        if (curKey === 'open' && !t.isOpen) return false;
        if (curKey === 'unsubmitted' && !(t.isOpen && !t.mySub)) return false;
        if (curKey === 'submitted' && !t.mySub) return false;
        if (curKey === 'unassigned' && t.kind !== 'ready_session') return false;
        if (curKey === 'closed' && (t.isOpen || t.kind !== 'assignment')) return false;
        if (!q) return true;
        const hay = [
          t.assignment?.title || '',
          t.assignment?.cleanInstructions || '',
          t.session ? `buổi ${t.session.sessionNumber}` : 'bài tập chung',
          t.session ? `buoi ${t.session.sessionNumber}` : '',
          t.session?.lessonName || '',
          ...t.hwFiles.map(f => f.name || '')
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });

      if (!matching.length) {
        const resetBtn = el('button', {
          type: 'button',
          class: 'primary',
          text: 'Xem tất cả buổi & BTVN',
          onclick: () => {
            hwQuery = '';
            activeHomeworkStatusFilter = 'all';
            taskSearchInput.value = '';
            clearTaskSearchBtn.hidden = true;
            renderStatusPills();
            renderTaskCards();
          }
        });
        boardGrid.append(
          el(
            'div',
            {class: 'session-grid-empty-wrap session-grid-card'},
            empty('Không có bài tập hoặc buổi học nào khớp bộ lọc hiện tại.'),
            resetBtn
          )
        );
        return;
      }

      for (const task of matching) {
        boardGrid.append(buildHomeworkTaskCard(task));
      }
    }

    taskSearchInput.addEventListener('input', () => {
      hwQuery = taskSearchInput.value;
      clearTaskSearchBtn.hidden = !hwQuery.trim();
      renderTaskCards();
    });

    const boardToolbar = el(
      'section',
      {class: 'homework-filter-toolbar curriculum-filter-bar', 'aria-label': 'Tìm kiếm và lọc bài tập'},
      el('label', {class: 'notices-search-box'}, hwSearchIcon, taskSearchInput, clearTaskSearchBtn),
      statusPillsWrap
    );
    renderStatusPills();
    renderTaskCards();
    hwBodyHost.append(boardToolbar, boardGrid);
  }

  hwRoot.append(hwCommandBar, hwBodyHost);
  renderHomeworkOverviewBody();
}

async function renderLessonFiles(area,classId,lesson,canWrite,alive){
  const list=el('div',{class:'lesson-file-list'}),footer=el('div',{class:'actions'});
  const filesToolbar=el('div',{class:'lesson-files-toolbar'},
    el('span',{class:'lesson-files-caption'},mediaIcon('folder'),el('span',{text:'Danh sách File Lý thuyết / Bài tập đính kèm'}))
  );
  if(canWrite)filesToolbar.append(btn('Thêm tệp',()=>lessonFilesEditor(classId,lesson,async()=>{
    if(alive()){area.replaceChildren();await renderLessonFiles(area,classId,lesson,canWrite,alive);}
  }),false,'plus'));
  area.append(filesToolbar,list,footer);
  async function load(query=''){
    const page=await api(`/api/classes/${classId}/lessons/${lesson.id}/files${query}`);
    if(!alive()||!area.isConnected)return;
    if(!query&&!page.items.length)list.append(empty('Mục này chưa có tệp đính kèm.'));
    for(const file of page.items){
      if(/^__ltch_cover__/i.test(String(file.name||'')))continue;
      const path=`/api/classes/${classId}/lessons/${lesson.id}/files/${file.id}`;
      const fileInfo=classifyLessonFile(file.name,file.content_type);
      const sizeText=formatFileSize(file.file_size);
      const metaItems=[
        el('span',{class:`file-type-badge file-type-${fileInfo.kind}`,text:fileInfo.badge}),
        el('span',{class:'lesson-file-kind-label',text:fileInfo.label}),
        sizeText?el('span',{class:'lesson-file-size',text:sizeText}):null,
        file.created_at?el('span',{class:'lesson-file-date',text:fmt(file.created_at)}):null
      ];
      const fileActions=el('div',{class:'actions lesson-file-actions'});
      let hasViewBtn=false;
      if(fileInfo.kind==='video'){
        fileActions.append(
          el('button',{
            type:'button',
            class:'media-lecture-trigger',
            onclick:()=>previewDriveVideoLecture(file.name,lesson.title,path)
          },mediaIcon('play'),el('span',{text:'Xem bài giảng'}))
        );
      }else if(file.content_type==='application/pdf'){
        fileActions.append(btn('Xem PDF',()=>previewPdf(path,file.name),false,'material'));
        hasViewBtn=true;
      }else if(workspace.lessonsLinkPreview){
        fileActions.append(btn('Xem tài liệu',()=>previewDriveFile(path,file.name,file.content_type),false,'material'));
        hasViewBtn=true;
      }
      if(fileInfo.kind!=='video'){
        if(hasViewBtn){
          fileActions.append(createActionMenu({
            iconOnly:true,
            ariaLabel:`Thao tác tệp ${file.name}`,
            items:[{label:'Tải về máy',icon:'download',onSelect:()=>download(path,file.name,'')}]
          }));
        }else{
          fileActions.append(btn('Tải về máy',()=>download(path,file.name,''),false,'download'));
        }
      }

      list.append(
        el('div',{class:'lesson-file-row'},
          el('div',{class:'lesson-file-info'},
            el('div',{class:`lesson-file-icon file-type-${fileInfo.kind}`},mediaIcon(fileInfo.iconName)),
            el('div',{class:'lesson-file-text'},
              el('strong',{class:'lesson-file-name',text:file.name}),
              el('div',{class:'lesson-file-meta'},...metaItems)
            )
          ),
          fileActions
        )
      );
    }
    footer.replaceChildren();
    if(page.hasMore&&page.items.length){const last=page.items.at(-1),params=new URLSearchParams({beforeCreatedAt:String(last.created_at),beforeId:last.id});footer.append(btn('Xem tệp cũ hơn',()=>load(`?${params}`)));}
  }
  try{await load();}catch(error){if(alive()&&area.isConnected)footer.replaceChildren(el('p',{class:'form-error',role:'alert',text:friendly(error)}),btn('Thử lại',()=>load()));}
}

async function previewDriveFile(path,name,type){
  const panel=el('div',{class:'drive-preview-panel media-viewer-panel','aria-busy':'true'},
    el('div',{class:'media-loading-card'},
      el('span',{class:'media-spinner','aria-hidden':'true'}),
      el('p',{role:'status',text:'Đang mở tài liệu trên Google Drive…'})
    )
  );
  modal(name,panel);
  async function load(method='GET'){
    panel.setAttribute('aria-busy','true');
    try{
      const result=await api(`${path}/preview`,{method});
      const url=new URL(result.url);
      if(url.origin!=='https://drive.google.com'||!/^\/file\/d\/[A-Za-z0-9_-]{1,200}\/preview$/.test(url.pathname)||url.search||url.hash)throw Error('Địa chỉ tài liệu không hợp lệ.');
      if(!panel.isConnected||!$('editor').open)return;
      populateDrivePreviewPanel({
        panel,
        urlHref:url.href,
        path,
        name,
        type,
        onDownload:download,
        onPreviewPdf:previewPdf,
        onReload:()=>load('GET')
      });
    }catch(error){
      if(!panel.isConnected)return;
      const message=el('p',{class:'form-error',role:'alert',text:friendly(error)});
      const actions=el('div',{class:'actions'});
      if(type==='application/pdf')actions.append(btn('Xem PDF trên website',()=>previewPdf(path,name),false,'material'));
      actions.append(btn('Tải về máy',()=>download(path,name,''),false,'download'));
      if(error.status===409&&me?.roles?.includes('admin')&&viewRole==='admin'){
        const warning=el('p',{class:'notice',text:'Bật xem qua liên kết cho phép bất kỳ ai có liên kết xem và chia sẻ tệp, kể cả người không thuộc lớp.'});
        const consent=el('input',{type:'checkbox'}),activate=btn('Bật xem qua liên kết',()=>load('POST'),true);
        activate.disabled=true;consent.addEventListener('change',()=>{activate.disabled=!consent.checked;});
        panel.replaceChildren(el('div',{class:'media-error-card'},message,warning,el('label',{class:'check'},consent,'Tôi đồng ý cho phép xem tệp bằng liên kết.'),activate,actions));
      }else panel.replaceChildren(el('div',{class:'media-error-card'},message,actions));
    }finally{if(panel.isConnected)panel.setAttribute('aria-busy','false');}
  }
  await load();
}

async function previewPdf(path,name){
  const panel=el('div',{class:'media-viewer-panel pdf-viewer-panel','aria-busy':'true'},
    el('div',{class:'media-loading-card'},
      el('span',{class:'media-spinner','aria-hidden':'true'}),
      el('p',{role:'status',text:'Đang tải tài liệu…'})
    )
  );
  modal(name,panel);
  let loadingTask,closed=false,keyHandler=null,viewerCtrl=null;
  $('editor').addEventListener('close',()=>{
    closed=true;
    if(keyHandler)document.removeEventListener('keydown',keyHandler);
    viewerCtrl?.destroy?.();
    loadingTask?.destroy().catch(()=>{});
  },{once:true});
  try{
    const blob=await api(path,{blob:true});
    const signature=new Uint8Array(await blob.slice(0,5).arrayBuffer());
    if(blob.size>MAX_DOCUMENT_UPLOAD_BYTES||signature.length!==5||String.fromCharCode(...signature)!=='%PDF-')throw Error('Tệp không có định dạng PDF hợp lệ.');
    if(closed||!panel.isConnected||!$('editor').open)return;
    pdfjs.GlobalWorkerOptions.workerSrc='/pdfjs/pdf.worker.min.mjs';
    loadingTask=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false,disableFontFace:true,enableXfa:false,maxImageSize:16000000,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'});
    const doc=await loadingTask.promise;if(closed)return;
    viewerCtrl=await mountDriveStylePdfViewer({
      panel,
      name,
      doc,
      isClosed:()=>closed,
      onDownload:()=>download(path,name,'',{existingBlob:blob,existingPdfDoc:doc})
    });
    keyHandler=event=>{
      if(closed||!$('editor').open||!viewerCtrl)return;
      if(event.target?.matches?.('input,textarea,select,button'))return;
      if((event.ctrlKey||event.metaKey)&&(event.key==='='||event.key==='+')){event.preventDefault();viewerCtrl.stepZoom(1);}
      else if((event.ctrlKey||event.metaKey)&&event.key==='-'){event.preventDefault();viewerCtrl.stepZoom(-1);}
      else if((event.ctrlKey||event.metaKey)&&event.key==='0'){event.preventDefault();viewerCtrl.applyZoom('100');}
      else if(event.key==='ArrowLeft'||event.key==='PageUp'){event.preventDefault();viewerCtrl.scrollToPage(viewerCtrl.getCurrentPage()-1);}
      else if(event.key==='ArrowRight'||event.key==='PageDown'){event.preventDefault();viewerCtrl.scrollToPage(viewerCtrl.getCurrentPage()+1);}
    };
    document.addEventListener('keydown',keyHandler);
  }catch(error){if(panel.isConnected){panel.setAttribute('aria-busy','false');panel.replaceChildren(el('div',{class:'media-error-card'},el('p',{class:'form-error',role:'alert',text:friendly(error)}),btn('Tải về máy',()=>download(path,name,''),false,'download')));}}
}

function lessonFilesEditor(classId,lesson,onSaved){
  let entries=[];
  const picker=field('files','Chọn một hoặc nhiều tệp, mỗi tệp tối đa 100 MB','file','',{multiple:true});
  const notice=el('p',{class:'meta',role:'status','aria-live':'polite',text:'PDF, Word và các định dạng tệp khác.'});
  const sharing=el('p',{class:'meta',text:'Tệp được lưu trữ trên Google Drive của lớp và bảo mật nội bộ, chặn chia sẻ liên kết ra ngoài.'});
  const error=el('p',{class:'form-error',role:'alert',tabIndex:-1,hidden:true});
  const submit=el('button',{type:'submit',class:'primary wide',text:'Tải tệp lên'});
  const f=el('form',{},error,picker.label,notice,sharing,submit);
  picker.input.addEventListener('change',()=>{entries=[...picker.input.files].map(file=>({file,done:false}));error.hidden=true;notice.textContent=`Đã chọn ${entries.length} tệp.`;});
  f.onsubmit=async event=>{
    event.preventDefault();submit.disabled=true;picker.input.disabled=true;error.hidden=true;
    try{
      if(!entries.length||entries.some(entry=>!entry.file.size||entry.file.size>MAX_DOCUMENT_UPLOAD_BYTES))throw Error('Chọn tệp có dữ liệu, mỗi tệp tối đa 100 MB.');
      for(let i=0;i<entries.length;i++){
        const entry=entries[i];if(entry.done)continue;
        notice.textContent=`Đang chuẩn bị tệp ${i+1}/${entries.length}: ${entry.file.name}`;
        entry.retry ??= await lessonUploadRetry.prepare({uid:auth.currentUser.uid,classId,lessonId:lesson.id,file:entry.file});
        notice.textContent=`Đang tải tệp ${i+1}/${entries.length}: ${entry.file.name}`;
        await uploadLessonDocumentFile({
          classId,
          lessonId:lesson.id,
          file:entry.file,
          retry:entry.retry,
          onProgress:pct=>{notice.textContent=`Đang tải tệp ${i+1}/${entries.length}: ${entry.file.name} (${pct}%)…`;}
        });
        entry.done=true;lessonUploadRetry.complete(entry.retry.key);
      }
      $('editor').close();await onSaved();status('Đã lưu các tệp vào Drive.',false,'success');
    }catch(e){
      notice.textContent=entries.length?`Đã xác nhận ${entries.filter(entry=>entry.done).length}/${entries.length} tệp. Bạn có thể thử lại các tệp còn lại.`:'PDF, Word và các định dạng tệp khác.';
      const canReload=entries.some(entry=>!entry.done&&entry.retry?.persisted);
      error.textContent=`${friendly(e)} ${canReload?'Thử lại tại đây; nếu tải lại trang, hãy chọn lại đúng tệp trong cùng tab.':'Giữ cửa sổ này và thử lại để tránh tạo tệp trùng.'}`;error.hidden=false;error.focus();
    }
    finally{submit.disabled=false;picker.input.disabled=false;}
  };
  modal(`Thêm tệp · ${lesson.title}`,f);
}

let cachedProfileForWatermark = null;
let cachedProfileForWatermarkUid = null;

async function ensureWatermarkProfileLoaded() {
  const currentUid = me?.uid || auth.currentUser?.uid || null;
  if (!currentUid) return null;
  if (me?.studentCode || me?.student_code) return null;
  if (cachedProfileForWatermark && cachedProfileForWatermarkUid === currentUid) {
    return cachedProfileForWatermark;
  }
  try {
    const res = await api('/api/profile');
    cachedProfileForWatermark = res?.profile || res || null;
    cachedProfileForWatermarkUid = currentUid;
    return cachedProfileForWatermark;
  } catch {
    return null;
  }
}

async function download(path, name, type, {existingBlob = null, existingPdfDoc = null} = {}) {
  try {
    status('Đang chuẩn bị tài liệu tải xuống…', false, 'loading');
    const [rawBlob, profile] = await Promise.all([
      existingBlob instanceof Blob ? Promise.resolve(existingBlob) : api(path, {blob: true}),
      ensureWatermarkProfileLoaded()
    ]);
    const watermarkText = resolveUserWatermarkText({
      me,
      profile,
      workspace,
      viewRole
    });
    const result = await watermarkDownloadedBlob(rawBlob, {
      watermarkText,
      fileName: name,
      contentType: type || rawBlob?.type || '',
      pdfjs,
      existingPdfDoc,
      onProgress: (pageNum, numPages) => {
        if (numPages > 1) {
          status(`Đang chuẩn bị tài liệu (trang ${pageNum}/${numPages})…`, false, 'loading');
        }
      }
    });
    const finalBlob = result?.blob instanceof Blob ? result.blob : (result instanceof Blob ? result : rawBlob);
    const extMap = {'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'};
    const ext = extMap[type] || extMap[finalBlob?.type] || '';
    const safeName = String(name || 'tai-lieu').trim();
    const downloadName = ext && !safeName.toLowerCase().endsWith(ext) ? `${safeName}${ext}` : safeName;
    const url = URL.createObjectURL(finalBlob);
    const a = el('a', {
      href: url,
      download: downloadName
    });
    document.body.append(a);
    a.click();
    a.remove();
    status('Đã tải tài liệu xuống máy.', false, 'success');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    status(friendly(err), true);
  }
}

function assignmentEditor({session = null, allSessions = null} = {}) {
  const start = Date.now(), end = start + 7 * 86400000;
  const sessionItems = Array.isArray(allSessions) && allSessions.length
    ? allSessions.map(s => ({
        value: String(s.sessionNumber),
        label: `Buổi ${s.sessionNumber}${s.date ? ` (${formatSessionDateVi(s.date)})` : ''}${s.lessonName ? ` · ${s.lessonName}` : ''}`
      }))
    : Array.from({length: DEFAULT_COURSE_SESSIONS_COUNT}, (_, idx) => ({
        value: String(idx + 1),
        label: `Buổi ${idx + 1}`
      }));

  const defaultSessionNum = String(session?.sessionNumber || 1);
  const defaultTitle = session?.lessonName
    ? `BTVN Buổi ${session.sessionNumber}: ${session.lessonName}`
    : session
      ? `Bài tập về nhà Buổi ${session.sessionNumber}`
      : '';

  modal(
    session ? `Giao bài tập · Buổi ${session.sessionNumber}` : 'Giao bài tập theo Buổi học',
    form(
      [
        ['sessionNumber', 'Thuộc buổi học', 'select', defaultSessionNum, {items: sessionItems}],
        ['lessonName', 'Tên buổi học (cập nhật nếu buổi chưa đặt tên)', 'text', session?.lessonName || '', {
          required: false,
          maxLength: 180,
          placeholder: 'VD: Khảo sát sự biến thiên và vẽ đồ thị hàm số'
        }],
        ['title', 'Tên bài tập về nhà', 'text', defaultTitle, {
          placeholder: 'VD: Phiếu bài tập về nhà Buổi 1'
        }],
        ['instructions', 'Hướng dẫn làm bài', 'textarea', '', {
          required: false,
          placeholder: 'Các yêu cầu, bài tập trong sách hoặc phiếu bài tập đính kèm...'
        }],
        ['opensAt', 'Mở nộp bài từ', 'datetime-local', localTime(start)],
        ['closesAt', 'Hạn chót nộp bài', 'datetime-local', localTime(end)]
      ],
      'Giao bài tập cho cả lớp',
      async b => {
        const chosenNum = Number(b.sessionNumber) || session?.sessionNumber || 1;
        const chosenLessonId = lessonSessionId(selectedClass.id, chosenNum);
        if (b.lessonName && b.lessonName.trim()) {
          try {
            await api(`/api/classes/${selectedClass.id}/sessions`, {
              method: 'POST',
              body: {
                action: 'ensure_session',
                sessionNumber: chosenNum,
                lessonName: b.lessonName.trim()
              }
            });
          } catch {}
        }
        const payload = {
          title: b.title,
          instructions: encodeAssignmentSessionInstructions({
            sessionNumber: chosenNum,
            lessonId: chosenLessonId,
            cleanInstructions: b.instructions || ''
          }),
          opensAt: new Date(b.opensAt).getTime(),
          closesAt: new Date(b.closesAt).getTime()
        };
        await api(`/api/classes/${selectedClass.id}/assignments`, {method: 'POST', body: payload});
        $('editor').close();
        await refreshClass('assignments');
      }
    )
  );
}

const EXAM_TRACK_LABELS = {
  thptqg: 'THPTQG',
  hsa: 'HSA',
  tsa: 'TSA',
  past: 'Kho đề cũ'
};

let pendingAutoOpenExamSolutionMode = null; // { examId, mode: 'lecture' | 'document' }

function examSolutionVideoModal(exam, onSaved) {
  let selectedFile = null;
  const uploadState = {session: null};
  const examLabel = EXAM_TRACK_LABELS[exam.examType] || 'Phòng luyện';

  const titleField = field('title', 'Tên video chữa hiển thị (để trống nếu giữ tên tệp gốc)', 'text', '', {
    required: false,
    maxLength: 180,
    placeholder: 'VD: Video chữa chi tiết Đề số 01'
  });
  const picker = field('videoFile', 'Chọn tệp Video chữa (.mp4, .mov, .webm, .mkv – tối đa 5 GB)', 'file', '', {
    required: true,
    accept: 'video/mp4,video/webm,video/quicktime,video/x-matroska,video/*,.mp4,.mov,.webm,.mkv,.m4v'
  });

  const itemBanner = el('div', {class: 'notice session-modal-banner'},
    el('strong', {text: exam.title || `Đề ${exam.examCode || '01'}`}),
    el('p', {class: 'meta', text: `Video chữa được lưu chung vào thư mục Google Drive của đề này (${examLabel} / Video chữa).`})
  );

  const notice = el('p', {
    class: 'meta',
    role: 'status',
    'aria-live': 'polite',
    text: 'Video sẽ được tải thẳng vào thư mục Video chữa của đề trên Google Drive và phát trực tiếp ngay trên trang web.'
  });
  const progressWrap = el('div', {class: 'video-upload-progress', hidden: true});
  const progressBar = el('progress', {class: 'video-upload-meter', max: '100', value: '0'});
  const progressLabel = el('p', {class: 'meta video-upload-status', role: 'status', 'aria-live': 'polite', text: 'Đang chuẩn bị tải video…'});
  progressWrap.append(progressBar, progressLabel);

  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const submit = el('button', {type: 'submit', class: 'primary wide psol-modal-submit', text: 'Lưu video bài chữa'});
  const f = el('form', {}, itemBanner, error, titleField.label, picker.label, progressWrap, notice, submit);

  picker.input.addEventListener('change', () => {
    selectedFile = picker.input.files?.[0] || null;
    uploadState.session = null;
    error.hidden = true;
    notice.textContent = selectedFile
      ? `Đã chọn video: ${selectedFile.name} (${formatFileSize(selectedFile.size)})`
      : 'Video sẽ được tải thẳng vào thư mục Video chữa của đề trên Google Drive và phát trực tiếp ngay trên trang web.';
  });

  f.onsubmit = async event => {
    event.preventDefault();
    if (!validateFormFields(f, error)) return;
    submit.disabled = true;
    titleField.input.disabled = true;
    picker.input.disabled = true;
    error.hidden = true;
    try {
      const maxVideoSize = 5 * 1024 * 1024 * 1024;
      if (!selectedFile || !selectedFile.size || selectedFile.size > maxVideoSize) {
        throw Error('Vui lòng chọn tệp video bài chữa có dữ liệu (tối đa 5 GB).');
      }
      progressWrap.hidden = false;
      progressBar.value = 0;
      progressLabel.textContent = 'Đang khởi tạo thư mục Video chữa trên Google Drive…';

      await uploadDriveVideoResumable({
        classId: exam.examType || 'thptqg',
        lessonId: exam.id,
        file: selectedFile,
        cleanTitle: titleField.input.value.trim(),
        progressBar,
        progressLabel,
        uploadState,
        filesBasePath: examSolutionFilesBasePath(exam.id),
        fileKind: 'video',
        finalizingText: 'Đã tải 100% dữ liệu lên Google Drive! Đang xác thực và gắn video vào đề…',
        completedText: 'Đã tải xong 100%! Đang hoàn tất liên kết video chữa…'
      });

      pendingAutoOpenExamSolutionMode = {examId: exam.id, mode: 'lecture'};
      $('editor').close();
      if (typeof onSaved === 'function') await onSaved('lecture');
      status('Đã lưu Video chữa vào thư mục Google Drive của đề.', false, 'success');
    } catch (e) {
      error.textContent = friendly(e);
      error.hidden = false;
      error.focus();
    } finally {
      submit.disabled = false;
      titleField.input.disabled = false;
      picker.input.disabled = false;
    }
  };

  modal(`Tải Video chữa · ${exam.title || 'Đề luyện'}`, f);
}

function examSolutionDocumentModal(exam, onSaved, {fileKind = 'document'} = {}) {
  let entries = [];
  const isExamFile = fileKind === 'exam_file';
  const examLabel = EXAM_TRACK_LABELS[exam.examType] || 'Phòng luyện';

  const titleField = field(
    'title',
    isExamFile
      ? 'Tên file đề hiển thị (để trống nếu giữ tên tệp gốc)'
      : 'Tên file tài liệu hiển thị (để trống nếu giữ tên tệp gốc)',
    'text',
    '',
    {
      required: false,
      maxLength: 180,
      placeholder: isExamFile ? 'VD: Đề thi chính thức (PDF/Word)' : 'VD: Đáp án & Lời giải chi tiết'
    }
  );
  const picker = field(
    'files',
    isExamFile
      ? 'Chọn tệp File đề (.pdf, .docx – mỗi tệp tối đa 100 MB)'
      : 'Chọn tệp File tài liệu (PDF, Word, Ảnh... – mỗi tệp tối đa 100 MB)',
    'file',
    '',
    {
      required: true,
      multiple: true
    }
  );

  const itemBanner = el('div', {class: 'notice session-modal-banner'},
    el('strong', {text: exam.title || `Đề ${exam.examCode || '01'}`}),
    el('p', {
      class: 'meta',
      text: `Tệp được lưu chung vào thư mục Google Drive của đề (${examLabel} / ${isExamFile ? 'File đề' : 'File tài liệu'}).`
    })
  );

  const notice = el('p', {
    class: 'meta',
    role: 'status',
    'aria-live': 'polite',
    text: isExamFile
      ? 'Hỗ trợ PDF, Word (.docx) và tài liệu gốc của đề thi.'
      : 'Hỗ trợ PDF, Ảnh, Word, Excel và các định dạng tài liệu lời giải.'
  });
  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const submit = el('button', {
    type: 'submit',
    class: 'primary wide psol-modal-submit',
    text: isExamFile ? 'Lưu file đề' : 'Lưu file tài liệu'
  });
  const f = el('form', {}, itemBanner, error, titleField.label, picker.label, notice, submit);

  picker.input.addEventListener('change', () => {
    entries = [...picker.input.files].map(file => ({file, done: false}));
    error.hidden = true;
    notice.textContent = entries.length
      ? `Đã chọn ${entries.length} tệp.`
      : isExamFile
        ? 'Hỗ trợ PDF, Word (.docx) và tài liệu gốc của đề thi.'
        : 'Hỗ trợ PDF, Ảnh, Word, Excel và các định dạng tài liệu lời giải.';
  });

  f.onsubmit = async event => {
    event.preventDefault();
    if (!validateFormFields(f, error)) return;
    submit.disabled = true;
    titleField.input.disabled = true;
    picker.input.disabled = true;
    error.hidden = true;
    try {
      if (!entries.length || entries.some(entry => !entry.file.size || entry.file.size > MAX_DOCUMENT_UPLOAD_BYTES)) {
        throw Error('Vui lòng chọn ít nhất một tệp có dữ liệu, mỗi tệp tối đa 100 MB.');
      }
      await uploadDriveDocumentBatch({
        classId: exam.examType || 'thptqg',
        lessonId: exam.id,
        entries,
        customTitle: titleField.input.value.trim(),
        notice,
        filesBasePath: examSolutionFilesBasePath(exam.id),
        fileKind,
        fileLabel: isExamFile ? 'file đề' : 'file tài liệu'
      });

      pendingAutoOpenExamSolutionMode = {examId: exam.id, mode: 'document'};
      $('editor').close();
      if (typeof onSaved === 'function') await onSaved('document');
      status(
        isExamFile
          ? 'Đã lưu File đề vào thư mục Google Drive của đề.'
          : 'Đã lưu File tài liệu vào thư mục Google Drive của đề.',
        false,
        'success'
      );
    } catch (e) {
      error.textContent = friendly(e);
      error.hidden = false;
      error.focus();
    } finally {
      submit.disabled = false;
      titleField.input.disabled = false;
      picker.input.disabled = false;
    }
  };

  modal(isExamFile ? `Tải File đề gốc · ${exam.title}` : `Tải File tài liệu · ${exam.title}`, f);
}

function examSolutionManagerModal(exam, solution, onSaved) {
  let filesChanged = false;

  const topicField = field('topic', 'Chuyên đề / Ghi chú chữa đề', 'text', solution.topic || '', {
    required: false,
    maxLength: 200,
    placeholder: 'VD: Mục tiêu 9+ · Full 22 câu kèm lời giải chi tiết'
  });
  const dateField = field('date', 'Ngày chữa đề (tuỳ chọn)', 'date', solution.date || '', {required: false});

  const error = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
  const mediaList = [
    ...(solution.videos || []).map(v => ({...v, sourceType: 'uploaded_video', kindLabel: 'Video chữa', badgeClass: 'badge-info'})),
    ...(solution.files || []).map(d => ({...d, sourceType: 'uploaded_doc', kindLabel: 'File tài liệu', badgeClass: 'badge-primary'}))
  ];

  const filesManagerBox = el('div', {class: 'psol-editor-files-section', hidden: mediaList.length === 0});
  if (mediaList.length) {
    const listWrap = el('div', {class: 'psol-editor-files-list'});
    for (const fItem of mediaList) {
      const row = el('div', {class: 'psol-editor-file-row'});
      const info = el(
        'div',
        {class: 'psol-editor-file-info'},
        el('span', {class: `badge ${fItem.badgeClass}`, text: fItem.kindLabel}),
        el('strong', {text: fItem.name}),
        fItem.file_size ? el('span', {class: 'meta', text: formatFileSize(fItem.file_size)}) : null
      );
      const actionWrap = el('div', {class: 'psol-editor-file-actions'});
      const dlPath = fItem.downloadPath || `${examSolutionFilesBasePath(exam.id)}/${fItem.id}`;
      actionWrap.append(
        btn('Tải về', () => download(dlPath, fItem.name, fItem.content_type || ''), false, 'download')
      );

      if (fItem.sourceType !== 'exam_source') {
        const triggerBtn = el('button', {
          type: 'button',
          class: 'ltch-staff-mini-btn is-danger',
          text: 'Xóa tệp'
        });
        const confirmBox = el('div', {class: 'psol-editor-file-confirm', hidden: true});
        const confirmBtn = el('button', {
          type: 'button',
          class: 'danger',
          text: 'Xác nhận xóa',
          onclick: async () => {
            confirmBtn.disabled = true;
            error.hidden = true;
            try {
              await api(`/api/practice/exams/${encodeURIComponent(exam.id)}/solutions`, {
                method: 'POST',
                body: {action: 'delete_file', fileId: fItem.id}
              });
              filesChanged = true;
              row.remove();
              if (!listWrap.childNodes.length) filesManagerBox.hidden = true;
              status(`Đã xóa "${fItem.name}" khỏi thư mục đề trên Drive.`, false, 'success');
            } catch (err) {
              error.textContent = friendly(err);
              error.hidden = false;
              confirmBtn.disabled = false;
            }
          }
        });
        const cancelBtn = el('button', {
          type: 'button',
          text: 'Hủy',
          onclick: () => {
            confirmBox.hidden = true;
            triggerBtn.hidden = false;
          }
        });
        triggerBtn.onclick = () => {
          triggerBtn.hidden = true;
          confirmBox.hidden = false;
        };
        confirmBox.append(cancelBtn, confirmBtn);
        actionWrap.append(triggerBtn, confirmBox);
      }

      row.append(info, actionWrap);
      listWrap.append(row);
    }
    filesManagerBox.append(
      el('p', {class: 'psol-editor-files-heading', text: 'Tệp bài chữa trong thư mục Google Drive của đề (Video chữa · File tài liệu):'}),
      listWrap
    );
  }

  const submit = el('button', {type: 'submit', class: 'primary wide psol-modal-submit', text: 'Lưu thông tin'});
  const f = el('form', {}, error, el('div', {class: 'form-grid-2'}, topicField.label, dateField.label), filesManagerBox, submit);

  const editorDialog = $('editor');
  const onDialogClose = () => {
    if (filesChanged && typeof onSaved === 'function') {
      filesChanged = false;
      onSaved();
    }
  };
  editorDialog?.addEventListener('close', onDialogClose, {once: true});

  f.onsubmit = async event => {
    event.preventDefault();
    if (!validateFormFields(f, error)) return;
    submit.disabled = true;
    error.hidden = true;
    try {
      await api(`/api/practice/exams/${encodeURIComponent(exam.id)}/solutions`, {
        method: 'POST',
        body: {
          action: 'update_meta',
          topic: topicField.input.value.trim(),
          date: dateField.input.value.trim()
        }
      });
      filesChanged = false;
      editorDialog?.removeEventListener('close', onDialogClose);
      $('editor').close();
      if (typeof onSaved === 'function') await onSaved();
      status('Đã cập nhật thông tin & thư mục bài chữa của đề.', false, 'success');
    } catch (e) {
      error.textContent = friendly(e);
      error.hidden = false;
      error.focus();
    } finally {
      submit.disabled = false;
    }
  };

  modal(`Quản lý tệp & thông tin chữa · ${exam.title || 'Đề luyện'}`, f);
}

async function renderExamSolutionPage({
  container,
  examType = 'thptqg',
  examId,
  classGradeFilter = null,
  isArchived = false,
  onBackToRoom = () => {},
  onSwitchExam = () => {},
  onStartExam = () => {}
}) {
  const version = viewVersion;
  const alive = () => container.isConnected && version === viewVersion;
  const reloadSelf = () =>
    renderExamSolutionPage({
      container,
      examType,
      examId,
      classGradeFilter,
      isArchived,
      onBackToRoom,
      onSwitchExam,
      onStartExam
    });

  container.replaceChildren(el('p', {class: 'meta', role: 'status', text: 'Đang tải trang chữa đề luyện…'}));

  const [solRes, roomsRes] = await Promise.allSettled([
    api(`/api/practice/exams/${encodeURIComponent(examId)}/solutions`),
    api(classGradeFilter ? `/api/practice/rooms?grade=${encodeURIComponent(classGradeFilter)}` : '/api/practice/rooms')
  ]);
  if (!alive()) return;
  container.replaceChildren();

  if (solRes.status !== 'fulfilled' || !solRes.value?.exam) {
    const errMsg = solRes.status === 'rejected' ? friendly(solRes.reason) : 'Không tìm thấy thông tin chữa đề.';
    container.append(
      el(
        'div',
        {class: 'session-empty-mode-card'},
        el('p', {class: 'form-error', role: 'alert', text: errMsg}),
        btn('Quay lại phòng luyện', () => onBackToRoom(), true)
      )
    );
    return;
  }

  const payload = solRes.value;
  const exam = payload.exam;
  const solution = payload.solution || {};
  const videos = Array.isArray(solution.videos) ? solution.videos : [];
  const docFiles = Array.isArray(solution.files) ? solution.files : [];
  const filesBasePath = examSolutionFilesBasePath(exam.id);
  const solutionsEnabled = Boolean(payload.solutionsEnabled);
  const solutionsLinkPreview = Boolean(payload.solutionsLinkPreview);
  const allSolutionDocs = docFiles.map(d => ({
    ...d,
    docTag: 'Lời giải',
    docPath: `${filesBasePath}/${d.id}`
  }));
  const canManageFiles = Boolean(!isArchived && isStaffView() && exam.canManage);
  const resolvedTrack = EXAM_TRACK_LABELS[examType] ? examType : (exam.examType || 'thptqg');
  const trackLabel = EXAM_TRACK_LABELS[resolvedTrack] || 'Phòng luyện';

  const allRoomExams = roomsRes.status === 'fulfilled' && Array.isArray(roomsRes.value?.exams)
    ? roomsRes.value.exams
    : [];
  const effectiveGradeScope =
    classGradeFilter || (resolvedTrack !== 'tsa' ? Number(exam.targetGrade) || null : null);
  const sameTrackExams = allRoomExams.filter(item => {
    if (resolvedTrack === 'past') return Boolean(item.isPastPool);
    if (item.isPastPool || item.examType !== resolvedTrack) return false;
    if (resolvedTrack !== 'tsa' && effectiveGradeScope && (Number(item.targetGrade) || 12) !== Number(effectiveGradeScope)) {
      return false;
    }
    return true;
  });
  const switcherExams = sameTrackExams.some(item => item.id === exam.id)
    ? sameTrackExams
    : [exam, ...sameTrackExams];

  let activeViewerCleanup = null;
  let currentMode = null;
  let selectedVideoIdx = 0;
  let selectedDocIdx = 0;

  const viewerStageHost = el('div', {class: 'session-inline-viewer-host', hidden: true});
  const clearViewer = () => {
    if (typeof activeViewerCleanup === 'function') {
      activeViewerCleanup();
      activeViewerCleanup = null;
    }
    viewerStageHost.querySelectorAll('.drive-video-lecture-panel').forEach(panelNode => {
      panelNode._ltchDisposeVideo?.();
    });
    viewerStageHost.replaceChildren();
    viewerStageHost.hidden = true;
    syncTheaterBodyLock();
  };

  const breadcrumbGridIcon = el('span', {class: 'ltch-breadcrumb-icon', 'aria-hidden': 'true'});
  breadcrumbGridIcon.innerHTML =
    '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="6" height="6" rx="1.4"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.4"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.4"/><rect x="11.5" y="11.5" width="6" height="6" rx="1.4"/></svg>';

  const examSwitcherSelect = el(
    'select',
    {
      class: 'ltch-breadcrumb-select',
      'aria-label': 'Chuyển nhanh sang đề luyện khác',
      onchange: e => {
        const nextId = e.target.value;
        if (!nextId || nextId === exam.id) return;
        clearViewer();
        onSwitchExam(nextId);
      }
    },
    ...switcherExams.map(item =>
      el('option', {
        value: item.id,
        selected: item.id === exam.id,
        text: item.title || `Đề ${item.examCode || '01'}`
      })
    )
  );
  examSwitcherSelect.value = exam.id;

  const breadcrumbNav = el(
    'nav',
    {class: 'ltch-breadcrumb-nav', 'aria-label': 'Điều hướng chữa đề luyện'},
    el(
      'button',
      {
        type: 'button',
        class: 'ltch-breadcrumb-root',
        onclick: () => {
          clearViewer();
          onBackToRoom();
        }
      },
      breadcrumbGridIcon,
      el('span', {text: `Phòng luyện ${trackLabel}`})
    ),
    el('span', {class: 'ltch-breadcrumb-sep', 'aria-hidden': 'true', text: '/'}),
    examSwitcherSelect
  );

  const titleGroup = el(
    'div',
    {class: 'session-unboxed-title-group'},
    el('h2', {
      class: 'session-unboxed-title',
      text: exam.title || `Đề ${exam.examCode || '01'}`,
      title: exam.title || ''
    }),
    el('span', {
      class: 'badge badge-primary',
      text: `${String(exam.examType || resolvedTrack).toUpperCase()} · Đề ${exam.examCode || '01'}`
    }),
    el('span', {
      class: 'session-date-badge',
      text: `${exam.questionCount || 0} câu · ${exam.durationMinutes || 90} phút`
    }),
    solution.formattedDate
      ? el('span', {class: 'session-date-badge', text: solution.formattedDate})
      : null,
    solution.topic
      ? el('span', {class: 'badge badge-info lesson-topic-badge', text: solution.topic})
      : null
  );

  const videoModeBtn = el(
    'button',
    {
      type: 'button',
      class: `session-mode-btn${videos.length ? ' has-data' : ''}`,
      'aria-pressed': 'false',
      onclick: () => selectMode('lecture')
    },
    mediaIcon('play'),
    el('span', {text: 'Video chữa'})
  );

  const docModeBtn = el(
    'button',
    {
      type: 'button',
      class: `session-mode-btn${allSolutionDocs.length ? ' has-data' : ''}`,
      'aria-pressed': 'false',
      onclick: () => selectMode('document')
    },
    mediaIcon('material'),
    el('span', {text: 'File tài liệu'})
  );

  const splitModeBtn = videos.length && allSolutionDocs.length
    ? el(
        'button',
        {
          type: 'button',
          class: 'session-mode-btn has-data',
          'aria-pressed': 'false',
          onclick: () => selectMode('split')
        },
        mediaIcon('split'),
        el('span', {text: 'Song song'})
      )
    : null;

  const modeChoices = el(
    'div',
    {class: 'session-mode-choices', role: 'group', 'aria-label': 'Chọn Video chữa hoặc File tài liệu bài chữa'},
    videoModeBtn,
    docModeBtn,
    splitModeBtn
  );

  const doExamBtn = btn(
    'Làm đề',
    () => {
      clearViewer();
      onStartExam(exam);
    },
    false
  );

  const staffUploadBar = canManageFiles
    ? el(
        'div',
        {class: 'session-compact-staff-actions'},
        createActionMenu({
          label: 'Quản lý bài chữa',
          ariaLabel: 'Quản lý bài chữa',
          iconName: 'settings',
          iconOnly: true,
          variant: 'outline',
          items: [
            solutionsEnabled
              ? {label: 'Tải Video chữa', icon: 'plus', onSelect: () => examSolutionVideoModal(exam, () => reloadSelf())}
              : null,
            {label: 'Tải File tài liệu', icon: 'plus', onSelect: () => examSolutionDocumentModal(exam, () => reloadSelf(), {fileKind: 'document'})},
            {label: 'Quản lý tệp', icon: 'edit', dividerBefore: true, onSelect: () => examSolutionManagerModal(exam, solution, () => reloadSelf())}
          ]
        })
      )
    : null;

  const compactTopbar = el(
    'header',
    {class: 'session-unboxed-header'},
    breadcrumbNav,
    el(
      'div',
      {class: 'session-unboxed-main-row'},
      titleGroup,
      el('div', {class: 'session-compact-controls'}, modeChoices, doExamBtn, staffUploadBar)
    )
  );

  function renderVideoMode() {
    clearViewer();
    viewerStageHost.hidden = false;
    if (!videos.length) {
      viewerStageHost.replaceChildren(
        el(
          'div',
          {class: 'session-empty-mode-card'},
          el('p', {text: 'Đề luyện này hiện chưa có video bài chữa.'}),
          canManageFiles && solutionsEnabled
            ? btn('Tải Video chữa', () => examSolutionVideoModal(exam, () => reloadSelf()), true, 'plus')
            : null
        )
      );
      return;
    }

    const safeVidIdx = Math.min(selectedVideoIdx, Math.max(0, videos.length - 1));
    const chosen = videos[safeVidIdx] || videos[0];
    const videoTopic = solution.topic || `${trackLabel} · Đề ${exam.examCode || '01'}`;
    const itemSubbar = videos.length > 1
      ? el(
          'div',
          {class: 'session-doc-selector-bar is-below-viewer'},
          el(
            'div',
            {class: 'session-item-pills', role: 'tablist', 'aria-label': 'Chọn video bài chữa trong đề'},
            ...videos.map((v, idx) =>
              el('button', {
                type: 'button',
                class: `session-item-pill${idx === safeVidIdx ? ' is-active' : ''}`,
                text: v.name,
                onclick: () => {
                  selectedVideoIdx = idx;
                  renderVideoMode();
                }
              })
            )
          )
        )
      : null;

    const videoNode = createDriveVideoLectureElement({
      title: chosen.name,
      topic: videoTopic,
      loadStreamUrl: () => loadAuthorizedVideoStreamUrl(`${filesBasePath}/${chosen.id}`),
      inline: true,
      playlist: videos,
      activeIndex: safeVidIdx,
      onSelectPlaylist: idx => {
        selectedVideoIdx = idx;
        renderVideoMode();
      }
    });

    viewerStageHost.replaceChildren(...[videoNode, itemSubbar].filter(Boolean));
  }

  function renderDocumentMode() {
    clearViewer();
    viewerStageHost.hidden = false;

    if (!allSolutionDocs.length) {
      viewerStageHost.replaceChildren(
        el(
          'div',
          {class: 'session-empty-mode-card'},
          el('p', {text: 'Đề luyện này hiện chưa có file tài liệu bài chữa nào.'}),
          canManageFiles
            ? btn('Tải File tài liệu', () => examSolutionDocumentModal(exam, () => reloadSelf(), {fileKind: 'document'}), true, 'plus')
            : null
        )
      );
      return;
    }

    const safeDocIdx = Math.min(selectedDocIdx, allSolutionDocs.length - 1);
    const chosenDoc = allSolutionDocs[safeDocIdx] || allSolutionDocs[0];
    const docPath = chosenDoc.docPath || `${filesBasePath}/${chosenDoc.id}`;
    const docMountBox = el('div', {class: 'session-doc-viewer-mount'});

    const docSelectorRow = allSolutionDocs.length > 1 || Boolean(chosenDoc.docTag)
      ? el(
          'div',
          {class: 'session-doc-selector-bar is-below-viewer'},
          allSolutionDocs.length > 1
            ? el(
                'div',
                {class: 'session-item-pills', role: 'tablist', 'aria-label': 'Chọn file tài liệu bài chữa'},
                ...allSolutionDocs.map((d, idx) =>
                  el(
                    'button',
                    {
                      type: 'button',
                      class: `session-item-pill${idx === safeDocIdx ? ' is-active' : ''}`,
                      onclick: () => {
                        selectedDocIdx = idx;
                        renderDocumentMode();
                      }
                    },
                    el('span', {text: d.name})
                  )
                )
              )
            : el(
                'div',
                {class: 'session-active-item-caption'},
                mediaIcon('material'),
                chosenDoc.docTag
                  ? el('span', {class: 'ltch-doc-tag is-solution', text: chosenDoc.docTag})
                  : null,
                el('strong', {text: chosenDoc.name, title: chosenDoc.name}),
                chosenDoc.file_size ? el('span', {class: 'meta', text: `(${formatFileSize(chosenDoc.file_size)})`}) : null
              )
        )
      : null;

    viewerStageHost.replaceChildren(...[docMountBox, docSelectorRow].filter(Boolean));
    activeViewerCleanup = mountInlineDocumentViewer(docMountBox, chosenDoc, docPath, alive, {linkPreview: solutionsLinkPreview});
  }

  function renderSplitStudyMode() {
    clearViewer();
    viewerStageHost.hidden = false;
    if (!videos.length || !allSolutionDocs.length) {
      if (allSolutionDocs.length) renderDocumentMode();
      else renderVideoMode();
      return;
    }

    const safeVidIdx = Math.min(selectedVideoIdx, Math.max(0, videos.length - 1));
    const chosenVideo = videos[safeVidIdx] || videos[0];
    const videoTopic = solution.topic || `${trackLabel} · Đề ${exam.examCode || '01'}`;
    const videoNode = createDriveVideoLectureElement({
      title: chosenVideo.name,
      topic: videoTopic,
      loadStreamUrl: () => loadAuthorizedVideoStreamUrl(`${filesBasePath}/${chosenVideo.id}`),
      inline: true,
      playlist: videos,
      activeIndex: safeVidIdx,
      onSelectPlaylist: idx => {
        selectedVideoIdx = idx;
        renderSplitStudyMode();
      }
    });

    const safeDocIdx = Math.min(selectedDocIdx, allSolutionDocs.length - 1);
    const chosenDoc = allSolutionDocs[safeDocIdx] || allSolutionDocs[0];
    const docPath = chosenDoc.docPath || `${filesBasePath}/${chosenDoc.id}`;
    const docMountBox = el('div', {class: 'session-doc-viewer-mount'});
    const splitDocBar = allSolutionDocs.length > 1
      ? el(
          'div',
          {class: 'session-doc-selector-bar is-below-viewer'},
          el(
            'div',
            {class: 'session-item-pills', role: 'tablist', 'aria-label': 'Chọn tài liệu học song song'},
            ...allSolutionDocs.map((d, idx) =>
              el(
                'button',
                {
                  type: 'button',
                  class: `session-item-pill${idx === safeDocIdx ? ' is-active' : ''}`,
                  onclick: () => {
                    selectedDocIdx = idx;
                    renderSplitStudyMode();
                  }
                },
                el('span', {text: d.name})
              )
            )
          )
        )
      : null;

    viewerStageHost.replaceChildren(
      el(
        'div',
        {class: 'session-split-study-grid'},
        el('div', {class: 'session-split-video-pane'}, videoNode),
        el('div', {class: 'session-split-doc-pane'}, ...[docMountBox, splitDocBar].filter(Boolean))
      )
    );
    activeViewerCleanup = mountInlineDocumentViewer(docMountBox, chosenDoc, docPath, alive, {
      linkPreview: solutionsLinkPreview,
      compact: true
    });
  }

  function selectMode(nextMode = 'lecture') {
    currentMode = nextMode === 'split' && videos.length && allSolutionDocs.length
      ? 'split'
      : nextMode === 'document'
        ? 'document'
        : 'lecture';
    const isVid = currentMode === 'lecture';
    const isDoc = currentMode === 'document';
    const isSplit = currentMode === 'split';
    videoModeBtn.classList.toggle('is-active', isVid);
    videoModeBtn.setAttribute('aria-pressed', String(isVid));
    docModeBtn.classList.toggle('is-active', isDoc);
    docModeBtn.setAttribute('aria-pressed', String(isDoc));
    if (splitModeBtn) {
      splitModeBtn.classList.toggle('is-active', isSplit);
      splitModeBtn.setAttribute('aria-pressed', String(isSplit));
    }

    if (isSplit) renderSplitStudyMode();
    else if (isDoc) renderDocumentMode();
    else renderVideoMode();
  }

  container.append(el('div', {class: 'session-dedicated-page'}, ...[compactTopbar, viewerStageHost].filter(Boolean)));

  if (pendingAutoOpenExamSolutionMode && pendingAutoOpenExamSolutionMode.examId === exam.id) {
    const modeToOpen = pendingAutoOpenExamSolutionMode.mode;
    pendingAutoOpenExamSolutionMode = null;
    selectMode(modeToOpen);
  } else if (!videos.length && allSolutionDocs.length) {
    selectMode('document');
  } else {
    selectMode('lecture');
  }
}

/**
 * TRANG QUẢN TRỊ (ADMIN PAGE)
 * Phân định rõ tài khoản Quản trị viên & Cô Hạnh
 * Tích hợp: 1. Hồ sơ đăng ký chờ duyệt (kèm ảnh nhận diện rõ mặt, 3 thao tác duyệt)
 *           2. Danh mục lớp học động (thêm / sửa / xóa các lớp 6A - 12B)
 *           3. Quản lý tài khoản, phân công và chuyển lớp
 */
function scrollToAdminTargetSection(focusSection) {
  const targetId = focusSection === 'staff' || focusSection === 'enrollments' ? 'enrollment-requests' : null;
  if (!targetId || typeof requestAnimationFrame !== 'function') return;
  const target = $(targetId);
  if (!target) return;
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => {
    if (!target.isConnected) return;
    target.scrollIntoView({behavior: reducedMotion ? 'auto' : 'smooth', block: 'start'});
  });
}

async function saveAdminAccountState({uid, status: nextStatus, roles}) {
  const expectedRoles = [...new Set(Array.isArray(roles) ? roles : [])];
  if (expectedRoles.includes('admin') && !expectedRoles.includes('assistant')) expectedRoles.push('assistant');
  try {
    await api('/api/admin/accounts', {method: 'POST', idempotent: true, body: {uid, status: nextStatus, roles: expectedRoles}});
  } catch (err) {
    if (err?.status) throw err;
    const verifyRes = await api('/api/admin/accounts').catch(() => null);
    const saved = verifyRes?.items?.find(u => u.uid === uid);
    const matched = saved &&
      saved.status === nextStatus &&
      Array.isArray(saved.roles) &&
      saved.roles.length === expectedRoles.length &&
      expectedRoles.every(r => saved.roles.includes(r));
    if (!matched) throw err;
  }
  if (uid === me?.uid) me = await api('/api/me');
}

async function adminPage({focusSection = activeAdminSubPage} = {}) {
  if (!['admin', 'teacher'].includes(viewRole)) return;
  const adminView = viewRole === 'admin';
  const version = loadingPage(adminView ? 'Quản trị hệ thống' : 'Duyệt hồ sơ vào lớp');
  const [accounts, years, memberships, links, enrollmentsRes, loadedArchived] = await Promise.all([
    adminView ? api('/api/admin/accounts') : {items: []},
    adminView ? api('/api/admin/years') : {items: []},
    adminView ? api('/api/admin/memberships') : {items: []},
    adminView ? api('/api/admin/parent-links') : {items: []},
    api('/api/admin/enrollments'),
    adminView ? ensureArchivedClassesLoaded() : []
  ]);
  if (version !== viewVersion) return;

  const users = accounts.items;
  const enrollments = enrollmentsRes.items || [];
  if (years.items?.length) window._ltchYearsCache = years.items;
  if (adminView && (focusSection === 'staff' || focusSection === 'enrollments')) {
    activeAdminTab = 'approvals';
  }

  const headerActions = adminView
    ? [
        btn('Thêm lớp học', () => openCreateCohortClassModal(years.items?.length ? years.items : (window._ltchYearsCache || [])), true, 'plus'),
        createActionMenu({
          label: 'Công cụ quản trị',
          variant: 'outline',
          items: [
            {label: 'Chuyển năm học mới', icon: 'calendar', onSelect: () => openAdvanceSchoolYearModal()},
            {label: 'Chuyển lớp theo năm học', icon: 'users', onSelect: () => promotionEditor(users, years.items, memberships.items)},
            {
              label: 'Gửi lại email chờ',
              icon: 'mail',
              onSelect: async () => {
                const result = await api('/api/admin/mail/retry', {method: 'POST'});
                status(`Đã gửi ${result.sent} email; ${result.pending} email vẫn đang chờ.`);
              }
            },
            {label: 'Kho lưu trữ lớp', icon: 'archive', dividerBefore: true, onSelect: () => navigateTo('archive')}
          ]
        })
      ]
    : [];

  content(
    heading(
      adminView ? 'Quản trị hệ thống' : 'Duyệt hồ sơ vào lớp',
      adminView ? 'Duyệt hồ sơ, phân quyền tài khoản, phân công thành viên và danh mục lớp.' : 'Xét duyệt hồ sơ đăng ký vào các lớp bạn phụ trách.',
      ...headerActions
    )
  );

  const root = $('content');
  const staffRequests = adminView ? users.filter(a => a.status === 'pending' && a.roles.some(role => ['teacher', 'assistant'].includes(role))) : [];
  const pendingRequests = enrollments.filter(e => e.status === 'pending' || e.status === 'needs_revision');

  // KHU VỰC 1: HỒ SƠ CHỜ DUYỆT (GIÁO VIÊN/TRỢ GIẢNG & HỌC SINH/PHỤ HUYNH)
  const totalPendingCount = staffRequests.length + pendingRequests.length;
  const approvalsPanel = el('div', {id: 'admin-panel-approvals', role: 'tabpanel', hidden: adminView && activeAdminTab !== 'approvals'});
  const enrollmentSection = el('section', {
    id: 'enrollment-requests',
    class: `enrollment-request-section${focusSection === 'staff' || focusSection === 'enrollments' ? ' is-route-target' : ''}`
  });
  enrollmentSection.append(
    el('div', {class: 'section-heading'},
      el('h2', {text: 'Hồ sơ đăng ký vào lớp chờ phê duyệt'}),
      el('span', {class: totalPendingCount ? 'badge badge-warning' : 'badge badge-success', text: `${totalPendingCount} hồ sơ cần xử lý`})
    )
  );

  if (!totalPendingCount) {
    enrollmentSection.append(empty('Hiện không có hồ sơ nào đang chờ duyệt.'));
  } else {
    const detail = (label, value) => el('div', {class: 'enrollment-detail'}, el('dt', {text: label}), el('dd', {text: value || 'Chưa cung cấp'}));
    for (const account of staffRequests) {
      const role = account.roles.find(r => ['teacher', 'assistant'].includes(r));
      const roleShort = role === 'teacher' ? 'GV' : 'TG';
      enrollmentSection.append(
        el('article', {class: 'enrollment-item'},
          el('div', {class: 'enrollment-body'},
            el('div', {class: 'enrollment-title-row'},
              el('div', {class: 'enrollment-person'},
                el('div', {class: 'enrollment-avatar enrollment-avatar-fallback'}, roleShort),
                el('div', {class: 'enrollment-identity'},
                  el('h3', {text: account.display_name}),
                  el('span', {class: 'badge badge-info', text: labels[role]})
                )
              ),
              el('span', {class: 'badge badge-info', text: 'Đơn mới'})
            ),
            el('dl', {class: 'enrollment-grid'},
              detail('Vai trò đăng ký', labels[role]),
              detail('Email tài khoản', account.email || account.uid)
            ),
            el('div', {class: 'enrollment-actions'},
              btn(`Duyệt ${labels[role].toLowerCase()}`, async () => {
                await saveAdminAccountState({uid: account.uid, status: 'active', roles: [role]});
                await adminPage();
                status('Đã duyệt tài khoản. Hãy phân công lớp và quyền phù hợp.');
              }, true, 'check'),
              createActionMenu({
                label: 'Xử lý khác',
                variant: 'outline',
                items: [
                  {
                    label: 'Từ chối / Khóa',
                    icon: 'trash',
                    danger: true,
                    onSelect: () => {
                      if (confirm(`Bạn có chắc chắn muốn từ chối và khóa tài khoản ${account.display_name}?`)) {
                        run(async () => {
                          await saveAdminAccountState({uid: account.uid, status: 'disabled', roles: account.roles});
                          status('Đã từ chối và khóa tài khoản.');
                          await adminPage();
                        });
                      }
                    }
                  }
                ]
              })
            )
          )
        )
      );
    }
    for (const req of pendingRequests) {
      const isRevision = req.status === 'needs_revision';
      const relation = {mother: 'Mẹ', father: 'Bố', guardian: 'Người giám hộ'}[req.parentRelation] || '';
      const birthParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(req.dateOfBirth || '');
      const birthDate = birthParts ? `${birthParts[3]}/${birthParts[2]}/${birthParts[1]}` : req.dateOfBirth;
      const accountEmail = adminView ? users.find(u => u.uid === req.uid)?.email : null;
      const yearName = adminView ? years.items.find(y => y.id === req.schoolYearId)?.name : null;
      const item = el('article', {class: 'enrollment-item'},
        el('div', {class: 'enrollment-body'},
          el('div', {class: 'enrollment-title-row'},
            el('div', {class: 'enrollment-person'},
              req.photoUrl ? enrollmentPhoto(req) : el('div', {class: 'enrollment-avatar enrollment-avatar-fallback'}, 'HS'),
              el('div', {class: 'enrollment-identity'},
                el('h3', {text: req.fullName}),
                el('span', {class: 'badge badge-info', text: labels[req.applicantRole || 'student']})
              )
            ),
            el('span', {class: isRevision ? 'badge badge-warning' : 'badge badge-info', text: isRevision ? 'Đang chờ sửa' : 'Đơn mới'})
          ),
          el('dl', {class: 'enrollment-grid'},
            detail('Lớp đăng ký', req.className || req.classId),
            yearName ? detail('Năm học', yearName) : null,
            detail('Ngày sinh', birthDate),
            accountEmail ? detail('Email tài khoản', accountEmail) : null,
            detail('Trường', req.schoolName),
            detail('Ngày nộp', fmt(req.createdAt)),
            detail('Số điện thoại học sinh', req.studentPhone),
            detail('Phụ huynh', req.parentName ? `${req.parentName}${relation ? ` (${relation})` : ''}` : ''),
            detail('Số điện thoại phụ huynh', req.parentPhone)
          ),
          (isRevision && (req.adminNotes || req.admin_notes)) ? el('p', {class: 'meta enrollment-revision-note', text: `Lời nhắn yêu cầu sửa: "${req.adminNotes || req.admin_notes}"`}) : null,
          el('div', {class: 'enrollment-actions'},
            btn('Duyệt vào lớp', () => approvalDialog(req), true, 'check'),
            createActionMenu({
              label: 'Xử lý khác',
              variant: 'outline',
              items: [
                {
                  label: 'Yêu cầu chỉnh sửa',
                  icon: 'edit',
                  onSelect: () => {
                    modal('Yêu cầu bổ sung hồ sơ', form([
                      ['adminNotes', 'Lý do yêu cầu sửa (sẽ gửi email và hiển thị cho người đăng ký)', 'textarea', '', {
                        required: true,
                        placeholder: 'Ví dụ: Lớp này đã đủ 30 bạn, vui lòng đổi sang lớp khác; hoặc ảnh nhận diện chưa rõ mặt...'
                      }]
                    ], 'Gửi yêu cầu chỉnh sửa', async b => {
                      const result = await api('/api/admin/enrollments/review', {
                        method: 'POST',
                        body: {
                          requestId: req.id,
                          version: req.version,
                          action: 'request_revision',
                          studentUid: req.uid,
                          adminNotes: b.adminNotes,
                          notes: b.adminNotes
                        }
                      });
                      $('editor').close();
                      status(result.notificationStatus === 'sent' ? 'Đã gửi yêu cầu chỉnh sửa.' : 'Đã ghi nhận yêu cầu; email thông báo đang chờ gửi.');
                      await adminPage();
                    }));
                  }
                },
                {
                  label: 'Từ chối / Khóa',
                  icon: 'trash',
                  danger: true,
                  dividerBefore: true,
                  onSelect: () => {
                    if (confirm(`Bạn có chắc chắn muốn từ chối và khóa tài khoản ${req.fullName}? Thao tác này dành cho tài khoản spam.`)) {
                      run(async () => {
                        await api('/api/admin/enrollments/review', {
                          method: 'POST',
                          body: {requestId: req.id, version: req.version, action: 'reject', studentUid: req.uid}
                        });
                        status('Đã từ chối đơn đăng ký.');
                        await adminPage();
                      });
                    }
                  }
                }
              ]
            })
          )
        )
      );
      enrollmentSection.append(item);
    }
  }
  approvalsPanel.append(enrollmentSection);

  if (!adminView) {
    root.append(approvalsPanel);
    scrollToAdminTargetSection(focusSection);
    return;
  }

  const openClasses = classes.filter(c => !c.archived);
  const archivedList = Array.isArray(loadedArchived) && loadedArchived.length ? loadedArchived : archivedClasses;
  const normalizedMemberships = normalizeMemberships({
    memberships: memberships.items || [],
    users,
    activeClasses: openClasses,
    archivedClasses: archivedList,
    roleLabels: labels
  });
  const activeStudentSummary = groupStudentsForAdmin({
    normalized: normalizedMemberships,
    searchQuery: '',
    classFilter: 'all',
    statusFilter: 'active'
  });
  const staffSummary = groupStaffForAdmin({
    normalized: normalizedMemberships,
    users,
    activeClasses: openClasses,
    searchQuery: ''
  });
  const staffByUid = new Map(staffSummary.entries.map(entry => [entry.uid, entry]));
  const studentByUid = new Map(activeStudentSummary.entries.map(entry => [entry.uid, entry]));
  const openParentGroups = groupParentLinks({
    links: links.items || [],
    users,
    normalizedMemberships,
    searchQuery: '',
    statusFilter: 'active'
  });
  const parentGroupByUid = new Map(openParentGroups.map(group => [group.parentUid, group]));

  // KHU VỰC 2: TÀI KHOẢN & PHÂN QUYỀN (TÌM KIẾM, LỌC & PHÂN TRANG)
  const accountCountBadge = el('span', {class: 'badge badge-info', role: 'status', 'aria-atomic': 'true', text: `${users.length} tài khoản`});
  const accountEntries = users.map(a => {
    const checks = rolesInput(a.roles);
    const select = field('status', 'Trạng thái', 'select', a.status, {
      items: ['pending', 'active', 'disabled'].map(x => ({value: x, label: {pending: 'Chờ duyệt', active: 'Hoạt động', disabled: 'Khóa'}[x]}))
    });
    select.input.setAttribute('aria-label', `Trạng thái tài khoản ${a.display_name}`);
    select.input.removeAttribute('aria-describedby');
    const ownAccount = a.uid === me.uid;
    if (ownAccount) {
      checks.box.querySelectorAll('input').forEach(input => {input.disabled = true;});
      select.input.disabled = true;
    }
    const assignmentSummary = summarizeAccountAssignments(a.uid, {
      staffByUid,
      studentByUid,
      parentGroupByUid,
      activeClassesCount: openClasses.length
    });
    const tr = el('tr', {role: 'row'},
      el('td', {role: 'cell', 'data-label': 'Tài khoản'},
        el('strong', {text: a.display_name}),
        el('p', {text: a.email || '', class: 'meta'}),
        a.student_code ? el('p', {text: `Mã học sinh: ${a.student_code}`, class: 'meta'}) : null,
        assignmentSummary ? el('p', {text: assignmentSummary, class: 'meta account-assignment-meta'}) : null,
        el('p', {text: a.uid, class: 'meta account-uid-meta'})
      ),
      el('td', {role: 'cell', 'data-label': 'Vai trò'}, checks.box),
      el('td', {role: 'cell', 'data-label': 'Trạng thái'}, select.input),
      el('td', {role: 'cell', 'data-label': 'Thao tác'}, ownAccount ? el('span', {class: 'meta', text: 'Đang sử dụng'}) : btn('Lưu quyền', async () => {
        await saveAdminAccountState({uid: a.uid, status: select.input.value, roles: checks.read()});
        await adminPage();
        status('Đã lưu vai trò và trạng thái tài khoản.', false, 'success');
      }, true))
    );
    const searchBlob = normalizeSearchText(`${a.display_name || ''} ${a.email || ''} ${a.student_code || ''} ${assignmentSummary || ''} ${a.uid || ''}`);
    return {tr, roles: Array.isArray(a.roles) ? a.roles : [], status: a.status, searchBlob};
  });

  const accountSearchInput = el('input', {
    type: 'search',
    class: 'account-search-input',
    value: adminAccountUiState.search || '',
    placeholder: 'Tìm theo tên, email, mã học sinh, lớp…',
    'aria-label': 'Tìm kiếm tài khoản hệ thống'
  });
  const accountRoleFilter = el(
    'select',
    {class: 'admin-membership-select', 'aria-label': 'Lọc vai trò tài khoản'},
    el('option', {value: 'all', text: 'Tất cả vai trò'}),
    ...Object.entries(labels).map(([value, label]) => el('option', {value, text: label}))
  );
  accountRoleFilter.value = adminAccountUiState.roleFilter || 'all';
  const accountStatusFilter = el(
    'select',
    {class: 'admin-membership-select', 'aria-label': 'Lọc trạng thái tài khoản'},
    el('option', {value: 'all', text: 'Tất cả trạng thái'}),
    el('option', {value: 'active', text: 'Hoạt động'}),
    el('option', {value: 'pending', text: 'Chờ duyệt'}),
    el('option', {value: 'disabled', text: 'Khóa'})
  );
  accountStatusFilter.value = adminAccountUiState.statusFilter || 'all';

  const accountTableWrap = el('div', {class: 'table-wrap'},
    el('table', {class: 'account-table', role: 'table', 'aria-label': 'Danh sách tài khoản'},
      el('thead', {role: 'rowgroup'},
        el('tr', {role: 'row'}, ...['Tài khoản & Người dùng', 'Vai trò trên hệ thống', 'Trạng thái tài khoản', 'Thao tác'].map(t => el('th', {text: t, scope: 'col', role: 'columnheader'})))
      ),
      el('tbody', {role: 'rowgroup'}, accountEntries.map(e => e.tr))
    )
  );
  const accountEmptyState = el('p', {class: 'empty', text: 'Không tìm thấy tài khoản nào khớp điều kiện lọc.', hidden: true});
  let accountVisibleLimit = adminAccountUiState.visibleLimit || 20;
  const accountLoadMoreBtn = el('button', {
    type: 'button',
    class: 'secondary',
    onclick: () => {
      accountVisibleLimit += 25;
      applyAccountFilters(false);
    }
  });
  const accountLoadMoreWrap = el('div', {class: 'admin-load-more-row', hidden: true}, accountLoadMoreBtn);

  const applyAccountFilters = (resetLimit = true) => {
    if (resetLimit) accountVisibleLimit = 20;
    adminAccountUiState = {
      search: accountSearchInput.value,
      roleFilter: accountRoleFilter.value,
      statusFilter: accountStatusFilter.value,
      visibleLimit: accountVisibleLimit
    };
    const q = normalizeSearchText(accountSearchInput.value);
    const roleVal = accountRoleFilter.value;
    const statusVal = accountStatusFilter.value;
    const isFiltered = Boolean(q || roleVal !== 'all' || statusVal !== 'all');
    let matchedCount = 0;

    for (const entry of accountEntries) {
      const matchQuery = !q || entry.searchBlob.includes(q);
      const matchRole = roleVal === 'all' || entry.roles.includes(roleVal);
      const matchStatus = statusVal === 'all' || entry.status === statusVal;
      const matched = matchQuery && matchRole && matchStatus;
      if (matched) {
        entry.tr.hidden = matchedCount >= accountVisibleLimit;
        matchedCount++;
      } else {
        entry.tr.hidden = true;
      }
    }

    accountCountBadge.textContent = isFiltered ? `${matchedCount}/${users.length} tài khoản` : `${users.length} tài khoản`;
    accountTableWrap.hidden = matchedCount === 0;
    accountEmptyState.hidden = matchedCount > 0;
    const remaining = matchedCount - accountVisibleLimit;
    accountLoadMoreWrap.hidden = remaining <= 0;
    if (remaining > 0) accountLoadMoreBtn.textContent = `Xem thêm tài khoản (còn ${remaining})`;
  };

  accountSearchInput.addEventListener('input', () => applyAccountFilters(true));
  accountRoleFilter.addEventListener('change', () => applyAccountFilters(true));
  accountStatusFilter.addEventListener('change', () => applyAccountFilters(true));
  applyAccountFilters(false);

  const accountsPanel = el('div', {id: 'admin-panel-accounts', role: 'tabpanel', hidden: activeAdminTab !== 'accounts'},
    el('div', {class: 'account-search-row'},
      accountSearchInput,
      accountRoleFilter,
      accountStatusFilter,
      accountCountBadge
    ),
    accountTableWrap,
    accountEmptyState,
    accountLoadMoreWrap
  );

  let switchAdminTab = () => {};

  // KHU VỰC 3: PHÂN CÔNG THÀNH VIÊN & LIÊN KẾT PHỤ HUYNH
  const membershipsPanel = el(
    'div',
    {id: 'admin-panel-memberships', role: 'tabpanel', hidden: activeAdminTab !== 'memberships'},
    renderAdminMembershipsWorkspace({
      el,
      btn,
      empty,
      users,
      activeClasses: openClasses,
      archivedClasses: archivedList,
      memberships: memberships.items || [],
      links: links.items || [],
      roleLabels: labels,
      currentUid: me.uid,
      initialState: adminMembershipUiState,
      onStateChange: nextState => { adminMembershipUiState = nextState; },
      onOpenStudentAssignModal: prefill => openStudentAssignModal({
        users,
        classes: openClasses,
        normalizedMemberships,
        prefill,
        onJumpTab: tabKey => switchAdminTab(tabKey)
      }),
      onOpenTransferModal: ({studentEntry, fromClassId}) => openStudentTransferModal({
        studentEntry,
        classes: openClasses,
        fromClassId
      }),
      onOpenStudentStatusModal: ({studentEntry, targetClassId, nextStatus}) => openStudentStatusModal({
        studentEntry,
        targetClassId,
        nextStatus
      }),
      onOpenAssistantModal: (membership, allForAssistant) => assistantEditor(membership, {
        allMemberships: memberships.items || [],
        assistantMemberships: allForAssistant,
        classesList: openClasses
      }),
      onJumpToAccount: query => {
        switchAdminTab('accounts');
        accountRoleFilter.value = 'all';
        accountStatusFilter.value = 'all';
        accountSearchInput.value = query || '';
        applyAccountFilters(true);
        accountSearchInput.focus();
      },
      onOpenParentLinkModal: prefill => openParentLinkModal({
        users,
        links: links.items || [],
        prefill,
        onJumpTab: tabKey => switchAdminTab(tabKey)
      }),
      onOpenParentUnlinkModal: payload => openParentUnlinkModal(payload)
    })
  );

  const details = (title, body, open = false) => el('details', open ? {open: true} : {}, el('summary', {text: title}), body);

  // KHU VỰC 4: LỚP HỌC & NĂM HỌC
  const catalogPanel = el('div', {id: 'admin-panel-catalog', role: 'tabpanel', hidden: activeAdminTab !== 'catalog'},
    details(`Danh mục & Chỉnh sửa các lớp học (${classes.length})`, el('div', {}, classes.map(c => {
      const studentCount = normalizedMemberships.filter(m => m.class_id === c.id && m.member_role === 'student' && m.isEffectiveActive).length;
      const yearName = years.items.find(y => y.id === (c.schoolYearId || c.school_year_id))?.name || '';
      const metaText = [yearName, c.schedule || 'Chưa cập nhật lịch học', `${studentCount} học sinh`].filter(Boolean).join(' · ');
      return el('article', {class: 'row row-layout'},
        el('div', {},
          el('h2', {class: 'admin-row-title', text: c.name}),
          el('p', {class: 'meta admin-row-meta', text: metaText})
        ),
        el('div', {class: 'actions'}, btn('Chỉnh lịch học', () => scheduleEditor(c), false, 'attendance'), btn('Đổi tên lớp', () => modal('Thông tin lớp học', form([
          ['name', 'Tên lớp', 'text', c.name]
        ], 'Lưu thông tin', async b => {
          await api('/api/admin/classes', {method: 'POST', idempotent: true, body: {...b, id: c.id}});
          classes = sortClasses((await api('/api/classes')).items);
          $('editor').close();
          await adminPage();
        })), false, 'edit'))
      );
    })), true),
    details('Tạo năm học mới', form([
      ['name', 'Tên năm học (VD: 2026 - 2027)'],
      ['startsOn', 'Ngày bắt đầu', 'date'],
      ['endsOn', 'Ngày kết thúc', 'date']
    ], 'Tạo năm học', async b => {
      await api('/api/admin/years', {method: 'POST', body: b});
      await adminPage();
    })),
    details('Tạo lớp học mới (Khối 6 đến Khối 12 hoặc lớp chuyên đề)', newClassForm(years.items))
  );

  const uniqueOpenMembersCount = new Set([
    ...activeStudentSummary.entries.map(e => e.uid),
    ...staffSummary.entries.map(e => e.uid)
  ]).size;
  const tabSpecs = [
    {key: 'approvals', label: 'Duyệt hồ sơ', count: staffRequests.length + pendingRequests.length, panel: approvalsPanel},
    {key: 'accounts', label: 'Tài khoản & Phân quyền', count: users.length, panel: accountsPanel},
    {key: 'memberships', label: 'Phân công thành viên', count: uniqueOpenMembersCount, panel: membershipsPanel},
    {key: 'catalog', label: 'Lớp học & Năm học', count: classes.length, panel: catalogPanel}
  ];
  const tabButtons = tabSpecs.map(spec => el('button', {
    type: 'button',
    role: 'tab',
    class: `admin-view-tab${activeAdminTab === spec.key ? ' is-active' : ''}`,
    'aria-selected': String(activeAdminTab === spec.key),
    'aria-controls': spec.panel.id,
    onclick: () => switchAdminTab(spec.key)
  },
  el('span', {text: spec.label}),
  el('span', {class: 'admin-view-tab-count', text: String(spec.count)})
  ));

  switchAdminTab = key => {
    activeAdminTab = key;
    for (let i = 0; i < tabSpecs.length; i++) {
      const active = tabSpecs[i].key === key;
      tabButtons[i].classList.toggle('is-active', active);
      tabButtons[i].setAttribute('aria-selected', String(active));
      tabSpecs[i].panel.hidden = !active;
    }
  };

  root.append(
    el('div', {class: 'admin-view-tabs', role: 'tablist', 'aria-label': 'Phân khu quản trị hệ thống'}, ...tabButtons),
    approvalsPanel,
    accountsPanel,
    membershipsPanel,
    catalogPanel
  );
  upgradeAllSelectsIn(root);
  scrollToAdminTargetSection(focusSection);
}

function openStudentAssignModal({users = [], classes: classList = [], normalizedMemberships = [], prefill = {}, onJumpTab = null} = {}) {
  const activeStudents = sortStudentsRoster(
    users
      .filter(u => u.status === 'active' && Array.isArray(u.roles) && u.roles.includes('student'))
      .map(u => ({...u, name: u.display_name}))
  );
  if (!classList.length || !activeStudents.length) {
    const body = el('div', {class: 'admin-modal-stack'},
      el('p', {
        class: 'meta',
        text: !classList.length
          ? 'Chưa có lớp học nào đang mở để xếp học sinh.'
          : 'Chưa có tài khoản Học sinh ở trạng thái Hoạt động. Hãy duyệt hồ sơ hoặc bật vai trò Học sinh tại tab Tài khoản & Phân quyền.'
      }),
      onJumpTab
        ? btn(!classList.length ? 'Mở Lớp học & Năm học' : 'Mở Tài khoản & Phân quyền', () => {
            $('editor').close();
            onJumpTab(!classList.length ? 'catalog' : 'accounts');
          }, true)
        : null
    );
    modal('Xếp học sinh vào lớp', body);
    return;
  }

  const activeClassesByStudent = new Map();
  for (const m of normalizedMemberships || []) {
    if (m.member_role === 'student' && m.isEffectiveActive) {
      const list = activeClassesByStudent.get(m.uid) || [];
      if (!list.some(item => item.classId === m.class_id)) {
        list.push({classId: m.class_id, className: m.className});
      }
      activeClassesByStudent.set(m.uid, list);
    }
  }

  const sortedClassList = sortClasses(classList);
  const defaultUid = prefill.uid && activeStudents.some(s => s.uid === prefill.uid) ? prefill.uid : activeStudents[0].uid;
  const defaultClassId = prefill.classId && sortedClassList.some(c => c.id === prefill.classId) ? prefill.classId : sortedClassList[0].id;

  const f = form([
    ['uid', 'Học sinh', 'select', defaultUid, {
      items: activeStudents.map(u => ({
        value: u.uid,
        label: [u.display_name, u.student_code || '', u.email || u.uid].filter(Boolean).join(' · ')
      }))
    }],
    ['classId', 'Xếp vào lớp', 'select', defaultClassId, {
      items: sortedClassList.map(c => ({value: c.id, label: c.name}))
    }]
  ], 'Lưu xếp lớp', async b => {
    await api('/api/admin/memberships', {method: 'POST', idempotent: true, body: {uid: b.uid, classId: b.classId, role: 'student', status: 'active'}});
    if (b.uid === me.uid) me = await api('/api/me');
    try { await adminPage(); } finally { $('editor').close(); }
    status('Đã xếp học sinh vào lớp.', false, 'success');
  });

  const hint = el('p', {class: 'meta admin-modal-hint', role: 'status'});
  const submitBtn = f.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.before(hint);

  const updateHint = () => {
    const uid = f.elements.uid.value;
    const classId = f.elements.classId.value;
    const current = activeClassesByStudent.get(uid) || [];
    if (current.some(item => item.classId === classId)) {
      hint.textContent = `Học sinh này đã đang học lớp được chọn (${current.map(c => c.className).join(', ')}).`;
      hint.classList.add('is-warning');
    } else if (current.length) {
      hint.textContent = `Hiện đang học: ${current.map(c => c.className).join(', ')}. Thao tác này sẽ xếp thêm vào lớp mới.`;
      hint.classList.remove('is-warning');
    } else {
      hint.textContent = 'Học sinh sẽ truy cập được đầy đủ nội dung lớp ngay sau khi lưu.';
      hint.classList.remove('is-warning');
    }
  };

  f.elements.uid.addEventListener('change', updateHint);
  f.elements.classId.addEventListener('change', updateHint);
  updateHint();
  modal('Xếp học sinh vào lớp', f);
}

function openStudentTransferModal({studentEntry, classes: classList = [], fromClassId = ''} = {}) {
  const currentActive = studentEntry?.activeClasses || [];
  const sortedClassList = sortClasses(classList);
  if (!currentActive.length || sortedClassList.length < 2) {
    modal(
      'Đổi lớp cho học sinh',
      el('p', {
        class: 'meta',
        text: sortedClassList.length < 2
          ? 'Cần ít nhất 2 lớp đang mở để thực hiện chuyển lớp.'
          : 'Học sinh này hiện chưa có lớp đang học để chuyển.'
      })
    );
    return;
  }

  const defaultSource = fromClassId && currentActive.some(c => c.classId === fromClassId)
    ? fromClassId
    : currentActive[0].classId;
  const destinationsFor = srcId => sortedClassList.filter(c => c.id !== srcId);
  const initialDestinations = destinationsFor(defaultSource);

  const f = form([
    ['sourceClassId', 'Từ lớp hiện tại', 'select', defaultSource, {
      items: currentActive.map(c => ({value: c.classId, label: c.className}))
    }],
    ['targetClassId', 'Chuyển sang lớp mới', 'select', initialDestinations[0]?.id || '', {
      items: initialDestinations.map(c => ({value: c.id, label: c.name}))
    }]
  ], 'Xác nhận chuyển lớp', async b => {
    if (!b.targetClassId || b.targetClassId === b.sourceClassId) {
      throw Error('Hãy chọn lớp mới khác với lớp hiện tại.');
    }
    await api('/api/admin/memberships', {
      method: 'POST',
      idempotent: true,
      body: {uid: studentEntry.uid, classId: b.targetClassId, role: 'student', status: 'active'}
    });
    if (!keepCurrentCheck.checked) {
      await api('/api/admin/memberships', {
        method: 'POST',
        idempotent: true,
        body: {uid: studentEntry.uid, classId: b.sourceClassId, role: 'student', status: 'inactive'}
      });
    }
    if (studentEntry.uid === me.uid) me = await api('/api/me');
    try { await adminPage(); } finally { $('editor').close(); }
    status(keepCurrentCheck.checked ? 'Đã thêm lớp học mới cho học sinh.' : 'Đã chuyển lớp cho học sinh.', false, 'success');
  });

  f.prepend(el('p', {class: 'meta', text: `Học sinh: ${studentEntry.displayName}`}));
  const keepCurrentCheck = el('input', {type: 'checkbox'});
  const keepCurrentLabel = el('label', {class: 'check'}, keepCurrentCheck, 'Giữ nguyên lớp hiện tại (học song song thêm lớp mới)');
  const submitBtn = f.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.before(keepCurrentLabel);

  f.elements.sourceClassId.addEventListener('change', () => {
    const nextDst = destinationsFor(f.elements.sourceClassId.value);
    f.elements.targetClassId.replaceChildren(
      ...nextDst.map(c => el('option', {value: c.id, text: c.name}))
    );
    if (nextDst[0]) f.elements.targetClassId.value = nextDst[0].id;
  });

  modal('Đổi lớp cho học sinh', f);
}

function openStudentStatusModal({studentEntry, targetClassId = '', nextStatus = 'inactive'} = {}) {
  const isReactivating = nextStatus === 'active';
  const candidates = isReactivating ? (studentEntry?.inactiveClasses || []) : (studentEntry?.activeClasses || []);
  if (!candidates.length) return;
  const defaultClassId = targetClassId && candidates.some(c => c.classId === targetClassId)
    ? targetClassId
    : candidates[0].classId;

  const f = form([
    ['classId', isReactivating ? 'Khôi phục tại lớp' : 'Ngừng học tại lớp', 'select', defaultClassId, {
      items: candidates.map(c => ({value: c.classId, label: c.className}))
    }]
  ], isReactivating ? 'Xác nhận cho học lại' : 'Xác nhận ngừng học', async b => {
    await api('/api/admin/memberships', {
      method: 'POST',
      idempotent: true,
      body: {uid: studentEntry.uid, classId: b.classId, role: 'student', status: nextStatus}
    });
    if (studentEntry.uid === me.uid) me = await api('/api/me');
    try { await adminPage(); } finally { $('editor').close(); }
    status(isReactivating ? 'Đã khôi phục học sinh vào lớp.' : 'Đã chuyển học sinh sang trạng thái đã nghỉ.', false, 'success');
  });

  f.prepend(
    el('p', {class: 'meta', text: `Học sinh: ${studentEntry.displayName}`}),
    el('p', {
      class: 'meta',
      text: isReactivating
        ? 'Học sinh sẽ được mở lại quyền truy cập và điểm danh trong lớp này.'
        : 'Học sinh sẽ ngừng tham gia lớp được chọn; lịch sử điểm danh và bài nộp cũ vẫn được giữ nguyên.'
    })
  );
  modal(isReactivating ? 'Cho học sinh học lại' : 'Ngừng học tại lớp', f);
}

function openParentLinkModal({users = [], links = [], prefill = {}, onJumpTab = null} = {}) {
  const parents = sortStudentsRoster(
    users
      .filter(u => u.status === 'active' && Array.isArray(u.roles) && !isStaffRoleList(u.roles) && u.roles.includes('parent'))
      .map(u => ({...u, name: u.display_name}))
  );
  const students = sortStudentsRoster(
    users
      .filter(u => u.status === 'active' && Array.isArray(u.roles) && !isStaffRoleList(u.roles) && u.roles.includes('student'))
      .map(u => ({...u, name: u.display_name}))
  );
  if (!parents.length || !students.length) {
    modal(
      'Liên kết phụ huynh & học sinh',
      el('div', {class: 'admin-modal-stack'},
        el('p', {
          class: 'meta',
          text: 'Cần có ít nhất một tài khoản Phụ huynh và một tài khoản Học sinh đang ở trạng thái Hoạt động để tạo liên kết.'
        }),
        onJumpTab
          ? btn('Mở Tài khoản & Phân quyền', () => {
              $('editor').close();
              onJumpTab('accounts');
            }, true)
          : null
      )
    );
    return;
  }

  const activeLinkedByParent = new Map();
  for (const link of links || []) {
    if (link.status !== 'inactive') {
      const set = activeLinkedByParent.get(link.parent_uid) || new Set();
      set.add(link.student_uid);
      activeLinkedByParent.set(link.parent_uid, set);
    }
  }

  const availableStudentsFor = pUid => {
    const linked = activeLinkedByParent.get(pUid) || new Set();
    return students.filter(s => s.uid !== pUid && (!linked.has(s.uid) || s.uid === prefill.studentUid));
  };

  const defaultParent = prefill.parentUid && parents.some(p => p.uid === prefill.parentUid) ? prefill.parentUid : parents[0].uid;
  const initialStudents = availableStudentsFor(defaultParent);
  const defaultStudent = prefill.studentUid && initialStudents.some(s => s.uid === prefill.studentUid)
    ? prefill.studentUid
    : (initialStudents[0]?.uid || '');

  const f = form([
    ['parentUid', 'Phụ huynh', 'select', defaultParent, {
      items: parents.map(u => ({value: u.uid, label: `${u.display_name}${u.email ? ` · ${u.email}` : ''}`}))
    }],
    ['studentUid', 'Học sinh', 'select', defaultStudent, {
      items: initialStudents.length
        ? initialStudents.map(u => ({value: u.uid, label: `${u.display_name}${u.student_code ? ` · ${u.student_code}` : ''}`}))
        : [{value: '', label: 'Đã liên kết với toàn bộ học sinh hiện có'}]
    }]
  ], 'Lưu liên kết', async b => {
    if (!b.studentUid) throw Error('Phụ huynh này đã liên kết đủ học sinh hiện có.');
    await api('/api/admin/parent-links', {method: 'POST', idempotent: true, body: {parentUid: b.parentUid, studentUid: b.studentUid, status: 'active'}});
    if (b.parentUid === me.uid) me = await api('/api/me');
    try { await adminPage(); } finally { $('editor').close(); }
    status('Đã lưu liên kết phụ huynh - học sinh.', false, 'success');
  });

  const submitBtn = f.querySelector('button[type="submit"]');
  const syncStudentOptions = () => {
    const list = availableStudentsFor(f.elements.parentUid.value);
    f.elements.studentUid.replaceChildren(
      ...(list.length
        ? list.map(u => el('option', {value: u.uid, text: `${u.display_name}${u.student_code ? ` · ${u.student_code}` : ''}`}))
        : [el('option', {value: '', text: 'Đã liên kết với toàn bộ học sinh hiện có'})])
    );
    f.elements.studentUid.value = list[0]?.uid || '';
    f.elements.studentUid.disabled = !list.length;
    if (submitBtn) submitBtn.disabled = !list.length;
  };

  f.elements.parentUid.addEventListener('change', syncStudentOptions);
  syncStudentOptions();
  modal('Liên kết tài khoản phụ huynh & học sinh', f);
}

function openParentUnlinkModal({parentUid, parentName, child, nextStatus = 'inactive'} = {}) {
  if (!parentUid || !child?.studentUid) return;
  const isRestoring = nextStatus === 'active';
  const f = form([], isRestoring ? 'Xác nhận nối lại liên kết' : 'Xác nhận ngừng liên kết', async () => {
    await api('/api/admin/parent-links', {
      method: 'POST',
      idempotent: true,
      body: {parentUid, studentUid: child.studentUid, status: nextStatus}
    });
    if (parentUid === me.uid) me = await api('/api/me');
    try { await adminPage(); } finally { $('editor').close(); }
    status(isRestoring ? 'Đã khôi phục liên kết phụ huynh - học sinh.' : 'Đã ngừng liên kết phụ huynh - học sinh.', false, 'success');
  });
  f.prepend(
    el('p', {class: 'meta', text: `Phụ huynh: ${parentName}`}),
    el('p', {class: 'meta', text: `Học sinh: ${child.studentName}${child.studentCode ? ` (${child.studentCode})` : ''}`}),
    el('p', {
      class: 'meta',
      text: isRestoring
        ? 'Phụ huynh sẽ xem lại được chuyên cần và kết quả học tập của học sinh này.'
        : 'Phụ huynh sẽ ngừng xem dữ liệu của học sinh này; các liên kết với học sinh khác (nếu có) vẫn giữ nguyên.'
    })
  );
  modal(isRestoring ? 'Nối lại liên kết phụ huynh' : 'Ngừng liên kết phụ huynh', f);
}

async function approvalDialog(req) {
  const version = viewVersion;
  const reqYearId = req.schoolYearId || req.school_year_id;
  const matched = reqYearId ? visibleClasses().filter(c => (c.schoolYearId || c.school_year_id) === reqYearId) : [];
  const destinations = matched.length ? matched : visibleClasses();
  const parent = req.applicantRole === 'parent';
  const fields = [['classId', 'Lớp được duyệt', 'select', req.classId, {items: destinations.map(c => ({value: c.id, label: c.name}))}]];
  const f = form(fields, parent ? 'Duyệt và liên kết phụ huynh' : 'Xác nhận duyệt vào lớp', async b => {
    const childUid = child?.input.value || '';
    if (parent && !childUid) throw Error('Hãy chọn học sinh đang học trong lớp để liên kết phụ huynh.');
    const result = await api('/api/admin/enrollments/review', {method: 'POST', body: {requestId: req.id, version: req.version, action: 'approve', classId: b.classId, ...(parent ? {childUid} : {})}});
    if (version !== viewVersion) return;
    $('editor').close();
    await adminPage();
    status(result.notificationStatus === 'sent' ? 'Đã duyệt và gửi email thông báo.' : 'Đã duyệt; email thông báo đang chờ gửi.');
  });
  f.prepend(el('p', {text: `${req.fullName} · ${labels[req.applicantRole || 'student']}`}));
  const save = f.querySelector('button[type=submit]');
  const child = parent ? field('childUid', 'Học sinh liên kết', 'select', '', {items: [{value: '', label: 'Đang tải danh sách học sinh…'}]}) : null;
  const hint = el('p', {class: 'meta', role: 'status'});
  if (child) save.before(child.label, hint);
  let sequence = 0;
  const loadChildren = async () => {
    const current = ++sequence;
    const classId = f.elements.classId.value;
    save.disabled = true; child.input.disabled = true;
    hint.textContent = 'Đang kiểm tra học sinh đang theo học trong lớp…';
    try {
      const response = await api(`/api/admin/enrollments/students?classId=${encodeURIComponent(classId)}`);
      if (current !== sequence || version !== viewVersion || !f.isConnected) return;
      const items = response.items.filter(item => item.uid !== req.uid);
      child.input.replaceChildren(el('option', {value: '', text: 'Chọn đúng học sinh cần theo dõi'}), ...items.map(item => el('option', {value: item.uid, text: `${item.name} · ${item.studentCode || item.uid.slice(-6)}`})));
      child.input.disabled = !items.length;
      save.disabled = !items.length;
      hint.textContent = items.length ? 'Chỉ liên kết với học sinh đã được duyệt và đang tham gia lớp. Phụ huynh chỉ xem dữ liệu của học sinh được liên kết.' : 'Lớp chưa có học sinh đã được duyệt. Hãy duyệt học sinh trước hoặc chọn lớp có học sinh cần liên kết.';
    } catch (e) {
      if (current !== sequence || version !== viewVersion || !f.isConnected) return;
      showFormError(f, friendly(e)); hint.textContent = 'Chọn lại lớp để thử tải danh sách học sinh.';
    }
  };
  if (parent) f.elements.classId.onchange = () => run(loadChildren);
  modal(parent ? 'Duyệt hồ sơ phụ huynh' : 'Duyệt hồ sơ học sinh', f);
  if (parent) await loadChildren();
}

function rolesInput(values) {
  const inputs = [];
  return {
    box: el('div', {class: 'role-checks'}, Object.entries(labels).map(([key, label]) => {
      const input = el('input', {type: 'checkbox', value: key, checked: values.includes(key)});
      inputs.push(input);
      return el('label', {class: 'check'}, input, label);
    })),
    read: () => inputs.filter(i => i.checked).map(i => i.value)
  };
}

async function settings(initialTab = activeSettingsTab) {
  activeSettingsTab = resolveAccountTab(initialTab);
  const version = loadingPage('Tài khoản cá nhân');
  const rawProfile = await api('/api/profile');
  if (version !== viewVersion) return;

  const accountEmail = auth.currentUser?.email || rawProfile?.email || me?.email || '';
  let profile = normalizeAccountProfile(rawProfile, me, accountEmail);
  const providerInfo = describeAuthProviders(auth.currentUser?.providerData || []);
  const viewRoles = availableViewRoles(me);
  const isAdminAccount = Array.isArray(me?.roles) && me.roles.includes('admin');
  const isStaffAccount = isStaffRoleList(me?.roles);
  const displayRolePills = isAdminAccount ? ['admin'] : viewRoles;

  function buildCopyActionButton(textToCopy, {label = 'Sao chép', copiedLabel = 'Đã sao chép', toastText = 'Đã sao chép vào bộ nhớ tạm.', className = 'account-copy-btn'} = {}) {
    let resetTimer = null;
    const labelSpan = el('span', {text: label});
    const copyBtn = el(
      'button',
      {
        type: 'button',
        class: className,
        'aria-label': `${label}: ${textToCopy}`,
        onclick: async () => {
          let copied = false;
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(textToCopy);
              copied = true;
            }
          } catch {}
          if (!copied) {
            try {
              const ta = el('textarea', {value: textToCopy, class: 'account-sr-copy-buffer', 'aria-hidden': 'true'});
              document.body.append(ta);
              ta.select();
              copied = document.execCommand('copy');
              ta.remove();
            } catch {}
          }
          if (copied) {
            labelSpan.textContent = copiedLabel;
            copyBtn.classList.add('is-copied');
            if (resetTimer) clearTimeout(resetTimer);
            resetTimer = setTimeout(() => {
              labelSpan.textContent = label;
              copyBtn.classList.remove('is-copied');
            }, 1800);
            status(toastText, false, 'success');
          } else {
            status('Không thể tự động sao chép. Vui lòng chọn và sao chép thủ công.', true);
          }
        }
      },
      icon('copy'),
      labelSpan
    );
    return copyBtn;
  }

  function buildCardHead(iconName, title, subtitle = '', badgeNode = null) {
    return el(
      'div',
      {class: 'account-card-head'},
      el(
        'div',
        {class: 'account-card-head-main'},
        el('span', {class: 'account-card-icon', 'aria-hidden': 'true'}, icon(iconName)),
        el(
          'div',
          {class: 'account-card-head-text'},
          el('h2', {text: title}),
          subtitle ? el('p', {class: 'meta', text: subtitle}) : null
        )
      ),
      badgeNode || null
    );
  }

  function buildPasswordInputControl({name, label, autocomplete, helper = ''}) {
    const input = el('input', {
      id: `account-pw-${name}`,
      name,
      type: 'password',
      autocomplete,
      required: true,
      minLength: name === 'current' ? 1 : 8,
      maxLength: 128,
      placeholder: '••••••••'
    });
    const toggleBtn = el(
      'button',
      {
        type: 'button',
        class: 'account-password-toggle',
        'aria-label': `Hiện ${label.toLowerCase()}`,
        'aria-pressed': 'false',
        onclick: () => {
          const showing = input.type === 'text';
          input.type = showing ? 'password' : 'text';
          toggleBtn.setAttribute('aria-pressed', showing ? 'false' : 'true');
          toggleBtn.setAttribute('aria-label', showing ? `Hiện ${label.toLowerCase()}` : `Ẩn ${label.toLowerCase()}`);
          const ic = icon(showing ? 'eye' : 'eyeOff');
          if (ic) toggleBtn.replaceChildren(ic);
        }
      },
      icon('eye')
    );
    const wrap = el('div', {class: 'account-password-wrap'}, input, toggleBtn);
    const feedback = attachFieldFeedback(input, label);
    const labelNode = el(
      'label',
      {class: 'account-field-label', for: input.id},
      el('span', {class: 'field-label'}, label, el('span', {class: 'required-mark', 'aria-hidden': 'true', text: ' *'})),
      wrap,
      helper ? el('span', {class: 'account-field-hint', text: helper}) : null,
      feedback
    );
    return {input, label: labelNode};
  }

  const root = el('div', {class: 'account-page-root'});
  const heroTitleEl = el('h1', {id: 'account-hero-name', text: profile.displayName || me.name});
  const heroAvatarSlot = el('div', {class: 'account-hero-avatar-slot'});
  function renderHeroAvatar() {
    if (profile.enrollment?.photoUrl) {
      heroAvatarSlot.replaceChildren(authenticatedAvatar(profile.enrollment.photoUrl, profile.displayName || me.name, 'account-hero-avatar is-photo'));
    } else {
      heroAvatarSlot.replaceChildren(
        el('div', {class: 'account-hero-avatar', 'aria-hidden': 'true'}, formatUserInitials(profile.displayName || me.name, 'LT'))
      );
    }
  }
  renderHeroAvatar();

  const currentClasses = sortClasses(visibleClasses());
  const codeValue = !isStaffAccount && viewRole === 'student' ? (profile.ownStudentCode || profile.studentCode || '') : '';
  const heroChips = el(
    'div',
    {class: 'account-hero-chips'},
    profile.email
      ? el('span', {class: 'account-hero-chip'}, icon('mail'), el('span', {text: profile.email}))
      : null,
    codeValue
      ? el(
          'span',
          {class: 'account-hero-chip is-code'},
          el('span', {text: `Mã HS: ${codeValue}`}),
          buildCopyActionButton(codeValue, {
            label: 'Sao chép mã',
            copiedLabel: 'Đã sao chép',
            toastText: `Đã sao chép mã học sinh ${codeValue}.`,
            className: 'account-chip-copy-btn'
          })
        )
      : null,
    el(
      'span',
      {class: 'account-hero-chip'},
      icon('class'),
      el('span', {
        text: currentClasses.length
          ? (viewRole === 'student' || viewRole === 'parent') && currentClasses.length <= 2
            ? currentClasses.map(c => c.name).join(', ')
            : `${currentClasses.length} lớp hoạt động`
          : 'Chưa gắn lớp'
      })
    )
  );

  const heroSection = el(
    'section',
    {class: 'welcome-card account-hero'},
    el(
      'div',
      {class: 'account-hero-main'},
      heroAvatarSlot,
      el(
        'div',
        {class: 'account-hero-copy'},
        el(
          'div',
          {class: 'account-hero-badges'},
          el('span', {class: 'welcome-badge', text: labels[viewRole] || 'Thành viên'}),
          el('span', {class: 'account-status-pill'}, el('span', {class: 'account-status-dot', 'aria-hidden': 'true'}), el('span', {text: 'Đang hoạt động'})),
          ...displayRolePills.filter(r => r !== viewRole).map(r => el('span', {class: 'account-secondary-role-pill', text: labels[r]}))
        ),
        heroTitleEl,
        heroChips
      )
    ),
    el(
      'div',
      {class: 'account-hero-actions'},
      el(
        'button',
        {
          type: 'button',
          class: 'overview-hero-refresh-btn',
          onclick: () => run(() => settings(activeSettingsTab))
        },
        icon('refresh'),
        el('span', {text: 'Cập nhật'})
      )
    )
  );

  const tabPanelHost = el('div', {
    id: 'account-tab-panel',
    class: 'account-tab-panel',
    role: 'tabpanel'
  });

  const tabButtons = new Map();
  function selectTab(nextTab, {pushHistory = true} = {}) {
    const resolved = resolveAccountTab(nextTab);
    activeSettingsTab = resolved;
    for (const tab of ACCOUNT_TABS) {
      const btnNode = tabButtons.get(tab.id);
      if (!btnNode) continue;
      const isActive = tab.id === resolved;
      btnNode.classList.toggle('is-active', isActive);
      btnNode.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btnNode.tabIndex = isActive ? 0 : -1;
    }
    tabPanelHost.setAttribute('aria-labelledby', `account-tab-btn-${resolved}`);
    if (pushHistory) {
      syncBrowserUrl({replace: false, subPage: resolved === 'profile' ? null : resolved});
    }
    renderActiveTab(resolved);
    upgradeAllSelectsIn(tabPanelHost);
  }

  const tabBar = el(
    'div',
    {class: 'account-tabs', role: 'tablist', 'aria-label': 'Mục quản lý tài khoản cá nhân'},
    ACCOUNT_TABS.map((tab, idx) => {
      const tabBtn = el(
        'button',
        {
          id: `account-tab-btn-${tab.id}`,
          type: 'button',
          role: 'tab',
          class: `account-tab${tab.id === activeSettingsTab ? ' is-active' : ''}`,
          'aria-selected': tab.id === activeSettingsTab ? 'true' : 'false',
          'aria-controls': 'account-tab-panel',
          tabIndex: tab.id === activeSettingsTab ? 0 : -1,
          onclick: () => selectTab(tab.id, {pushHistory: true}),
          onkeydown: e => {
            let nextIdx = null;
            if (e.key === 'ArrowRight') nextIdx = (idx + 1) % ACCOUNT_TABS.length;
            else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + ACCOUNT_TABS.length) % ACCOUNT_TABS.length;
            else if (e.key === 'Home') nextIdx = 0;
            else if (e.key === 'End') nextIdx = ACCOUNT_TABS.length - 1;
            if (nextIdx !== null) {
              e.preventDefault();
              const target = ACCOUNT_TABS[nextIdx];
              selectTab(target.id, {pushHistory: true});
              tabButtons.get(target.id)?.focus();
            }
          }
        },
        icon(tab.icon),
        el('span', {text: tab.label})
      );
      tabButtons.set(tab.id, tabBtn);
      return tabBtn;
    })
  );

  function renderProfileTab() {
    let savedName = profile.displayName;
    let savedPhone = profile.contactPhone;

    const formErrBox = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
    const nameInput = el('input', {
      id: 'account-input-name',
      name: 'name',
      type: 'text',
      value: savedName,
      required: true,
      maxLength: 160,
      autocomplete: 'name',
      placeholder: 'Nhập họ và tên hiển thị'
    });
    const phoneInput = el('input', {
      id: 'account-input-phone',
      name: 'phone',
      type: 'tel',
      value: savedPhone,
      required: false,
      maxLength: 30,
      autocomplete: 'tel',
      placeholder: '09xx xxx xxx'
    });
    const emailInput = el('input', {
      id: 'account-input-email',
      type: 'email',
      value: profile.email || '(chưa có email)',
      readOnly: true,
      'aria-readonly': 'true',
      class: 'account-readonly-input'
    });

    const saveStatusEl = el('span', {class: 'account-save-hint meta', 'aria-live': 'polite', text: 'Thông tin hiển thị dùng chung cho lớp học và liên hệ.'});
    const saveBtn = el('button', {type: 'submit', class: 'primary', text: 'Lưu thay đổi hồ sơ'});
    const resetBtn = el('button', {
      type: 'button',
      class: 'account-secondary-btn',
      text: 'Hoàn tác',
      disabled: true,
      onclick: () => {
        nameInput.value = savedName;
        phoneInput.value = savedPhone;
        formErrBox.hidden = true;
        formErrBox.textContent = '';
        syncDirtyState();
      }
    });

    const syncDirtyState = () => {
      const dirty = nameInput.value.trim() !== savedName || phoneInput.value.trim() !== savedPhone;
      resetBtn.disabled = !dirty;
      if (dirty) {
        saveStatusEl.textContent = 'Có thay đổi chưa lưu.';
        saveStatusEl.classList.add('is-dirty');
      } else {
        saveStatusEl.textContent = 'Thông tin hiển thị dùng chung cho lớp học và liên hệ.';
        saveStatusEl.classList.remove('is-dirty');
      }
    };

    const nameField = el(
      'label',
      {class: 'account-field-label', for: nameInput.id},
      el('span', {class: 'field-label'}, 'Họ và tên hiển thị', el('span', {class: 'required-mark', 'aria-hidden': 'true', text: ' *'})),
      nameInput,
      el('span', {class: 'account-field-hint', text: 'Tên này xuất hiện trên thanh điều hướng, diễn đàn lớp và danh sách điểm danh.'}),
      attachFieldFeedback(nameInput, 'Họ và tên hiển thị')
    );

    const phoneField = el(
      'label',
      {class: 'account-field-label', for: phoneInput.id},
      el('span', {class: 'field-label'}, 'Số điện thoại liên hệ (không bắt buộc)'),
      phoneInput,
      el('span', {class: 'account-field-hint', text: 'Dùng khi giáo viên hoặc ban quản trị cần liên hệ gấp về lịch học.'}),
      attachFieldFeedback(phoneInput, 'Số điện thoại liên hệ')
    );

    const emailField = el(
      'label',
      {class: 'account-field-label', for: emailInput.id},
      el('span', {class: 'field-label'}, 'Email đăng nhập (cố định)'),
      el('div', {class: 'account-readonly-wrap'}, emailInput, el('span', {class: 'account-readonly-lock', 'aria-hidden': 'true'}, icon('lock'))),
      el('span', {class: 'account-field-hint', text: 'Email gắn với xác thực đăng nhập Google / OTP 2 lớp và nhận thông báo lớp học.'})
    );

    const profileFormEl = el(
      'form',
      {
        class: 'account-form',
        oninput: () => {
          formErrBox.hidden = true;
          formErrBox.textContent = '';
          syncDirtyState();
        },
        onsubmit: async e => {
          e.preventDefault();
          formErrBox.hidden = true;
          formErrBox.textContent = '';
          const nameCheck = validateDisplayName(nameInput.value);
          if (!nameCheck.valid) {
            formErrBox.textContent = nameCheck.error;
            formErrBox.hidden = false;
            formErrBox.focus();
            return;
          }
          const phoneCheck = validateContactPhone(phoneInput.value);
          if (!phoneCheck.valid) {
            formErrBox.textContent = phoneCheck.error;
            formErrBox.hidden = false;
            formErrBox.focus();
            return;
          }
          saveBtn.disabled = true;
          saveBtn.textContent = 'Đang lưu…';
          try {
            await api('/api/profile', {method: 'POST', idempotent: true, body: {name: nameCheck.value, phone: phoneCheck.value}});
            savedName = nameCheck.value;
            savedPhone = phoneCheck.value;
            profile.displayName = savedName;
            profile.contactPhone = savedPhone;
            me.name = savedName;
            cachedProfileForWatermark = null;
            cachedProfileForWatermarkUid = null;
            heroTitleEl.textContent = savedName;
            renderHeroAvatar();
            syncAccountIdentityUI();
            syncDirtyState();
            saveStatusEl.textContent = 'Đã lưu thay đổi gần nhất thành công.';
            status('Hồ sơ cá nhân đã được lưu thành công.', false, 'success');
          } catch (err) {
            formErrBox.textContent = friendly(err);
            formErrBox.hidden = false;
            formErrBox.focus();
          } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Lưu thay đổi hồ sơ';
          }
        }
      },
      formErrBox,
      nameField,
      phoneField,
      emailField,
      el('div', {class: 'account-form-actions'}, saveBtn, resetBtn),
      saveStatusEl
    );

    const profileCard = el(
      'section',
      {class: 'account-card'},
      buildCardHead('user', 'Thông tin cá nhân & Liên hệ', 'Quản lý tên hiển thị và số điện thoại liên lạc chính thức.'),
      profileFormEl
    );

    const identityRows = [
      {label: 'Trạng thái tài khoản', value: 'Đang hoạt động', badgeClass: 'badge badge-success'},
      profile.createdAt ? {label: 'Ngày tham gia', value: formatVietnamDate(profile.createdAt)} : null,
      codeValue ? {label: 'Mã học sinh', value: codeValue, copyable: true} : null,
      {label: 'Vai trò được cấp', value: displayRolePills.map(r => labels[r] || r).join(', ')}
    ].filter(Boolean);

    const identityKvList = el(
      'dl',
      {class: 'account-kv-list'},
      identityRows.map(item =>
        el(
          'div',
          {class: 'account-kv-row'},
          el('dt', {text: item.label}),
          el(
            'dd',
            {},
            item.badgeClass
              ? el('span', {class: item.badgeClass, text: item.value})
              : el('span', {text: item.value}),
            item.copyable
              ? buildCopyActionButton(item.value, {
                  label: 'Sao chép',
                  copiedLabel: 'Đã sao chép',
                  toastText: `Đã sao chép ${item.label.toLowerCase()}: ${item.value}.`
                })
              : null
          )
        )
      )
    );

    const enrollmentBox = !isStaffAccount && profile.enrollment
      ? el(
          'div',
          {class: 'account-enrollment-summary'},
          el('h3', {class: 'account-subheading', text: 'Hồ sơ nhập học đã xác minh'}),
          el(
            'dl',
            {class: 'account-kv-list is-compact'},
            [
              {label: 'Họ tên học sinh', value: profile.enrollment.fullName},
              profile.enrollment.dateOfBirth ? {label: 'Ngày sinh', value: formatIsoDob(profile.enrollment.dateOfBirth)} : null,
              profile.enrollment.schoolName ? {label: 'Trường học', value: profile.enrollment.schoolName} : null,
              profile.enrollment.parentName
                ? {
                    label: PARENT_RELATION_LABELS[profile.enrollment.parentRelation] || 'Phụ huynh / Giám hộ',
                    value: `${profile.enrollment.parentName}${profile.enrollment.parentPhone ? ` · ${profile.enrollment.parentPhone}` : ''}`
                  }
                : null,
              profile.enrollment.studentPhone ? {label: 'SĐT học sinh (hồ sơ)', value: profile.enrollment.studentPhone} : null
            ]
              .filter(Boolean)
              .map(row =>
                el('div', {class: 'account-kv-row'}, el('dt', {text: row.label}), el('dd', {text: row.value}))
              )
          ),
          el(
            'div',
            {class: 'account-inline-note-box'},
            el('p', {class: 'meta', text: 'Thông tin hồ sơ lớp học (ngày sinh, trường học, phụ huynh) được cố định sau khi duyệt. Nếu có sai sót, hãy gửi yêu cầu điều chỉnh.'}),
            el(
              'button',
              {
                type: 'button',
                class: 'account-inline-action-btn',
                onclick: () => selectTab('privacy', {pushHistory: true})
              },
              icon('mail'),
              el('span', {text: 'Gửi yêu cầu điều chỉnh hồ sơ'})
            )
          )
        )
      : null;

    const identityCard = el(
      'section',
      {class: 'account-card'},
      buildCardHead('assignment', 'Tóm tắt định danh & Hồ sơ lớp học', 'Thông tin đối chiếu hồ sơ trên hệ thống Lớp Toán cô Hạnh.'),
      identityKvList,
      enrollmentBox
    );

    const roleSwitcherCard = shouldShowRoleSwitcher(viewRoles)
      ? el(
          'section',
          {class: 'account-card'},
          buildCardHead('layers', 'Góc nhìn vai trò hiện tại', 'Tài khoản của bạn được cấp nhiều vai trò. Chọn góc nhìn phù hợp khi làm việc.'),
          el(
            'div',
            {class: 'account-role-grid'},
            viewRoles.map(role => {
              const selected = role === viewRole;
              return el(
                'button',
                {
                  type: 'button',
                  class: `account-role-card${selected ? ' is-selected' : ''}`,
                  'aria-pressed': selected ? 'true' : 'false',
                  onclick: () =>
                    run(async () => {
                      if (viewRole === role) return;
                      viewRole = role;
                      saveViewRole(role);
                      navigation();
                      syncAccountIdentityUI();
                      await settings(activeSettingsTab);
                      status(`Đã chuyển góc nhìn sang ${labels[role] || role}.`, false, 'success');
                    })
                },
                el(
                  'div',
                  {class: 'account-role-card-head'},
                  el('strong', {text: labels[role] || role}),
                  selected ? el('span', {class: 'badge badge-info', text: 'Đang xem'}) : null
                ),
                el('span', {class: 'meta', text: ROLE_DESCRIPTIONS[role] || ''})
              );
            })
          ),
          el(
            'div',
            {class: 'account-role-card-footer'},
            btn(`Mở Tổng quan (${labels[viewRole] || 'Thành viên'})`, () => navigateTo('home'), false, 'dashboard')
          )
        )
      : null;

    const linkedStudentsCard = shouldShowLinkedStudentsCard(me?.roles, viewRole)
      ? el(
          'section',
          {class: 'account-card'},
          buildCardHead('users', 'Học sinh đang theo dõi', 'Tài khoản học sinh đã liên kết với tài khoản phụ huynh của bạn.'),
          el(
            'div',
            {class: 'account-linked-list'},
            profile.linkedStudents.length
              ? profile.linkedStudents.map(child => {
                  const childClassObjs = (child.class_ids || []).map(cid => classes.find(c => c.id === cid)).filter(Boolean);
                  const primaryChildClass = childClassObjs[0] || null;
                  return el(
                    'article',
                    {class: 'account-linked-card'},
                    el(
                      'div',
                      {class: 'account-linked-head'},
                      el('span', {class: 'user-avatar', 'aria-hidden': 'true', text: formatUserInitials(child.display_name, 'HS')}),
                      el(
                        'div',
                        {class: 'account-linked-meta'},
                        el('strong', {text: child.display_name}),
                        el('span', {
                          class: 'meta',
                          text: childClassObjs.length ? childClassObjs.map(c => c.name).join(', ') : 'Chưa xếp lớp'
                        })
                      ),
                      child.student_code
                        ? el(
                            'div',
                            {class: 'account-linked-code'},
                            el('span', {class: 'badge badge-info', text: `Mã HS: ${child.student_code}`}),
                            buildCopyActionButton(child.student_code, {
                              label: 'Sao chép',
                              copiedLabel: 'Đã sao chép',
                              toastText: `Đã sao chép mã HS ${child.student_code}.`
                            })
                          )
                        : null
                    ),
                    primaryChildClass
                      ? el(
                          'div',
                          {class: 'account-linked-actions'},
                          btn('Vào lớp học', () => openClass(primaryChildClass, 'notices', {isClassEntry: true}), true, 'class'),
                          btn('Điểm danh', () => openClass(primaryChildClass, 'attendance'), false, 'attendance'),
                          btn('Thông báo', () => openClass(primaryChildClass, 'notices'), false, 'notice')
                        )
                      : null
                  );
                })
              : [
                  el(
                    'div',
                    {class: 'account-inline-note-box'},
                    el('p', {
                      class: 'meta',
                      text: 'Chưa có tài khoản học sinh nào liên kết với tài khoản phụ huynh này. Hãy cung cấp mã học sinh cho ban quản trị để hoàn tất liên kết.'
                    })
                  )
                ]
          )
        )
      : null;

    const linkedParentsCard = shouldShowLinkedParentsCard(me?.roles, viewRole)
      ? el(
          'section',
          {class: 'account-card'},
          buildCardHead('users', 'Liên kết phụ huynh', 'Phụ huynh được liên kết sẽ theo dõi được điểm danh, bài tập và thông báo lớp học.'),
          el(
            'div',
            {class: 'account-linked-list'},
            profile.linkedParents.length
              ? profile.linkedParents.map(parent =>
                  el(
                    'article',
                    {class: 'account-linked-card'},
                    el(
                      'div',
                      {class: 'account-linked-head'},
                      el('span', {class: 'user-avatar', 'aria-hidden': 'true', text: formatUserInitials(parent.display_name, 'PH')}),
                      el(
                        'div',
                        {class: 'account-linked-meta'},
                        el('strong', {text: parent.display_name}),
                        el('span', {
                          class: 'meta',
                          text: [parent.email, parent.contact_phone].filter(Boolean).join(' · ') || 'Tài khoản phụ huynh đã liên kết'
                        })
                      ),
                      el('span', {class: 'badge badge-success', text: 'Đã liên kết'})
                    )
                  )
                )
              : [
                  el(
                    'div',
                    {class: 'account-inline-note-box'},
                    el('p', {
                      class: 'meta',
                      text: codeValue
                        ? `Chưa có tài khoản phụ huynh nào liên kết. Bố/mẹ có thể đăng ký tài khoản Phụ huynh và cung cấp mã học sinh ${codeValue} để theo dõi chuyên cần và bài tập.`
                        : 'Chưa có tài khoản phụ huynh nào liên kết với học sinh này.'
                    })
                  )
                ]
          )
        )
      : null;

    const primaryCol = el('div', {class: 'account-primary-stack'}, profileCard, linkedParentsCard, linkedStudentsCard);
    const sideCol = el('div', {class: 'account-side-stack'}, identityCard, roleSwitcherCard);
    return el('div', {class: 'account-grid-2'}, primaryCol, sideCol);
  }

  function renderSecurityTab() {
    const providerList = el(
      'div',
      {class: 'account-provider-list'},
      [
        {
          title: 'Đăng nhập bằng Google',
          desc: providerInfo.hasGoogle ? 'Tài khoản Google đã liên kết để xác thực một chạm.' : 'Chưa liên kết nhà cung cấp Google.',
          badgeText: providerInfo.hasGoogle ? 'Đã liên kết' : 'Chưa liên kết',
          badgeClass: providerInfo.hasGoogle ? 'badge badge-success' : 'badge'
        },
        {
          title: 'Đăng nhập bằng Email & Mật khẩu',
          desc: providerInfo.hasPassword ? 'Có thể dùng email và mật khẩu để đăng nhập trực tiếp.' : 'Chưa tạo mật khẩu dự phòng cho tài khoản.',
          badgeText: providerInfo.hasPassword ? 'Đã thiết lập' : 'Chưa thiết lập',
          badgeClass: providerInfo.hasPassword ? 'badge badge-success' : 'badge badge-warning'
        },
        {
          title: 'Xác thực hai lớp (2FA OTP qua Email)',
          desc: `Mã xác minh 6 chữ số luôn được gửi về ${profile.email || 'email tài khoản'} khi đăng nhập.`,
          badgeText: 'Đang bật',
          badgeClass: 'badge badge-info'
        }
      ].map(item =>
        el(
          'div',
          {class: 'account-provider-row'},
          el(
            'div',
            {class: 'account-provider-copy'},
            el('strong', {text: item.title}),
            el('p', {class: 'meta', text: item.desc})
          ),
          el('span', {class: item.badgeClass, text: item.badgeText})
        )
      )
    );

    const sessionCard = el(
      'section',
      {class: 'account-card'},
      buildCardHead('shield', 'Phương thức đăng nhập & Bảo vệ 2 lớp', 'Tổng quan cấu hình an toàn đang bảo vệ tài khoản của bạn.'),
      providerList,
      el(
        'div',
        {class: 'account-session-box'},
        el(
          'div',
          {class: 'account-session-copy'},
          el('strong', {text: 'Phiên đăng nhập hiện tại'}),
          el('p', {
            class: 'meta',
            text: session?.expiresAt
              ? `Phiên đã xác minh OTP hợp lệ đến ${fmt(session.expiresAt)}.`
              : 'Phiên đang hoạt động trên trình duyệt này.'
          })
        ),
        btn('Đăng xuất khỏi thiết bị này', () => logout(), false, 'logout')
      )
    );

    const pwErrBox = el('p', {class: 'form-error', role: 'alert', tabIndex: -1, hidden: true});
    const currentCtrl = providerInfo.requiresCurrentPassword
      ? buildPasswordInputControl({name: 'current', label: 'Mật khẩu hiện tại', autocomplete: 'current-password'})
      : null;
    const newPwCtrl = buildPasswordInputControl({
      name: 'password',
      label: 'Mật khẩu mới',
      autocomplete: 'new-password',
      helper: 'Tối thiểu 8 ký tự, tối đa 128 ký tự.'
    });
    const confirmPwCtrl = buildPasswordInputControl({
      name: 'confirm',
      label: 'Nhập lại mật khẩu mới',
      autocomplete: 'new-password'
    });

    const checkLenEl = el('li', {class: 'account-pw-check-item', text: 'Ít nhất 8 ký tự'});
    const checkMatchEl = el('li', {class: 'account-pw-check-item', text: 'Mật khẩu nhập lại trùng khớp'});
    const strengthLineEl = el('li', {class: 'account-pw-check-item is-strength', text: 'Gợi ý độ mạnh: Chưa nhập mật khẩu mới'});

    const updateChecklist = () => {
      const check = evaluatePasswordPolicy({
        password: newPwCtrl.input.value,
        confirm: confirmPwCtrl.input.value,
        current: currentCtrl?.input.value || '',
        requiresCurrent: providerInfo.requiresCurrentPassword
      });
      checkLenEl.classList.toggle('is-pass', check.hasMinLength);
      checkMatchEl.classList.toggle('is-pass', check.matchesConfirm);
      strengthLineEl.textContent = `Độ mạnh: ${check.strengthLabel}`;
      strengthLineEl.classList.toggle('is-pass', check.strength === 'strong' || check.strength === 'fair');
    };

    const pwSubmitBtn = el('button', {type: 'submit', class: 'primary wide', text: providerInfo.submitLabel});
    const resetLinkBtn = !providerInfo.hasGoogle && profile.email
      ? el(
          'button',
          {
            type: 'button',
            class: 'account-text-link-btn',
            text: 'Quên mật khẩu hiện tại? Gửi email đặt lại',
            onclick: async () => {
              resetLinkBtn.disabled = true;
              try {
                await sendPasswordResetEmail(auth, profile.email);
                status(`Đã gửi liên kết đặt lại mật khẩu về ${profile.email}. Vui lòng kiểm tra hộp thư.`, false, 'success');
              } catch (err) {
                status(friendly(err), true);
              } finally {
                resetLinkBtn.disabled = false;
              }
            }
          }
        )
      : null;

    const passwordFormEl = el(
      'form',
      {
        class: 'account-form',
        oninput: () => {
          pwErrBox.hidden = true;
          pwErrBox.textContent = '';
          updateChecklist();
        },
        onsubmit: async e => {
          e.preventDefault();
          pwErrBox.hidden = true;
          pwErrBox.textContent = '';
          const check = evaluatePasswordPolicy({
            password: newPwCtrl.input.value,
            confirm: confirmPwCtrl.input.value,
            current: currentCtrl?.input.value || '',
            requiresCurrent: providerInfo.requiresCurrentPassword
          });
          if (!check.valid) {
            pwErrBox.textContent = check.error;
            pwErrBox.hidden = false;
            pwErrBox.focus();
            return;
          }
          pwSubmitBtn.disabled = true;
          pwSubmitBtn.textContent = 'Đang xác minh…';
          try {
            if (providerInfo.reauthMethod === 'google_popup') {
              await reauthenticateWithPopup(auth, new GoogleAuthProvider());
            } else {
              await reauthenticateWithCredential(
                auth.currentUser,
                EmailAuthProvider.credential(auth.currentUser.email, currentCtrl.input.value)
              );
            }
            if (providerInfo.hasPassword) {
              await updatePassword(auth.currentUser, newPwCtrl.input.value);
            } else {
              await linkWithCredential(
                auth.currentUser,
                EmailAuthProvider.credential(auth.currentUser.email, newPwCtrl.input.value)
              );
            }
            await logout();
            status('Mật khẩu đã được cập nhật thành công. Vui lòng đăng nhập lại.', false, 'success');
          } catch (err) {
            pwErrBox.textContent = friendly(err);
            pwErrBox.hidden = false;
            pwErrBox.focus();
          } finally {
            pwSubmitBtn.disabled = false;
            pwSubmitBtn.textContent = providerInfo.submitLabel;
          }
        }
      },
      pwErrBox,
      currentCtrl?.label || null,
      newPwCtrl.label,
      confirmPwCtrl.label,
      el('ul', {class: 'account-pw-checklist', 'aria-live': 'polite'}, checkLenEl, checkMatchEl, strengthLineEl),
      el(
        'div',
        {class: 'account-security-notice'},
        icon('alert'),
        el('span', {text: 'Sau khi cập nhật mật khẩu thành công, hệ thống sẽ tự động đăng xuất khỏi phiên hiện tại để bạn đăng nhập lại an toàn.'})
      ),
      pwSubmitBtn,
      resetLinkBtn
    );

    const passwordCard = el(
      'section',
      {class: 'account-card'},
      buildCardHead('key', providerInfo.formTitle, providerInfo.helperText),
      passwordFormEl
    );

    return el('div', {class: 'account-grid-2'}, sessionCard, passwordCard);
  }

  function renderPrivacyTab() {
    const slaItems = [
      {time: '02 ngày làm việc', title: 'Xác nhận yêu cầu', desc: 'Phản hồi đã tiếp nhận và hướng dẫn thủ tục.'},
      {time: '10 ngày', title: 'Xem / sửa / cung cấp', desc: 'Cho xem, chỉnh sửa hoặc trích xuất dữ liệu cá nhân.'},
      {time: '15 ngày', title: 'Rút đồng ý / hạn chế', desc: 'Ngừng hoặc giới hạn phạm vi xử lý theo yêu cầu.'},
      {time: '20 ngày', title: 'Xóa dữ liệu cá nhân', desc: 'Xóa dữ liệu khi đáp ứng điều kiện pháp luật.'}
    ];

    const privacyCard = el(
      'section',
      {class: 'account-card'},
      buildCardHead(
        'shield',
        'Quyền về dữ liệu cá nhân & Pháp lý',
        'Áp dụng theo Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định 356/2025/NĐ-CP.'
      ),
      el('p', {
        class: 'meta',
        text: 'Bạn có quyền được biết, đồng ý hoặc rút lại sự đồng ý, xem, chỉnh sửa, yêu cầu cung cấp, hạn chế xử lý, phản đối xử lý hoặc yêu cầu xóa dữ liệu cá nhân của mình (hoặc thay mặt cho con nếu là phụ huynh / người giám hộ hợp pháp).'
      }),
      el(
        'div',
        {class: 'account-sla-grid'},
        slaItems.map(item =>
          el(
            'div',
            {class: 'account-sla-item'},
            el('strong', {text: item.time}),
            el('span', {class: 'account-sla-title', text: item.title}),
            el('span', {class: 'meta', text: item.desc})
          )
        )
      ),
      el(
        'div',
        {class: 'account-link-grid'},
        [
          {title: 'Chính sách bảo vệ dữ liệu cá nhân', desc: 'Xem toàn văn chính sách đang áp dụng.', href: '/chinh-sach-bao-mat.html'},
          {title: 'Quyền của bạn & Thời hạn phản hồi', desc: 'Chi tiết thủ tục thực hiện quyền chủ thể dữ liệu.', href: '/chinh-sach-bao-mat.html#quyen-cua-ban'},
          {title: 'Dữ liệu thu thập & Mục đích xử lý', desc: 'Bảng minh bạch các nhóm dữ liệu trên hệ thống.', href: '/chinh-sach-bao-mat.html#du-lieu-thu-thap'},
          {title: 'Bảo vệ dữ liệu cá nhân của trẻ em', desc: 'Quy định dành cho học sinh dưới 16 tuổi và phụ huynh.', href: '/chinh-sach-bao-mat.html#tre-em'}
        ].map(linkItem =>
          el(
            'a',
            {class: 'account-link-tile', href: linkItem.href, target: '_blank', rel: 'noopener'},
            el('span', {class: 'account-card-icon', 'aria-hidden': 'true'}, icon('externalLink')),
            el('span', {class: 'account-link-tile-copy'}, el('strong', {text: linkItem.title}), el('span', {class: 'meta', text: linkItem.desc})),
            el('span', {class: 'account-link-arrow', 'aria-hidden': 'true'}, icon('chevronRight'))
          )
        )
      )
    );

    const roleText = displayRolePills.map(r => labels[r] || r).join(', ');
    const supportBundle = buildSupportCopyBundle({
      name: profile.displayName,
      email: profile.email,
      studentCode: codeValue,
      uid: me.uid,
      roleLabels: displayRolePills.map(r => labels[r] || r),
      classNames: currentClasses.map(c => c.name)
    });

    const supportCard = el(
      'section',
      {class: 'account-card'},
      buildCardHead('mail', 'Hỗ trợ tài khoản & Thông tin đối chiếu', `Kênh tiếp nhận chính thức: ${SUPPORT_EMAIL}`),
      el(
        'div',
        {class: 'account-support-actions'},
        el(
          'a',
          {
            class: 'button primary',
            href: buildSupportMailtoHref({
              topic: 'profile_update',
              name: profile.displayName,
              email: profile.email,
              studentCode: codeValue,
              uid: me.uid,
              roleLabel: roleText
            })
          },
          icon('edit'),
          el('span', {text: 'Gửi yêu cầu chỉnh sửa hồ sơ / đổi lớp'})
        ),
        el(
          'a',
          {
            class: 'button',
            href: buildSupportMailtoHref({
              topic: 'data_rights',
              name: profile.displayName,
              email: profile.email,
              studentCode: codeValue,
              uid: me.uid,
              roleLabel: roleText
            })
          },
          icon('shield'),
          el('span', {text: 'Gửi yêu cầu về dữ liệu cá nhân'})
        ),
        el(
          'a',
          {class: 'button', href: '/'},
          icon('externalLink'),
          el('span', {text: 'Về trang giới thiệu'})
        )
      ),
      el(
        'div',
        {class: 'account-tech-box'},
        el(
          'div',
          {class: 'account-tech-head'},
          el('strong', {text: 'Thông tin kỹ thuật đối chiếu khi cần hỗ trợ'}),
          buildCopyActionButton(supportBundle, {
            label: 'Sao chép toàn bộ',
            copiedLabel: 'Đã sao chép',
            toastText: 'Đã sao chép đầy đủ thông tin đối chiếu tài khoản.'
          })
        ),
        el(
          'dl',
          {class: 'account-kv-list is-compact'},
          [
            profile.email ? {label: 'Email', value: profile.email} : null,
            codeValue ? {label: 'Mã học sinh', value: codeValue} : null,
            {label: 'Mã định danh (UID)', value: me.uid, mono: true}
          ]
            .filter(Boolean)
            .map(row =>
              el(
                'div',
                {class: 'account-kv-row'},
                el('dt', {text: row.label}),
                el(
                  'dd',
                  {},
                  el('span', {class: row.mono ? 'account-uid-meta' : '', text: row.value}),
                  buildCopyActionButton(row.value, {
                    label: 'Sao chép',
                    copiedLabel: 'Đã sao chép',
                    toastText: `Đã sao chép ${row.label}: ${row.value}.`
                  })
                )
              )
            )
        )
      )
    );

    return el('div', {class: 'account-stack'}, privacyCard, supportCard);
  }

  function renderActiveTab(tabId) {
    if (tabId === 'security') {
      tabPanelHost.replaceChildren(renderSecurityTab());
    } else if (tabId === 'privacy') {
      tabPanelHost.replaceChildren(renderPrivacyTab());
    } else {
      tabPanelHost.replaceChildren(renderProfileTab());
    }
  }

  renderActiveTab(activeSettingsTab);
  root.append(heroSection, tabBar, tabPanelHost);
  content(root);
}

window.addEventListener('unhandledrejection', e => {
  status(friendly(e.reason), true);
});

async function checkAvailability() {
  try {
    // Exercise the same browser preflight as authenticated API requests, using no real credentials.
    const response = await requestApi('/api/health', {headers: {authorization: 'ConnectionCheck', 'x-firebase-token': 'connection-check'}, timeoutMs: 5000, retry: false});
    const health = response.data;
    if (!response.ok || !health.ready) throw Error('Hệ thống đang hoàn tất kết nối đăng nhập. Vui lòng quay lại sau ít phút.');
    if ($('status').querySelector('.toast-text')?.textContent === 'Đang kết nối…') status('');
  } catch (e) {
    // This advisory check must not lock login or replace an active auth message.
    const message = $('status').querySelector('.toast-text')?.textContent;
    if (authBusy || session || !$('login') || $('login').hidden || (message && message !== 'Đang kết nối…')) return;
    status(e.message, true);
    $('status').append(' ', el('button', {type: 'button', text: 'Kết nối lại', onClick: () => {status('Đang kết nối…');checkAvailability();}}));
  }
}

async function initializeAuthentication() {
  authBusy = true;
  updateAuthControls();
  try {
    await setPersistence(auth, browserLocalPersistence);
    await auth.authStateReady();
    let redirect = null;
    if (authState.redirectPending()) {
      status('Đang hoàn tất đăng nhập Google…');
      try {redirect = await getRedirectResult(auth);} finally {authState.setRedirectPending(false);}
    }
    const saved = authState.read(auth.currentUser?.uid);
    session = saved?.session || null;
    sessionUid = session ? saved.uid : null;
    challenge = saved?.challenge || null;
    if (session) {
      status('Đang mở lớp học…');
      await loadApp();
      status('');
    } else {
      syncLoginUrl();
      if (challenge) {
        showOtpChallenge();
        status('Nhập mã xác minh đã gửi để tiếp tục.');
      } else if (redirect?.user) {
        await beginOtp();
      } else if (redirect === null && $('status').querySelector('.toast-text')?.textContent === 'Đang hoàn tất đăng nhập Google…') {
        status('Chưa hoàn tất đăng nhập Google. Vui lòng thử lại.', true);
      }
    }
  } catch (error) {
    if (session && auth.currentUser) showAppLoadError(error);
    status(friendly(error), true);
  } finally {
    authBusy = false;
    updateAuthControls();
  }
}
initializeAuthentication();
onAuthStateChanged(auth, user => {
  // Firebase synchronizes local sign-in across tabs; never keep showing the old account.
  if (session && sessionUid && user?.uid !== sessionUid) window.location.reload();
});
window.addEventListener('popstate', () => {
  if (!session || !me || $('workspace')?.hidden) return;
  if ($('editor')?.open) $('editor').close();
  run(async () => {
    suppressHistoryPush = true;
    try {
      await restoreRouteFromLocation(null, {replaceUrl: true});
    } finally {
      suppressHistoryPush = false;
    }
  });
});
checkAvailability();

function promotionEditor(users, years, memberships) {
  if (years.length < 2) throw Error('Cần tạo ít nhất 2 năm học (năm nguồn và năm đích) để thực hiện chuyển lớp.');
  const yearOptions = years.map(y => ({value: y.id, label: y.name}));
  const source = field('source', 'Năm học hiện tại (Nguồn)', 'select', years[0].id, {items: yearOptions});
  const target = field('target', 'Năm học tiếp theo (Đích)', 'select', years[1].id, {items: yearOptions});
  const routesBox = el('div');
  const overridesBox = el('div');
  const previewBox = el('div');
  const error = el('p', {class: 'form-error', role: 'alert'});
  const f = el('form', {}, source.label, target.label, routesBox, overridesBox, error);
  let routes = {}, overrides = {};

  const refresh = () => {
    routes = {};
    overrides = {};
    routesBox.replaceChildren();
    overridesBox.replaceChildren();
    previewBox.replaceChildren();
    const destinations = classes.filter(c => (c.schoolYearId || c.school_year_id) === target.input.value);
    for (const c of classes.filter(c => (c.schoolYearId || c.school_year_id) === source.input.value)) {
      const select = field('route', `Lớp mới cho học sinh ${c.name}`, 'select', '', {items: [{value: '', label: 'Chọn lớp đích'}, ...destinations.map(d => ({value: d.id, label: d.name}))]});
      routes[c.id] = select.input;
      routesBox.append(select.label);
    }
    const students = [...new Set(memberships.filter(m => m.member_role === 'student' && m.status === 'active' && classes.some(c => c.id === m.class_id && (c.schoolYearId || c.school_year_id) === source.input.value)).map(m => m.uid))];
    if (!students.length) return;
    const exceptions = el('div', {id: 'promotion-overrides-list', class: 'data-list-fields', hidden: true});
    for (const uid of students) {
      const select = field('override', users.find(u => u.uid === uid)?.display_name || uid, 'select', '', {required: false, items: [{value: '', label: 'Theo lớp chung hiện tại'}, ...destinations.map(d => ({value: d.id, label: d.name}))]});
      overrides[uid] = select.input;
      exceptions.append(select.label);
    }
    const toggleExceptions = el('button', {
      type: 'button',
      class: 'secondary',
      'aria-expanded': 'false',
      'aria-controls': exceptions.id,
      text: 'Mở danh sách',
      onclick: () => {
        exceptions.hidden = !exceptions.hidden;
        toggleExceptions.setAttribute('aria-expanded', String(!exceptions.hidden));
        toggleExceptions.textContent = exceptions.hidden ? 'Mở danh sách' : 'Ẩn danh sách';
      }
    });
    overridesBox.append(el('section', {class: 'data-list-panel', 'aria-labelledby': 'promotion-overrides-title'},
      el('div', {class: 'data-list-heading'},
        el('div', {},
          el('h3', {id: 'promotion-overrides-title', text: 'Điều chỉnh riêng từng học sinh'}),
          el('span', {class: 'meta', text: `${students.length} học sinh`})
        ),
        toggleExceptions
      ),
      exceptions
    ));
  };

  source.input.onchange = refresh;
  target.input.onchange = refresh;
  refresh();

  const submit = el('button', {class: 'primary wide', type: 'submit', text: 'Xem trước phương án'});
  f.append(submit, previewBox);

  f.onsubmit = async e => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      const plan = await api('/api/admin/promotions/preview', {
        method: 'POST',
        body: {
          sourceYear: source.input.value,
          targetYear: target.input.value,
          routes: Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, v.value])),
          overrides: Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, v.value]))
        }
      });
      previewBox.replaceChildren();
      if (!plan.canApply) {
        previewBox.append(
          el('div', {class: 'form-error'},
            el('strong', {text: 'Phương án chưa thể thực hiện. Vui lòng kiểm tra lại:'}),
            ...(plan.issues || []).map(i => el('p', {text: `${users.find(u => u.uid === i.studentId)?.display_name || i.studentId}: ${{duplicate_source: 'Đang ở nhiều lớp trong năm nguồn', already_enrolled: 'Đã có lớp ở năm đích', destination_missing: 'Chưa chọn lớp đích', invalid_destination: 'Lớp đích không hợp lệ'}[i.reason] || i.reason}`}))
          )
        );
        return;
      }
      previewBox.append(
        el('div', {class: 'notice promotion-notice-box'},
          el('h3', {text: `Sẽ chuyển ${plan.creates.length} học sinh sang năm học mới`}),
          el('div', {class: 'promotion-preview-list'},
            ...plan.creates.map(c => el('p', {class: 'meta', text: `${users.find(u => u.uid === c.studentId)?.display_name || c.studentId} ➔ ${classes.find(k => k.id === c.classId)?.name || c.classId}`}))
          ),
          el('p', {class: 'meta', text: 'Lớp, tài liệu và bài nộp của các năm trước được bảo lưu nguyên vẹn. Phương án có hiệu lực trong 15 phút.'})
        )
      );
      const confirm = el('input', {type: 'checkbox'});
      const apply = el('button', {type: 'button', class: 'primary wide', text: 'Xác nhận chuyển lớp', disabled: true});
      confirm.onchange = () => apply.disabled = !confirm.checked;
      apply.onclick = () => run(async () => {
        apply.disabled = true;
        await api('/api/admin/promotions/apply', {method: 'POST', body: {planId: plan.planId, confirm: true}});
        $('editor').close();
        await adminPage();
        status('Đã thực hiện phương án chuyển lớp thành công.');
      });
      previewBox.append(
        el('label', {class: 'check promotion-confirm-check'}, confirm, 'Tôi đã kiểm tra kỹ và xác nhận phương án chuyển lớp này'),
        apply
      );
    } catch (e) {
      error.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  };
  modal('Chuyển lớp theo năm học', f);
}

function assistantEditor(m, {allMemberships = null, assistantMemberships = null, classesList = null} = {}) {
  const openClasses = sortClasses((classesList || classes || []).filter(c => !c.archived));
  const candidateMemberships = Array.isArray(assistantMemberships) && assistantMemberships.length
    ? assistantMemberships
    : Array.isArray(allMemberships) && allMemberships.length
      ? allMemberships.filter(x => x.uid === m.uid && x.member_role === 'assistant' && x.status === 'active')
      : (m ? [m] : []);

  const grantByClassId = new Map();
  for (const item of candidateMemberships) {
    if (item?.class_id) grantByClassId.set(item.class_id, item);
  }
  if (m?.class_id && !grantByClassId.has(m.class_id)) {
    grantByClassId.set(m.class_id, m);
  }

  const inputs = [];
  const f = el('form');
  let scopeField = null;

  if (openClasses.length > 1 || grantByClassId.size > 1) {
    const classItems = [];
    const seenClassIds = new Set();
    for (const c of openClasses) {
      seenClassIds.add(c.id);
      const count = Array.isArray(grantByClassId.get(c.id)?.permissions)
        ? grantByClassId.get(c.id).permissions.length
        : (m?.class_id === c.id ? (m.permissions || []).length : ASSISTANT_PERMISSION_CHOICES.length);
      classItems.push({value: c.id, label: `Lớp ${c.name} (${count}/${ASSISTANT_PERMISSION_CHOICES.length} quyền)`});
    }
    for (const [cid, item] of grantByClassId.entries()) {
      if (seenClassIds.has(cid)) continue;
      const count = Array.isArray(item?.permissions) ? item.permissions.length : 0;
      classItems.push({value: cid, label: `${item.className || cid} (${count}/${ASSISTANT_PERMISSION_CHOICES.length} quyền)`});
    }

    scopeField = field('scope', 'Phạm vi áp dụng', 'select', m?.class_id || '__all__', {
      items: [
        ...(openClasses.length ? [{value: '__all__', label: `Áp dụng đồng loạt tất cả lớp đang mở (${openClasses.length} lớp)`}] : []),
        ...classItems
      ]
    });
    f.append(scopeField.label);
  }

  const syncChecks = perms => {
    const activeSet = new Set(Array.isArray(perms) ? perms : []);
    for (const input of inputs) input.checked = activeSet.has(input.value);
  };

  f.append(
    el(
      'div',
      {class: 'admin-assistant-quick-actions'},
      el('button', {
        type: 'button',
        class: 'secondary',
        text: `Chọn đủ ${ASSISTANT_PERMISSION_CHOICES.length} quyền`,
        onclick: () => syncChecks(ASSISTANT_PERMISSION_CHOICES.map(item => item.key))
      }),
      el('button', {
        type: 'button',
        class: 'secondary',
        text: 'Chỉ xem (0 quyền)',
        onclick: () => syncChecks([])
      })
    )
  );

  for (const {key, label} of ASSISTANT_PERMISSION_CHOICES) {
    const input = el('input', {type: 'checkbox', value: key, checked: (m?.permissions || []).includes(key)});
    inputs.push(input);
    f.append(el('label', {class: 'check'}, input, label));
  }

  if (scopeField) {
    scopeField.input.addEventListener('change', () => {
      const selected = scopeField.input.value;
      if (selected === '__all__') {
        const refPerms = grantByClassId.get(m?.class_id)?.permissions || m?.permissions || [];
        syncChecks(refPerms);
      } else {
        const matched = grantByClassId.get(selected);
        syncChecks(matched?.permissions || m?.permissions || []);
      }
    });
  }

  const save = el('button', {class: 'primary wide', type: 'submit', text: 'Lưu quyền trợ giảng'});
  const error = el('p', {class: 'form-error', role: 'alert'});
  f.append(error, save);
  f.onsubmit = async e => {
    e.preventDefault();
    save.disabled = true;
    error.textContent = '';
    try {
      const chosenPermissions = inputs.filter(i => i.checked).map(i => i.value);
      const chosenScope = scopeField ? scopeField.input.value : m.class_id;
      if (chosenScope === '__all__') {
        const targetClassIds = openClasses.length ? openClasses.map(c => c.id) : [...grantByClassId.keys()];
        await api('/api/admin/memberships', {
          method: 'POST',
          idempotent: true,
          body: {
            classIds: targetClassIds,
            classId: targetClassIds[0],
            uid: m.uid,
            role: 'assistant',
            status: grantByClassId.get(targetClassIds[0])?.status || m.status || 'active',
            permissions: chosenPermissions
          }
        });
      } else {
        await api('/api/admin/memberships', {
          method: 'POST',
          idempotent: true,
          body: {
            classId: chosenScope,
            uid: m.uid,
            role: 'assistant',
            status: grantByClassId.get(chosenScope)?.status || m.status || 'active',
            permissions: chosenPermissions
          }
        });
      }
      if (m.uid === me.uid) me = await api('/api/me');
      try { await adminPage(); } finally { $('editor').close(); }
      status('Đã lưu quyền trợ giảng.', false, 'success');
    } catch (e) {
      error.textContent = friendly(e);
    } finally {
      save.disabled = false;
    }
  };
  modal('Cấp quyền trợ giảng trong lớp', f);
}

function renderNoticeAttachments(notice) {
  const attachments = Array.isArray(notice.attachments) ? notice.attachments : [];
  if (!attachments.length) return null;
  const list = el('div', {class: 'notice-attachments', 'aria-label': 'Tệp đính kèm'});
  for (const file of attachments) {
    const isVideo = String(file.content_type || '').startsWith('video/');
    const message = el('p', {class: 'meta notice-attachment-status', role: 'status'});
    const preview = el('div', {class: 'notice-attachment-preview'});
    const open = btn(isVideo ? 'Xem video' : 'Xem ảnh', async () => {
      open.disabled = true;
      message.textContent = 'Đang mở tệp…';
      try {
        const result = await api(`/api/notices/${encodeURIComponent(notice.id)}/files/${encodeURIComponent(file.id)}/ticket`);
        const url = new URL(result.url);
        if (url.origin !== new URL(apiBase).origin || url.pathname !== '/api/notice-media') throw Error('Liên kết tệp không hợp lệ.');
        const media = isVideo
          ? el('video', {src: url.href, controls: true, preload: 'metadata', playsInline: true})
          : el('img', {src: url.href, alt: file.name, loading: 'lazy', referrerPolicy: 'no-referrer'});
        media.addEventListener('error', () => {
          preview.replaceChildren();
          message.textContent = 'Không mở được tệp. Hãy thử lại.';
          open.disabled = false;
        });
        const external = el('a', {href: url.href, target: '_blank', rel: 'noopener noreferrer', class: 'notice-attachment-external-link', text: 'Mở tệp trong thẻ mới'});
        preview.replaceChildren(media, external);
        message.textContent = '';
        open.hidden = true;
        media.addEventListener('error', () => {open.hidden = false;});
      } catch (error) {
        message.textContent = friendly(error);
        open.disabled = false;
      }
    });
    const typeLabel = isVideo ? 'Video' : 'Hình ảnh';
    const metaText = file.file_size ? `${typeLabel} · ${formatFileSize(Number(file.file_size))}` : typeLabel;
    list.append(el('div', {class: 'notice-attachment'},
      el('div', {class: 'notice-attachment-row'},
        el('div', {class: 'notice-attachment-name'},
          el('strong', {text: file.name}),
          el('span', {class: 'meta', text: metaText})
        ),
        open
      ),
      message,
      preview
    ));
  }
  return list;
}

async function uploadNoticeAttachment(noticeId, entry, onProgress, isActive = () => true) {
  const base = `/api/notices/${encodeURIComponent(noticeId)}/files`;
  if (!entry.upload || entry.upload.noticeId !== noticeId) {
    const fingerprint = await computeVideoFingerprint(entry.file);
    const result = await api(base, {method: 'POST', body: {
      requestId: entry.requestId, name: entry.file.name, contentType: entry.contentType,
      size: entry.file.size, sha256: fingerprint
    }, timeoutMs: 45000});
    if (result.state === 'uploaded') return;
    entry.upload = {noticeId, fileId: result.id, token: result.uploadToken, offset: 0, chunkSize: result.chunkSize};
  }
  const upload = entry.upload;
  const chunkPath = `${base}/${encodeURIComponent(upload.fileId)}/chunks`;
  const tokenQuery = `uploadToken=${encodeURIComponent(upload.token)}`;
  let recoveryAttempts = 0;
  while (upload.offset < entry.file.size) {
    if (!isActive()) throw Error('Đã dừng tải tệp vì biểu mẫu đã đóng.');
    const previousOffset = upload.offset;
    const end = Math.min(previousOffset + upload.chunkSize, entry.file.size);
    const chunk = entry.file.slice(previousOffset, end, 'application/octet-stream');
    onProgress(Math.round(previousOffset / entry.file.size * 100));
    try {
      const result = await api(`${chunkPath}?offset=${previousOffset}&${tokenQuery}`, {method: 'POST', body: chunk, raw: true, timeoutMs: 120000, retry: false});
      upload.offset = result.state === 'uploaded' ? entry.file.size : Number(result.offset);
      if (!Number.isSafeInteger(upload.offset) || upload.offset <= previousOffset || upload.offset > entry.file.size) throw Error('Máy chủ chưa xác nhận tiến độ tải tệp.');
      recoveryAttempts = 0;
    } catch (error) {
      if (++recoveryAttempts > 3) throw error;
      try {
        const result = await api(`${chunkPath}?status=1&${tokenQuery}`, {method: 'POST', timeoutMs: 45000, retry: false});
        const offset = result.state === 'uploaded' ? entry.file.size : Number(result.offset);
        if (!Number.isSafeInteger(offset) || offset < previousOffset || offset > entry.file.size) throw error;
        upload.offset = offset;
      } catch {
        entry.upload = null;
        throw error;
      }
    }
  }
  onProgress(100);
}

function openNoticeComposerModal(existingNotice = null, { presetCategory = null, presetPinned = false, presetTitle = '', presetBody = '' } = {}) {
  const isEditing = Boolean(existingNotice?.id);
  const decoded = isEditing ? decodeNoticeMeta(existingNotice.body, existingNotice.title) : null;
  const initialCategory = decoded ? decoded.category : (presetCategory || 'general');
  const initialPinned = decoded ? decoded.pinned : Boolean(presetPinned);
  const initialTitle = isEditing ? (existingNotice.title || '') : (presetTitle || '');
  const initialBody = decoded ? decoded.cleanBody : (presetBody || '');

  const scopeField = !isEditing ? field('scope', 'Phạm vi thông báo', 'select', 'class', {
    items: [
      {value: 'class', label: `Chỉ ${selectedClass?.name || 'lớp này'}`},
      {value: 'all', label: 'Tất cả lớp học'}
    ]
  }) : null;

  const categoryField = field('category', 'Phân loại thông báo', 'select', initialCategory, {
    items: NOTICE_CATEGORIES.map(c => ({ value: c.key, label: c.label }))
  });
  categoryField.input.value = initialCategory;
  const titleField = field('title', 'Tiêu đề thông báo', 'text', initialTitle, {
    maxLength: 250,
    placeholder: 'VD: Thông báo lịch học tuần này'
  });
  const bodyField = field('body', 'Nội dung chi tiết', 'textarea', initialBody, {
    max: 19500,
    placeholder: 'Nhập nội dung thông báo rõ ràng cho học sinh và phụ huynh…'
  });
  const pinCheckbox = el('input', { type: 'checkbox', name: 'pinned', checked: initialPinned });
  const pinText = el('span', {text: existingNotice?.scope === 'all' ? 'Ghim thông báo lên đầu bảng tin các lớp' : 'Ghim thông báo này lên đầu bảng tin lớp'});
  const pinLabel = el(
    'label',
    { class: 'check notice-pin-check' },
    pinCheckbox,
    pinText
  );
  if (scopeField) scopeField.input.addEventListener('change', () => {
    pinText.textContent = scopeField.input.value === 'all' ? 'Ghim thông báo lên đầu bảng tin các lớp' : 'Ghim thông báo này lên đầu bảng tin lớp';
  });

  const errorEl = el('p', { class: 'form-error', role: 'alert', tabIndex: -1, hidden: true });
  const submitBtn = el('button', {
    type: 'submit',
    class: 'primary wide',
    text: isEditing ? 'Lưu thay đổi' : 'Đăng thông báo'
  });

  const composerForm = el('form', { class: 'notice-composer-form' }, errorEl);
  const progress = el('p', {class: 'meta notice-upload-progress', role: 'status', 'aria-live': 'polite'});
  const picker = !isEditing ? field('noticeFiles', 'Ảnh hoặc video đính kèm', 'file', '', {
    required: false, multiple: true,
    accept: noticeMediaAccept
  }) : null;
  let entries = [];
  let draft = null;
  const selectedFilesList = picker ? el('div', {class: 'notice-selected-files', hidden: true}) : null;
  const renderSelectedFiles = () => {
    if (!selectedFilesList) return;
    if (!entries.length) {
      selectedFilesList.replaceChildren();
      selectedFilesList.hidden = true;
      return;
    }
    selectedFilesList.hidden = false;
    selectedFilesList.replaceChildren(
      ...entries.map((entry, idx) => {
        const typeLabel = entry.contentType.startsWith('video/') ? 'Video' : 'Ảnh';
        return el('div', {class: 'notice-selected-file-item'},
          el('div', {class: 'notice-selected-file-info'},
            el('strong', {text: entry.file.name}),
            el('span', {class: 'meta', text: `${typeLabel} · ${formatFileSize(entry.file.size)}`})
          ),
          el('button', {
            type: 'button',
            class: 'notice-selected-file-remove',
            onclick: () => {
              entries.splice(idx, 1);
              if (!entries.length && picker) picker.input.value = '';
              renderSelectedFiles();
            }
          }, 'Xóa')
        );
      })
    );
  };
  if (picker) picker.input.addEventListener('change', () => {
    entries = [...picker.input.files].map(file => ({
      file, requestId: crypto.randomUUID(), contentType: noticeMediaType(file)
    }));
    renderSelectedFiles();
  });

  const mailHintEl = !isEditing
    ? el('p', {
        class: 'meta notice-mail-hint',
        text: 'Khi đăng mới, email được đưa vào hàng đợi gửi tới học sinh đang theo học trong phạm vi đã chọn.'
      })
    : null;
  if (scopeField) {
    composerForm.append(el('div', {class: 'notice-composer-row-2col'}, scopeField.label, categoryField.label));
  } else {
    composerForm.append(categoryField.label);
  }
  composerForm.append(titleField.label, bodyField.label);
  if (picker) composerForm.append(picker.label, selectedFilesList, el('p', {class: 'meta', text: 'Tối đa 8 tệp. Ảnh tối đa 100 MB, video tối đa 5 GB.'}));
  composerForm.append(pinLabel);
  if (mailHintEl) composerForm.append(mailHintEl);
  composerForm.append(progress, submitBtn);

  const clearError = () => {
    errorEl.textContent = '';
    errorEl.hidden = true;
  };
  composerForm.addEventListener('input', clearError);
  composerForm.addEventListener('change', clearError);

  composerForm.onsubmit = async ev => {
    ev.preventDefault();
    if (!validateFormFields(composerForm, errorEl)) return;
    const cleanTitle = titleField.input.value.trim();
    const cleanBody = bodyField.input.value.trim();
    if (!cleanTitle) {
      errorEl.textContent = 'Vui lòng nhập tiêu đề thông báo.';
      errorEl.hidden = false;
      titleField.input.focus();
      return;
    }
    if (!cleanBody) {
      errorEl.textContent = 'Vui lòng nhập nội dung chi tiết thông báo.';
      errorEl.hidden = false;
      bodyField.input.focus();
      return;
    }
    if (entries.length > 8 || entries.some(entry => !noticeMediaTypes.includes(entry.contentType) || !entry.file.size ||
      entry.file.size > (entry.contentType.startsWith('video/') ? noticeMaxVideoBytes : noticeMaxImageBytes))) {
      errorEl.textContent = 'Chọn tối đa 8 tệp ảnh hoặc video được hỗ trợ trong giới hạn kích thước.';
      errorEl.hidden = false;
      picker?.input.focus();
      return;
    }

    submitBtn.disabled = true;
    const controls = [...composerForm.querySelectorAll('input, textarea, select, button')].filter(control => control !== submitBtn);
    const disabledStates = controls.map(control => control.disabled);
    controls.forEach(control => {control.disabled = true;});
    errorEl.textContent = '';
    errorEl.hidden = true;
    try {
      const encodedBody = encodeNoticeMeta({
        category: categoryField.input.value,
        pinned: pinCheckbox.checked,
        body: cleanBody
      });
      let saved;
      if (isEditing) {
        saved = await api(`/api/notices/${encodeURIComponent(existingNotice.id)}/edit`, {method: 'POST', body: {title: cleanTitle, body: encodedBody}});
      } else {
        const scope = scopeField.input.value;
        const signature = JSON.stringify({scope, title: cleanTitle, body: encodedBody, files: entries.map(entry => entry.requestId)});
        if (!draft || draft.signature !== signature) draft = {id: crypto.randomUUID(), signature};
        progress.textContent = 'Đang chuẩn bị thông báo…';
        const prepared = await api('/api/notices/drafts', {method: 'POST', body: {
          id: draft.id, scope, classId: scope === 'class' ? selectedClass.id : null,
          title: cleanTitle, body: encodedBody, expectedFiles: entries.length
        }});
        if (prepared.status !== 'published') {
          for (let index = 0; index < entries.length; index++) {
            if (!composerForm.isConnected || !$('editor').open) return;
            await uploadNoticeAttachment(draft.id, entries[index], percent => {
              progress.textContent = `Đang tải tệp ${index + 1}/${entries.length}: ${percent}%`;
            }, () => composerForm.isConnected && $('editor').open);
          }
        }
        if (!composerForm.isConnected || !$('editor').open) return;
        progress.textContent = 'Đang đăng thông báo…';
        saved = await api(`/api/notices/${encodeURIComponent(draft.id)}/publish`, {method: 'POST'});
      }
      $('editor').close();
      try {
        await refreshClass('notices');
      } catch {
        status(isEditing ? 'Đã lưu thay đổi. Vui lòng tải lại bảng tin để xem.' : 'Đã đăng thông báo. Vui lòng tải lại bảng tin để xem.', true);
        return;
      }
      const sentCount = Number(saved?.notifiedCount) || 0;
      if (isEditing) {
        status('Đã cập nhật thông báo lớp.', false, 'success');
      } else if (saved?.notificationStatus === 'queued') {
        status(`Đã đăng thông báo. Email đang chờ gửi tới ${sentCount} học sinh.`, false, 'success');
      } else if (saved?.notificationStatus === 'no_recipients') {
        status('Đã đăng thông báo. Chưa có học sinh đủ điều kiện nhận email trong phạm vi đã chọn.', false, 'success');
      } else {
        const detail = saved?.notificationStatus === 'partial'
          ? `Email chỉ gửi được tới ${sentCount} học sinh.`
          : 'Không gửi được email thông báo.';
        status(`Đã đăng thông báo. ${detail} Vui lòng liên hệ quản trị viên.`, true);
      }
    } catch (err) {
      errorEl.textContent = friendly(err);
      errorEl.hidden = false;
      errorEl.focus();
    } finally {
      submitBtn.disabled = false;
      controls.forEach((control, index) => {control.disabled = disabledStates[index];});
      progress.textContent = '';
    }
  };

  if (!$('editor').open && document.activeElement instanceof HTMLElement) {
    dialogReturnFocus = document.activeElement;
  }
  modal(isEditing ? 'Chỉnh sửa thông báo lớp' : 'Đăng thông báo lớp', composerForm);
}

function openNoticeReadsModal(noticeItem, onSummaryUpdated) {
  if (!selectedClass?.id || !noticeItem?.id) return;
  const classId = selectedClass.id;
  const wrap = el('div', {class: 'notice-reads-modal'});

  const renderLoading = () => {
    wrap.replaceChildren(
      noticeItem.title ? el('p', {class: 'notice-reads-subtitle', text: noticeItem.title}) : null,
      el('div', {class: 'notice-reads-loading'},
        el('span', {class: 'toast-spinner', 'aria-hidden': 'true'}),
        el('span', {text: 'Đang tải danh sách đã xem…'})
      )
    );
  };

  const renderError = err => {
    const retryBtn = btn('Thử lại', () => loadReads(), true, 'refresh');
    wrap.replaceChildren(
      noticeItem.title ? el('p', {class: 'notice-reads-subtitle', text: noticeItem.title}) : null,
      el('div', {class: 'notice-reads-error'},
        el('p', {class: 'notice-reads-error-msg', text: friendly(err)}),
        retryBtn
      )
    );
  };

  const renderContent = data => {
    const summary = data?.summary || {};
    const seen = Array.isArray(data?.seen) ? data.seen : [];
    const unseenStudents = Array.isArray(data?.unseenStudents) ? data.unseenStudents : [];
    const studentSeen = Number(summary.student_seen) || 0;
    const totalStudents = Number(summary.total_students) || 0;
    const parentSeen = Number(summary.parent_seen) || 0;
    const otherSeen = Number(summary.other_seen) || 0;
    const totalSeen = Number(summary.total_seen) || seen.length;

    const seenDetailParts = [];
    if (totalStudents > 0) seenDetailParts.push(`${studentSeen}/${totalStudents} học sinh`);
    if (parentSeen > 0) seenDetailParts.push(`${parentSeen} phụ huynh`);
    if (otherSeen > 0) seenDetailParts.push(`${otherSeen} ban điều hành`);

    const kpis = el('div', {class: 'notice-reads-kpis'},
      el('div', {class: 'notice-reads-kpi is-seen'},
        el('span', {class: 'notice-reads-kpi-label', text: 'Đã xác nhận xem'}),
        el('strong', {class: 'notice-reads-kpi-value', text: String(totalSeen)}),
        el('span', {class: 'notice-reads-kpi-meta', text: seenDetailParts.join(' · ') || 'Lượt đã xác nhận'})
      ),
      el('div', {class: 'notice-reads-kpi is-unseen'},
        el('span', {class: 'notice-reads-kpi-label', text: 'Học sinh chưa xem'}),
        el('strong', {class: 'notice-reads-kpi-value', text: String(unseenStudents.length)}),
        el('span', {class: 'notice-reads-kpi-meta', text: totalStudents > 0 ? `Trong tổng số ${totalStudents} học sinh lớp` : 'Theo phạm vi thông báo'})
      )
    );

    let activeTab = 'seen';
    let query = '';
    const seenTabBtn = el('button', {
      type: 'button',
      class: 'notice-reads-tab is-active',
      role: 'tab',
      'aria-selected': 'true',
      text: `Đã xem (${seen.length})`
    });
    const unseenTabBtn = el('button', {
      type: 'button',
      class: 'notice-reads-tab',
      role: 'tab',
      'aria-selected': 'false',
      text: `Chưa xem (${unseenStudents.length})`
    });
    const tabsRow = el('div', {class: 'notice-reads-tabs', role: 'tablist', 'aria-label': 'Trạng thái đã xem thông báo'}, seenTabBtn, unseenTabBtn);

    const totalPeople = seen.length + unseenStudents.length;
    const searchInput = totalPeople > 6
      ? el('input', {
          type: 'search',
          class: 'notice-reads-search-input',
          placeholder: 'Tìm theo tên học sinh, mã HS hoặc phụ huynh…',
          'aria-label': 'Tìm người trong danh sách đã xem'
        })
      : null;
    const searchRow = searchInput
      ? el('div', {class: 'notice-reads-search'}, searchInput)
      : null;

    const listHost = el('div', {class: 'notice-reads-list', role: 'tabpanel'});

    const renderList = () => {
      listHost.replaceChildren();
      const normQuery = normalizeSearchText(query);
      const sourceList = activeTab === 'seen' ? seen : unseenStudents;
      const filtered = normQuery
        ? sourceList.filter(row => {
            const hay = normalizeSearchText([
              row.name || '',
              row.studentCode || '',
              row.roleLabel || '',
              ...(Array.isArray(row.childNames) ? row.childNames : [])
            ].join(' '));
            return hay.includes(normQuery);
          })
        : sourceList;

      if (!filtered.length) {
        let emptyText = 'Chưa có dữ liệu phù hợp.';
        if (normQuery) {
          emptyText = 'Không tìm thấy thành viên nào khớp từ khóa.';
        } else if (activeTab === 'seen') {
          emptyText = 'Chưa có học sinh hoặc phụ huynh nào bấm Đã xem thông báo này.';
        } else if (totalStudents > 0) {
          emptyText = 'Tất cả học sinh trong lớp đã xác nhận xem thông báo này.';
        } else {
          emptyText = 'Thông báo chung không giới hạn danh sách học sinh chưa xem theo lớp.';
        }
        listHost.append(el('p', {class: 'notice-reads-empty', text: emptyText}));
        return;
      }

      for (const row of filtered) {
        const displayName = row.name || row.uid || 'Thành viên';
        const initial = String(displayName).trim().slice(0, 1).toLocaleUpperCase('vi-VN') || 'T';
        const roleKey = String(row.role || 'student');
        const subMetaParts = [];
        if (row.studentCode) subMetaParts.push(`Mã HS: ${row.studentCode}`);
        if (Array.isArray(row.childNames) && row.childNames.length) {
          subMetaParts.push(`Phụ huynh của ${row.childNames.join(', ')}`);
        }

        const badgeClass = roleKey === 'parent'
          ? 'badge badge-mint notice-reads-role-badge'
          : roleKey === 'student'
            ? 'badge badge-primary notice-reads-role-badge'
            : 'badge badge-info notice-reads-role-badge';

        const statusNode = activeTab === 'seen'
          ? el('span', {class: 'notice-reads-time', text: fmt(row.seenAt) || 'Đã xác nhận'})
          : el('span', {class: 'badge badge-warning notice-reads-unseen-badge', text: 'Chưa xác nhận'});

        listHost.append(
          el('div', {class: `notice-reads-row${activeTab === 'unseen' ? ' is-unseen' : ''}`},
            el('div', {class: 'notice-reads-person'},
              el('span', {class: `notice-reads-avatar${activeTab === 'unseen' ? ' is-unseen' : ''}`, 'aria-hidden': 'true', text: initial}),
              el('div', {class: 'notice-reads-meta'},
                el('div', {class: 'notice-reads-name-line'},
                  el('strong', {text: displayName}),
                  el('span', {class: badgeClass, text: row.roleLabel || 'Thành viên'})
                ),
                subMetaParts.length
                  ? el('span', {class: 'notice-reads-sub', text: subMetaParts.join(' · ')})
                  : null
              )
            ),
            statusNode
          )
        );
      }
    };

    const setTab = nextTab => {
      activeTab = nextTab;
      const isSeenTab = activeTab === 'seen';
      seenTabBtn.classList.toggle('is-active', isSeenTab);
      seenTabBtn.setAttribute('aria-selected', String(isSeenTab));
      unseenTabBtn.classList.toggle('is-active', !isSeenTab);
      unseenTabBtn.setAttribute('aria-selected', String(!isSeenTab));
      renderList();
    };

    seenTabBtn.onclick = () => setTab('seen');
    unseenTabBtn.onclick = () => setTab('unseen');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        query = searchInput.value;
        renderList();
      });
    }

    renderList();
    wrap.replaceChildren(
      noticeItem.title ? el('p', {class: 'notice-reads-subtitle', text: noticeItem.title}) : null,
      kpis,
      tabsRow,
      searchRow,
      listHost
    );
  };

  const loadReads = async () => {
    renderLoading();
    try {
      const data = await api(`/api/notices/${encodeURIComponent(noticeItem.id)}/reads?classId=${encodeURIComponent(classId)}`);
      if (!wrap.isConnected || !$('editor')?.open) return;
      if (data?.summary) {
        const syncSummary = list => {
          const target = Array.isArray(list) ? list.find(n => n?.id === noticeItem.id) : null;
          if (target) target.read_summary = data.summary;
        };
        syncSummary(workspace?.notices);
        syncSummary(workspaceSource?.notices);
        onSummaryUpdated?.(data.summary);
      }
      renderContent(data);
    } catch (err) {
      if (!wrap.isConnected || !$('editor')?.open) return;
      renderError(err);
    }
  };

  if (!$('editor').open && document.activeElement instanceof HTMLElement) {
    dialogReturnFocus = document.activeElement;
  }
  modal('Tình trạng đã xem thông báo', wrap);
  loadReads();
}

function contentEditor(kind, record, {session = null, allSessions = null} = {}) {
  if (kind === 'notices') {
    openNoticeComposerModal(record);
    return;
  }
  const fields = [['title', 'Tiêu đề', 'text', record.title]];
  let tab = kind;
  if (kind === 'assignments') {
    const decoded = decodeAssignmentSessionInstructions(record.instructions || '');
    const currentSessionNum = String(session?.sessionNumber || decoded.sessionNumber || 1);
    const sessionItems = Array.isArray(allSessions) && allSessions.length
      ? allSessions.map(s => ({
          value: String(s.sessionNumber),
          label: `Buổi ${s.sessionNumber}${s.date ? ` (${formatSessionDateVi(s.date)})` : ''}${s.lessonName ? ` · ${s.lessonName}` : ''}`
        }))
      : Array.from({length: DEFAULT_COURSE_SESSIONS_COUNT}, (_, idx) => ({
          value: String(idx + 1),
          label: `Buổi ${idx + 1}`
        }));
    fields.unshift(['sessionNumber', 'Thuộc buổi học', 'select', currentSessionNum, {items: sessionItems}]);
    fields.push(['instructions', 'Hướng dẫn', 'textarea', decoded.cleanInstructions || '', {required: false}]);
    fields.push(
      ['opensAt', 'Giờ mở', 'datetime-local', localTime(record.opens_at)],
      ['closesAt', 'Giờ đóng', 'datetime-local', localTime(record.closes_at)],
      ['status', 'Trạng thái', 'select', record.status, {items: [{value: 'published', label: 'Công bố'}, {value: 'archived', label: 'Lưu trữ, giữ lại lịch sử'}]}]
    );
  }

  const f = form(fields, 'Lưu thay đổi', async b => {
    for (const k of ['opensAt', 'closesAt']) if (k in b) b[k] = new Date(b[k]).getTime();
    if (kind === 'assignments') {
      const chosenNum = Number(b.sessionNumber) || session?.sessionNumber || 1;
      b.instructions = encodeAssignmentSessionInstructions({
        sessionNumber: chosenNum,
        lessonId: lessonSessionId(selectedClass.id, chosenNum),
        cleanInstructions: b.instructions || ''
      });
      delete b.sessionNumber;
    }
    await api(`/api/classes/${selectedClass.id}/${kind}/${record.id}`, {method: 'POST', body: b});
    $('editor').close();
    await refreshClass(tab);
  });

  modal('Chỉnh sửa nội dung', f);
}

// Chế độ hỗ trợ kiểm thử cục bộ (QA Preview Mode Switcher)
if (typeof window !== 'undefined' && ['localhost','127.0.0.1'].includes(location.hostname)) {
  window.qaSetMode = async (mode) => {
    status('');
    if (!auth.currentUser) {
      await signInWithPopup(auth, new GoogleAuthProvider());
    }
    if (!session || sessionUid !== auth.currentUser?.uid) {
      session = {token: 'q'.repeat(43), expiresAt: Date.now() + 3600000};
      sessionUid = auth.currentUser?.uid || 'qa-admin';
    }
    const aw = document.querySelector('.auth-wrapper');
    const sc = $('auth-showcase');
    const login = $('login'); if (login) login.hidden = true;
    const otp = $('otp-panel'); if (otp) otp.hidden = true;
    const ws = $('workspace'); if (ws) ws.hidden = true;
    const onb = $('onboarding-panel'); if (onb) onb.hidden = true;
    const pnd = $('pending-panel'); if (pnd) pnd.hidden = true;

    if (mode === 'admin') {
      if (aw) aw.hidden = true;
      if (sc) sc.hidden = true;
      const [profile, classList] = await Promise.all([api('/api/me'), api('/api/classes')]);
      me = profile;
      classes = sortClasses(classList.items);
      viewRole = 'admin';
      activeNav = 'enrollments';
      activeClassTab = null;
      activePracticeSubPage = null;
      selectedClass = workspaceSource = workspace = null;
      $('workspace').hidden = false;
      $('logout').hidden = false;
      navigation();
      await adminPage();
    } else if (mode === 'new_student') {
      if (aw) aw.hidden = false;
      $('logout').hidden = false;
      await showOnboardingForm(null, false);
    } else if (mode === 'pending') {
      if (aw) aw.hidden = false;
      $('logout').hidden = false;
      showPendingScreen({
        fullName: 'Nguyễn Minh Quân',
        className: '12',
        schoolName: 'THPT Chuyên Hà Nội - Amsterdam',
        parentName: 'Nguyễn Văn Hoàng',
        parentPhone: '0987654321',
        photoUrl: ''
      });
    } else if (mode === 'revision') {
      if (aw) aw.hidden = false;
      $('logout').hidden = false;
      await showOnboardingForm({
        fullName: 'Trần Thảo Linh',
        classId: 'class-10a2',
        schoolName: 'THPT Chu Văn An',
        studentPhone: '0901234567',
        parentName: 'Trần Thu Hà',
        parentPhone: '0918765432',
        parentRelation: 'mother',
        adminNotes: 'Em đăng ký nhầm lớp 10B của năm ngoái, vui lòng chọn lại lớp 11 và cập nhật lại SĐT của phụ huynh.'
      }, true);
    }
  };
}

function authenticatedAvatar(url, alt = '', className = 'enrollment-avatar') {
  if (!url) {
    return el('div', {class: `${className} enrollment-avatar-fallback`, 'aria-hidden': 'true'}, formatUserInitials(alt, 'HS'));
  }
  const image = el('img', {class: className, alt: alt || 'Ảnh nhận diện'});
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    image.src = url;
    return image;
  }
  api(url, {blob: true})
    .then(blob => { image.src = URL.createObjectURL(blob); })
    .catch(() => { image.alt = 'Không tải được ảnh'; });
  return image;
}
function enrollmentPhoto(req) {
  return authenticatedAvatar(req.photoUrl, req.fullName, 'enrollment-avatar');
}
