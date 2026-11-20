'use strict';
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const launchChromium = require('./chromium.cjs');

async function startServer() {
  const srv = spawn(process.execPath, [path.resolve('tests/ui/server.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('QA server start timed out')), 8000);
    srv.stdout.on('data', chunk => {
      if (String(chunk).includes('5181')) {
        clearTimeout(timer);
        resolve();
      }
    });
    srv.stderr.on('data', chunk => {
      const msg = String(chunk).trim();
      if (msg) console.error(msg);
    });
  });
  return srv;
}

async function auditScreen(page, label) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('div')) {
      if (el.style && el.style.zIndex === '99999') el.style.display = 'none';
    }
  });
  await page.waitForTimeout(30);
  const metrics = await page.evaluate(() => {
    const vw = window.innerWidth;
    const docSw = document.documentElement.scrollWidth;
    const bodySw = document.body ? document.body.scrollWidth : 0;
    const overflow = Math.max(docSw, bodySw) > vw + 1;

    const clipped = [];
    for (const el of document.querySelectorAll('main, section, article, .card, .panel, dialog[open], .modal-card, .ltch-modal-card, .ltch-upload-structure-strip, header, .workspace-main, #content, .table-wrap, .admin-section, .session-catalog-header-shell, .attendance-workspace, .forum-toolbar, .session-page-header-shell')) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.scrollWidth > el.clientWidth + 4 && st.overflowX !== 'auto' && st.overflowX !== 'scroll') {
        clipped.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : '',
          cw: el.clientWidth,
          sw: el.scrollWidth
        });
      }
    }

    const smallTargets = [];
    if (vw <= 1024) {
      for (const el of document.querySelectorAll('button, a, summary, [role="button"], [role="tab"]')) {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || st.display === 'none' || st.visibility === 'hidden') continue;
        if (r.width < 44 || r.height < 44) {
          smallTargets.push({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className : '',
            text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30),
            w: Math.round(r.width),
            h: Math.round(r.height)
          });
        }
      }
    }

    const clippedButtons = [];
    for (const el of document.querySelectorAll('button:not(.ltch-select-trigger):not(.ltch-upload-q-item), .ltch-btn, .ltch-staff-mini-btn')) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rr = range.getBoundingClientRect();
      if (rr.width > 0 && (rr.width > r.width - 2 || rr.left < r.left || rr.right > r.right)) {
        clippedButtons.push({
          cls: typeof el.className === 'string' ? el.className : '',
          text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 35),
          btnW: Math.round(r.width),
          txtW: Math.round(rr.width),
          leftGap: Math.round(rr.left - r.left),
          rightGap: Math.round(r.right - rr.right)
        });
      }
    }

    const smallInputs = [];
    if (vw <= 1024) {
      for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not(.otp-digit-box):not([name="code"]), select, textarea')) {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || st.display === 'none' || st.visibility === 'hidden') continue;
        const fs = parseFloat(st.fontSize);
        if (fs < 16) {
          smallInputs.push({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className : '',
            id: el.id || el.name || '',
            fs
          });
        }
      }
    }

    const crushedCols = [];
    for (const el of document.querySelectorAll('td, th, p, h1, h2, h3, h4, .card-title, .session-card-title')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (el.innerText || '').trim().length > 10 && r.width < 65) {
        crushedCols.push({
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || '').trim().slice(0, 25),
          w: Math.round(r.width)
        });
      }
    }

    const misalignedIcons = [];
    const iconBoxSelectors = [
      '.overview-kpi-icon',
      '.overview-panel-icon',
      '.overview-activity-dot',
      '.notices-empty-icon-wrap',
      '.feature-icon',
      '.auth-security-icon',
      '.lesson-file-icon',
      '.session-initial-choice-icon',
      '.ltch-select-chevron',
      '.ltch-exam-choice-icon',
      '.ltch-dropzone-icon'
    ].join(',');
    for (const el of document.querySelectorAll(iconBoxSelectors)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const svg = el.querySelector('svg');
      if (!svg) continue;
      const sr = svg.getBoundingClientRect();
      if (sr.width === 0 || sr.height === 0) continue;
      const dx = Math.abs((sr.left - r.left) - (r.right - sr.right));
      const dy = Math.abs((sr.top - r.top) - (r.bottom - sr.bottom));
      if (dx > 1.5 || dy > 1.5) {
        misalignedIcons.push({
          cls: typeof el.className === 'string' ? el.className : '',
          dx: Math.round(dx * 10) / 10,
          dy: Math.round(dy * 10) / 10
        });
      }
    }

    return {overflow, docSw, vw, clipped, clippedButtons, smallTargets, smallInputs, crushedCols, misalignedIcons};
  });

  assert.equal(metrics.overflow, false, `${label}: horizontal overflow (${metrics.docSw} > ${metrics.vw})`);
  assert.deepEqual(metrics.clipped, [], `${label}: clipped container(s)`);
  assert.deepEqual(metrics.clippedButtons, [], `${label}: clipped button text`);
  assert.deepEqual(metrics.smallInputs, [], `${label}: mobile/tablet input font-size < 16px`);
  assert.deepEqual(metrics.crushedCols, [], `${label}: crushed narrow column(s)`);
  assert.deepEqual(metrics.smallTargets, [], `${label}: touch target(s) below 44x44px`);
  assert.deepEqual(metrics.misalignedIcons, [], `${label}: off-center icon(s) inside icon container`);
}

