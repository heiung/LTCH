import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

async function readRepoFile(relPath) {
  return fs.readFile(path.join(ROOT_DIR, relPath), 'utf8');
}

test('action-menu.mjs exposes SVG history icon without inline style attributes', async () => {
  const src = await readRepoFile('client/action-menu.mjs');
  assert.match(
    src,
    /history\s*:\s*['"`][^'"`]*<(path|circle|polyline|rect|line|polygon)\b/i,
    'MENU_ICONS should define an SVG history icon'
  );
  assert.doesNotMatch(src, /\bstyle\s*=\s*["'][^"']*["']/i);
});

test('practice-rooms.mjs moves attempt history into exam card action menu and history modal', async () => {
  const src = await readRepoFile('client/practice-rooms.mjs');

  assert.doesNotMatch(src, /ltch-card-history-toggle-row/);
  assert.doesNotMatch(src, /\bhistoryDrawer\b/);
  assert.match(src, /function\s+openExamHistoryModal\s*\(/);
  assert.match(src, /3\.\s*Lịch sử làm bài/);

  const canManageIdx = src.indexOf('const canManageExam =');
  const menuStart = src.indexOf('const cardMenuItems = [];');
  assert.ok(canManageIdx !== -1 && menuStart !== -1, 'canManageExam and cardMenuItems should exist in renderExamCardsGrid');
  assert.ok(canManageIdx < menuStart, 'canManageExam must be declared before cardMenuItems uses it (avoid TDZ)');

  const menuEnd = src.indexOf('const cardCoverSrc =', menuStart);
  assert.ok(menuEnd !== -1, 'Expected cardMenuItems block before cardCoverSrc');

  const menuBlock = src.slice(menuStart, menuEnd);
  const historyIdx = menuBlock.indexOf('if (history.length > 0)');
  const staffIdx = menuBlock.indexOf('if (canManageExam)');
  assert.ok(historyIdx !== -1 && staffIdx !== -1, 'Both history and canManageExam branches should exist');
  assert.ok(
    historyIdx < staffIdx,
    'Student attempt history menu item must be populated independently before canManageExam gate'
  );
  assert.match(menuBlock, /label:\s*['"]Lịch sử làm bài['"]/);
  assert.match(menuBlock, /icon:\s*['"]history['"]/);
  assert.match(menuBlock, /openExamHistoryModal\(ex,\s*history\)/);

  const actionsIdx = src.indexOf('cardMenuItems.length > 0', menuEnd);
  assert.ok(actionsIdx !== -1, 'Action menu should render whenever cardMenuItems.length > 0');

  const historyFnStart = src.indexOf('function openExamHistoryModal(');
  const choiceFnEnd = src.indexOf('function openExamEntryFlow(', historyFnStart);
  assert.ok(historyFnStart !== -1 && choiceFnEnd !== -1);
  const editedModalSlice = src.slice(historyFnStart, choiceFnEnd);
  assert.doesNotMatch(editedModalSlice, /\bstyle\s*=\s*["'][^"']*["']/i);
  assert.doesNotMatch(src, /\bstyle\s*=\s*["'][^"']*["']/i, 'practice-rooms.mjs must not emit inline style attributes under CSP');
});

test('public/app.css unlocks wide/zoom-out fluid grids, fullscreen overlays, and history modal styles', async () => {
  const css = await readRepoFile('public/app.css');

  assert.match(
    css,
    /\.app-frame\s*>\s*\.content,\s*\.content\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s
  );
  assert.match(css, /\.content\s+:is\([^)]+\)\s+p,[\s\S]*?max-width:\s*none;/);
  assert.match(css, /@media\s*\(min-width:\s*1025px\)\s*\{[\s\S]*?\.ltch-9study-cards-grid[\s\S]*?auto-fill/);
  assert.match(css, /@media\s*\(min-width:\s*1025px\)\s*\{[\s\S]*?\.ltch-room-hub-grid\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.doesNotMatch(css, /\.ltch-room-hub-grid\s*\{[^}]*auto-fit/s);
  assert.match(css, /@media\s*\(min-width:\s*1025px\)\s*\{[\s\S]*?\.ltch-thptqg-layout,[\s\S]*?max-width:\s*none;/);
  assert.match(css, /@media\s*\(min-width:\s*1440px\)\s*\{[\s\S]*?\.ops-grid/);
  assert.match(css, /@media\s*\(min-width:\s*1500px\)\s*\{[\s\S]*?\.enrollment-grid/);
  assert.match(css, /@media\s*\(min-width:\s*1600px\)\s*\{[\s\S]*?\.ltch-hsa-standalone-wrap/);
  assert.match(css, /@media\s*\(min-width:\s*1680px\)\s*\{[\s\S]*?\.ltch-tsa-passage-pane/);
  assert.match(css, /\.ltch-exam-history-modal\s*\{/);
  assert.match(css, /\.ltch-history-modal-list\s*\{/);
  assert.match(css, /\.ltch-history-modal-footer\s*\{/);
  assert.match(css, /\.ltch-exam-choice-icon\.is-hist-thptqg\s*\{/);
  assert.match(css, /\.ltch-exam-choice-icon\.is-hist-hsa\s*\{/);
  assert.match(css, /\.ltch-exam-choice-icon\.is-hist-tsa\s*\{/);
  assert.match(css, /\.ltch-card-actions-row\.is-dual-actions\s+\.session-grid-cta-btn,[\s\S]*?font-size:\s*0\.8125rem;[\s\S]*?white-space:\s*nowrap;/);
});

test('materials and assignments tabs use distinct syllabus & task workspaces, smart modal defaults, and zero inline styles', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const rootDir = resolve(import.meta.dirname, '..');
  const clientJs = readFileSync(resolve(rootDir, 'client/app.js'), 'utf8');
  const css = readFileSync(resolve(rootDir, 'public/app.css'), 'utf8');

  assert.match(clientJs, /^function\s+findNearestScheduledSession\(/m);
  const pickerDef = clientJs.match(/^function\s+createSessionPickerField\(/m);
  assert.ok(pickerDef, 'Expected createSessionPickerField');
  const pickerSlice = clientJs.slice(pickerDef.index, pickerDef.index + 650);
  assert.ok(pickerSlice.includes('findNearestScheduledSession'), 'createSessionPickerField must default to nearest scheduled session');
  for (const modalFn of ['lessonFileSetCreatorModal', 'sessionHomeworkUploadModal', 'lessonVideoCreatorModal']) {
    const fnMatch = clientJs.match(new RegExp(`^function\\s+${modalFn}\\(`, 'm'));
    assert.ok(fnMatch, `Expected ${modalFn}`);
    const modalSlice = clientJs.slice(fnMatch.index, fnMatch.index + 650);
    assert.ok(
      modalSlice.includes('findNearestScheduledSession') || modalSlice.includes('createSessionPickerField'),
      `${modalFn} must default to nearest scheduled session`
    );
  }

  const matDef = clientJs.match(/^(?:async\s+)?function\s+renderSplitMaterialsAndLessons\(/m);
  const assignDef = clientJs.match(/^(?:async\s+)?function\s+renderSessionBasedAssignments\(/m);
  const matStart = matDef ? matDef.index : -1;
  const assignStart = assignDef ? assignDef.index : -1;
  assert.ok(matStart > -1 && assignStart > matStart, 'Expected both curriculum tab renderers');
  const nextFnMatch = clientJs.slice(assignStart + 80).match(/\n(?:export\s+)?(?:async\s+)?function\s+/);
  const assignEnd = nextFnMatch ? assignStart + 80 + nextFnMatch.index : clientJs.length;

  const materialsSlice = clientJs.slice(matStart, assignStart);
  const assignSlice = clientJs.slice(assignStart, assignEnd);

  for (const [label, slice] of [['materials', materialsSlice], ['assignments', assignSlice]]) {
    assert.ok(slice.includes('subtab-command-bar'), `${label} missing subtab-command-bar`);
    assert.ok(slice.includes('ltch-breadcrumb-step-nav'), `${label} missing ltch-breadcrumb-step-nav`);
    assert.ok(slice.includes('session-grid-card'), `${label} must retain .session-grid-card`);
    assert.ok(slice.includes('openCreateSessionModal'), `${label} missing openCreateSessionModal`);
    assert.ok(slice.includes('confirmDeleteSession'), `${label} missing confirmDeleteSession`);
    assert.ok(slice.includes('confirmDeleteSessionFile'), `${label} missing confirmDeleteSessionFile`);
    assert.ok(slice.includes('buildDriveTreePreviewCard'), `${label} missing buildDriveTreePreviewCard`);
    assert.ok(!slice.includes('drive-sync-pill'), `${label} must not render removed drive-sync-pill`);
    assert.ok(slice.includes('Tạo buổi học mới'), `${label} missing Tạo buổi học mới`);
    assert.ok(!slice.includes('Đã liên kết Drive'), `${label} must not render removed Đã liên kết Drive badge`);
    assert.ok(!slice.includes('Khung lộ trình lớp'), `${label} must not keep old 50-session Khung lộ trình lớp`);
    assert.ok(!slice.includes('Giao theo lịch buổi'), `${label} must not keep old 50-session Giao theo lịch buổi`);
    assert.ok(!slice.includes('Chỉnh lịch học'), `${label} must not include misplaced Chỉnh lịch học`);
    assert.ok(!slice.includes('file bài tập Drive'), `${label} leaks Drive implementation note`);
    assert.ok(!slice.includes('Lưu qua Supabase'), `${label} leaks Supabase implementation note`);
  }

  for (const helperFn of [
    'openCreateSessionModal',
    'confirmDeleteSession',
    'confirmDeleteSessionFile',
    'buildDriveTreePreviewCard'
  ]) {
    assert.match(clientJs, new RegExp(`^function\\s+${helperFn}\\(`, 'm'), `Missing helper ${helperFn}`);
  }

  assert.match(materialsSlice, /!hasLecture\s*&&\s*hasDocs\s*\?\s*'document'\s*:\s*'lecture'/);
  assert.ok(materialsSlice.includes('materials-studio-board'), 'materials missing studio workspace');
  assert.ok(materialsSlice.includes('materials-syllabus-card'), 'materials missing horizontal syllabus cards');
  assert.ok(materialsSlice.includes('materials-spotlight-banner'), 'materials missing featured spotlight banner');

  assert.ok(assignSlice.includes('homework-studio-board'), 'assignments missing coordinator studio workspace');
  assert.ok(assignSlice.includes('homework-task-card'), 'assignments missing task & deadline cards');
  assert.ok(assignSlice.includes('is-ready-session'), 'assignments missing ready-session Drive state');
  assert.ok(assignSlice.includes('homework-student-zero-card'), 'assignments missing calm student zero state');
  assert.ok(assignSlice.includes('invalidateClassSessionsCatalogCache'), 'assignments must use invalidateClassSessionsCatalogCache');
  assert.ok(!assignSlice.includes('Vào buổi học'), 'assignments workspace must use task-specific CTAs instead of generic Vào buổi học');

  assert.doesNotMatch(clientJs, /setAttribute\s*\(\s*['"]style['"]/);
  assert.doesNotMatch(clientJs, /\bstyle\s*=\s*["']/);

  for (const selector of [
    /\.assignments-sessions-page-root\s*\{/,
    /\.materials-studio-board,\s*\n?\.homework-studio-board\s*\{/,
    /\.materials-spotlight-banner\s*\{/,
    /\.materials-syllabus-grid\s*\{/,
    /\.materials-syllabus-card\.session-grid-card\s*\{/,
    /\.homework-board-grid\s*\{/,
    /\.homework-task-card\.session-grid-card\s*\{/,
    /\.homework-task-card\.is-ready-session\s*\{/,
    /\.homework-student-zero-card\.session-grid-card\s*\{/,
    /\.homework-quick-row\.session-grid-card\s*\{/,
    /\.materials-timeline-row\.session-grid-card\s*,?\s*\n?\.homework-quick-row\.session-grid-card\s*\{/,
    /\.session-detail-nav-row\s*\{/,
    /\.ltch-breadcrumb-step-nav\s*\{/,
    /\.ltch-step-nav-btn\s*\{/,
    /\.drive-structure-preview-card\s*\{/,
    /button\.session-file-delete-btn\s*\{/,
    /\.session-delete-confirm-box\s*\{/,
    /\.session-split-study-grid\s*\{/,
    /button\.ltch-video-playlist-item\s*\{/,
  ]) {
    assert.match(css, selector, `Missing CSS rule for ${selector}`);
  }
});

test('Academic Media Studio split study, exam source integration, and zero inline styles across solution & materials pages', async () => {
  const clientJs = await readRepoFile('client/app.js');
  const solFnStart = clientJs.indexOf('async function renderExamSolutionPage(');
  assert.ok(solFnStart > -1, 'Expected renderExamSolutionPage');
  const solFnEndMatch = clientJs.slice(solFnStart + 80).match(/\n(?:export\s+)?(?:async\s+)?function\s+/);
  const solFnEnd = solFnEndMatch ? solFnStart + 80 + solFnEndMatch.index : clientJs.length;
  const solFnSlice = clientJs.slice(solFnStart, solFnEnd);

  assert.ok(solFnSlice.includes('allSolutionDocs'), 'renderExamSolutionPage must unify inline solution and exam source docs');
  assert.match(solFnSlice, /song song/i, 'renderExamSolutionPage must support split study mode');
  assert.ok(solFnSlice.includes('session-split-study-grid'), 'renderExamSolutionPage must render split study grid');
  assert.ok(solFnSlice.includes('playlist: videos'), 'renderExamSolutionPage must pass playlist to video studio');

  assert.match(clientJs, /song song/i, 'Materials session page must include song song mode');
  assert.ok(clientJs.includes('ltch-video-studio-bar') || (await readRepoFile('client/lesson-media-viewer.mjs')).includes('ltch-video-studio-bar'));
});

test('practice room hub cards display exact room titles without subtitle captions', async () => {
  const src = await readRepoFile('client/practice-rooms.mjs');
  const hubStart = src.indexOf('if (isHubView)');
  assert.ok(hubStart > -1, 'Expected isHubView block in practice-rooms.mjs');
  const hubEnd = src.indexOf('const activeThptqgMeta =', hubStart);
  assert.ok(hubEnd > hubStart, 'Expected end of isHubView block');
  const hubSlice = src.slice(hubStart, hubEnd);

  assert.match(hubSlice, /title:\s*['"]Phòng luyện THPTQG['"]/);
  assert.match(hubSlice, /title:\s*['"]Phòng luyện HSA['"]/);
  assert.match(hubSlice, /title:\s*['"]Phòng luyện TSA['"]/);
  assert.doesNotMatch(hubSlice, /ltch-room-hub-desc/);
});

test('active practice room header and upload workspaces strictly isolate THPTQG, HSA, and TSA without quick switchers', async () => {
  const [src, guideSrc] = await Promise.all([
    readRepoFile('client/practice-rooms.mjs'),
    readRepoFile('client/word-exam-ai-guide.mjs')
  ]);
  assert.doesNotMatch(src, /Chọn nhanh loại phòng luyện/);
  assert.doesNotMatch(src, /ltch-room-meta-badge/);
  assert.doesNotMatch(src, /ltch-breadcrumb-select/);
  assert.doesNotMatch(src, /Phương thức thi \(áp dụng chung cho cả đợt\)/);
  assert.match(src, /Chọn kho đề THPTQG theo khối/);
  assert.doesNotMatch(guideSrc, /ltch-ai-tab-btn/);
  assert.doesNotMatch(guideSrc, /ltch-ai-guide-tabs/);
});

test('practice rooms enforce legible typography and full-size MathML Core formula presentation across THPTQG, HSA, and TSA', async () => {
  const [css, practiceSrc] = await Promise.all([
    readRepoFile('public/app.css'),
    readRepoFile('client/practice-rooms.mjs')
  ]);

  assert.match(css, /math mtext\s*\{[\s\S]*?font-family:/);
  assert.match(css, /math menclose\[notation~="box"\]\s*\{[\s\S]*?border:/);
  assert.match(css, /math mtable\[columnalign\^="left"\] mtd,\s*\nmath mtable\[columnalign="right"\] mtd\s*\{/);

  assert.match(
    css,
    /\.ltch-exam-fullscreen-overlay \.forum-math-inline\s*\{[\s\S]*?display:\s*inline;[\s\S]*?vertical-align:\s*baseline;/
  );
  assert.match(
    css,
    /\.ltch-exam-fullscreen-overlay \.forum-math-inline math\s*\{[\s\S]*?font-size:\s*1\.12em;[\s\S]*?math-style:\s*normal;/
  );
  assert.match(
    css,
    /\.ltch-exam-fullscreen-overlay math :is\(msup, msub, msubsup, mmultiscripts\) > :not\(:first-child\) :is\(mfrac, msqrt, mroot\)[\s\S]*?math-style:\s*compact;/
  );
  assert.match(
    css,
    /\.ltch-exam-fullscreen-overlay \.ltch-bbt-cell-label \.forum-math-inline math\s*\{[\s\S]*?math-style:\s*compact;/
  );

  assert.match(css, /\.ltch-q-prompt\s*\{[\s\S]*?font-size:\s*1\.0625rem;/);
  assert.match(css, /\.ltch-passage-body\s*\{[\s\S]*?font-size:\s*1\.03125rem;/);
  assert.match(css, /\.ltch-option-content\s*\{[\s\S]*?font-size:\s*1\.03125rem;/);
  assert.match(css, /\.ltch-sol-explanation-body\s*\{[\s\S]*?font-size:\s*1\.03125rem;/);
  assert.match(css, /\.ltch-tf-interactive-table\.is-tsa th,\s*\n\.ltch-tf-interactive-table\.is-tsa td\s*\{[\s\S]*?font-size:\s*1\.03125rem;/);
  assert.match(css, /\.ltch-drag-card-pill\s*\{[\s\S]*?font-size:\s*0\.98rem\s*!important;/);
  assert.match(css, /\.ltch-drag-slot\s*\{[\s\S]*?font-size:\s*0\.96rem\s*!important;/);
  assert.match(css, /\.ltch-q-image\s*\{[\s\S]*?max-width:\s*min\(780px,\s*100%\);[\s\S]*?max-height:\s*560px;/);
  assert.match(css, /\.ltch-passage-body \.ltch-q-image\s*\{/);
  assert.match(css, /\.ltch-option-content \.ltch-q-image,\s*\n\.ltch-opt-text \.ltch-q-image\s*\{/);
  assert.match(css, /\.ltch-img-lightbox-backdrop\s*\{/);
  assert.match(css, /\.ltch-img-lightbox-img\.is-zoomed\s*\{/);
  assert.match(css, /\.ltch-bbt-cell-label\s*\{[\s\S]*?font-size:\s*15\.5px;/);
  assert.match(css, /\.ltch-hsa-cluster-row\s*\{[\s\S]*?width:\s*min\(1320px,\s*100%\);/);

  const inlineFnStart = practiceSrc.indexOf('export function appendFormattedInlineMath(');
  assert.ok(inlineFnStart > -1, 'Expected appendFormattedInlineMath');
  const inlineFnSlice = practiceSrc.slice(inlineFnStart, inlineFnStart + 650);
  assert.match(inlineFnSlice, /parseForumMath\(rawStr,\s*Infinity\)/);
  assert.doesNotMatch(practiceSrc, /class:\s*['"]ltch-hsa-stream['"],\s*\n\s*style:/);

  assert.match(practiceSrc, /export function openPracticeImageLightbox\(/);
  const figStart = practiceSrc.indexOf('function createMediaFigure(');
  assert.ok(figStart > -1, 'Expected createMediaFigure');
  const figSlice = practiceSrc.slice(figStart, figStart + 900);
  assert.doesNotMatch(figSlice, /img\.style\.maxWidth/);
  assert.match(practiceSrc, /allowImageZoom:\s*false/);
});
