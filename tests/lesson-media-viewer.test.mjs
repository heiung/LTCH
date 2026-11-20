import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mediaIcon,
  parseLessonTopicAndVideo,
  classifyLessonFile,
  formatFileSize
} from '../client/lesson-media-viewer.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('parseLessonTopicAndVideo separates clean topic and Drive video file ID', () => {
  const driveVideoTopic = parseLessonTopicAndVideo({
    title: 'Bài 4. Phương trình mặt phẳng',
    topic: 'Hình học 12 - Chương 3 · drive-video:file-uuid-987654'
  });
  assert.equal(driveVideoTopic.cleanTopic, 'Hình học 12 - Chương 3');
  assert.equal(driveVideoTopic.driveVideoFileId, 'file-uuid-987654');

  const driveOnlyTopic = parseLessonTopicAndVideo({
    title: 'Bài 5. Tích có hướng',
    topic: 'drive-video:file-uuid-112233'
  });
  assert.equal(driveOnlyTopic.cleanTopic, '');
  assert.equal(driveOnlyTopic.driveVideoFileId, 'file-uuid-112233');
});

test('classifyLessonFile returns appropriate badge and kind for each file type', () => {
  assert.equal(classifyLessonFile('De-cuong-Toan-12.pdf', 'application/pdf').badge, 'PDF');
  assert.equal(classifyLessonFile('Bai-tap-ve-nha.docx', '').kind, 'word');
  assert.equal(classifyLessonFile('Bang-diem.xlsx', '').kind, 'sheet');
  assert.equal(classifyLessonFile('Hinh-minh-hoa.png', 'image/png').kind, 'image');
  assert.equal(classifyLessonFile('Bai-giang.mp4', 'video/mp4').kind, 'video');
  assert.equal(classifyLessonFile('Ghi-chu.txt', 'text/plain').badge, 'TÀI LIỆU');
});

test('formatFileSize formats bytes into Vietnamese human-readable strings', () => {
  assert.equal(formatFileSize(0), '');
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(45 * 1024), '45,0 KB');
  assert.equal(formatFileSize(250 * 1024), '250 KB');
  assert.equal(formatFileSize(2.5 * 1024 * 1024), '2,5 MB');
});

