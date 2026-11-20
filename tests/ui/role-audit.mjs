import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import launchChromium from './chromium.cjs';
import {roles, roleActor, primaryClassId} from '../fixtures/role-audit.mjs';

const origin = 'http://127.0.0.1:5181';
const classUrl = '/class/2020';
const outDir = path.resolve('.local/role-audit', new Date().toISOString().replace(/[:.]/g, '-'));
const results = [];

async function startFixture() {
  const child = spawn(process.execPath, ['tests/ui/server.mjs'], {env: {...process.env, LTCH_ROLE_AUDIT: '1'}, stdio: ['ignore', 'pipe', 'pipe']});
  let log = '';
  child.stderr.on('data', chunk => { log += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Máy chủ kiểm thử không khởi động sau 20 giây.')), 20_000);
      const settle = callback => value => { clearTimeout(timeout); callback(value); };
      child.once('error', settle(reject));
      child.once('exit', settle(() => reject(Error(`Máy chủ kiểm thử đã dừng: ${log.trim()}`))));
      child.stdout.on('data', chunk => {
        if (String(chunk).includes('Local UI QA ready')) settle(resolve)();
      });
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  return child;
}

async function runBackendTests() {
  const file = 'backend.tap';
  const specs = (await readdir('tests')).filter(name => /\.test\.(?:cjs|mjs)$/.test(name)).map(name => `tests/${name}`);
  const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...specs], {stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  await writeFile(path.join(outDir, file), output);
  const count = key => Number(new RegExp(`^# ${key} (\\d+)$`, 'm').exec(output)?.[1] || 0);
  return {status: code === 0 && count('tests') > 0 ? 'pass' : 'fail', tests: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), log: file};
}

async function roleContext(browser, actor, viewport) {
  const role = actor.roles[0];
  const staff = ['admin', 'teacher', 'assistant'].includes(role);
  const canManage = ['admin', 'teacher'].includes(role);
  const context = await browser.newContext({viewport, hasTouch: viewport.width <= 768, reducedMotion: 'reduce', serviceWorkers: 'block'});
  await context.addInitScript(({origin, uid}) => {
    if (location.origin !== origin) return;
    sessionStorage.setItem('ltch.test.roleAuditUid', uid);
    localStorage.setItem('ltch.auth.v1', JSON.stringify({uid, session: {token: 'q'.repeat(43), expiresAt: Date.now() + 3_600_000}}));
  }, {origin, uid: actor.uid});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort('blockedbyclient');
    const endpoint = url.pathname;
    const workspace = /^\/api\/classes\/[^/]+\/workspace$/.test(endpoint);
    const examSol = /^\/api\/practice\/exams\/[^/]+\/solutions$/.test(endpoint);
    if (!workspace && !examSol && !['/api/bootstrap', '/api/me', '/api/profile', '/api/practice/rooms'].includes(endpoint)) return route.continue();
    const response = await route.fetch({maxRedirects: 0});
    if (!response.ok()) return route.fulfill({response});
    const body = await response.json();
    if (workspace) {
      body.viewerContext = actor;
      body.permissions = {schedule: canManage, notices: canManage, materials: canManage, assignments: canManage,
        practice: canManage, attendance: staff, messages: canManage || role === 'student', student: role === 'student'};
      body.attendance = [
        {student_uid: 'audit-student', class_id: primaryClassId, lesson_date: '2026-09-08', status: 'present', note: 'QA-OWN-RECORD'},
        {student_uid: 'audit-unlinked', class_id: primaryClassId, lesson_date: '2026-09-09', status: 'absent', note: 'QA-UNLINKED-RECORD'}
      ];
    } else if (examSol) {
      if (body?.exam) body.exam.canManage = canManage;
    } else if (endpoint === '/api/bootstrap') body.me = actor;
    else if (endpoint === '/api/me') return route.fulfill({response, json: actor});
    else if (endpoint === '/api/profile') {
      Object.assign(body, {
        display_name: actor.name,
        roles: actor.roles,
        student_code: role === 'student' ? 'LTCH001' : null,
        own_student_code: role === 'student' ? 'LTCH001' : null,
        enrollment: (role === 'student' || role === 'parent') ? body.enrollment : null,
        linked_students: role === 'parent'
          ? [{uid: 'audit-student', display_name: 'Học sinh kiểm thử', student_code: 'LTCH001', class_ids: [primaryClassId]}]
          : [],
        linked_parents: role === 'student'
          ? [{uid: 'audit-parent', display_name: 'Phụ huynh kiểm thử', contact_phone: '0987654321', email: 'ph@example.test'}]
          : []
      });
    } else Object.assign(body.access, {isStaff: staff, canManageAny: canManage});
    return route.fulfill({response, json: body});
  });
  return context;
}

