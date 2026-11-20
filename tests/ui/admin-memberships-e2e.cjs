'use strict';
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const launchChromium = require('./chromium.cjs');

async function startServer() {
  const srv = spawn(process.execPath, [path.resolve('tests/ui/server.mjs')], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('QA server start timed out')), 10000);
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

async function selectCustomOption(page, selectLocator, optionValue) {
  await selectLocator.evaluate((sel, val) => {
    sel.value = val;
    sel.dispatchEvent(new Event('change', {bubbles: true}));
  }, optionValue);
  await page.waitForTimeout(40);
}

async function assertCleanGeometry(page, label) {
  const metrics = await page.evaluate(() => {
    const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth + 1;
    const clippedSelects = [];
    for (const span of document.querySelectorAll('.admin-memberships-workspace .ltch-select-value-text')) {
      const st = getComputedStyle(span);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const r = span.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (span.scrollWidth > span.clientWidth + 1) {
        clippedSelects.push({
          text: span.textContent.trim(),
          cw: Math.round(span.clientWidth),
          sw: Math.round(span.scrollWidth)
        });
      }
    }
    const stretchedBadges = [];
    for (const badge of document.querySelectorAll('.admin-memberships-workspace .badge')) {
      const st = getComputedStyle(badge);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const r = badge.getBoundingClientRect();
      if (r.width > 420) {
        stretchedBadges.push({text: badge.textContent.trim(), width: Math.round(r.width)});
      }
    }
    return {overflow, clippedSelects, stretchedBadges};
  });
  assert.equal(metrics.overflow, false, `${label}: horizontal overflow`);
  assert.deepEqual(metrics.clippedSelects, [], `${label}: clipped select text`);
  assert.deepEqual(metrics.stretchedBadges, [], `${label}: stretched badge(s)`);
}

