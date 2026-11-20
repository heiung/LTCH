// Giao diện Phòng luyện 3 Giai đoạn (THPTQG · HSA · TSA) & Hệ thống Đăng tải Đề Word (.docx)
// Thương hiệu: Lớp Toán Cô Hạnh ([LTCH]) — 100% Light Mode
import { parseForumMath, renderForumFormula } from './forum-math.mjs';
import { tryRenderVariationOrSignTable } from './math-variation-table.mjs';
import { createQuestionMathEditor } from './question-math-editor.mjs';
import { createActionMenu } from './action-menu.mjs';
import { invalidateOpsPracticeStatsCache } from './notices-workspace.mjs';
import { parseWordExamFiles, groupBulkExamSourceFiles, extractBulkExamNumber, normalizeCommandTag } from '../shared/word-exam-parser.mjs';
import { missingPracticeImageIds, practiceImageSource, restorePracticeImages } from '../shared/practice-media.mjs';
import { HSA_COMBINATIONS, checkExamStructure } from '../worker/questions.mjs';
import {
  EXAM_FORM_SPECS,
  normalizeSchoolYearLabel,
  createAiExamGuideCard,
  openAiExamGuideModal
} from './word-exam-ai-guide.mjs';

const SUBJECT_LABELS = {
  physics: 'Vật lí',
  chemistry: 'Hóa học',
  biology: 'Sinh học',
  history: 'Lịch sử',
  geography: 'Địa lí',
  english: 'Tiếng Anh'
};

const SECTION_LABELS = {
  thptqg: {
    all: 'Đề thi môn Toán THPTQG',
    part_1: 'Phần I. Trắc nghiệm 4 phương án',
    part_2: 'Phần II. Trắc nghiệm Đúng / Sai',
    part_3: 'Phần III. Trả lời ngắn'
  },
  hsa: {
    all: 'Đề tổng hợp 3 phần HSA',
    part_1: 'Phần 1: Tư duy Định lượng (Toán học & Xử lý số liệu)',
    part_2: 'Phần 2: Tư duy Định tính (Ngôn ngữ - Văn học)',
    part_3: 'Phần 3: Khoa học / Tiếng Anh'
  },
  tsa: {
    all: 'Đề tổng hợp 3 phần TSA',
    part_1: 'Phần 1: Tư duy Toán học',
    part_2: 'Phần 2: Tư duy Đọc hiểu',
    part_3: 'Phần 3: Tư duy Khoa học / Giải quyết vấn đề'
  }
};

const QUESTION_TYPE_LABELS = {
  single: 'Trắc nghiệm 1 đáp án',
  multiple: 'Chọn nhiều đáp án',
  true_false: 'Đúng / Sai',
  short: 'Trả lời ngắn',
  fill_blank: 'Điền khuyết trong câu',
  drag_drop: 'Kéo thả thẻ đáp án'
};

export function getClientPassageClusterKey(q) {
  if (!q || typeof q !== 'object') return '';
  const sec = String(q.section || 'part_1');
  const subj = String(q.subject || '');
  if (q.clusterId) return `cid:${sec}:${subj}:${q.clusterId}`;
  if (q.passageId) return `pid:${sec}:${subj}:${q.passageId}`;
  const rawPassage = typeof q.passageContent === 'string' ? q.passageContent.trim() : '';
  if (rawPassage) {
    return `ptxt:${sec}:${subj}:${rawPassage.slice(0, 160)}`;
  }
  return '';
}

export function rewriteClientPassageQuestionNumbers(passageText, clusterNumbers, passageIndex = 0) {
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

export function sanitizeClientPromptNumberPrefix(promptText) {
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

export function renumberClientExamQuestions(questions, { examType = 'thptqg', practiceMode = null } = {}) {
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
      nextQ.prompt = sanitizeClientPromptNumberPrefix(nextQ.prompt);
    }
    return nextQ;
  });

  const clusterGroups = new Map();
  let syntheticClusterSeq = 0;
  for (const q of out) {
    if (!q || typeof q !== 'object') continue;
    const cKey = getClientPassageClusterKey(q);
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
        item.passageContent = rewriteClientPassageQuestionNumbers(item.passageContent, nums, scopeIdx);
      }
    }
  }

  return out;
}

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      node.className = v;
    } else if (k === 'text') {
      node.textContent = v;
    } else if (k === 'html') {
      node.innerHTML = v;
    } else if (k in node && k !== 'list' && k !== 'form') {
      node[k] = v;
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c !== null && c !== undefined && c !== false) {
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }
  return node;
}

function createPracticeEntryModal(content, actions, extraClass = '') {
  return h(
    'div',
    { class: `ltch-modal-card ltch-tsa-9s-entry-modal ${extraClass}`.trim() },
    h('div', {
      class: 'ltch-practice-entry-body',
      tabindex: 0,
      role: 'region',
      'aria-label': 'Thông tin và các phần thi'
    }, content),
    h('div', { class: 'ltch-practice-entry-actions' }, actions)
  );
}

function createDocMetaIcon() {
  const wrap = h('span', { class: 'ltch-meta-doc-icon', 'aria-hidden': 'true' });
  wrap.innerHTML =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  return wrap;
}

const PRACTICE_UI_SVGS = {
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 3v4"/><path d="M21 5h-4"/><path d="M5 17v3"/><path d="M6.5 18.5h-3"/>',
  uploadCloud: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><polyline points="9 15 12 12 15 15"/>'
};

function uiIcon(name, size = 16) {
  const paths = PRACTICE_UI_SVGS[name];
  if (!paths) return null;
  const span = h('span', { class: 'ltch-btn-svg-icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return span;
}

function openDeleteExamConfirmModal(examSummary, onConfirmDelete) {
  let busy = false;
  const titleId = `ltch-delete-exam-title-${Date.now()}`;
  const errorBox = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const cancelBtn = h('button', { type: 'button', class: 'ltch-btn ltch-btn-outline' }, 'Hủy');
  const confirmBtn = h('button', { type: 'button', class: 'ltch-btn ltch-btn-danger' }, 'Xóa vĩnh viễn');
  const closeBtn = h('button', { type: 'button', class: 'ltch-modal-close', 'aria-label': 'Đóng hộp thoại' }, '×');

  const cleanupAndClose = () => {
    if (busy) return;
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cleanupAndClose();
    }
  };

  cancelBtn.onclick = cleanupAndClose;
  closeBtn.onclick = cleanupAndClose;

  confirmBtn.onclick = async () => {
    if (busy) return;
    busy = true;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    closeBtn.disabled = true;
    confirmBtn.textContent = 'Đang xóa...';
    errorBox.hidden = true;
    errorBox.textContent = '';
    try {
      await onConfirmDelete();
      busy = false;
      cleanupAndClose();
    } catch (err) {
      busy = false;
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      closeBtn.disabled = false;
      confirmBtn.textContent = 'Xóa vĩnh viễn';
      errorBox.textContent = err?.message || 'Không thể xóa đề thi. Vui lòng thử lại.';
      errorBox.hidden = false;
    }
  };

  const card = h(
    'div',
    {
      class: 'ltch-modal-card ltch-delete-confirm-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      onclick: (e) => e.stopPropagation()
    },
    h(
      'div',
      { class: 'ltch-modal-header' },
      h('h3', { id: titleId, text: 'Xóa đề thi khỏi phòng luyện' }),
      closeBtn
    ),
    h('p', { class: 'ltch-delete-confirm-title', text: examSummary?.title || 'Đề thi đã chọn' }),
    h('p', {
      class: 'ltch-modal-sub',
      text: 'Thao tác này sẽ xóa vĩnh viễn đề thi cùng toàn bộ lượt làm bài và lịch sử liên quan. Không thể khôi phục sau khi xóa.'
    }),
    errorBox,
    h('div', { class: 'ltch-modal-footer' }, cancelBtn, confirmBtn)
  );

  const backdrop = h(
    'div',
    {
      class: 'ltch-modal-backdrop',
      onclick: cleanupAndClose
    },
    card
  );

  document.addEventListener('keydown', onKeyDown);
  document.body.append(backdrop);
  cancelBtn.focus();
}

const COMPACT_PRACTICE_MEDIA = '(max-width: 1024px), (hover: none) and (pointer: coarse)';

function isCompactPracticeLayout() {
  return window.matchMedia(COMPACT_PRACTICE_MEDIA).matches;
}

function createPracticeDeviceNotice(examType, onDismiss = () => {}) {
  if (!['hsa', 'tsa'].includes(String(examType).toLowerCase())) return null;
  const nav = window.navigator;
  const mobileDevice = nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(nav.userAgent || '') ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  if (!isCompactPracticeLayout() && !mobileDevice) return null;
  const notice = h('aside', {class: 'ltch-device-experience-notice', role: 'status'},
    h('p', {}, h('strong', {text: `Gợi ý cho phòng luyện ${String(examType).toUpperCase()}`}),
      h('span', {text: 'Nên sử dụng trình duyệt trên máy tính để có trải nghiệm tốt hơn. Bạn vẫn có thể luyện tập trên điện thoại hoặc máy tính bảng.'})),
    h('button', {type: 'button', text: 'Đã hiểu', 'aria-label': 'Đã hiểu gợi ý sử dụng máy tính', onclick: () => {
      onDismiss();
      notice.remove();
    }})
  );
  return notice;
}

function focusQuestionCard(card) {
  if (!card) return;
  if (isCompactPracticeLayout()) {
    card.tabIndex = -1;
    card.focus({preventScroll: true});
  }
  card.scrollIntoView({behavior: isCompactPracticeLayout() && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
}

function formatDurationClock(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')} : ${String(s).padStart(2, '0')}`;
}

function formatTimeSpentVi(totalSeconds) {
  const sec = Math.max(1, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} giây`;
  return `${m}p ${String(s).padStart(2, '0')}s`;
}

function formatDateTimeVi(ts) {
  if (!ts) return '';
  return new Date(Number(ts)).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function isQuestionAnswered(q, val) {
  if (val === undefined || val === null || val === '') return false;
  if (q.type === 'multiple') return Array.isArray(val) && val.length > 0;
  if (q.type === 'true_false') {
    const m = Array.isArray(q.statements) ? q.statements.length : 1;
    return Array.isArray(val) && val.length === m && val.every((x) => typeof x === 'boolean');
  }
  if (q.type === 'fill_blank') {
    const cnt = q.blankCount || (Array.isArray(q.blanks) ? q.blanks.length : 1);
    return Array.isArray(val) && val.length >= cnt && val.slice(0, cnt).every((x) => String(x ?? '').trim() !== '');
  }
  if (q.type === 'drag_drop') {
    const cnt = q.slotCount || (Array.isArray(q.answer) ? q.answer.length : 1);
    return Array.isArray(val) && val.length >= cnt && val.slice(0, cnt).every((x) => String(x ?? '').trim() !== '');
  }
  return String(val).trim() !== '';
}

function isQuestionPartiallyAnswered(q, val) {
  if (val === undefined || val === null || val === '') return false;
  if (Array.isArray(val)) return val.some((x) => x !== null && x !== undefined && String(x).trim() !== '');
  return String(val).trim() !== '';
}

// Render một chuỗi văn bản có chứa **in đậm**, //in nghiêng//, __gạch chân__, [[img:id]], và LaTeX $...$
function appendFormattedMaskedText(target, text, mathParts, mediaMap, renderedMediaIds, markerOpen, markerClose, allowImageZoom = true) {
  const escOpen = markerOpen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escClose = markerClose.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markerRe = new RegExp(`${escOpen}(\\d+)${escClose}`, 'g');
  const appendPlainWithMath = (dest, plain) => {
    if (!plain) return;
    if (!mathParts.length) {
      dest.append(document.createTextNode(plain));
      return;
    }
    let last = 0;
    let mm;
    markerRe.lastIndex = 0;
    while ((mm = markerRe.exec(plain)) !== null) {
      if (mm.index > last) dest.append(document.createTextNode(plain.slice(last, mm.index)));
      const part = mathParts[Number(mm[1])];
      if (part) {
        const span = document.createElement('span');
        span.className = part.display ? 'forum-math-display' : 'forum-math-inline';
        try {
          span.innerHTML = renderForumFormula(part.latex, part.display);
        } catch {
          span.classList.add('forum-math-invalid');
          span.textContent = part.raw;
        }
        dest.append(span);
      }
      last = mm.index + mm[0].length;
    }
    if (last < plain.length) dest.append(document.createTextNode(plain.slice(last)));
  };

  // Xử lý **đậm**, //nghiêng//, __gạch chân__, <u>, <sup>, <sub>, [[img:id]], và đoạn [1], [2]
  const tokenRe = /(\*\*[^*]+\*\*|(?<![:/])\/\/[^/\r\n]+\/\/|__[^_]+__|<(strong|em|u|sup|sub)>[\s\S]*?<\/\2>|\[\[(?:IMAGE|img):[^\]]+\]\]|\[\d{1,2}\])/gi;
  let lastIdx = 0;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    if (m.index > lastIdx) {
      appendPlainWithMath(target, text.slice(lastIdx, m.index));
    }
    const tok = m[0];
    if (tok.startsWith('**') && tok.endsWith('**')) {
      const el = h('strong');
      appendFormattedMaskedText(el, tok.slice(2, -2), mathParts, mediaMap, renderedMediaIds, markerOpen, markerClose, allowImageZoom);
      target.append(el);
    } else if (tok.startsWith('//') && tok.endsWith('//')) {
      const el = h('em');
      appendFormattedMaskedText(el, tok.slice(2, -2), mathParts, mediaMap, renderedMediaIds, markerOpen, markerClose, allowImageZoom);
      target.append(el);
    } else if (tok.startsWith('__') && tok.endsWith('__')) {
      const el = h('u');
      appendFormattedMaskedText(el, tok.slice(2, -2), mathParts, mediaMap, renderedMediaIds, markerOpen, markerClose, allowImageZoom);
      target.append(el);
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const el = h(tag);
      appendFormattedMaskedText(el, tok.slice(tag.length + 2, -(tag.length + 3)), mathParts, mediaMap, renderedMediaIds, markerOpen, markerClose, allowImageZoom);
      target.append(el);
    } else if (/^\[\[(?:IMAGE|img):([^\]]+)\]\]$/i.test(tok)) {
      const imgId = tok.replace(/^\[\[(?:IMAGE|img):/i, '').replace(/\]\]$/, '').trim();
      if (renderedMediaIds) renderedMediaIds.add(imgId);
      target.append(createMediaFigure(mediaMap?.get(imgId), { allowZoom: allowImageZoom }) || h('span', { class: 'meta', text: 'Thiếu hình minh họa' }));
    } else if (/^\[\d{1,2}\]$/.test(tok)) {
      target.append(h('strong', { class: 'ltch-para-ref', text: tok }));
    } else {
      appendPlainWithMath(target, tok);
    }
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < text.length) {
    appendPlainWithMath(target, text.slice(lastIdx));
  }
}

export function appendFormattedInlineMath(target, rawSegment, mediaList = [], renderedMediaIds = null, options = {}) {
  const mediaMap = Array.isArray(mediaList) && mediaList.length
    ? new Map(mediaList.map((m) => [m.id, m]))
    : null;
  const rawStr = String(rawSegment || '');
  const parts = parseForumMath(rawStr, Infinity);
  const mathParts = [];
  let markerOpen = '\uE000M';
  let markerClose = '\uE001';
  while (rawStr.includes(markerOpen)) markerOpen += 'X';
  while (rawStr.includes(markerClose)) markerClose += 'Y';
  let masked = '';
  for (const part of parts) {
    if (part.type === 'math') {
      const idx = mathParts.length;
      mathParts.push(part);
      masked += `${markerOpen}${idx}${markerClose}`;
    } else {
      masked += part.value;
    }
  }
  const allowImageZoom = options?.allowImageZoom !== false;
  appendFormattedMaskedText(target, masked, mathParts, mediaMap, renderedMediaIds, markerOpen, markerClose, allowImageZoom);
}

const SAFE_TABLE_INLINE_TAGS = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  u: 'u',
  sup: 'sup',
  sub: 'sub'
};

function appendSafeTableCellNodes(target, sourceNode, mediaList, renderedMediaIds, options = {}) {
  if (!sourceNode) return;
  let textBuf = '';
  const flushText = () => {
    if (!textBuf) return;
    appendFormattedInlineMath(target, textBuf, mediaList, renderedMediaIds, options);
    textBuf = '';
  };

  for (const child of sourceNode.childNodes) {
    if (child.nodeType === 3) {
      textBuf += child.textContent || '';
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object') continue;
    if (tag === 'br') {
      flushText();
      target.append(document.createElement('br'));
      continue;
    }
    const mappedTag = SAFE_TABLE_INLINE_TAGS[tag];
    if (mappedTag) {
      flushText();
      const el = h(mappedTag);
      appendSafeTableCellNodes(el, child, mediaList, renderedMediaIds, options);
      target.append(el);
      continue;
    }
    if (tag === 'p' || tag === 'div') {
      flushText();
      if (target.childNodes.length && target.lastChild?.tagName?.toLowerCase() !== 'br') {
        target.append(document.createElement('br'));
      }
      appendSafeTableCellNodes(target, child, mediaList, renderedMediaIds, options);
      continue;
    }
    flushText();
    appendSafeTableCellNodes(target, child, mediaList, renderedMediaIds, options);
  }
  flushText();
}

function wrapScrollablePracticeTable(table) {
  const scroller = h('div', { class: 'ltch-table-scroll' }, table);
  const view = document.defaultView;
  if (!view?.customElements || !view.ResizeObserver) return scroller;
  const elementName = 'ltch-scrollable-table';
  if (!view.customElements.get(elementName)) {
    view.customElements.define(elementName, class extends view.HTMLElement {
      connectedCallback() {
        const scroller = this.firstElementChild;
        const hint = this.lastElementChild;
        this.resizeObserver = new view.ResizeObserver(() => {
          const overflows = scroller.scrollWidth > scroller.clientWidth + 1;
          hint.hidden = !overflows;
          if (overflows) {
            scroller.tabIndex = 0;
            scroller.setAttribute('role', 'region');
            scroller.setAttribute('aria-label', 'Bảng dữ liệu, có thể cuộn ngang');
          } else {
            scroller.removeAttribute('tabindex');
            scroller.removeAttribute('role');
            scroller.removeAttribute('aria-label');
          }
        });
        this.resizeObserver.observe(scroller);
        this.resizeObserver.observe(scroller.firstElementChild);
      }

      disconnectedCallback() {
        this.resizeObserver.disconnect();
      }
    });
  }
  return h(elementName, { class: elementName },
    scroller,
    h('div', { class: 'ltch-table-scroll-hint', hidden: true, 'aria-hidden': 'true', text: '↔ Cuộn ngang để xem đủ các cột' })
  );
}

export function renderSafeTableElement(tableHtml, mediaList = [], renderedMediaIds = null, options = {}) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(tableHtml, 'text/html');
  const srcTable = doc.querySelector('table');
  if (!srcTable) return h('div', { text: tableHtml });
  const mathWidget = tryRenderVariationOrSignTable(srcTable);
  if (mathWidget) return wrapScrollablePracticeTable(mathWidget);

  const tableEl = h('table', { class: 'ltch-content-table' });
  const rows = srcTable.querySelectorAll('tr');
  rows.forEach((tr, rIdx) => {
    const trEl = h('tr');
    const cells = tr.querySelectorAll('th, td');
    cells.forEach((cell) => {
      const tag = cell.tagName.toLowerCase() === 'th' || rIdx === 0 ? 'th' : 'td';
      const cellEl = h(tag);
      const colSpan = Number.parseInt(cell.getAttribute('colspan') || '1', 10);
      const rowSpan = Number.parseInt(cell.getAttribute('rowspan') || '1', 10);
      if (Number.isFinite(colSpan) && colSpan > 1) cellEl.setAttribute('colspan', String(Math.min(24, colSpan)));
      if (Number.isFinite(rowSpan) && rowSpan > 1) cellEl.setAttribute('rowspan', String(Math.min(50, rowSpan)));
      appendSafeTableCellNodes(cellEl, cell, mediaList, renderedMediaIds, options);
      trEl.append(cellEl);
    });
    tableEl.append(trEl);
  });
  return wrapScrollablePracticeTable(tableEl);
}

export function openPracticeImageLightbox(src, altText = 'Hình minh họa câu hỏi') {
  if (!src) return;
  const prevActive = document.activeElement;
  let zoomed = false;

  const imgEl = h('img', {
    src,
    alt: altText,
    class: 'ltch-img-lightbox-img'
  });

  const zoomBtn = h('button', {
    type: 'button',
    class: 'ltch-img-lightbox-zoom-btn',
    'aria-pressed': 'false',
    text: 'Phóng to 100%'
  });

  const toggleZoom = () => {
    zoomed = !zoomed;
    imgEl.classList.toggle('is-zoomed', zoomed);
    zoomBtn.setAttribute('aria-pressed', String(zoomed));
    zoomBtn.textContent = zoomed ? 'Thu gọn vừa màn hình' : 'Phóng to 100%';
  };

  zoomBtn.addEventListener('click', toggleZoom);
  imgEl.addEventListener('click', toggleZoom);

  const closeBtn = h('button', {
    type: 'button',
    class: 'ltch-img-lightbox-close-btn',
    'aria-label': 'Đóng xem hình phóng to',
    text: 'Đóng'
  });

  const backdrop = h(
    'div',
    {
      class: 'ltch-img-lightbox-backdrop',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Xem phóng to hình ảnh'
    },
    h(
      'div',
      { class: 'ltch-img-lightbox-dialog', onclick: (e) => e.stopPropagation() },
      h(
        'div',
        { class: 'ltch-img-lightbox-toolbar' },
        h('span', { class: 'ltch-img-lightbox-hint', text: 'Bấm vào hình để phóng to kích thước gốc' }),
        h('div', { class: 'ltch-img-lightbox-actions' }, zoomBtn, closeBtn)
      ),
      h('div', { class: 'ltch-img-lightbox-stage' }, imgEl)
    )
  );

  const cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    if (prevActive && typeof prevActive.focus === 'function' && prevActive.isConnected) {
      prevActive.focus();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  };

  closeBtn.addEventListener('click', cleanup);
  backdrop.addEventListener('click', cleanup);
  document.addEventListener('keydown', onKeyDown);
  document.body.append(backdrop);
  closeBtn.focus();
}

function createMediaFigure(mediaItem, { allowZoom = true } = {}) {
  const src = practiceImageSource(mediaItem);
  if (!src) return null;
  const imgProps = {
    src,
    alt: 'Hình minh họa câu hỏi',
    loading: 'lazy',
    decoding: 'async',
    class: allowZoom ? 'ltch-q-image is-zoomable' : 'ltch-q-image'
  };
  if (allowZoom) {
    imgProps.tabIndex = 0;
    imgProps.role = 'button';
    imgProps.title = 'Bấm để phóng to hình ảnh';
    imgProps['aria-label'] = 'Phóng to hình minh họa';
    imgProps.onclick = (e) => {
      e.stopPropagation();
      openPracticeImageLightbox(src, imgProps.alt);
    };
    imgProps.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        openPracticeImageLightbox(src, imgProps.alt);
      }
    };
  }
  const img = h('img', {
    ...imgProps,
    onerror: () => img.replaceWith(h('span', { class: 'meta', text: 'Không tải được hình minh họa' }))
  });
  return h('figure', { class: 'ltch-q-figure' }, img);
}

function* splitMathParagraphs(text) {
  let paragraph = '';
  for (const part of parseForumMath(text, Infinity)) {
    if (part.type === 'math') {
      paragraph += part.raw;
      continue;
    }
    const lines = part.value.split(/\n+/);
    paragraph += lines[0];
    for (const line of lines.slice(1)) {
      if (paragraph.trim()) yield paragraph.trim();
      paragraph = line;
    }
  }
  if (paragraph.trim()) yield paragraph.trim();
}

// Render toàn bộ đoạn nội dung (có thể chứa bảng <table>, [[img:id]] / [[IMAGE:id]], dòng mới và LaTeX)
export function renderRichMathBlock(container, rawText, mediaList = [], options = {}) {
  container.replaceChildren();
  const text = String(rawText || '');
  const allowImageZoom = options.allowImageZoom !== false;
  const renderedMediaIds = new Set();
  for (const field of options.otherMediaFields || []) {
    for (const match of String(field || '').matchAll(/\[\[(?:IMAGE|img):([^\]]+)\]\]/gi)) {
      renderedMediaIds.add(match[1].trim());
    }
  }

  // Tách các khối <table>...</table>
  const blockRe = /(<table[\s\S]*?<\/table>)/gi;
  const segments = text.split(blockRe);

  for (const seg of segments) {
    if (!seg) continue;
    if (/^<table[\s\S]*<\/table>$/i.test(seg.trim())) {
      container.append(renderSafeTableElement(seg, mediaList, renderedMediaIds, { allowImageZoom }));
      continue;
    }

    for (const line of splitMathParagraphs(seg)) {
      const p = h('div', { class: 'ltch-rich-line' });

      appendFormattedInlineMath(p, line, mediaList, renderedMediaIds, { allowImageZoom });
      container.append(p);
    }
  }

  // Hiển thị các hình ảnh đính kèm chưa có thẻ [[img:id]] trong lời dẫn
  if (options.appendUnreferenced !== false) {
    const onlySolution = Boolean(options.onlySolutionMedia);
    for (const m of mediaList || []) {
      if (!m || !m.id || renderedMediaIds.has(m.id)) continue;
      if (onlySolution && !m.inSolution) continue;
      if (!onlySolution && m.inSolution) continue;
      const fig = createMediaFigure(m, { allowZoom: allowImageZoom });
      if (fig) container.append(fig);
    }
  }
}

// Render câu hỏi có ô trống {{1}}, {{2}} ngay trong dòng văn bản (cho Điền khuyết & Kéo thả TSA)
export function renderInteractivePromptWithBlanks(container, question, currentResponse, onSlotChange, options = {}) {
  container.replaceChildren();
  const text = String(question.prompt || '');
  const mediaList = question.media || [];
  const mediaMap = new Map(mediaList.map((m) => [m.id, m]));
  const renderedMediaIds = new Set();
  for (const label of question.cards || []) {
    for (const match of String(label).matchAll(/\[\[(?:IMAGE|img):([^\]]+)\]\]/gi)) {
      renderedMediaIds.add(match[1].trim());
    }
  }

  const isDragDrop = question.type === 'drag_drop';
  const cards = Array.isArray(question.cards) ? question.cards : [];
  const slotCount =
    question.blankCount ||
    question.slotCount ||
    (Array.isArray(question.blanks) ? question.blanks.length : 0) ||
    (Array.isArray(question.answer) ? question.answer.length : 1);

  const values = Array.isArray(currentResponse)
    ? [...currentResponse]
    : Array.from({ length: slotCount }, () => '');
  while (values.length < slotCount) values.push('');

  const segments = text.split(/(<table[\s\S]*?<\/table>)/gi);
  for (const seg of segments) {
    if (!seg) continue;
    if (/^<table[\s\S]*<\/table>$/i.test(seg.trim())) {
      container.append(renderSafeTableElement(seg.trim(), mediaList, renderedMediaIds));
      continue;
    }

    for (const paragraph of splitMathParagraphs(seg)) {
      const trimmed = parseForumMath(paragraph, Infinity).map(part => {
        if (part.type === 'text') return part.value;
        const fragments = part.latex.split(/(\{\{\s*\d{1,2}\s*\}\})/);
        if (fragments.length === 1) return part.raw;
        return fragments.map((fragment, index) =>
          index % 2 || !fragment.trim() ? fragment : `\\(${fragment}\\)`
        ).join('');
      }).join('');
      const lineEl = h('div', { class: 'ltch-rich-line ltch-inline-slots-line' });
    const slotRe = /\{\{\s*(\d{1,2})\s*\}\}|\[\[(?:IMAGE|img):([^\]]+)\]\]/gi;
    let lastIdx = 0;
    let m;

    while ((m = slotRe.exec(trimmed)) !== null) {
      if (m.index > lastIdx) {
        appendFormattedInlineMath(lineEl, trimmed.slice(lastIdx, m.index), mediaList, renderedMediaIds);
      }
      if (m[2]) {
        const imgId = m[2].trim();
        renderedMediaIds.add(imgId);
        const fig = createMediaFigure(mediaMap.get(imgId));
        lineEl.append(fig || h('span', { class: 'meta', text: 'Thiếu hình minh họa' }));
      } else {
        const slotNum = Math.max(1, Number(m[1]));
        const slotIdx = slotNum - 1;
        const curVal = values[slotIdx] || '';

        if (options.readOnly) {
          lineEl.append(h('strong', { text: `[Ô ${slotNum}]` }));
        } else if (!isDragDrop) {
          // Ô nhập điền khuyết trực tiếp trong câu
          const inp = h('input', {
            type: 'text',
            class: `ltch-inline-blank-input${curVal ? ' is-filled' : ''}`,
            value: curVal,
            placeholder: 'Nhập đáp án',
            'aria-label': `Ô trống ${slotNum}`,
            oninput: (e) => {
              const next = [...values];
              next[slotIdx] = e.target.value;
              values[slotIdx] = e.target.value;
              inp.classList.toggle('is-filled', Boolean(e.target.value.trim()));
              onSlotChange(next);
            }
          });
          lineEl.append(inp);
        } else {
          // Ô thả thẻ kéo thả (hỗ trợ cả Kéo-Thả HTML5 lẫn Chạm-Chọn trên điện thoại)
          const cardIdx = /^T(\d{1,2})$/i.exec(curVal) ? Number(RegExp.$1) - 1 : -1;
          const cardText = cardIdx >= 0 && cards[cardIdx] ? cards[cardIdx] : '';

          const dropSlot = h('button', {
            type: 'button',
            class: `ltch-drag-slot${cardText ? ' is-filled' : ''}${options.activeCardToken ? ' is-awaiting-drop' : ''}`,
            'data-slot-index': String(slotIdx),
            'aria-label': cardText ? null : `Ô thả thẻ ${slotNum}`,
            ondragover: (e) => {
              e.preventDefault();
              dropSlot.classList.add('is-dragover');
            },
            ondragleave: () => {
              dropSlot.classList.remove('is-dragover');
            },
            ondrop: (e) => {
              e.preventDefault();
              dropSlot.classList.remove('is-dragover');
              const token = e.dataTransfer?.getData('text/plain') || '';
              if (!/^T\d{1,2}$/i.test(token)) return;
              const next = values.map((v, idx) => (v === token && idx !== slotIdx ? '' : v));
              next[slotIdx] = token.toUpperCase();
              onSlotChange(next);
            },
            onclick: () => {
              const pickedToken = options.getSelectedCardToken?.();
              if (pickedToken) {
                const next = values.map((v, idx) => (v === pickedToken && idx !== slotIdx ? '' : v));
                next[slotIdx] = pickedToken;
                options.clearSelectedCardToken?.();
                onSlotChange(next);
              } else if (curVal) {
                // Nhấn vào ô đã điền để gỡ thẻ trả về kho
                const next = [...values];
                next[slotIdx] = '';
                onSlotChange(next);
              }
            }
          });

          if (cardText) {
            const labelSpan = h('span', { class: 'ltch-drag-slot-content' });
            appendFormattedInlineMath(labelSpan, cardText, mediaList, renderedMediaIds, { allowImageZoom: false });
            dropSlot.append(
              h('span', { class: 'ltch-drag-slot-num', text: `(${slotNum})` }),
              labelSpan,
              h('span', { class: 'ltch-drag-slot-clear', title: 'Gỡ thẻ', text: '×' })
            );
          } else {
            dropSlot.append(
              h('span', {
                class: 'ltch-drag-slot-placeholder',
                text: 'Kéo thả đáp án vào ô này'
              })
            );
          }
          lineEl.append(dropSlot);
        }
      }
      lastIdx = m.index + m[0].length;
    }

      if (lastIdx < trimmed.length) {
        appendFormattedInlineMath(lineEl, trimmed.slice(lastIdx), mediaList, renderedMediaIds);
      }
      container.append(lineEl);
    }
  }

  for (const m of mediaList) {
    if (m && m.id && !m.inSolution && !renderedMediaIds.has(m.id)) {
      const fig = createMediaFigure(m);
      if (fig) container.append(fig);
    }
  }
}

// Tạo lớp phủ Watermark chéo chống chụp màn hình (lưới 3x2 trên desktop/tablet, 2x3 trên mobile)
export function createWatermarkLayer(access) {
  const code = access?.studentCode || 'LTCH';
  const name = access?.displayName || 'Học sinh LTCH';
  const stamp = `LTCH - ${code} - ${name}`;
  const layer = h('div', { class: 'ltch-exam-watermark', 'aria-hidden': 'true' });
  for (let i = 0; i < 6; i++) {
    layer.append(h('span', { class: 'ltch-exam-watermark-item', text: stamp }));
  }
  return layer;
}

// Hộp thoại Báo lỗi câu hỏi (#LTCH-xxxx)
function openReportQuestionModal({ api, status, attemptId, examId, question }) {
  const qCode = question.questionCode || `Q-${question.displayNumber || 1}`;
  const backdrop = h('div', { class: 'ltch-modal-backdrop' });
  const noteInput = h('textarea', {
    class: 'ltch-input ltch-textarea',
    rows: 4,
    maxLength: 2000,
    placeholder: 'Mô tả chi tiết lỗi bạn phát hiện (VD: công thức hiển thị thiếu, đáp án chưa khớp, hình vẽ mờ...)'
  });
  const errEl = h('p', { class: 'form-error', hidden: true });
  const submitBtn = h('button', { type: 'submit', class: 'ltch-btn ltch-btn-primary', text: 'Gửi báo lỗi' });
  const cancelBtn = h(
    'button',
    {
      type: 'button',
      class: 'ltch-btn ltch-btn-ghost',
      onclick: () => backdrop.remove()
    },
    'Hủy'
  );

  const form = h(
    'form',
    {
      class: 'ltch-modal-card',
      onsubmit: async (e) => {
        e.preventDefault();
        const note = noteInput.value.trim();
        if (!note) {
          errEl.textContent = 'Vui lòng nhập nội dung báo lỗi.';
          errEl.hidden = false;
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Đang gửi...';
        errEl.hidden = true;
        try {
          await api('/api/practice/report-error', {
            method: 'POST',
            body: {
              attemptId,
              examId,
              questionId: question.id,
              questionCode: qCode,
              note
            }
          });
          backdrop.remove();
          status(`Đã gửi báo lỗi cho câu ${question.displayNumber || ''} (#${qCode}). Cảm ơn bạn!`, false, 'success');
        } catch (err) {
          errEl.textContent = err?.message || 'Không thể gửi báo lỗi. Vui lòng thử lại.';
          errEl.hidden = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Gửi báo lỗi';
        }
      }
    },
    h(
      'div',
      { class: 'ltch-modal-header' },
      h('h3', { text: `Báo lỗi Câu ${question.displayNumber || ''} · Mã #${qCode}` }),
      h('button', { type: 'button', class: 'ltch-modal-close', onclick: () => backdrop.remove(), text: '×' })
    ),
    h(
      'div',
      { class: 'ltch-modal-body' },
      h(
        'p',
        {
          class: 'meta',
          text: 'Hệ thống sẽ đính kèm mã định danh câu hỏi và phiên bản hiện tại để Giáo viên kiểm tra và cập nhật chính xác.'
        }
      ),
      errEl,
      noteInput
    ),
    h('div', { class: 'ltch-modal-footer' }, cancelBtn, submitBtn)
  );

  backdrop.append(form);
  document.body.append(backdrop);
  noteInput.focus();
}

