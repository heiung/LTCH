import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import templates from '../server/domain/notification-templates.cjs';
import { notifyClassStudentsOfNotice } from '../worker/notice-mail.mjs';
import { business } from '../worker/business.mjs';

const SECRET = 'x'.repeat(32);
const ENDPOINT = 'https://script.google.com/macros/s/notice-test/exec';

function createNoticeDb(overrides = {}) {
  const notices = [];
  const tables = {
    ltch_classes: [
      { id: 'class-12a', name: 'Lớp 12A', archived: false },
      { id: 'class-11a', name: 'Lớp 11A', archived: false }
    ],
    ltch_class_memberships: [
      { class_id: 'class-12a', uid: 'stu-1', member_role: 'student', status: 'active' },
      { class_id: 'class-12a', uid: 'stu-2', member_role: 'student', status: 'active' },
      { class_id: 'class-12a', uid: 'stu-dup', member_role: 'student', status: 'active' },
      { class_id: 'class-12a', uid: 'stu-disabled', member_role: 'student', status: 'active' },
      { class_id: 'class-12a', uid: 'stu-inactive-mem', member_role: 'student', status: 'inactive' },
      { class_id: 'class-12a', uid: 'teacher-1', member_role: 'teacher', status: 'active' },
      { class_id: 'class-11a', uid: 'stu-other-class', member_role: 'student', status: 'active' }
    ],
    ltch_accounts: [
      { uid: 'admin-1', display_name: 'Quản trị viên Hệ thống', email: 'admin@example.com', roles: ['admin', 'assistant'], status: 'active' },
      { uid: 'teacher-1', display_name: 'Cô Hạnh', email: 'teacher@example.invalid', roles: ['teacher'], status: 'active' },
      { uid: 'assistant-1', display_name: 'Trợ giảng Minh', email: 'assistant@example.invalid', roles: ['assistant'], status: 'active' },
      { uid: 'stu-1', display_name: 'Nguyễn Minh Quân', email: 'QUAN@example.invalid', roles: ['student'], status: 'active' },
      { uid: 'stu-2', display_name: 'Trần Thảo Linh <12A>', email: 'linh@example.invalid', roles: ['student'], status: 'active' },
      { uid: 'stu-dup', display_name: 'Nguyễn Minh Quân (Dup)', email: 'quan@example.invalid', roles: ['student'], status: 'active' },
      { uid: 'stu-disabled', display_name: 'Học sinh bị khóa', email: 'disabled@example.invalid', roles: ['student'], status: 'disabled' },
      { uid: 'stu-inactive-mem', display_name: 'Học sinh tạm nghỉ', email: 'inactive@example.invalid', roles: ['student'], status: 'active' },
      { uid: 'stu-other-class', display_name: 'Học sinh lớp 11A', email: 'other11a@example.invalid', roles: ['student'], status: 'active' }
    ],
    ltch_notices: notices,
    ...overrides
  };

  return {
    notices,
    from(table) {
      let rows = [...(tables[table] || [])];
      let single = false;
      const chain = {
        select() { return this; },
        eq(col, val) { rows = rows.filter(r => r[col] === val); return this; },
        in(col, vals) { rows = rows.filter(r => vals.includes(r[col])); return this; },
        maybeSingle() { single = true; return this; },
        insert(row) {
          (tables[table] || []).push(row);
          rows = [row];
          return this;
        },
        then(resolve, reject) {
          Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        }
      };
      return chain;
    }
  };
}

function createGasSimulator() {
  const propsStore = { LTCH_MAIL_SECRET: SECRET };
  const sent = [];
  const props = {
    getProperty: k => propsStore[k],
    setProperty: (k, v) => { propsStore[k] = v; },
    getProperties: () => ({ ...propsStore }),
    deleteProperty: k => { delete propsStore[k]; }
  };
  const context = {
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      computeHmacSha256Signature: (message, key, encoding) => [...createHmac('sha256', key).update(message, encoding).digest()]
    },
    MailApp: { sendEmail: mail => sent.push(mail) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: v => ({ setMimeType: () => v }) },
    console, Date, JSON, Number, Object
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('integrations/apps-script-otp/Code.gs', 'utf8'), context);
  return { context, sent };
}