(async () => {
  const outDir = path.resolve('.local/admin-review');
  await fs.mkdir(outDir, {recursive: true});

  const srv = await startServer();
  const browser = await launchChromium();
  const apiErrors = [];
  const pageErrors = [];

  try {
    const page = await browser.newPage({viewport: {width: 1366, height: 768}, reducedMotion: 'reduce'});
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('response', res => {
      if (res.url().includes('/api/') && res.status() >= 400) {
        apiErrors.push(`${res.request().method()} ${new URL(res.url()).pathname} -> ${res.status()}`);
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
          navigateTo,
          bootFull: async (role = 'admin') => {
            const [p, cl] = await Promise.all([api('/api/me'), api('/api/classes')]);
            me = { ...p, classIds: ['qa-class', ...(p.classIds || [])] };
            const qaCls = { id: 'qa-class', name: 'Lớp kiểm tra giao diện', grade: 12, schoolYear: '2026-2027', schedule: 'Thứ 3, Thứ 6 (18:00 - 20:00)' };
            classes = [qaCls, ...sortClasses(cl.items).filter(x => x.id !== 'qa-class')];
            archivedClasses = [{ id: 'arch-12', name: '12 (Khóa 2025)', grade: 12, schoolYear: '2025-2026', archived: true }];
            viewRole = role;
            await showWorkspaceView();
          }
        }; window.qaSetMode =`
      );
      await route.fulfill({response: res, body});
    });

    await page.goto('http://127.0.0.1:5181/login');
    await page.waitForFunction(() => typeof window.__qa === 'object', {timeout: 8000});
    await page.evaluate(async () => {
      await window.__qa.bootFull('admin');
      await window.__qa.navigateTo('admin');
    });
    await page.waitForSelector('.admin-view-tabs', {timeout: 5000});

    // Mở tab Phân công thành viên (mặc định: Học sinh theo lớp -> Theo lớp học)
    await page.getByRole('tab', {name: /Phân công thành viên/}).click();
    await page.waitForSelector('#admin-subpanel-students', {state: 'visible'});
    await assertCleanGeometry(page, 'desktop-students-by-class');
    await page.locator('#admin-subpanel-students details.admin-class-roster-card', {hasText: '12'}).first().locator('summary').click();
    await page.waitForTimeout(50);
    await page.screenshot({path: path.join(outDir, '01-desktop-students-by-class.png')});

    // Chuyển sang góc nhìn Theo học sinh
    await page.getByRole('button', {name: 'Theo học sinh', exact: true}).click();
    await page.waitForSelector('#admin-subpanel-students table.is-students-table', {state: 'visible'});
    await assertCleanGeometry(page, 'desktop-students-table');
    const toolbarAligned = await page.evaluate(() => {
      const search = document.querySelector('#admin-subpanel-students .admin-membership-search');
      const assign = [...document.querySelectorAll('#admin-subpanel-students .admin-membership-toolbar > button')].pop();
      if (!search || !assign) return false;
      return Math.abs(search.getBoundingClientRect().top - assign.getBoundingClientRect().top) < 10;
    });
    assert.equal(toolbarAligned, true, 'Toolbar controls and Xếp học sinh button should sit on one clean row at 1366px');

    // Luồng 1: Xếp học sinh Trần Thảo Linh vào lớp 8A
    await page.getByRole('button', {name: 'Xếp học sinh', exact: true}).click();
    await page.waitForSelector('dialog#editor[open]', {timeout: 3000});
    await selectCustomOption(page, page.locator('dialog#editor select[name="uid"]'), 'qa-student-2');
    await selectCustomOption(page, page.locator('dialog#editor select[name="classId"]'), 'class-8a');
    await page.locator('dialog#editor button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById('editor')?.open, {timeout: 4000});

    const linhRow = page.locator('#admin-subpanel-students tbody tr', {hasText: 'Trần Thảo Linh'});
    await linhRow.waitFor({state: 'visible'});
    assert.match(await linhRow.innerText(), /8A/);

    // Đổi lớp từ 8A sang 8B (xác nhận 8A tắt, 8B bật)
    await linhRow.getByRole('button', {name: 'Đổi lớp', exact: true}).click();
    await page.waitForSelector('dialog#editor[open]', {timeout: 3000});
    await selectCustomOption(page, page.locator('dialog#editor select[name="targetClassId"]'), 'class-8b');
    await page.locator('dialog#editor button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById('editor')?.open, {timeout: 4000});

    const linhAfterTransfer = await linhRow.innerText();
    assert.match(linhAfterTransfer, /8B/);
    assert.doesNotMatch(linhAfterTransfer, /8A/);

    // Ngừng học -> kiểm tra ở bộ lọc Đã nghỉ -> Cho học lại
    await linhRow.getByRole('button', {name: 'Ngừng học', exact: true}).click();
    await page.waitForSelector('dialog#editor[open]', {timeout: 3000});
    await page.locator('dialog#editor button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById('editor')?.open, {timeout: 4000});
    assert.equal(await linhRow.count(), 0);

    await selectCustomOption(page, page.locator('#admin-subpanel-students select[aria-label="Lọc trạng thái học sinh"]'), 'inactive');
    await linhRow.waitFor({state: 'visible'});
    assert.match(await linhRow.innerText(), /Đã nghỉ/);
    await linhRow.getByRole('button', {name: 'Cho học lại', exact: true}).click();
    await page.waitForSelector('dialog#editor[open]', {timeout: 3000});
    await selectCustomOption(page, page.locator('dialog#editor select[name="classId"]'), 'class-8b');
    await page.locator('dialog#editor button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById('editor')?.open, {timeout: 4000});

    await selectCustomOption(page, page.locator('#admin-subpanel-students select[aria-label="Lọc trạng thái học sinh"]'), 'active');
    await linhRow.waitFor({state: 'visible'});
    assert.match(await linhRow.innerText(), /8B/);
    await page.screenshot({path: path.join(outDir, '02-desktop-students-table.png')});

    // Luồng 2: Đội ngũ giảng dạy
    await page.getByRole('tab', {name: /Đội ngũ giảng dạy/}).click();
    await page.waitForSelector('#admin-subpanel-staff', {state: 'visible'});
    await assertCleanGeometry(page, 'desktop-staff');

    const dualStaffRow = page.locator('#admin-subpanel-staff tbody tr', {hasText: 'Trần Minh Đức'});
    await dualStaffRow.waitFor({state: 'visible'});
    const dualText = await dualStaffRow.innerText();
    assert.match(dualText, /Giáo viên/);
    assert.match(dualText, /Đang bật kèm Trợ giảng/);
    assert.equal(await dualStaffRow.getByRole('button', {name: 'Phân quyền', exact: true}).count(), 0);
    assert.equal(await dualStaffRow.getByRole('button', {name: 'Đổi vai trò', exact: true}).count(), 1);
    await page.screenshot({path: path.join(outDir, '03-desktop-staff.png')});

    // Kiểm tra nút Đổi vai trò nhảy đúng sang tab Tài khoản & Phân quyền và lọc sẵn người đó
    await dualStaffRow.getByRole('button', {name: 'Đổi vai trò', exact: true}).click();
    await page.waitForSelector('#admin-panel-accounts', {state: 'visible'});
    const visibleAccountRows = await page.locator('#admin-panel-accounts tbody tr:not([hidden])').count();
    assert.equal(visibleAccountRows, 1);
    const datAccountRow = page.locator('#admin-panel-accounts tbody tr:not([hidden])').first();
    assert.match(await datAccountRow.innerText(), /Trần Minh Đức/);

    // Giả lập đứt kết nối lần gửi đầu tiên khi bỏ vai trò Trợ giảng -> tự động thử lại, lưu thành công và giữ nguyên bộ lọc
    let interceptedPostCount = 0;
    const abortOnceHandler = async route => {
      if (route.request().method() === 'POST') {
        interceptedPostCount++;
        if (interceptedPostCount === 1) {
          await route.abort('failed');
          return;
        }
      }
      await route.continue();
    };
    await page.route('**/api/admin/accounts', abortOnceHandler);
    await datAccountRow.locator('label.check', {hasText: 'Trợ giảng'}).locator('input').uncheck();
    await datAccountRow.getByRole('button', {name: 'Lưu quyền', exact: true}).click();
    await page.waitForFunction(() => {
      const st = document.getElementById('status');
      return st && st.textContent && st.textContent.includes('Đã lưu vai trò và trạng thái tài khoản.');
    }, {timeout: 5000});
    await page.unroute('**/api/admin/accounts', abortOnceHandler);
    assert.equal(interceptedPostCount, 2, 'Idempotent POST should retry automatically once after transient network abort');
    assert.equal(await page.locator('#status.error').count(), 0, 'No red error toast should be visible after recovery');
    assert.equal(await page.locator('#admin-panel-accounts .account-search-input').inputValue(), 'dual-staff@ltch.test');
    const savedDatRow = page.locator('#admin-panel-accounts tbody tr:not([hidden])').first();
    assert.equal(await savedDatRow.locator('label.check', {hasText: 'Trợ giảng'}).locator('input').isChecked(), false);
    assert.equal(await savedDatRow.locator('label.check', {hasText: 'Giáo viên'}).locator('input').isChecked(), true);
    await page.screenshot({path: path.join(outDir, '07-account-role-saved.png')});

    // Quay lại Đội ngũ giảng dạy -> xác nhận hết nhắc Trợ giảng kiêm nhiệm -> Phân quyền Trợ giảng thử đồng loạt 7/7 quyền (1 request lô)
    await page.getByRole('tab', {name: /Phân công thành viên/}).click();
    await page.waitForSelector('#admin-subpanel-staff', {state: 'visible'});
    assert.doesNotMatch(await dualStaffRow.innerText(), /Đang bật kèm Trợ giảng/);
    const assistantRow = page.locator('#admin-subpanel-staff tbody tr', {hasText: 'Trợ giảng thử'});
    assert.match(await assistantRow.innerText(), /Tùy chỉnh riêng 1 lớp/);
    let batchMembershipPostCount = 0;
    const countBatchPosts = req => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/admin/memberships') batchMembershipPostCount++;
    };
    page.on('request', countBatchPosts);
    await assistantRow.getByRole('button', {name: 'Phân quyền', exact: true}).click();
    await page.waitForSelector('dialog#editor[open]', {timeout: 3000});
    await selectCustomOption(page, page.locator('dialog#editor select[name="scope"]'), '__all__');
    await page.locator('dialog#editor').getByRole('button', {name: /Chọn đủ 7 quyền/}).click();
    await page.locator('dialog#editor button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById('editor')?.open, {timeout: 4000});
    page.off('request', countBatchPosts);
    assert.equal(batchMembershipPostCount, 1, 'Bulk __all__ assistant grant should send 1 batch POST request');
    assert.match(await assistantRow.innerText(), /Đầy đủ 7\/7 quyền/);

    // Luồng 3: Liên kết phụ huynh (nhiều con + ngừng liên kết từng con)
    await page.getByRole('tab', {name: /Liên kết phụ huynh/}).click();
    await page.waitForSelector('#admin-subpanel-parents', {state: 'visible'});
    await assertCleanGeometry(page, 'desktop-parents');

    const parentRow = page.locator('#admin-subpanel-parents tbody tr', {hasText: 'Phụ huynh thử'});
    await parentRow.getByRole('button', {name: 'Thêm học sinh', exact: true}).click();
    await page.waitForSelector('dialog#editor[open]', {timeout: 3000});
    const parentOptions = await page.locator('dialog#editor select[name="parentUid"] option').allTextContents();
    assert.equal(parentOptions.some(t => /Quản trị viên|Cô Hạnh|Trần Minh Đức|Trợ giảng thử/.test(t)), false, 'Staff accounts must not appear in parent selector');
    const studentOptions = await page.locator('dialog#editor select[name="studentUid"] option').allTextContents();
    assert.equal(studentOptions.some(t => /Quản trị viên|Cô Hạnh|Trần Minh Đức|Trợ giảng thử/.test(t)), false, 'Staff accounts must not appear in student selector');
    assert.equal(studentOptions.some(t => t.includes('Học sinh thử')), false, 'Already linked child must be filtered out');
    await selectCustomOption(page, page.locator('dialog#editor select[name="studentUid"]'), 'qa-student-2');
    await page.locator('dialog#editor button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById('editor')?.open, {timeout: 4000});

    const parentRowText = await parentRow.innerText();
    assert.match(parentRowText, /Học sinh thử/);
    assert.match(parentRowText, /Trần Thảo Linh/);
    await page.screenshot({path: path.join(outDir, '04-desktop-parents.png')});

    // Ngừng liên kết riêng Trần Thảo Linh, giữ nguyên Học sinh thử
    const linhChildCard = parentRow.locator('.admin-linked-child-item', {hasText: 'Trần Thảo Linh'});
    await linhChildCard.getByRole('button', {name: 'Ngừng liên kết', exact: true}).click();
    await page.waitForSelector('dialog#editor[open]', {timeout: 3000});
    await page.locator('dialog#editor button[type="submit"]').click();
    await page.waitForFunction(() => !document.getElementById('editor')?.open, {timeout: 4000});

    assert.match(await parentRow.innerText(), /Học sinh thử/);
    assert.equal(await parentRow.locator('.admin-linked-child-item', {hasText: 'Trần Thảo Linh'}).count(), 0);

    // Chụp kiểm tra trên mobile 375x812
    await page.setViewportSize({width: 375, height: 812});
    await page.getByRole('tab', {name: /Học sinh theo lớp/}).click();
    await page.waitForTimeout(50);
    await assertCleanGeometry(page, 'mobile-students');
    await page.screenshot({path: path.join(outDir, '05-mobile-students.png'), fullPage: true});

    await page.getByRole('tab', {name: /Đội ngũ giảng dạy/}).click();
    await page.waitForTimeout(50);
    await assertCleanGeometry(page, 'mobile-staff');
    await page.screenshot({path: path.join(outDir, '06-mobile-staff.png'), fullPage: true});

    assert.deepEqual(apiErrors, [], 'API errors during admin memberships E2E');
    assert.deepEqual(pageErrors, [], 'Page errors during admin memberships E2E');
    console.log('PASS: Admin memberships E2E operational flows and geometry checks succeeded (screenshots saved to .local/admin-review/).');
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