// ============================================================================
// GIAI ĐOẠN 3: TRANG KẾT QUẢ & LỜI GIẢI CHI TIẾT (2 CỘT CHUẨN 9STUDY)
// ============================================================================
export function mountResultReviewOverlay({
  resultData,
  access,
  api,
  status,
  onRetakeExam,
  onCloseToLobby,
  showHsaSummaryFirst = false
}) {
  const existing = document.getElementById('ltch-practice-fullscreen-root');
  if (existing) existing.remove();

  const overlay = h('div', {
    id: 'ltch-practice-fullscreen-root',
    class: 'ltch-exam-fullscreen-overlay is-result-mode'
  });
  document.body.append(overlay);
  document.body.classList.add('ltch-exam-body-lock');

  const cleanupAndClose = () => {
    overlay.remove();
    document.body.classList.remove('ltch-exam-body-lock');
    if (typeof onCloseToLobby === 'function') onCloseToLobby();
  };

  let currentData = resultData;
  let showingHsaTable = Boolean(showHsaSummaryFirst && currentData.examType === 'hsa');
  let activeLeftTab = 'overview'; // 'overview' | 'by_type'
  let activeRightFilter = 'all'; // 'all' | 'correct' | 'wrong' | 'skipped'

  function render() {
    overlay.replaceChildren();
    overlay.append(createWatermarkLayer(access));

    if (showingHsaTable) {
      // Màn hình KẾT QUẢ HOÀN THÀNH BÀI THI chuẩn 9Study HSA (ĐHQGHN)
      const secMap = new Map((currentData.sectionSummary || []).map((s) => [s.section, s]));
      const p1 = secMap.get('part_1');
      const p2 = secMap.get('part_2');
      const p3 = secMap.get('part_3');

      const nameWords = String(access?.displayName || 'Học sinh').trim().split(/\s+/);
      const avatarInitials =
        nameWords.length >= 2
          ? `${nameWords[0][0] || ''}${nameWords[nameWords.length - 1][0] || ''}`.toUpperCase()
          : String(nameWords[0] || 'HS').slice(0, 2).toUpperCase();

      const totalQuestionsCount =
        (p1?.total || 0) + (p2?.total || 0) + (p3?.total || 0) ||
        (Array.isArray(currentData.questions) ? currentData.questions.length : 150);
      const totalPct =
        currentData.max > 0 ? ((Number(currentData.score || 0) / Number(currentData.max)) * 100).toFixed(1) : '0.0';

      const buildPartRow = (label, partData) => {
        if (!partData) return null;
        const pct = partData.max > 0 ? ((Number(partData.earned || 0) / Number(partData.max)) * 100).toFixed(1) : '0.0';
        return h(
          'tr',
          {},
          h('td', { class: 'is-left', text: label }),
          h('td', { text: String(partData.total || 50) }),
          h('td', { text: `${partData.earned ?? 0}/${partData.max ?? 50}` }),
          h('td', { text: `${pct}%` })
        );
      };

      const p3ComboObj = HSA_COMBINATIONS.find(
        (c) => c.code.toUpperCase() === String(currentData.selectedCombination || '').toUpperCase()
      );
      const p3Label =
        String(currentData.selectedCombination || '').toLowerCase() === 'english'
          ? 'Phần 3: Tiếng Anh'
          : `Phần 3: Khoa học${p3ComboObj ? ` (${p3ComboObj.name})` : ''}`;

      const hsaTopBar = h(
        'header',
        {
          class: 'ltch-hsa-9s-topbar',
          style: 'width:100%;min-width:100%;align-self:stretch;box-sizing:border-box;'
        },
        h(
          'div',
          { class: 'ltch-hsa-9s-topbar-left' },
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-hsa-9s-check-btn',
              title: 'Đóng bài thi',
              onclick: cleanupAndClose
            },
            '✓'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-hsa-9s-top-exit-btn',
              title: 'Thoát ra để chọn phần thi khác hoặc quay về phòng luyện',
              onclick: () => {
                overlay.remove();
                document.body.classList.remove('ltch-exam-body-lock');
                if (typeof onRetakeExam === 'function') onRetakeExam();
                else if (typeof onCloseToLobby === 'function') onCloseToLobby();
              }
            },
            '← Thoát / Đổi phần thi'
          )
        ),
        h(
          'div',
          { class: 'ltch-hsa-9s-topbar-center' },
          h('div', {
            class: 'ltch-hsa-9s-top-title',
            text: String(currentData.examTitle || '[LTCH] ĐỀ THI THỬ ĐÁNH GIÁ NĂNG LỰC HSA').toUpperCase()
          })
        ),
        h(
          'div',
          { class: 'ltch-hsa-9s-topbar-right' },
          h('span', { class: 'ltch-hsa-9s-avatar', text: avatarInitials })
        )
      );

      const summaryWrap = h(
        'div',
        {
          class: 'ltch-hsa-summary-screen',
          style: 'width:100%;min-width:100%;align-items:stretch;justify-content:flex-start;padding:0;'
        },
        hsaTopBar,
        h(
          'div',
          { class: 'ltch-hsa-summary-card' },
          h('h2', { class: 'ltch-hsa-9s-res-heading', text: 'KẾT QUẢ HOÀN THÀNH BÀI THI' }),
          h(
            'div',
            { class: 'ltch-hsa-9s-res-candidate' },
            h('span', {}, 'Họ và tên: ', h('strong', { text: access?.displayName || 'Học sinh' })),
            h('span', {}, 'Mã số: ', h('strong', { text: access?.studentCode || currentData.uid || '20260001' })),
            h('span', {}, 'SBD: ', h('strong', { text: '1' }))
          ),
          h('div', {
            class: 'ltch-hsa-9s-res-rawscore',
            text: `Điểm gốc: ${currentData.score}/${currentData.max}`
          }),
          h('h3', { class: 'ltch-hsa-9s-res-subheading', text: 'DIỄN GIẢI CHI TIẾT' }),
          h(
            'table',
            { class: 'ltch-hsa-summary-table' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', { class: 'is-left', text: 'Phần thi' }),
                h('th', { text: 'Số câu' }),
                h('th', { text: 'Điểm gốc' }),
                h('th', { text: '% đạt' })
              )
            ),
            h(
              'tbody',
              {},
              buildPartRow('Phần 1: Tư duy Định lượng', p1),
              buildPartRow('Phần 2: Tư duy Định tính', p2),
              buildPartRow(p3Label, p3),
              h(
                'tr',
                { class: 'is-total-row' },
                h('td', { class: 'is-left', text: 'Tổng' }),
                h('td', { text: String(totalQuestionsCount) }),
                h('td', { text: `${currentData.score}/${currentData.max}` }),
                h('td', { text: `${totalPct}%` })
              )
            )
          ),
          h(
            'div',
            { class: 'ltch-hsa-9s-res-notes' },
            h('p', { text: 'Vui lòng giữ nguyên giao diện này và đợi ký nhận nộp bài.' }),
            h('p', {
              text: 'Sau ký nhận nộp bài, bạn có thể đóng bài thi bằng việc bấm nút <Đã ký nhận nộp bài. Đóng bài thi>.'
            }),
            h('p', {
              class: 'is-bold',
              text: 'Bạn chỉ được rời khỏi phòng thi khi cán bộ coi thi cho phép.'
            })
          ),
          h(
            'div',
            { class: 'ltch-hsa-summary-actions' },
            h(
              'button',
              {
                type: 'button',
                class: 'ltch-hsa-9s-res-btn is-review',
                onclick: () => {
                  showingHsaTable = false;
                  render();
                }
              },
              'Xem lại bài thi (ở một tab khác)'
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'ltch-hsa-9s-res-btn is-close',
                onclick: cleanupAndClose
              },
              'Đã ký nhận nộp bài. Đóng bài thi.'
            )
          )
        )
      );
      overlay.append(summaryWrap);
      return;
    }

    const results = Array.isArray(currentData.results) ? currentData.results : [];
    const questions = renumberClientExamQuestions(
      Array.isArray(currentData.questions) ? currentData.questions : [],
      {
        examType: currentData.examType,
        practiceMode: currentData.practiceMode
      }
    );
    const resultByQId = new Map(results.map((r) => [r.id, r]));

    const correctCount = results.filter((r) => r.answered && r.correct).length;
    const wrongCount = results.filter((r) => r.answered && !r.correct).length;
    const skippedCount = results.filter((r) => !r.answered).length;
    const scorePct = currentData.max > 0 ? Math.min(100, Math.round((currentData.score / currentData.max) * 100)) : 0;

    // Header trên cùng
    const topBar = h(
      'header',
      { class: `ltch-result-topbar is-${currentData.examType || 'thptqg'}` },
      h(
        'div',
        { class: 'ltch-result-topbar-left' },
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-ghost',
            onclick: cleanupAndClose
          },
          '← Quay về Sảnh đề'
        ),
        h('span', { class: `ltch-brand-pill is-${String(currentData.examType || 'thptqg').toLowerCase()}`, text: `[LTCH] ${(currentData.examType || 'THPTQG').toUpperCase()}` }),
        h('h1', { class: 'ltch-result-exam-title', text: currentData.examTitle || 'Kết quả bài thi' })
      ),
      h(
        'div',
        { class: 'ltch-result-topbar-right' },
        Array.isArray(currentData.history) && currentData.history.length > 1
          ? h(
              'select',
              {
                class: 'ltch-select',
                'aria-label': 'Chọn lần làm bài để xem lại',
                onchange: async (e) => {
                  const nextAttId = e.target.value;
                  if (!nextAttId || nextAttId === currentData.attemptId) return;
                  try {
                    status('Đang tải kết quả lần làm bài...', false, 'loading');
                    const loaded = await api(`/api/practice/exams/${currentData.examId}/attempts/${nextAttId}`);
                    status('');
                    currentData = loaded;
                    render();
                  } catch (err) {
                    status(err?.message || 'Không tải được lần làm bài.', true);
                  }
                }
              },
              ...currentData.history.map((hItem) =>
                h('option', {
                  value: hItem.attemptId,
                  selected: hItem.attemptId === currentData.attemptId,
                  text: `Lần ${hItem.attemptNo}: ${hItem.score}/${hItem.max} điểm (${formatDateTimeVi(hItem.submittedAt)})`
                })
              )
            )
          : null,
        onRetakeExam
          ? h(
              'button',
              {
                type: 'button',
                class: 'ltch-btn ltch-btn-primary',
                onclick: () => {
                  overlay.remove();
                  document.body.classList.remove('ltch-exam-body-lock');
                  onRetakeExam();
                }
              },
              'Làm lại đề này'
            )
          : null
      )
    );

    // Cột trái: Vòng tròn điểm + 4 chỉ số + Tabs (Tổng quan / Theo dạng câu) + Tiến độ câu + Phổ điểm
    const strokeDash = `${scorePct}, 100`;
    const leftPanel = h(
      'aside',
      { class: 'ltch-result-left-col' },
      h(
        'div',
        { class: 'ltch-result-score-card' },
        h(
          'div',
          { class: 'ltch-score-ring-wrap' },
          h(
            'svg',
            { viewBox: '0 0 36 36', class: 'ltch-score-ring-svg' },
            h('path', {
              class: 'ltch-score-ring-bg',
              d: 'M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831'
            }),
            h('path', {
              class: 'ltch-score-ring-fill',
              'stroke-dasharray': strokeDash,
              d: 'M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831'
            })
          ),
          h(
            'div',
            { class: 'ltch-score-ring-center' },
            h('span', { class: 'ltch-score-ring-label', text: 'Điểm số' }),
            h('strong', { class: 'ltch-score-ring-value', text: `${currentData.score}` }),
            h('span', { class: 'ltch-score-ring-max', text: `/ ${currentData.max}` })
          )
        ),
        h(
          'div',
          { class: 'ltch-result-kpi-grid' },
          h(
            'div',
            { class: 'ltch-result-kpi-item is-time' },
            h('span', { class: 'ltch-kpi-label', text: 'Thời gian' }),
            h('strong', { text: formatTimeSpentVi(currentData.timeSpentSeconds) })
          ),
          h(
            'div',
            { class: 'ltch-result-kpi-item is-correct' },
            h('span', { class: 'ltch-kpi-label', text: 'Câu đúng' }),
            h('strong', { text: String(correctCount) })
          ),
          h(
            'div',
            { class: 'ltch-result-kpi-item is-wrong' },
            h('span', { class: 'ltch-kpi-label', text: 'Câu sai' }),
            h('strong', { text: String(wrongCount) })
          ),
          h(
            'div',
            { class: 'ltch-result-kpi-item is-skipped' },
            h('span', { class: 'ltch-kpi-label', text: 'Chưa làm' }),
            h('strong', { text: String(skippedCount) })
          )
        )
      ),
      h(
        'div',
        { class: 'ltch-result-tabs' },
        h(
          'button',
          {
            type: 'button',
            class: `ltch-result-tab${activeLeftTab === 'overview' ? ' is-active' : ''}`,
            onclick: () => {
              activeLeftTab = 'overview';
              render();
            }
          },
          'Tổng quan'
        ),
        h(
          'button',
          {
            type: 'button',
            class: `ltch-result-tab${activeLeftTab === 'by_type' ? ' is-active' : ''}`,
            onclick: () => {
              activeLeftTab = 'by_type';
              render();
            }
          },
          'Theo dạng câu'
        )
      )
    );

    if (activeLeftTab === 'overview') {
      // Lưới Tiến độ theo câu
      const navGrid = h('div', { class: 'ltch-result-q-grid' });
      questions.forEach((q, idx) => {
        const r = resultByQId.get(q.id);
        const stateCls = !r?.answered ? 'is-skipped' : r.correct ? 'is-correct' : 'is-wrong';
        const num = q.displayNumber || idx + 1;
        navGrid.append(
          h(
            'button',
            {
              type: 'button',
              class: `ltch-result-q-pill ${stateCls}`,
              text: String(num),
              onclick: () => {
                const card = document.getElementById(`ltch-sol-card-${q.id}`);
                focusQuestionCard(card);
              }
            }
          )
        );
      });

      const distBuckets = Array.isArray(currentData.distribution)
        ? currentData.distribution
        : [
            { label: '0 - 20%', count: 0 },
            { label: '20 - 40%', count: 0 },
            { label: '40 - 60%', count: 0 },
            { label: '60 - 80%', count: 0 },
            { label: '80 - 100%', count: 1 }
          ];
      const maxBucket = Math.max(1, ...distBuckets.map((b) => b.count));

      leftPanel.append(
        h(
          'div',
          { class: 'ltch-result-box' },
          h('h2', { class: 'ltch-result-box-title', text: 'Tiến độ theo câu (Nhấn để nhảy tới lời giải)' }),
          navGrid
        ),
        h(
          'div',
          { class: 'ltch-result-box' },
          h('h2', { class: 'ltch-result-box-title', text: 'Phổ điểm bài thi' }),
          h(
            'div',
            { class: 'ltch-dist-chart' },
            ...distBuckets.map((b) => {
              const hPct = Math.round((b.count / maxBucket) * 100);
              return h(
                'div',
                { class: 'ltch-dist-col' },
                h('span', { class: 'ltch-dist-count', text: String(b.count) }),
                h(
                  'div',
                  { class: 'ltch-dist-bar-track' },
                  h('div', { class: 'ltch-dist-bar-fill', style: `height:${Math.max(6, hPct)}%` })
                ),
                h('span', { class: 'ltch-dist-label', text: b.label })
              );
            })
          )
        )
      );
    } else {
      // Thống kê theo dạng câu hỏi (không dùng Chủ đề)
      const byType = new Map();
      for (const q of questions) {
        const r = resultByQId.get(q.id);
        const t = q.type || 'single';
        if (!byType.has(t)) byType.set(t, { total: 0, correct: 0, earned: 0, max: 0 });
        const st = byType.get(t);
        st.total += 1;
        if (r?.correct) st.correct += 1;
        st.earned = Math.round((st.earned + Number(r?.earned || 0)) * 100) / 100;
        st.max = Math.round((st.max + Number(r?.points || q.points || 1)) * 100) / 100;
      }
      leftPanel.append(
        h(
          'div',
          { class: 'ltch-result-box' },
          h('h2', { class: 'ltch-result-box-title', text: 'Độ chính xác theo dạng câu hỏi' }),
          ...Array.from(byType.entries()).map(([typeKey, st]) => {
            const pct = st.total > 0 ? Math.round((st.correct / st.total) * 100) : 0;
            return h(
              'div',
              { class: 'ltch-type-stat-row' },
              h(
                'div',
                { class: 'ltch-type-stat-head' },
                h('strong', { text: QUESTION_TYPE_LABELS[typeKey] || typeKey }),
                h('span', { text: `${st.correct}/${st.total} câu (${st.earned}/${st.max}đ)` })
              ),
              h(
                'div',
                { class: 'ltch-type-stat-track' },
                h('div', { class: 'ltch-type-stat-fill', style: `width:${pct}%` })
              )
            );
          })
        )
      );
    }

    // Cột phải: Danh sách Chi tiết bài làm & Lời giải
    const rightCol = h('main', { class: 'ltch-result-right-col' });
    const filterBar = h(
      'div',
      { class: 'ltch-result-filter-bar' },
      h('h3', { text: 'Chi tiết bài làm & Lời giải' }),
      h(
        'div',
        { class: 'ltch-filter-pills' },
        ...[
          ['all', `Tất cả (${questions.length})`],
          ['correct', `Câu đúng (${correctCount})`],
          ['wrong', `Câu sai (${wrongCount})`],
          ['skipped', `Chưa làm (${skippedCount})`]
        ].map(([fKey, fLabel]) =>
          h(
            'button',
            {
              type: 'button',
              class: `ltch-pill-btn${activeRightFilter === fKey ? ' is-active' : ''}`,
              onclick: () => {
                activeRightFilter = fKey;
                render();
              }
            },
            fLabel
          )
        )
      )
    );
    rightCol.append(filterBar);

    const filteredQuestions = questions.filter((q) => {
      const r = resultByQId.get(q.id);
      if (activeRightFilter === 'correct') return r?.answered && r?.correct;
      if (activeRightFilter === 'wrong') return r?.answered && !r?.correct;
      if (activeRightFilter === 'skipped') return !r?.answered;
      return true;
    });

    let lastPassageKey = null;
    for (const q of filteredQuestions) {
      const r = resultByQId.get(q.id) || { answered: false, correct: false, earned: 0, points: q.points || 1 };
      const maxPts = r.points ?? r.max ?? q.points ?? 1;
      const userResp = currentData.responses?.[q.id];
      const num = q.displayNumber || q.order || 1;
      const qCode = q.questionCode || `LTCH-${num}`;
      const pKey = getClientPassageClusterKey(q);

      if (q.passageContent && pKey && pKey !== lastPassageKey) {
        lastPassageKey = pKey;
        const clusterPeers = questions.filter((item) => getClientPassageClusterKey(item) === pKey);
        const firstPNum = clusterPeers[0]?.displayNumber || num;
        const lastPNum = clusterPeers[clusterPeers.length - 1]?.displayNumber || num;
        const passageRangeText =
          firstPNum !== lastPNum
            ? `NGỮ LIỆU DÙNG CHUNG (CÂU ${firstPNum} – ${lastPNum})`
            : `NGỮ LIỆU DÙNG CHUNG (CÂU ${firstPNum})`;
        const passageBox = h('div', { class: 'ltch-passage-box' });
        const passageBody = h('div', { class: 'ltch-passage-body' });
        renderRichMathBlock(passageBody, q.passageContent, q.passageMedia || []);
        passageBox.append(
          h('div', { class: 'ltch-passage-badge', text: passageRangeText }),
          passageBody
        );
        rightCol.append(passageBox);
      }

      const statusBadge = !r.answered
        ? h('span', { class: 'ltch-sol-badge is-skipped', text: '— Chưa làm (0đ)' })
        : r.correct
          ? h('span', { class: 'ltch-sol-badge is-correct', text: `✓ Đúng (+${r.earned}đ)` })
          : h('span', { class: 'ltch-sol-badge is-wrong', text: `✕ Sai (${r.earned}/${maxPts}đ)` });

      const promptBox = h('div', { class: 'ltch-q-prompt' });
      if (q.type === 'fill_blank' || q.type === 'drag_drop') {
        renderInteractivePromptWithBlanks(promptBox, q, [], null, { readOnly: true });
      } else {
        renderRichMathBlock(promptBox, q.prompt, q.media || [], { otherMediaFields: [...(q.options || []), ...(q.statements || [])] });
      }

      const answerReviewBox = h('div', { class: 'ltch-sol-answer-review' });
      const makeAnswerStrong = (val) => {
        const strong = h('strong');
        appendFormattedInlineMath(strong, String(val ?? ''), q.media || []);
        return strong;
      };

      if (q.type === 'single' || q.type === 'multiple') {
        const opts = Array.isArray(q.options) ? q.options : [];
        const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
        const correctSet = new Set(
          q.type === 'single'
            ? [String(q.answer || '').toUpperCase()]
            : (Array.isArray(q.answers) ? q.answers : []).map((x) => String(x).toUpperCase())
        );
        const userSet = new Set(
          q.type === 'single'
            ? userResp
              ? [String(userResp).toUpperCase()]
              : []
            : (Array.isArray(userResp) ? userResp : []).map((x) => String(x).toUpperCase())
        );

        const optList = h('div', { class: 'ltch-sol-options-grid' });
        opts.forEach((optText, idx) => {
          const letter = letters[idx] || String(idx + 1);
          const isCorr = correctSet.has(letter);
          const isChosen = userSet.has(letter);
          const cls = isCorr
            ? 'is-correct-opt'
            : isChosen && !isCorr
              ? 'is-wrong-opt'
              : '';
          const optContent = h('div', { class: 'ltch-opt-text' });
          renderRichMathBlock(optContent, optText, q.media || [], { appendUnreferenced: false });
          optList.append(
            h(
              'div',
              { class: `ltch-sol-option-item ${cls}` },
              h('span', { class: 'ltch-opt-letter', text: letter }),
              optContent,
              isCorr ? h('span', { class: 'ltch-opt-tag is-corr', text: 'Đáp án đúng' }) : null,
              isChosen && !isCorr ? h('span', { class: 'ltch-opt-tag is-user-wrong', text: 'Bạn chọn' }) : null,
              isChosen && isCorr ? h('span', { class: 'ltch-opt-tag is-user-corr', text: 'Bạn chọn ✓' }) : null
            )
          );
        });
        answerReviewBox.append(optList);
      } else if (q.type === 'true_false') {
        const statements = Array.isArray(q.statements) ? q.statements : [q.prompt];
        const expectedArr = Array.isArray(q.answers) ? q.answers : [];
        const userArr = Array.isArray(userResp) ? userResp : [];
        const tbl = h(
          'table',
          { class: 'ltch-tf-review-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { text: 'Mệnh đề' }),
              h('th', { text: 'Bài làm của bạn' }),
              h('th', { text: 'Đáp án đúng' })
            )
          )
        );
        const tbody = h('tbody');
        statements.forEach((stText, sIdx) => {
          const stLabel = statements.length > 1 ? `${String.fromCharCode(97 + sIdx)}) ` : '';
          const cellText = h('td');
          renderRichMathBlock(cellText, `${stLabel}${stText}`, q.media || [], { appendUnreferenced: false });
          const uVal = userArr[sIdx];
          const expVal = expectedArr[sIdx];
          const isSubCorr = typeof uVal === 'boolean' && uVal === expVal;
          tbody.append(
            h(
              'tr',
              { class: isSubCorr ? 'is-sub-correct' : 'is-sub-wrong' },
              cellText,
              h('td', {
                text: typeof uVal === 'boolean' ? (uVal ? 'Đúng' : 'Sai') : 'Chưa chọn'
              }),
              h('td', {
                class: 'is-expected-cell',
                text: expVal ? 'Đúng' : 'Sai'
              })
            )
          );
        });
        tbl.append(tbody);
        answerReviewBox.append(tbl);
      } else if (q.type === 'short') {
        const acceptedStr = Array.isArray(q.accepted) ? q.accepted.join(' | ') : String(q.answer || '');
        answerReviewBox.append(
          h(
            'div',
            { class: 'ltch-short-review-row' },
            h(
              'div',
              { class: `ltch-short-box ${r.correct ? 'is-corr' : 'is-wrong'}` },
              h('span', { text: 'Đáp án của bạn:' }),
              makeAnswerStrong(userResp !== undefined && userResp !== '' ? String(userResp) : '(Để trống)')
            ),
            h(
              'div',
              { class: 'ltch-short-box is-corr' },
              h('span', { text: 'Đáp án đúng:' }),
              makeAnswerStrong(acceptedStr)
            )
          )
        );
      } else if (q.type === 'fill_blank') {
        const blanks = Array.isArray(q.blanks) ? q.blanks : [];
        const userArr = Array.isArray(userResp) ? userResp : [];
        answerReviewBox.append(
          h(
            'div',
            { class: 'ltch-blanks-review-list' },
            ...blanks.map((b, bIdx) =>
              h(
                'div',
                { class: 'ltch-short-review-row' },
                h(
                  'div',
                  { class: 'ltch-short-box' },
                  h('span', { text: `Ô trống (${bIdx + 1}) bạn điền:` }),
                  makeAnswerStrong(userArr[bIdx] || '(Để trống)')
                ),
                h(
                  'div',
                  { class: 'ltch-short-box is-corr' },
                  h('span', { text: `Đáp án (${bIdx + 1}):` }),
                  makeAnswerStrong((b.accepted || []).join(' | '))
                )
              )
            )
          )
        );
      } else if (q.type === 'drag_drop') {
        const cards = Array.isArray(q.cards) ? q.cards : [];
        const expectedArr = Array.isArray(q.answer) ? q.answer : [];
        const userArr = Array.isArray(userResp) ? userResp : [];
        const resolveCardLabel = (tok) => {
          const m = /^T(\d{1,2})$/i.exec(String(tok || ''));
          return makeAnswerStrong((m ? cards[Number(m[1]) - 1] : '') || '(Chưa thả)');
        };
        answerReviewBox.append(
          h(
            'div',
            { class: 'ltch-blanks-review-list' },
            ...expectedArr.map((expTok, sIdx) =>
              h(
                'div',
                { class: 'ltch-short-review-row' },
                h(
                  'div',
                  { class: 'ltch-short-box' },
                  h('span', { text: `Vị trí (${sIdx + 1}) bạn chọn:` }),
                  resolveCardLabel(userArr[sIdx])
                ),
                h(
                  'div',
                  { class: 'ltch-short-box is-corr' },
                  h('span', { text: `Đáp án (${sIdx + 1}):` }),
                  resolveCardLabel(expTok)
                )
              )
            )
          )
        );
      }

      const solutionBlock = h('div', { class: 'ltch-sol-explanation' });
      const solBody = h('div', { class: 'ltch-sol-explanation-body' });
      renderRichMathBlock(
        solBody,
        q.solution || 'Đáp án chuẩn đã được đối chiếu như trên.',
        q.media || [],
        { onlySolutionMedia: true }
      );
      solutionBlock.append(
        h('div', { class: 'ltch-sol-explanation-title', text: 'LỜI GIẢI CHI TIẾT' }),
        solBody
      );

      rightCol.append(
        h(
          'article',
          { id: `ltch-sol-card-${q.id}`, class: 'ltch-sol-question-card' },
          h(
            'div',
            { class: 'ltch-sol-card-head' },
            h(
              'div',
              { class: 'ltch-sol-card-head-left' },
              h('span', { class: 'ltch-q-number-badge', text: `Câu ${num}` }),
              h('span', { class: 'ltch-q-code-badge', text: `#${qCode}` }),
              q.subject && SUBJECT_LABELS[q.subject]
                ? h('span', { class: 'ltch-q-subj-badge', text: SUBJECT_LABELS[q.subject] })
                : null
            ),
            h(
              'div',
              { class: 'ltch-sol-card-head-right' },
              statusBadge,
              h(
                'button',
                {
                  type: 'button',
                  class: 'ltch-report-btn',
                  onclick: () =>
                    openReportQuestionModal({
                      api,
                      status,
                      attemptId: currentData.attemptId,
                      examId: currentData.examId,
                      question: q
                    })
                },
                '⚑ Báo lỗi'
              )
            )
          ),
          promptBox,
          answerReviewBox,
          solutionBlock
        )
      );
    }

    overlay.append(topBar, h('div', { class: 'ltch-result-2col-layout' }, leftPanel, rightCol));
  }

  render();
}

