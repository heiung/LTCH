// Bộ công cụ & giao diện trình xem Video bài giảng Google Drive và Tài liệu / PDF
// Tuân thủ nghiêm ngặt CSP (không dùng inline style) và hệ thống thiết kế Lớp Toán cô Hạnh.

import { apiBase } from './config.js';

const DRIVE_VIDEO_MARKER_IN_TEXT = /(?:^|[\s·|—–\-:;]+)drive-video:([A-Za-z0-9_-]{1,128})/i;

const MEDIA_ICONS = {
  play: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.55.83l11-6.86a1 1 0 0 0 0-1.66l-11-6.86A1 1 0 0 0 8 5.14Z"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3"/><polygon points="10 9 15 12 10 15 10 9" fill="currentColor"/></svg>',
  drive: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h6"/><path d="M9 11h6"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  sheet: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
  external: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  expand: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
  collapse: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  sidebar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
  fitPage: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><polyline points="9 7 12 4 15 7"/><polyline points="15 17 12 20 9 17"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  material: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  document: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  rotateCw: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/></svg>',
  wide: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 8 21 12 17 16"/><polyline points="7 8 3 12 7 16"/><line x1="3" y1="12" x2="21" y2="12"/></svg>',
  split: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/></svg>',
  volumeHigh: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  volumeLow: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
  volumeMute: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>',
  rewind10: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><text x="12" y="15.3" text-anchor="middle" font-size="7.2" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">10</text></svg>',
  forward10: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/><text x="12" y="15.3" text-anchor="middle" font-size="7.2" font-weight="700" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">10</text></svg>',
  settings: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.02 1.4 1.1H21a2 2 0 0 1 0 4h-.09c-.63.08-1.14.5-1.51 1.1Z"/></svg>',
  pip: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg>',
  fullscreenEnter: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><polyline points="3 9 3 3 9 3"/><polyline points="21 15 21 21 15 21"/></svg>',
  fullscreenExit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><polyline points="14 20 14 14 20 14"/><polyline points="4 10 10 10 10 4"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
};

function mediaEl(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child.nodeType ? child : String(child));
    }
  }
  return node;
}

export function mediaIcon(name) {
  const svg = MEDIA_ICONS[name];
  if (!svg) return null;
  const span = document.createElement('span');
  span.className = 'icon media-svg-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = svg;
  return span;
}

function mediaIconSlot(name) {
  return mediaEl('span', { class: 'media-btn-icon-slot', 'aria-hidden': 'true' }, mediaIcon(name));
}

