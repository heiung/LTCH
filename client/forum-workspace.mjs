// Không gian Diễn đàn & Hỏi đáp Lớp học (Forum Workspace 2.0)
// Tuân thủ LTCH Academic Design System 2.0, CSP nghiêm ngặt (0 inline style), WCAG AA.

import { createActionMenu } from './action-menu.mjs';
import {
  FORUM_CATEGORIES,
  getForumCategoryMeta,
  deriveForumPostStatus,
  summarizeForumExcerpt,
  formatRelativeForumTimeVi,
  computeForumStats,
  sortAndFilterForumPosts,
  normalizeForumSessionNumber
} from '../shared/forum-metadata.mjs';

const ALLOWED_FORUM_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_FORUM_FILE_BYTES = 10_000_000;

const FORUM_ICONS = {
  search:
    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  pin:
    '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  lock:
    '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock:
    '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  checkCircle:
    '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  arrowLeft:
    '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  link:
    '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  pdf:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h6"/><path d="M9 11h6"/>',
  eye:
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  paperclip:
    '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  book:
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'
};

const ROLE_LABELS = {
  admin: 'Quản trị viên',
  teacher: 'Giáo viên',
  assistant: 'Trợ giảng',
  student: 'Học sinh'
};

const CATEGORY_PLACEHOLDERS = {
  homework: 'VD: Nhờ cô và các bạn gợi ý câu 4 phiếu BTVN Buổi 12',
  lesson: 'VD: Thắc mắc phần xét dấu đạo hàm ở ví dụ 3 trên lớp',
  exam: 'VD: Hỏi hướng giải nhanh câu 18 đề luyện THPTQG số 02',
  tip: 'VD: Tổng hợp mẹo bấm máy tính kiểm tra tích phân và nguyên hàm',
  general: 'VD: Trao đổi về phương pháp học tập và ôn thi hiệu quả'
};

function forumEl(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      node.className = v;
    } else if (k === 'text') {
      node.textContent = v;
    } else if (v === true) {
      node.setAttribute(k, '');
    } else if (k in node && !k.includes('-') && k !== 'list' && k !== 'type' && k !== 'form') {
      node[k] = v;
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
  return node;
}

function forumSvg(name, size = 16, extraClass = '') {
  const body = FORUM_ICONS[name];
  if (!body) return null;
  const span = document.createElement('span');
  span.className = extraClass ? `forum-svg-icon ${extraClass}` : 'forum-svg-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return span;
}