// ============================================================================
// GIAI ĐOẠN 2: PHÒNG THI TRỰC TUYẾN 3 GIAO DIỆN CHUYÊN BIỆT (THPTQG · HSA · TSA)
// ============================================================================
export function mountExamTakingOverlay({
  initialAttempt,
  access,
  api,
  status,
  onSubmitted,
  onExitLobby,
  onSwitchMode
}) {
  const existing = document.getElementById('ltch-practice-fullscreen-root');
  if (existing) existing.remove();

  const overlay = h('div', {
    id: 'ltch-practice-fullscreen-root',
    class: `ltch-exam-fullscreen-overlay is-room-${initialAttempt.examType || 'thptqg'}`
  });
  document.body.append(overlay);
  document.body.classList.add('ltch-exam-body-lock');

  let state = { ...initialAttempt };
  let activeDeviceToken = initialAttempt.activeDeviceToken || '';
  let responses = { ...(initialAttempt.responses || {}) };
  let flaggedSet = new Set(Array.isArray(initialAttempt.draftMeta?.flagged) ? initialAttempt.draftMeta.flagged : []);
  let viewedSet = new Set();
  let currentQuestionIndex = 0;
  let selectedDragCardToken = null;
  let selectedDragCardQId = null;
  let pendingTsaScrollToQId = null;
  let prevTsaClusterKey = '';
  let hsaComboConfirmed = false;
  let startingSection = false;
  let pendingHsaCombo = state.selectedCombination || 'Q01';
  let tsaSectionGateOpen = false;
  let questionElapsedMap = {};
  let activeTsaElapsedKey = '';
  let serverOffsetMs = (Number(initialAttempt.serverNow) || Date.now()) - Date.now();
  let isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  let draftDirty = false;
  let draftTimer = null;
  let clockInterval = null;
  let isSubmitting = false;
  let compactPaletteOpen = false;
  let compactPassageOpen = false;
  let deviceNoticeDismissed = false;
  const createRoomDeviceNotice = () => deviceNoticeDismissed ? null : createPracticeDeviceNotice(state.examType, () => { deviceNoticeDismissed = true; });

  const nameWords = String(access?.displayName || 'Học sinh').trim().split(/\s+/);
  const avatarInitials =
    nameWords.length >= 2
      ? `${nameWords[0][0] || ''}${nameWords[nameWords.length - 1][0] || ''}`.toUpperCase()
      : String(nameWords[0] || 'HS').slice(0, 2).toUpperCase();

  const localStorageKey = `ltch_draft_${state.attemptId}`;
  // Khôi phục bản nháp mới hơn từ localStorage (nếu có)
  try {
    const savedRaw = localStorage.getItem(localStorageKey);
    if (savedRaw) {
      const parsed = JSON.parse(savedRaw);
      if (parsed && parsed.responses && typeof parsed.responses === 'object') {
        responses = { ...responses, ...parsed.responses };
      }
      if (Array.isArray(parsed?.flagged)) {
        flaggedSet = new Set([...flaggedSet, ...parsed.flagged]);
      }
    }
  } catch {}

  const saveLocalDraft = () => {
    try {
      localStorage.setItem(
        localStorageKey,
        JSON.stringify({
          responses,
          flagged: [...flaggedSet],
          updatedAt: Date.now()
        })
      );
    } catch {}
  };

  const syncServerDraft = async () => {
    if (!draftDirty || isSubmitting) return;
    draftDirty = false;
    const currentQ = (state.visibleQuestions || [])[currentQuestionIndex];
    try {
      const res = await api(`/api/exams/${state.examId}/draft`, {
        method: 'POST',
        body: {
          attemptId: state.attemptId,
          activeDeviceToken,
          responses,
          draftMeta: {
            flagged: [...flaggedSet],
            currentQuestionId: currentQ?.id || null
          }
        }
      });
      if (res?.serverNow) {
        serverOffsetMs = Number(res.serverNow) - Date.now();
      }
    } catch (err) {
      if (err?.status === 409 && err?.code === 'DEVICE_SUPERSEDED') {
        cleanupListeners();
        status('Bài thi đã được mở trên một thiết bị hoặc tab mới hơn.', true);
        overlay.remove();
        document.body.classList.remove('ltch-exam-body-lock');
        if (typeof onExitLobby === 'function') onExitLobby();
        return;
      }
      draftDirty = true;
    }
  };

  const scheduleDraftSync = () => {
    saveLocalDraft();
    draftDirty = true;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      syncServerDraft();
    }, 3500);
  };

  const updateResponse = (qId, val, { rerender = false } = {}) => {
    responses[qId] = val;
    scheduleDraftSync();
    if (rerender) renderRoom();
    else updatePaletteAndProgressIndicators();
  };

  const toggleFlagQuestion = (qId) => {
    if (flaggedSet.has(qId)) flaggedSet.delete(qId);
    else flaggedSet.add(qId);
    scheduleDraftSync();
    renderRoom();
  };

  const onOnline = () => {
    isOffline = false;
    updateOfflineBanner();
    syncServerDraft();
  };
  const onOffline = () => {
    isOffline = true;
    updateOfflineBanner();
  };
  const onBeforeUnload = (e) => {
    if (!isSubmitting) {
      saveLocalDraft();
      e.preventDefault();
      e.returnValue = '';
    }
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('beforeunload', onBeforeUnload);
  const compactLayoutQuery = window.matchMedia(COMPACT_PRACTICE_MEDIA);
  const onCompactLayoutChange = () => renderRoom();
  compactLayoutQuery.addEventListener('change', onCompactLayoutChange);

  function cleanupListeners() {
    if (clockInterval) clearInterval(clockInterval);
    if (draftTimer) clearTimeout(draftTimer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('beforeunload', onBeforeUnload);
    compactLayoutQuery.removeEventListener('change', onCompactLayoutChange);
  }

  function closeRoomToLobby() {
    cleanupListeners();
    overlay.remove();
    document.body.classList.remove('ltch-exam-body-lock');
    if (typeof onExitLobby === 'function') onExitLobby();
  }

  function closeAndSwitchMode() {
    cleanupListeners();
    overlay.remove();
    document.body.classList.remove('ltch-exam-body-lock');
    if (typeof onSwitchMode === 'function') onSwitchMode();
    else if (typeof onExitLobby === 'function') onExitLobby();
  }

  async function submitFullExam() {
    if (isSubmitting) return;
    isSubmitting = true;
    try {
      status('Đang nộp bài và chấm điểm...', false, 'loading');
      const res = await api(`/api/exams/${state.examId}/submit`, {
        method: 'POST',
        body: {
          attemptId: state.attemptId,
          activeDeviceToken,
          responses,
          draftMeta: { flagged: [...flaggedSet] }
        }
      });
      try {
        localStorage.removeItem(localStorageKey);
      } catch {}
      status('Đã nộp bài thành công!', false, 'success');
      cleanupListeners();
      overlay.remove();
      document.body.classList.remove('ltch-exam-body-lock');
      if (typeof onSubmitted === 'function') {
        onSubmitted(res, { showHsaSummaryFirst: state.examType === 'hsa' });
      }
    } catch (err) {
      isSubmitting = false;
      status(err?.message || 'Chưa thể nộp bài. Hệ thống đã lưu nháp của bạn, vui lòng thử lại.', true);
    }
  }

  async function startCurrentSection(selectedCombo = null) {
    if (startingSection) return;
    startingSection = true;
    try {
      status('Đang mở phần thi...', false, 'loading');
      const res = await api(`/api/exams/${state.examId}/section`, {
        method: 'POST',
        body: {
          attemptId: state.attemptId,
          activeDeviceToken,
          action: 'start_section',
          sectionKey: state.currentSection,
          ...(selectedCombo ? { selectedCombination: selectedCombo } : {})
        }
      });
      status('');
      state = { ...state, ...res };
      if (res.serverNow) serverOffsetMs = Number(res.serverNow) - Date.now();
      currentQuestionIndex = 0;
      renderRoom();
    } catch (err) {
      status(err?.message || 'Không thể bắt đầu phần thi.', true);
    } finally {
      startingSection = false;
    }
  }

  async function submitCurrentSection() {
    if (isSubmitting) return;
    isSubmitting = true;
    try {
      status('Đang hoàn tất phần thi...', false, 'loading');
      const res = await api(`/api/exams/${state.examId}/section`, {
        method: 'POST',
        body: {
          attemptId: state.attemptId,
          activeDeviceToken,
          action: 'submit_section',
          sectionKey: state.currentSection,
          responses
        }
      });
      status('');
      isSubmitting = false;
      if (res.completedAllSections || res.status === 'submitted') {
        try {
          localStorage.removeItem(localStorageKey);
        } catch {}
        cleanupListeners();
        overlay.remove();
        document.body.classList.remove('ltch-exam-body-lock');
        if (typeof onSubmitted === 'function') {
          onSubmitted(res, { showHsaSummaryFirst: state.examType === 'hsa' });
        }
        return;
      }
      state = { ...state, ...res };
      if (res.serverNow) serverOffsetMs = Number(res.serverNow) - Date.now();
      currentQuestionIndex = 0;
      if (state.examType === 'hsa' && state.currentSection === 'part_3') {
        hsaComboConfirmed = false;
      }
      if (state.examType === 'tsa') {
        tsaSectionGateOpen = true;
      }
      renderRoom();
    } catch (err) {
      isSubmitting = false;
      status(err?.message || 'Không thể nộp phần thi. Vui lòng thử lại.', true);
    }
  }

  function getActiveSectionDeadlineMs() {
    const curSec = state.currentSection || 'all';
    const st = state.sectionStates?.[curSec];
    if (st?.status === 'waiting' && st.waitExpiresAt) return Number(st.waitExpiresAt);
    if (st?.expiresAt) return Number(st.expiresAt);
    return Number(state.expiresAt) || Date.now() + 3600_000;
  }

  function getRemainingSeconds() {
    const nowServer = Date.now() + serverOffsetMs;
    return Math.max(0, Math.floor((getActiveSectionDeadlineMs() - nowServer) / 1000));
  }

  let timerDisplayNodes = [];
  let questionTimerNodes = [];

  function formatQuestionElapsed(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m} : ${String(r).padStart(2, '0')}`;
  }

  function startClockTicker() {
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = setInterval(() => {
      const rem = getRemainingSeconds();
      const formatted = formatDurationClock(rem);
      const spacedFormatted = formatted.replace(/:/g, ' : ');
      for (const node of timerDisplayNodes) {
        if (!node.isConnected) continue;
        const mode = node.dataset?.timerMode || 'clock';
        if (mode === 'seconds') node.textContent = String(rem);
        else if (mode === 'spaced') node.textContent = spacedFormatted;
        else node.textContent = formatted;
      }

      if (activeTsaElapsedKey && !tsaSectionGateOpen) {
        questionElapsedMap[activeTsaElapsedKey] = (questionElapsedMap[activeTsaElapsedKey] || 0) + 1;
        const elapsedText = formatQuestionElapsed(questionElapsedMap[activeTsaElapsedKey]);
        for (const qNode of questionTimerNodes) {
          if (qNode.isConnected) qNode.textContent = elapsedText;
        }
      }

      if (rem <= 0 && !isSubmitting) {
        const curSt = state.sectionStates?.[state.currentSection];
        if (curSt?.status === 'waiting') {
          if (state.examType !== 'hsa' || state.currentSection !== 'part_3' || hsaComboConfirmed) {
            startCurrentSection(state.selectedCombination || pendingHsaCombo || 'Q01');
          }
        } else if (state.examType === 'hsa' || (state.examType === 'tsa' && state.practiceMode === 'full')) {
          submitCurrentSection();
        } else {
          submitFullExam();
        }
      }
    }, 1000);
  }

  function updateOfflineBanner() {
    const banner = overlay.querySelector('.ltch-offline-banner');
    if (banner) banner.hidden = !isOffline;
  }

  function updatePaletteAndProgressIndicators() {
    const visibleQs = state.visibleQuestions || [];
    const answeredCount = visibleQs.filter((q) => isQuestionAnswered(q, responses[q.id])).length;
    const unansweredCount = Math.max(0, visibleQs.length - answeredCount);
    const pct = visibleQs.length > 0 ? Math.round((answeredCount / visibleQs.length) * 100) : 0;
    overlay.querySelectorAll('[data-compact-progress]').forEach((node) => {
      node.textContent = `${answeredCount}/${visibleQs.length} câu`;
    });

    const progText = overlay.querySelector('[data-ltch-progress-text]');
    if (progText) {
      progText.textContent =
        state.examType === 'tsa'
          ? `${answeredCount}/${visibleQs.length}`
          : `Đã làm: ${answeredCount}/${visibleQs.length} câu`;
    }
    const progPct = overlay.querySelector('[data-ltch-progress-pct]');
    if (progPct) progPct.textContent = `${pct}%`;
    const progBar = overlay.querySelector('[data-ltch-progress-bar]');
    if (progBar && visibleQs.length > 0) {
      progBar.style.width = `${pct}%`;
    }
    const indUnans = overlay.querySelector('[data-tsa-ind-unanswered]');
    if (indUnans) indUnans.textContent = String(unansweredCount);
    const indAns = overlay.querySelector('[data-tsa-ind-answered]');
    if (indAns) indAns.textContent = String(answeredCount);

    for (const q of visibleQs) {
      const btnNode = overlay.querySelector(`[data-palette-qid="${q.id}"]`);
      if (!btnNode) continue;
      const ans = isQuestionAnswered(q, responses[q.id]);
      const partial = !ans && isQuestionPartiallyAnswered(q, responses[q.id]);
      const flagged = flaggedSet.has(q.id);
      btnNode.classList.toggle('is-answered', ans);
      btnNode.classList.toggle('is-partial', partial);
      btnNode.classList.toggle('is-flagged', flagged);
    }
  }

  // Compact controls share the same draft, clock and submit flow as desktop.
  // The palette expands in the layout, so it never covers an answer or traps focus.
  function setCompactPaletteOpen(open) {
    compactPaletteOpen = open;
    overlay.classList.toggle('is-compact-palette-open', open);
    overlay.querySelector('[data-compact-palette-toggle]')?.setAttribute('aria-expanded', String(open));
  }

  function createCompactControls(questions, palette, isSectionEnd = false) {
    palette.id = 'practice-compact-palette';
    palette.setAttribute('aria-label', 'Bảng câu hỏi');
    palette.prepend(h('button', {
      type: 'button', class: 'ltch-compact-palette-close', text: 'Đóng bảng câu hỏi',
      onclick: () => {
        setCompactPaletteOpen(false);
        overlay.querySelector('[data-compact-palette-toggle]')?.focus();
      }
    }));
    overlay.classList.toggle('is-compact-palette-open', compactPaletteOpen);
    const compactTimer = h('strong', {
      class: 'ltch-compact-timer', text: formatDurationClock(getRemainingSeconds()),
      'aria-label': 'Thời gian còn lại'
    });
    timerDisplayNodes.push(compactTimer);
    return h('div', {class: 'ltch-compact-room-controls'},
      h('div', {class: 'ltch-compact-clock'},
        h('span', {text: 'Còn lại'}), compactTimer),
      h('button', {
        type: 'button', class: 'ltch-compact-palette-toggle',
        'data-compact-palette-toggle': '1', 'aria-controls': palette.id,
        'aria-expanded': String(compactPaletteOpen), onclick: () => setCompactPaletteOpen(!compactPaletteOpen)
      }, h('span', {text: 'Bảng câu hỏi'}),
      h('strong', {'data-compact-progress': '1', text: `${questions.filter(q => isQuestionAnswered(q, responses[q.id])).length}/${questions.length} câu`})),
      h('button', {
        type: 'button', class: 'ltch-btn ltch-btn-primary ltch-compact-submit',
        text: isSectionEnd ? 'Nộp phần' : 'Nộp bài',
        onclick: () => openConfirmSubmitModal({isSectionEnd})
      })
    );
  }

  // Render nội dung tương tác của 1 câu hỏi (chuẩn 9Study cho HSA & TSA, chuẩn Bộ GD cho THPTQG)
  function renderInteractiveQuestionBody(q, examType, { badgeNode = null } = {}) {
    const curVal = responses[q.id];
    const wrap = h('div', { class: `ltch-q-interactive-area is-${examType}` });

    const appendPromptWithOptionalBadge = (promptBox) => {
      if (badgeNode) {
        wrap.append(h('div', { class: 'ltch-tsa-q-prompt-row' }, badgeNode, promptBox));
      } else {
        wrap.append(promptBox);
      }
    };

    // 1. Điền khuyết (fill_blank) có {{1}}, {{2}} trong câu
    if (q.type === 'fill_blank') {
      const promptBox = h('div', { class: 'ltch-q-prompt is-fill-blank' });
      renderInteractivePromptWithBlanks(promptBox, q, curVal, (nextArr) => {
        updateResponse(q.id, nextArr);
      });
      appendPromptWithOptionalBadge(promptBox);
      wrap.append(
        h('p', {
          class: 'ltch-tsa-helper-note',
          text: 'Điền lần lượt vào từng ô trống trong đề bài.'
        })
      );
      return wrap;
    }

    // 2. Kéo thả (drag_drop): chuẩn 9Study hiển thị đề có ô trống ở trên, kho thẻ CÁC ĐÁP ÁN ở dưới
    if (q.type === 'drag_drop') {
      const cards = Array.isArray(q.cards) ? q.cards : [];
      const usedTokens = new Set(Array.isArray(curVal) ? curVal.filter(Boolean) : []);

      const promptBox = h('div', { class: 'ltch-q-prompt is-drag-drop' });
      const activeTokenForQ = selectedDragCardQId === q.id ? selectedDragCardToken : null;
      renderInteractivePromptWithBlanks(
        promptBox,
        q,
        curVal,
        (nextArr) => {
          selectedDragCardToken = null;
          selectedDragCardQId = null;
          updateResponse(q.id, nextArr, { rerender: true });
        },
        {
          activeCardToken: activeTokenForQ,
          getSelectedCardToken: () => (selectedDragCardQId === q.id ? selectedDragCardToken : null),
          clearSelectedCardToken: () => {
            selectedDragCardToken = null;
            selectedDragCardQId = null;
          }
        }
      );

      const bankBar = h(
        'div',
        { class: 'ltch-drag-bank-box' },
        h(
          'div',
          { class: 'ltch-drag-bank-title' },
          h('span', { text: '✋ CÁC ĐÁP ÁN' })
        ),
        h(
          'div',
          { class: 'ltch-drag-cards-list' },
          ...cards.map((cardText, cIdx) => {
            const token = `T${cIdx + 1}`;
            const isUsed = usedTokens.has(token);
            const isSelected = selectedDragCardToken === token && selectedDragCardQId === q.id;
            const cardContent = h('span', { class: 'ltch-drag-card-text' });
            appendFormattedInlineMath(cardContent, cardText, q.media || [], null, { allowImageZoom: false });

            return h(
              'button',
              {
                type: 'button',
                draggable: !isUsed ? 'true' : 'false',
                class: `ltch-drag-card-pill${isUsed ? ' is-used' : ''}${isSelected ? ' is-selected' : ''}`,
                ondragstart: (e) => {
                  if (isUsed) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer?.setData('text/plain', token);
                },
                onclick: () => {
                  if (isUsed) return;
                  if (selectedDragCardToken === token && selectedDragCardQId === q.id) {
                    selectedDragCardToken = null;
                    selectedDragCardQId = null;
                  } else {
                    selectedDragCardToken = token;
                    selectedDragCardQId = q.id;
                  }
                  renderRoom();
                }
              },
              h('span', { class: 'ltch-drag-card-grip', 'aria-hidden': 'true', text: '⋮⋮' }),
              cardContent
            );
          })
        ),
        h('p', {
          class: 'ltch-tsa-helper-note',
          text: 'Kéo vào chỗ trống, hoặc bấm từ rồi bấm ô. Bấm lại ô đã điền để gỡ.'
        })
      );

      appendPromptWithOptionalBadge(promptBox);
      wrap.append(bankBar);
      return wrap;
    }

    // Các dạng còn lại: hiển thị lời dẫn câu hỏi trước
    const promptBox = h('div', { class: 'ltch-q-prompt' });
    renderRichMathBlock(promptBox, q.prompt, q.media || [], { otherMediaFields: [...(q.options || []), ...(q.statements || [])] });
    appendPromptWithOptionalBadge(promptBox);

    // 3. Trắc nghiệm 1 đáp án đúng (single)
    if (q.type === 'single') {
      const opts = Array.isArray(q.options) ? q.options : [];
      const letters = ['A', 'B', 'C', 'D'];
      const optList = h('div', { class: `ltch-options-list is-${examType}` });

      opts.forEach((optText, idx) => {
        const letter = letters[idx] || String(idx + 1);
        const isChecked = String(curVal || '').toUpperCase() === letter;
        const textSpan = h('div', { class: 'ltch-option-content' });
        renderRichMathBlock(textSpan, optText, q.media || [], { appendUnreferenced: false, allowImageZoom: false });

        if (examType === 'hsa') {
          const row = h(
            isCompactPracticeLayout() ? 'button' : 'div',
            {
              type: 'button', 'aria-pressed': String(isChecked), 'data-answer-key': `${q.id}-option-${letter}`,
              class: `ltch-option-row is-hsa-9s${isChecked ? ' is-selected' : ''}`,
              onclick: () => {
                const nextVal = isChecked ? '' : letter;
                updateResponse(q.id, nextVal, { rerender: true });
              }
            },
            h('span', { class: 'ltch-hsa-opt-letter', text: `(${letter})` }),
            h('span', { class: 'ltch-hsa-opt-radio' }),
            textSpan
          );
          optList.append(row);
        } else if (examType === 'tsa') {
          const row = h(
            isCompactPracticeLayout() ? 'button' : 'div',
            {
              type: 'button', 'aria-pressed': String(isChecked), 'data-answer-key': `${q.id}-option-${letter}`,
              class: `ltch-option-row is-tsa-card${isChecked ? ' is-selected' : ''}`,
              onclick: () => {
                updateResponse(q.id, letter, { rerender: true });
              }
            },
            h('span', { class: 'ltch-tsa-opt-radio' }),
            textSpan
          );
          optList.append(row);
        } else {
          const row = h(
            isCompactPracticeLayout() ? 'button' : 'div',
            {
              type: 'button', 'aria-pressed': String(isChecked), 'data-answer-key': `${q.id}-option-${letter}`,
              class: `ltch-option-row${isChecked ? ' is-selected' : ''}`,
              onclick: () => {
                updateResponse(q.id, letter, { rerender: true });
              }
            },
            h('span', { class: 'ltch-option-radio-circle', text: letter }),
            textSpan
          );
          optList.append(row);
        }
      });

      wrap.append(optList);
      return wrap;
    }

    // 4. Trắc nghiệm nhiều lựa chọn (multiple)
    if (q.type === 'multiple') {
      const opts = Array.isArray(q.options) ? q.options : [];
      const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
      const chosenSet = new Set((Array.isArray(curVal) ? curVal : []).map((x) => String(x).toUpperCase()));
      wrap.append(
        h('p', {
          class: 'ltch-multi-hint',
          text: `Chọn nhiều đáp án đúng (đã chọn ${chosenSet.size})`
        })
      );

      const optList = h('div', { class: `ltch-options-list is-multiple is-${examType}` });
      opts.forEach((optText, idx) => {
        const letter = letters[idx] || String(idx + 1);
        const isChecked = chosenSet.has(letter);
        const textSpan = h('div', { class: 'ltch-option-content' });
        renderRichMathBlock(textSpan, optText, q.media || [], { appendUnreferenced: false, allowImageZoom: false });

        const row = h(
          isCompactPracticeLayout() ? 'button' : 'div',
          {
            type: 'button', 'aria-pressed': String(isChecked), 'data-answer-key': `${q.id}-option-${letter}`,
            class: `ltch-option-row is-checkbox${isChecked ? ' is-selected' : ''}`,
            onclick: () => {
              const nextSet = new Set(chosenSet);
              if (nextSet.has(letter)) nextSet.delete(letter);
              else nextSet.add(letter);
              updateResponse(q.id, [...nextSet].sort(), { rerender: true });
            }
          },
          h('span', { class: 'ltch-option-check-box', text: isChecked ? '✓' : '' }),
          textSpan
        );
        optList.append(row);
      });
      wrap.append(optList);
      return wrap;
    }

    // 5. Đúng / Sai (true_false)
    if (q.type === 'true_false') {
      const statements = Array.isArray(q.statements) ? q.statements : [q.prompt];
      const curArr = Array.isArray(curVal)
        ? [...curVal]
        : Array.from({ length: statements.length }, () => null);
      while (curArr.length < statements.length) curArr.push(null);

      if (examType === 'tsa') {
        const tbl = h(
          'table',
          { class: 'ltch-tf-interactive-table is-tsa' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { class: 'col-stmt', text: '' }),
              h('th', { class: 'col-tf', text: 'Đúng' }),
              h('th', { class: 'col-tf', text: 'Sai' })
            )
          )
        );
        const tbody = h('tbody');
        statements.forEach((stmtText, sIdx) => {
          const prefix = statements.length > 1 ? `${String.fromCharCode(65 + sIdx)}. ` : '';
          const stmtCell = h('td', { class: 'col-stmt' });
          renderRichMathBlock(stmtCell, `${prefix}${stmtText}`, q.media || [], { appendUnreferenced: false });

          const val = curArr[sIdx];
          const trueRadio = h('button', {
            type: 'button',
            class: `ltch-tsa-tf-radio is-true${val === true ? ' is-active' : ''}`,
            'aria-label': `Phát biểu ${sIdx + 1} Đúng`,
            'aria-pressed': String(val === true), 'data-answer-key': `${q.id}-tf-${sIdx}-true`,
            onclick: () => {
              const next = [...curArr];
              next[sIdx] = true;
              updateResponse(q.id, next, { rerender: true });
            }
          });
          const falseRadio = h('button', {
            type: 'button',
            class: `ltch-tsa-tf-radio is-false${val === false ? ' is-active' : ''}`,
            'aria-label': `Phát biểu ${sIdx + 1} Sai`,
            'aria-pressed': String(val === false), 'data-answer-key': `${q.id}-tf-${sIdx}-false`,
            onclick: () => {
              const next = [...curArr];
              next[sIdx] = false;
              updateResponse(q.id, next, { rerender: true });
            }
          });

          tbody.append(
            h('tr', {}, stmtCell, h('td', { class: 'col-tf' }, trueRadio), h('td', { class: 'col-tf' }, falseRadio))
          );
        });
        tbl.append(tbody);
        wrap.append(tbl);
        return wrap;
      }

      const tbl = h(
        'table',
        { class: 'ltch-tf-interactive-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { class: 'col-stmt', text: 'Mệnh đề a, b, c, d' }),
            h('th', { class: 'col-tf', text: 'ĐÚNG' }),
            h('th', { class: 'col-tf', text: 'SAI' })
          )
        )
      );
      const tbody = h('tbody');
      statements.forEach((stmtText, sIdx) => {
        const prefix = statements.length > 1 ? `${String.fromCharCode(97 + sIdx)}) ` : '';
        const stmtCell = h('td', { class: 'col-stmt' });
        renderRichMathBlock(stmtCell, `${prefix}${stmtText}`, q.media || [], { appendUnreferenced: false });

        const val = curArr[sIdx];
        const trueBtn = h(
          'button',
          {
            type: 'button',
            class: `ltch-tf-choice-btn is-true${val === true ? ' is-active' : ''}`,
            'aria-pressed': String(val === true), 'data-answer-key': `${q.id}-tf-${sIdx}-true`,
            onclick: () => {
              const next = [...curArr];
              next[sIdx] = true;
              updateResponse(q.id, next, { rerender: true });
            }
          },
          'Đúng'
        );
        const falseBtn = h(
          'button',
          {
            type: 'button',
            class: `ltch-tf-choice-btn is-false${val === false ? ' is-active' : ''}`,
            'aria-pressed': String(val === false), 'data-answer-key': `${q.id}-tf-${sIdx}-false`,
            onclick: () => {
              const next = [...curArr];
              next[sIdx] = false;
              updateResponse(q.id, next, { rerender: true });
            }
          },
          'Sai'
        );

        tbody.append(
          h('tr', {}, stmtCell, h('td', { class: 'col-tf' }, trueBtn), h('td', { class: 'col-tf' }, falseBtn))
        );
      });
      tbl.append(tbody);
      wrap.append(tbl);
      return wrap;
    }

    // 6. Trả lời ngắn (short)
    if (q.type === 'short') {
      const inp = h('input', {
        type: 'text',
        class: `ltch-short-answer-input is-${examType}`,
        'aria-label': `Đáp án câu ${q.displayNumber || ''}`.trim(),
        value: curVal !== undefined && curVal !== null ? String(curVal) : '',
        placeholder:
          examType === 'thptqg'
            ? 'Nhập kết quả số (dùng dấu phẩy , hoặc dấu chấm . cho số thập phân)...'
            : examType === 'hsa'
              ? 'Nhập đáp án...'
              : 'Nhập câu trả lời (gõ ; hoặc Enter để tách ô)...',
        oninput: (e) => {
          updateResponse(q.id, e.target.value);
        }
      });

      if (examType === 'hsa' || examType === 'tsa') {
        wrap.append(
          h(
            'div',
            { class: `ltch-short-answer-box is-${examType}` },
            inp,
            h('p', {
              class: 'ltch-tsa-helper-note',
              text: 'Phân số gõ 3/8. Số thập phân dùng 1,5 hoặc 1.5. Nhiều đáp án: gõ dấu chấm phẩy (;) hoặc Enter để tạo ô riêng.'
            })
          )
        );
        return wrap;
      }

      wrap.append(
        h(
          'div',
          { class: 'ltch-short-answer-box' },
          h('label', { class: 'ltch-short-label', text: 'Đáp án trả lời ngắn:' }),
          inp
        )
      );
      return wrap;
    }

    return wrap;
  }

  // Modal xác nhận nộp bài chuẩn 9Study cho HSA & TSA, chuẩn Bộ GD cho THPTQG
  function openConfirmSubmitModal({ isSectionEnd = false } = {}) {
    const orderedKeysForModal = ['part_1', 'part_2', 'part_3'].filter((k) => state.sectionStates?.[k]);
    const visibleQs = renumberClientExamQuestions(state.visibleQuestions || [], {
      examType: state.examType,
      practiceMode: orderedKeysForModal.length > 1 ? 'full' : state.practiceMode
    });
    const unansweredNums = visibleQs
      .filter((q) => !isQuestionAnswered(q, responses[q.id]))
      .map((q, idx) => q.displayNumber || idx + 1);
    const answeredCount = visibleQs.length - unansweredNums.length;
    const modalExamType = String(state.examType || 'thptqg').toLowerCase();

    const backdrop = h('div', { class: 'ltch-modal-backdrop' });

    if (modalExamType === 'hsa') {
      // Hộp thoại xác nhận kết thúc phần / nộp bài chuẩn 9Study HSA
      const hsaCard = h(
        'div',
        { class: 'ltch-modal-card ltch-hsa-9s-confirm-modal' },
        unansweredNums.length > 0
          ? h('p', {
              class: 'ltch-hsa-9s-unanswered-line',
              text: `Bạn chưa làm câu: ${unansweredNums.join(', ')}`
            })
          : null,
        h('p', {
          class: 'ltch-hsa-9s-confirm-desc',
          text: isSectionEnd
            ? 'Khi đã kết thúc phần thi, bạn sẽ không quay lại phần thi được nữa.'
            : 'Khi đã nộp bài thi, bạn sẽ không thể sửa lại đáp án được nữa.'
        }),
        h('p', {
          class: 'ltch-hsa-9s-confirm-question',
          text: isSectionEnd
            ? 'Bạn chắc chắn KẾT THÚC phần thi này?'
            : 'Bạn chắc chắn NỘP BÀI thi này?'
        }),
        h(
          'div',
          { class: 'ltch-hsa-9s-confirm-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-hsa-9s-btn-yes',
              onclick: () => {
                backdrop.remove();
                if (isSectionEnd) submitCurrentSection();
                else submitFullExam();
              }
            },
            'Có'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-hsa-9s-btn-no',
              onclick: () => backdrop.remove()
            },
            'Không'
          )
        )
      );
      backdrop.append(hsaCard);
      document.body.append(backdrop);
      return;
    }

    if (modalExamType === 'tsa') {
      // Hộp thoại xác nhận nộp phần / nộp bài chuẩn 9Study TSA (vòng tròn vàng cam)
      const tsaCard = h(
        'div',
        { class: 'ltch-modal-card ltch-tsa-9s-confirm-modal' },
        h(
          'div',
          { class: 'ltch-tsa-9s-amber-circle' },
          h('strong', { text: `${answeredCount}/${visibleQs.length}` }),
          h('span', { text: 'câu' })
        ),
        h('p', {
          class: 'ltch-tsa-9s-confirm-text',
          text: isSectionEnd
            ? 'Bạn vẫn còn thời gian làm phần này, bạn có chắc muốn kết thúc phần thi?'
            : 'Bạn vẫn còn thời gian làm bài, bạn có chắc muốn nộp bài thi?'
        }),
        h(
          'div',
          { class: 'ltch-tsa-9s-confirm-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-tsa-9s-btn-continue',
              onclick: () => backdrop.remove()
            },
            'Làm bài tiếp'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-tsa-9s-btn-submit',
              onclick: () => {
                backdrop.remove();
                if (isSectionEnd) submitCurrentSection();
                else submitFullExam();
              }
            },
            isSectionEnd ? 'Nộp phần thi' : 'Nộp bài thi'
          )
        )
      );
      backdrop.append(tsaCard);
      document.body.append(backdrop);
      return;
    }

    // Mặc định THPTQG
    const modalCard = h(
      'div',
      { class: `ltch-modal-card ltch-confirm-submit-modal is-${modalExamType}` },
      h(
        'div',
        { class: 'ltch-modal-header' },
        h('h3', {
          text: isSectionEnd ? 'Xác nhận kết thúc phần thi hiện tại?' : 'Xác nhận nộp bài thi?'
        }),
        h('button', { type: 'button', class: 'ltch-modal-close', onclick: () => backdrop.remove(), text: '×' })
      ),
      h(
        'div',
        { class: 'ltch-modal-body' },
        h('p', {
          class: 'ltch-submit-summary-text',
          text: `Bạn đã hoàn thành ${answeredCount}/${visibleQs.length} câu hỏi trong phần này.`
        }),
        unansweredNums.length > 0
          ? h(
              'div',
              { class: 'ltch-unanswered-warning-box' },
              h('strong', { text: `Còn ${unansweredNums.length} câu chưa trả lời:` }),
              h('div', {
                class: 'ltch-unanswered-nums',
                text: unansweredNums.join(', ')
              })
            )
          : h('div', { class: 'ltch-all-answered-box' }, '✓ Bạn đã trả lời đầy đủ tất cả các câu hỏi.')
      ),
      h(
        'div',
        { class: 'ltch-modal-footer' },
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-outline',
            onclick: () => backdrop.remove()
          },
          'Quay lại làm tiếp'
        ),
        h(
          'button',
          {
            type: 'button',
            class: `ltch-btn ltch-btn-primary is-${modalExamType}`,
            onclick: () => {
              backdrop.remove();
              if (isSectionEnd) submitCurrentSection();
              else submitFullExam();
            }
          },
          isSectionEnd ? 'Xác nhận kết thúc phần' : 'Xác nhận nộp bài'
        )
      )
    );

    backdrop.append(modalCard);
    document.body.append(backdrop);
  }

  // Helper tạo thanh Top Bar chuẩn 9Study HSA
  function buildHsa9StudyTopBar({
    showChevrons = false,
    secOrderNum = 1,
    totalSecs = 1,
    partPillText = '',
    timerNode = null
  } = {}) {
    const leftGroup = h(
      'div',
      { class: 'ltch-hsa-9s-topbar-left' },
      h(
        'button',
        {
          type: 'button',
          class: 'ltch-hsa-9s-check-btn',
          title: 'Thoát phần hiện tại / Đổi phần thi khác',
          onclick: () => {
            syncServerDraft();
            closeAndSwitchMode();
          }
        },
        '✓'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'ltch-hsa-9s-top-exit-btn',
          title: 'Thoát ra để chọn phần thi khác hoặc quay về phòng luyện',
          onclick: () => {
            syncServerDraft();
            closeAndSwitchMode();
          }
        },
        '← Thoát / Đổi phần thi'
      )
    );

    if (showChevrons) {
      const chevronsWrap = h('div', { class: 'ltch-hsa-9s-top-chevrons', 'aria-hidden': 'true' });
      const count = totalSecs > 1 ? 3 : 1;
      for (let i = 1; i <= count; i++) {
        chevronsWrap.append(
          h('span', {
            class: `ltch-hsa-9s-top-chevron${i <= secOrderNum ? ' is-done' : ''}`,
            text: '»'
          })
        );
      }
      chevronsWrap.append(h('span', { class: 'ltch-hsa-9s-top-secnum', text: String(secOrderNum) }));
      leftGroup.append(chevronsWrap);
    }

    const centerGroup = h(
      'div',
      { class: 'ltch-hsa-9s-topbar-center' },
      h('div', {
        class: 'ltch-hsa-9s-top-title',
        text: String(state.examTitle || '[LTCH] ĐỀ THI THỬ ĐÁNH GIÁ NĂNG LỰC HSA').toUpperCase()
      }),
      partPillText
        ? h(
            'div',
            { class: 'ltch-hsa-9s-part-pill-wrap' },
            h('span', { class: 'ltch-hsa-9s-part-pill', text: partPillText })
          )
        : null
    );

    const rightGroup = h('div', { class: 'ltch-hsa-9s-topbar-right' });
    if (timerNode) rightGroup.append(timerNode);
    rightGroup.append(h('span', { class: 'ltch-hsa-9s-avatar', text: avatarInitials }));

    return h(
      'header',
      {
        class: 'ltch-hsa-9s-topbar',
        style: 'width:100%;min-width:100%;align-self:stretch;box-sizing:border-box;'
      },
      leftGroup,
      centerGroup,
      rightGroup
    );
  }

  // Render toàn bộ phòng thi theo examType
  function renderRoom() {
    const focusedAnswerKey = isCompactPracticeLayout() && document.activeElement?.getAttribute('data-answer-key');
    if (focusedAnswerKey) queueMicrotask(() => {
      const next = [...overlay.querySelectorAll('[data-answer-key]')].find(node => node.getAttribute('data-answer-key') === focusedAnswerKey);
      next?.focus({preventScroll: true});
    });
    const prevThptScroll = overlay.querySelector('.ltch-thptqg-questions-stream')?.scrollTop ?? 0;
    const prevHsaScroll = overlay.querySelector('.ltch-hsa-stream')?.scrollTop ?? 0;
    const prevHsaPaletteScroll = overlay.querySelector('.ltch-hsa-top-palette')?.scrollLeft ?? 0;
    const prevTsaPassageScroll = overlay.querySelector('.ltch-tsa-passage-pane')?.scrollTop ?? 0;
    const prevTsaQuestionScroll = overlay.querySelector('.ltch-tsa-question-pane')?.scrollTop ?? 0;

    timerDisplayNodes = [];
    questionTimerNodes = [];
    overlay.replaceChildren();
    overlay.append(createWatermarkLayer(access));

    const offlineBanner = h(
      'div',
      { class: 'ltch-offline-banner', hidden: !isOffline },
      '⚠ Mất kết nối mạng — Hệ thống đang tự động lưu bài làm trên thiết bị của bạn và sẽ đồng bộ ngay khi có mạng lại.'
    );
    overlay.append(offlineBanner);

    const examType = String(state.examType || 'thptqg').toLowerCase();
    const curSec = state.currentSection || 'all';
    const curSecState = state.sectionStates?.[curSec];
    const orderedKeys = ['part_1', 'part_2', 'part_3'].filter((k) => state.sectionStates?.[k]);
    const isFullMultiSection = orderedKeys.length > 1;
    const secOrderNum = Math.max(1, orderedKeys.indexOf(curSec) + 1);

    // ========================================================================
    // MÀN HÌNH CHỌN TỔ HỢP PHẦN 3 & MÀN HÌNH CHỜ 120 GIÂY CHUẨN 9STUDY HSA
    // ========================================================================
    if (examType === 'hsa' && curSecState?.status === 'waiting') {
      // Màn 1: Chọn tổ hợp Phần 3 (11 dòng xanh nhạt / vàng kem + 9 hình thoi xanh lá)
      if (curSec === 'part_3' && !hsaComboConfirmed) {
        const shortNames = { physics: 'LÍ', chemistry: 'HÓA', biology: 'SINH', history: 'SỬ', geography: 'ĐỊA' };
        const comboList = HSA_COMBINATIONS.map(({ code, subjects }) => ({
          code,
          label: code === 'english'
            ? 'TIẾNG ANH'
            : code + ': ' + subjects.map(subject => shortNames[subject]).join(' - ') + ' (TỰ CHỌN)'
        }));

        const comboScreen = h(
          'div',
          { class: 'ltch-hsa-waiting-screen is-combo-picker' },
          buildHsa9StudyTopBar({ showChevrons: false }),
          h(
            'div',
            { class: 'ltch-hsa-9s-combo-screen' },
            createRoomDeviceNotice(),
            h(
              'div',
              { class: 'ltch-hsa-9s-diamonds-row', 'aria-hidden': 'true' },
              ...Array.from({ length: 9 }, () => h('span', { class: 'ltch-hsa-9s-diamond' }))
            ),
            h('h2', {
              class: 'ltch-hsa-9s-combo-title',
              text: 'Kích chọn một trong các phần thi sau đây'
            }),
            h('p', {
              class: 'ltch-hsa-9s-combo-sub',
              text: '(Phần thi được chọn có nền màu kem, phần thi không được chọn có nền màu xanh)'
            }),
            h(
              'div',
              { class: 'ltch-hsa-9s-combo-list' },
              ...comboList.map((item) => {
                const isSel = String(pendingHsaCombo || 'Q01').toUpperCase() === item.code.toUpperCase();
                return h(
                  'button',
                  {
                    type: 'button',
                    class: `ltch-hsa-9s-combo-row${isSel ? ' is-selected' : ''}`,
                    onclick: () => {
                      pendingHsaCombo = item.code;
                      state.selectedCombination = item.code;
                      renderRoom();
                    }
                  },
                  item.label
                );
              })
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'ltch-hsa-9s-confirm-btn',
                onclick: () => {
                  state.selectedCombination = pendingHsaCombo || 'Q01';
                  hsaComboConfirmed = true;
                  renderRoom();
                }
              },
              'XÁC NHẬN'
            )
          )
        );

        overlay.append(comboScreen);
        startClockTicker();
        return;
      }

      // Màn 2: Màn hình chờ 120 giây chuẩn 9Study HSA
      const chosenCombo = state.selectedCombination || pendingHsaCombo || 'Q01';
      const comboObj = HSA_COMBINATIONS.find((c) => c.code.toUpperCase() === chosenCombo.toUpperCase());
      const waitHeadingText =
        curSec === 'part_1'
          ? 'TOÁN HỌC VÀ XỬ LÍ SỐ LIỆU'
          : curSec === 'part_2'
            ? 'NGÔN NGỮ - VĂN HỌC'
            : chosenCombo.toLowerCase() === 'english'
              ? 'TIẾNG ANH'
              : `KHOA HỌC: ${comboObj?.subjects.map(subject => SUBJECT_LABELS[subject].toUpperCase()).join(' - ') || 'TỰ CHỌN'}`;

      const singleIntroPartText =
        curSec === 'part_1'
          ? 'TOÁN HỌC VÀ XỬ LÝ SỐ LIỆU (TƯ DUY ĐỊNH LƯỢNG)'
          : curSec === 'part_2'
            ? 'NGÔN NGỮ - VĂN HỌC (TƯ DUY ĐỊNH TÍNH)'
            : chosenCombo.toLowerCase() === 'english'
              ? 'TIẾNG ANH'
              : 'KHOA HỌC (TỰ CHỌN)';

      const durMinutes = curSecState.durationMinutes || (curSec === 'part_1' ? 75 : 60);

      const timerNode = h('strong', {
        class: 'ltch-hsa-wait-timer',
        'data-timer-mode': 'seconds',
        text: String(getRemainingSeconds())
      });
      timerDisplayNodes.push(timerNode);

      const totalChevrons = isFullMultiSection ? 9 : 3;
      const activeChevrons = isFullMultiSection ? secOrderNum * 3 : 3;

      const waitScreen = h(
        'div',
        { class: 'ltch-hsa-waiting-screen' },
        buildHsa9StudyTopBar({ showChevrons: false }),
        h(
          'div',
          { class: 'ltch-hsa-waiting-card' },
          createRoomDeviceNotice(),
          isFullMultiSection
            ? h(
                'div',
                { class: 'ltch-hsa-9s-wait-intro' },
                h('p', { class: 'ltch-hsa-9s-wait-lead', text: 'Bài thi bao gồm các phần:' }),
                h('p', {
                  class: 'ltch-hsa-9s-wait-partline',
                  text: 'TOÁN HỌC VÀ XỬ LÝ SỐ LIỆU (TƯ DUY ĐỊNH LƯỢNG)'
                }),
                h('p', {
                  class: 'ltch-hsa-9s-wait-partline',
                  text: 'NGÔN NGỮ - VĂN HỌC (TƯ DUY ĐỊNH TÍNH)'
                }),
                h('p', {
                  class: 'ltch-hsa-9s-wait-partline',
                  text: 'KHOA HỌC hoặc TIẾNG ANH'
                }),
                h('p', {
                  class: 'ltch-hsa-9s-wait-seqnote',
                  text: 'Bạn phải làm tuần tự các phần thi ở trên và không thể quay lại phần thi đã làm trước đó.'
                })
              )
            : h(
                'div',
                { class: 'ltch-hsa-9s-wait-intro' },
                h('p', { class: 'ltch-hsa-9s-wait-lead', text: 'Bài thi gồm phần:' }),
                h('p', { class: 'ltch-hsa-9s-wait-partline', text: singleIntroPartText })
              ),
          h(
            'div',
            { class: 'ltch-hsa-arrows-row', 'aria-hidden': 'true' },
            ...Array.from({ length: totalChevrons }, (_, i) =>
              h('span', {
                class: `ltch-hsa-9s-wait-chevron${i < activeChevrons ? ' is-active' : ' is-muted'}`,
                text: '»'
              })
            )
          ),
          h('h2', { class: 'ltch-hsa-waiting-part', text: waitHeadingText }),
          h(
            'div',
            { class: 'ltch-hsa-9s-wait-meta' },
            h(
              'p',
              {},
              isFullMultiSection
                ? `Thời gian hoàn thành phần thi thứ ${secOrderNum}: `
                : 'Thời gian hoàn thành bài thi: ',
              h('strong', { text: `${durMinutes} phút` })
            ),
            h('p', {}, 'Tổng điểm phần thi này: ', h('strong', { text: '50 điểm' }))
          ),
          h(
            'div',
            { class: 'ltch-hsa-9s-logo-blocks', 'aria-hidden': 'true' },
            h('span', { class: 'ltch-hsa-9s-logo-block is-h', text: 'H' }),
            h('span', { class: 'ltch-hsa-9s-logo-block is-s', text: 'S' }),
            h('span', { class: 'ltch-hsa-9s-logo-block is-a', text: 'A' })
          ),
          h(
            'div',
            { class: 'ltch-hsa-9s-wait-note' },
            h('p', {
              text: isFullMultiSection
                ? `Phần ${secOrderNum} tự động bắt đầu sau 120 giây.`
                : 'Bài thi tự động bắt đầu sau 120 giây.'
            }),
            h('p', {
              text: 'Nếu đã sẵn sàng, bạn có thể bấm nút <BẮT ĐẦU> dưới đây để bắt đầu phần thi.'
            })
          ),
          h('div', { class: 'ltch-hsa-wait-countdown-box' }, timerNode),
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-btn ltch-btn-hsa-start',
              onclick: () => startCurrentSection(chosenCombo)
            },
            'BẮT ĐẦU'
          ),
          isFullMultiSection
            ? h('div', { class: 'ltch-hsa-9s-wait-step', text: `Phần ${secOrderNum}/${orderedKeys.length}` })
            : null
        )
      );

      overlay.append(waitScreen);
      startClockTicker();
      return;
    }

    const visibleQs = renumberClientExamQuestions(state.visibleQuestions || [], {
      examType,
      practiceMode: isFullMultiSection ? 'full' : state.practiceMode
    });
    state.visibleQuestions = visibleQs;

    // ========================================================================
    // PHÒNG THI 1: THPTQG (BỐ CỤC 2 CỘT - TRÁI ĐỀ THEO PHẦN I, II, III - PHẢI BẢNG 22 CÂU)
    // ========================================================================
    if (examType === 'thptqg') {
      const timerNode = h('strong', {
        class: 'ltch-thptqg-timer-digits',
        text: formatDurationClock(getRemainingSeconds())
      });
      timerDisplayNodes.push(timerNode);

      const header = h(
        'header',
        { class: 'ltch-room-header is-thptqg' },
        h(
          'div',
          { class: 'ltch-room-header-left' },
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-btn ltch-btn-ghost',
              onclick: () => {
                syncServerDraft();
                closeRoomToLobby();
              }
            },
            '← Quay lại'
          ),
          h('span', { class: 'ltch-brand-pill is-thptqg', text: '[LTCH] THPTQG' }),
          h('h1', { class: 'ltch-room-title', text: state.examTitle || 'Đề thi thử THPTQG môn Toán' })
        ),
        h(
          'div',
          { class: 'ltch-room-header-right' },
          state.isPreview ? h('span', { class: 'badge badge-warning', text: 'Chế độ Giáo viên làm thử' }) : null,
          h('span', { class: 'ltch-candidate-tag', text: `Thí sinh: ${access?.displayName || 'Học sinh'}` })
        )
      );

      const leftStream = h('main', { class: 'ltch-thptqg-questions-stream' });
      const sections = [
        ['part_1', 'Phần I. Câu trắc nghiệm nhiều phương án lựa chọn (0,25 điểm / câu)'],
        ['part_2', 'Phần II. Câu trắc nghiệm Đúng / Sai (Tối đa 1,0 điểm / câu: đúng 1 ý 0,1đ; 2 ý 0,25đ; 3 ý 0,5đ; 4 ý 1,0đ)'],
        ['part_3', 'Phần III. Câu trắc nghiệm trả lời ngắn (0,5 điểm / câu)']
      ];

      for (const [secKey, secHeading] of sections) {
        const secQs = visibleQs.filter((q) => (q.section || 'part_1') === secKey);
        if (!secQs.length) continue;
        leftStream.append(h('div', { class: 'ltch-thptqg-section-banner', text: secHeading }));

        for (const q of secQs) {
          const num = q.displayNumber || 1;
          const isFlagged = flaggedSet.has(q.id);
          const card = h(
            'article',
            { id: `ltch-exam-q-${q.id}`, class: 'ltch-exam-q-card' },
            h(
              'div',
              { class: 'ltch-exam-q-card-head' },
              h(
                'div',
                { class: 'ltch-exam-q-head-left' },
                h('span', { class: 'ltch-q-number-badge', text: `Câu ${num}` }),
                q.questionCode ? h('span', { class: 'ltch-q-code-badge', text: `#${q.questionCode}` }) : null
              ),
              h(
                'div',
                { class: 'ltch-exam-q-head-right' },
                h(
                  'button',
                  {
                    type: 'button',
                    class: `ltch-flag-btn${isFlagged ? ' is-flagged' : ''}`,
                    onclick: () => toggleFlagQuestion(q.id)
                  },
                  isFlagged ? '⚑ Đã đánh dấu' : '⚐ Đánh dấu'
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'ltch-report-btn',
                    onclick: () =>
                      openReportQuestionModal({
                        api,
                        status,
                        attemptId: state.attemptId,
                        examId: state.examId,
                        question: q
                      })
                  },
                  'Báo lỗi'
                )
              )
            ),
            renderInteractiveQuestionBody(q, 'thptqg')
          );
          leftStream.append(card);
        }
      }

      const answeredCount = visibleQs.filter((q) => isQuestionAnswered(q, responses[q.id])).length;
      const pct = visibleQs.length > 0 ? Math.round((answeredCount / visibleQs.length) * 100) : 0;

      const paletteGrid = h('div', { class: 'ltch-thptqg-palette-grid' });
      visibleQs.forEach((q, idx) => {
        const num = q.displayNumber || idx + 1;
        const ans = isQuestionAnswered(q, responses[q.id]);
        const partial = !ans && isQuestionPartiallyAnswered(q, responses[q.id]);
        const flagged = flaggedSet.has(q.id);
        paletteGrid.append(
          h(
            'button',
            {
              type: 'button',
              'data-palette-qid': q.id,
              class: `ltch-palette-cell${ans ? ' is-answered' : ''}${partial ? ' is-partial' : ''}${flagged ? ' is-flagged' : ''}`,
              text: String(num),
              onclick: () => {
                setCompactPaletteOpen(false);
                const target = document.getElementById(`ltch-exam-q-${q.id}`);
                focusQuestionCard(target);
              }
            }
          )
        );
      });

      const rightSidebar = h(
        'aside',
        { class: 'ltch-thptqg-sidebar' },
        h(
          'div',
          { class: 'ltch-thptqg-timer-card' },
          h('span', { class: 'ltch-timer-caption', text: 'Thời gian còn lại' }),
          timerNode,
          h(
            'div',
            { class: 'ltch-progress-block' },
            h('span', {
              'data-ltch-progress-text': '1',
              text: `Đã làm: ${answeredCount}/${visibleQs.length} câu`
            }),
            h(
              'div',
              { class: 'ltch-progress-track' },
              h('div', {
                'data-ltch-progress-bar': '1',
                class: 'ltch-progress-fill',
                style: `width:${pct}%`
              })
            )
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-btn ltch-btn-primary ltch-btn-wide',
              onclick: () => openConfirmSubmitModal({ isSectionEnd: false })
            },
            'Nộp bài'
          )
        ),
        h(
          'div',
          { class: 'ltch-thptqg-palette-card' },
          h('h2', { class: 'ltch-thptqg-palette-title', text: 'Bảng câu hỏi' }),
          h(
            'div',
            { class: 'ltch-palette-legend' },
            h('span', { class: 'legend-item is-unanswered', text: 'Chưa làm' }),
            h('span', { class: 'legend-item is-answered', text: 'Đã làm' }),
            h('span', { class: 'legend-item is-flagged', text: 'Đánh dấu' })
          ),
          paletteGrid
        )
      );

      overlay.append(header, createCompactControls(visibleQs, rightSidebar), h('div', { class: 'ltch-thptqg-layout' }, leftStream, rightSidebar));
      if (prevThptScroll > 0) leftStream.scrollTop = prevThptScroll;
      startClockTicker();
      return;
    }

    // ========================================================================
    // PHÒNG THI 2: HSA CHUẨN 9STUDY (TOP BAR XÁM + PALETTE TRÒN + CHÙM 2 CỘT TÍM LAVENDER)
    // ========================================================================
    if (examType === 'hsa') {
      const timerNode = h('strong', {
        class: 'ltch-hsa-timer-pill',
        text: formatDurationClock(getRemainingSeconds())
      });
      timerDisplayNodes.push(timerNode);

      const hasNextLockedSection = orderedKeys.some((k) => state.sectionStates?.[k]?.status === 'locked');

      const partPillText =
        curSec === 'part_1'
          ? 'TOÁN HỌC VÀ XỬ LÝ SỐ LIỆU (TƯ DUY ĐỊNH LƯỢNG)'
          : curSec === 'part_2'
            ? 'NGÔN NGỮ - VĂN HỌC (TƯ DUY ĐỊNH TÍNH)'
            : String(state.selectedCombination || '').toLowerCase() === 'english'
              ? 'TIẾNG ANH'
              : 'KHOA HỌC (TỰ CHỌN)';

      const topPaletteRow = h('div', { class: 'ltch-hsa-top-palette' });
      visibleQs.forEach((q, idx) => {
        const num = q.displayNumber || idx + 1;
        const ans = isQuestionAnswered(q, responses[q.id]);
        topPaletteRow.append(
          h(
            'button',
            {
              type: 'button',
              'data-palette-qid': q.id,
              class: `ltch-hsa-top-pill${ans ? ' is-answered' : ''}`,
              text: String(num),
              onclick: () => {
                const target = document.getElementById(`ltch-exam-q-${q.id}`);
                focusQuestionCard(target);
              }
            }
          )
        );
      });

      const hsaHeader = h(
        'div',
        { class: 'ltch-hsa-sticky-header' },
        buildHsa9StudyTopBar({
          showChevrons: true,
          secOrderNum,
          totalSecs: orderedKeys.length || 1,
          partPillText,
          timerNode
        }),
        h(
          'div',
          { class: 'ltch-hsa-9s-palette-bar' },
          topPaletteRow,
          h(
            'div',
            { class: 'ltch-hsa-9s-submit-row' },
            h(
              'button',
              {
                type: 'button',
                class: 'ltch-btn ltch-btn-hsa-submit',
                onclick: () => openConfirmSubmitModal({ isSectionEnd: hasNextLockedSection })
              },
              hasNextLockedSection ? 'KẾT THÚC PHẦN' : 'NỘP BÀI'
            )
          )
        )
      );

      const stream = h('main', {
        class: 'ltch-hsa-stream'
      });
      const deviceNotice = createRoomDeviceNotice();
      if (deviceNotice) stream.append(deviceNotice);

      const buildHsaQuestionItem = (q, idx) => {
        const num = q.displayNumber || idx + 1;
        return h(
          'article',
          { id: `ltch-exam-q-${q.id}`, class: 'ltch-hsa-question-card' },
          h(
            'div',
            { class: 'ltch-hsa-q-header' },
            h(
              'div',
              { class: 'ltch-hsa-q-header-left' },
              h('strong', { class: 'ltch-hsa-q-num', text: `Câu ${num}.` })
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'ltch-report-btn is-hsa-9s',
                onclick: () =>
                  openReportQuestionModal({
                    api,
                    status,
                    attemptId: state.attemptId,
                    examId: state.examId,
                    question: q
                  })
              },
              'Báo lỗi ⚑'
            )
          ),
          renderInteractiveQuestionBody(q, 'hsa')
        );
      };

      // Gom các câu hỏi cùng ngữ liệu (passage) thành khung 2 cột (Trái: Ngữ liệu nền tím lavender, Phải: Chùm câu hỏi)
      let i = 0;
      while (i < visibleQs.length) {
        const q = visibleQs[i];
        const pKey = q.passageContent ? q.passageId || q.clusterId || q.passageContent.slice(0, 120) : '';
        if (pKey) {
          const clusterGroup = [];
          while (
            i < visibleQs.length &&
            (visibleQs[i].passageContent
              ? visibleQs[i].passageId || visibleQs[i].clusterId || visibleQs[i].passageContent.slice(0, 120)
              : '') === pKey
          ) {
            clusterGroup.push({ q: visibleQs[i], idx: i });
            i++;
          }
          const firstNum = clusterGroup[0].q.displayNumber || clusterGroup[0].idx + 1;
          const lastNum =
            clusterGroup[clusterGroup.length - 1].q.displayNumber ||
            clusterGroup[clusterGroup.length - 1].idx + 1;

          const passageBox = h('div', { class: 'ltch-hsa-passage-cluster' });
          const passageBody = h('div', { class: 'ltch-passage-body' });
          renderRichMathBlock(passageBody, q.passageContent, q.passageMedia || []);
          passageBox.append(
            h('div', {
              class: 'ltch-hsa-passage-title',
              text: firstNum !== lastNum ? `Câu ${firstNum} - ${lastNum}:` : `Câu ${firstNum}:`
            }),
            passageBody
          );

          const rightCol = h(
            'div',
            { class: 'ltch-hsa-cluster-questions' },
            ...clusterGroup.map((item) => buildHsaQuestionItem(item.q, item.idx))
          );

          stream.append(h('div', { class: 'ltch-hsa-cluster-row' }, passageBox, rightCol));
        } else {
          stream.append(
            h('div', { class: 'ltch-hsa-standalone-wrap' }, buildHsaQuestionItem(q, i))
          );
          i++;
        }
      }

      stream.append(
        h(
          'div',
          { class: 'ltch-hsa-bottom-submit-wrap' },
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-btn ltch-btn-hsa-submit is-bottom',
              onclick: () => openConfirmSubmitModal({ isSectionEnd: hasNextLockedSection })
            },
            hasNextLockedSection ? 'KẾT THÚC PHẦN' : 'NỘP BÀI'
          )
        )
      );

      overlay.append(hsaHeader, stream);
      topPaletteRow.scrollLeft = prevHsaPaletteScroll;
      if (prevHsaScroll > 0) stream.scrollTop = prevHsaScroll;
      startClockTicker();
      return;
    }

    // ========================================================================
    // PHÒNG THI 3: TSA CHUẨN 9STUDY (HEADER TRẮNG + FOOTER NAVY + SIDEBAR 3 CARD)
    // ========================================================================
    const safeIdx = Math.max(0, Math.min(currentQuestionIndex, Math.max(0, visibleQs.length - 1)));
    currentQuestionIndex = safeIdx;
    const activeQ = visibleQs[safeIdx] || null;
    if (activeQ) viewedSet.add(activeQ.id);

    const timerNode = h('strong', {
      class: 'ltch-tsa-timer-digits',
      'data-timer-mode': 'spaced',
      text: formatDurationClock(getRemainingSeconds()).replace(/:/g, ' : ')
    });
    timerDisplayNodes.push(timerNode);

    const hasNextLockedSection = orderedKeys.some((k) => state.sectionStates?.[k]?.status === 'locked');

    const tsaSectionTitleMap = {
      part_1: isFullMultiSection ? 'TSA – Phần 1/3: Tư duy Toán học' : 'TSA – Phần thi Tư duy Toán học',
      part_2: isFullMultiSection ? 'TSA – Phần 2/3: Đọc hiểu' : 'TSA – Phần thi Đọc hiểu',
      part_3: isFullMultiSection ? 'TSA – Phần 3/3: Giải quyết vấn đề' : 'TSA – Phần thi Giải quyết vấn đề'
    };
    const activeQNum = activeQ ? activeQ.displayNumber || safeIdx + 1 : 1;
    const formattedCode5 = String(activeQNum).padStart(5, '0');

    const tsaHeader = h(
      'header',
      { class: 'ltch-tsa-header' },
      h(
        'div',
        { class: 'ltch-tsa-header-left' },
        h('span', { class: 'ltch-tsa-9s-logo', text: 'TSA' }),
        h('span', { class: 'ltch-tsa-9s-header-sep', 'aria-hidden': 'true', text: '|' }),
        h('span', {
          class: 'ltch-tsa-part-title',
          text: tsaSectionTitleMap[curSec] || SECTION_LABELS.tsa[curSec] || 'TSA – Phần thi Đánh giá tư duy'
        }),
        h('span', { class: 'ltch-tsa-9s-qcode', text: formattedCode5 })
      ),
      h(
        'div',
        { class: 'ltch-tsa-header-right' },
        h('span', {
          class: 'ltch-tsa-9s-exam-name',
          text: state.examTitle || '[LTCH] ĐỀ THI THỬ ĐÁNH GIÁ TƯ DUY TSA'
        }),
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-tsa-9s-exit-btn',
            'aria-label': 'Thoát hoặc đổi phần thi',
            onclick: () => {
              syncServerDraft();
              closeAndSwitchMode();
            }
          },
          h('span', {class: 'ltch-exit-label-long', text: '← Thoát / Đổi phần thi'}),
          h('span', {class: 'ltch-exit-label-short', text: '← Thoát'})
        )
      )
    );

    const hasSplitPassage = Boolean(
      activeQ && (activeQ.passageContent || curSec === 'part_2' || curSec === 'part_3') && activeQ.passageContent
    );

    const getClusterKey = (q) =>
      q ? q.passageId || q.clusterId || (q.passageContent ? q.passageContent.slice(0, 120) : '') : '';
    const activeClusterKey = hasSplitPassage ? getClusterKey(activeQ) : '';
    const clusterQuestions =
      hasSplitPassage && activeClusterKey
        ? visibleQs.filter((q) => getClusterKey(q) === activeClusterKey)
        : activeQ
          ? [activeQ]
          : [];
    clusterQuestions.forEach((q) => viewedSet.add(q.id));

    activeTsaElapsedKey =
      curSec === 'part_2' && activeClusterKey
        ? `passage_${activeClusterKey}`
        : activeQ
          ? `q_${activeQ.id}`
          : '';

    const centerWorkspace = h('div', {
      class: `ltch-tsa-center-workspace${hasSplitPassage ? ' is-split-pane' : ''}`
    });

    if (hasSplitPassage) {
      overlay.classList.toggle('is-compact-reading', compactPassageOpen);
      const tabs = h('div', {class: 'ltch-compact-passage-tabs', role: 'group', 'aria-label': 'Vùng đọc và trả lời'});
      for (const [reading, label] of [[true, 'Ngữ liệu'], [false, 'Câu hỏi']]) {
        tabs.append(h('button', {
          type: 'button', text: label, 'aria-pressed': String(compactPassageOpen === reading),
          onclick: () => {
            compactPassageOpen = reading;
            overlay.classList.toggle('is-compact-reading', reading);
            tabs.querySelectorAll('button').forEach((btn, idx) => btn.setAttribute('aria-pressed', String(reading === (idx === 0))));
          }
        }));
      }
      centerWorkspace.append(tabs);
    }

    let passagePaneEl = null;
    if (hasSplitPassage && activeQ) {
      const firstClusterNum = clusterQuestions[0]?.displayNumber || activeQNum;
      const lastClusterNum =
        clusterQuestions[clusterQuestions.length - 1]?.displayNumber || activeQNum;
      const tsaPassageHeading =
        firstClusterNum !== lastClusterNum
          ? `NGỮ LIỆU (CÂU ${firstClusterNum} – ${lastClusterNum})`
          : `NGỮ LIỆU (CÂU ${firstClusterNum})`;
      passagePaneEl = h('div', { class: 'ltch-tsa-passage-pane' });
      const passageBody = h('div', { class: 'ltch-passage-body' });
      renderRichMathBlock(passageBody, activeQ.passageContent, activeQ.passageMedia || []);
      passagePaneEl.append(
        h('div', { class: 'ltch-tsa-pane-label', text: tsaPassageHeading }),
        passageBody
      );
      centerWorkspace.append(passagePaneEl);
    }

    const questionPane = h('div', { class: 'ltch-tsa-question-pane' });
    const deviceNotice = createRoomDeviceNotice();
    if (deviceNotice) questionPane.append(deviceNotice);
    if (clusterQuestions.length > 0) {
      clusterQuestions.forEach((q) => {
        const qIdx = visibleQs.indexOf(q);
        const num = q.displayNumber || qIdx + 1;
        const isQFlagged = flaggedSet.has(q.id);
        const isQActive = activeQ && q.id === activeQ.id;

        const bookmarkIcon = h('span', { class: 'ltch-tsa-bookmark-svg', 'aria-hidden': 'true' });
        bookmarkIcon.innerHTML =
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';

        const circleBadge = h('span', {
          class: `ltch-tsa-9s-q-circle${isQActive ? ' is-active' : ''}`,
          text: String(num)
        });

        const qCard = h(
          'article',
          {
            id: `ltch-tsa-q-${q.id}`,
            class: `ltch-tsa-q-card${isQActive ? ' is-active-q' : ''}`,
            onclick: () => {
              if (currentQuestionIndex !== qIdx) {
                currentQuestionIndex = qIdx;
                renderRoom();
              }
            }
          },
          h(
            'div',
            { class: 'ltch-tsa-q-head' },
            h('div', { class: 'ltch-tsa-q-head-left' }),
            h(
              'div',
              { class: 'ltch-tsa-q-head-right' },
              h(
                'button',
                {
                  type: 'button',
                  class: `ltch-flag-btn is-tsa-bookmark${isQFlagged ? ' is-flagged' : ''}`,
                  title: isQFlagged ? 'Bỏ đánh dấu câu hỏi' : 'Đánh dấu câu hỏi',
                  'aria-label': isQFlagged ? 'Bỏ đánh dấu câu hỏi' : 'Đánh dấu câu hỏi',
                  'aria-pressed': String(isQFlagged),
                  onclick: (e) => {
                    e.stopPropagation();
                    toggleFlagQuestion(q.id);
                  }
                },
                bookmarkIcon
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'ltch-report-btn is-tsa-9s',
                  onclick: (e) => {
                    e.stopPropagation();
                    openReportQuestionModal({
                      api,
                      status,
                      attemptId: state.attemptId,
                      examId: state.examId,
                      question: q
                    });
                  }
                },
                '⚠ Báo lỗi'
              )
            )
          ),
          renderInteractiveQuestionBody(q, 'tsa', { badgeNode: circleBadge })
        );
        questionPane.append(qCard);
      });
    } else {
      questionPane.append(h('p', { class: 'meta', text: 'Không có câu hỏi trong phần này.' }));
    }
    centerWorkspace.append(questionPane);

    // Thanh điều hướng dưới cùng của vùng làm bài (Footer: < | Câu tiếp > | Thời gian làm câu hiện tại | ☾)
    const elapsedDigitsNode = h('strong', {
      class: 'ltch-tsa-9s-elapsed-digits',
      text: formatQuestionElapsed(questionElapsedMap[activeTsaElapsedKey] || 0)
    });
    questionTimerNodes.push(elapsedDigitsNode);

    const tsaFooter = h(
      'footer',
      { class: 'ltch-tsa-footer' },
      h(
        'div',
        { class: 'ltch-tsa-footer-nav' },
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-tsa-9s-prev-btn',
            disabled: safeIdx <= 0,
            title: 'Câu trước',
            'aria-label': 'Câu trước',
            onclick: () => {
              if (safeIdx > 0) {
                currentQuestionIndex = safeIdx - 1;
                selectedDragCardToken = null;
                selectedDragCardQId = null;
                pendingTsaScrollToQId = visibleQs[currentQuestionIndex]?.id || null;
                renderRoom();
              }
            }
          },
          '‹'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-tsa-9s-next-btn',
            disabled: safeIdx >= visibleQs.length - 1,
            onclick: () => {
              if (safeIdx < visibleQs.length - 1) {
                currentQuestionIndex = safeIdx + 1;
                selectedDragCardToken = null;
                selectedDragCardQId = null;
                pendingTsaScrollToQId = visibleQs[currentQuestionIndex]?.id || null;
                renderRoom();
              }
            }
          },
          'Câu tiếp  ›'
        ),
        h(
          'span',
          { class: 'ltch-tsa-9s-elapsed-wrap' },
          h('span', {
            text:
              curSec === 'part_2'
                ? 'Thời gian làm bài đọc hiện tại '
                : 'Thời gian làm câu hiện tại '
          }),
          elapsedDigitsNode
        )
      )
    );

    const mainLeftCol = h('div', { class: 'ltch-tsa-main-col' }, centerWorkspace, tsaFooter);

    // Sidebar phải 3 Card chuẩn 9Study TSA
    const answeredCount = visibleQs.filter((q) => isQuestionAnswered(q, responses[q.id])).length;
    const unansweredCount = Math.max(0, visibleQs.length - answeredCount);
    const flaggedCount = visibleQs.filter((q) => flaggedSet.has(q.id)).length;
    const pct = visibleQs.length > 0 ? Math.round((answeredCount / visibleQs.length) * 100) : 0;

    const tsaGrid = h('div', { class: 'ltch-tsa-palette-grid' });
    visibleQs.forEach((q, idx) => {
      const num = q.displayNumber || idx + 1;
      const ans = isQuestionAnswered(q, responses[q.id]);
      const flagged = flaggedSet.has(q.id);
      const isCurrent = idx === safeIdx;
      tsaGrid.append(
        h(
          'button',
          {
            type: 'button',
            'data-palette-qid': q.id,
            class: `ltch-tsa-grid-btn${isCurrent ? ' is-current' : ''}${ans ? ' is-answered' : ''}${flagged ? ' is-flagged' : ''}`,
            text: String(num),
            onclick: () => {
              compactPassageOpen = false;
              setCompactPaletteOpen(false);
              currentQuestionIndex = idx;
              selectedDragCardToken = null;
              selectedDragCardQId = null;
              pendingTsaScrollToQId = q.id;
              renderRoom();
            }
          }
        )
      );
    });

    const tsaSidebar = h(
      'aside',
      { class: 'ltch-tsa-sidebar' },
      h(
        'div',
        { class: 'ltch-tsa-candidate-card' },
        h('h4', { class: 'ltch-tsa-9s-card-title', text: 'Thông tin thí sinh' }),
        h(
          'div',
          { class: 'ltch-tsa-9s-info-row' },
          h('span', { text: 'Họ tên' }),
          h('strong', { text: access?.displayName || 'Học sinh' })
        ),
        h(
          'div',
          { class: 'ltch-tsa-9s-info-row' },
          h('span', { text: 'Ngày sinh' }),
          h('strong', { text: access?.birthDate || access?.studentCode || '04/06/2008' })
        ),
        h(
          'div',
          { class: 'ltch-tsa-9s-timer-block' },
          h('span', { class: 'ltch-tsa-9s-timer-label', text: '🕒 THỜI GIAN CÒN LẠI' }),
          timerNode
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-tsa-submit',
            onclick: () => openConfirmSubmitModal({ isSectionEnd: hasNextLockedSection })
          },
          hasNextLockedSection ? 'Nộp phần' : 'Nộp bài'
        )
      ),
      h(
        'div',
        { class: 'ltch-tsa-color-indicator-card' },
        h('span', { class: 'ltch-tsa-9s-ind-label', text: 'Chỉ thị màu sắc:' }),
        h(
          'div',
          { class: 'ltch-tsa-9s-ind-badges' },
          h('span', {
            class: 'ltch-tsa-9s-ind-dot is-unanswered',
            'data-tsa-ind-unanswered': '1',
            title: 'Chưa trả lời',
            text: String(unansweredCount)
          }),
          h('span', {
            class: 'ltch-tsa-9s-ind-dot is-answered',
            'data-tsa-ind-answered': '1',
            title: 'Đã trả lời',
            text: String(answeredCount)
          }),
          h('span', {
            class: 'ltch-tsa-9s-ind-dot is-current',
            title: 'Đang làm',
            text: '1'
          }),
          h('span', {
            class: 'ltch-tsa-9s-ind-dot is-flagged',
            title: 'Đánh dấu',
            text: String(flaggedCount)
          })
        )
      ),
      h('div', { class: 'ltch-tsa-palette-card' }, tsaGrid),
      h(
        'div',
        { class: 'ltch-tsa-sidebar-footer' },
        h(
          'div',
          { class: 'ltch-tsa-9s-prog-head' },
          h('span', { text: 'Bạn đã hoàn thành' }),
          h(
            'span',
            {},
            h('strong', { 'data-ltch-progress-text': '1', text: `${answeredCount}/${visibleQs.length}` }),
            ' câu'
          )
        ),
        h(
          'div',
          { class: 'ltch-tsa-9s-prog-row' },
          h(
            'div',
            { class: 'ltch-progress-track is-tsa-9s' },
            h('div', {
              'data-ltch-progress-bar': '1',
              class: 'ltch-progress-fill is-tsa-9s',
              style: `width:${pct}%`
            })
          ),
          h('span', { 'data-ltch-progress-pct': '1', class: 'ltch-tsa-9s-prog-pct', text: `${pct}%` })
        ),
        h('div', { class: 'ltch-tsa-9s-conn-status', text: '● Đã kết nối' })
      )
    );

    overlay.append(
      tsaHeader,
      createCompactControls(visibleQs, tsaSidebar, hasNextLockedSection),
      h('div', { class: 'ltch-tsa-body-layout' }, mainLeftCol, tsaSidebar)
    );

    // Nếu vừa chuyển phần trong bài thi TSA 3 phần -> Hiển thị bảng "Thông tin bài thi" chuẩn 9Study TSA
    if (tsaSectionGateOpen) {
      const partMetaList = [
        { key: 'part_1', title: '1. TSA – Phần thi Tư duy Toán học', dur: 60 },
        { key: 'part_2', title: '2. TSA – Phần thi Đọc hiểu', dur: 30 },
        { key: 'part_3', title: '3. TSA – Phần thi Giải quyết vấn đề', dur: 60 }
      ];
      const gateBackdrop = h(
        'div',
        { class: 'ltch-modal-backdrop ltch-practice-entry-backdrop is-tsa-gate' },
        createPracticeEntryModal([
          h('div', { class: 'ltch-tsa-9s-modal-logo', text: 'TSA' }),
          h('div', { class: 'ltch-tsa-9s-modal-subtitle', text: 'KỲ THI ĐÁNH GIÁ TƯ DUY' }),
          h('h3', { class: 'ltch-tsa-9s-modal-heading', text: 'Thông tin bài thi' }),
          h(
            'div',
            { class: 'ltch-tsa-9s-meta-table' },
            h(
              'div',
              { class: 'ltch-tsa-9s-meta-row' },
              h('span', { text: 'Họ tên' }),
              h('strong', { text: access?.displayName || 'Học sinh' })
            ),
            h(
              'div',
              { class: 'ltch-tsa-9s-meta-row' },
              h('span', { text: 'Ngày sinh' }),
              h('strong', { text: access?.birthDate || access?.studentCode || '04/06/2008' })
            ),
            h(
              'div',
              { class: 'ltch-tsa-9s-meta-row' },
              h('span', { text: 'Môn thi' }),
              h('strong', { text: state.examTitle || 'Đề thi Đánh giá tư duy TSA' })
            ),
            h(
              'div',
              { class: 'ltch-tsa-9s-meta-row' },
              h('span', { text: 'Phần thi' }),
              h('strong', {
                text:
                  curSec === 'part_1'
                    ? 'TSA - Tư duy Toán học'
                    : curSec === 'part_2'
                      ? 'TSA - Đọc hiểu'
                      : 'TSA - Khoa học/Giải quyết vấn đề'
              })
            ),
            h(
              'div',
              { class: 'ltch-tsa-9s-meta-row' },
              h('span', { text: 'Thời gian' }),
              h('strong', { text: `${curSecState?.durationMinutes || (curSec === 'part_2' ? 30 : 60)} phút` })
            )
          ),
          h('h4', { class: 'ltch-tsa-9s-sec-heading', text: 'Chọn phần thi' }),
          h(
            'div',
            { class: 'ltch-tsa-9s-sec-list' },
            ...partMetaList.map((pm) => {
              const stObj = state.sectionStates?.[pm.key];
              const stStatus = stObj?.status || 'locked';
              const isCurrentSec = pm.key === curSec;
              const isDoneSec = stStatus === 'submitted';
              return h(
                'div',
                { class: `ltch-tsa-9s-sec-item${isCurrentSec ? ' is-active' : ''}${isDoneSec ? ' is-done' : ''}` },
                h('div', { class: 'ltch-tsa-9s-sec-title', text: pm.title }),
                h(
                  'div',
                  { class: 'ltch-tsa-9s-sec-bottom' },
                  h('span', { class: 'ltch-tsa-9s-sec-dur', text: `Thời gian: ${stObj?.durationMinutes || pm.dur} phút` }),
                  h(
                    'div',
                    { class: 'ltch-tsa-9s-sec-actions' },
                    h('span', {
                      class: `ltch-tsa-9s-sec-status${isDoneSec ? ' is-done' : ''}`,
                      text: isDoneSec ? 'Đã làm' : isCurrentSec ? 'Chưa thi' : 'Chưa mở'
                    }),
                    isCurrentSec
                      ? h(
                          'button',
                          {
                            type: 'button',
                            class: 'ltch-tsa-9s-sec-btn is-red',
                            onclick: () => {
                              tsaSectionGateOpen = false;
                              renderRoom();
                            }
                          },
                          'Làm phần này'
                        )
                      : h(
                          'span',
                          { class: 'ltch-tsa-9s-sec-btn is-disabled' },
                          isDoneSec ? 'Đã nộp' : 'Chưa mở'
                        )
                  )
                )
              );
            })
          )
        ], [
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-tsa-9s-home-link',
              onclick: () => {
                syncServerDraft();
                closeRoomToLobby();
              }
            },
            'Về trang chủ'
          )
        ])
      );
      overlay.append(gateBackdrop);
    }

    const curClusterKey = activeClusterKey || (activeQ ? `single_${activeQ.id}` : '');
    if (prevTsaClusterKey === curClusterKey) {
      if (passagePaneEl && prevTsaPassageScroll > 0) {
        passagePaneEl.scrollTop = prevTsaPassageScroll;
      }
      if (prevTsaQuestionScroll > 0) {
        questionPane.scrollTop = prevTsaQuestionScroll;
      }
    }
    prevTsaClusterKey = curClusterKey;

    if (pendingTsaScrollToQId) {
      const targetId = `ltch-tsa-q-${pendingTsaScrollToQId}`;
      pendingTsaScrollToQId = null;
      const targetCard = document.getElementById(targetId);
      if (targetCard && clusterQuestions.length > 1) {
        requestAnimationFrame(() => {
          focusQuestionCard(targetCard);
        });
      }
    }

    startClockTicker();
  }

  renderRoom();
  return () => {
    cleanupListeners();
    overlay.remove();
    document.body.classList.remove('ltch-exam-body-lock');
  };
}