test('mediaIcon supports all Academic Media Studio icon keys and returns SVG elements without inline styles', async () => {
  const prevDoc = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        attrs: {},
        innerHTML: '',
        setAttribute(k, v) {
          this.attrs[k] = v;
        }
      };
    }
  };
  try {
    for (const key of [
      'play', 'pause', 'video', 'drive', 'pdf', 'material', 'document',
      'rotateCw', 'wide', 'split', 'trash', 'sidebar', 'fitPage', 'download', 'refresh',
      'expand', 'collapse', 'chevronLeft', 'chevronRight', 'minus', 'plus',
      'volumeHigh', 'volumeLow', 'volumeMute', 'rewind10', 'forward10',
      'settings', 'pip', 'fullscreenEnter', 'fullscreenExit', 'check'
    ]) {
      const iconEl = mediaIcon(key);
      assert.ok(iconEl, `mediaIcon('${key}') must return an element, not null`);
      assert.match(iconEl.innerHTML, /<svg\b[^>]*>/i, `mediaIcon('${key}') must contain SVG markup`);
      assert.doesNotMatch(iconEl.innerHTML, /\bstyle\s*=/i, `mediaIcon('${key}') SVG must not use inline styles`);
    }
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('lesson-media-viewer.mjs implements cloned Google Drive HTML5 Video & PDF players without popout logo shield or inline styles', async () => {
  const src = await fs.readFile(path.join(ROOT_DIR, 'client/lesson-media-viewer.mjs'), 'utf8');
  assert.ok(src.includes('ltch-video-studio-bar'), 'Video studio toolbar class missing');
  assert.ok(src.includes('ltch-video-playlist-strip'), 'Video playlist strip missing');
  assert.ok(src.includes('createTheaterToggleButton'), 'Video theater mode toggle missing');
  assert.ok(src.includes('gdv-fullscreen-btn'), 'Video fullscreen toggle missing');
  assert.ok(src.includes('gdv-video-el'), 'Cloned native video element class missing');
  assert.ok(src.includes('gdv-controls-overlay'), 'Google Drive video bottom overlay missing');
  assert.ok(src.includes('gdv-timeline-canvas'), 'Video timeline canvas missing');
  assert.ok(src.includes('gdv-scrub-input'), 'Video scrub slider missing');
  assert.ok(src.includes('gdv-settings-menu'), 'Video speed/quality settings menu missing');
  assert.ok(src.includes('ltch-video-type-badge'), 'Red Drive video badge missing');
  assert.ok(src.includes('syncTheaterBodyLock'), 'Theater body lock sync helper missing');
  const videoFnStart = src.indexOf('export function createDriveVideoLectureElement');
  const videoFnEnd = src.indexOf('export function populateDrivePreviewPanel');
  const videoFnBody = src.slice(videoFnStart, videoFnEnd);
  assert.equal(videoFnBody.includes('createDrivePopoutShield'), false, 'Video player must not use logo popout shield');
  assert.equal(videoFnBody.includes('drive-video-frame'), false, 'Video player must not use Google Drive preview iframe');
  assert.ok(src.includes('pdf-rotate-btn'), 'PDF rotate control missing');
  assert.ok(src.includes('ltch-pdf-type-badge'), 'Google Drive PDF type badge missing');
  assert.ok(src.includes('pdf-pill-subdivider'), 'PDF zoom/fit subdivider missing');
  assert.ok(src.includes('Vừa rộng'), 'Compact Vừa rộng zoom option missing');
  assert.ok(src.includes('Xoay trang 90'), 'PDF rotate label missing');
  assert.ok(src.includes('pdf-thumb-inline-toggle'), 'Inline PDF thumbnail toggle missing');
  assert.ok(src.includes('function rotatePages'), 'rotatePages helper missing');
  assert.ok(src.includes('function mediaIconSlot'), 'mediaIconSlot helper missing');
  assert.doesNotMatch(src, /media-btn-icon-slot['"](?![^}]*aria-hidden)/, 'All media-btn-icon-slot wrappers must hide decorative icons from screen readers');
  assert.doesNotMatch(src, /setAttribute\s*\(\s*['"]style['"]/);
  assert.doesNotMatch(src, /\.\s*style\s*\./);
  assert.doesNotMatch(src, /\bstyle\s*=\s*["']/);
});

test('public/app.css scopes inline viewer height rules with :not(.is-theater) and styles cloned Google Drive video controls', async () => {
  const css = await fs.readFile(path.join(ROOT_DIR, 'public/app.css'), 'utf8');
  assert.ok(css.includes('body.ltch-theater-lock'), 'body.ltch-theater-lock missing');
  assert.ok(css.includes('.assignment-split-doc-pane .pdf-viewer-panel.is-inline:not(.is-theater)'), 'Assignment split PDF must exclude :not(.is-theater)');
  assert.ok(css.includes('.session-split-doc-pane .pdf-viewer-panel.is-inline:not(.is-theater)'), 'Session split PDF must exclude :not(.is-theater)');
  assert.ok(css.includes('.submission-gallery-stage .pdf-viewer-panel.is-inline:not(.is-theater)'), 'Gallery stage PDF must exclude :not(.is-theater)');
  assert.ok(css.includes('.pdf-viewer-panel.is-compact:not(.is-theater) .ltch-pdf-doc-title'), 'Compact title hide must exclude :not(.is-theater)');
  assert.ok(css.includes('.gdv-controls-overlay'), 'Video overlay CSS missing');
  assert.match(css, /\.media-btn-icon-slot,\s*\.media-svg-icon\s*\{[^}]*pointer-events:\s*none;/, 'Icon slots must use pointer-events: none so button hit-targets never intercept clicks');
});