function formatFileSizeShort(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (num < 1024) return `${Math.round(num)} B`;
  const kb = num / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1).replace('.', ',')} KB`;
  return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
}

function normalizeForumAttachmentType(file) {
  if (!file) return null;
  const rawType = String(file.type || '').split(';')[0].trim().toLowerCase();
  if (rawType === 'image/jpg' || rawType === 'image/pjpeg') return 'image/jpeg';
  if (ALLOWED_FORUM_MIME.has(rawType)) return rawType;
  const name = String(file.name || '').toLowerCase();
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.pdf$/i.test(name)) return 'application/pdf';
  return null;
}

function buildAuthorBlock({ name, role, uid, currentUid, timestamp, editedAt = null, fmt, isAuthorOp = false }) {
  const displayName = name || 'Thành viên';
  const safeRole = ROLE_LABELS[role] ? role : 'student';
  const isStaffAuthor = ['admin', 'teacher', 'assistant'].includes(safeRole);
  const cleanDisplay = String(displayName).trim().replace(/^[^\p{L}\p{N}]+/gu, '');
  const initial = cleanDisplay.slice(0, 1).toLocaleUpperCase('vi-VN') || 'T';
  const relTime = formatRelativeForumTimeVi(timestamp);
  const fullTime = fmt(timestamp);

  const metaParts = [];
  if (relTime) metaParts.push(relTime);
  if (fullTime && fullTime !== relTime) metaParts.push(fullTime);
  if (editedAt) metaParts.push('Đã chỉnh sửa');

  return forumEl(
    'div',
    { class: 'forum-author' },
    forumEl('span', { class: `forum-avatar is-role-${safeRole}`, 'aria-hidden': 'true', text: initial }),
    forumEl(
      'div',
      { class: 'forum-author-details' },
      forumEl(
        'div',
        { class: 'forum-author-name-row' },
        forumEl('strong', { text: displayName }),
        isStaffAuthor
          ? forumEl('span', { class: `forum-role-badge is-role-${safeRole}`, text: ROLE_LABELS[safeRole] })
          : null,
        uid && currentUid && uid === currentUid
          ? forumEl('span', { class: 'forum-me-chip', text: 'Bạn' })
          : null,
        isAuthorOp && !isStaffAuthor
          ? forumEl('span', { class: 'forum-op-chip', text: 'Người hỏi' })
          : null
      ),
      forumEl('span', {
        class: 'forum-author-time',
        text: metaParts.join(' · '),
        title: fullTime || ''
      })
    )
  );
}

/**
 * Bộ chọn tệp dùng chung cho tạo/sửa câu hỏi và bình luận (kéo thả, dán Ctrl+V, chụp ảnh, xem trước).
 */
function createForumAttachmentPicker({
  existingFileName = '',
  existingContentType = '',
  icon = () => null,
  registerUrl = () => {},
  onError = () => {}
} = {}) {
  let selectedFile = null;
  let previewUrl = null;
  let removeExisting = false;

  const fileInput = forumEl('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf',
    class: 'forum-file-input'
  });
  const cameraInput = forumEl('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,.jpg,.jpeg,.png',
    capture: 'environment',
    class: 'forum-file-input'
  });

  const existingBox = forumEl('div', { class: 'forum-existing-file', hidden: !existingFileName });
  const existingLabel = forumEl('span', {
    class: 'forum-existing-file-name',
    text: existingFileName ? `Đang đính kèm: ${existingFileName}` : ''
  });
  const toggleRemoveExistingBtn = forumEl(
    'button',
    {
      type: 'button',
      class: 'forum-clear-file',
      onclick: () => {
        removeExisting = !removeExisting;
        syncView();
      }
    },
    forumEl('span', { text: 'Gỡ tệp hiện tại' })
  );
  if (existingFileName) {
    existingBox.append(
      forumSvg(existingContentType === 'application/pdf' ? 'pdf' : 'image', 16),
      existingLabel,
      toggleRemoveExistingBtn
    );
  }

  const selectedPreviewWrap = forumEl('div', { class: 'forum-selected-preview', hidden: true });
  const thumbHost = forumEl('div', { class: 'forum-selected-thumb', hidden: true });
  const chosenName = forumEl('span', { class: 'forum-chosen', 'aria-live': 'polite' });
  const clearBtn = forumEl(
    'button',
    {
      type: 'button',
      class: 'forum-clear-file',
      onclick: () => {
        clearSelected();
      }
    },
    forumEl('span', { text: 'Bỏ tệp mới' })
  );
  selectedPreviewWrap.append(
    thumbHost,
    forumEl('div', { class: 'forum-selected-info' }, chosenName),
    clearBtn
  );

  function revokePreview() {
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl); } catch {}
      previewUrl = null;
    }
  }

  function clearSelected() {
    revokePreview();
    selectedFile = null;
    fileInput.value = '';
    cameraInput.value = '';
    syncView();
  }

  function setFile(rawFile) {
    if (!rawFile) return;
    const mime = normalizeForumAttachmentType(rawFile);
    if (!mime || !rawFile.size || rawFile.size > MAX_FORUM_FILE_BYTES) {
      onError('Chọn ảnh JPG, PNG hoặc PDF không rỗng, tối đa 10 MB.');
      return;
    }
    revokePreview();
    const safeFile = rawFile.type === mime ? rawFile : new File([rawFile], rawFile.name || 'dinh-kem', { type: mime });
    selectedFile = safeFile;
    removeExisting = false;
    if (mime.startsWith('image/')) {
      previewUrl = URL.createObjectURL(safeFile);
      registerUrl(previewUrl);
    }
    syncView();
  }

  function syncView() {
    if (selectedFile) {
      selectedPreviewWrap.hidden = false;
      chosenName.textContent = `${selectedFile.name} (${formatFileSizeShort(selectedFile.size)})`;
      if (previewUrl) {
        thumbHost.hidden = false;
        thumbHost.replaceChildren(forumEl('img', { src: previewUrl, alt: selectedFile.name }));
      } else {
        thumbHost.hidden = false;
        thumbHost.replaceChildren(forumEl('span', { class: 'forum-pdf-thumb-badge', text: 'PDF' }));
      }
      if (existingFileName) existingBox.hidden = true;
      return;
    }

    selectedPreviewWrap.hidden = true;
    thumbHost.replaceChildren();
    chosenName.textContent = '';

    if (existingFileName) {
      existingBox.hidden = false;
      existingBox.classList.toggle('is-marked-remove', removeExisting);
      existingLabel.textContent = removeExisting
        ? `Sẽ gỡ tệp "${existingFileName}" khi lưu`
        : `Đang đính kèm: ${existingFileName}`;
      toggleRemoveExistingBtn.querySelector('span').textContent = removeExisting ? 'Giữ lại tệp' : 'Gỡ tệp hiện tại';
    }
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) setFile(f);
  });
  cameraInput.addEventListener('change', () => {
    const f = cameraInput.files?.[0];
    cameraInput.value = '';
    if (f) setFile(f);
  });

  const dropZone = forumEl(
    'div',
    { class: 'forum-upload-dropzone' },
    forumEl(
      'div',
      { class: 'forum-upload-bar' },
      forumEl(
        'p',
        {
          class: 'forum-upload-hint',
          text: 'Đính kèm ảnh JPG, PNG hoặc PDF (≤ 10 MB) · Kéo thả hoặc dán ảnh (Ctrl+V)'
        }
      ),
      forumEl(
        'div',
        { class: 'forum-attachments' },
        forumEl('label', { class: 'forum-file-label' }, icon('material') || forumSvg('paperclip', 16), forumEl('span', { text: 'Chọn tệp' }), fileInput),
        forumEl('label', { class: 'forum-file-label' }, icon('camera') || forumSvg('image', 16), forumEl('span', { text: 'Chụp ảnh' }), cameraInput)
      )
    ),
    existingBox,
    selectedPreviewWrap
  );

  dropZone.addEventListener('dragenter', ev => {
    ev.preventDefault();
    dropZone.classList.add('is-dragover');
  });
  dropZone.addEventListener('dragover', ev => {
    ev.preventDefault();
    dropZone.classList.add('is-dragover');
  });
  dropZone.addEventListener('dragleave', ev => {
    if (!dropZone.contains(ev.relatedTarget)) dropZone.classList.remove('is-dragover');
  });
  dropZone.addEventListener('drop', ev => {
    ev.preventDefault();
    dropZone.classList.remove('is-dragover');
    const f = ev.dataTransfer?.files?.[0];
    if (f) setFile(f);
  });

  syncView();

  return {
    node: dropZone,
    attachPasteTarget(formNode) {
      formNode.addEventListener('paste', ev => {
        const pasted = [...(ev.clipboardData?.files || [])].find(f => normalizeForumAttachmentType(f));
        if (pasted) {
          ev.preventDefault();
          setFile(pasted);
        }
      });
    },
    getState() {
      return {
        file: selectedFile,
        removeExisting: Boolean(removeExisting && !selectedFile)
      };
    },
    reset() {
      removeExisting = false;
      clearSelected();
    },
    dispose() {
      revokePreview();
    }
  };
}

export async function renderForumWorkspace({
  root,
  classId,
  className = 'Lớp học',
  cohortSlug = '',
  viewRole = 'student',
  currentUid = '',
  isArchived = false,
  canWrite = false,
  canModerate = false,
  subPage = null,
  initialContext = null,
  api,
  status,
  friendly,
  fmt,
  icon,
  btn,
  empty,
  modal,
  closeModal,
  upgradeSelects = () => {},
  download,
  openAttachmentPreview = null,
  createQuestionMathEditor,
  renderMathText,
  loadSessions = null,
  onNavigatePost = null,
  onOpenSessionTarget = null,
  onForumMutated = null
}) {
  if (!root || !classId) return;

  const isStaffView = ['admin', 'teacher', 'assistant'].includes(viewRole);
  const cleanupSet = new Set();
  const blobUrlSet = new Set();

  function registerCleanup(fn) {
    if (typeof fn === 'function') cleanupSet.add(fn);
  }
  function registerBlobUrl(url) {
    if (url) blobUrlSet.add(url);
    return url;
  }
  function disposeAllResources() {
    for (const url of blobUrlSet) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    blobUrlSet.clear();
    for (const fn of cleanupSet) {
      try { fn(); } catch {}
    }
    cleanupSet.clear();
  }

  // Clean up previous forum render resources attached to root
  if (typeof root._ltchForumDispose === 'function') {
    root._ltchForumDispose();
  }
  root._ltchForumDispose = disposeAllResources;

  let renderToken = 0;
  const isAlive = token => token === renderToken && root.isConnected;

  // Persistent workspace UI state during this mount
  const state = {
    activePostId: subPage && /^[A-Za-z0-9_-]{1,128}$/.test(String(subPage).trim()) ? String(subPage).trim() : null,
    statusFilter: initialContext?.statusFilter || 'all',
    categoryFilter: initialContext?.category || 'all',
    sessionFilter: normalizeForumSessionNumber(initialContext?.sessionNumber),
    searchQuery: '',
    sortBy: 'activity',
    items: [],
    nextCursor: null,
    effectiveCanWrite: Boolean(canWrite && !isArchived),
    effectiveCanModerate: Boolean(canModerate && !isArchived),
    sessions: []
  };

  // Load sessions asynchronously for session filter & composer dropdown (non-blocking)
  const sessionsPromise =
    typeof loadSessions === 'function'
      ? Promise.resolve(loadSessions())
          .then(res => {
            const list = Array.isArray(res?.sessions) ? res.sessions : Array.isArray(res) ? res : [];
            state.sessions = list.filter(s => s && Number.isInteger(Number(s.sessionNumber)));
            return state.sessions;
          })
          .catch(() => [])
      : Promise.resolve([]);

  function sessionLabel(sessionNum) {
    const num = normalizeForumSessionNumber(sessionNum);
    if (!num) return '';
    const match = state.sessions.find(s => Number(s.sessionNumber) === num);
    if (match?.lessonName) return `Buổi ${num}: ${match.lessonName}`;
    return `Buổi ${num}`;
  }

  function buildThreadShareUrl(postId) {
    const path = cohortSlug ? `/class/${cohortSlug}/forum/${postId}` : window.location.pathname;
    try {
      return `${window.location.origin}${path}`;
    } catch {
      return path;
    }
  }

  async function copyThreadLink(postId) {
    const url = buildThreadShareUrl(postId);
    try {
      await navigator.clipboard?.writeText(url);
      status('Đã sao chép liên kết câu hỏi.', false, 'success');
    } catch {
      status('Không thể tự động sao chép liên kết trên trình duyệt này.', true);
    }
  }

  function openConfirmDialog({ title, message, confirmText = 'Xác nhận', onConfirm }) {
    const err = forumEl('p', { class: 'form-error', role: 'alert', hidden: true });
    const cancelBtn = forumEl('button', {
      type: 'button',
      text: 'Hủy',
      onclick: () => closeModal()
    });
    const okBtn = forumEl('button', {
      type: 'button',
      class: 'danger',
      text: confirmText,
      onclick: async () => {
        err.hidden = true;
        okBtn.disabled = true;
        cancelBtn.disabled = true;
        okBtn.textContent = 'Đang xử lý…';
        try {
          await onConfirm();
          closeModal();
        } catch (error) {
          err.textContent = friendly(error);
          err.hidden = false;
          okBtn.disabled = false;
          cancelBtn.disabled = false;
          okBtn.textContent = confirmText;
        }
      }
    });
    const box = forumEl(
      'div',
      { class: 'forum-confirm-modal' },
      err,
      forumEl('p', { class: 'forum-confirm-message', text: message }),
      forumEl('div', { class: 'forum-confirm-actions' }, cancelBtn, okBtn)
    );
    modal(title, box);
  }

  async function runModeration(post, patch, successMsg) {
    await api(`/api/forum/posts/${encodeURIComponent(post.id)}/moderate`, {
      method: 'POST',
      body: patch
    });
    onForumMutated?.();
    if (successMsg) status(successMsg, false, 'success');
  }

  function buildSessionChip(post) {
    const num = normalizeForumSessionNumber(post?.session_number);
    if (!num) return null;
    const targetTab = post.category === 'homework' ? 'assignments' : 'materials';
    if (typeof onOpenSessionTarget === 'function') {
      return forumEl(
        'button',
        {
          type: 'button',
          class: 'forum-session-chip',
          title: `Mở ${targetTab === 'assignments' ? 'Bài tập' : 'Bài giảng'} Buổi ${num}`,
          onclick: ev => {
            ev.stopPropagation();
            onOpenSessionTarget(num, targetTab);
          }
        },
        forumSvg('book', 13),
        forumEl('span', { text: `Buổi ${num}` })
      );
    }
    return forumEl(
      'span',
      { class: 'forum-session-chip is-static' },
      forumSvg('book', 13),
      forumEl('span', { text: `Buổi ${num}` })
    );
  }

  function buildPostBadges(post) {
    const statusMeta = deriveForumPostStatus({
      resolved: post.resolved,
      acceptedCommentId: post.accepted_comment_id,
      commentCount: post.comment_count,
      hasStaffReply: post.has_staff_reply,
      locked: post.locked
    });
    const catMeta = getForumCategoryMeta(post.category);
    const fileLabel = post.content_type === 'application/pdf' ? 'PDF' : 'Ảnh';

    return forumEl(
      'div',
      { class: 'forum-badges-row' },
      forumEl('span', { class: `badge ${statusMeta.badgeClass}`, text: statusMeta.label }),
      forumEl(
        'span',
        { class: `badge ${catMeta.badgeClass}` },
        icon(catMeta.iconName),
        forumEl('span', { text: catMeta.pillLabel })
      ),
      post.pinned
        ? forumEl('span', { class: 'badge badge-warning forum-pin-badge' }, forumSvg('pin', 13), forumEl('span', { text: 'Đã ghim' }))
        : null,
      post.locked
        ? forumEl('span', { class: 'badge badge-neutral forum-lock-badge' }, forumSvg('lock', 13), forumEl('span', { text: 'Đã khóa' }))
        : null,
      buildSessionChip(post),
      post.has_file
        ? forumEl(
            'span',
            { class: 'forum-attachment-pill' },
            forumSvg(post.content_type === 'application/pdf' ? 'pdf' : 'image', 13),
            forumEl('span', { text: fileLabel })
          )
        : null
    );
  }

  async function openQuestionModal(existingPost = null, preset = {}) {
    await sessionsPromise;
    const isEditing = Boolean(existingPost?.id);
    const initialCat = existingPost?.category || preset.category || 'homework';
    const initialSession = normalizeForumSessionNumber(
      existingPost?.session_number ?? preset.sessionNumber ?? state.sessionFilter
    );

    const formNode = forumEl('form', { class: 'forum-composer' });
    const errorBox = forumEl('p', { class: 'form-error', role: 'alert', hidden: true, tabIndex: -1 });

    const catSelect = forumEl(
      'select',
      { name: 'category', 'aria-label': 'Chủ đề câu hỏi' },
      ...FORUM_CATEGORIES.map(c =>
        forumEl('option', {
          value: c.key,
          selected: c.key === initialCat,
          text: c.label
        })
      )
    );
    catSelect.value = initialCat;

    const sessionOptions = [
      forumEl('option', { value: '', text: 'Không gắn buổi học cụ thể' }),
      ...state.sessions.map(s => {
        const label = s.lessonName ? `Buổi ${s.sessionNumber}: ${s.lessonName}` : `Buổi ${s.sessionNumber}`;
        return forumEl('option', {
          value: String(s.sessionNumber),
          selected: Number(s.sessionNumber) === initialSession,
          text: label
        });
      })
    ];
    if (initialSession && !state.sessions.some(s => Number(s.sessionNumber) === initialSession)) {
      sessionOptions.push(
        forumEl('option', { value: String(initialSession), selected: true, text: `Buổi ${initialSession}` })
      );
    }
    const sessionSelect = forumEl(
      'select',
      { name: 'sessionNumber', 'aria-label': 'Liên kết buổi học' },
      ...sessionOptions
    );
    if (initialSession) sessionSelect.value = String(initialSession);

    const titleInput = forumEl('input', {
      type: 'text',
      name: 'title',
      required: true,
      maxLength: 250,
      value: existingPost?.title || '',
      placeholder: CATEGORY_PLACEHOLDERS[initialCat] || CATEGORY_PLACEHOLDERS.general
    });
    catSelect.addEventListener('change', () => {
      titleInput.placeholder = CATEGORY_PLACEHOLDERS[catSelect.value] || CATEGORY_PLACEHOLDERS.general;
    });

    const bodyInput = forumEl('textarea', {
      name: 'body',
      required: true,
      maxLength: 20000,
      value: existingPost?.body || '',
      placeholder: 'Mô tả bài toán, phần đã làm được hoặc câu hỏi cụ thể của bạn…'
    });
    const bodyLabel = forumEl(
      'label',
      {},
      forumEl('span', { class: 'field-label' }, 'Nội dung câu hỏi', forumEl('span', { class: 'required-mark', 'aria-hidden': 'true', text: ' *' })),
      bodyInput
    );

    const mathEditor = createQuestionMathEditor(bodyInput, {
      variant: 'question',
      label: 'Nội dung câu hỏi'
    });

    const picker = createForumAttachmentPicker({
      existingFileName: existingPost?.has_file ? (existingPost.file_name || 'Tệp đính kèm') : '',
      existingContentType: existingPost?.content_type || '',
      icon,
      registerUrl: registerBlobUrl,
      onError: msg => {
        errorBox.textContent = msg;
        errorBox.hidden = false;
        errorBox.focus();
      }
    });
    picker.attachPasteTarget(formNode);
    registerCleanup(() => picker.dispose());
    document.getElementById('editor')?.addEventListener('close', () => picker.dispose(), { once: true });

    const pinCheckbox =
      !isEditing && state.effectiveCanModerate
        ? forumEl('input', { type: 'checkbox', name: 'pinned' })
        : null;
    const pinLabel = pinCheckbox
      ? forumEl(
          'label',
          { class: 'forum-check-option' },
          pinCheckbox,
          forumEl('span', { text: 'Ghim bài viết này lên đầu diễn đàn lớp' })
        )
      : null;

    const submitText = isEditing ? 'Lưu thay đổi' : 'Đăng câu hỏi';
    const submitBtn = forumEl('button', { type: 'submit', class: 'primary', text: submitText });
    const cancelBtn = forumEl('button', {
      type: 'button',
      text: 'Hủy',
      onclick: () => closeModal()
    });

    const titleLabel = forumEl(
      'label',
      { class: 'forum-composer-title-field' },
      forumEl('span', { class: 'field-label' }, 'Tiêu đề câu hỏi', forumEl('span', { class: 'required-mark', 'aria-hidden': 'true', text: ' *' })),
      titleInput
    );

    const metaGrid = forumEl(
      'div',
      { class: 'forum-composer-meta-grid' },
      titleLabel,
      forumEl('label', {}, forumEl('span', { class: 'field-label', text: 'Chủ đề thảo luận' }), catSelect),
      forumEl('label', {}, forumEl('span', { class: 'field-label', text: 'Buổi học liên quan (tùy chọn)' }), sessionSelect)
    );

    formNode.append(
      ...[
        errorBox,
        metaGrid,
        bodyLabel,
        mathEditor,
        picker.node,
        pinLabel,
        forumEl('div', { class: 'forum-submit-row' }, cancelBtn, submitBtn)
      ].filter(Boolean)
    );

    formNode.addEventListener('submit', async ev => {
      ev.preventDefault();
      errorBox.hidden = true;
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      submitBtn.textContent = isEditing ? 'Đang lưu…' : 'Đang đăng…';
      formNode.setAttribute('aria-busy', 'true');
      try {
        const cleanTitle = titleInput.value.trim();
        if (!cleanTitle) throw Error('Vui lòng nhập tiêu đề câu hỏi.');
        if (!mathEditor.validate()) {
          throw Error('Hãy hoàn tất công thức đang soạn và nhập nội dung câu hỏi (tối đa 20.000 ký tự).');
        }
        const att = picker.getState();
        const fd = new FormData();
        fd.set('title', cleanTitle);
        fd.set('body', bodyInput.value);
        fd.set('category', catSelect.value || 'general');
        fd.set('sessionNumber', sessionSelect.value || '');
        if (pinCheckbox) fd.set('pinned', pinCheckbox.checked ? '1' : '0');
        if (att.file) fd.set('file', att.file);
        if (att.removeExisting) fd.set('removeFile', '1');

        if (isEditing) {
          await api(`/api/forum/posts/${encodeURIComponent(existingPost.id)}/edit`, {
            method: 'POST',
            body: fd
          });
          picker.dispose();
          closeModal();
          onForumMutated?.();
          status('Đã cập nhật câu hỏi.', false, 'success');
          if (state.activePostId === existingPost.id) await renderThreadView(existingPost.id);
          else await renderFeedView();
        } else {
          const created = await api(`/api/classes/${encodeURIComponent(classId)}/forum`, {
            method: 'POST',
            body: fd
          });
          picker.dispose();
          closeModal();
          onForumMutated?.();
          status('Đã đăng câu hỏi lên diễn đàn.', false, 'success');
          if (created?.id && state.activePostId) {
            openThread(created.id);
          } else {
            await renderFeedView();
          }
        }
      } catch (err) {
        errorBox.textContent = friendly(err);
        errorBox.hidden = false;
        errorBox.focus();
      } finally {
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
        submitBtn.textContent = submitText;
        formNode.removeAttribute('aria-busy');
      }
    });

    modal(isEditing ? 'Chỉnh sửa câu hỏi' : 'Đặt câu hỏi cho lớp', formNode);
    upgradeSelects(formNode);
  }

  function openEditCommentModal(comment, postId) {
    const formNode = forumEl('form', { class: 'forum-composer' });
    const errorBox = forumEl('p', { class: 'form-error', role: 'alert', hidden: true, tabIndex: -1 });
    const bodyInput = forumEl('textarea', {
      name: 'body',
      required: true,
      maxLength: 20000,
      value: comment.body || '',
      placeholder: 'Chỉnh sửa nội dung hướng dẫn hoặc lời giải…'
    });
    const bodyLabel = forumEl(
      'label',
      {},
      forumEl('span', { class: 'field-label' }, 'Nội dung trả lời', forumEl('span', { class: 'required-mark', 'aria-hidden': 'true', text: ' *' })),
      bodyInput
    );
    const mathEditor = createQuestionMathEditor(bodyInput, {
      variant: 'reply',
      label: 'Nội dung trả lời'
    });
    const picker = createForumAttachmentPicker({
      existingFileName: comment.has_file ? (comment.file_name || 'Tệp đính kèm') : '',
      existingContentType: comment.content_type || '',
      icon,
      registerUrl: registerBlobUrl,
      onError: msg => {
        errorBox.textContent = msg;
        errorBox.hidden = false;
        errorBox.focus();
      }
    });
    picker.attachPasteTarget(formNode);
    registerCleanup(() => picker.dispose());
    document.getElementById('editor')?.addEventListener('close', () => picker.dispose(), { once: true });

    const submitBtn = forumEl('button', { type: 'submit', class: 'primary', text: 'Lưu trả lời' });
    const cancelBtn = forumEl('button', {
      type: 'button',
      text: 'Hủy',
      onclick: () => closeModal()
    });

    formNode.append(
      errorBox,
      bodyLabel,
      mathEditor,
      picker.node,
      forumEl('div', { class: 'forum-submit-row' }, cancelBtn, submitBtn)
    );

    formNode.addEventListener('submit', async ev => {
      ev.preventDefault();
      errorBox.hidden = true;
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      submitBtn.textContent = 'Đang lưu…';
      try {
        if (!mathEditor.validate()) {
          throw Error('Hãy hoàn tất công thức đang soạn và nhập nội dung trả lời.');
        }
        const att = picker.getState();
        const fd = new FormData();
        fd.set('body', bodyInput.value);
        if (att.file) fd.set('file', att.file);
        if (att.removeExisting) fd.set('removeFile', '1');
        await api(`/api/forum/comments/${encodeURIComponent(comment.id)}/edit`, {
          method: 'POST',
          body: fd
        });
        picker.dispose();
        closeModal();
        status('Đã cập nhật câu trả lời.', false, 'success');
        await renderThreadView(postId);
      } catch (err) {
        errorBox.textContent = friendly(err);
        errorBox.hidden = false;
        errorBox.focus();
      } finally {
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
        submitBtn.textContent = 'Lưu trả lời';
      }
    });

    modal('Chỉnh sửa câu trả lời', formNode);
  }

  function renderAttachmentBlock(item, kind, token) {
    if (!item?.has_file) return null;
    const name = item.file_name || 'Tệp đính kèm';
    const mime = String(item.content_type || '').toLowerCase();
    const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name);
    const fileUrl = `/api/forum/${kind}/${encodeURIComponent(item.id)}/file`;
    const downloadSlug = name.replace(/\.(pdf|jpe?g|png)$/i, '');
    const sizeText = item.file_size ? formatFileSizeShort(item.file_size) : '';

    const openPreview = () => {
      if (typeof openAttachmentPreview === 'function') {
        return openAttachmentPreview({
          path: `${fileUrl}?inline=1`,
          downloadPath: fileUrl,
          name,
          contentType: mime,
          size: item.file_size || 0
        });
      }
      return download(fileUrl, downloadSlug, item.content_type);
    };

    if (isPdf) {
      return forumEl(
        'div',
        { class: 'forum-attachment-card is-pdf' },
        forumEl(
          'div',
          { class: 'forum-attachment-card-info' },
          forumEl('span', { class: 'forum-attachment-icon is-pdf' }, forumSvg('pdf', 20)),
          forumEl(
            'div',
            { class: 'forum-attachment-meta' },
            forumEl('strong', { text: name }),
            forumEl('span', { class: 'meta', text: sizeText ? `Tài liệu PDF · ${sizeText}` : 'Tài liệu PDF' })
          )
        ),
        forumEl(
          'div',
          { class: 'forum-attachment-actions' },
          openAttachmentPreview
            ? btn('Xem trực tiếp', openPreview, false, 'material')
            : null,
          btn('Tải xuống', () => download(fileUrl, downloadSlug, item.content_type), false, 'download')
        )
      );
    }

    // Inline image preview loaded with authenticated Session header
    const imgStage = forumEl(
      'div',
      { class: 'forum-inline-img-stage' },
      forumEl('p', { class: 'meta forum-img-loading', text: 'Đang tải hình ảnh đính kèm…' })
    );

    const card = forumEl(
      'div',
      { class: 'forum-attachment-card is-image' },
      imgStage,
      forumEl(
        'div',
        { class: 'forum-attachment-bar' },
        forumEl(
          'div',
          { class: 'forum-attachment-meta' },
          forumSvg('image', 15),
          forumEl('strong', { text: name }),
          sizeText ? forumEl('span', { class: 'meta', text: `(${sizeText})` }) : null
        ),
        forumEl(
          'div',
          { class: 'forum-attachment-actions' },
          openAttachmentPreview
            ? forumEl(
                'button',
                {
                  type: 'button',
                  class: 'forum-inline-action-btn',
                  onclick: () => openPreview()
                },
                forumSvg('eye', 15),
                forumEl('span', { text: 'Phóng to' })
              )
            : null,
          btn('Tải xuống', () => download(fileUrl, downloadSlug, item.content_type), false, 'download')
        )
      )
    );

    Promise.resolve(api(`${fileUrl}?inline=1`, { blob: true }))
      .then(blob => {
        if (!isAlive(token) || !imgStage.isConnected || !(blob instanceof Blob) || !blob.size) return;
        const url = registerBlobUrl(URL.createObjectURL(blob));
        const img = forumEl('img', {
          src: url,
          alt: name,
          class: 'forum-inline-img',
          loading: 'lazy'
        });
        if (openAttachmentPreview) {
          const zoomBtn = forumEl(
            'button',
            {
              type: 'button',
              class: 'forum-inline-img-btn',
              'aria-label': `Phóng to ảnh ${name}`,
              onclick: () => openAttachmentPreview({
                path: `${fileUrl}?inline=1`,
                downloadPath: fileUrl,
                name,
                contentType: mime,
                size: item.file_size || 0,
                existingBlob: blob
              })
            },
            img
          );
          imgStage.replaceChildren(zoomBtn);
        } else {
          imgStage.replaceChildren(img);
        }
      })
      .catch(() => {
        if (!isAlive(token) || !imgStage.isConnected) return;
        imgStage.replaceChildren(
          forumEl('p', { class: 'meta forum-img-fallback', text: 'Không tải được ảnh xem trước. Bạn có thể bấm Tải xuống bên dưới.' })
        );
      });

    return card;
  }

  function buildPostActionMenu(post, { inThread = false } = {}) {
    const items = [
      {
        label: 'Sao chép liên kết',
        icon: 'copy',
        onSelect: () => copyThreadLink(post.id)
      }
    ];

    if (state.effectiveCanModerate) {
      items.push({
        label: post.pinned ? 'Bỏ ghim bài viết' : 'Ghim lên đầu diễn đàn',
        icon: 'pin',
        onSelect: async () => {
          const nextPinned = !post.pinned;
          await runModeration(
            post,
            { pinned: nextPinned },
            nextPinned ? 'Đã ghim bài viết lên đầu.' : 'Đã bỏ ghim bài viết.'
          );
          if (inThread) await renderThreadView(post.id);
          else await renderFeedView();
        }
      });
    }

    if (!isArchived && post.can_resolve) {
      const nextResolved = !Boolean(post.resolved || post.accepted_comment_id);
      items.push({
        label: nextResolved ? 'Đánh dấu đã giải đáp' : 'Mở lại chưa giải đáp',
        icon: 'check',
        onSelect: async () => {
          await runModeration(
            post,
            { resolved: nextResolved },
            nextResolved ? 'Đã đánh dấu câu hỏi là Đã giải đáp.' : 'Đã mở lại trạng thái chờ giải đáp.'
          );
          if (inThread) await renderThreadView(post.id);
          else await renderFeedView();
        }
      });
    }

    if (state.effectiveCanModerate) {
      items.push({
        label: post.locked ? 'Mở khóa bình luận' : 'Khóa bình luận chủ đề',
        icon: 'alert',
        onSelect: async () => {
          const nextLocked = !post.locked;
          await runModeration(
            post,
            { locked: nextLocked },
            nextLocked ? 'Đã khóa bình luận của chủ đề.' : 'Đã mở lại bình luận.'
          );
          if (inThread) await renderThreadView(post.id);
          else await renderFeedView();
        }
      });
    }

    if (!isArchived && post.can_edit) {
      items.push({
        label: 'Chỉnh sửa câu hỏi',
        icon: 'edit',
        dividerBefore: true,
        onSelect: () => openQuestionModal(post)
      });
    }

    if (!isArchived && post.can_delete) {
      items.push({
        label: 'Xóa câu hỏi',
        icon: 'trash',
        danger: true,
        dividerBefore: true,
        onSelect: () =>
          openConfirmDialog({
            title: 'Xóa câu hỏi khỏi diễn đàn',
            message: `Bạn có chắc chắn muốn xóa câu hỏi "${post.title}"? Toàn bộ phản hồi và tệp đính kèm liên quan sẽ bị xóa vĩnh viễn.`,
            confirmText: 'Xóa câu hỏi',
            onConfirm: async () => {
              await api(`/api/forum/posts/${encodeURIComponent(post.id)}/delete`, { method: 'POST', body: {} });
              onForumMutated?.();
              status('Đã xóa câu hỏi.', false, 'success');
              if (inThread) {
                openFeed();
              } else {
                await renderFeedView();
              }
            }
          })
      });
    }

    return createActionMenu({
      iconOnly: true,
      ariaLabel: `Tác vụ bài viết ${post.title || ''}`.trim(),
      variant: 'outline',
      items
    });
  }

  function openThread(postId) {
    state.activePostId = postId;
    onNavigatePost?.(postId);
    renderThreadView(postId);
  }

  function openFeed() {
    state.activePostId = null;
    onNavigatePost?.(null);
    renderFeedView();
  }

  async function renderFeedView() {
    const token = ++renderToken;
    disposeAllResources();
    root.replaceChildren(forumEl('p', { class: 'meta', role: 'status', text: 'Đang tải diễn đàn lớp học…' }));

    try {
      const [result] = await Promise.all([
        api(`/api/classes/${encodeURIComponent(classId)}/forum`),
        sessionsPromise
      ]);
      if (!isAlive(token)) return;

      state.items = Array.isArray(result.items) ? result.items : [];
      state.nextCursor = result.nextCursor || null;
      state.effectiveCanWrite = Boolean(canWrite && result.canWrite && !isArchived);
      state.effectiveCanModerate = Boolean(canModerate && result.canModerate && !isArchived);

      const toolbarActions = forumEl('div', { class: 'subtab-command-actions' });
      if (state.effectiveCanWrite) {
        toolbarActions.append(
          btn(
            'Đặt câu hỏi',
            () =>
              openQuestionModal(null, {
                category: state.categoryFilter !== 'all' ? state.categoryFilter : 'homework',
                sessionNumber: state.sessionFilter
              }),
            true,
            'plus'
          )
        );
      }

      const countPill = forumEl('span', {
        class: 'subtab-count-pill',
        hidden: !isArchived && state.items.length === 0,
        text: isArchived ? 'Kho lưu trữ · Chỉ xem' : `${state.items.length} câu hỏi`
      });

      const toolbar = forumEl(
        'div',
        { class: 'subtab-command-bar forum-toolbar' },
        forumEl(
          'div',
          { class: 'subtab-command-info' },
          forumEl(
            'div',
            { class: 'subtab-command-title-row' },
            forumEl('h1', { class: 'subtab-command-title', text: `Diễn đàn ${className}` }),
            countPill
          )
        ),
        toolbarActions.childNodes.length ? toolbarActions : null
      );

      const triageHost = forumEl('div', { class: 'forum-triage-strip', role: 'group', 'aria-label': 'Lọc nhanh theo trạng thái' });
      const contextHost = forumEl('div', { class: 'forum-context-host' });
      const listHost = forumEl('div', { class: 'forum-feed-region' });

      const searchInput = forumEl('input', {
        type: 'search',
        class: 'notices-search-input',
        value: state.searchQuery,
        placeholder: 'Tìm tiêu đề, nội dung, người đăng hoặc buổi học…',
        'aria-label': 'Tìm kiếm câu hỏi trong diễn đàn'
      });
      const clearSearchBtn = forumEl(
        'button',
        {
          type: 'button',
          class: 'notices-search-clear',
          'aria-label': 'Xóa từ khóa tìm kiếm',
          hidden: !state.searchQuery.trim(),
          onclick: () => {
            state.searchQuery = '';
            searchInput.value = '';
            clearSearchBtn.hidden = true;
            drawFeed();
            searchInput.focus();
          }
        },
        forumEl('span', { text: 'Xóa' })
      );

      const categorySelect = forumEl(
        'select',
        {
          name: 'forumCategoryFilter',
          'aria-label': 'Lọc theo chủ đề',
          onchange: () => {
            state.categoryFilter = categorySelect.value || 'all';
            drawFeed();
          }
        },
        forumEl('option', { value: 'all', selected: state.categoryFilter === 'all', text: 'Tất cả chủ đề' }),
        ...FORUM_CATEGORIES.map(c =>
          forumEl('option', {
            value: c.key,
            selected: state.categoryFilter === c.key,
            text: c.label
          })
        )
      );
      categorySelect.value = state.categoryFilter || 'all';

      const controlsShell = forumEl(
        'section',
        {
          class: 'forum-controls-shell',
          'aria-label': 'Tìm kiếm và bộ lọc diễn đàn',
          hidden: state.items.length === 0
        },
        forumEl(
          'div',
          { class: 'forum-search-row' },
          triageHost,
          forumEl(
            'div',
            { class: 'forum-filter-tools' },
            forumEl(
              'label',
              { class: 'notices-search-box' },
              forumSvg('search', 17, 'notices-search-icon'),
              searchInput,
              clearSearchBtn
            ),
            forumEl('div', { class: 'forum-filter-select-wrap' }, categorySelect)
          )
        )
      );

      searchInput.addEventListener('input', () => {
        state.searchQuery = searchInput.value;
        clearSearchBtn.hidden = !state.searchQuery.trim();
        drawFeed();
      });

      function drawTriageStrip() {
        const stats = computeForumStats(state.items, currentUid);
        if (!isArchived) {
          countPill.hidden = stats.total === 0;
          countPill.textContent = `${stats.total} câu hỏi`;
        }
        controlsShell.hidden = stats.total === 0;
        const defs = isStaffView
          ? [
              { key: 'all', label: 'Tất cả', count: stats.total, tone: 'neutral' },
              { key: 'waiting', label: 'Cần giải đáp', count: stats.waitingCount, tone: stats.waitingCount > 0 ? 'alert' : 'neutral' },
              { key: 'solved', label: 'Đã giải đáp', count: stats.solvedCount, tone: 'solved' }
            ]
          : [
              { key: 'all', label: 'Tất cả', count: stats.total, tone: 'neutral' },
              { key: 'open', label: 'Chờ giải đáp', count: stats.openCount, tone: stats.openCount > 0 ? 'alert' : 'neutral' },
              { key: 'solved', label: 'Đã giải đáp', count: stats.solvedCount, tone: 'solved' },
              { key: 'mine', label: 'Của tôi', count: stats.mineCount, tone: 'mine' }
            ];

        triageHost.replaceChildren(
          ...defs.map(def => {
            const active = state.statusFilter === def.key;
            return forumEl(
              'button',
              {
                type: 'button',
                class: `forum-triage-btn is-tone-${def.tone}${active ? ' is-active' : ''}`,
                'aria-pressed': String(active),
                onclick: () => {
                  state.statusFilter = def.key;
                  drawTriageStrip();
                  drawFeed();
                }
              },
              forumEl('span', { class: 'forum-triage-label', text: def.label }),
              forumEl('strong', { class: 'forum-triage-count', text: String(def.count) })
            );
          })
        );
      }

      function drawContextBanner() {
        if (!state.sessionFilter) {
          contextHost.replaceChildren();
          return;
        }
        const label = sessionLabel(state.sessionFilter);
        contextHost.replaceChildren(
          forumEl(
            'div',
            { class: 'forum-context-banner', role: 'status' },
            forumEl(
              'div',
              { class: 'forum-context-copy' },
              forumSvg('book', 16),
              forumEl('strong', { text: `Đang lọc thảo luận của ${label}` })
            ),
            forumEl(
              'div',
              { class: 'forum-context-actions' },
              state.effectiveCanWrite
                ? btn(
                    `Hỏi bài về Buổi ${state.sessionFilter}`,
                    () => openQuestionModal(null, { category: 'homework', sessionNumber: state.sessionFilter }),
                    false,
                    'plus'
                  )
                : null,
              forumEl(
                'button',
                {
                  type: 'button',
                  class: 'forum-context-clear-btn',
                  text: 'Xem tất cả',
                  onclick: () => {
                    state.sessionFilter = null;
                    drawContextBanner();
                    drawFeed();
                  }
                }
              )
            )
          )
        );
      }

      function buildPostCard(item) {
        const isSolved = Boolean(item.resolved || item.accepted_comment_id);
        const isWaitingForStaff = isStaffView && !isSolved && !item.locked && !item.has_staff_reply;
        const cardClasses = [
          'forum-card',
          item.pinned ? 'is-pinned' : '',
          isSolved ? 'is-solved' : '',
          isWaitingForStaff ? 'is-waiting-staff' : ''
        ]
          .filter(Boolean)
          .join(' ');

        const titleBtn = forumEl(
          'button',
          {
            type: 'button',
            class: 'forum-card-title-btn',
            onclick: () => openThread(item.id)
          },
          forumEl('span', { text: item.title })
        );

        const excerptText = summarizeForumExcerpt(item.body, 210);
        const excerptNode = forumEl('div', { class: 'forum-body forum-card-excerpt' });
        renderMathText(excerptNode, excerptText);

        const commentCount = Number(item.comment_count) || 0;
        const replySummary = commentCount > 0 ? `${commentCount} phản hồi` : 'Chưa có trả lời';
        const openBtnLabel =
          isWaitingForStaff && state.effectiveCanWrite ? 'Trả lời ngay' : 'Xem thảo luận';

        const openCtaBtn = forumEl(
          'button',
          {
            type: 'button',
            class: isWaitingForStaff && state.effectiveCanWrite ? 'primary forum-card-open-btn' : 'forum-card-open-btn',
            onclick: () => openThread(item.id)
          },
          icon('message'),
          forumEl('span', { text: openBtnLabel })
        );

        return forumEl(
          'article',
          { class: cardClasses },
          forumEl(
            'div',
            { class: 'forum-card-head' },
            buildPostBadges(item),
            buildPostActionMenu(item, { inThread: false })
          ),
          forumEl('h2', { class: 'forum-card-title' }, titleBtn),
          excerptText ? excerptNode : null,
          forumEl(
            'div',
            { class: 'forum-card-footer' },
            buildAuthorBlock({
              name: item.author_name,
              role: item.author_role,
              uid: item.author_uid,
              currentUid,
              timestamp: item.created_at,
              editedAt: item.edited_at,
              fmt
            }),
            forumEl(
              'div',
              { class: 'forum-card-cta-group' },
              forumEl('span', { class: `forum-reply-count${commentCount === 0 ? ' is-zero' : ''}`, text: replySummary }),
              openCtaBtn
            )
          )
        );
      }

      function drawFeed() {
        const filtered = sortAndFilterForumPosts(state.items, {
          statusFilter: state.statusFilter,
          category: state.categoryFilter,
          sessionNumber: state.sessionFilter,
          searchQuery: state.searchQuery,
          sortBy: state.sortBy,
          currentUid
        });

        if (!state.items.length) {
          const emptyCard = forumEl(
            'section',
            { class: 'forum-empty-board', 'aria-label': 'Trạng thái diễn đàn' },
            forumEl('div', { class: 'forum-empty-icon-wrap', 'aria-hidden': 'true' }, icon('message')),
            forumEl('h2', {
              class: 'forum-empty-title',
              text: state.effectiveCanWrite ? 'Diễn đàn lớp chưa có câu hỏi nào' : 'Lớp chưa có câu hỏi nào'
            }),
            forumEl('p', {
              class: 'forum-empty-desc',
              text: state.effectiveCanWrite
                ? 'Bấm "Đặt câu hỏi" để bắt đầu trao đổi bài tập, bài giảng cùng cả lớp.'
                : 'Khi học sinh hoặc giáo viên đăng câu hỏi thảo luận, nội dung sẽ hiển thị tại đây.'
            })
          );
          listHost.replaceChildren(emptyCard);
          return;
        }

        if (!filtered.length) {
          listHost.replaceChildren(
            forumEl(
              'div',
              { class: 'forum-filter-empty' },
              empty('Không tìm thấy câu hỏi nào phù hợp với bộ lọc hiện tại.'),
              btn(
                'Xem tất cả câu hỏi',
                () => {
                  state.statusFilter = 'all';
                  state.categoryFilter = 'all';
                  state.sessionFilter = null;
                  state.searchQuery = '';
                  searchInput.value = '';
                  clearSearchBtn.hidden = true;
                  categorySelect.value = 'all';
                  upgradeSelects(controlsShell);
                  drawTriageStrip();
                  drawContextBanner();
                  drawFeed();
                },
                true
              )
            )
          );
          return;
        }

        const listEl = forumEl('div', { class: 'forum-list' }, ...filtered.map(buildPostCard));
        const nodes = [listEl];

        if (state.nextCursor) {
          const loadMoreBtn = btn(
            'Xem câu hỏi cũ hơn',
            async () => {
              const label = loadMoreBtn.querySelector('span:last-child');
              if (label) label.textContent = 'Đang tải…';
              loadMoreBtn.setAttribute('aria-busy', 'true');
              try {
                const params = new URLSearchParams({
                  beforeCreatedAt: String(state.nextCursor.beforeCreatedAt),
                  beforeId: state.nextCursor.beforeId
                });
                const older = await api(`/api/classes/${encodeURIComponent(classId)}/forum?${params}`);
                if (!isAlive(token)) return;
                const seen = new Set(state.items.map(p => p.id));
                for (const p of older.items || []) {
                  if (p?.id && !seen.has(p.id)) {
                    state.items.push(p);
                    seen.add(p.id);
                  }
                }
                state.nextCursor = older.nextCursor || null;
                drawTriageStrip();
                drawFeed();
              } catch (err) {
                status(friendly(err), true);
              } finally {
                if (loadMoreBtn.isConnected) {
                  const lbl = loadMoreBtn.querySelector('span:last-child');
                  if (lbl) lbl.textContent = 'Xem câu hỏi cũ hơn';
                  loadMoreBtn.removeAttribute('aria-busy');
                }
              }
            },
            false,
            'refresh'
          );
          loadMoreBtn.classList.add('forum-load-more-btn');
          nodes.push(forumEl('div', { class: 'forum-load-more-row' }, loadMoreBtn));
        }

        listHost.replaceChildren(...nodes);
      }

      const shell = forumEl(
        'div',
        { class: 'forum-workspace-shell' },
        toolbar,
        controlsShell,
        contextHost,
        listHost
      );
      root.replaceChildren(shell);
      upgradeSelects(controlsShell);
      drawTriageStrip();
      drawContextBanner();
      drawFeed();

      if (initialContext?.openComposer && state.effectiveCanWrite) {
        initialContext.openComposer = false;
        openQuestionModal(null, {
          category: initialContext.category || 'homework',
          sessionNumber: initialContext.sessionNumber || state.sessionFilter
        });
      }
    } catch (error) {
      if (isAlive(token)) {
        root.replaceChildren(
          forumEl('p', { class: 'form-error', role: 'alert', text: friendly(error) }),
          btn('Thử lại', () => renderFeedView(), false, 'refresh')
        );
      }
    }
  }

  async function renderThreadView(postId) {
    const token = ++renderToken;
    disposeAllResources();
    root.replaceChildren(forumEl('p', { class: 'meta', role: 'status', text: 'Đang tải cuộc thảo luận…' }));

    try {
      const [postRes, commentsRes] = await Promise.all([
        api(`/api/forum/posts/${encodeURIComponent(postId)}`),
        api(`/api/forum/posts/${encodeURIComponent(postId)}/comments`),
        sessionsPromise
      ]);
      if (!isAlive(token)) return;

      const post = postRes?.post;
      if (!post) throw Error('Không tìm thấy bài viết.');
      if (post.class_id && post.class_id !== classId) {
        throw Error('Bài viết này không thuộc lớp học đang mở.');
      }

      state.effectiveCanWrite = Boolean(canWrite && postRes.canWrite && !isArchived);
      state.effectiveCanModerate = Boolean(canModerate && postRes.canModerate && !isArchived);

      let loadedComments = Array.isArray(commentsRes?.items) ? commentsRes.items : [];
      let commentsCursor = commentsRes?.nextCursor || null;

      const backBtn = forumEl(
        'button',
        {
          type: 'button',
          class: 'forum-back-btn',
          onclick: () => openFeed()
        },
        forumSvg('arrowLeft', 16),
        forumEl('span', { text: 'Danh sách câu hỏi' })
      );

      const sessionNum = normalizeForumSessionNumber(post.session_number);
      const sessionTargetTab = post.category === 'homework' ? 'assignments' : 'materials';
      const openSessionBtn =
        sessionNum && typeof onOpenSessionTarget === 'function'
          ? forumEl(
              'button',
              {
                type: 'button',
                class: 'forum-thread-action-btn',
                onclick: () => onOpenSessionTarget(sessionNum, sessionTargetTab)
              },
              forumSvg('book', 15),
              forumEl('span', {
                text: `Mở ${sessionTargetTab === 'assignments' ? 'Bài tập' : 'Bài giảng'} Buổi ${sessionNum}`
              })
            )
          : null;

      const copyLinkBtn = forumEl(
        'button',
        {
          type: 'button',
          class: 'forum-thread-action-btn',
          onclick: () => copyThreadLink(post.id)
        },
        forumSvg('link', 15),
        forumEl('span', { text: 'Sao chép liên kết' })
      );

      const isSolved = Boolean(post.resolved || post.accepted_comment_id);
      const resolveQuickBtn =
        !isArchived && post.can_resolve
          ? forumEl(
              'button',
              {
                type: 'button',
                class: isSolved ? 'forum-thread-solve-btn is-solved' : 'forum-thread-solve-btn',
                onclick: async () => {
                  const nextVal = !isSolved;
                  await runModeration(
                    post,
                    { resolved: nextVal },
                    nextVal ? 'Đã đánh dấu câu hỏi là Đã giải đáp.' : 'Đã mở lại câu hỏi.'
                  );
                  await renderThreadView(post.id);
                }
              },
              forumSvg('checkCircle', 15),
              forumEl('span', { text: isSolved ? 'Đã giải đáp' : 'Đánh dấu đã giải đáp' })
            )
          : null;

      const threadTopbar = forumEl(
        'div',
        { class: 'forum-thread-topbar' },
        backBtn,
        forumEl(
          'div',
          { class: 'forum-thread-topbar-actions' },
          openSessionBtn,
          copyLinkBtn,
          resolveQuickBtn,
          buildPostActionMenu(post, { inThread: true })
        )
      );

      const questionBodyNode = forumEl('div', { class: 'forum-body forum-thread-body' });
      renderMathText(questionBodyNode, post.body || '');

      const questionCard = forumEl(
        'article',
        { class: `forum-thread-question${post.pinned ? ' is-pinned' : ''}${isSolved ? ' is-solved' : ''}` },
        forumEl(
          'div',
          { class: 'forum-thread-question-head' },
          buildAuthorBlock({
            name: post.author_name,
            role: post.author_role,
            uid: post.author_uid,
            currentUid,
            timestamp: post.created_at,
            editedAt: post.edited_at,
            fmt
          }),
          buildPostBadges(post)
        ),
        forumEl('h2', { class: 'forum-thread-title', text: post.title }),
        questionBodyNode,
        renderAttachmentBlock(post, 'posts', token)
      );

      const acceptedExistsInView = Boolean(
        post.accepted_comment_id && loadedComments.some(c => c.id === post.accepted_comment_id)
      );
      const acceptedJumpCallout = acceptedExistsInView
        ? forumEl(
            'div',
            { class: 'forum-accepted-jump-bar' },
            forumEl(
              'div',
              { class: 'forum-accepted-jump-copy' },
              forumSvg('checkCircle', 17),
              forumEl('strong', { text: 'Câu hỏi này đã có Lời giải chuẩn được chọn.' })
            ),
            forumEl(
              'button',
              {
                type: 'button',
                class: 'forum-accepted-jump-btn',
                text: 'Xem lời giải chuẩn ↓',
                onclick: () => {
                  const target = root.querySelector(`#forum-reply-${post.accepted_comment_id}`);
                  target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                }
              }
            )
          )
        : null;

      const repliesSectionHeader = forumEl(
        'div',
        { class: 'forum-thread-replies-head' },
        forumEl('h3', { text: `Thảo luận & Lời giải (${loadedComments.length})` })
      );

      const commentsListHost = forumEl('div', { class: 'forum-comments-list' });
      const olderCommentsHost = forumEl('div', { class: 'forum-older-comments-host' });

      function buildReplyCard(comment) {
        const isStaffReply = ['admin', 'teacher', 'assistant'].includes(comment.author_role);
        const isAccepted = Boolean(comment.is_accepted || (post.accepted_comment_id && comment.id === post.accepted_comment_id));
        const replyBody = forumEl('div', { class: 'forum-body forum-reply-body' });
        renderMathText(replyBody, comment.body || '');

        const replyActions = [];
        if (!isArchived && post.can_resolve) {
          replyActions.push(
            forumEl(
              'button',
              {
                type: 'button',
                class: isAccepted ? 'forum-accept-btn is-accepted' : 'forum-accept-btn',
                onclick: async () => {
                  const nextAcceptedId = isAccepted ? null : comment.id;
                  await runModeration(
                    post,
                    { acceptedCommentId: nextAcceptedId },
                    nextAcceptedId ? 'Đã chọn câu trả lời làm Lời giải chuẩn.' : 'Đã bỏ chọn Lời giải chuẩn.'
                  );
                  await renderThreadView(post.id);
                }
              },
              forumSvg('checkCircle', 14),
              forumEl('span', { text: isAccepted ? 'Lời giải chuẩn' : 'Chọn làm lời giải' })
            )
          );
        }

        if (!isArchived && (comment.can_edit || comment.can_delete)) {
          const menuItems = [];
          if (comment.can_edit) {
            menuItems.push({
              label: 'Chỉnh sửa trả lời',
              icon: 'edit',
              onSelect: () => openEditCommentModal(comment, post.id)
            });
          }
          if (comment.can_delete) {
            menuItems.push({
              label: 'Xóa câu trả lời',
              icon: 'trash',
              danger: true,
              dividerBefore: menuItems.length > 0,
              onSelect: () =>
                openConfirmDialog({
                  title: 'Xóa câu trả lời',
                  message: 'Bạn có chắc chắn muốn xóa câu trả lời này? Thao tác không thể hoàn tác.',
                  confirmText: 'Xóa trả lời',
                  onConfirm: async () => {
                    await api(`/api/forum/comments/${encodeURIComponent(comment.id)}/delete`, {
                      method: 'POST',
                      body: {}
                    });
                    onForumMutated?.();
                    status('Đã xóa câu trả lời.', false, 'success');
                    await renderThreadView(post.id);
                  }
                })
            });
          }
          replyActions.push(
            createActionMenu({
              iconOnly: true,
              ariaLabel: 'Tác vụ câu trả lời',
              variant: 'outline',
              items: menuItems
            })
          );
        }

        return forumEl(
          'article',
          {
            id: `forum-reply-${comment.id}`,
            class: `forum-reply-card${isAccepted ? ' is-accepted' : ''}${isStaffReply ? ' is-staff' : ''}`
          },
          isAccepted
            ? forumEl(
                'div',
                { class: 'forum-accepted-ribbon' },
                forumSvg('checkCircle', 15),
                forumEl('span', { text: 'Lời giải chuẩn' })
              )
            : null,
          forumEl(
            'div',
            { class: 'forum-reply-head' },
            buildAuthorBlock({
              name: comment.author_name,
              role: comment.author_role,
              uid: comment.author_uid,
              currentUid,
              timestamp: comment.created_at,
              editedAt: comment.edited_at,
              fmt,
              isAuthorOp: comment.author_uid === post.author_uid
            }),
            replyActions.length ? forumEl('div', { class: 'forum-reply-actions' }, ...replyActions) : null
          ),
          replyBody,
          renderAttachmentBlock(comment, 'comments', token)
        );
      }

      function renderCommentsSection() {
        repliesSectionHeader.querySelector('h3').textContent = `Thảo luận & Lời giải (${loadedComments.length})`;
        if (!loadedComments.length) {
          commentsListHost.replaceChildren(
            forumEl('p', {
              class: 'forum-reply-empty',
              text: 'Chưa có câu trả lời nào. Hãy là người đầu tiên gửi lời giải hoặc gợi ý cho câu hỏi này.'
            })
          );
        } else {
          commentsListHost.replaceChildren(...loadedComments.map(buildReplyCard));
        }

        if (commentsCursor) {
          const olderBtn = btn(
            'Xem trả lời cũ hơn',
            async () => {
              const label = olderBtn.querySelector('span:last-child');
              if (label) label.textContent = 'Đang tải…';
              olderBtn.setAttribute('aria-busy', 'true');
              try {
                const params = new URLSearchParams({
                  beforeCreatedAt: String(commentsCursor.beforeCreatedAt),
                  beforeId: commentsCursor.beforeId
                });
                const older = await api(`/api/forum/posts/${encodeURIComponent(post.id)}/comments?${params}`);
                if (!isAlive(token)) return;
                const existingIds = new Set(loadedComments.map(c => c.id));
                const prepended = (older.items || []).filter(c => c?.id && !existingIds.has(c.id));
                loadedComments = [...prepended, ...loadedComments];
                commentsCursor = older.nextCursor || null;
                renderCommentsSection();
              } catch (err) {
                status(friendly(err), true);
              } finally {
                if (olderBtn.isConnected) {
                  const lbl = olderBtn.querySelector('span:last-child');
                  if (lbl) lbl.textContent = 'Xem trả lời cũ hơn';
                  olderBtn.removeAttribute('aria-busy');
                }
              }
            },
            false,
            'refresh'
          );
          olderCommentsHost.replaceChildren(olderBtn);
        } else {
          olderCommentsHost.replaceChildren();
        }
      }

      renderCommentsSection();

      // Reply composer or locked/archived notice
      let replyComposerBlock = null;
      if (isArchived) {
        replyComposerBlock = forumEl(
          'div',
          { class: 'forum-locked-notice' },
          forumSvg('lock', 16),
          forumEl('span', { text: 'Lớp học đang nằm trong kho lưu trữ — chỉ xem nội dung thảo luận.' })
        );
      } else if (post.locked && !state.effectiveCanModerate) {
        replyComposerBlock = forumEl(
          'div',
          { class: 'forum-locked-notice' },
          forumSvg('lock', 16),
          forumEl('span', { text: 'Chủ đề này đã được giáo viên khóa bình luận.' })
        );
      } else if (state.effectiveCanWrite && commentsRes?.canWrite !== false) {
        const replyForm = forumEl('form', { class: 'forum-composer forum-thread-reply-form' });
        const replyError = forumEl('p', { class: 'form-error', role: 'alert', hidden: true, tabIndex: -1 });
        const replyBodyInput = forumEl('textarea', {
          name: 'body',
          required: true,
          maxLength: 20000,
          placeholder: isStaffView
            ? 'Viết lời giải chi tiết, nhận xét bài làm hoặc gợi ý hướng tư duy cho học sinh…'
            : 'Viết hướng dẫn, trao đổi hoặc gửi ảnh lời giải của bạn…'
        });
        const replyLabel = forumEl(
          'label',
          {},
          forumEl('span', { class: 'field-label' }, 'Gửi câu trả lời mới', forumEl('span', { class: 'required-mark', 'aria-hidden': 'true', text: ' *' })),
          replyBodyInput
        );
        const replyMathEditor = createQuestionMathEditor(replyBodyInput, {
          variant: 'reply',
          label: 'Nội dung trả lời'
        });
        const replyPicker = createForumAttachmentPicker({
          icon,
          registerUrl: registerBlobUrl,
          onError: msg => {
            replyError.textContent = msg;
            replyError.hidden = false;
            replyError.focus();
          }
        });
        replyPicker.attachPasteTarget(replyForm);
        registerCleanup(() => replyPicker.dispose());

        const markSolvedCheckbox =
          state.effectiveCanModerate && !isSolved
            ? forumEl('input', { type: 'checkbox', name: 'markSolved' })
            : null;
        const markSolvedLabel = markSolvedCheckbox
          ? forumEl(
              'label',
              { class: 'forum-check-option' },
              markSolvedCheckbox,
              forumEl('span', { text: 'Đồng thời đánh dấu câu hỏi này đã giải đáp' })
            )
          : null;

        const submitReplyBtn = forumEl('button', { type: 'submit', class: 'primary', text: 'Gửi trả lời' });

        replyForm.append(
          ...[
            replyError,
            replyLabel,
            replyMathEditor,
            replyPicker.node,
            markSolvedLabel,
            forumEl('div', { class: 'forum-submit-row' }, submitReplyBtn)
          ].filter(Boolean)
        );

        replyForm.addEventListener('submit', async ev => {
          ev.preventDefault();
          replyError.hidden = true;
          submitReplyBtn.disabled = true;
          submitReplyBtn.textContent = 'Đang gửi…';
          replyForm.setAttribute('aria-busy', 'true');
          try {
            if (!replyMathEditor.validate()) {
              throw Error('Hãy hoàn tất công thức đang soạn và nhập nội dung trả lời.');
            }
            const att = replyPicker.getState();
            const fd = new FormData();
            fd.set('body', replyBodyInput.value);
            if (att.file) fd.set('file', att.file);

            await api(`/api/forum/posts/${encodeURIComponent(post.id)}/comments`, {
              method: 'POST',
              body: fd
            });

            if (markSolvedCheckbox?.checked) {
              try {
                await api(`/api/forum/posts/${encodeURIComponent(post.id)}/moderate`, {
                  method: 'POST',
                  body: { resolved: true }
                });
              } catch {
                // Non-fatal if moderation call fails after comment succeeded
              }
            }

            replyPicker.reset();
            onForumMutated?.();
            status('Đã gửi câu trả lời.', false, 'success');
            await renderThreadView(post.id);
          } catch (err) {
            replyError.textContent = friendly(err);
            replyError.hidden = false;
            replyError.focus();
          } finally {
            submitReplyBtn.disabled = false;
            submitReplyBtn.textContent = 'Gửi trả lời';
            replyForm.removeAttribute('aria-busy');
          }
        });

        replyComposerBlock = forumEl(
          'section',
          { class: 'forum-thread-reply-box', 'aria-label': 'Soạn câu trả lời mới' },
          replyForm
        );
      }

      const threadShell = forumEl(
        'div',
        { class: 'forum-thread-shell' },
        threadTopbar,
        questionCard,
        acceptedJumpCallout,
        forumEl(
          'section',
          { class: 'forum-thread-replies', 'aria-label': 'Danh sách câu trả lời' },
          repliesSectionHeader,
          olderCommentsHost,
          commentsListHost
        ),
        replyComposerBlock
      );

      root.replaceChildren(threadShell);
    } catch (error) {
      if (isAlive(token)) {
        root.replaceChildren(
          forumEl('p', { class: 'form-error', role: 'alert', text: friendly(error) }),
          forumEl(
            'div',
            { class: 'forum-thread-error-actions' },
            btn('Quay lại diễn đàn', () => openFeed(), false),
            btn('Thử lại', () => renderThreadView(postId), true, 'refresh')
          )
        );
      }
    }
  }

  if (state.activePostId) {
    await renderThreadView(state.activePostId);
  } else {
    await renderFeedView();
  }
}