async function readFileAsBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
  }
  return btoa(binary);
}

async function uploadAndSavePracticeExam({
  api,
  action = 'save_draft',
  allowPartialStructure = false,
  examId = null,
  isNewExam = true,
  examType = 'thptqg',
  examMode = 'full',
  targetGrade = 12,
  schoolYearId = null,
  examCode = '01',
  title,
  durationMinutes = 90,
  uploadedSourceFiles = [],
  stagedSourceFiles = [],
  questions = [],
  onProgress = null
}) {
  let nextExamId = examId;
  let nextIsNew = isNewExam;
  if (nextIsNew && nextExamId && !nextExamId.startsWith(`exam_${examType}_`)) {
    nextExamId = null;
  }

  const pendingAssets = [];
  for (let idx = 0; idx < uploadedSourceFiles.length; idx++) {
    const sf = uploadedSourceFiles[idx];
    if (sf.size > 10 * 1024 * 1024) {
      throw new Error(`Tệp "${sf.name}" vượt quá giới hạn 10 MB khi lưu trữ lên Google Drive.`);
    }
    pendingAssets.push({
      key: `source_${idx}_${sf.name}`,
      kind: 'source',
      name: sf.name,
      mimeType: /\.pdf$/i.test(sf.name)
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      rawBytesEstimate: sf.size || 1024,
      file: sf
    });
  }

  const uniqueImagesByDataUrl = new Map();
  for (const q of questions) {
    for (const m of [...(q.media || []), ...(q.passageMedia || [])]) {
      if (m?.dataUrl && !m.driveFileId && !uniqueImagesByDataUrl.has(m.dataUrl)) {
        const idx = uniqueImagesByDataUrl.size;
        uniqueImagesByDataUrl.set(m.dataUrl, {
          key: `img_${idx}`,
          kind: 'image',
          id: m.id,
          name: `${m.id || `img_${idx}`}.png`,
          rawBytesEstimate: Math.ceil(m.dataUrl.length * 0.75),
          dataUrl: m.dataUrl
        });
      }
    }
  }
  for (const imgAsset of uniqueImagesByDataUrl.values()) {
    pendingAssets.push(imgAsset);
  }

  let nextStagedSources = [...stagedSourceFiles];
  let nextQuestions = questions;

  if (pendingAssets.length > 0) {
    if (!nextExamId) {
      const rand = (globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID().replace(/-/g, '')
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 8);
      nextExamId = `exam_${examType}_${rand}`;
      nextIsNew = true;
    }

    const batches = [];
    let currentBatch = [];
    let currentBytes = 0;
    for (const item of pendingAssets) {
      const batchLimit = batches.length === 0 ? 2 : 4;
      if (
        currentBatch.length > 0 &&
        (currentBatch.length >= batchLimit || currentBytes + item.rawBytesEstimate > 3_500_000)
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBytes = 0;
      }
      currentBatch.push(item);
      currentBytes += item.rawBytesEstimate;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    const stagedByKey = new Map();
    let completedCount = 0;
    for (const batch of batches) {
      if (typeof onProgress === 'function') {
        onProgress({ stage: 'staging', completedCount, totalCount: pendingAssets.length });
      }
      const payloadAssets = [];
      for (const item of batch) {
        if (item.kind === 'source') {
          payloadAssets.push({
            key: item.key,
            kind: 'source',
            name: item.name,
            mimeType: item.mimeType,
            dataBase64: await readFileAsBase64(item.file)
          });
        } else {
          payloadAssets.push({
            key: item.key,
            kind: 'image',
            id: item.id,
            name: item.name,
            dataUrl: item.dataUrl
          });
        }
      }
      const stageRes = await api('/api/admin/practice/exams', {
        method: 'POST',
        body: {
          action: 'stage_drive_assets',
          examId: nextExamId,
          examType,
          targetGrade,
          title: title.trim(),
          assets: payloadAssets
        }
      });
      for (const desc of stageRes.assets || []) {
        stagedByKey.set(desc.key, desc);
      }
      completedCount += batch.length;
    }

    const mergedSources = [...stagedSourceFiles];
    for (const item of pendingAssets) {
      if (item.kind !== 'source') continue;
      const desc = stagedByKey.get(item.key);
      if (!desc?.driveFileId) continue;
      const entry = {
        name: desc.name,
        driveFileId: desc.driveFileId,
        mimeType: desc.mimeType,
        size: desc.size,
        sha256: desc.sha256
      };
      const existingIdx = mergedSources.findIndex((s) => s.name === entry.name);
      if (existingIdx >= 0) mergedSources[existingIdx] = entry;
      else mergedSources.push(entry);
    }
    nextStagedSources = mergedSources.slice(0, 20);

    const stagedImageByDataUrl = new Map();
    for (const [dataUrl, imgItem] of uniqueImagesByDataUrl.entries()) {
      const desc = stagedByKey.get(imgItem.key);
      if (desc?.driveFileId) stagedImageByDataUrl.set(dataUrl, desc);
    }

    const replaceMediaList = (list) => {
      if (!Array.isArray(list) || !list.length) return list;
      return list.map((m) => {
        if (!m?.dataUrl || m.driveFileId) return m;
        const desc = stagedImageByDataUrl.get(m.dataUrl);
        if (!desc) return m;
        const clean = {
          id: m.id,
          driveFileId: desc.driveFileId,
          mimeType: desc.mimeType,
          size: desc.size,
          sha256: desc.sha256
        };
        if (desc.url) clean.url = desc.url;
        if (m.width) clean.width = m.width;
        if (m.height) clean.height = m.height;
        if (m.inSolution) clean.inSolution = true;
        return clean;
      });
    };

    nextQuestions = questions.map((q) => ({
      ...q,
      ...(Array.isArray(q.media) ? { media: replaceMediaList(q.media) } : {}),
      ...(Array.isArray(q.passageMedia) ? { passageMedia: replaceMediaList(q.passageMedia) } : {})
    }));
  }

  if (typeof onProgress === 'function') {
    onProgress({ stage: 'saving', completedCount: pendingAssets.length, totalCount: pendingAssets.length });
  }
  const res = await api('/api/admin/practice/exams', {
    method: 'POST',
    body: {
      action,
      allowPartialStructure,
      examId: nextExamId,
      isNewExam: nextIsNew,
      examType,
      examMode,
      targetGrade,
      schoolYearId,
      examCode,
      title: title.trim(),
      durationMinutes: Number(durationMinutes) || 90,
      sourceFiles: nextStagedSources,
      questions: nextQuestions
    }
  });

  return {
    examId: res.examId,
    questions: Array.isArray(res.questions) ? res.questions : nextQuestions,
    stagedSourceFiles: nextStagedSources
  };
}

// ============================================================================
// CHẶNG 3: TRÌNH ĐĂNG TẢI FILE WORD (.DOCX) & RÀ SOÁT / CHỈNH SỬA CÂU HỎI (KHAOTHI.ONLINE STYLE)
// ============================================================================
export function openWordExamUploadWorkspace({
  initialExam = null,
  defaultExamType = 'thptqg',
  defaultTargetGrade = 12,
  lockedClassGrade = null,
  access,
  api,
  status,
  onSaved,
  onStartPreview
}) {
  const existing = document.getElementById('ltch-practice-fullscreen-root');
  if (existing) existing.remove();

  const overlay = h('div', {
    id: 'ltch-practice-fullscreen-root',
    class: 'ltch-exam-fullscreen-overlay is-upload-workspace'
  });
  document.body.append(overlay);
  document.body.classList.add('ltch-exam-body-lock');

  const closeWorkspace = () => {
    overlay.remove();
    document.body.classList.remove('ltch-exam-body-lock');
  };

  let examId = initialExam?.id || null;
  let isNewExam = !initialExam?.id;
  let examType = String(initialExam?.exam_type || initialExam?.examType || defaultExamType || 'thptqg').toLowerCase();
  const initialDefaultGrade = [10, 11, 12].includes(Number(defaultTargetGrade)) ? Number(defaultTargetGrade) : 12;
  let targetGrade = Number(initialExam?.target_grade || initialExam?.targetGrade || initialDefaultGrade);
  let examMode = initialExam?.exam_mode || initialExam?.examMode || 'full';
  let schoolYearId = initialExam?.school_year_id || initialExam?.schoolYearId || access?.currentSchoolYearId || 'year-2026-2027';
  let examCode = initialExam?.exam_code || initialExam?.examCode || '01';
  let title = initialExam?.title || `[LTCH] Đề thi thử ${examType.toUpperCase()} năm ${access?.examYear || 2027} - Mã đề 01`;
  const defaultDuration = { thptqg: 90, hsa: 195, tsa: 150 };
  let durationMinutes =
    Number(initialExam?.duration_minutes || initialExam?.durationMinutes) ||
    defaultDuration[examType];
  let questions = Array.isArray(initialExam?.questions)
    ? JSON.parse(JSON.stringify(initialExam.questions))
    : [];
  let uploadedSourceFiles = [];
  let stagedSourceFiles = Array.isArray(initialExam?._examMeta?.sourceFiles)
    ? [...initialExam._examMeta.sourceFiles]
    : [];
  let parseErrors = [];
  let parseWarnings = [];
  let fileCounts = [];
  let lastParseMode = null;
  let importing = false;
  let saving = false;
  let selectedIdx = 0;
  let allowPartialStructure = examMode === 'section';
  let metaExpanded = questions.length === 0;
  let repairFiles = [];
  let aiSourceMode = 'separate';
  let titleManuallyEdited = Boolean(initialExam?.title);
  let activeAiGuideRef = null;

  const getAiGuideContext = () => ({
    examType,
    targetGrade,
    schoolYear: normalizeSchoolYearLabel(schoolYearId),
    examCode,
    title,
    sourceMode: aiSourceMode
  });

  const openAiGuideFromWorkspace = () => {
    openAiExamGuideModal({
      ...getAiGuideContext(),
      onSyncOptions: (nextOpts) => {
        if (questions.length > 0) return;
        let changed = false;
        if (nextOpts.targetGrade && Number(nextOpts.targetGrade) !== targetGrade) {
          targetGrade = Number(nextOpts.targetGrade);
          changed = true;
        }
        if (nextOpts.sourceMode && nextOpts.sourceMode !== aiSourceMode) {
          aiSourceMode = nextOpts.sourceMode;
          changed = true;
        }
        if (changed) render();
      },
      status
    });
  };

  async function restoreImages() {
    if (!examId || !repairFiles.length || importing || saving) return;
    saving = true;
    try {
      const missing = missingPracticeImageIds(questions);
      const images = [];
      const seen = new Set();
      for (const file of repairFiles) {
        const match = /^([A-Za-z0-9_-]+)\.(png|jpe?g)$/i.exec(file.name);
        if (!match || !missing.has(match[1]) || seen.has(match[1]) || file.size > 2 * 1024 * 1024) {
          throw new Error(`Ảnh "${file.name}" phải đúng mã đang thiếu, là PNG/JPG và tối đa 2 MB.`);
        }
        seen.add(match[1]);
        const mime = match[2].toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
        const url = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error(`Không đọc được ảnh "${file.name}".`));
          reader.readAsDataURL(new Blob([file], { type: mime }));
        });
        images.push({ id: match[1], dataUrl: url });
      }
      let restoredQuestions = questions;
      for (let i = 0; i < images.length; i += 4) {
        const chunk = images.slice(i, i + 4);
        status(`Đang lưu hình minh họa (${Math.min(i + chunk.length, images.length)}/${images.length})…`, false, 'loading');
        const res = await api('/api/admin/practice/exams', { method: 'POST', body: { action: 'restore_media', examId, images: chunk } });
        restoredQuestions = Array.isArray(res?.questions)
          ? res.questions
          : restorePracticeImages(restoredQuestions, new Map(chunk.map(image => [image.id, image.dataUrl])));
      }
      questions = restoredQuestions;
      repairFiles = [];
      status(`Đã lưu ${images.length} hình minh họa vào đề.`, false, 'success');
      render();
    } catch (error) {
      status(error.message, true);
    } finally {
      saving = false;
    }
  }

  async function handleDocxFiles(files) {
    if (!files.length || importing || saving) return;
    const cleanFiles = files.filter((f) => {
      const name = String(f?.name || '').trim();
      return Boolean(name && !name.startsWith('~$'));
    });
    if (!cleanFiles.length) return;
    const docxFiles = cleanFiles.filter((f) => /\.docx$/i.test(f.name));
    const invalidFiles = cleanFiles.filter((f) => !/\.docx$/i.test(f.name));
    if (invalidFiles.length) {
      status(`Trình đăng tải đề chỉ nhận tệp Word (.docx): ${invalidFiles.map((f) => f.name).join(', ')}`, true);
      return;
    }
    if (docxFiles.length > 1) {
      status('Mỗi bộ đề là 1 tệp Word (.docx) duy nhất. Để đăng tải nhiều bộ đề thuộc cùng phương thức cùng lúc, vui lòng dùng nút "Đăng tải nhiều đề".', true);
      return;
    }
    const oversized = docxFiles.find((f) => f.size > 10 * 1024 * 1024);
    if (oversized) {
      status(`Tệp "${oversized.name}" vượt quá giới hạn 10 MB khi lưu trữ lên Google Drive.`, true);
      return;
    }
    if (!docxFiles.length) {
      status('Vui lòng chọn tệp Word (.docx).', true);
      return;
    }

    importing = true;
    try {
      status('Đang phân tích tệp Word…', false, 'loading');
      const parsed = await parseWordExamFiles(docxFiles, { expectedExamType: examType });
      if (!overlay.isConnected) return;

      const originalExamType = examType;
      if (parsed.hasExamTypeCommand && parsed.meta?.examType && parsed.meta.examType !== examType) {
        status(
          `Tệp khai báo [KỲ THI] ${parsed.meta.examType.toUpperCase()}, không thuộc phòng luyện ${examType.toUpperCase()} đang mở. Vui lòng vào đúng phòng luyện để đăng tải.`,
          true
        );
        return;
      }
      if (parsed.meta?.grade && [10, 11, 12].includes(Number(parsed.meta.grade))) {
        targetGrade = Number(parsed.meta.grade);
      }
      if (parsed.meta?.examCode) examCode = parsed.meta.examCode;
      if (parsed.meta?.title) {
        title = parsed.meta.title.startsWith('[LTCH]')
          ? parsed.meta.title
          : `[LTCH] ${parsed.meta.title}`;
      }

      const prevBySlotId = new Map();
      if (!isNewExam && Array.isArray(questions) && (!parsed.meta?.examType || parsed.meta.examType === originalExamType)) {
        questions.forEach((pq, idx) => {
          const slotKey = pq?.id || `q_${idx + 1}`;
          const qCode = pq?.questionCode || pq?.question_code;
          if (qCode && !prevBySlotId.has(slotKey)) {
            prevBySlotId.set(slotKey, { questionCode: qCode, version: Number(pq?.version) || 1 });
          }
        });
      }
      questions = (parsed.questions || []).map((nq, idx) => {
        if (nq?.questionCode || nq?.question_code) return nq;
        const slotKey = nq?.id || `q_${idx + 1}`;
        const inherited = prevBySlotId.get(slotKey);
        return inherited ? { ...nq, questionCode: inherited.questionCode, version: inherited.version } : nq;
      });
      uploadedSourceFiles = docxFiles.slice(0, 20);
      stagedSourceFiles = [];
      parseErrors = parsed.errors || [];
      parseWarnings = [...(parsed.warnings || [])];
      if (
        lockedClassGrade &&
        examType === 'thptqg' &&
        parsed.meta?.grade &&
        [10, 11, 12].includes(Number(parsed.meta.grade)) &&
        Number(parsed.meta.grade) !== Number(lockedClassGrade)
      ) {
        parseWarnings.push(
          `Tệp Word khai báo [KHỐI] ${parsed.meta.grade}, khác với Lớp ${lockedClassGrade} đang mở (đề sẽ lưu vào kho Khối ${parsed.meta.grade}).`
        );
      }
      fileCounts = parsed.counts;
      lastParseMode = parsed.parseMode || 'template';
      selectedIdx = 0;

      if (questions.length > 0) {
        metaExpanded = false;
        const modeLabel = lastParseMode === 'auto' ? 'Tự động nhận diện đề thường' : 'Theo mẫu chuẩn LTCH';
        if (parseErrors.length) {
          status(`Đã đọc ${questions.length} câu (${modeLabel}). Xem lỗi nhận diện bên dưới.`, true);
        } else {
          status(`Đã nhận diện ${questions.length} câu (${modeLabel}) từ tệp Word "${docxFiles[0].name}".`, false, 'success');
        }
      } else {
        metaExpanded = true;
        status('Không tìm thấy câu hỏi nào trong tệp Word. Hãy kiểm tra lại định dạng câu hỏi (Câu 1:, A., B., C., D. hoặc mẫu lệnh [CÂU]).', true);
      }
      render();
    } catch (err) {
      status(err?.message || 'Không thể đọc tệp .docx. Hãy kiểm tra lại định dạng file.', true);
    } finally {
      importing = false;
    }
  }

  async function saveExam(action = 'save_draft', { openPreviewAfter = false } = {}) {
    if (saving || importing) return;
    if (!title.trim()) {
      status('Vui lòng nhập Tên đề thi.', true);
      return;
    }
    if (!questions.length) {
      status('Đề thi cần có ít nhất 1 câu hỏi.', true);
      return;
    }
    saving = true;
    try {
      const saved = await uploadAndSavePracticeExam({
        api,
        action,
        allowPartialStructure,
        examId,
        isNewExam,
        examType,
        examMode,
        targetGrade,
        schoolYearId,
        examCode,
        title,
        durationMinutes,
        uploadedSourceFiles,
        stagedSourceFiles,
        questions,
        onProgress: ({ stage, completedCount, totalCount }) => {
          if (stage === 'staging') {
            status(`Đang tải dữ liệu bộ đề lên Google Drive (${completedCount}/${totalCount} tệp)…`, false, 'loading');
          } else {
            status(action === 'publish' ? 'Đang kiểm tra và phát hành đề thi...' : 'Đang lưu bản nháp...', false, 'loading');
          }
        }
      });
      isNewExam = false;
      examId = saved.examId;
      stagedSourceFiles = saved.stagedSourceFiles;
      uploadedSourceFiles = [];
      questions = saved.questions;
      status(
        action === 'publish'
          ? 'Đã phát hành đề thi lên Sảnh Phòng luyện!'
          : 'Đã lưu bản nháp đề thi thành công.',
        false,
        'success'
      );
      if (typeof onSaved === 'function') await onSaved();
      if (openPreviewAfter && typeof onStartPreview === 'function') {
        closeWorkspace();
        onStartPreview(examId, examType);
      } else if (action === 'publish') {
        closeWorkspace();
      } else {
        render();
      }
    } catch (err) {
      status(err?.message || 'Không thể lưu đề thi. Hãy kiểm tra lại các câu báo đỏ.', true);
    } finally {
      saving = false;
    }
  }

  function addNewBlankQuestion() {
    const nextNum = questions.length + 1;
    const defaultSection = questions[questions.length - 1]?.section || 'part_1';
    questions.push({
      id: `q_${Date.now()}_${nextNum}`,
      order: nextNum,
      section: defaultSection,
      subject: examType === 'hsa' && defaultSection === 'part_3' ? 'physics' : '',
      type: 'single',
      prompt: `Nội dung câu hỏi ${nextNum}...`,
      options: ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'],
      answer: 'A',
      points: examType === 'thptqg' ? 0.25 : 1,
      solution: ''
    });
    selectedIdx = questions.length - 1;
    render();
  }

  function render() {
    overlay.replaceChildren();
    const structure = checkExamStructure(examType, questions, { requireFull: examMode === 'full' && !allowPartialStructure });
    const missingImages = missingPracticeImageIds(questions);
    const repairInput = h('input', {
      type: 'file', accept: '.png,.jpg,.jpeg', multiple: true, hidden: true,
      onchange: event => {
        repairFiles = Array.from(event.target.files || []);
        render();
      }
    });

    const topHeader = h(
      'header',
      { class: 'ltch-upload-header' },
      h(
        'div',
        { class: 'ltch-upload-header-left' },
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-ghost',
            onclick: closeWorkspace
          },
          '← Đóng'
        ),
        h('span', { class: `ltch-brand-pill is-${examType}`, text: `[LTCH] ĐĂNG TẢI ĐỀ ${examType.toUpperCase()}` }),
        h('h2', { text: !isNewExam ? 'Chỉnh sửa & Rà soát Bộ đề' : 'Đăng tải Đề thi từ File Word (.docx)' })
      ),
      h(
        'div',
        { class: 'ltch-upload-header-actions' },
        initialExam?.id
          ? h(
              'button',
              {
                type: 'button',
                class: 'ltch-btn ltch-btn-danger-outline',
                onclick: () =>
                  openDeleteExamConfirmModal({ title: title.trim() || initialExam.title || 'Đề thi này' }, async () => {
                    await api('/api/admin/practice/exams', {
                      method: 'POST',
                      body: { action: 'delete_exam', examId }
                    });
                    status('Đã xóa đề thi khỏi phòng luyện.', false, 'success');
                    closeWorkspace();
                    if (typeof onSaved === 'function') await onSaved();
                  })
              },
              'Xóa đề'
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-outline',
            onclick: () => saveExam('save_draft', { openPreviewAfter: false })
          },
          'Lưu bản nháp'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-outline',
            onclick: () => saveExam('save_draft', { openPreviewAfter: true })
          },
          'Làm thử như học sinh'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-primary',
            onclick: () => saveExam('publish', { openPreviewAfter: false })
          },
          'Phát hành chính thức'
        )
      )
    );

    // Thanh cấu hình thông tin đề & Tải file mẫu .docx
    const fileInput = h('input', {
      type: 'file',
      accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      hidden: true,
      onchange: (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        handleDocxFiles(files);
      }
    });

    const activeSpec = EXAM_FORM_SPECS[examType] || EXAM_FORM_SPECS.thptqg;

    const metaBar = h(
      'section',
      { class: 'ltch-upload-meta-bar' },
      h(
        'div',
        { class: 'ltch-upload-meta-grid' },
        examType === 'thptqg'
          ? h(
              'label',
              { class: 'ltch-field-label' },
              h('span', { text: 'Khối lớp' }),
              h(
                'select',
                {
                  class: 'ltch-select',
                  onchange: (e) => {
                    targetGrade = Number(e.target.value);
                    activeAiGuideRef?.refreshPrompt?.();
                  }
                },
                h('option', { value: '12', selected: targetGrade === 12, text: 'Khối 12' }),
                h('option', { value: '11', selected: targetGrade === 11, text: 'Khối 11' }),
                h('option', { value: '10', selected: targetGrade === 10, text: 'Khối 10' })
              )
            )
          : h(
              'label',
              { class: 'ltch-field-label' },
              h('span', { text: 'Loại đề' }),
              h(
                'select',
                {
                  class: 'ltch-select',
                  onchange: (e) => {
                    examMode = e.target.value;
                    allowPartialStructure = examMode === 'section';
                    render();
                  }
                },
                h('option', { value: 'full', selected: examMode === 'full', text: 'Đề chung (Đủ 3 phần)' }),
                h('option', { value: 'section', selected: examMode === 'section', text: 'Đề lẻ (Luyện từng phần)' })
              )
            ),
        h(
          'label',
          { class: 'ltch-field-label' },
          h('span', { text: 'Mã đề' }),
          h('input', {
            type: 'text',
            class: 'ltch-input',
            value: examCode,
            oninput: (e) => {
              examCode = e.target.value;
              activeAiGuideRef?.refreshPrompt?.();
            }
          })
        ),
        h(
          'label',
          { class: 'ltch-field-label is-wide' },
          h('span', { text: 'Tên hiển thị của Bộ đề' }),
          h('input', {
            type: 'text',
            class: 'ltch-input',
            value: title,
            oninput: (e) => {
              title = e.target.value;
              titleManuallyEdited = true;
              activeAiGuideRef?.refreshPrompt?.();
            }
          })
        ),
        h(
          'label',
          { class: 'ltch-field-label' },
          h('span', { text: 'Thời gian (phút)' }),
          h('input', {
            type: 'number',
            class: 'ltch-input',
            min: 5,
            max: 300,
            value: String(durationMinutes),
            oninput: (e) => {
              durationMinutes = Number(e.target.value) || 90;
            }
          })
        )
      ),
      h(
        'div',
        { class: 'ltch-upload-template-strip' },
        h(
          'div',
          { class: 'ltch-upload-drop-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-btn ltch-btn-primary',
              onclick: () => fileInput.click()
            },
            uiIcon('fileText'),
            h('span', { text: 'Chọn tệp Word (.docx)' })
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-btn ltch-btn-outline',
              onclick: addNewBlankQuestion
            },
            '+ Thêm câu thủ công'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-btn ltch-btn-ai',
              onclick: openAiGuideFromWorkspace
            },
            uiIcon('sparkle', 16),
            h('span', { text: 'Hướng dẫn AI' }),
            h('span', { class: 'ltch-ai-btn-rec-pill', text: 'Khuyên dùng' })
          ),
          h(
            'a',
            {
              href: activeSpec.templateHref,
              download: activeSpec.templateFileName,
              class: `ltch-template-link is-${examType} is-active`
            },
            `⬇ Mẫu Word ${activeSpec.shortLabel}`
          ),
          h(
            'label',
            {
              class: 'ltch-inline-check',
              title: 'Cho phép phát hành đề rút gọn / đề chuyên đề (không bắt buộc đủ số câu chuẩn)'
            },
            h('input', {
              type: 'checkbox',
              checked: allowPartialStructure,
              onchange: (e) => {
                allowPartialStructure = e.target.checked;
                render();
              }
            }),
            'Đề rút gọn / chuyên đề'
          )
        )
      )
    );

    const rawPart3 = structure.counts?.part_3;
    const part3Count =
      rawPart3 && typeof rawPart3 === 'object'
        ? Object.values(rawPart3).reduce((sum, n) => sum + (Number(n) || 0), 0)
        : Number(rawPart3) || 0;
    const structureErrors =
      questions.length > 0 && !allowPartialStructure && !structure.valid ? structure.errors || [] : [];
    const showStatusStrip =
      questions.length > 0 ||
      parseErrors.length > 0 ||
      parseWarnings.length > 0 ||
      missingImages.size > 0;

    // Thanh trạng thái cấu trúc câu hỏi, nút thu gọn/mở rộng thông tin đề & cảnh báo
    const statusStrip = h(
      'div',
      { class: 'ltch-upload-structure-strip' },
      h(
        'div',
        { class: 'ltch-upload-structure-row' },
        h(
          'div',
          { class: 'ltch-structure-pills' },
          h('strong', { text: `Tổng: ${questions.length} câu` }),
          h('span', {
            class: 'ltch-struct-pill',
            text: `Phần 1: ${structure.counts?.part_1 || 0} câu`
          }),
          h('span', {
            class: 'ltch-struct-pill',
            text: `Phần 2: ${structure.counts?.part_2 || 0} câu`
          }),
          h('span', {
            class: 'ltch-struct-pill',
            text: `Phần 3: ${part3Count} câu`
          })
        ),
        questions.length > 0
          ? h(
              'div',
              { class: 'ltch-structure-quick-actions' },
              h(
                'button',
                {
                  type: 'button',
                  class: `ltch-btn ltch-btn-outline ltch-btn-sm${metaExpanded ? ' is-active' : ''}`,
                  'aria-expanded': String(metaExpanded),
                  onclick: () => {
                    metaExpanded = !metaExpanded;
                    render();
                  }
                },
                metaExpanded
                  ? '▲ Thu gọn thông tin đề'
                  : `⚙ Thông tin đề (${examType.toUpperCase()} · Mã ${examCode || '01'} · ${durationMinutes}p)`
              ),
              !metaExpanded
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'ltch-btn ltch-btn-outline ltch-btn-sm',
                      onclick: () => fileInput.click()
                    },
                    uiIcon('fileText', 15),
                    h('span', { text: 'Nhập Word' })
                  )
                : null,
              !metaExpanded
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'ltch-btn ltch-btn-outline ltch-btn-sm',
                      onclick: addNewBlankQuestion
                    },
                    '+ Thêm câu'
                  )
                : null,
              !metaExpanded
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'ltch-btn ltch-btn-outline ltch-btn-sm',
                      onclick: openAiGuideFromWorkspace
                    },
                    uiIcon('sparkle', 15),
                    h('span', { text: 'Hướng dẫn AI' }),
                    h('span', { class: 'ltch-ai-btn-rec-pill', text: 'Khuyên dùng' })
                  )
                : null
            )
          : null
      ),
      fileCounts.length > 1
        ? h('div', { class: 'ltch-structure-pills' }, ...fileCounts.map(({ name, count }) =>
            h('span', { class: 'ltch-struct-pill', text: `${name} · ${count} câu` })
          ))
        : null,
      examType === 'hsa' && part3Count
        ? h('div', { class: 'ltch-structure-pills', 'aria-label': 'Số câu từng môn HSA' },
            ...Object.entries(SUBJECT_LABELS).map(([key, label]) =>
              h('span', { class: 'ltch-struct-pill', text: `${label}: ${rawPart3?.[key] || 0}/${key === 'english' ? 50 : 17}` })
            ))
        : null,
      parseErrors.length > 0 || structureErrors.length > 0
        ? h(
            'div',
            { class: 'ltch-upload-errors-box' },
            ...[...parseErrors, ...structureErrors].map((errText) =>
              h('div', { class: 'ltch-upload-err-item', text: `• ${errText}` })
            )
          )
        : null,
      missingImages.size
        ? h('div', { class: 'ltch-upload-errors-box' },
            h('strong', { text: `Thiếu ${missingImages.size} hình minh họa` }),
            h('div', { text: [...missingImages].join(', ') }),
            examId && h('p', { class: 'meta', text: 'Đặt tên tệp PNG/JPG theo mã hình cần bổ sung, ví dụ img_1.png.' }),
            examId && repairInput,
            examId && h('button', { type: 'button', class: 'ltch-btn ltch-btn-outline ltch-btn-sm', onclick: () => repairInput.click() }, 'Chọn ảnh bổ sung'),
            examId && repairFiles.length > 0 && h('button', { type: 'button', class: 'ltch-btn ltch-btn-primary ltch-btn-sm', onclick: restoreImages }, `Lưu ${repairFiles.length} ảnh`))
        : null,
      parseWarnings.length
        ? h('details', { class: 'ltch-upload-errors-box' },
            h('summary', { text: `${parseWarnings.length} cảnh báo khi đọc Word` }),
            ...parseWarnings.map(message => h('div', { text: message })))
        : null
    );

    if (!questions.length) {
      const emptyDrop = h(
        'div',
        {
          class: 'ltch-upload-empty-dropzone',
          ondragover: (e) => {
            e.preventDefault();
            e.currentTarget.classList.add('is-dragover');
          },
          ondragleave: (e) => {
            e.currentTarget.classList.remove('is-dragover');
          },
          ondrop: (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('is-dragover');
            handleDocxFiles(Array.from(e.dataTransfer?.files || []));
          },
          onclick: () => fileInput.click()
        },
        h('div', { class: 'ltch-dropzone-icon' }, uiIcon('uploadCloud', 34)),
        h(
          'div',
          { class: 'ltch-dropzone-pills-row' },
          h('span', { class: `ltch-dropzone-form-pill is-${examType}`, text: `FORM ${activeSpec.shortLabel}` }),
          h('span', { class: 'ltch-dropzone-auto-pill', text: 'Hỗ trợ 2 cách: Đề thường & Đề chuẩn AI' })
        ),
        h('h3', { text: 'Kéo thả hoặc chọn tệp Word (.docx) đề bình thường hoặc chuẩn LTCH' }),
        h('p', {
          class: 'meta',
          text: 'Hệ thống hỗ trợ 2 cách tải đề: (1) Tải trực tiếp file đề Word (.docx) bình thường (Câu 1:, A. B. C. D., a) b) c) d), Đáp án:, Lời giải:) để tự động nhận diện; hoặc (2) Dùng Trợ lý soạn đề bằng AI (Khuyên dùng) để chuyển đổi chuẩn xác 100% công thức LaTeX, bảng biểu và đủ 6 dạng câu hỏi.'
        }),
        h(
          'div',
          { class: 'ltch-dropzone-methods-box' },
          h(
            'div',
            { class: 'ltch-dropzone-method-item is-recommended' },
            h('strong', { text: 'Cách 1 · Trợ lý soạn đề bằng AI (Khuyên dùng)' }),
            h('span', { text: 'Chuẩn hóa 100% công thức LaTeX $...$, bảng biến thiên và các dạng câu kéo thả, điền khuyết.' })
          ),
          h(
            'div',
            { class: 'ltch-dropzone-method-item' },
            h('strong', { text: 'Cách 2 · Tự động nhận diện đề Word bình thường' }),
            h('span', { text: 'Đẩy trực tiếp file đề .docx có sẵn (Câu 1, A/B/C/D, bảng đáp án cuối đề hoặc gạch chân đáp án).' })
          )
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-primary',
            onclick: (e) => {
              e.stopPropagation();
              fileInput.click();
            }
          },
          uiIcon('fileText', 16),
          h('span', { text: 'Chọn tệp Word (.docx)' })
        )
      );

      activeAiGuideRef = createAiExamGuideCard({
        getContext: getAiGuideContext,
        onChangeSourceMode: (nextMode) => {
          aiSourceMode = nextMode;
          activeAiGuideRef?.render?.();
        },
        onOpenFullModal: () => openAiGuideFromWorkspace(),
        status
      });

      const emptyBody = h(
        'div',
        { class: 'ltch-upload-empty-body' },
        h('div', { class: 'ltch-upload-onboarding-grid' }, emptyDrop, activeAiGuideRef.element)
      );
      overlay.append(
        ...[fileInput, topHeader, metaBar, showStatusStrip ? statusStrip : null, emptyBody].filter(Boolean)
      );
      return;
    }
    activeAiGuideRef = null;

    // Bố cục 2 cột: Cột trái danh sách câu hỏi - Cột phải Xem trước KaTeX + Chỉnh sửa trực tiếp
    const safeIdx = Math.max(0, Math.min(selectedIdx, questions.length - 1));
    selectedIdx = safeIdx;
    const activeQ = questions[safeIdx];

    const leftNav = h('aside', { class: 'ltch-upload-q-list' });
    questions.forEach((q, idx) => {
      const isSelected = idx === safeIdx;
      const secBadge = (q.section || 'part_1').replace('part_', 'P');
      const subjBadge = q.subject ? ` · ${SUBJECT_LABELS[q.subject] || q.subject}` : '';
      leftNav.append(
        h(
          'button',
          {
            type: 'button',
            class: `ltch-upload-q-item${isSelected ? ' is-active' : ''}`,
            onclick: () => {
              selectedIdx = idx;
              render();
            }
          },
          h(
            'div',
            { class: 'ltch-upload-q-item-top' },
            h('strong', { text: `Câu ${idx + 1}` }),
            h('span', { class: 'ltch-upload-q-meta', text: `${secBadge}${subjBadge} · ${QUESTION_TYPE_LABELS[q.type] || q.type}` })
          ),
          h('div', {
            class: 'ltch-upload-q-snippet',
            text: String(q.prompt || '').replace(/<[^>]+>/g, ' ').slice(0, 75)
          })
        )
      );
    });

    // Khung Xem trước & Chỉnh sửa câu hỏi đang chọn
    const previewBox = h('div', { class: 'ltch-upload-live-preview' });
    const renderLivePreview = () => {
      previewBox.replaceChildren();
      previewBox.append(
        h(
          'div',
          { class: 'ltch-preview-head' },
          h('strong', { text: `Xem trước hiển thị Câu ${safeIdx + 1}` }),
          activeQ.questionCode ? h('span', { class: 'ltch-q-code-badge', text: `#${activeQ.questionCode}` }) : null
        )
      );
      if (activeQ.passageContent) {
        const pBlock = h('div', { class: 'ltch-passage-box' });
        const pBody = h('div', { class: 'ltch-passage-body' });
        renderRichMathBlock(pBody, activeQ.passageContent, activeQ.passageMedia || []);
        pBlock.append(h('div', { class: 'ltch-passage-badge', text: 'NGỮ LIỆU CỤM CÂU HỎI' }), pBody);
        previewBox.append(pBlock);
      }
      const pPrompt = h('div', { class: 'ltch-q-prompt' });
      if (activeQ.type === 'fill_blank' || activeQ.type === 'drag_drop') {
        renderInteractivePromptWithBlanks(pPrompt, activeQ, [], null, { readOnly: true });
      } else {
        renderRichMathBlock(pPrompt, activeQ.prompt, activeQ.media || [], { otherMediaFields: [...(activeQ.options || []), ...(activeQ.statements || [])] });
      }
      previewBox.append(pPrompt);

      if (activeQ.type === 'single' || activeQ.type === 'multiple') {
        const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
        const optWrap = h('div', { class: 'ltch-sol-options-grid' });
        (activeQ.options || []).forEach((optText, oIdx) => {
          const letKey = letters[oIdx];
          const isCorr =
            activeQ.type === 'single'
              ? activeQ.answer === letKey
              : Array.isArray(activeQ.answers) && activeQ.answers.includes(letKey);
          const optNode = h('div', { class: 'ltch-opt-text' });
          renderRichMathBlock(optNode, optText, activeQ.media || [], { appendUnreferenced: false });
          optWrap.append(
            h(
              'div',
              { class: `ltch-sol-option-item${isCorr ? ' is-correct-opt' : ''}` },
              h('span', { class: 'ltch-opt-letter', text: letKey }),
              optNode,
              isCorr ? h('span', { class: 'ltch-opt-tag is-corr', text: 'Đáp án đúng' }) : null
            )
          );
        });
        previewBox.append(optWrap);
      }

      if (activeQ.solution) {
        const solPreview = h('div', { class: 'ltch-sol-explanation' });
        const solBody = h('div', { class: 'ltch-sol-explanation-body' });
        renderRichMathBlock(solBody, activeQ.solution, activeQ.media || [], { onlySolutionMedia: true });
        solPreview.append(h('div', { class: 'ltch-sol-explanation-title', text: 'LỜI GIẢI CHI TIẾT' }), solBody);
        previewBox.append(solPreview);
      }
    };

    const promptTextarea = h('textarea', {
      class: 'ltch-input ltch-textarea',
      rows: 4,
      value: activeQ.prompt || '',
      oninput: (e) => {
        activeQ.prompt = e.target.value;
        renderLivePreview();
      }
    });
    const promptMathBar = createQuestionMathEditor(promptTextarea, {
      variant: 'question',
      label: 'Nội dung câu hỏi'
    });

    const solutionTextarea = h('textarea', {
      class: 'ltch-input ltch-textarea',
      rows: 3,
      value: activeQ.solution || '',
      oninput: (e) => {
        activeQ.solution = e.target.value;
        renderLivePreview();
      }
    });

    // Bộ chỉnh sửa phương án / đáp án theo từng dạng câu
    const typeSpecificEditor = h('div', { class: 'ltch-type-specific-editor' });
    if (activeQ.type === 'single') {
      const letters = ['A', 'B', 'C', 'D'];
      if (!Array.isArray(activeQ.options) || activeQ.options.length < 4) {
        activeQ.options = ['Phương án A', 'Phương án B', 'Phương án C', 'Phương án D'];
      }
      letters.forEach((letKey, oIdx) => {
        typeSpecificEditor.append(
          h(
            'div',
            { class: 'ltch-opt-edit-row' },
            h(
              'label',
              { class: 'ltch-radio-corr' },
              h('input', {
                type: 'radio',
                name: 'single_corr',
                checked: activeQ.answer === letKey,
                onchange: () => {
                  activeQ.answer = letKey;
                  renderLivePreview();
                }
              }),
              `[${letKey}] Đúng`
            ),
            h('input', {
              type: 'text',
              class: 'ltch-input',
              value: activeQ.options[oIdx] || '',
              oninput: (e) => {
                activeQ.options[oIdx] = e.target.value;
                renderLivePreview();
              }
            })
          )
        );
      });
    } else if (activeQ.type === 'multiple') {
      const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
      if (!Array.isArray(activeQ.options) || activeQ.options.length < 2) {
        activeQ.options = ['', '', '', ''];
      }
      if (!Array.isArray(activeQ.answers)) activeQ.answers = ['A'];
      activeQ.options.forEach((optVal, oIdx) => {
        const letKey = letters[oIdx];
        typeSpecificEditor.append(
          h(
            'div',
            { class: 'ltch-opt-edit-row' },
            h(
              'label',
              { class: 'ltch-radio-corr' },
              h('input', {
                type: 'checkbox',
                checked: activeQ.answers.includes(letKey),
                onchange: (e) => {
                  const s = new Set(activeQ.answers);
                  if (e.target.checked) s.add(letKey);
                  else s.delete(letKey);
                  activeQ.answers = [...s].sort();
                  renderLivePreview();
                }
              }),
              `[${letKey}]`
            ),
            h('input', {
              type: 'text',
              class: 'ltch-input',
              value: optVal || '',
              oninput: (e) => {
                activeQ.options[oIdx] = e.target.value;
                renderLivePreview();
              }
            })
          )
        );
      });
    } else if (activeQ.type === 'true_false') {
      if (!Array.isArray(activeQ.statements) || !activeQ.statements.length) {
        activeQ.statements = ['Mệnh đề a', 'Mệnh đề b', 'Mệnh đề c', 'Mệnh đề d'];
        activeQ.answers = [true, false, true, true];
      }
      activeQ.statements.forEach((stVal, sIdx) => {
        const letKey = String.fromCharCode(97 + sIdx);
        typeSpecificEditor.append(
          h(
            'div',
            { class: 'ltch-opt-edit-row' },
            h(
              'select',
              {
                class: 'ltch-select is-compact',
                onchange: (e) => {
                  activeQ.answers[sIdx] = e.target.value === 'true';
                  renderLivePreview();
                }
              },
              h('option', { value: 'true', selected: activeQ.answers?.[sIdx] === true, text: `Ý ${letKey}: Đúng` }),
              h('option', { value: 'false', selected: activeQ.answers?.[sIdx] === false, text: `Ý ${letKey}: Sai` })
            ),
            h('input', {
              type: 'text',
              class: 'ltch-input',
              value: stVal || '',
              oninput: (e) => {
                activeQ.statements[sIdx] = e.target.value;
                renderLivePreview();
              }
            })
          )
        );
      });
    } else if (activeQ.type === 'short') {
      typeSpecificEditor.append(
        h(
          'label',
          { class: 'ltch-field-label' },
          h('span', { text: 'Đáp án đúng (ngăn cách nhiều cách ghi bằng dấu | , ví dụ: 2,5 | 5/2)' }),
          h('input', {
            type: 'text',
            class: 'ltch-input',
            value: (activeQ.accepted || []).join(' | '),
            oninput: (e) => {
              activeQ.accepted = e.target.value
                .split('|')
                .map((s) => s.trim())
                .filter(Boolean);
              renderLivePreview();
            }
          })
        )
      );
    } else if (activeQ.type === 'fill_blank') {
      const blanks = Array.isArray(activeQ.blanks) ? activeQ.blanks : [{ accepted: [''], kind: 'text' }];
      activeQ.blanks = blanks;
      blanks.forEach((bObj, bIdx) => {
        typeSpecificEditor.append(
          h(
            'label',
            { class: 'ltch-field-label' },
            h('span', { text: `Đáp án ô trống {{${bIdx + 1}}} (ngăn nhiều cách viết bằng dấu | )` }),
            h('input', {
              type: 'text',
              class: 'ltch-input',
              value: (bObj.accepted || []).join(' | '),
              oninput: (e) => {
                bObj.accepted = e.target.value
                  .split('|')
                  .map((s) => s.trim())
                  .filter(Boolean);
              }
            })
          )
        );
      });
    } else if (activeQ.type === 'drag_drop') {
      typeSpecificEditor.append(
        h(
          'label',
          { class: 'ltch-field-label' },
          h('span', { text: 'Danh sách thẻ [THẺ] T1, T2, ... (mỗi dòng 1 thẻ)' }),
          h('textarea', {
            class: 'ltch-input ltch-textarea',
            rows: 3,
            value: (activeQ.cards || []).join('\n'),
            oninput: (e) => {
              activeQ.cards = e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
            }
          })
        ),
        h(
          'label',
          { class: 'ltch-field-label' },
          h('span', { text: 'Mã thẻ đúng cho từng ô {{1}}, {{2}}... (ngăn bằng dấu phẩy, ví dụ: T4, T1, T2)' }),
          h('input', {
            type: 'text',
            class: 'ltch-input',
            value: (activeQ.answer || []).join(', '),
            oninput: (e) => {
              activeQ.answer = e.target.value
                .split(/[,;\s]+/)
                .map((s) => s.trim().toUpperCase())
                .filter(Boolean);
            }
          })
        )
      );
    }

    renderLivePreview();

    const rightEditorPane = h(
      'main',
      { class: 'ltch-upload-editor-pane' },
      previewBox,
      h(
        'div',
        { class: 'ltch-upload-edit-form' },
        h(
          'div',
          { class: 'ltch-upload-edit-top-row' },
          h(
            'label',
            { class: 'ltch-field-label' },
            h('span', { text: 'Phần thi' }),
            h(
              'select',
              {
                class: 'ltch-select',
                onchange: (e) => {
                  activeQ.section = e.target.value;
                  render();
                }
              },
              h('option', { value: 'part_1', selected: (activeQ.section || 'part_1') === 'part_1', text: 'Phần 1 / Phần I' }),
              h('option', { value: 'part_2', selected: activeQ.section === 'part_2', text: 'Phần 2 / Phần II' }),
              h('option', { value: 'part_3', selected: activeQ.section === 'part_3', text: 'Phần 3 / Phần III' })
            )
          ),
          examType === 'hsa' && activeQ.section === 'part_3'
            ? h(
                'label',
                { class: 'ltch-field-label' },
                h('span', { text: 'Môn Phần 3 HSA' }),
                h(
                  'select',
                  {
                    class: 'ltch-select',
                    onchange: (e) => {
                      activeQ.subject = e.target.value;
                      render();
                    }
                  },
                  ...Object.entries(SUBJECT_LABELS).map(([sKey, sLabel]) =>
                    h('option', { value: sKey, selected: activeQ.subject === sKey, text: sLabel })
                  )
                )
              )
            : null,
          h(
            'label',
            { class: 'ltch-field-label' },
            h('span', { text: 'Dạng câu hỏi' }),
            h(
              'select',
              {
                class: 'ltch-select',
                onchange: (e) => {
                  activeQ.type = e.target.value;
                  render();
                }
              },
              ...Object.entries(QUESTION_TYPE_LABELS).map(([tKey, tLabel]) =>
                h('option', { value: tKey, selected: activeQ.type === tKey, text: tLabel })
              )
            )
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-btn ltch-btn-danger-ghost',
              onclick: () => {
                if (questions.length <= 1) return;
                questions.splice(safeIdx, 1);
                selectedIdx = Math.max(0, safeIdx - 1);
                render();
              }
            },
            '🗑 Xóa câu này'
          )
        ),
        activeQ.passageContent !== undefined && (examType === 'hsa' || examType === 'tsa')
          ? h(
              'label',
              { class: 'ltch-field-label' },
              h('span', { text: 'Ngữ liệu dùng chung [NGỮ LIỆU] (nếu câu thuộc chùm ngữ liệu)' }),
              h('textarea', {
                class: 'ltch-input ltch-textarea',
                rows: 3,
                value: activeQ.passageContent || '',
                oninput: (e) => {
                  activeQ.passageContent = e.target.value;
                  if (e.target.value.trim() && !activeQ.passageId) {
                    activeQ.passageId = `passage_${safeIdx + 1}`;
                    activeQ.clusterId = `cluster_${safeIdx + 1}`;
                  }
                  renderLivePreview();
                }
              })
            )
          : null,
        h('label', { class: 'ltch-field-label' }, h('span', { text: 'Lời dẫn câu hỏi [CÂU] (gõ công thức bằng $...$)' }), promptTextarea),
        promptMathBar,
        typeSpecificEditor,
        h('label', { class: 'ltch-field-label' }, h('span', { text: 'Lời giải chi tiết [LỜI GIẢI]' }), solutionTextarea)
      )
    );

    const showMetaBar = metaExpanded;
    overlay.append(
      ...[
        fileInput,
        topHeader,
        showMetaBar ? metaBar : null,
        statusStrip,
        h('div', { class: 'ltch-upload-2col-body' }, leftNav, rightEditorPane)
      ].filter(Boolean)
    );
  }

  render();
}