async function auditRole(browser, role, viewport) {
  const actor = roleActor(role);
  const staff = ['admin', 'teacher', 'assistant'].includes(role);
  const canManage = ['admin', 'teacher'].includes(role);
  const context = await roleContext(browser, actor, viewport);
  const page = await context.newPage();
  page.setDefaultTimeout(4500);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith('/api/') && response.status() >= 400) {
      errors.push(`${response.request().method()} ${url.pathname} → ${response.status()}`);
    }
  });
  const visit = async (url, ready) => {
    await page.goto(origin + url, {waitUntil: 'domcontentloaded'});
    await page.locator(ready).first().waitFor({state: 'visible'});
  };
  const classTab = (route, tab) => visit(`${classUrl}/${route}`, `#class-body.is-tab-${tab}`);
  const seeButton = async (name, expected) => {
    const button = page.getByRole('button', {name, exact: true}).first();
    if (expected) await button.waitFor({state: 'visible'});
    else assert.equal(await button.isVisible(), false, `Vai trò không được hiển thị nút ${name}`);
  };
  const check = async (id, title, action) => {
    errors.length = 0;
    const result = {role, viewport: viewport.width, id, title};
    try {
      await action();
      assert.deepEqual(errors, [], 'Lỗi trình duyệt/API giả lập');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, 'Trang tràn ngang');
      results.push({...result, status: 'pass'});
    } catch (error) {
      let screenshot;
      const filename = `${role}-${viewport.width}-${id}.png`;
      try {
        await page.screenshot({path: path.join(outDir, filename), timeout: 2000});
        screenshot = filename;
      } catch {}
      results.push({...result, status: 'fail', detail: error.message.split('\n').slice(0, 10).join('\n'), errors: [...errors], screenshot});
    }
  };
  try {
    await check('home', 'Tổng quan và danh tính', async () => {
      await visit('/overview', '#workspace:not([hidden]) .welcome-card');
    });
    await check('settings', 'Trang tài khoản cá nhân và các mục liên quan', async () => {
      await visit('/settings', '.account-hero');
      const panelText = await page.locator('#account-tab-panel').innerText();
      if (role === 'student') {
        assert.equal(await page.locator('.account-linked-list').count(), 1, 'Học sinh chỉ hiển thị 1 danh sách liên kết');
        assert.match(panelText, /Liên kết phụ huynh/);
        assert.doesNotMatch(panelText, /Học sinh đang theo dõi/);
      } else if (role === 'parent') {
        assert.equal(await page.locator('.account-linked-list').count(), 1, 'Phụ huynh chỉ hiển thị 1 danh sách liên kết');
        assert.match(panelText, /Học sinh đang theo dõi/);
        assert.doesNotMatch(panelText, /Liên kết phụ huynh/);
        assert.equal(await page.locator('.account-hero-chip.is-code').count(), 0, 'Phụ huynh không hiển thị mã HS riêng trên hero');
      } else {
        assert.equal(await page.locator('.account-linked-list').count(), 0, `${role} không hiển thị thẻ liên kết phụ huynh/học sinh`);
        assert.equal(await page.locator('.account-enrollment-summary').count(), 0, `${role} không hiển thị hồ sơ nhập học học sinh`);
        assert.equal(await page.locator('.account-hero-chip.is-code').count(), 0, `${role} không hiển thị mã HS trên hero`);
      }
      await page.getByRole('tab', {name: 'Bảo mật & Đăng nhập'}).click();
      await page.locator('.account-provider-list').waitFor({state: 'visible'});
      await page.getByRole('tab', {name: 'Quyền dữ liệu & Hỗ trợ'}).click();
      await page.locator('.account-sla-grid').waitFor({state: 'visible'});
      await page.getByRole('tab', {name: 'Hồ sơ & Liên hệ'}).click();
      await page.locator('#account-input-name').waitFor({state: 'visible'});
    });
    await check('classes', 'Danh sách lớp hoặc mở thẳng lớp', async () => {
      await visit('/class', staff ? '.class-grid .class-card' : '#class-body.is-tab-notices');
      if (staff) {
        const cards = await page.locator('.class-card').count();
        assert.ok(role === 'admin' ? cards > 2 : cards === 2, `Số lớp hiển thị: ${cards}`);
      } else assert.equal(new URL(page.url()).pathname, classUrl);
    });
    await check('admin', 'Điều hướng quản trị đúng vai trò', async () => {
      await visit('/admin', role === 'admin' ? '#content h1' : '#content .welcome-card');
      assert.equal(new URL(page.url()).pathname, role === 'admin' ? '/admin' : '/overview');
      if (role === 'admin') assert.equal(await page.locator('#content h1').textContent(), 'Quản trị hệ thống');
    });
    await check('notices', 'Thông báo và quyền đăng', async () => {
      await classTab('notifications', 'notices');
      await seeButton('Đăng thông báo mới', canManage);
    });
    await check('materials', 'Danh mục bài giảng', async () => {
      await classTab('materials', 'materials');
      await page.locator('#class-body .session-grid-card').first().waitFor();
    });
    await check('assignments', 'Danh mục bài tập', async () => {
      await classTab('assignments', 'assignments');
      await page.locator('#class-body .session-grid-card').first().waitFor();
    });
    await check('attendance', 'Điểm danh và phạm vi học sinh', async () => {
      await classTab('attendance', 'attendance');
      await seeButton('Lưu bảng điểm danh', staff);
      await seeButton('Ghi điểm danh buổi học', false);
      if (!staff) {
        assert.doesNotMatch(await page.locator('#class-body').innerText(), /QA-UNLINKED-RECORD/);
        assert.match(await page.locator('#class-body').innerText(), /QA-OWN-RECORD/);
      }
    });
    await check('forum', 'Diễn đàn và quyền đặt câu hỏi', async () => {
      await visit(`${classUrl}/forum`, role === 'parent' ? '#class-body.is-tab-notices' : '#class-body .forum-toolbar');
      await seeButton('Đặt câu hỏi', canManage || role === 'student');
    });
    if (role === 'parent') {
      await check('practice-denied', 'Phụ huynh mở đường dẫn phòng luyện', async () => {
        await visit('/practice', '#content .welcome-card');
        assert.equal(new URL(page.url()).pathname, '/overview');
      });
    } else {
      for (const type of ['thptqg', 'hsa', 'tsa']) await check(type, `Sảnh ${type.toUpperCase()} và quyền đăng đề`, async () => {
        const heading = '.ltch-active-room-header h2';
        await visit(`/practice/${type}`, heading);
        assert.match(await page.locator(heading).innerText(), new RegExp(type, 'i'));
        const upload = page.getByRole('button', {name: /Đăng tải đề Word/}).first();
        if (canManage) await upload.waitFor();
        else assert.equal(await upload.isVisible(), false);
      });
      await check('thptqg-solution', 'Trang chữa đề và quyền tải bài chữa', async () => {
        await visit('/practice/thptqg', '.ltch-active-room-header h2');
        await page.getByRole('button', {name: 'Xem chữa đề', exact: true}).first().click();
        await page.locator('.session-dedicated-page .session-mode-choices').waitFor();
        assert.match(new URL(page.url()).pathname, /^\/practice\/thptqg\/[^/]+$/);
        await seeButton('Quản lý bài chữa', canManage);
        if (canManage) {
          await page.getByRole('button', {name: 'Quản lý bài chữa', exact: true}).first().click();
          await page.getByRole('menuitem', {name: 'Tải Video chữa', exact: true}).waitFor({state: 'visible'});
          await page.getByRole('menuitem', {name: 'Tải File tài liệu', exact: true}).waitFor({state: 'visible'});
          await page.keyboard.press('Escape');
        } else {
          await seeButton('Tải Video chữa', false);
          await seeButton('Tải File tài liệu', false);
        }
      });
    }
    if (role === 'student') {
      for (const type of ['thptqg', 'hsa', 'tsa']) await check(`${type}-answer`, `Học sinh vào ${type.toUpperCase()} và chọn đáp án`, async () => {
        await visit(`/practice/${type}`, '.ltch-active-room-header h2');
        await page.getByRole('button', {name: 'Làm đề', exact: true}).first().click();
        if (type !== 'thptqg') await page.getByRole('button', {name: 'Làm phần này', exact: true}).first().click();
        const answer = page.locator('#ltch-practice-fullscreen-root .ltch-option-row').first();
        await answer.click();
        assert.equal(await answer.getAttribute('aria-pressed'), 'true');
      });
    }
    if (role !== 'admin') await check('outside-class', 'Từ chối đường dẫn lớp ngoài phạm vi', async () => {
      await visit('/class/2026/materials', staff ? '.class-grid' : '#class-body.is-tab-notices');
      assert.doesNotMatch(new URL(page.url()).pathname, /^\/class\/2026(?:\/|$)/);
    });
  } finally {
    await context.close();
  }
}