(async () => {
  const srv = await startServer();
  const browser = await launchChromium();
  const errors = [];
  let checks = 0;

  try {
    const page = await browser.newPage({viewport: {width: 320, height: 740}, reducedMotion: 'reduce'});
    let scopedViewer = null;
    page.on('pageerror', err => errors.push(err.message));

    await page.route(/\/api\//, async route => {
      try {
        const res = await route.fetch();
        if (res.status() === 404) {
          return await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ok: true,
              items: [],
              sessions: [],
              posts: [],
              students: [{uid: 'st-1', name: 'Nguyễn Minh Quân', email: 'quan@student.vn'}]
            })
          });
        }
        if (scopedViewer && new URL(route.request().url()).pathname.endsWith('/workspace') && res.ok()) {
          const workspace = await res.json();
          return await route.fulfill({response: res, json: {...workspace, viewerContext: {...workspace.viewerContext, ...scopedViewer}}});
        }
        await route.fulfill({response: res});
      } catch {
        await route.abort().catch(() => {});
      }
    });

    await page.route(/\/app\.js/, async route => {
      const res = await route.fetch();
      let body = await res.text();
      body = body.replace(/currentUser:\s*null/, 'currentUser: user');
      body = body.replace(
        'if (!session || sessionUid !== auth2.currentUser.uid)',
        "session = { token: 'qa-session' }; sessionUid = auth2.currentUser.uid; if (false)"
      );
      body = body.replace(
        'window.qaSetMode =',
        `window.__qa = {
          navigateTo, openClass, classView, showWorkspaceView, showRoleChoice, showStaffConfirmation,
          showOnboardingForm, contentEditor, promotionEditor, assistantEditor,
          getClasses: () => classes,
          bootFull: async (role = 'admin', access = null) => {
            const [p, cl] = await Promise.all([api('/api/me'), api('/api/classes')]);
            me = { ...p, classIds: ['qa-class', ...(p.classIds || [])], ...access };
            const qaCls = { id: 'qa-class', name: 'Lớp Toán 12 - Mục tiêu 9+', grade: 12, schoolYear: '2026-2027', schedule: 'Thứ 3, Thứ 6 (18:00 - 20:00)' };
            classes = [qaCls, ...sortClasses(cl.items).filter(x => x.id !== 'qa-class')];
            archivedClasses = [{ id: 'arch-1', name: 'Lớp Toán 12 (Khóa 2025)', grade: 12, schoolYear: '2025-2026', archived: true }];
            viewRole = role;
            await showWorkspaceView();
          }
        }; window.qaSetMode =`
      );
      await route.fulfill({response: res, body});
    });

    const viewports = [
      [320, 740],
      [375, 812],
      [568, 320],
      [768, 1024],
      [1024, 768],
      [1440, 900]
    ];

    for (const [vw, vh] of viewports) {
      await page.setViewportSize({width: vw, height: vh});
      await page.goto('http://127.0.0.1:5181/');
      await auditScreen(page, `public/index@${vw}x${vh}`);
      checks++;
      await page.goto('http://127.0.0.1:5181/chinh-sach-bao-mat.html');
      await auditScreen(page, `public/privacy@${vw}x${vh}`);
      checks++;
    }

    await page.goto('http://127.0.0.1:5181/login');
    await page.waitForFunction(() => typeof window.__qa === 'object', {timeout: 5000});

    for (const [vw, vh] of viewports) {
      await page.setViewportSize({width: vw, height: vh});

      await page.evaluate(() => {
        const setH = (sel, h) => { const e = document.querySelector(sel); if (e) e.hidden = h; };
        setH('.auth-wrapper', false);
        setH('#workspace', true);
        setH('#onboarding-panel', true);
        setH('#pending-panel', true);
        setH('#otp-panel', true);
        setH('#auth-panel', false);
      });
      await auditScreen(page, `auth@${vw}x${vh}`);
      checks++;

      await page.evaluate(() => {
        const setH = (sel, h) => { const e = document.querySelector(sel); if (e) e.hidden = h; };
        setH('#auth-panel', true);
        setH('#otp-panel', false);
      });
      await auditScreen(page, `otp@${vw}x${vh}`);
      checks++;

      await page.evaluate(() => {
        const e = document.getElementById('otp-panel');
        if (e) e.hidden = true;
      });

      for (const mode of ['new_student', 'pending', 'revision']) {
        await page.evaluate(m => window.qaSetMode(m), mode);
        await page.waitForTimeout(60);
        await auditScreen(page, `mode-${mode}@${vw}x${vh}`);
        checks++;
      }

      await page.evaluate(() => window.__qa.bootFull('admin'));
      await page.waitForTimeout(100);

      for (const pg of ['home', 'classes', 'archive', 'enrollments', 'admin', 'settings', 'practice']) {
        await page.evaluate(p => window.__qa.navigateTo(p), pg);
        if (pg === 'home') await page.waitForSelector('.overview-assignment-row', {timeout: 3000});
        await page.waitForTimeout(80);
        await auditScreen(page, `page-${pg}@${vw}x${vh}`);
        checks++;
        if (pg === 'settings') {
          await page.waitForSelector('.account-tabs', {timeout: 3000});
          assert.equal(await page.locator('.account-role-grid').count(), 0, `page-settings@${vw}x${vh}: admin account must not show role switcher`);
          assert.equal(await page.locator('.account-linked-list').count(), 0, `page-settings@${vw}x${vh}: admin account must not show parent/student link cards`);
          assert.equal(await page.locator('.account-enrollment-summary').count(), 0, `page-settings@${vw}x${vh}: admin account must not show student enrollment summary`);
          assert.equal(await page.locator('.account-hero-chip.is-code').count(), 0, `page-settings@${vw}x${vh}: admin account must not show student code chip`);
          for (const tabName of ['Bảo mật & Đăng nhập', 'Quyền dữ liệu & Hỗ trợ', 'Hồ sơ & Liên hệ']) {
            await page.getByRole('tab', {name: tabName}).click();
            await page.waitForTimeout(50);
            await auditScreen(page, `page-settings-${tabName}@${vw}x${vh}`);
            checks++;
          }
          if (vw === 1440) {
            const nameInput = page.locator('#account-input-name');
            const originalName = await nameInput.inputValue();
            await nameInput.fill('Nguyễn Minh Quân');
            await page.getByRole('button', {name: 'Lưu thay đổi hồ sơ'}).click();
            await page.waitForFunction(() => document.querySelector('#account-hero-name')?.textContent === 'Nguyễn Minh Quân', {timeout: 3000});
            assert.equal(await page.locator('#account-label').textContent(), 'Nguyễn Minh Quân');
            assert.equal(await page.locator('#user-badge-container .user-avatar').textContent(), 'MQ');
            await nameInput.fill(originalName);
            await page.getByRole('button', {name: 'Lưu thay đổi hồ sơ'}).click();
            await page.waitForFunction(expected => document.querySelector('#account-hero-name')?.textContent === expected, originalName, {timeout: 3000});
          }
        }
        if (pg === 'home') {
          const assignmentSpacing = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.overview-assignment-row')];
            return rows.map(row => {
              const info = row.querySelector('.overview-assignment-info');
              const btn = row.querySelector(':scope > button');
              if (!info || !btn) return {ok: false, reason: 'missing child'};
              const ir = info.getBoundingClientRect();
              const br = btn.getBoundingClientRect();
              const sameRow = br.top < ir.bottom - 2 && ir.top < br.bottom - 2;
              const gap = sameRow ? (br.left - ir.right) : (br.top - ir.bottom);
              return {ok: sameRow ? gap >= 12 : gap >= 10, sameRow, gap: Math.round(gap)};
            });
          });
          assert.ok(assignmentSpacing.length > 0, `page-home@${vw}x${vh}: expected rendered .overview-assignment-row`);
          assert.ok(assignmentSpacing.every(x => x.ok), `page-home@${vw}x${vh}: assignment button gap issue: ${JSON.stringify(assignmentSpacing)}`);
        }
        if (pg === 'admin') {
          await page.getByRole('tab', {name: /Tài khoản & Phân quyền/}).click();
          await page.waitForTimeout(40);
          await auditScreen(page, `page-admin-accounts@${vw}x${vh}`);
          checks++;

          await page.getByRole('tab', {name: /Phân công thành viên/}).click();
          await page.waitForTimeout(40);
          await auditScreen(page, `page-admin-memberships-students-class@${vw}x${vh}`);
          checks++;

          await page.getByRole('button', {name: 'Theo học sinh', exact: true}).click();
          await page.waitForTimeout(40);
          await auditScreen(page, `page-admin-memberships-students-list@${vw}x${vh}`);
          checks++;

          await page.getByRole('tab', {name: /Đội ngũ giảng dạy/}).click();
          await page.waitForTimeout(40);
          const teacherRows = await page.locator('#admin-subpanel-staff tbody tr', {hasText: 'Cô Hạnh'}).count();
          assert.equal(teacherRows, 1, `admin-memberships-staff@${vw}x${vh}: teacher must appear once, got ${teacherRows}`);
          await auditScreen(page, `page-admin-memberships-staff@${vw}x${vh}`);
          checks++;

          await page.getByRole('tab', {name: /Liên kết phụ huynh/}).click();
          await page.waitForTimeout(40);
          await auditScreen(page, `page-admin-memberships-parents@${vw}x${vh}`);
          checks++;

          await page.getByRole('tab', {name: /Học sinh theo lớp/}).click();
          await page.getByRole('button', {name: 'Theo lớp học', exact: true}).click();
          await page.getByRole('tab', {name: /Lớp học & Năm học/}).click();
          await page.waitForTimeout(40);
          await auditScreen(page, `page-admin-catalog@${vw}x${vh}`);
          checks++;
        }
      }

      await page.evaluate(() => window.__qa.navigateTo('practice', {subPage: 'hsa'}));
      await page.waitForTimeout(100);
      await auditScreen(page, `page-practice-hsa@${vw}x${vh}`);
      checks++;

      const cardCover = page.locator('.ltch-room-hub-cover').first();
      if (await cardCover.count()) {
        await cardCover.click();
        await page.waitForSelector('.ltch-exam-choice-modal', {timeout: 3000});
        await auditScreen(page, `modal-exam-choice@${vw}x${vh}`);
        checks++;
        const closeChoiceBtn = page.locator('.ltch-exam-choice-modal .ltch-modal-close').first();
        if (await closeChoiceBtn.count()) {
          await closeChoiceBtn.click();
          await page.waitForTimeout(40);
        }
      }

      const studioMenuBtn = page.locator('.ltch-staff-menu-btn').first();
      const studioEditBtn = page.locator('.ltch-staff-mini-btn', {hasText: 'Sửa đề'}).first();
      let openedStudio = false;
      if (await studioMenuBtn.count()) {
        await studioMenuBtn.click();
        await page.getByRole('menuitem', {name: 'Sửa đề', exact: true}).click();
        openedStudio = true;
      } else if (await studioEditBtn.count()) {
        await studioEditBtn.click();
        openedStudio = true;
      }
      if (openedStudio) {
        await page.waitForSelector('.ltch-exam-fullscreen-overlay.is-upload-workspace', {timeout: 4000});
        await auditScreen(page, `studio-word-edit@${vw}x${vh}`);
        checks++;
        const closeStudioBtn = page.locator('.ltch-exam-fullscreen-overlay.is-upload-workspace .ltch-upload-header button').first();
        if (await closeStudioBtn.count()) {
          await closeStudioBtn.click();
          await page.waitForTimeout(60);
        }
      }

      const newUploadBtn = page.getByRole('button', {name: '+ Đăng tải đề Word (.docx)'}).first();
      if (await newUploadBtn.count()) {
        await newUploadBtn.click();
        await page.waitForSelector('.ltch-exam-fullscreen-overlay.is-upload-workspace .ltch-ai-guide-card', {timeout: 4000});
        const studioCheck = await page.evaluate(() => {
          const root = document.querySelector('.ltch-exam-fullscreen-overlay.is-upload-workspace');
          if (!root) return null;
          const headerH = root.querySelector('.ltch-upload-header')?.getBoundingClientRect().height || 0;
          const metaH = root.querySelector('.ltch-upload-meta-bar')?.getBoundingClientRect().height || 0;
          const tplLinks = [...root.querySelectorAll('.ltch-upload-template-strip .ltch-template-link')];
          return {
            aiTabsCount: root.querySelectorAll('.ltch-ai-guide-tabs').length,
            tplCount: tplLinks.length,
            tplHref: tplLinks[0]?.getAttribute('href') || '',
            structStripCount: root.querySelectorAll('.ltch-upload-structure-strip').length,
            topChromeHeight: Math.round(headerH + metaH)
          };
        });
        assert.ok(studioCheck, `studio-word-new-ai-guide@${vw}x${vh}: missing upload workspace`);
        assert.equal(studioCheck.aiTabsCount, 0, `studio-word-new-ai-guide@${vw}x${vh}: AI guide card must not have exam-type switcher tabs`);
        assert.equal(studioCheck.tplCount, 1, `studio-word-new-ai-guide@${vw}x${vh}: must show only 1 active room Word template`);
        assert.ok(studioCheck.tplHref.includes('Mau_dang_tai_HSA.docx'), `studio-word-new-ai-guide@${vw}x${vh}: expected HSA template link`);
        assert.equal(studioCheck.structStripCount, 0, `studio-word-new-ai-guide@${vw}x${vh}: empty upload workspace must hide 0-question status strip`);
        if (vw === 1440) {
          assert.ok(
            studioCheck.topChromeHeight <= 210,
            `studio-word-new-ai-guide@${vw}x${vh}: top chrome height ${studioCheck.topChromeHeight}px exceeds compact 210px limit`
          );
        }
        await auditScreen(page, `studio-word-new-ai-guide@${vw}x${vh}`);
        checks++;

        const openGuideModalBtn = page.locator('.ltch-btn-ai').first();
        if (await openGuideModalBtn.count()) {
          await openGuideModalBtn.click();
          await page.waitForSelector('.ltch-ai-guide-modal .ltch-ai-prompt-code', {timeout: 3000});
          const hasGuideActions = await page.evaluate(() => {
            const modal = document.querySelector('.ltch-ai-guide-modal');
            if (!modal) return false;
            return Boolean(
              modal.querySelectorAll('.ltch-ai-guide-tabs').length === 0 &&
              modal.querySelector('.ltch-ai-template-btn') &&
              modal.querySelector('.ltch-ai-quick-copy-btn') &&
              modal.querySelector('pre.ltch-ai-prompt-code')?.textContent?.includes('[BẮT ĐẦU ĐỀ]')
            );
          });
          assert.equal(hasGuideActions, true, `modal-ai-exam-guide@${vw}x${vh}: missing template/copy/prompt or unexpected tabs`);
          await auditScreen(page, `modal-ai-exam-guide@${vw}x${vh}`);
          checks++;
          const closeGuideBtn = page.locator('.ltch-ai-guide-modal .ltch-modal-close').first();
          if (await closeGuideBtn.count()) {
            await closeGuideBtn.click();
            await page.waitForTimeout(40);
          }
        }

        const closeNewStudioBtn = page.locator('.ltch-exam-fullscreen-overlay.is-upload-workspace .ltch-upload-header button').first();
        if (await closeNewStudioBtn.count()) {
          await closeNewStudioBtn.click();
          await page.waitForTimeout(60);
        }
      }

      if (vw === 768 || vw === 1024 || vw === 1440) {
        const roomRects = {};
        for (const [clsId, expectedCount] of [['class-12a1', 3], ['class-11a1', 2], ['class-10a1', 1]]) {
          await page.evaluate(async id => {
            const cls = window.__qa.getClasses().find(c => c.id === id);
            if (!cls) throw new Error(`Missing class ${id}`);
            await window.__qa.openClass(cls, 'practice');
          }, clsId);
          await page.waitForFunction(
            count => document.querySelectorAll('.ltch-room-hub-grid .ltch-room-hub-card').length === count,
            expectedCount,
            {timeout: 4000}
          );
          await auditScreen(page, `classtab-practice-hub-${clsId}@${vw}x${vh}`);
          checks++;
          roomRects[clsId] = await page.evaluate(() => {
            const r = document.querySelector('.ltch-room-hub-grid .ltch-room-hub-card')?.getBoundingClientRect();
            return r ? {width: Math.round(r.width), height: Math.round(r.height)} : null;
          });
          assert.ok(roomRects[clsId], `${clsId}@${vw}x${vh}: missing practice room hub card`);
        }
        const refRect = roomRects['class-12a1'];
        for (const clsId of ['class-11a1', 'class-10a1']) {
          assert.ok(
            Math.abs(roomRects[clsId].width - refRect.width) <= 2,
            `${clsId}@${vw}x${vh}: card width ${roomRects[clsId].width}px must match Grade 12 ${refRect.width}px`
          );
          assert.ok(
            Math.abs(roomRects[clsId].height - refRect.height) <= 2,
            `${clsId}@${vw}x${vh}: card height ${roomRects[clsId].height}px must match Grade 12 ${refRect.height}px`
          );
        }
      }

      await page.evaluate(async () => {
        const c = window.__qa.getClasses()[0];
        if (c) await window.__qa.openClass(c, 'notices');
      });
      await page.waitForTimeout(80);

      for (const tab of ['notices', 'materials', 'assignments', 'attendance', 'forum', 'practice']) {
        await page.evaluate(t => window.__qa.classView(t), tab);
        await page.waitForTimeout(80);
        await auditScreen(page, `classtab-${tab}@${vw}x${vh}`);
        checks++;
        if (tab === 'attendance') {
          await page.getByRole('tab', {name: /Tổng hợp học sinh/}).click();
          await page.waitForTimeout(40);
          await auditScreen(page, `classtab-attendance-students@${vw}x${vh}`);
          checks++;

          await page.getByRole('tab', {name: /Lịch sử các buổi/}).click();
          await page.waitForTimeout(40);
          await auditScreen(page, `classtab-attendance-history@${vw}x${vh}`);
          checks++;

          await page.getByRole('tab', {name: /Điểm danh buổi học/}).click();
          await page.waitForTimeout(40);
        }
      }

      await page.evaluate(() => window.__qa.classView('practice', {subPage: 'thptqg/qa-thptqg-01'}));
      await page.waitForTimeout(120);
      await auditScreen(page, `practice-solution@${vw}x${vh}`);
      checks++;

      await page.evaluate(() => window.__qa.classView('materials', {subPage: 'buoi-1'}));
      await page.waitForTimeout(80);
      await auditScreen(page, `materials-buoi1@${vw}x${vh}`);
      checks++;

      await page.evaluate(() => window.__qa.classView('assignments', {subPage: 'buoi-1'}));
      await page.waitForTimeout(80);
      await auditScreen(page, `assignments-buoi1@${vw}x${vh}`);
      checks++;

      // Verify forum composer dialog on mobile/tablet
      await page.evaluate(() => window.__qa.classView('forum'));
      await page.waitForSelector('.forum-toolbar button', {timeout: 3000});
      await page.evaluate(() => {
        const b = document.querySelector('.forum-toolbar button');
        if (b) b.click();
      });
      await page.waitForSelector('dialog#editor[open]', {timeout: 3000});
      const modalWidthOk = await page.evaluate(() => {
        const d = document.getElementById('editor');
        return Boolean(d && d.open && d.getBoundingClientRect().width <= window.innerWidth + 1);
      });
      assert.equal(modalWidthOk, true, `modal-forum@${vw}x${vh}: dialog#editor width <= ${vw}`);
      await auditScreen(page, `modal-forum@${vw}x${vh}`);
      checks++;
      await page.evaluate(() => {
        const d = document.getElementById('editor');
        if (d && d.open) d.close();
      });

      // Verify notice composer modal & populated notices tab on mobile/tablet
      await page.evaluate(() => window.__qa.classView('notices'));
      await page.waitForSelector('.notices-hero-bar .subtab-command-actions button', {timeout: 3000});
      const existingNoticesCount = await page.locator('.notice-card').count();
      if (existingNoticesCount < 2) {
        for (let tplIdx = 0; tplIdx < 2 - existingNoticesCount; tplIdx++) {
          await page.getByRole('button', {name: 'Mẫu soạn nhanh'}).click();
          await page.locator('.ltch-action-menu-popover .ltch-action-menu-item').nth(tplIdx).click();
          await page.waitForSelector('dialog#editor[open] .notice-composer-form', {timeout: 3000});
          assert.equal(await page.locator('dialog#editor .notice-composer-templates').count(), 0, 'Duplicate notice-composer-templates inside modal must be removed');
          if (tplIdx === 0) {
            const modalNoticeOk = await page.evaluate(() => {
              const d = document.getElementById('editor');
              return Boolean(d && d.open && d.getBoundingClientRect().width <= window.innerWidth + 1);
            });
            assert.equal(modalNoticeOk, true, `modal-notice@${vw}x${vh}: dialog#editor width <= ${vw}`);
            await auditScreen(page, `modal-notice@${vw}x${vh}`);
            checks++;
          }
          await page.locator('.notice-composer-form button[type="submit"]').click();
          await page.waitForFunction(() => !document.getElementById('editor')?.open, {timeout: 3000});
          await page.waitForSelector('.notice-card', {timeout: 3000});
        }
      } else {
        await page.getByRole('button', {name: 'Đăng thông báo mới', exact: true}).click();
        await page.waitForSelector('dialog#editor[open] .notice-composer-form', {timeout: 3000});
        assert.equal(await page.locator('dialog#editor .notice-composer-templates').count(), 0, 'Duplicate notice-composer-templates inside modal must be removed');
        const modalNoticeOk = await page.evaluate(() => {
          const d = document.getElementById('editor');
          return Boolean(d && d.open && d.getBoundingClientRect().width <= window.innerWidth + 1);
        });
        assert.equal(modalNoticeOk, true, `modal-notice@${vw}x${vh}: dialog#editor width <= ${vw}`);
        await auditScreen(page, `modal-notice@${vw}x${vh}`);
        checks++;
        await page.evaluate(() => {
          const d = document.getElementById('editor');
          if (d && d.open) d.close();
        });
      }
      await page.waitForTimeout(80);
      await auditScreen(page, `classtab-notices-populated@${vw}x${vh}`);
      checks++;

      await page.evaluate(() => window.__qa.bootFull('parent'));
      await page.waitForTimeout(80);
      await auditScreen(page, `role-parent@${vw}x${vh}`);
      checks++;

      await page.evaluate(() => window.__qa.bootFull('student'));
      await page.waitForTimeout(80);
      await auditScreen(page, `role-student@${vw}x${vh}`);
      checks++;
    }

    await page.setViewportSize({width: 375, height: 812});
    for (const role of ['student', 'parent']) {
      const class_id = 'class-8a';
      scopedViewer = {
        roles: [role],
        memberships: role === 'student' ? [{class_id, member_role: role}] : [],
        childMemberships: role === 'parent' ? [{class_id, uid: 'qa-child'}] : []
      };
      await page.evaluate(async ({role, access}) => {
        await window.__qa.bootFull(role, access);
        await window.__qa.navigateTo('classes');
      }, {role, access: scopedViewer});
      assert.ok(await page.locator('#class-body.is-tab-notices').isVisible());
      assert.match(new URL(page.url()).pathname, /^\/class\/[^/]+$/);

      for (const [vw, vh] of [[320, 740], [375, 812], [768, 1024], [1440, 900]]) {
        await page.setViewportSize({width: vw, height: vh});
        await page.evaluate(() => window.__qa.classView('attendance'));
        await page.waitForSelector('.att-learner-timeline', {timeout: 3000});
        await auditScreen(page, `learner-attendance-${role}@${vw}x${vh}`);
        checks++;
      }
      await page.setViewportSize({width: 375, height: 812});
    }

    assert.deepEqual(errors, [], 'no runtime pageerror during full-site responsive checks');
    console.log(`PASS: ${checks} full-site responsive screens verified across 320px-1440px (0 overflow, 0 clipped containers, 0 clipped buttons, 0 crushed columns, >=16px inputs, >=44px mobile/tablet touch targets).`);
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