// Hộp thoại quản lý Báo lỗi câu hỏi của học sinh (#LTCH-xxxx)
function openErrorReportsManagerModal({ api, status, onOpenExamEditor }) {
  const backdrop = h('div', { class: 'ltch-modal-backdrop' });
  const bodyBox = h('div', { class: 'ltch-modal-body', text: 'Đang tải danh sách báo lỗi...' });

  const card = h(
    'div',
    { class: 'ltch-modal-card ltch-modal-lg' },
    h(
      'div',
      { class: 'ltch-modal-header' },
      h('h3', { text: 'Quản lý Báo lỗi Câu hỏi từ Học sinh (#LTCH-xxxx)' }),
      h('button', { type: 'button', class: 'ltch-modal-close', onclick: () => backdrop.remove(), text: '×' })
    ),
    bodyBox,
    h(
      'div',
      { class: 'ltch-modal-footer' },
      h('button', { type: 'button', class: 'ltch-btn ltch-btn-outline', onclick: () => backdrop.remove() }, 'Đóng')
    )
  );
  backdrop.append(card);
  document.body.append(backdrop);

  (async () => {
    try {
      const res = await api('/api/admin/practice/reports');
      const items = res.items || [];
      bodyBox.replaceChildren();
      if (!items.length) {
        bodyBox.append(h('p', { class: 'meta', text: 'Hiện chưa có báo lỗi câu hỏi nào từ học sinh.' }));
        return;
      }
      const list = h('div', { class: 'ltch-reports-list' });
      for (const rep of items) {
        const isResolved = rep.status === 'resolved';
        list.append(
          h(
            'div',
            { class: `ltch-report-row-card${isResolved ? ' is-resolved' : ''}` },
            h(
              'div',
              { class: 'ltch-report-row-top' },
              h('strong', { text: `Mã câu: #${rep.question_code} (v${rep.question_version || 1})` }),
              h('span', {
                class: `badge ${isResolved ? 'badge-success' : 'badge-warning'}`,
                text: isResolved ? 'Đã xử lý' : 'Đang mở'
              }),
              h('span', { class: 'meta', text: formatDateTimeVi(rep.created_at) })
            ),
            h('p', { class: 'ltch-report-note', text: `Nội dung học sinh báo: "${rep.note}"` }),
            h(
              'div',
              { class: 'ltch-report-actions' },
              rep.exam_id
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'ltch-btn ltch-btn-outline ltch-btn-sm',
                      onclick: () => {
                        backdrop.remove();
                        onOpenExamEditor(rep.exam_id);
                      }
                    },
                    'Mở đề để sửa câu hỏi'
                  )
                : null,
              !isResolved
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'ltch-btn ltch-btn-primary ltch-btn-sm',
                      onclick: async () => {
                        await api('/api/admin/practice/reports', {
                          method: 'POST',
                          body: { reportId: rep.id, status: 'resolved', resolutionNote: 'Đã kiểm tra và cập nhật.' }
                        });
                        status('Đã đánh dấu xử lý báo lỗi.', false, 'success');
                        backdrop.remove();
                      }
                    },
                    '✓ Đánh dấu đã xử lý'
                  )
                : null
            )
          )
        );
      }
      bodyBox.append(list);
    } catch (err) {
      bodyBox.replaceChildren(h('p', { class: 'form-error', text: err?.message || 'Không tải được báo lỗi.' }));
    }
  })();
}