test('class_notice template strips metadata prefix, renders safe HTML, and fits Apps Script gateway limits', () => {
  const longBody = `${'<script>alert(1)</script> '}Nội dung rất dài `.repeat(300);
  const mail = templates.renderNotification('class_notice', {
    student_name: 'Nguyễn Minh Quân',
    class_name: 'Lớp 12A',
    notice_title: 'Lịch học bù Chuyên đề Nguyên hàm – Tích phân rất quan trọng'.repeat(4),
    notice_body: `[[ltch-notice:cat=important|pin=1]]\n${longBody}`,
    sender_name: 'Cô Hạnh',
    posted_at: '19:10 16/11/2026'
  });

  assert.match(mail.subject, /^\[Lớp Toán cô Hạnh\] Thông báo mới Lớp 12A:/);
  assert.ok(mail.subject.length <= 250, `subject length=${mail.subject.length}`);
  assert.ok(mail.body.includes(longBody.trim()));
  assert.ok(mail.body.length <= 26000, `body length=${mail.body.length}`);
  assert.ok(mail.htmlBody.length <= 150000, `htmlBody length=${mail.htmlBody.length}`);
  assert.doesNotMatch(mail.body, /\[\[ltch-notice:/);
  assert.doesNotMatch(mail.htmlBody, /\[\[ltch-notice:/);
  assert.doesNotMatch(mail.htmlBody, /<script>/i);
  assert.ok(mail.body.includes('Ghim quan trọng · Quan trọng / Khẩn'));
  assert.ok(mail.htmlBody.includes('Ghim quan trọng · Quan trọng / Khẩn'));
  assert.ok(mail.htmlBody.includes('&lt;script&gt;'));
});

test('the mail gateway accepts the complete longest notice with HTML escaping', () => {
  const text = '&'.repeat(19960) + ' KẾT THÚC';
  const mail = templates.renderNotification('class_notice', {
    student_name: 'Minh', class_name: 'Lớp 6', notice_title: 'Thông báo', notice_body: text,
    sender_name: 'Cô Hạnh', posted_at: '16/11/2026'
  });
  assert.ok(mail.body.includes(text));
  assert.ok(mail.htmlBody.includes('&amp;'.repeat(19960) + ' KẾT THÚC'));
  const payload = JSON.stringify({ email:'student@example.invalid', eventId:'notice_long', ...mail });
  const timestamp = Date.now(), nonce = 'a'.repeat(32);
  const signature = createHmac('sha256', SECRET).update([timestamp, nonce, payload].join('\n')).digest('hex');
  const {context, sent} = createGasSimulator();
  const contents = JSON.stringify({kind:'notification', timestamp, nonce, payload, signature})
    .replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const result = JSON.parse(context.doPost({postData:{contents}}));
  assert.equal(result.ok, true);
  assert.equal(sent[0].body, mail.body);
  assert.equal(sent[0].htmlBody, mail.htmlBody);
});

test('notice email includes its scope, author, time, attachment names and class link', () => {
  const mail = templates.renderNotification('class_notice', {
    student_name: 'Minh', class_name: 'Lớp 6A', class_id: 'class-6a',
    notice_title: 'Lịch học mới', notice_body: '[[ltch-notice:cat=schedule|pin=1]]\nHọc bù vào thứ Bảy.\nMang theo vở.',
    sender_name: 'Cô Hạnh', posted_at: '20:00 16/11/2026',
    attachments: [{name: 'Lịch <mới>.png', type: 'image/png'}, {name: 'Bài giảng.mp4', type: 'video/mp4'}]
  });
  for (const value of ['Lớp 6A', 'Cô Hạnh', '20:00 16/11/2026', 'Lịch học mới', 'Học bù vào thứ Bảy.', 'Lịch <mới>.png', 'Bài giảng.mp4']) assert.ok(mail.body.includes(value));
  assert.ok(mail.htmlBody.includes('Lịch &lt;mới&gt;.png'));
  assert.ok(mail.htmlBody.includes('Bài giảng.mp4'));
  assert.ok(mail.htmlBody.includes('Học bù vào thứ Bảy.<br>Mang theo vở.'));
  assert.ok(mail.htmlBody.includes('https://ltch.example.com/class/class-6a/notifications'));
});

test('adding a class notice by admin, teacher, or authorized assistant delivers email to active class students via Code.gs', async t => {
  const actors = [
    { uid: 'admin-1', name: 'Quản trị viên Hệ thống', status: 'active', roles: ['admin'], memberships: [] },
    { uid: 'teacher-1', name: 'Cô Hạnh', status: 'active', roles: ['teacher'], memberships: [{ class_id: 'class-12a', member_role: 'teacher' }] },
    { uid: 'assistant-1', name: 'Trợ giảng Minh', status: 'active', roles: ['assistant'], memberships: [{ class_id: 'class-12a', member_role: 'assistant', permissions: ['notices.write'] }] }
  ];

  for (const actor of actors) {
    const db = createNoticeDb();
    const { context, sent } = createGasSimulator();
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, ENDPOINT);
      assert.match(options.body, /^[\x00-\x7f]*$/);
      const contents = Buffer.from(options.body, 'utf8').toString('latin1');
      return new Response(context.doPost({ postData: { contents } }), { headers: { 'content-type': 'application/json' } });
    });

    const req = new Request('https://ltch.example.com/api/classes/class-12a/notices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Lịch kiểm tra thử THPTQG tuần này',
        body: '[[ltch-notice:cat=exam|pin=1]]\nCác em xem lại chuyên đề Hàm số và có mặt đúng 18:00.'
      })
    });

    const res = await business(req, '/api/classes/class-12a/notices', {
      db,
      actor,
      env: { MAIL_ENDPOINT: ENDPOINT, MAIL_SECRET: SECRET }
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.notificationStatus, 'sent');
    assert.equal(body.notifiedCount, 2);
    assert.equal(db.notices.length, 1);
    assert.deepEqual(sent.map(m => m.to).sort(), ['linh@example.invalid', 'quan@example.invalid']);
    for (const msg of sent) {
      assert.match(msg.subject, /^\[Lớp Toán cô Hạnh\] Thông báo mới Lớp 12A:/);
      assert.doesNotMatch(msg.body, /\[\[ltch-notice:/);
      assert.doesNotMatch(msg.htmlBody, /\[\[ltch-notice:/);
      assert.ok(msg.htmlBody.includes('Kiểm tra &amp; Đánh giá'));
      assert.ok(msg.htmlBody.includes(actor.name));
    }
  }
});

test('assistants without notices.write cannot post notices, and mail failure never blocks saving notice', async () => {
  const db = createNoticeDb();
  const unauthorizedAssistant = {
    uid: 'assistant-1',
    status: 'active',
    roles: ['assistant'],
    memberships: [{ class_id: 'class-12a', member_role: 'assistant', permissions: ['attendance.write'] }]
  };
  await assert.rejects(
    business(
      new Request('https://ltch.example.com/api/classes/class-12a/notices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Test', body: 'Blocked' })
      }),
      '/api/classes/class-12a/notices',
      { db, actor: unauthorizedAssistant, env: {} }
    ),
    err => err.status === 403
  );

  const offlineResult = await notifyClassStudentsOfNotice({
    db,
    env: { MAIL_ENDPOINT: ENDPOINT, MAIL_SECRET: SECRET },
    classId: 'class-12a',
    noticeId: 'n-offline',
    title: 'Thông báo mất kết nối mail',
    body: 'Nội dung thử',
    actor: { uid: 'teacher-1', roles: ['teacher'] },
    fetchImpl: async () => { throw new Error('network error'); }
  });
  assert.equal(offlineResult.status, 'failed');
  assert.equal(offlineResult.sent, 0);
  assert.equal(offlineResult.total, 2);
});