export function parseLessonTopicAndVideo(item = {}) {
  if (!item || typeof item !== 'object') return { cleanTopic: '', driveVideoFileId: null };

  let driveVideoFileId = null;
  for (const candidate of [item.drive_video_id, item.driveVideoFileId, item.driveVideoId]) {
    if (typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(candidate.trim())) {
      driveVideoFileId = candidate.trim();
      break;
    }
  }

  const rawTopic = typeof item.topic === 'string' ? item.topic.trim() : '';
  let cleanTopic = rawTopic
    .replace(/(?:^|\s)\|\|s:\d{1,3}\|d:[0-9-]{0,10}\|t:[0-9:-]{0,11}(?:\|c:[01])?(?=\s|$)/gi, ' ')
    .trim();

  if (rawTopic) {
    const driveMatch = DRIVE_VIDEO_MARKER_IN_TEXT.exec(rawTopic);
    if (driveMatch) {
      if (!driveVideoFileId) driveVideoFileId = driveMatch[1];
      cleanTopic = cleanTopic
        .replace(/drive-video:[A-Za-z0-9_-]{1,128}/gi, '')
        .replace(/\(\s*\)/g, '')
        .replace(/\[\s*\]/g, '')
        .replace(/^[\s·|—–\-:;]+|[\s·|—–\-:;]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
  }

  return { cleanTopic, driveVideoFileId };
}

export function classifyLessonFile(name = '', contentType = '') {
  const lowerName = String(name || '').toLowerCase().trim();
  const lowerType = String(contentType || '').toLowerCase().trim();

  if (lowerType.includes('pdf') || /\.pdf$/i.test(lowerName)) {
    return { kind: 'pdf', badge: 'PDF', label: 'Tài liệu PDF', iconName: 'pdf' };
  }
  if (
    lowerType.includes('word') ||
    lowerType.includes('officedocument.wordprocessingml') ||
    /\.(docx?|rtf|odt)$/i.test(lowerName)
  ) {
    return { kind: 'word', badge: 'WORD', label: 'Tài liệu Word', iconName: 'drive' };
  }
  if (
    lowerType.includes('excel') ||
    lowerType.includes('spreadsheet') ||
    /\.(xlsx?|csv|ods)$/i.test(lowerName)
  ) {
    return { kind: 'sheet', badge: 'EXCEL', label: 'Bảng tính', iconName: 'sheet' };
  }
  if (
    lowerType.includes('presentation') ||
    lowerType.includes('powerpoint') ||
    /\.(pptx?|odp)$/i.test(lowerName)
  ) {
    return { kind: 'slide', badge: 'SLIDE', label: 'Bài trình chiếu', iconName: 'drive' };
  }
  if (lowerType.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(lowerName)) {
    return { kind: 'image', badge: 'HÌNH ẢNH', label: 'Hình ảnh bài học', iconName: 'image' };
  }
  if (lowerType.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(lowerName)) {
    return { kind: 'video', badge: 'VIDEO', label: 'Video bài giảng', iconName: 'video' };
  }
  return { kind: 'other', badge: 'TÀI LIỆU', label: 'Tệp đính kèm', iconName: 'drive' };
}

export function formatFileSize(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (num < 1024) return `${Math.round(num)} B`;
  const kb = num / 1024;
  if (kb < 1024) {
    return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1).replace('.', ',')} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1).replace('.', ',')} MB`;
}

export function syncTheaterBodyLock() {
  if (typeof document === 'undefined' || !document.body) return;
  const hasTheater = Boolean(document.querySelector('.media-viewer-panel.is-inline.is-theater'));
  document.body.classList.toggle('ltch-theater-lock', hasTheater);
}

function createTheaterToggleButton(targetPanel, buttonClass = 'media-toolbar-btn', { iconOnly = false } = {}) {
  const labelSpan = iconOnly ? null : mediaEl('span', { text: 'Phóng to toàn trang' });
  const iconHolder = mediaIconSlot('expand');
  let escHandler = null;
  const setExpandedState = expanded => {
    const labelText = expanded ? 'Thu gọn khung' : 'Phóng to toàn trang';
    targetPanel.classList.toggle('is-theater', expanded);
    syncTheaterBodyLock();
    toggleBtn.setAttribute('aria-pressed', String(expanded));
    toggleBtn.setAttribute('aria-label', labelText);
    toggleBtn.title = labelText;
    if (labelSpan) labelSpan.textContent = labelText;
    iconHolder.replaceChildren(mediaIcon(expanded ? 'collapse' : 'expand'));
    if (expanded && !escHandler && typeof document !== 'undefined') {
      escHandler = ev => {
        if (!targetPanel.isConnected) {
          document.removeEventListener('keydown', escHandler, true);
          escHandler = null;
          syncTheaterBodyLock();
          return;
        }
        if (ev.key === 'Escape' && targetPanel.classList.contains('is-theater') && targetPanel.classList.contains('is-inline')) {
          ev.preventDefault();
          ev.stopPropagation();
          setExpandedState(false);
        }
      };
      document.addEventListener('keydown', escHandler, true);
    } else if (!expanded && escHandler && typeof document !== 'undefined') {
      document.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }
  };
  const toggleBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: iconOnly ? `${buttonClass} is-icon-only` : buttonClass,
      'aria-pressed': 'false',
      'aria-label': 'Phóng to toàn trang',
      title: 'Phóng to toàn trang',
      onclick: () => {
        const nextState = !targetPanel.classList.contains('is-theater');
        setExpandedState(nextState);
      }
    },
    iconHolder,
    labelSpan
  );
  return toggleBtn;
}

function createDrivePopoutShield() {
  return mediaEl(
    'div',
    {
      class: 'drive-popout-shield',
      title: 'Lớp Toán cô Hạnh · Học liệu lưu trữ nội bộ',
      oncontextmenu: e => e.preventDefault(),
      onclick: e => {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    mediaEl('img', {
      class: 'drive-popout-shield-logo',
      src: '/logo.png?v=20261119_brand_v2',
      alt: 'Logo Lớp Toán cô Hạnh',
      width: '36',
      height: '36',
      draggable: 'false'
    })
  );
}

function formatVideoTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function drawTimelineCanvas(canvas, duration, currentTime, buffered) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width || 1000;
  const h = canvas.height || 10;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.fillRect(0, 0, w, h);
  if (Number.isFinite(duration) && duration > 0) {
    if (buffered && typeof buffered.length === 'number') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.46)';
      for (let i = 0; i < buffered.length; i++) {
        try {
          const bStart = Math.max(0, Math.min(1, buffered.start(i) / duration));
          const bEnd = Math.max(0, Math.min(1, buffered.end(i) / duration));
          if (bEnd > bStart) {
            ctx.fillRect(bStart * w, 0, (bEnd - bStart) * w, h);
          }
        } catch {}
      }
    }
    const playedRatio = Math.max(0, Math.min(1, currentTime / duration));
    ctx.fillStyle = '#8ab4f8';
    ctx.fillRect(0, 0, playedRatio * w, h);
  }
}

function drawVolumeCanvas(canvas, volume, muted) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width || 120;
  const h = canvas.height || 8;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
  ctx.fillRect(0, 0, w, h);
  const ratio = muted ? 0 : Math.max(0, Math.min(1, Number(volume) || 0));
  if (ratio > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w * ratio, h);
  }
}

const VIDEO_PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const VIDEO_QUALITY_TIERS = [
  { id: 'auto', label: 'Tự động (Tối ưu)', shortLabel: 'Tự động', minHeight: 0, filterClass: '' },
  { id: '1080', label: '1080p Full HD (Gốc)', shortLabel: '1080p HD', minHeight: 900, filterClass: '' },
  { id: '720', label: '720p HD', shortLabel: '720p HD', minHeight: 540, filterClass: 'is-quality-720' },
  { id: '480', label: '480p SD', shortLabel: '480p SD', minHeight: 0, filterClass: 'is-quality-480' }
];

export function createDriveVideoLectureElement({
  title = 'Bài giảng',
  topic = '',
  badgeText = 'HD',
  playlist = [],
  activeIndex = 0,
  onSelectPlaylist = null,
  extraActionNode = null,
  loadStreamUrl = null,
  loadPreviewUrl = null,
  inline = false,
  onOpenModal = null
}) {
  const panel = mediaEl('div', {
    class: `media-viewer-panel drive-video-lecture-panel gdv-player-panel is-paused is-controls-visible${inline ? ' is-inline' : ''}`,
    tabindex: '0',
    oncontextmenu: e => e.preventDefault()
  });

  const loadingBanner = mediaEl(
    'div',
    { class: 'media-stage-status', role: 'status', 'aria-live': 'polite' },
    mediaEl('span', { class: 'media-spinner', 'aria-hidden': 'true' }),
    mediaEl('span', { text: 'Đang kết nối luồng phát bài giảng…' })
  );

  const video = mediaEl('video', {
    class: 'gdv-video-el',
    playsinline: true,
    preload: 'metadata',
    controlsList: 'nodownload',
    disableRemotePlayback: true,
    'aria-label': `Video bài giảng ${title}`,
    oncontextmenu: e => e.preventDefault()
  });

  const feedbackToast = mediaEl('div', {
    class: 'gdv-feedback-toast',
    role: 'status',
    'aria-live': 'polite',
    hidden: true
  });

  const centerPlayIcon = mediaEl('span', { class: 'gdv-center-play-icon' }, mediaIcon('play'));
  const centerPlayBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'gdv-center-play-btn',
      'aria-label': 'Phát video bài giảng',
      title: 'Phát video (Phím cách)',
      onclick: e => {
        e.stopPropagation();
        togglePlayPause();
      }
    },
    centerPlayIcon
  );

  const timelineCanvas = mediaEl('canvas', {
    class: 'gdv-timeline-canvas',
    width: '1000',
    height: '10',
    'aria-hidden': 'true'
  });

  const scrubInput = mediaEl('input', {
    type: 'range',
    class: 'gdv-scrub-input',
    min: '0',
    max: '1000',
    step: '1',
    value: '0',
    'aria-label': 'Tua tiến độ video'
  });

  const timelineRow = mediaEl(
    'div',
    { class: 'gdv-timeline-row' },
    timelineCanvas,
    scrubInput
  );

  const playIconSlot = mediaIconSlot('play');
  const playBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'gdv-btn gdv-play-btn',
      'aria-label': 'Phát video',
      title: 'Phát (Phím cách / K)',
      onclick: () => togglePlayPause()
    },
    playIconSlot
  );

  const skipBackBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'gdv-btn gdv-skip-back-btn',
      'aria-label': 'Tua lùi 10 giây',
      title: 'Lùi 10 giây (J)',
      onclick: () => seekRelative(-10)
    },
    mediaIcon('rewind10')
  );

  const skipFwdBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'gdv-btn gdv-skip-fwd-btn',
      'aria-label': 'Tua tới 10 giây',
      title: 'Tới 10 giây (L)',
      onclick: () => seekRelative(10)
    },
    mediaIcon('forward10')
  );

  const volumeIconSlot = mediaIconSlot('volumeHigh');
  const muteBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'gdv-btn gdv-mute-btn',
      'aria-label': 'Tắt tiếng',
      title: 'Tắt tiếng (M)',
      onclick: () => toggleMute()
    },
    volumeIconSlot
  );

  const volumeCanvas = mediaEl('canvas', {
    class: 'gdv-volume-canvas',
    width: '120',
    height: '8',
    'aria-hidden': 'true'
  });

  const volumeInput = mediaEl('input', {
    type: 'range',
    class: 'gdv-volume-input',
    min: '0',
    max: '100',
    step: '1',
    value: '100',
    'aria-label': 'Âm lượng'
  });

  const volumeWrap = mediaEl(
    'div',
    { class: 'gdv-volume-wrap' },
    volumeCanvas,
    volumeInput
  );

  const timeDisplay = mediaEl('span', {
    class: 'gdv-time-display',
    text: '0:00 / 0:00'
  });

  const qualityChip = badgeText ? mediaEl('span', { class: 'ltch-quality-chip', text: badgeText }) : null;
  const speedBadge = mediaEl('span', { class: 'gdv-speed-badge', hidden: true, text: '1x' });
  let detectedQualityLabel = badgeText || '1080p HD';
  let currentQualityId = 'auto';
  let currentSpeed = 1;
  let settingsOpen = false;
  let settingsView = 'root'; // 'root' | 'speed' | 'quality'

  const summarySpeedVal = mediaEl('span', { class: 'gdv-settings-row-value', text: 'Chuẩn (1x)' });
  const summaryQualityVal = mediaEl('span', { class: 'gdv-settings-row-value', text: `Tự động (${detectedQualityLabel})` });

  const rootSpeedRow = mediaEl(
    'button',
    {
      type: 'button',
      class: 'gdv-settings-nav-row',
      role: 'menuitem',
      onclick: e => {
        e.stopPropagation();
        switchSettingsSubView('speed');
      }
    },
    mediaEl('span', { class: 'gdv-settings-row-label', text: 'Tốc độ phát' }),
    mediaEl(
      'span',
      { class: 'gdv-settings-row-right' },
      summarySpeedVal,
      mediaIcon('chevronRight')
    )
  );

  const rootQualityRow = mediaEl(
    'button',
    {
      type: 'button',
      class: 'gdv-settings-nav-row',
      role: 'menuitem',
      onclick: e => {
        e.stopPropagation();
        switchSettingsSubView('quality');
      }
    },
    mediaEl('span', { class: 'gdv-settings-row-label', text: 'Chất lượng hình ảnh' }),
    mediaEl(
      'span',
      { class: 'gdv-settings-row-right' },
      summaryQualityVal,
      mediaIcon('chevronRight')
    )
  );

  const rootPane = mediaEl(
    'div',
    { class: 'gdv-settings-pane is-root-pane' },
    rootSpeedRow,
    rootQualityRow
  );

  const speedButtons = VIDEO_PLAYBACK_SPEEDS.map(rate => {
    const checkSlot = mediaEl('span', { class: 'gdv-speed-check' }, rate === 1 ? mediaIcon('check') : null);
    const labelText = rate === 1 ? 'Chuẩn (1x)' : `${rate}x`;
    return {
      rate,
      checkSlot,
      node: mediaEl(
        'button',
        {
          type: 'button',
          class: `gdv-settings-item${rate === 1 ? ' is-active' : ''}`,
          role: 'menuitemradio',
          'aria-checked': String(rate === 1),
          onclick: e => {
            e.stopPropagation();
            setPlaybackRate(rate);
            setSettingsOpen(false);
          }
        },
        checkSlot,
        mediaEl('span', { class: 'gdv-settings-item-label', text: labelText })
      )
    };
  });

  const speedPane = mediaEl(
    'div',
    { class: 'gdv-settings-pane is-sub-pane', hidden: true },
    mediaEl(
      'button',
      {
        type: 'button',
        class: 'gdv-settings-back-btn',
        onclick: e => {
          e.stopPropagation();
          switchSettingsSubView('root');
        }
      },
      mediaIcon('chevronLeft'),
      mediaEl('span', { text: 'Tốc độ phát' })
    ),
    mediaEl('div', { class: 'gdv-settings-list' }, ...speedButtons.map(item => item.node))
  );

  const qualityButtons = VIDEO_QUALITY_TIERS.map(tier => {
    const isDefault = tier.id === 'auto';
    const checkSlot = mediaEl('span', { class: 'gdv-speed-check' }, isDefault ? mediaIcon('check') : null);
    const labelSpan = mediaEl('span', {
      class: 'gdv-settings-item-label',
      text: tier.id === 'auto' ? `Tự động (${detectedQualityLabel})` : tier.label
    });
    return {
      tier,
      checkSlot,
      labelSpan,
      node: mediaEl(
        'button',
        {
          type: 'button',
          class: `gdv-settings-item${isDefault ? ' is-active' : ''}`,
          role: 'menuitemradio',
          'aria-checked': String(isDefault),
          onclick: e => {
            e.stopPropagation();
            setVideoQuality(tier.id);
            setSettingsOpen(false);
          }
        },
        checkSlot,
        labelSpan
      )
    };
  });

  const qualityPane = mediaEl(
    'div',
    { class: 'gdv-settings-pane is-sub-pane', hidden: true },
    mediaEl(
      'button',
      {
        type: 'button',
        class: 'gdv-settings-back-btn',
        onclick: e => {
          e.stopPropagation();
          switchSettingsSubView('root');
        }
      },
      mediaIcon('chevronLeft'),
      mediaEl('span', { text: 'Chất lượng hình ảnh' })
    ),
    mediaEl('div', { class: 'gdv-settings-list' }, ...qualityButtons.map(item => item.node))
  );

  function switchSettingsSubView(nextView) {
    settingsView = nextView;
    rootPane.hidden = nextView !== 'root';
    speedPane.hidden = nextView !== 'speed';
    qualityPane.hidden = nextView !== 'quality';
  }

  const settingsMenu = mediaEl(
    'div',
    {
      class: 'gdv-settings-menu',
      role: 'menu',
      'aria-label': 'Cài đặt tốc độ phát và chất lượng hình ảnh',
      hidden: true,
      onclick: e => e.stopPropagation()
    },
    rootPane,
    speedPane,
    qualityPane
  );

  const settingsBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'gdv-btn gdv-settings-btn',
      'aria-label': 'Cài đặt tốc độ phát và chất lượng hình ảnh',
      'aria-expanded': 'false',
      'aria-haspopup': 'menu',
      title: 'Cài đặt phát video',
      onclick: e => {
        e.stopPropagation();
        setSettingsOpen(!settingsOpen);
      }
    },
    mediaIcon('settings'),
    speedBadge
  );

  const settingsAnchor = mediaEl(
    'div',
    { class: 'gdv-settings-anchor' },
    settingsMenu,
    settingsBtn
  );

  const pipSupported = typeof document !== 'undefined' && Boolean(document.pictureInPictureEnabled);
  const pipBtn = pipSupported
    ? mediaEl(
        'button',
        {
          type: 'button',
          class: 'gdv-btn gdv-pip-btn',
          'aria-label': 'Hình trong hình',
          title: 'Hình trong hình',
          onclick: async e => {
            e.stopPropagation();
            try {
              if (document.pictureInPictureElement === video) {
                await document.exitPictureInPicture();
              } else if (typeof video.requestPictureInPicture === 'function') {
                await video.requestPictureInPicture();
              }
            } catch {}
          }
        },
        mediaIcon('pip')
      )
    : null;

  const fullscreenIconSlot = mediaIconSlot('fullscreenEnter');
  const fullscreenBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'gdv-btn gdv-fullscreen-btn',
      'aria-label': 'Toàn màn hình',
      title: 'Toàn màn hình (F)',
      onclick: e => {
        e.stopPropagation();
        toggleNativeFullscreen();
      }
    },
    fullscreenIconSlot
  );

  const controlsBar = mediaEl(
    'div',
    { class: 'gdv-controls-bar' },
    mediaEl(
      'div',
      { class: 'gdv-controls-left' },
      playBtn,
      skipBackBtn,
      skipFwdBtn,
      muteBtn,
      volumeWrap,
      timeDisplay
    ),
    mediaEl(
      'div',
      { class: 'gdv-controls-right' },
      settingsAnchor,
      pipBtn,
      fullscreenBtn
    )
  );

  const controlsOverlay = mediaEl(
    'div',
    {
      class: 'gdv-controls-overlay',
      onclick: e => e.stopPropagation()
    },
    timelineRow,
    controlsBar
  );

  const stage = mediaEl(
    'div',
    {
      class: 'media-stage drive-video-stage gdv-stage',
      oncontextmenu: e => e.preventDefault()
    },
    loadingBanner,
    video,
    feedbackToast,
    centerPlayBtn,
    controlsOverlay
  );

  let idleTimer = null;
  let feedbackTimer = null;
  let isScrubbing = false;
  let loadGeneration = 0;
  let pendingResumeTime = 0;
  let disposed = false;

  function showFeedback(text) {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackToast.textContent = text;
    feedbackToast.hidden = false;
    feedbackTimer = setTimeout(() => {
      feedbackToast.hidden = true;
    }, 850);
  }

  function revealControls({ transient = true } = {}) {
    if (idleTimer) clearTimeout(idleTimer);
    panel.classList.add('is-controls-visible');
    if (transient && !video.paused && !settingsOpen && !isScrubbing) {
      idleTimer = setTimeout(() => {
        if (!video.paused && !settingsOpen && !isScrubbing) {
          panel.classList.remove('is-controls-visible');
        }
      }, 2800);
    }
  }

  function setSettingsOpen(nextOpen) {
    settingsOpen = Boolean(nextOpen);
    if (settingsOpen) {
      switchSettingsSubView('root');
    }
    settingsMenu.hidden = !settingsOpen;
    panel.classList.toggle('is-settings-open', settingsOpen);
    settingsBtn.setAttribute('aria-expanded', String(settingsOpen));
    revealControls({ transient: !settingsOpen });
  }

  function setPlaybackRate(rate) {
    currentSpeed = rate;
    video.playbackRate = rate;
    const rateLabel = rate === 1 ? 'Chuẩn (1x)' : `${rate}x`;
    summarySpeedVal.textContent = rateLabel;
    speedBadge.textContent = `${rate}x`;
    speedBadge.hidden = rate === 1;
    for (const item of speedButtons) {
      const active = item.rate === rate;
      item.node.classList.toggle('is-active', active);
      item.node.setAttribute('aria-checked', String(active));
      if (active) item.checkSlot.replaceChildren(mediaIcon('check'));
      else item.checkSlot.replaceChildren();
    }
    showFeedback(`Tốc độ ${rateLabel}`);
  }

  function syncQualityLabels() {
    const autoItem = qualityButtons.find(q => q.tier.id === 'auto');
    if (autoItem) {
      autoItem.labelSpan.textContent = `Tự động (${detectedQualityLabel})`;
    }
    const chosenTier = VIDEO_QUALITY_TIERS.find(t => t.id === currentQualityId) || VIDEO_QUALITY_TIERS[0];
    summaryQualityVal.textContent =
      chosenTier.id === 'auto' ? `Tự động (${detectedQualityLabel})` : chosenTier.shortLabel;
    if (qualityChip) {
      qualityChip.textContent = chosenTier.id === 'auto' ? detectedQualityLabel : chosenTier.shortLabel;
    }
  }

  function setVideoQuality(qualityId) {
    currentQualityId = qualityId;
    const chosenTier = VIDEO_QUALITY_TIERS.find(t => t.id === qualityId) || VIDEO_QUALITY_TIERS[0];
    video.classList.remove('is-quality-720', 'is-quality-480');
    if (chosenTier.filterClass) {
      video.classList.add(chosenTier.filterClass);
    }
    for (const item of qualityButtons) {
      const active = item.tier.id === chosenTier.id;
      item.node.classList.toggle('is-active', active);
      item.node.setAttribute('aria-checked', String(active));
      if (active) item.checkSlot.replaceChildren(mediaIcon('check'));
      else item.checkSlot.replaceChildren();
    }
    syncQualityLabels();
    showFeedback(
      `Chất lượng ${chosenTier.id === 'auto' ? `Tự động (${detectedQualityLabel})` : chosenTier.shortLabel}`
    );
  }

  function syncPlayState() {
    const paused = video.paused || video.ended;
    panel.classList.toggle('is-paused', paused);
    const label = paused ? 'Phát video' : 'Tạm dừng video';
    playBtn.setAttribute('aria-label', label);
    playBtn.title = paused ? 'Phát (Phím cách / K)' : 'Tạm dừng (Phím cách / K)';
    playIconSlot.replaceChildren(mediaIcon(paused ? 'play' : 'pause'));
    centerPlayBtn.hidden = !paused;
    revealControls({ transient: !paused });
  }

  function syncVolumeUi() {
    const effVol = video.muted ? 0 : video.volume;
    volumeInput.value = String(Math.round(effVol * 100));
    drawVolumeCanvas(volumeCanvas, video.volume, video.muted);
    const iconName = effVol === 0 ? 'volumeMute' : effVol < 0.5 ? 'volumeLow' : 'volumeHigh';
    volumeIconSlot.replaceChildren(mediaIcon(iconName));
    muteBtn.setAttribute('aria-label', video.muted ? 'Bật tiếng' : 'Tắt tiếng');
    muteBtn.title = video.muted ? 'Bật tiếng (M)' : 'Tắt tiếng (M)';
  }

  function syncTimelineUi() {
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const cur = Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : 0;
    timeDisplay.textContent = `${formatVideoTime(cur)} / ${formatVideoTime(dur)}`;
    if (!isScrubbing) {
      scrubInput.value = dur > 0 ? String(Math.round((cur / dur) * 1000)) : '0';
    }
    drawTimelineCanvas(timelineCanvas, dur, cur, video.buffered);
  }

  function syncFullscreenUi() {
    const isNativeFs = typeof document !== 'undefined' && document.fullscreenElement === panel;
    const label = isNativeFs ? 'Thoát toàn màn hình' : 'Toàn màn hình';
    fullscreenBtn.setAttribute('aria-label', label);
    fullscreenBtn.setAttribute('aria-pressed', String(isNativeFs));
    fullscreenBtn.title = isNativeFs ? 'Thoát toàn màn hình (F)' : 'Toàn màn hình (F)';
    fullscreenIconSlot.replaceChildren(mediaIcon(isNativeFs ? 'fullscreenExit' : 'fullscreenEnter'));
  }

  async function togglePlayPause() {
    revealControls();
    if (video.paused || video.ended) {
      try {
        await video.play();
      } catch {}
    } else {
      video.pause();
    }
  }

  function seekRelative(deltaSec) {
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const next = Math.max(0, dur > 0 ? Math.min(dur, (video.currentTime || 0) + deltaSec) : Math.max(0, (video.currentTime || 0) + deltaSec));
    video.currentTime = next;
    syncTimelineUi();
    revealControls();
    showFeedback(deltaSec > 0 ? `+${deltaSec} giây` : `${deltaSec} giây`);
  }

  function toggleMute() {
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) video.volume = 0.7;
      showFeedback('Đã bật tiếng');
    } else {
      video.muted = true;
      showFeedback('Đã tắt tiếng');
    }
    syncVolumeUi();
    revealControls();
  }

  async function toggleNativeFullscreen() {
    try {
      if (typeof document !== 'undefined' && document.fullscreenElement === panel) {
        await document.exitFullscreen();
        return;
      }
      if (typeof panel.requestFullscreen === 'function') {
        await panel.requestFullscreen();
        return;
      }
      if (typeof video.webkitEnterFullscreen === 'function') {
        video.webkitEnterFullscreen();
        return;
      }
    } catch {}
    theaterBtn.click();
  }

  scrubInput.addEventListener('pointerdown', () => {
    isScrubbing = true;
    revealControls({ transient: false });
  });
  scrubInput.addEventListener('input', () => {
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (dur > 0) {
      const target = (Number(scrubInput.value) / 1000) * dur;
      video.currentTime = target;
      timeDisplay.textContent = `${formatVideoTime(target)} / ${formatVideoTime(dur)}`;
      drawTimelineCanvas(timelineCanvas, dur, target, video.buffered);
    }
  });
  const endScrub = () => {
    if (!isScrubbing) return;
    isScrubbing = false;
    revealControls();
  };
  scrubInput.addEventListener('change', endScrub);
  scrubInput.addEventListener('pointerup', endScrub);

  volumeInput.addEventListener('input', () => {
    const nextVol = Math.max(0, Math.min(1, Number(volumeInput.value) / 100));
    video.volume = nextVol;
    video.muted = nextVol === 0;
    syncVolumeUi();
    revealControls();
  });

  video.addEventListener('click', e => {
    e.stopPropagation();
    if (settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    togglePlayPause();
  });
  video.addEventListener('dblclick', e => {
    e.stopPropagation();
    toggleNativeFullscreen();
  });
  video.addEventListener('play', syncPlayState);
  video.addEventListener('pause', syncPlayState);
  video.addEventListener('ended', syncPlayState);
  video.addEventListener('timeupdate', syncTimelineUi);
  video.addEventListener('progress', syncTimelineUi);
  video.addEventListener('durationchange', syncTimelineUi);
  video.addEventListener('waiting', () => {
    if (!video.getAttribute('src')) return;
    panel.classList.add('is-buffering');
  });
  video.addEventListener('canplay', () => {
    loadingBanner.hidden = true;
    panel.classList.remove('is-buffering');
    panel.classList.add('is-frame-loaded');
  });
  video.addEventListener('playing', () => {
    loadingBanner.hidden = true;
    panel.classList.remove('is-buffering');
    panel.classList.add('is-frame-loaded');
    syncPlayState();
  });
  video.addEventListener('loadedmetadata', () => {
    loadingBanner.hidden = true;
    panel.classList.remove('is-buffering');
    panel.classList.add('is-frame-loaded');
    video.playbackRate = currentSpeed;
    if (pendingResumeTime > 0 && Number.isFinite(video.duration) && pendingResumeTime < video.duration) {
      try {
        video.currentTime = pendingResumeTime;
      } catch {}
    }
    pendingResumeTime = 0;
    if (video.videoHeight > 0) {
      const qLabel =
        video.videoHeight >= 2160
          ? '4K UHD'
          : video.videoHeight >= 1080
            ? '1080p HD'
            : video.videoHeight >= 720
              ? '720p HD'
              : video.videoHeight >= 480
                ? '480p SD'
                : `${video.videoHeight}p`;
      detectedQualityLabel = qLabel;
      syncQualityLabels();
    }
    syncTimelineUi();
  });
  video.addEventListener('error', () => {
    if (disposed || !panel.isConnected || !video.getAttribute('src')) return;
    loadingBanner.hidden = false;
    panel.classList.remove('is-buffering', 'is-frame-loaded');
    loadingBanner.replaceChildren(
      mediaEl(
        'div',
        { class: 'ltch-stage-error-box' },
        mediaEl('span', {
          class: 'form-error',
          role: 'alert',
          text: 'Luồng video bị gián đoạn hoặc liên kết vừa hết hạn. Bấm Thử tải lại để tiếp tục xem.'
        }),
        mediaEl('button', {
          type: 'button',
          class: 'media-toolbar-btn',
          text: 'Thử tải lại',
          onclick: () => mountStream({ resume: true })
        })
      )
    );
  });

  stage.addEventListener('pointermove', () => revealControls());
  stage.addEventListener('pointerleave', () => {
    if (!video.paused && !settingsOpen && !isScrubbing) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!video.paused && !settingsOpen && !isScrubbing) {
          panel.classList.remove('is-controls-visible');
        }
      }, 900);
    }
  });

  panel.addEventListener('keydown', ev => {
    if (ev.defaultPrevented || ev.target?.matches?.('input,textarea,select')) return;
    if (ev.key === 'Escape' && settingsOpen) {
      ev.preventDefault();
      ev.stopPropagation();
      setSettingsOpen(false);
      return;
    }
    if (ev.key === ' ' || ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      togglePlayPause();
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      seekRelative(-5);
    } else if (ev.key.toLowerCase() === 'j') {
      ev.preventDefault();
      seekRelative(-10);
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      seekRelative(5);
    } else if (ev.key.toLowerCase() === 'l') {
      ev.preventDefault();
      seekRelative(10);
    } else if (ev.key.toLowerCase() === 'm') {
      ev.preventDefault();
      toggleMute();
    } else if (ev.key.toLowerCase() === 'f') {
      ev.preventDefault();
      toggleNativeFullscreen();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      video.muted = false;
      video.volume = Math.min(1, video.volume + 0.1);
      syncVolumeUi();
      showFeedback(`Âm lượng ${Math.round(video.volume * 100)}%`);
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      video.volume = Math.max(0, video.volume - 0.1);
      video.muted = video.volume === 0;
      syncVolumeUi();
      showFeedback(`Âm lượng ${Math.round(video.volume * 100)}%`);
    } else if (/^[0-9]$/.test(ev.key) && Number.isFinite(video.duration) && video.duration > 0) {
      ev.preventDefault();
      const target = (Number(ev.key) / 10) * video.duration;
      video.currentTime = target;
      syncTimelineUi();
      revealControls();
    }
  });

  const onDocPointerDown = ev => {
    if (settingsOpen && !settingsAnchor.contains(ev.target)) {
      setSettingsOpen(false);
    }
  };
  const onDocFullscreenChange = () => syncFullscreenUi();
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('fullscreenchange', onDocFullscreenChange);
  }

  function disposeVideo() {
    disposed = true;
    loadGeneration++;
    if (idleTimer) clearTimeout(idleTimer);
    if (feedbackTimer) clearTimeout(feedbackTimer);
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {}
    panel.classList.remove('is-theater');
    syncTheaterBodyLock();
    if (typeof document !== 'undefined') {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('fullscreenchange', onDocFullscreenChange);
    }
  }
  panel._ltchDisposeVideo = disposeVideo;

  async function mountStream({ resume = false } = {}) {
    const gen = ++loadGeneration;
    if (resume && Number.isFinite(video.currentTime) && video.currentTime > 1) {
      pendingResumeTime = video.currentTime;
    } else if (!resume) {
      pendingResumeTime = 0;
    }
    loadingBanner.hidden = false;
    loadingBanner.replaceChildren(
      mediaEl('span', { class: 'media-spinner', 'aria-hidden': 'true' }),
      mediaEl('span', { text: 'Đang kết nối luồng phát bài giảng…' })
    );
    panel.classList.remove('is-frame-loaded', 'is-buffering');
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {}

    try {
      const resolveUrl = typeof loadStreamUrl === 'function' ? loadStreamUrl : loadPreviewUrl;
      const rawResult = typeof resolveUrl === 'function' ? await resolveUrl() : null;
      const urlHref = typeof rawResult === 'string' ? rawResult : rawResult?.url;
      if (!urlHref) throw Error('Không nhận được liên kết phát video.');
      const parsed = new URL(
        urlHref,
        typeof window !== 'undefined' ? window.location.origin : apiBase
      );
      const isLoopback =
        parsed.protocol === 'http:' &&
        (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
      if (
        (!isLoopback && parsed.protocol !== 'https:') ||
        parsed.pathname !== '/api/video-media' ||
        !parsed.searchParams.get('ticket')
      ) {
        throw Error('Địa chỉ luồng phát video không hợp lệ.');
      }
      if (disposed || gen !== loadGeneration || !panel.isConnected) return;
      video.src = parsed.href;
      syncPlayState();
      syncVolumeUi();
      syncTimelineUi();
    } catch (err) {
      if (disposed || gen !== loadGeneration || !panel.isConnected) return;
      loadingBanner.hidden = false;
      loadingBanner.replaceChildren(
        mediaEl(
          'div',
          { class: 'ltch-stage-error-box' },
          mediaEl('span', {
            class: 'form-error',
            role: 'alert',
            text: err?.message || 'Không thể tải luồng phát video. Vui lòng bấm Làm mới.'
          }),
          mediaEl('button', {
            type: 'button',
            class: 'media-toolbar-btn',
            text: 'Thử tải lại',
            onclick: () => mountStream({ resume })
          })
        )
      );
    }
  }

  const reloadBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'media-toolbar-btn is-icon-only',
      'aria-label': 'Làm mới khung phát bài giảng',
      title: 'Làm mới khung phát bài giảng',
      onclick: () => mountStream({ resume: true })
    },
    mediaIcon('refresh')
  );

  const theaterBtn = createTheaterToggleButton(panel, 'media-toolbar-btn', { iconOnly: true });
  const toolbarActions = mediaEl(
    'div',
    { class: 'media-toolbar-actions' },
    theaterBtn,
    reloadBtn,
    extraActionNode || null
  );

  const cleanTitle = String(title || 'Video bài giảng').trim() || 'Video bài giảng';
  const toolbar = mediaEl(
    'div',
    { class: 'media-viewer-toolbar ltch-video-studio-bar gdv-topbar' },
    mediaEl(
      'div',
      { class: 'media-toolbar-meta ltch-video-studio-identity' },
      mediaEl(
        'span',
        { class: 'ltch-video-type-badge', 'aria-hidden': 'true' },
        mediaIcon('play'),
        mediaEl('span', { text: 'VIDEO' })
      ),
      mediaEl('strong', { class: 'ltch-media-title', text: cleanTitle, title: cleanTitle }),
      topic ? mediaEl('span', { class: 'media-topic-pill', text: topic }) : null,
      qualityChip
    ),
    toolbarActions
  );

  const playlistStrip =
    Array.isArray(playlist) && playlist.length > 1
      ? mediaEl(
          'div',
          {
            class: 'ltch-video-playlist-strip',
            role: 'tablist',
            'aria-label': 'Chọn video trong danh sách'
          },
          ...playlist.map((entry, idx) =>
            mediaEl(
              'button',
              {
                type: 'button',
                role: 'tab',
                'aria-selected': String(idx === activeIndex),
                class: `ltch-video-playlist-item${idx === activeIndex ? ' is-active' : ''}`,
                onclick: () => {
                  if (idx !== activeIndex && typeof onSelectPlaylist === 'function') {
                    onSelectPlaylist(idx, entry);
                  }
                }
              },
              mediaEl('span', { class: 'ltch-playlist-idx', text: String(idx + 1).padStart(2, '0') }),
              mediaEl('span', { class: 'ltch-playlist-name', text: entry?.name || `Video ${idx + 1}` })
            )
          )
        )
      : null;

  panel.append(...[toolbar, playlistStrip, stage].filter(Boolean));
  drawVolumeCanvas(volumeCanvas, 1, false);
  drawTimelineCanvas(timelineCanvas, 0, 0, null);
  queueMicrotask(() => {
    mountStream();
  });
  return panel;
}

export function populateDrivePreviewPanel({
  panel,
  urlHref,
  path,
  name,
  type,
  onDownload,
  onPreviewPdf,
  onReload,
  extraActionNode = null
}) {
  const fileInfo = classifyLessonFile(name, type);
  panel.classList.add('media-viewer-panel');
  panel.addEventListener('contextmenu', e => e.preventDefault());

  const loadingBanner = mediaEl(
    'div',
    { class: 'media-stage-status', role: 'status', 'aria-live': 'polite' },
    mediaEl('span', { class: 'media-spinner', 'aria-hidden': 'true' }),
    mediaEl('span', { text: 'Đang tải trang tài liệu từ Google Drive…' })
  );

  const frame = mediaEl('iframe', {
    class: 'drive-preview-frame',
    src: urlHref,
    title: `Tài liệu ${name}`,
    loading: 'lazy',
    referrerPolicy: 'no-referrer',
    sandbox: 'allow-scripts allow-same-origin'
  });

  frame.addEventListener('load', () => {
    loadingBanner.hidden = true;
    panel.classList.add('is-frame-loaded');
  });

  const reloadBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'media-toolbar-btn is-icon-only',
      'aria-label': 'Tải lại khung xem tài liệu',
      title: 'Tải lại khung xem tài liệu',
      onclick: () => {
        loadingBanner.hidden = false;
        panel.classList.remove('is-frame-loaded');
        if (typeof onReload === 'function') onReload();
        else frame.src = urlHref;
      }
    },
    mediaIcon('refresh')
  );

  const downloadTopBtn =
    fileInfo.kind !== 'video' && typeof onDownload === 'function'
      ? mediaEl(
          'button',
          {
            type: 'button',
            class: 'primary media-download-btn',
            'aria-label': 'Tải tài liệu về máy',
            onclick: () => onDownload(path, name, '')
          },
          mediaIcon('download'),
          mediaEl('span', { class: 'pdf-download-label', text: 'Tải về' })
        )
      : null;

  const toolbarActions = mediaEl(
    'div',
    { class: 'media-toolbar-actions' },
    extraActionNode || null,
    createTheaterToggleButton(panel, 'media-toolbar-btn', { iconOnly: true }),
    reloadBtn
  );

  if (fileInfo.kind === 'pdf' && typeof onPreviewPdf === 'function') {
    toolbarActions.append(
      mediaEl(
        'button',
        {
          type: 'button',
          class: 'media-toolbar-btn',
          onclick: () => onPreviewPdf(path, name)
        },
        mediaIcon('pdf'),
        mediaEl('span', { text: 'Bản PDF nét cao' })
      )
    );
  }

  if (downloadTopBtn) toolbarActions.append(downloadTopBtn);

  const cleanDocName = String(name || 'Tài liệu').trim() || 'Tài liệu';
  const toolbar = mediaEl(
    'div',
    { class: 'media-viewer-toolbar ltch-doc-studio-bar' },
    mediaEl(
      'div',
      { class: 'media-toolbar-meta' },
      mediaEl('span', {
        class: `file-type-badge file-type-${fileInfo.kind}`,
        text: fileInfo.badge
      }),
      mediaEl('strong', { class: 'ltch-media-title', text: cleanDocName, title: cleanDocName }),
      mediaEl(
        'span',
        { class: 'media-source-pill media-source-drive' },
        mediaIcon('drive'),
        mediaEl('span', { text: 'Google Drive' })
      )
    ),
    toolbarActions
  );

  const stage = mediaEl(
    'div',
    { class: 'media-stage drive-stage', oncontextmenu: e => e.preventDefault() },
    loadingBanner,
    frame,
    createDrivePopoutShield()
  );

  panel.replaceChildren(toolbar, stage);
}

export function createPdfViewerControls({
  panel,
  name,
  numPages,
  onSelectPage,
  onSelectZoom,
  onDownload
}) {
  panel.classList.add('media-viewer-panel', 'pdf-viewer-panel');

  const previous = mediaEl(
    'button',
    {
      type: 'button',
      class: 'media-toolbar-btn',
      text: 'Trang trước',
      onclick: () => onSelectPage(-1)
    }
  );
  const label = mediaEl('span', {
    class: 'pdf-page-indicator',
    role: 'status',
    'aria-live': 'polite',
    text: `Trang 1 / ${numPages}`
  });
  const next = mediaEl(
    'button',
    {
      type: 'button',
      class: 'media-toolbar-btn',
      text: 'Trang sau',
      onclick: () => onSelectPage(1)
    }
  );

  const zoomOutBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'media-toolbar-btn pdf-zoom-btn',
      'aria-label': 'Thu nhỏ trang PDF',
      title: 'Thu nhỏ',
      onclick: () => onSelectZoom(-1)
    },
    mediaIcon('zoomOut')
  );
  const zoomResetBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'media-toolbar-btn pdf-zoom-label',
      'aria-label': 'Đặt lại tỷ lệ thu phóng 100%',
      title: 'Đặt lại 100%',
      text: '100%',
      onclick: () => onSelectZoom(0)
    }
  );
  const zoomInBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'media-toolbar-btn pdf-zoom-btn',
      'aria-label': 'Phóng to trang PDF',
      title: 'Phóng to',
      onclick: () => onSelectZoom(1)
    },
    mediaIcon('zoomIn')
  );

  const downloadBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'primary media-download-btn',
      onclick: () => onDownload()
    },
    mediaIcon('download'),
    mediaEl('span', { text: 'Tải về máy' })
  );

  const toolbar = mediaEl(
    'div',
    { class: 'media-viewer-toolbar pdf-toolbar' },
    mediaEl(
      'div',
      { class: 'actions pdf-nav-group' },
      previous,
      label,
      next
    ),
    mediaEl(
      'div',
      { class: 'pdf-zoom-group', role: 'group', 'aria-label': 'Thu phóng tài liệu' },
      zoomOutBtn,
      zoomResetBtn,
      zoomInBtn
    ),
    mediaEl(
      'div',
      { class: 'media-toolbar-actions' },
      createTheaterToggleButton(panel),
      downloadBtn
    )
  );

  const canvas = mediaEl('canvas', {
    class: 'lesson-pdf-preview',
    role: 'img',
    'aria-label': `Nội dung ${name}`
  });

  const stage = mediaEl(
    'div',
    { class: 'media-stage pdf-stage' },
    canvas
  );

  return {
    toolbar,
    stage,
    canvas,
    previous,
    next,
    label,
    zoomOutBtn,
    zoomResetBtn,
    zoomInBtn
  };
}

export const PDF_ZOOM_STEPS = [50, 67, 75, 85, 100, 115, 125, 150, 175, 200];

export async function mountDriveStylePdfViewer({
  panel,
  name,
  doc,
  isClosed = () => false,
  onDownload,
  compact = false,
  extraActionNode = null
}) {
  const numPages = doc.numPages || 1;
  panel.classList.add('media-viewer-panel', 'pdf-viewer-panel');
  if (compact) panel.classList.add('is-compact');

  const isCompactViewport = Boolean(compact || (typeof window !== 'undefined' && window.innerWidth <= 768));
  const defaultThumbsCollapsed = Boolean(compact || (typeof window !== 'undefined' && window.innerWidth <= 960));

  let currentPage = 1;
  let userRotation = 0;
  let zoomMode = isCompactViewport ? 'fit-width' : '100'; // '50'..'200' | 'fit-page' | 'fit-width'
  let isProgrammaticScroll = false;
  let scrollUnlockTimer = null;

  const prevPageBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'pdf-pill-icon-btn pdf-nav-prev',
      'aria-label': 'Trang trước',
      title: 'Trang trước (←)',
      onclick: () => scrollToPage(currentPage - 1)
    },
    mediaIcon('chevronLeft')
  );

  const pageInput = mediaEl('input', {
    type: 'number',
    class: 'pdf-page-input',
    min: '1',
    max: String(numPages),
    value: '1',
    'aria-label': 'Số trang hiện tại'
  });

  const pageTotalSpan = mediaEl('span', {
    class: 'pdf-page-total',
    text: `/ ${numPages}`
  });

  const label = mediaEl('span', {
    class: 'sr-only',
    role: 'status',
    'aria-live': 'polite',
    text: `Trang 1 / ${numPages}`
  });

  const nextPageBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'pdf-pill-icon-btn pdf-nav-next',
      'aria-label': 'Trang sau',
      title: 'Trang sau (→)',
      onclick: () => scrollToPage(currentPage + 1)
    },
    mediaIcon('chevronRight')
  );

  const pageJumper = mediaEl(
    'div',
    { class: 'pdf-page-jumper' },
    prevPageBtn,
    pageInput,
    pageTotalSpan,
    nextPageBtn,
    label
  );

  function commitPageInput() {
    const parsed = Number.parseInt(pageInput.value, 10);
    if (Number.isFinite(parsed)) {
      const target = Math.min(numPages, Math.max(1, parsed));
      pageInput.value = String(target);
      scrollToPage(target);
    } else {
      pageInput.value = String(currentPage);
    }
  }

  pageInput.addEventListener('change', commitPageInput);
  pageInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitPageInput();
      pageInput.blur();
    }
  });

  const zoomOutBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'pdf-pill-icon-btn pdf-zoom-btn is-step',
      'aria-label': 'Thu nhỏ (Ctrl + -)',
      title: 'Thu nhỏ (Ctrl + -)',
      onclick: () => stepZoom(-1)
    },
    mediaIcon('minus')
  );

  const zoomOptions = [
    ['fit-width', 'Vừa rộng'],
    ['fit-page', 'Vừa trang'],
    ['50', '50%'],
    ['67', '67%'],
    ['75', '75%'],
    ['85', '85%'],
    ['100', '100%'],
    ['115', '115%'],
    ['125', '125%'],
    ['150', '150%'],
    ['175', '175%'],
    ['200', '200%']
  ];

  const zoomSelect = mediaEl(
    'select',
    {
      class: 'pdf-zoom-select',
      'aria-label': 'Chọn mức thu phóng tài liệu'
    },
    ...zoomOptions.map(([val, text]) => {
      const opt = mediaEl('option', { value: val, text });
      if (val === zoomMode) opt.selected = true;
      return opt;
    })
  );

  zoomSelect.addEventListener('change', () => {
    applyZoom(zoomSelect.value);
  });

  const zoomInBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'pdf-pill-icon-btn pdf-zoom-btn is-step',
      'aria-label': 'Phóng to (Ctrl + +)',
      title: 'Phóng to (Ctrl + +)',
      onclick: () => stepZoom(1)
    },
    mediaIcon('plus')
  );

  const fitWidthBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: `pdf-pill-icon-btn pdf-pill-fit-btn${zoomMode === 'fit-width' ? ' is-active' : ''}`,
      'aria-pressed': String(zoomMode === 'fit-width'),
      'aria-label': 'Vừa chiều rộng khung đọc',
      title: 'Vừa chiều rộng khung đọc / 100%',
      onclick: () => applyZoom(zoomMode === 'fit-width' ? '100' : 'fit-width')
    },
    mediaIcon('fitPage')
  );

  const rotateBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'pdf-pill-icon-btn pdf-rotate-btn',
      'aria-label': 'Xoay trang 90 độ',
      title: 'Xoay trang 90°',
      onclick: () => rotatePages()
    },
    mediaIcon('rotateCw')
  );

  const downloadRightBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'pdf-pill-action-btn pdf-pill-download-btn',
      'aria-label': 'Tải tài liệu về máy',
      title: 'Tải tài liệu về máy',
      onclick: () => onDownload()
    },
    mediaIcon('download'),
    mediaEl('span', { class: 'pdf-download-label', text: 'Tải về' })
  );

  const thumbList = mediaEl('div', {
    class: 'pdf-thumb-list',
    role: 'navigation',
    'aria-label': 'Danh sách trang thu nhỏ'
  });

  const thumbSidebar = mediaEl(
    'aside',
    { class: 'pdf-thumb-sidebar' },
    thumbList
  );

  const stream = mediaEl('div', { class: 'pdf-document-stream' });
  const stage = mediaEl(
    'div',
    {
      class: 'media-stage pdf-stage',
      'data-zoom': zoomMode,
      tabindex: '0',
      'aria-label': `Trình đọc tài liệu ${name}`
    },
    stream
  );

  const readerBody = mediaEl(
    'div',
    { class: `pdf-drive-body${defaultThumbsCollapsed ? ' is-thumbs-collapsed' : ''}` },
    thumbSidebar,
    stage
  );

  const thumbToggleBtn = mediaEl(
    'button',
    {
      type: 'button',
      class: 'pdf-pill-icon-btn pdf-thumb-inline-toggle',
      'aria-pressed': String(!defaultThumbsCollapsed),
      'aria-label': 'Ẩn hoặc hiện trang thu nhỏ',
      title: 'Ẩn/hiện trang thu nhỏ',
      onclick: () => {
        const collapsed = readerBody.classList.toggle('is-thumbs-collapsed');
        thumbToggleBtn.setAttribute('aria-pressed', String(!collapsed));
      }
    },
    mediaIcon('sidebar')
  );

  const cleanDocTitle = String(name || 'Tài liệu PDF').trim() || 'Tài liệu PDF';
  const toolbar = mediaEl(
    'div',
    { class: 'pdf-drive-pillbar', role: 'toolbar', 'aria-label': 'Thanh công cụ trình đọc PDF' },
    mediaEl(
      'div',
      { class: 'pdf-pill-left' },
      thumbToggleBtn,
      mediaEl('span', { class: 'ltch-pdf-type-badge', 'aria-hidden': 'true', text: 'PDF' }),
      mediaEl('strong', { class: 'ltch-pdf-doc-title', text: cleanDocTitle, title: cleanDocTitle })
    ),
    mediaEl(
      'div',
      { class: 'pdf-pill-center' },
      pageJumper,
      mediaEl('span', { class: 'pdf-pill-divider', 'aria-hidden': 'true' }),
      mediaEl(
        'div',
        { class: 'pdf-pill-zoom-cluster', role: 'group', 'aria-label': 'Thu phóng và xoay trang' },
        zoomOutBtn,
        zoomSelect,
        zoomInBtn,
        mediaEl('span', { class: 'pdf-pill-subdivider', 'aria-hidden': 'true' }),
        fitWidthBtn,
        rotateBtn
      )
    ),
    mediaEl(
      'div',
      { class: 'pdf-pill-right' },
      extraActionNode || null,
      createTheaterToggleButton(panel, 'pdf-pill-icon-btn pdf-pill-theater-btn', { iconOnly: true }),
      downloadRightBtn
    )
  );

  const pageEntries = [];
  for (let i = 1; i <= numPages; i++) {
    const canvas = mediaEl('canvas', {
      class: 'lesson-pdf-preview',
      role: 'img',
      'aria-label': `Trang ${i} / ${numPages} — ${name}`
    });
    const sheet = mediaEl(
      'div',
      { class: 'pdf-page-sheet', 'data-page': String(i) },
      canvas
    );
    stream.append(sheet);

    const thumbCanvas = mediaEl('canvas', {
      class: 'pdf-thumb-canvas',
      width: '120',
      height: '170',
      'aria-hidden': 'true'
    });
    const thumbBtn = mediaEl(
      'button',
      {
        type: 'button',
        class: `pdf-thumb-item${i === 1 ? ' is-active' : ''}`,
        'data-page': String(i),
        'aria-label': `Chuyển tới trang ${i}`,
        onclick: () => scrollToPage(i)
      },
      mediaEl('span', { class: 'pdf-thumb-num', text: String(i) }),
      mediaEl('div', { class: 'pdf-thumb-card' }, thumbCanvas)
    );
    thumbList.append(thumbBtn);

    pageEntries.push({
      pageNumber: i,
      sheet,
      canvas,
      thumbBtn,
      thumbCanvas,
      thumbDrawn: false,
      rendered: false,
      rendering: false
    });
  }

  function syncUiState() {
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= numPages;
    if (document.activeElement !== pageInput) {
      pageInput.value = String(currentPage);
    }
    label.textContent = `Trang ${currentPage} / ${numPages}`;

    for (const entry of pageEntries) {
      const active = entry.pageNumber === currentPage;
      entry.thumbBtn.classList.toggle('is-active', active);
      if (active) {
        const top = entry.thumbBtn.offsetTop;
        const bottom = top + entry.thumbBtn.offsetHeight;
        if (top < thumbList.scrollTop || bottom > thumbList.scrollTop + thumbList.clientHeight) {
          thumbList.scrollTo({
            top: Math.max(0, top - thumbList.clientHeight / 2 + entry.thumbBtn.offsetHeight / 2),
            behavior: 'smooth'
          });
        }
      }
    }

    if (zoomSelect.value !== zoomMode) {
      zoomSelect.value = zoomMode;
      zoomSelect._ltchSelectController?.sync?.();
    }

    const isFitWidth = zoomMode === 'fit-width';
    fitWidthBtn.classList.toggle('is-active', isFitWidth);
    fitWidthBtn.setAttribute('aria-pressed', String(isFitWidth));

    const numericZoom = Number.parseInt(zoomMode, 10);
    const atMin = Number.isFinite(numericZoom) && numericZoom <= PDF_ZOOM_STEPS[0];
    const atMax = Number.isFinite(numericZoom) && numericZoom >= PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1];
    zoomOutBtn.disabled = atMin;
    zoomInBtn.disabled = atMax;
  }

  function applyZoom(nextMode) {
    if (isClosed()) return;
    const prevScrollHeight = Math.max(1, stage.scrollHeight);
    const centerRatio = (stage.scrollTop + stage.clientHeight * 0.35) / prevScrollHeight;
    zoomMode = String(nextMode);
    stage.setAttribute('data-zoom', zoomMode);
    syncUiState();
    requestAnimationFrame(() => {
      if (isClosed()) return;
      const nextScrollHeight = Math.max(1, stage.scrollHeight);
      stage.scrollTop = Math.max(0, centerRatio * nextScrollHeight - stage.clientHeight * 0.35);
    });
  }

  function stepZoom(direction) {
    let currentNumeric = Number.parseInt(zoomMode, 10);
    if (!Number.isFinite(currentNumeric)) {
      currentNumeric = zoomMode === 'fit-page' ? 75 : zoomMode === 'fit-width' ? 125 : 100;
    }
    let idx = PDF_ZOOM_STEPS.findIndex(step => step >= currentNumeric);
    if (idx === -1) idx = PDF_ZOOM_STEPS.length - 1;
    const nextIdx = Math.min(PDF_ZOOM_STEPS.length - 1, Math.max(0, idx + direction));
    applyZoom(String(PDF_ZOOM_STEPS[nextIdx]));
  }

  function scrollToPage(targetPage) {
    const clamped = Math.min(numPages, Math.max(1, targetPage));
    const entry = pageEntries[clamped - 1];
    if (!entry) return;
    currentPage = clamped;
    syncUiState();
    ensurePageRendered(clamped);
    if (clamped + 1 <= numPages) ensurePageRendered(clamped + 1);

    isProgrammaticScroll = true;
    if (scrollUnlockTimer) clearTimeout(scrollUnlockTimer);
    const topOffset = Math.max(0, entry.sheet.offsetTop - 8);
    stage.scrollTo({ top: topOffset, behavior: 'smooth' });
    scrollUnlockTimer = setTimeout(() => {
      isProgrammaticScroll = false;
    }, 380);
  }

  async function rotatePages() {
    if (isClosed()) return;
    userRotation = (userRotation + 90) % 360;
    rotateBtn.setAttribute('aria-label', `Xoay trang 90 độ (hiện ${userRotation}°)`);
    for (const entry of pageEntries) {
      entry.rendered = false;
      entry.rendering = false;
      entry.thumbDrawn = false;
      entry.sheet.classList.remove('is-rendered');
    }
    try {
      const firstPage = await doc.getPage(1);
      if (!isClosed()) {
        const effRot = ((firstPage.rotate || 0) + userRotation) % 360;
        const base = firstPage.getViewport({ scale: 1, rotation: effRot });
        const renderScale = Math.min(2.2, 1550 / base.width, 2200 / base.height);
        const defaultW = Math.ceil(base.width * renderScale);
        const defaultH = Math.ceil(base.height * renderScale);
        const isLandscape = base.width > base.height;
        const thumbH = Math.max(80, Math.round(140 * (base.height / base.width)));
        for (const entry of pageEntries) {
          entry.canvas.width = defaultW;
          entry.canvas.height = defaultH;
          entry.thumbCanvas.width = 140;
          entry.thumbCanvas.height = thumbH;
          if (isLandscape) entry.canvas.setAttribute('data-orientation', 'landscape');
          else entry.canvas.removeAttribute('data-orientation');
        }
      }
    } catch {}
    const targets = [currentPage, currentPage - 1, currentPage + 1].filter(p => p >= 1 && p <= numPages);
    await Promise.all(targets.map(p => ensurePageRendered(p)));
    for (let i = 1; i <= Math.min(numPages, 6); i++) {
      if (!isClosed()) ensureThumbRendered(i);
    }
  }

  stage.addEventListener(
    'scroll',
    () => {
      if (isProgrammaticScroll || isClosed()) return;
      const probeY = stage.scrollTop + stage.clientHeight * 0.35;
      let bestPage = currentPage;
      for (const entry of pageEntries) {
        const top = entry.sheet.offsetTop;
        const bottom = top + entry.sheet.offsetHeight;
        if (probeY >= top && probeY <= bottom) {
          bestPage = entry.pageNumber;
          break;
        }
        if (top <= probeY) {
          bestPage = entry.pageNumber;
        }
      }
      if (bestPage !== currentPage) {
        currentPage = bestPage;
        syncUiState();
      }
    },
    { passive: true }
  );

  stage.addEventListener('keydown', event => {
    if (isClosed() || event.defaultPrevented) return;
    if (event.target?.matches?.('input,textarea,select,button')) return;
    if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      stepZoom(1);
    } else if ((event.ctrlKey || event.metaKey) && event.key === '-') {
      event.preventDefault();
      stepZoom(-1);
    } else if ((event.ctrlKey || event.metaKey) && event.key === '0') {
      event.preventDefault();
      applyZoom('100');
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      scrollToPage(currentPage - 1);
    } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      event.preventDefault();
      scrollToPage(currentPage + 1);
    }
  });

  stage.addEventListener(
    'wheel',
    event => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        stepZoom(event.deltaY < 0 ? 1 : -1);
      }
    },
    { passive: false }
  );

  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startScrollLeft = 0;
  let startScrollTop = 0;

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button, input, select')) return;
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    startScrollLeft = stage.scrollLeft;
    startScrollTop = stage.scrollTop;
    stage.classList.add('is-panning');
  });

  const onWindowPointerMove = event => {
    if (!isDragging) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    stage.scrollLeft = startScrollLeft - dx;
    stage.scrollTop = startScrollTop - dy;
  };

  const onWindowPointerUp = () => {
    if (!isDragging) return;
    isDragging = false;
    stage.classList.remove('is-panning');
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
  }

  function copyPageToThumbnail(entry) {
    if (entry.thumbDrawn || !entry.canvas.width || !entry.canvas.height) return;
    try {
      const ratio = entry.canvas.height / entry.canvas.width;
      entry.thumbCanvas.width = 140;
      entry.thumbCanvas.height = Math.max(80, Math.round(140 * ratio));
      const ctx = entry.thumbCanvas.getContext('2d');
      ctx.drawImage(entry.canvas, 0, 0, entry.thumbCanvas.width, entry.thumbCanvas.height);
      entry.thumbDrawn = true;
    } catch {
      // Bỏ qua nếu không thể sao chép thumbnail
    }
  }

  async function ensureThumbRendered(pageNumber) {
    const entry = pageEntries[pageNumber - 1];
    if (!entry || entry.thumbDrawn || isClosed()) return;
    if (entry.rendered) {
      copyPageToThumbnail(entry);
      return;
    }
    try {
      const page = await doc.getPage(pageNumber);
      if (isClosed() || entry.thumbDrawn) return;
      const effRot = ((page.rotate || 0) + userRotation) % 360;
      const base = page.getViewport({ scale: 1, rotation: effRot });
      const thumbScale = Math.min(0.32, 140 / base.width);
      const vp = page.getViewport({ scale: thumbScale, rotation: effRot });
      entry.thumbCanvas.width = Math.ceil(vp.width);
      entry.thumbCanvas.height = Math.ceil(vp.height);
      await page.render({
        canvas: entry.thumbCanvas,
        canvasContext: entry.thumbCanvas.getContext('2d'),
        viewport: vp
      }).promise;
      entry.thumbDrawn = true;
    } catch {
      // Giữ khung thu nhỏ an toàn
    }
  }

  async function ensurePageRendered(pageNumber) {
    const entry = pageEntries[pageNumber - 1];
    if (!entry || entry.rendered || entry.rendering || isClosed()) return;
    entry.rendering = true;
    try {
      const page = await doc.getPage(pageNumber);
      if (isClosed()) return;
      const effRot = ((page.rotate || 0) + userRotation) % 360;
      const base = page.getViewport({ scale: 1, rotation: effRot });
      if (base.width > base.height) {
        entry.canvas.setAttribute('data-orientation', 'landscape');
      } else {
        entry.canvas.removeAttribute('data-orientation');
      }
      const renderScale = Math.min(2.2, 1550 / base.width, 2200 / base.height);
      const viewport = page.getViewport({ scale: renderScale, rotation: effRot });
      entry.canvas.width = Math.ceil(viewport.width);
      entry.canvas.height = Math.ceil(viewport.height);
      await page.render({
        canvas: entry.canvas,
        canvasContext: entry.canvas.getContext('2d'),
        viewport
      }).promise;
      entry.rendered = true;
      entry.sheet.classList.add('is-rendered');
      copyPageToThumbnail(entry);
    } catch {
      // Giữ khung trang an toàn nếu một trang lỗi
    } finally {
      entry.rendering = false;
    }
  }

  try {
    const firstPage = await doc.getPage(1);
    if (!isClosed()) {
      const effRot = ((firstPage.rotate || 0) + userRotation) % 360;
      const base = firstPage.getViewport({ scale: 1, rotation: effRot });
      const renderScale = Math.min(2.2, 1550 / base.width, 2200 / base.height);
      const defaultW = Math.ceil(base.width * renderScale);
      const defaultH = Math.ceil(base.height * renderScale);
      const isLandscape = base.width > base.height;
      const thumbH = Math.max(80, Math.round(140 * (base.height / base.width)));
      for (const entry of pageEntries) {
        entry.canvas.width = defaultW;
        entry.canvas.height = defaultH;
        entry.thumbCanvas.width = 140;
        entry.thumbCanvas.height = thumbH;
        if (isLandscape) entry.canvas.setAttribute('data-orientation', 'landscape');
      }
    }
  } catch {
    // Bỏ qua nếu trang 1 sẽ được xử lý trong ensurePageRendered
  }

  panel.setAttribute('aria-busy', 'false');
  panel.replaceChildren(toolbar, readerBody);
  syncUiState();

  let observer = null;
  let thumbObserver = null;
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      entries => {
        for (const item of entries) {
          if (item.isIntersecting) {
            const p = Number.parseInt(item.target.getAttribute('data-page'), 10);
            if (Number.isFinite(p)) ensurePageRendered(p);
          }
        }
      },
      { root: stage, rootMargin: '800px 0px' }
    );
    thumbObserver = new IntersectionObserver(
      entries => {
        for (const item of entries) {
          if (item.isIntersecting) {
            const p = Number.parseInt(item.target.getAttribute('data-page'), 10);
            if (Number.isFinite(p)) ensureThumbRendered(p);
          }
        }
      },
      { root: thumbList, rootMargin: '300px 0px' }
    );
    for (const entry of pageEntries) {
      observer.observe(entry.sheet);
      thumbObserver.observe(entry.thumbBtn);
    }
  }

  await ensurePageRendered(1);
  if (numPages >= 2 && !isClosed()) {
    ensurePageRendered(2);
  }
  for (let i = 1; i <= Math.min(numPages, 6); i++) {
    if (!isClosed()) ensureThumbRendered(i);
  }

  return {
    toolbar,
    stage,
    scrollToPage,
    stepZoom,
    applyZoom,
    rotatePages,
    getCurrentPage: () => currentPage,
    destroy: () => {
      if (observer) observer.disconnect();
      if (thumbObserver) thumbObserver.disconnect();
      if (scrollUnlockTimer) clearTimeout(scrollUnlockTimer);
      panel.classList.remove('is-theater');
      syncTheaterBodyLock();
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onWindowPointerUp);
      }
    }
  };
}