// ============================================================================
// GIAI ĐOẠN 1: SẢNH CHỌN BỘ ĐỀ (THPTQG · HSA · TSA — CHUẨN 9STUDY LIGHT MODE)
// ============================================================================
function practiceExamSequenceNumber(exam) {
  const code = String(exam.examCode || '').trim();
  if (exam.examType === 'hsa') {
    const title = normalizeCommandTag(exam.title).replace(/^\[LTCH\]\s*/, '');
    // The official HSA sample uses a real exam code (308).
    if (/^DE (?:THI )?MINH HOA\b|^DE THAM KHAO KY THI DANH GIA NANG LUC HSA\b/.test(title)) return 0;
  }
  // Prefixed codes such as TSA-01 belong to a separate set.
  const number = Number(code);
  return /^\d+$/.test(code) && Number.isSafeInteger(number) && number > 0
    ? number
    : Number.MAX_SAFE_INTEGER;
}

export function comparePracticeExamSequence(a, b) {
  return practiceExamSequenceNumber(a) - practiceExamSequenceNumber(b);
}

export async function renderPracticeRoomsPortal({
  container,
  api,
  status,
  classGrade = null,
  viewerRole = null,
  initialExamType = null,
  initialGradeFilter = null,
  onNavigateExamType = null,
  onOpenExamSolution = null,
  autoOpenExamId = null,
  autoOpenIsPreview = false
}) {
  const effectiveGrade = [10, 11, 12].includes(Number(classGrade)) ? Number(classGrade) : null;

  container.replaceChildren(
    h(
      'div',
      { class: 'ltch-lobby-loading' },
      h('span', { class: 'toast-spinner' }),
      h('p', { class: 'meta', text: 'Đang tải Phòng luyện THPTQG · HSA · TSA...' })
    )
  );

  let lobbyState;
  try {
    lobbyState = await api(effectiveGrade ? `/api/practice/rooms?grade=${effectiveGrade}` : '/api/practice/rooms');
  } catch (err) {
    container.replaceChildren(
      h(
        'div',
        { class: 'notice' },
        h('strong', { text: 'Chưa tải được dữ liệu Phòng luyện' }),
        h('p', { class: 'meta', text: err?.message || 'Vui lòng thử lại sau.' })
      )
    );
    return;
  }

  const access = lobbyState.access || {};
  const allExams = Array.isArray(lobbyState.exams) ? lobbyState.exams : [];
  const attemptsByExam = lobbyState.attemptsByExam || {};
  const effectiveIsStaff = Boolean(access.isStaff && viewerRole !== 'student' && viewerRole !== 'parent');

  // Nếu là cựu học sinh lớp 12 đã tốt nghiệp và không còn lớp active -> Khóa hoàn toàn
  if (access.isAlumni) {
    container.replaceChildren(
      h(
        'div',
        { class: 'ltch-alumni-lock-card' },
        h('span', { class: 'ltch-brand-pill is-thptqg', text: '[LTCH] LỚP TOÁN CÔ HẠNH' }),
        h('h2', { text: 'Khóa học của bạn đã hoàn thành' }),
        h('p', {
          class: 'meta',
          text: 'Tài khoản cựu học sinh khối 12 đã hoàn thành chương trình học tại Lớp Toán Cô Hạnh. Quyền truy cập kho đề luyện tập được dành cho các khóa đang theo học.'
        })
      )
    );
    return;
  }

  const serverAllowedRooms = Array.isArray(access.allowedRooms) && access.allowedRooms.length
    ? access.allowedRooms
    : ['thptqg'];
  const classRoomScope =
    effectiveGrade === 10 ? ['thptqg']
    : effectiveGrade === 11 ? ['thptqg', 'tsa']
    : effectiveGrade === 12 ? ['thptqg', 'hsa', 'tsa']
    : null;
  const allowedRooms = classRoomScope
    ? serverAllowedRooms.filter((r) => classRoomScope.includes(r))
    : serverAllowedRooms;

  const matchesGradeScope = (ex, g) => {
    const gradeNum = Number(g);
    if (![10, 11, 12].includes(gradeNum)) return true;
    const t = String(ex?.examType || ex?.exam_type || '').toLowerCase();
    if (t === 'tsa') return gradeNum === 11 || gradeNum === 12;
    return (Number(ex?.targetGrade ?? ex?.target_grade) || 12) === gradeNum;
  };
  const isPortalExamVisible = (ex) => Boolean(ex && (effectiveIsStaff || ex.status === 'published'));

  const availableThptqgGrades = (() => {
    if (effectiveGrade) return [effectiveGrade];
    if (effectiveIsStaff) {
      if (access.isAdmin || access.isTeacher) return [12, 11, 10];
      const staffAllowed = [12, 11, 10].filter(
        (g) => access.manageablePools?.[`thptqg_${g}`] || (access.staffGrades || []).includes(g)
      );
      return staffAllowed.length ? staffAllowed : [12];
    }
    const active = (access.activeGrades || []).filter((g) => [10, 11, 12].includes(g));
    if (active.length) return [...active].sort((a, b) => b - a);
    return [12, 11, 10];
  })();

  const resolveThptqgMeta = (targetG) => {
    if (targetG === 10) {
      return {
        title: 'Phòng luyện Toán 10 – Theo form THPTQG',
        badge: 'THEO FORM THPTQG · MÔN TOÁN',
        subtitle: '90 phút · 22 câu hỏi (3 phần chuẩn Bộ GD&ĐT)'
      };
    }
    if (targetG === 11) {
      return {
        title: 'Phòng luyện Toán 11 – Theo form THPTQG',
        badge: 'THEO FORM THPTQG · MÔN TOÁN',
        subtitle: '90 phút · 22 câu hỏi (3 phần chuẩn Bộ GD&ĐT)'
      };
    }
    return {
      title: 'Phòng luyện THPTQG – Thực chiến',
      badge: 'THPTQG · MÔN TOÁN',
      subtitle: '90 phút · 22 câu hỏi (3 phần chuẩn Bộ GD&ĐT)'
    };
  };

  const normalizedInitial = String(initialExamType || '').trim().toLowerCase();
  let viewingPastPool = normalizedInitial === 'past';
  let activeExamType =
    !viewingPastPool && normalizedInitial && allowedRooms.includes(normalizedInitial)
      ? normalizedInitial
      : null;

  let searchQuery = '';
  let sortMode = 'priority'; // 'priority' | 'newest' | 'popular'
  let statusFilter = 'all'; // 'all' | 'unattempted' | 'attempted'
  let modeFilter = 'all'; // 'all' | 'full' | 'section'
  let sectionFilter = 'all'; // 'all' | 'part_1' | 'part_2' | 'part_3'
  const parsedInitialGrade = Number(initialGradeFilter);
  let gradeFilter =
    effectiveGrade ||
    ([10, 11, 12].includes(parsedInitialGrade) && availableThptqgGrades.includes(parsedInitialGrade)
      ? parsedInitialGrade
      : availableThptqgGrades[0]) ||
    12;

  const reloadPortal = (extraOpts = {}) => {
    invalidateOpsPracticeStatsCache();
    return renderPracticeRoomsPortal({
      container,
      api,
      status,
      classGrade,
      viewerRole,
      initialExamType: viewingPastPool ? 'past' : activeExamType,
      initialGradeFilter: gradeFilter,
      onNavigateExamType,
      onOpenExamSolution,
      ...extraOpts
    });
  };

  // Khởi chạy bài thi (gọi POST /api/exams/:examId/start)
  async function launchExamAttempt(
    exam,
    {
      practiceMode = 'full',
      sectionKey = 'all',
      selectedCombination = null,
      isPreview = false,
      forceRestart = false
    } = {}
  ) {
    const openOverlayForStarted = (startedPayload) => {
      mountExamTakingOverlay({
        initialAttempt: startedPayload,
        access,
        api,
        status,
        onSubmitted: (resultPayload, opts) => {
          mountResultReviewOverlay({
            resultData: resultPayload,
            access,
            api,
            status,
            showHsaSummaryFirst: opts?.showHsaSummaryFirst,
            onRetakeExam: () => reloadPortal({ autoOpenExamId: exam.id, autoOpenIsPreview: isPreview }),
            onCloseToLobby: () => reloadPortal()
          });
        },
        onExitLobby: () => reloadPortal(),
        onSwitchMode: () => reloadPortal({ autoOpenExamId: exam.id, autoOpenIsPreview: isPreview })
      });
    };

    try {
      status('Đang chuẩn bị phòng thi...', false, 'loading');
      const started = await api(`/api/exams/${exam.id}/start`, {
        method: 'POST',
        body: {
          practiceMode,
          sectionKey,
          selectedCombination,
          isPreview,
          forceRestart
        }
      });
      status('');
      openOverlayForStarted(started);
    } catch (err) {
      if (err?.status === 409 && err?.code === 'ATTEMPT_IN_PROGRESS_OTHER_MODE') {
        status('Đang chuyển sang phần thi bạn vừa chọn...', false, 'loading');
        const restarted = await api(`/api/exams/${exam.id}/start`, {
          method: 'POST',
          body: {
            practiceMode,
            sectionKey,
            selectedCombination,
            isPreview,
            forceRestart: true
          }
        });
        status('');
        openOverlayForStarted(restarted);
        return;
      }
      status(err?.message || 'Không thể bắt đầu bài thi.', true);
    }
  }

  // Mở kết quả một lần làm bài trong lịch sử
  async function openAttemptResultById(exam, attemptId) {
    try {
      status('Đang tải kết quả & lời giải chi tiết...', false, 'loading');
      const resultData = await api(`/api/practice/exams/${exam.id}/attempts/${attemptId}`);
      status('');
      mountResultReviewOverlay({
        resultData,
        access,
        api,
        status,
        showHsaSummaryFirst: false,
        onRetakeExam: () => openExamEntryFlow(exam),
        onCloseToLobby: reloadPortal
      });
    } catch (err) {
      status(err?.message || 'Không tải được kết quả lần làm bài này.', true);
    }
  }

  function openExamHistoryModal(ex, historyList) {
    const list = [...(Array.isArray(historyList) ? historyList : [])].reverse();
    const eType = String(ex?.examType || 'thptqg').toLowerCase();
    const titleId = `ltch-exam-history-title-${Date.now()}`;

    const cleanupAndClose = () => {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanupAndClose();
      }
    };

    const closeBtn = h(
      'button',
      {
        type: 'button',
        class: 'ltch-modal-close',
        'aria-label': 'Đóng hộp thoại',
        onclick: cleanupAndClose
      },
      '×'
    );

    const historyBody =
      list.length > 0
        ? h(
            'div',
            { class: 'ltch-history-list ltch-history-modal-list' },
            ...list.map((hItem, idx) => {
              const attemptNo = hItem?.attemptNo ?? list.length - idx;
              const rawWhen = hItem?.submittedAt || hItem?.completedAt || hItem?.createdAt || '';
              const formattedWhen = rawWhen && typeof formatDateTimeVi === 'function' ? formatDateTimeVi(rawWhen) : '';
              const metaParts = [`Thời gian: ${formatTimeSpentVi(hItem?.timeSpentSeconds || 0)}`];
              if (formattedWhen && formattedWhen !== '—' && formattedWhen !== '-') {
                metaParts.push(formattedWhen);
              }
              return h(
                'div',
                { class: 'ltch-history-row' },
                h(
                  'div',
                  { class: 'ltch-history-info' },
                  h(
                    'div',
                    { class: 'ltch-history-main' },
                    h('span', { class: 'ltch-history-badge', text: `Lần ${attemptNo}` }),
                    h('strong', { class: 'ltch-history-score', text: `${hItem?.score ?? 0}/${hItem?.max ?? 0} điểm` })
                  ),
                  h('span', {
                    class: 'ltch-history-meta',
                    text: metaParts.join(' · ')
                  })
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: `ltch-history-view-btn is-${eType}`,
                    onclick: () => {
                      cleanupAndClose();
                      openAttemptResultById(ex, hItem.attemptId);
                    }
                  },
                  'Xem lời giải'
                )
              );
            })
          )
        : h('p', { class: 'ltch-modal-sub', text: 'Chưa có lượt làm bài nào được lưu cho đề này.' });

    const card = h(
      'div',
      {
        class: 'ltch-modal-card ltch-exam-history-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        onclick: (e) => e.stopPropagation()
      },
      h(
        'div',
        { class: 'ltch-modal-header' },
        h(
          'div',
          { class: 'ltch-exam-choice-heading' },
          h('span', {
            class: `ltch-brand-pill is-${eType}`,
            text: `${(ex?.examType || 'thptqg').toUpperCase()} · ĐỀ ${ex?.examCode || '01'}`
          }),
          h('h3', { id: titleId, text: ex?.title || 'Lịch sử làm bài' })
        ),
        closeBtn
      ),
      h('p', {
        class: 'ltch-modal-sub',
        text: `Tổng cộng ${list.length} lần hoàn thành · Chọn một lần làm bài để xem lại điểm số & lời giải chi tiết:`
      }),
      historyBody,
      h(
        'div',
        { class: 'ltch-history-modal-footer' },
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-outline',
            onclick: cleanupAndClose
          },
          'Đóng'
        ),
        h(
          'button',
          {
            type: 'button',
            class: `ltch-btn ltch-btn-primary is-${eType}`,
            onclick: () => {
              cleanupAndClose();
              openExamEntryFlow(ex, { isPreview: false });
            }
          },
          'Làm lại đề'
        )
      )
    );

    const backdrop = h(
      'div',
      {
        class: 'ltch-modal-backdrop',
        onclick: cleanupAndClose
      },
      card
    );

    document.addEventListener('keydown', onKeyDown);
    document.body.append(backdrop);
    closeBtn.focus();
  }

  function openExamActionChoiceModal(ex) {
    const att = attemptsByExam[ex.id] || { inProgressAttempt: null, history: [] };
    const inProg = att.inProgressAttempt;
    const history = att.history || [];
    const eType = String(ex.examType || 'thptqg').toLowerCase();
    const titleId = `ltch-exam-choice-title-${Date.now()}`;

    const cleanupAndClose = () => {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanupAndClose();
      }
    };

    const closeBtn = h('button', {
      type: 'button',
      class: 'ltch-modal-close',
      'aria-label': 'Đóng hộp thoại',
      onclick: cleanupAndClose
    }, '×');

    const doExamLabel = inProg
      ? '1. Tiếp tục làm đề'
      : history.length > 0
        ? '1. Làm lại đề'
        : '1. Làm đề';

    const solSummary = 'Mở trang video bài chữa & file tài liệu lời giải';

    const playIcon = h('span', { class: `ltch-exam-choice-icon is-${eType}`, 'aria-hidden': 'true' });
    playIcon.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>';

    const bookIcon = h('span', { class: `ltch-exam-choice-icon is-sol-${eType}`, 'aria-hidden': 'true' });
    bookIcon.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>';

    const historyIcon = h('span', { class: `ltch-exam-choice-icon is-hist-${eType}`, 'aria-hidden': 'true' });
    historyIcon.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>';

    const doExamBtn = h(
      'button',
      {
        type: 'button',
        class: `ltch-exam-choice-card-btn is-primary is-${eType}`,
        onclick: () => {
          cleanupAndClose();
          openExamEntryFlow(ex, { isPreview: false });
        }
      },
      playIcon,
      h(
        'span',
        { class: 'ltch-exam-choice-copy' },
        h('strong', { class: 'ltch-exam-choice-title', text: doExamLabel }),
        h('span', {
          class: 'ltch-exam-choice-sub',
          text: `${ex.questionCount || 0} câu · ${ex.durationMinutes || 90} phút · Bấm giờ thi trực tuyến`
        })
      )
    );

    const viewSolutionBtn = h(
      'button',
      {
        type: 'button',
        class: `ltch-exam-choice-card-btn is-secondary is-${eType}`,
        onclick: () => {
          cleanupAndClose();
          if (typeof onOpenExamSolution === 'function') {
            onOpenExamSolution(ex);
          } else {
            openExamEntryFlow(ex, { isPreview: false });
          }
        }
      },
      bookIcon,
      h(
        'span',
        { class: 'ltch-exam-choice-copy' },
        h('strong', { class: 'ltch-exam-choice-title', text: '2. Xem chữa đề' }),
        h('span', { class: 'ltch-exam-choice-sub', text: solSummary })
      )
    );

    const historyBtn =
      history.length > 0
        ? h(
            'button',
            {
              type: 'button',
              class: `ltch-exam-choice-card-btn is-secondary is-history is-${eType}`,
              onclick: () => {
                cleanupAndClose();
                openExamHistoryModal(ex, history);
              }
            },
            historyIcon,
            h(
              'span',
              { class: 'ltch-exam-choice-copy' },
              h('strong', { class: 'ltch-exam-choice-title', text: '3. Lịch sử làm bài' }),
              h('span', {
                class: 'ltch-exam-choice-sub',
                text: `${history.length} lần hoàn thành · Xem lại điểm số & lời giải từng lần`
              })
            )
          )
        : null;

    const card = h(
      'div',
      {
        class: 'ltch-modal-card ltch-exam-choice-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        onclick: (e) => e.stopPropagation()
      },
      h(
        'div',
        { class: 'ltch-modal-header' },
        h(
          'div',
          { class: 'ltch-exam-choice-heading' },
          h('span', {
            class: `ltch-brand-pill is-${eType}`,
            text: `${(ex.examType || 'thptqg').toUpperCase()} · ĐỀ ${ex.examCode || '01'}`
          }),
          h('h3', { id: titleId, text: ex.title || 'Chọn thao tác với đề' })
        ),
        closeBtn
      ),
      h('p', { class: 'ltch-modal-sub', text: 'Chọn thao tác với đề luyện này:' }),
      h('div', { class: 'ltch-exam-choice-list' }, doExamBtn, viewSolutionBtn, historyBtn)
    );

    const backdrop = h(
      'div',
      {
        class: 'ltch-modal-backdrop',
        onclick: cleanupAndClose
      },
      card
    );

    document.addEventListener('keydown', onKeyDown);
    document.body.append(backdrop);
    doExamBtn.focus();
  }

  // Luồng chọn chế độ thi trước khi vào Phòng thi (THPTQG vào thẳng; HSA chọn Cả đề / Từng phần + Tổ hợp Q01-Q10; TSA chọn Phần 1/2/3 hoặc Cả đề)
  function openExamEntryFlow(exam, { isPreview = false } = {}) {
    const eType = String(exam.examType || 'thptqg').toLowerCase();
    const attInfo = attemptsByExam[exam.id];
    const inProg = !isPreview ? attInfo?.inProgressAttempt || null : null;

    if (eType === 'thptqg') {
      if (inProg) {
        launchExamAttempt(exam, {
          practiceMode: inProg.practiceMode,
          sectionKey: inProg.sectionKey,
          selectedCombination: inProg.selectedCombination,
          isPreview: false
        });
        return;
      }
      launchExamAttempt(exam, { practiceMode: 'full', sectionKey: 'all', isPreview });
      return;
    }

    const backdrop = h('div', { class: 'ltch-modal-backdrop ltch-practice-entry-backdrop' });

    if (eType === 'tsa') {
      // Hộp thoại Thông tin bài thi chuẩn 9Study TSA
      const partMetaList = [
        {
          key: 'part_1',
          title: '1. TSA – Phần thi Tư duy Toán học',
          dur: 60,
          count: exam.sectionCounts?.part_1 || 0
        },
        {
          key: 'part_2',
          title: '2. TSA – Phần thi Đọc hiểu',
          dur: 30,
          count: exam.sectionCounts?.part_2 || 0
        },
        {
          key: 'part_3',
          title: '3. TSA – Phần thi Giải quyết vấn đề',
          dur: 60,
          count: exam.sectionCounts?.part_3 || 0
        }
      ];

      const modalCard = createPracticeEntryModal([
        h('div', { class: 'ltch-tsa-9s-modal-logo', text: 'TSA' }),
        h('div', { class: 'ltch-tsa-9s-modal-subtitle', text: 'KỲ THI ĐÁNH GIÁ TƯ DUY' }),
        h('h3', { class: 'ltch-tsa-9s-modal-heading', text: 'Thông tin bài thi' }),
        h(
          'div',
          { class: 'ltch-tsa-9s-meta-table' },
          h(
            'div',
            { class: 'ltch-tsa-9s-meta-row' },
            h('span', { text: 'Họ tên' }),
            h('strong', { text: access?.displayName || 'Học sinh' })
          ),
          h(
            'div',
            { class: 'ltch-tsa-9s-meta-row' },
            h('span', { text: 'Ngày sinh' }),
            h('strong', { text: access?.birthDate || access?.studentCode || '04/06/2008' })
          ),
          h(
            'div',
            { class: 'ltch-tsa-9s-meta-row' },
            h('span', { text: 'Môn thi' }),
            h('strong', { text: exam.title || 'Đề thi Đánh giá tư duy TSA' })
          ),
          h(
            'div',
            { class: 'ltch-tsa-9s-meta-row' },
            h('span', { text: 'Phần thi' }),
            h('strong', { text: 'TSA - Đánh giá tư duy (3 phần)' })
          ),
          h(
            'div',
            { class: 'ltch-tsa-9s-meta-row' },
            h('span', { text: 'Thời gian' }),
            h('strong', { text: `${exam.durationMinutes || 150} phút` })
          )
        ),
        h('h4', { class: 'ltch-tsa-9s-sec-heading', text: 'Chọn phần thi' }),
        h(
          'div',
          { class: 'ltch-tsa-9s-sec-list' },
          ...partMetaList.map((pm) => {
            const isSecInProg =
              inProg && inProg.practiceMode === 'section' && (inProg.sectionKey || 'all') === pm.key;
            return h(
              'div',
              { class: 'ltch-tsa-9s-sec-item is-active' },
              h('div', { class: 'ltch-tsa-9s-sec-title', text: pm.title }),
              h(
                'div',
                { class: 'ltch-tsa-9s-sec-bottom' },
                h('span', { class: 'ltch-tsa-9s-sec-dur', text: `Thời gian: ${pm.dur} phút` }),
                h(
                  'div',
                  { class: 'ltch-tsa-9s-sec-actions' },
                  h('span', {
                    class: 'ltch-tsa-9s-sec-status',
                    text: isSecInProg ? 'Đang làm dở' : 'Chưa thi'
                  }),
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'ltch-tsa-9s-sec-btn is-red',
                      disabled: pm.count === 0 && exam.rawQuestionCount > 0,
                      onclick: () => {
                        backdrop.remove();
                        launchExamAttempt(exam, {
                          practiceMode: 'section',
                          sectionKey: pm.key,
                          isPreview,
                          forceRestart: Boolean(inProg && !isSecInProg)
                        });
                      }
                    },
                    isSecInProg ? 'Tiếp tục phần này' : 'Làm phần này'
                  )
                )
              )
            );
          })
        )
      ], [
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-tsa-9s-full-btn',
            onclick: () => {
              const isFullInProg = inProg && inProg.practiceMode === 'full';
              backdrop.remove();
              launchExamAttempt(exam, {
                practiceMode: 'full',
                sectionKey: 'all',
                isPreview,
                forceRestart: Boolean(inProg && !isFullInProg)
              });
            }
          },
          inProg && inProg.practiceMode === 'full'
            ? 'Tiếp tục cả đề 3 phần (150 phút · 100 câu)'
            : 'Thi cả đề 3 phần (150 phút · 100 câu)'
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-tsa-9s-home-link',
            onclick: () => backdrop.remove()
          },
          'Về trang chủ'
        )
      ]);
      backdrop.append(modalCard);
      document.body.append(backdrop);
      return;
    }

    // Hộp thoại chọn Phần thi chuẩn 9Study HSA (Tổ hợp Phần 3 được chọn trên màn hình 9Study HSA khi vào Phần 3)
    const hsaParts = [
      {
        key: 'part_1',
        title: 'Phần 1: Toán học và Xử lý số liệu (Tư duy Định lượng)',
        meta: '75 phút · 50 câu hỏi · 50 điểm'
      },
      {
        key: 'part_2',
        title: 'Phần 2: Ngôn ngữ - Văn học (Tư duy Định tính)',
        meta: '60 phút · 50 câu hỏi · 50 điểm'
      },
      {
        key: 'part_3',
        title: 'Phần 3: Khoa học (Tự chọn Q01–Q10) hoặc Tiếng Anh',
        meta: '60 phút · 50 câu hỏi · 50 điểm'
      }
    ];

    const modalCard = createPracticeEntryModal([
      h(
        'div',
        { class: 'ltch-hsa-9s-logo-blocks is-compact', 'aria-hidden': 'true' },
        h('span', { class: 'ltch-hsa-9s-logo-block is-h', text: 'H' }),
        h('span', { class: 'ltch-hsa-9s-logo-block is-s', text: 'S' }),
        h('span', { class: 'ltch-hsa-9s-logo-block is-a', text: 'A' })
      ),
      h('div', { class: 'ltch-tsa-9s-modal-subtitle', text: 'KỲ THI ĐÁNH GIÁ NĂNG LỰC ĐHQGHN' }),
      h('h3', { class: 'ltch-tsa-9s-modal-heading', text: exam.title || 'Đề thi thử HSA' }),
      h('h4', { class: 'ltch-tsa-9s-sec-heading', text: 'Chọn hình thức làm bài' }),
      h(
        'div',
        { class: 'ltch-tsa-9s-sec-list' },
        ...hsaParts.map((hp) => {
          const isSecInProg =
            inProg && inProg.practiceMode === 'section' && (inProg.sectionKey || 'all') === hp.key;
          return h(
            'div',
            { class: 'ltch-tsa-9s-sec-item is-active' },
            h('div', { class: 'ltch-tsa-9s-sec-title', text: hp.title }),
            h(
              'div',
              { class: 'ltch-tsa-9s-sec-bottom' },
              h('span', { class: 'ltch-tsa-9s-sec-dur', text: hp.meta }),
              h(
                'div',
                { class: 'ltch-tsa-9s-sec-actions' },
                isSecInProg
                  ? h(
                      'button',
                      {
                        type: 'button',
                        class: 'ltch-tsa-9s-sec-btn is-disabled',
                        onclick: () => {
                          backdrop.remove();
                          launchExamAttempt(exam, {
                            practiceMode: 'section',
                            sectionKey: hp.key,
                            selectedCombination: 'Q01',
                            isPreview,
                            forceRestart: true
                          });
                        }
                      },
                      hp.key === 'part_3' ? 'Chọn lại tổ hợp' : 'Làm mới'
                    )
                  : null,
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'ltch-tsa-9s-sec-btn is-green',
                    onclick: () => {
                      backdrop.remove();
                      launchExamAttempt(exam, {
                        practiceMode: 'section',
                        sectionKey: hp.key,
                        selectedCombination: isSecInProg ? inProg.selectedCombination || 'Q01' : 'Q01',
                        isPreview,
                        forceRestart: Boolean(inProg && !isSecInProg)
                      });
                    }
                  },
                  isSecInProg ? 'Tiếp tục phần này' : 'Làm phần này'
                )
              )
            )
          );
        })
      )
    ], [
      h(
        'button',
        {
          type: 'button',
          class: 'ltch-tsa-9s-full-btn is-green',
          onclick: () => {
            const isFullInProg = inProg && inProg.practiceMode === 'full';
            backdrop.remove();
            launchExamAttempt(exam, {
              practiceMode: 'full',
              sectionKey: 'all',
              selectedCombination: isFullInProg ? inProg.selectedCombination || 'Q01' : 'Q01',
              isPreview,
              forceRestart: Boolean(inProg && !isFullInProg)
            });
          }
        },
        inProg && inProg.practiceMode === 'full'
          ? 'Tiếp tục cả đề 3 phần (195 phút · 150 câu)'
          : 'Thi cả đề 3 phần (195 phút · 150 câu)'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'ltch-tsa-9s-home-link is-green',
          onclick: () => backdrop.remove()
        },
        'Đóng'
      )
    ], 'is-hsa-entry');
    backdrop.append(modalCard);
    document.body.append(backdrop);
  }

  // Mở trình chỉnh sửa đề thi (cho Giáo viên / Trợ giảng / Admin)
  async function openExistingExamInEditor(examIdToEdit) {
    try {
      status('Đang tải dữ liệu đề thi...', false, 'loading');
      const detail = await api(`/api/admin/practice/exams/${examIdToEdit}`);
      status('');
      openWordExamUploadWorkspace({
        initialExam: detail.exam,
        defaultExamType: detail.exam?.exam_type || activeExamType || 'thptqg',
        access,
        api,
        status,
        onSaved: reloadPortal,
        onStartPreview: (idToPreview) => {
          const found = allExams.find((x) => x.id === idToPreview) || {
            id: idToPreview,
            title: detail.exam?.title || 'Đề làm thử',
            examType: detail.exam?.exam_type || activeExamType || 'thptqg'
          };
          openExamEntryFlow(found, { isPreview: true });
        }
      });
    } catch (err) {
      status(err?.message || 'Không tải được chi tiết đề thi.', true);
    }
  }

  function openBulkWordExamUploadModal({
    defaultExamType = 'thptqg',
    defaultTargetGrade = 12,
    access: modalAccess,
    api: modalApi,
    status: modalStatus,
    onSaved
  }) {
    const backdrop = h('div', { class: 'ltch-modal-backdrop' });
    const bodyBox = h('div', { class: 'ltch-modal-body' });
    const footerBox = h('div', { class: 'ltch-modal-footer' });

    const defaultDuration = { thptqg: 90, hsa: 195, tsa: 150 };
    let selectedExamType = String(defaultExamType || 'thptqg').toLowerCase();
    if (!defaultDuration[selectedExamType]) selectedExamType = 'thptqg';
    let selectedGrade = [10, 11, 12].includes(Number(defaultTargetGrade)) ? Number(defaultTargetGrade) : 12;
    let allowPartialStructure = true;
    let queue = [];
    let lastRawFiles = [];
    let parsing = false;
    let publishing = false;
    let noticeText = '';
    let noticeIsError = false;

    const closeBtn = h('button', {
      type: 'button',
      class: 'ltch-modal-close',
      onclick: () => { if (!parsing && !publishing) backdrop.remove(); },
      text: '×'
    });

    const bulkFilesInput = h('input', {
      type: 'file',
      'data-bulk-files': '1',
      accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      multiple: true,
      hidden: true,
      onchange: (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        handleBulkFilesSelected(files);
      }
    });
    const bulkDirInput = h('input', {
      type: 'file',
      'data-bulk-dir': '1',
      webkitdirectory: true,
      multiple: true,
      hidden: true,
      onchange: (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        handleBulkFilesSelected(files);
      }
    });

    const card = h(
      'div',
      { class: 'ltch-modal-card ltch-modal-lg ltch-bulk-upload-modal', onclick: (e) => e.stopPropagation() },
      h(
        'div',
        { class: 'ltch-modal-header' },
        h('h3', { text: `Đăng tải nhiều đề ${selectedExamType.toUpperCase()} (Word .docx)` }),
        closeBtn
      ),
      bulkFilesInput,
      bulkDirInput,
      bodyBox,
      footerBox
    );
    backdrop.append(card);
    backdrop.onclick = () => { if (!parsing && !publishing) backdrop.remove(); };
    document.body.append(backdrop);

    const isItemPublishable = (item) =>
      Boolean(
        item &&
        item.questions.length > 0 &&
        !item.parseErrors.length &&
        !item.missingImages.size &&
        (item.structure.valid || allowPartialStructure)
      );

    async function handleBulkFilesSelected(rawFiles) {
      if (!rawFiles.length || parsing || publishing) return;
      lastRawFiles = Array.from(rawFiles);
      parsing = true;
      noticeText = `Đang đọc ${rawFiles.length} tệp theo phương thức ${selectedExamType.toUpperCase()}...`;
      noticeIsError = false;
      queue = [];
      render();

      try {
        const grouped = groupBulkExamSourceFiles(rawFiles);
        const ignoredCount = Number(grouped.ignoredCount || 0);
        if (!grouped.groups.length) {
          noticeText = 'Không tìm thấy tệp Word (.docx) hợp lệ nào trong danh sách đã chọn.';
          noticeIsError = true;
          return;
        }

        const built = [];
        for (let i = 0; i < grouped.groups.length; i++) {
          const g = grouped.groups[i];
          const docxFile = g.docxFiles[0];
          noticeText = `Đang phân tích đề ${i + 1}/${grouped.groups.length}: ${docxFile.name}...`;
          render();
          try {
            const parsed = await parseWordExamFiles([docxFile], { expectedExamType: selectedExamType });
            const declaredType = parsed.hasExamTypeCommand ? parsed.meta?.examType : null;
            const methodMismatchError =
              declaredType && declaredType !== selectedExamType
                ? `Tệp khai báo [KỲ THI] ${declaredType.toUpperCase()}, không thuộc phương thức đang chọn (${selectedExamType.toUpperCase()}). Mỗi đợt chỉ đăng tải các bộ đề cùng 1 phương thức.`
                : null;
            const itemType = selectedExamType;
            const rawCode = String(parsed.meta?.examCode || (g.orderNum && g.orderNum < 1000 ? String(g.orderNum).padStart(2, '0') : String(i + 1).padStart(2, '0')));
            const fallbackBase = g.folderHint && extractBulkExamNumber(g.folderHint) != null
              ? g.folderHint
              : docxFile.name.replace(/\.docx$/i, '');
            const rawTitle = parsed.meta?.title || fallbackBase;
            const itemTitle = rawTitle.startsWith('[LTCH]') ? rawTitle : `[LTCH] ${rawTitle}`;
            const hasExplicitGrade = Boolean(parsed.meta?.grade && [10, 11, 12].includes(Number(parsed.meta.grade)));
            const itemGrade = hasExplicitGrade ? Number(parsed.meta.grade) : selectedGrade;
            const structure = checkExamStructure(itemType, parsed.questions || [], { requireFull: true });
            const missingImages = missingPracticeImageIds(parsed.questions || []);
            const noteParts = [];
            if (methodMismatchError) noteParts.push(methodMismatchError);
            if (parsed.errors?.length) noteParts.push(`Lỗi đọc Word: ${parsed.errors[0]}`);
            if (missingImages.size) noteParts.push(`Thiếu ${missingImages.size} ảnh`);
            if (!structure.valid && structure.errors?.length) noteParts.push(structure.errors[0]);
            const oversized = docxFile.size > 10 * 1024 * 1024 ? docxFile : null;
            if (oversized) noteParts.push(`Tệp "${oversized.name}" vượt quá 10 MB`);

            const item = {
              id: `bulk_${i + 1}`,
              groupKey: g.groupKey,
              title: itemTitle,
              examType: itemType,
              examCode: rawCode,
              hasExplicitGrade,
              targetGrade: itemGrade,
              durationMinutes: defaultDuration[itemType] || 195,
              docxFiles: [docxFile],
              questions: parsed.questions || [],
              questionCount: (parsed.questions || []).length,
              parseErrors: [
                ...(methodMismatchError ? [methodMismatchError] : []),
                ...(parsed.errors || []),
                ...(oversized ? [`Tệp vượt quá 10 MB: ${oversized.name}`] : [])
              ],
              structure,
              missingImages,
              note: noteParts.join(' · '),
              state: 'pending',
              statusText: '',
              publishedExamId: null
            };
            item.state = isItemPublishable(item) ? 'pending' : 'invalid';
            item.statusText = item.state === 'pending'
              ? (item.note ? `Sẵn sàng (đã cho phép đề rút gọn: ${item.note})` : 'Sẵn sàng phát hành')
              : (item.note || 'Chưa đủ điều kiện phát hành');
            built.push(item);
          } catch (err) {
            built.push({
              id: `bulk_${i + 1}`,
              groupKey: g.groupKey,
              title: g.groupKey,
              examType: selectedExamType,
              examCode: String(i + 1).padStart(2, '0'),
              hasExplicitGrade: false,
              targetGrade: selectedGrade,
              durationMinutes: defaultDuration[selectedExamType] || 195,
              docxFiles: [docxFile],
              questions: [],
              questionCount: 0,
              parseErrors: [err?.message || 'Không đọc được tệp .docx'],
              structure: { valid: false, errors: [] },
              missingImages: new Set(),
              note: err?.message || 'Không đọc được tệp .docx',
              state: 'invalid',
              statusText: err?.message || 'Lỗi đọc tệp .docx',
              publishedExamId: null
            });
          }
        }
        queue = built;
        const readyCount = queue.filter((x) => x.state === 'pending').length;
        noticeText = `Đã nhận diện ${queue.length} bộ đề ${selectedExamType.toUpperCase()} (${readyCount}/${queue.length} đề sẵn sàng phát hành${ignoredCount ? `, tự bỏ qua ${ignoredCount} tệp lưu tạm ngoài .docx` : ''}).`;
        noticeIsError = readyCount === 0;
      } finally {
        parsing = false;
        render();
      }
    }

    async function publishAllPending() {
      if (parsing || publishing) return;
      const targets = queue.filter((item) => (item.state === 'pending' || item.state === 'error') && isItemPublishable(item));
      if (!targets.length) return;
      publishing = true;
      closeBtn.disabled = true;
      let okCount = 0;
      let errCount = 0;
      render();

      try {
        for (let i = 0; i < queue.length; i++) {
          const item = queue[i];
          if ((item.state !== 'pending' && item.state !== 'error') || !isItemPublishable(item)) continue;
          item.state = 'uploading';
          item.statusText = 'Đang chuẩn bị tải lên Google Drive...';
          render();
          try {
            const saved = await uploadAndSavePracticeExam({
              api: modalApi,
              action: 'publish',
              allowPartialStructure,
              examId: null,
              isNewExam: true,
              examType: item.examType,
              examMode: 'full',
              targetGrade: item.targetGrade,
              schoolYearId: modalAccess?.currentSchoolYearId || 'year-2026-2027',
              examCode: item.examCode,
              title: item.title,
              durationMinutes: item.durationMinutes,
              uploadedSourceFiles: [...item.docxFiles],
              stagedSourceFiles: [],
              questions: item.questions,
              onProgress: ({ stage, completedCount, totalCount }) => {
                item.statusText = stage === 'staging'
                  ? `Đang đẩy lên Google Drive (${completedCount}/${totalCount} tệp)...`
                  : 'Đang phát hành đề và lưu chỉ mục Supabase...';
                const badge = bodyBox.querySelector(`[data-bulk-status="${item.id}"]`);
                if (badge) badge.textContent = item.statusText;
              }
            });
            item.state = 'published';
            item.publishedExamId = saved.examId;
            item.questions = [];
            item.statusText = `✓ Đã phát hành (${saved.examId})`;
            okCount++;
          } catch (err) {
            item.state = 'error';
            item.statusText = `Lỗi: ${err?.message || 'Không thể phát hành bộ đề.'}`;
            errCount++;
          }
          render();
        }
        noticeText = errCount === 0
          ? `Hoàn tất: đã phát hành ${okCount}/${targets.length} bộ đề ${selectedExamType.toUpperCase()} lên Google Drive!`
          : `Đã phát hành ${okCount}/${targets.length} bộ đề (${errCount} bộ lỗi).`;
        noticeIsError = errCount > 0;
        if (okCount > 0) {
          modalStatus(`Đã phát hành ${okCount} bộ đề ${selectedExamType.toUpperCase()} lên Google Drive!`, false, 'success');
          if (typeof onSaved === 'function') await onSaved();
        }
      } finally {
        publishing = false;
        closeBtn.disabled = false;
        render();
      }
    }

    function render() {
      bodyBox.replaceChildren();
      footerBox.replaceChildren();

      const bulkSpec = EXAM_FORM_SPECS[selectedExamType] || EXAM_FORM_SPECS.thptqg;
      const controls = h(
        'div',
        { class: 'ltch-bulk-meta-grid' },
        h(
          'div',
          { class: 'ltch-field-label' },
          h('span', { text: 'Kỳ thi đang chọn' }),
          h('span', {
            class: `ltch-dropzone-form-pill is-${selectedExamType}`,
            text: `FORM ${bulkSpec.shortLabel} · ${bulkSpec.fullLabel}`
          })
        ),
        selectedExamType === 'thptqg'
          ? h(
              'label',
              { class: 'ltch-field-label' },
              h('span', { text: 'Khối lớp' }),
              h(
                'select',
                {
                  class: 'ltch-select',
                  disabled: parsing || publishing,
                  onchange: (e) => {
                    selectedGrade = Number(e.target.value) || 12;
                    for (const item of queue) {
                      if (!item.hasExplicitGrade) item.targetGrade = selectedGrade;
                    }
                    render();
                  }
                },
                h('option', { value: '12', selected: selectedGrade === 12, text: 'Khối 12' }),
                h('option', { value: '11', selected: selectedGrade === 11, text: 'Khối 11' }),
                h('option', { value: '10', selected: selectedGrade === 10, text: 'Khối 10' })
              )
            )
          : null
      );

      const pickGrid = h(
        'div',
        { class: 'ltch-bulk-pick-grid' },
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-primary',
            disabled: parsing || publishing,
            onclick: () => bulkFilesInput.click()
          },
          uiIcon('fileText'),
          h('span', { text: 'Chọn nhiều đề Word (.docx)' })
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'ltch-btn ltch-btn-outline',
            disabled: parsing || publishing,
            onclick: () => bulkDirInput.click()
          },
          uiIcon('folder'),
          h('span', { text: 'Chọn thư mục chứa đề Word' })
        )
      );

      const bulkAiBar = h(
        'div',
        { class: 'ltch-bulk-ai-guide-bar' },
        h(
          'div',
          { class: 'ltch-bulk-ai-guide-copy' },
          h(
            'div',
            { class: 'ltch-ai-guide-eyebrow-row' },
            h('strong', { text: 'Trợ lý soạn đề bằng AI' }),
            h('span', { class: 'ltch-ai-recommended-badge', text: 'Khuyên dùng' })
          ),
          h('span', {
            class: 'meta',
            text: 'Hỗ trợ 2 cách: tải trực tiếp đề Word thường để tự động nhận diện, hoặc dùng AI chuyển đề bài & lời giải sang chuẩn LaTeX 100% trước khi tải hàng loạt.'
          })
        ),
        h(
          'div',
          { class: 'ltch-bulk-ai-guide-actions' },
          h(
            'a',
            {
              href: bulkSpec.templateHref,
              download: bulkSpec.templateFileName,
              class: `ltch-template-link is-${selectedExamType} is-active`
            },
            `⬇ Mẫu ${bulkSpec.shortLabel}`
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-btn ltch-btn-ai ltch-btn-sm',
              disabled: parsing || publishing,
              onclick: () =>
                openAiExamGuideModal({
                  examType: selectedExamType,
                  targetGrade: selectedGrade,
                  schoolYear: normalizeSchoolYearLabel(modalAccess?.currentSchoolYearId),
                  sourceMode: 'separate',
                  status: modalStatus
                })
            },
            uiIcon('sparkle', 15),
            h('span', { text: 'Hướng dẫn & Copy Prompt AI' }),
            h('span', { class: 'ltch-ai-btn-rec-pill', text: 'Khuyên dùng' })
          )
        )
      );

      const partialCheckRow = h(
        'label',
        { class: 'ltch-inline-check ltch-bulk-check-card' },
        h('input', {
          type: 'checkbox',
          'data-bulk-partial': '1',
          checked: allowPartialStructure,
          disabled: parsing || publishing,
          onchange: (e) => {
            allowPartialStructure = e.target.checked;
            for (const item of queue) {
              if (item.state === 'pending' || item.state === 'invalid' || item.state === 'error') {
                item.state = isItemPublishable(item) ? 'pending' : 'invalid';
                item.statusText = item.state === 'pending'
                  ? (item.note ? `Sẵn sàng (đã cho phép đề rút gọn: ${item.note})` : 'Sẵn sàng phát hành')
                  : (item.note || 'Chưa đủ điều kiện phát hành');
              }
            }
            render();
          }
        }),
        h('span', { text: 'Cho phép phát hành đề rút gọn / thiếu câu lẻ môn tự chọn' })
      );

      bodyBox.append(controls, pickGrid, bulkAiBar, partialCheckRow);
      if (noticeText) {
        bodyBox.append(h('p', { class: noticeIsError ? 'form-error' : 'meta', text: noticeText }));
      }

      const list = h('div', { class: 'ltch-reports-list' });
      if (!queue.length) {
        list.append(
          h(
            'div',
            { class: 'ltch-bulk-empty-box' },
            h('p', {
              class: 'meta',
              text: 'Dùng khi đăng tải cùng lúc nhiều bộ đề độc lập thuộc cùng 1 phương thức (ví dụ cùng là HSA). Mỗi tệp Word (.docx) đúng form mẫu sẽ được nhận diện thành 1 bộ đề riêng và tạo 1 thư mục riêng trên Google Drive.'
            })
          )
        );
      } else {
        for (const item of queue) {
          const questionCountLabel = Number.isFinite(item.questionCount) ? item.questionCount : item.questions.length;
          list.append(
            h(
              'div',
              { class: 'ltch-report-row-card' },
              h('strong', { text: `${item.title} (${String(item.examType || '').toUpperCase()} · Mã ${item.examCode})` }),
              h('p', {
                class: 'meta',
                text: `${questionCountLabel} câu · Tệp: ${item.docxFiles[0]?.name || item.groupKey}${item.note ? ` · Lưu ý: ${item.note}` : ''}`
              }),
              h('p', {
                class: item.state === 'invalid' || item.state === 'error' ? 'form-error' : 'meta',
                'data-bulk-status': item.id,
                text: item.statusText
              })
            )
          );
        }
      }
      bodyBox.append(list);

      const readyCount = queue.filter((x) => (x.state === 'pending' || x.state === 'error') && isItemPublishable(x)).length;
      const closeFooterBtn = h('button', {
        type: 'button',
        class: 'ltch-btn ltch-btn-outline',
        disabled: parsing || publishing,
        onclick: () => backdrop.remove()
      }, 'Đóng');
      const publishBtn = h('button', {
        type: 'button',
        class: 'ltch-btn ltch-btn-primary',
        'data-bulk-publish': '1',
        disabled: parsing || publishing || readyCount === 0,
        onclick: publishAllPending
      }, publishing ? 'Đang phát hành...' : `Phát hành ${readyCount} đề ${selectedExamType.toUpperCase()}`);

      footerBox.append(closeFooterBtn, publishBtn);
    }

    render();
  }

  function openStorageDiagnosticsModal({ api: modalApi, status: modalStatus, onPurged }) {
    const backdrop = h('div', { class: 'ltch-modal-backdrop' });
    const bodyBox = h('div', { class: 'ltch-modal-body', text: 'Đang kiểm tra trạng thái lưu trữ Supabase & Google Drive...' });
    let purgeArmed = false;
    let busy = false;

    const closeBtn = h('button', {
      type: 'button',
      class: 'ltch-modal-close',
      onclick: () => { if (!busy) backdrop.remove(); },
      text: '×'
    });
    const footerCloseBtn = h('button', {
      type: 'button',
      class: 'ltch-btn ltch-btn-outline',
      onclick: () => { if (!busy) backdrop.remove(); }
    }, 'Đóng');

    const card = h(
      'div',
      { class: 'ltch-modal-card ltch-modal-lg', onclick: (e) => e.stopPropagation() },
      h(
        'div',
        { class: 'ltch-modal-header' },
        h('h3', { text: 'Lưu trữ Google Drive & Chẩn đoán Supabase (Phòng luyện)' }),
        closeBtn
      ),
      bodyBox,
      h('div', { class: 'ltch-modal-footer' }, footerCloseBtn)
    );
    backdrop.append(card);
    backdrop.onclick = () => { if (!busy) backdrop.remove(); };
    document.body.append(backdrop);

    const loadDiagnostics = async () => {
      try {
        const diag = await modalApi('/api/admin/practice/exams', {
          method: 'POST',
          body: { action: 'storage_diagnostics' }
        });
        bodyBox.replaceChildren();
        const kb = (Number(diag.totalDbJsonBytes || 0) / 1024).toFixed(1) + (diag.approximate ? ' (đo mẫu do đề cũ quá lớn)' : '');
        const summary = h(
          'div',
          { class: 'ltch-report-row-card' },
          h('strong', { text: `Tổng số đề Phòng luyện: ${diag.examsCount} · Ảnh Base64 trong Supabase: ${diag.inlineDataUrlCount} · Tổng JSON Supabase: ${kb} KB` }),
          h('p', {
            class: 'meta',
            text: `ltch_exams: ${diag.tables?.ltch_exams?.count || 0} dòng (${((diag.tables?.ltch_exams?.jsonBytes || 0) / 1024).toFixed(1)} KB) · Ngân hàng câu hỏi: ${diag.tables?.ltch_question_bank?.count || 0} câu · Phiên bản: ${diag.tables?.ltch_question_versions?.count || 0} · Lượt làm: ${diag.tables?.ltch_practice_attempts?.count || 0}`
          })
        );
        bodyBox.append(summary);

        const list = h('div', { class: 'ltch-reports-list' });
        if (!Array.isArray(diag.exams) || !diag.exams.length) {
          list.append(h('p', { class: 'meta', text: 'Hiện không có bộ đề Phòng luyện nào trong cơ sở dữ liệu.' }));
        } else {
          for (const ex of diag.exams) {
            list.append(
              h(
                'div',
                { class: 'ltch-report-row-card' },
                h('strong', { text: `${ex.title} (${String(ex.examType || '').toUpperCase()} · ${ex.status})` }),
                h('p', {
                  class: 'meta',
                  text: `Nơi lưu: ${ex.storage === 'drive' ? 'Google Drive (Pack JSON + Hình + Nguồn)' : 'Inline Supabase'} · ${ex.questionCount} câu · Chỉ mục DB: ${(Number(ex.dbRowBytes || 0) / 1024).toFixed(1)} KB · Tệp nguồn gốc trên Drive: ${ex.sourceFilesCount || 0}`
                })
              )
            );
          }
        }
        bodyBox.append(list);

        const actionRow = h('div', { class: 'ltch-diag-actions-grid' });
        const cleanBtn = h('button', {
          type: 'button',
          class: 'ltch-btn ltch-btn-outline',
          text: 'Dọn thư mục Drive mồ côi'
        });
        const prunePdfBtn = h('button', {
          type: 'button',
          class: 'ltch-btn ltch-btn-outline',
          'data-prune-pdf': '1',
          text: 'Dọn PDF tạm trong File đề'
        });
        const purgeBtn = h('button', {
          type: 'button',
          class: 'ltch-btn ltch-btn-danger-outline',
          text: 'Xóa sạch toàn bộ đề Phòng luyện'
        });
        const cancelArmBtn = h('button', {
          type: 'button',
          class: 'ltch-btn ltch-btn-outline',
          hidden: true,
          text: 'Hủy'
        });
        const setActionsBusy = (nextBusy) => {
          busy = nextBusy;
          cleanBtn.disabled = nextBusy;
          prunePdfBtn.disabled = nextBusy;
          purgeBtn.disabled = nextBusy;
          cancelArmBtn.disabled = nextBusy;
          closeBtn.disabled = nextBusy;
          footerCloseBtn.disabled = nextBusy;
        };
        cancelArmBtn.onclick = () => {
          purgeArmed = false;
          purgeBtn.className = 'ltch-btn ltch-btn-danger-outline';
          purgeBtn.textContent = 'Xóa sạch toàn bộ đề Phòng luyện';
          cancelArmBtn.hidden = true;
        };
        cleanBtn.onclick = async () => {
          if (busy) return;
          setActionsBusy(true);
          cleanBtn.textContent = 'Đang dọn thư mục mồ côi...';
          try {
            let totalCleaned = 0;
            for (let step = 0; step < 20; step++) {
              const res = await modalApi('/api/admin/practice/exams', {
                method: 'POST',
                body: { action: 'clean_orphan_drive_folders' }
              });
              totalCleaned += Number(res.cleanedExamFolders || 0);
              if (!res.remainingOrphanExams) break;
              cleanBtn.textContent = `Đang dọn (còn ${res.remainingOrphanExams} thư mục)...`;
            }
            modalStatus(
              totalCleaned > 0
                ? `Đã dọn sạch ${totalCleaned} thư mục Drive mồ côi.`
                : 'Không còn thư mục Drive mồ côi nào.',
              false,
              'success'
            );
            await loadDiagnostics();
          } catch (err) {
            modalStatus(err?.message || 'Không thể dọn thư mục Drive mồ côi.', true);
            await loadDiagnostics();
          } finally {
            setActionsBusy(false);
            cleanBtn.textContent = 'Dọn thư mục Drive mồ côi';
          }
        };
        prunePdfBtn.onclick = async () => {
          if (busy) return;
          setActionsBusy(true);
          prunePdfBtn.textContent = 'Đang dọn PDF tạm...';
          try {
            let totalTrashed = 0;
            let totalUpdated = 0;
            for (let step = 0; step < 20; step++) {
              const res = await modalApi('/api/admin/practice/exams', {
                method: 'POST',
                body: { action: 'prune_non_docx_exam_sources' }
              });
              totalTrashed += Number(res.trashedFiles || 0);
              totalUpdated += Number(res.updatedExams || 0);
              if (!res.remainingExams) break;
              prunePdfBtn.textContent = `Đang dọn PDF tạm (còn ${res.remainingExams} đề)...`;
            }
            modalStatus(
              totalTrashed > 0
                ? `Đã dọn ${totalTrashed} tệp ngoài .docx khỏi ${totalUpdated} bộ đề trên Drive.`
                : 'Tất cả bộ đề chỉ còn đúng tệp Word (.docx) gốc.',
              false,
              'success'
            );
            await loadDiagnostics();
          } catch (err) {
            modalStatus(err?.message || 'Không thể dọn tệp PDF tạm trong File đề.', true);
            await loadDiagnostics();
          } finally {
            setActionsBusy(false);
            prunePdfBtn.textContent = 'Dọn PDF tạm trong File đề';
          }
        };
        purgeBtn.onclick = async () => {
          if (busy) return;
          if (!purgeArmed) {
            purgeArmed = true;
            purgeBtn.className = 'ltch-btn ltch-btn-danger is-armed-wide';
            purgeBtn.textContent = 'Xác nhận xóa vĩnh viễn toàn bộ đề Phòng luyện';
            cancelArmBtn.hidden = false;
            return;
          }
          setActionsBusy(true);
          purgeBtn.textContent = 'Đang xóa sạch...';
          try {
            let purgedExams = 0;
            let purgedQuestions = 0;
            let finished = false;
            for (let step = 0; step < 120; step++) {
              const res = await modalApi('/api/admin/practice/exams', {
                method: 'POST',
                body: { action: 'purge_all_room_exams', incremental: true }
              });
              purgedExams += res.phase === 'exams' ? 1 : Number(res.purgedExams || 0);
              purgedQuestions += Number(res.deletedQuestions || res.purgedQuestionCodes || 0);
              if (res.phase === 'attempts') {
                purgeBtn.textContent = `Đang dọn lượt làm (${res.remainingAttempts || 0} còn lại)...`;
              } else if (res.phase === 'exams') {
                purgeBtn.textContent = `Đang xóa đề cũ (còn ${res.remainingExams || 0} đề)...`;
              } else if (res.phase === 'bank') {
                purgeBtn.textContent = `Đang xóa câu hỏi (còn ${res.remainingQuestions || 0} câu)...`;
              }
              if (res.done !== false) {
                finished = true;
                break;
              }
            }
            if (!finished) {
              throw new Error('Quá số bước dọn dẹp tối đa, vui lòng bấm xóa tiếp để hoàn tất.');
            }
            purgeArmed = false;
            cancelArmBtn.hidden = true;
            purgeBtn.className = 'ltch-btn ltch-btn-danger-outline';
            purgeBtn.textContent = 'Xóa sạch toàn bộ đề Phòng luyện';
            modalStatus(`Đã xóa sạch ${purgedExams} bộ đề và ${purgedQuestions} câu hỏi Phòng luyện cũ.`, false, 'success');
            if (typeof onPurged === 'function') await onPurged();
            await loadDiagnostics();
          } catch (err) {
            purgeArmed = false;
            cancelArmBtn.hidden = true;
            purgeBtn.className = 'ltch-btn ltch-btn-danger-outline';
            purgeBtn.textContent = 'Xóa sạch toàn bộ đề Phòng luyện';
            modalStatus(err?.message || 'Không thể xóa sạch bộ đề Phòng luyện.', true);
            await loadDiagnostics();
          } finally {
            setActionsBusy(false);
          }
        };
        actionRow.append(cleanBtn, prunePdfBtn, cancelArmBtn, purgeBtn);
        bodyBox.append(actionRow);
      } catch (err) {
        bodyBox.replaceChildren(
          h('p', { class: 'form-error', text: err?.message || 'Không tải được thông số lưu trữ.' }),
          h(
            'div',
            { class: 'ltch-modal-footer' },
            h('button', {
              type: 'button',
              class: 'ltch-btn ltch-btn-outline',
              onclick: () => {
                bodyBox.replaceChildren(document.createTextNode('Đang kiểm tra lại trạng thái lưu trữ Supabase & Google Drive...'));
                loadDiagnostics();
              },
              text: 'Thử lại'
            })
          )
        );
      }
    };

    loadDiagnostics();
  }

  function renderLobby() {
    container.replaceChildren();
    const isHubView = !activeExamType && !viewingPastPool;
    const currentThemeType = viewingPastPool ? 'thptqg' : activeExamType || 'thptqg';
    const root = h('div', {
      class: `ltch-9study-lobby is-theme-${currentThemeType}${isHubView ? ' is-hub-view' : ''}`
    });

    const scopedPastGradePools = Array.isArray(access.pastGradePools)
      ? access.pastGradePools.filter((p) => !effectiveGrade || p.grade < effectiveGrade)
      : [];

    const buildStaffActionsNode = ({ includePastPool = false, allowUpload = true } = {}) => {
      if (!effectiveIsStaff || !access.canManageAny) return null;
      const uploadTargetGrade = effectiveGrade || (activeExamType === 'hsa' ? 12 : gradeFilter) || 12;
      const openBulkUpload = () =>
        openBulkWordExamUploadModal({
          defaultExamType: activeExamType || 'thptqg',
          defaultTargetGrade: uploadTargetGrade,
          access,
          api,
          status,
          onSaved: reloadPortal
        });
      const toolItems = [];
      if (allowUpload) {
        toolItems.push({
          label: 'Đăng tải nhiều đề (cùng phương thức)',
          icon: 'plus',
          onSelect: openBulkUpload
        });
      }
      if (includePastPool && scopedPastGradePools.length > 0) {
        toolItems.push({
          label: 'Kho đề đã học (Khối dưới)',
          icon: 'book',
          onSelect: () => {
            viewingPastPool = true;
            activeExamType = null;
            if (typeof onNavigateExamType === 'function') onNavigateExamType('past');
            renderLobby();
          }
        });
      }
      toolItems.push({
        label: 'Báo lỗi câu hỏi',
        icon: 'flag',
        onSelect: () =>
          openErrorReportsManagerModal({
            api,
            status,
            onOpenExamEditor: openExistingExamInEditor
          })
      });
      if (access.isAdmin) {
        toolItems.push({
          label: 'Lưu trữ Drive',
          icon: 'drive',
          dividerBefore: true,
          onSelect: () =>
            openStorageDiagnosticsModal({
              api,
              status,
              onPurged: reloadPortal
            })
        });
      }
      return h(
        'div',
        { class: 'session-compact-staff-actions ltch-staff-header-actions' },
        allowUpload
          ? h(
              'button',
              {
                type: 'button',
                class: 'ltch-btn ltch-btn-primary',
                onclick: () =>
                  openWordExamUploadWorkspace({
                    initialExam: null,
                    defaultExamType: activeExamType || 'thptqg',
                    defaultTargetGrade: uploadTargetGrade,
                    lockedClassGrade: effectiveGrade,
                    access,
                    api,
                    status,
                    onSaved: reloadPortal,
                    onStartPreview: (previewExamId, previewType) => {
                      openExamEntryFlow(
                        { id: previewExamId, title: 'Đề làm thử', examType: previewType },
                        { isPreview: true }
                      );
                    }
                  })
              },
              '+ Đăng tải đề Word (.docx)'
            )
          : null,
        allowUpload
          ? h(
              'button',
              {
                type: 'button',
                class: 'ltch-btn ltch-btn-outline',
                'data-open-bulk-upload': '1',
                onclick: openBulkUpload
              },
              uiIcon('layers', 15),
              h('span', { text: 'Đăng tải nhiều đề' })
            )
          : null,
        createActionMenu({
          label: 'Công cụ',
          triggerClass: 'ltch-btn ltch-btn-outline',
          items: toolItems
        })
      );
    };

    // =========================================================================
    // MÀN HÌNH CHỌN PHÒNG LUYỆN: 3 Ô THẺ LỚN NHƯ PHẦN BUỔI HỌC (XANH DƯƠNG · XANH LÁ · ĐỎ)
    // =========================================================================
    if (isHubView) {
      const displayGrade = effectiveGrade || (availableThptqgGrades.length === 1 ? availableThptqgGrades[0] : null);
      const hubThptqgMeta = resolveThptqgMeta(displayGrade);
      const roomSpecs = [
        {
          key: 'thptqg',
          badge: hubThptqgMeta.badge,
          title: 'Phòng luyện THPTQG',
          coverSrc: '/practice-covers/thptqg.webp',
          ctaText: 'Vào phòng luyện',
          colorClass: 'is-thptqg'
        },
        {
          key: 'hsa',
          badge: 'HSA · ĐHQG HÀ NỘI',
          title: 'Phòng luyện HSA',
          coverSrc: '/practice-covers/hsa.webp',
          ctaText: 'Vào phòng luyện',
          colorClass: 'is-hsa'
        },
        {
          key: 'tsa',
          badge: 'TSA · ĐHBK HÀ NỘI',
          title: 'Phòng luyện TSA',
          coverSrc: '/practice-covers/tsa.webp',
          ctaText: 'Vào phòng luyện',
          colorClass: 'is-tsa'
        }
      ].filter((spec) => allowedRooms.includes(spec.key));

      const openRoom = (roomKey) => {
        viewingPastPool = false;
        activeExamType = roomKey;
        modeFilter = 'all';
        sectionFilter = 'all';
        statusFilter = 'all';
        searchQuery = '';
        if (typeof onNavigateExamType === 'function') onNavigateExamType(roomKey);
        renderLobby();
        window.scrollTo?.({ top: 0, behavior: 'smooth' });
      };

      const hubRightActions = h('div', { class: 'ltch-hub-right-actions' });
      const staffActionsNode = buildStaffActionsNode({ includePastPool: true, allowUpload: false });
      if (staffActionsNode) {
        hubRightActions.append(staffActionsNode);
      } else if (scopedPastGradePools.length > 0) {
        hubRightActions.append(
          h(
            'button',
            {
              type: 'button',
              class: 'ltch-btn ltch-btn-outline',
              onclick: () => {
                viewingPastPool = true;
                activeExamType = null;
                if (typeof onNavigateExamType === 'function') onNavigateExamType('past');
                renderLobby();
              }
            },
            'Kho đề đã học (Khối dưới)'
          )
        );
      }

      const hubHeader = h(
        'div',
        { class: 'ltch-room-hub-header' },
        h(
          'div',
          { class: 'ltch-room-hub-heading' },
          h('h2', { text: `Chọn Phòng luyện đề trực tuyến – Kỳ thi ${access.examYear || 2027}` })
        ),
        hubRightActions.childNodes.length ? hubRightActions : null
      );

      const hubGrid = h(
        'div',
        { class: 'ltch-room-hub-grid' },
        ...roomSpecs.map((spec) =>
          h(
            'article',
            {
              class: `session-grid-card ltch-room-hub-card ${spec.colorClass}`,
              onclick: () => openRoom(spec.key)
            },
            h(
              'div',
              { class: `session-card-cover has-custom-cover is-clickable ltch-room-hub-cover ${spec.colorClass}` },
              h('img', {
                src: spec.coverSrc,
                alt: spec.title,
                class: 'session-cover-custom-img',
                loading: 'eager',
                draggable: false
              }),
              h(
                'div',
                { class: `session-cover-corner-tag ltch-room-hub-corner ${spec.colorClass}` },
                h('span', { text: spec.badge })
              )
            ),
            h(
              'div',
              { class: 'session-grid-body ltch-room-hub-body' },
              h('h3', { class: 'session-grid-title ltch-room-hub-title', text: spec.title }),
              h(
                'button',
                {
                  type: 'button',
                  class: `session-grid-cta-btn ltch-room-hub-cta ${spec.colorClass}`,
                  onclick: (e) => {
                    e.stopPropagation();
                    openRoom(spec.key);
                  }
                },
                spec.ctaText
              )
            )
          )
        )
      );

      root.append(hubHeader, hubGrid);
      container.append(root);
      return;
    }

    // 2. Header Phòng luyện đang mở (Thiết kế Breadcrumb + Unboxed Header chuẩn UI/UX Pro Max)
    const activeThptqgMeta = resolveThptqgMeta(effectiveGrade || gradeFilter);
    const roomMetaMap = {
      thptqg: {
        breadcrumbLabel: activeThptqgMeta.title,
        title: activeThptqgMeta.title,
        coverSrc: '/practice-covers/thptqg.webp'
      },
      hsa: {
        breadcrumbLabel: 'Phòng luyện HSA (ĐHQG Hà Nội)',
        title: 'Phòng luyện HSA – Đánh giá năng lực ĐHQGHN',
        coverSrc: '/practice-covers/hsa.webp'
      },
      tsa: {
        breadcrumbLabel: 'Phòng luyện TSA (ĐHBK Hà Nội)',
        title: 'Phòng luyện TSA – Đánh giá tư duy Bách khoa',
        coverSrc: '/practice-covers/tsa.webp'
      }
    };
    const activeRoomMeta = roomMetaMap[currentThemeType] || roomMetaMap.thptqg;

    const roomBreadcrumbIcon = h('span', { class: 'ltch-breadcrumb-icon', 'aria-hidden': 'true' });
    roomBreadcrumbIcon.innerHTML =
      '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="6" height="6" rx="1.4"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.4"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.4"/><rect x="11.5" y="11.5" width="6" height="6" rx="1.4"/></svg>';

    const roomBreadcrumbCurrent = h('span', {
      class: 'ltch-breadcrumb-current',
      text: viewingPastPool ? 'Kho đề đã học (Khối dưới)' : activeRoomMeta.breadcrumbLabel
    });

    const roomBreadcrumbNav = h(
      'nav',
      { class: 'ltch-breadcrumb-nav', 'aria-label': 'Điều hướng phòng luyện đề' },
      h(
        'button',
        {
          type: 'button',
          class: 'ltch-breadcrumb-root',
          onclick: () => {
            viewingPastPool = false;
            activeExamType = null;
            if (typeof onNavigateExamType === 'function') onNavigateExamType(null);
            renderLobby();
          }
        },
        roomBreadcrumbIcon,
        h('span', { text: 'Tất cả phòng luyện' })
      ),
      h('span', { class: 'ltch-breadcrumb-sep', 'aria-hidden': 'true', text: '/' }),
      roomBreadcrumbCurrent
    );

    const staffActionsNode = buildStaffActionsNode({ allowUpload: !viewingPastPool && Boolean(activeExamType) });
    const roomBannerBar = h(
      'header',
      { class: `session-unboxed-header ltch-active-room-header is-${currentThemeType}` },
      roomBreadcrumbNav,
      h(
        'div',
        { class: 'session-unboxed-main-row' },
        h(
          'div',
          { class: 'session-unboxed-title-group' },
          h('h2', {
            class: 'session-unboxed-title',
            text: viewingPastPool ? 'Kho đề đã học (Khối dưới)' : activeRoomMeta.title
          })
        ),
        staffActionsNode
          ? h('div', { class: 'session-compact-controls' }, staffActionsNode)
          : null
      )
    );
    root.append(roomBannerBar);
    if (!viewingPastPool) {
      const deviceNotice = createPracticeDeviceNotice(currentThemeType);
      if (deviceNotice) root.append(deviceNotice);
    }

    // 3. Thanh Tìm kiếm + Sắp xếp (Chuẩn 100% như phần Buổi học)
    const searchIconSpan = h('span', { class: 'session-catalog-search-icon', 'aria-hidden': 'true' });
    searchIconSpan.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

    const thptqgGradeTabs =
      !viewingPastPool && !effectiveGrade && activeExamType === 'thptqg' && availableThptqgGrades.length > 1
        ? h(
            'div',
            { class: 'ltch-room-segmented-tabs', role: 'tablist', 'aria-label': 'Chọn kho đề THPTQG theo khối' },
            ...availableThptqgGrades.map((g) => {
              const isAct = gradeFilter === g;
              return h(
                'button',
                {
                  type: 'button',
                  role: 'tab',
                  'aria-selected': String(isAct),
                  class: `ltch-room-segmented-tab is-thptqg${isAct ? ' is-active' : ''}`,
                  onclick: () => {
                    if (gradeFilter === g) return;
                    gradeFilter = g;
                    renderLobby();
                  }
                },
                `Khối ${g}`
              );
            })
          )
        : null;

    const usesExamSequence = !viewingPastPool && ['hsa', 'tsa'].includes(activeExamType);
    const searchBarRow = h(
      'div',
      { class: 'session-catalog-topbar' },
      thptqgGradeTabs,
      h(
        'label',
        { class: 'session-catalog-search-box' },
        searchIconSpan,
        h('input', {
          type: 'search',
          class: 'session-catalog-search-input',
          value: searchQuery,
          placeholder:
            activeExamType === 'thptqg'
              ? 'Tìm đề thi thử THPTQG môn Toán...'
              : activeExamType === 'hsa'
                ? 'Tìm đề thi Đánh giá năng lực (HSA)...'
                : 'Tìm đề thi Đánh giá Tư duy (TSA)...',
          oninput: (e) => {
            searchQuery = e.target.value;
            renderExamCardsGrid();
          }
        })
      ),
      h(
        'label',
        { class: 'session-catalog-sort-box' },
        h('span', { class: 'session-catalog-sort-prefix', text: 'Sắp xếp:' }),
        h(
          'select',
          {
            class: 'session-catalog-sort-select',
            'aria-label': 'Sắp xếp danh sách đề thi',
            onchange: (e) => {
              sortMode = e.target.value;
              renderExamCardsGrid();
            }
          },
          h('option', { value: 'priority', selected: sortMode === 'priority', text: usesExamSequence ? 'Theo thứ tự đề' : 'Ưu tiên' }),
          h('option', { value: 'newest', selected: sortMode === 'newest', text: 'Mới nhất' }),
          h('option', { value: 'popular', selected: sortMode === 'popular', text: 'Nhiều lượt làm' })
        )
      )
    );
    root.append(searchBarRow);

    const gridSection = h('section', { class: 'ltch-9study-catalog-section' });
    root.append(gridSection);
    container.append(root);

    function renderExamCardsGrid() {
      gridSection.replaceChildren();

      const filtered = allExams.filter((ex) => {
        if (!isPortalExamVisible(ex)) return false;
        if (viewingPastPool) {
          if (!ex.isPastPool) return false;
          if (effectiveGrade && (Number(ex.targetGrade) || 12) >= effectiveGrade) return false;
        } else {
          if (ex.isPastPool) return false;
          if (ex.examType !== activeExamType) return false;
          const targetPoolGrade =
            effectiveGrade || (activeExamType === 'thptqg' ? gradeFilter : activeExamType === 'hsa' ? 12 : null);
          if (targetPoolGrade && !matchesGradeScope(ex, targetPoolGrade)) return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          if (
            !String(ex.title || '').toLowerCase().includes(q) &&
            !String(ex.examCode || '').toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      });

      if (sortMode === 'popular') {
        filtered.sort((a, b) => (b.attemptCount || 0) - (a.attemptCount || 0));
      } else if (sortMode === 'newest') {
        filtered.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      } else if (usesExamSequence) {
        filtered.sort(comparePracticeExamSequence);
      }

      if (!filtered.length) {
        gridSection.append(
          h(
            'div',
            { class: 'ltch-lobby-empty-box' },
            h('strong', { text: 'Chưa có đề thi nào trong phòng luyện này.' }),
            h('p', {
              class: 'meta',
              text: effectiveIsStaff
                ? 'Nhấn nút "+ Đăng tải đề Word (.docx)" ở góc trên bên phải để thêm bộ đề mới.'
                : 'Giáo viên sẽ cập nhật bộ đề mới cho kỳ thi này trong thời gian tới.'
            })
          )
        );
        return;
      }

      const cardsGrid = h('div', { class: 'session-visual-grid ltch-9study-cards-grid' });
      for (const ex of filtered) {
        const att = attemptsByExam[ex.id] || { inProgressAttempt: null, history: [] };
        const inProg = att.inProgressAttempt;
        const history = att.history || [];
        const latestAttempt = history[history.length - 1] || null;
        const canManageExam = Boolean(effectiveIsStaff && access.canManageAny && ex.canManage);

        const cardMenuItems = [];
        if (history.length > 0) {
          cardMenuItems.push({
            label: 'Lịch sử làm bài',
            hint: `${history.length} lần`,
            icon: 'history',
            onSelect: () => openExamHistoryModal(ex, history)
          });
        }
        if (canManageExam) {
          cardMenuItems.push(
            {
              label: 'Sửa đề',
              icon: 'edit',
              dividerBefore: history.length > 0,
              onSelect: () => openExistingExamInEditor(ex.id)
            },
            {
              label: 'Làm thử',
              icon: 'play',
              onSelect: () => openExamEntryFlow(ex, { isPreview: true })
            },
            {
              label: ex.status === 'published' ? 'Ẩn nháp' : 'Phát hành',
              icon: ex.status === 'published' ? 'eyeOff' : 'eye',
              onSelect: async () => {
                const nextSt = ex.status === 'published' ? 'draft' : 'published';
                try {
                  await api('/api/admin/practice/exams', {
                    method: 'POST',
                    body: {
                      action: 'change_status',
                      examId: ex.id,
                      status: nextSt,
                      allowPartialStructure: true
                    }
                  });
                  status(
                    nextSt === 'published' ? 'Đã phát hành đề thi!' : 'Đã chuyển đề về Bản nháp.',
                    false,
                    'success'
                  );
                  reloadPortal();
                } catch (err) {
                  status(err?.message || 'Không đổi được trạng thái đề.', true);
                }
              }
            },
            {
              label: 'Xóa đề',
              icon: 'trash',
              danger: true,
              dividerBefore: true,
              onSelect: () =>
                openDeleteExamConfirmModal(ex, async () => {
                  await api('/api/admin/practice/exams', {
                    method: 'POST',
                    body: {
                      action: 'delete_exam',
                      examId: ex.id
                    }
                  });
                  status('Đã xóa đề thi khỏi phòng luyện.', false, 'success');
                  reloadPortal();
                })
            }
          );
        }

        const cardCoverSrc =
          ex.examType === 'hsa'
            ? '/practice-covers/hsa.webp'
            : ex.examType === 'tsa'
              ? '/practice-covers/tsa.webp'
              : '/practice-covers/thptqg.webp';

        const cornerLabel =
          ex.status === 'draft'
            ? `BẢN NHÁP · MÃ ${ex.examCode || '01'}`
            : `${(ex.examType || 'thptqg').toUpperCase()} · ĐỀ ${ex.examCode || '01'}`;

        const doExamButtonText = inProg
          ? 'Tiếp tục làm'
          : history.length > 0
            ? 'Làm lại đề'
            : 'Làm đề';

        const card = h(
          'article',
          {
            class: `session-grid-card ltch-room-hub-card is-${ex.examType}${ex.status === 'draft' ? ' is-draft-card' : ''}`
          },
          h(
            'div',
            {
              class: `session-card-cover has-custom-cover is-clickable ltch-room-hub-cover is-${ex.examType}`,
              onclick: () => openExamActionChoiceModal(ex)
            },
            h('img', {
              src: cardCoverSrc,
              alt: ex.title,
              class: 'session-cover-custom-img',
              loading: 'lazy',
              draggable: false
            }),
            h(
              'div',
              { class: `session-cover-corner-tag ltch-room-hub-corner is-${ex.examType}` },
              h('span', { text: cornerLabel })
            )
          ),
          h(
            'div',
            { class: 'session-grid-body ltch-room-hub-body' },
            h('h3', {
              class: 'session-grid-title ltch-room-hub-title',
              text: ex.title,
              title: ex.title,
              onclick: () => openExamActionChoiceModal(ex)
            }),
            h(
              'div',
              { class: 'session-grid-meta-row ltch-room-exam-meta-row' },
              h(
                'span',
                { class: `session-grid-stat has-items ltch-room-hub-stat is-${ex.examType}` },
                createDocMetaIcon(),
                h('span', { text: `${ex.questionCount || 0} câu · ${ex.durationMinutes || 90} phút` })
              ),
              latestAttempt
                ? h('span', {
                    class: 'session-grid-date ltch-room-exam-score',
                    text: `Điểm: ${latestAttempt.score}/${latestAttempt.max}`
                  })
                : null
            ),
            h(
              'div',
              { class: 'ltch-card-actions-row is-dual-actions' },
              h(
                'button',
                {
                  type: 'button',
                  class: `session-grid-cta-btn ltch-room-hub-cta is-${ex.examType}${inProg ? ' is-resume' : ''}`,
                  onclick: () => openExamEntryFlow(ex, { isPreview: false })
                },
                doExamButtonText
              ),
              typeof onOpenExamSolution === 'function'
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: `ltch-card-solution-btn is-${ex.examType}`,
                      onclick: () => onOpenExamSolution(ex)
                    },
                    'Xem chữa đề'
                  )
                : null,
              cardMenuItems.length > 0
                ? createActionMenu({
                    iconOnly: true,
                    ariaLabel: canManageExam
                      ? `Quản lý đề ${ex.title || ex.examCode || ''}`
                      : `Tùy chọn đề ${ex.title || ex.examCode || ''}`,
                    triggerClass: 'ltch-staff-menu-btn',
                    items: cardMenuItems
                  })
                : null
            )
          )
        );
        cardsGrid.append(card);
      }

      gridSection.append(cardsGrid);
    }

    renderExamCardsGrid();
  }

  renderLobby();

  if (autoOpenExamId) {
    const targetExam = allExams.find((x) => x.id === autoOpenExamId);
    if (targetExam && isPortalExamVisible(targetExam) && (!effectiveGrade || matchesGradeScope(targetExam, effectiveGrade))) {
      openExamEntryFlow(targetExam, { isPreview: Boolean(autoOpenIsPreview) });
    }
  }
}