await mkdir(outDir, {recursive: true});
const backendRun = runBackendTests().catch(error => ({status: 'blocked', detail: error.message}));
let fixture, browser, setupFailure;
try {
  fixture = await startFixture();
  browser = await launchChromium();
  for (const viewport of [{width: 375, height: 812}, {width: 1280, height: 900}]) {
    for (const role of Object.keys(roles)) {
      await auditRole(browser, role, viewport);
      const cases = results.filter(item => item.role === role && item.viewport === viewport.width);
      console.log(`${roles[role]} · ${viewport.width}px: ${cases.filter(item => item.status === 'pass').length}/${cases.length}`);
    }
  }
} catch (error) {
  setupFailure = error.message;
} finally {
  await browser?.close();
  fixture?.kill();
}

const backend = await backendRun;
const failed = results.filter(result => result.status === 'fail');
const gaps = ['Firebase/OTP, Google Drive, email và cơ sở dữ liệu cloud thật', 'Thi và nộp đề trọn lượt, đóng năm học, tệp dung lượng lớn và thiết bị thật'];
const report = {backend, passed: results.length - failed.length, failed: failed.length, setupFailure, results, gaps};
await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const roleRows = Object.keys(roles).map(role => {
  const cases = results.filter(item => item.role === role);
  return `| ${roles[role]} | ${cases.filter(item => item.status === 'pass').length} | ${cases.filter(item => item.status === 'fail').length} |`;
});
await writeFile(path.join(outDir, 'report.md'), [
  '# Kiểm thử nội bộ theo vai trò', '',
  `- Backend: ${backend.status} · ${backend.passed ?? 0}/${backend.tests ?? 0} đạt. Xem [nhật ký](${backend.log ?? 'report.json'}).`,
  `- Giao diện: ${report.passed} đạt · ${failed.length} lỗi.`,
  ...(setupFailure ? [`- Thiết lập chưa hoàn thành: ${setupFailure.split('\n')[0]}`] : []), '',
  '| Vai trò | Đạt | Lỗi |', '| --- | ---: | ---: |', ...roleRows, '',
  ...failed.flatMap(item => [
    `- ${roles[item.role]} · ${item.viewport}px · ${item.title} — ${item.detail.split('\n')[0]}`,
    ...(item.screenshot ? [`  [Ảnh lúc lỗi](${item.screenshot})`] : [])
  ]), '',
  '## Phạm vi cần kiểm thử riêng', '', ...gaps.map(item => `- ${item}`), ''
].join('\n'));
console.log(`UI ${report.passed} đạt / ${report.failed} lỗi · Backend ${backend.passed ?? 0}/${backend.tests ?? 0}\n${path.join(outDir, 'report.md')}`);
if (setupFailure) console.error(setupFailure.split('\n')[0]);
if (failed.length || setupFailure || backend.status !== 'pass') process.exitCode = 1;
