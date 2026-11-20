import test from 'node:test';
import assert from 'node:assert/strict';
import {notices, noticeMedia, createNoticeMediaTicket, cleanupExpiredNoticeDraft} from '../worker/notices.mjs';
import {business} from '../worker/business.mjs';
import {withNoticeReads} from '../worker/notice-queries.mjs';
import {decodeLegacyNoticeReads} from '../shared/notice-reads.mjs';

const env = {MAIL_SECRET: 's'.repeat(32), ALLOWED_ORIGIN: 'https://ltch.example.com', API_ORIGIN: 'https://api.ltch.example.com'};
const admin = {uid: 'admin', status: 'active', roles: ['admin'], memberships: [], childMemberships: []};
const teacher = {uid: 'teacher', status: 'active', roles: ['teacher'], memberships: [{class_id: 'class-a', member_role: 'teacher'}], childMemberships: []};
const student = {uid: 'student', status: 'active', roles: ['student'], memberships: [{class_id: 'class-a', member_role: 'student'}], childMemberships: []};
const otherStudent = {uid: 'other', status: 'active', roles: ['student'], memberships: [{class_id: 'class-b', member_role: 'student'}], childMemberships: []};

function fixture({missingReadsTable = false} = {}) {
  const tables = {
    ltch_notices: [], ltch_notice_files: [], ltch_notice_reads: [], ltch_drive_folders: [],
    ltch_classes: [{id: 'class-a', name: 'Lớp A', school_year_id: 'year-a', archived: false}],
    ltch_school_years: [{id: 'year-a', name: 'Năm học'}],
    ltch_accounts: [student, otherStudent].map(actor => ({...actor, display_name: actor.uid, email: `${actor.uid}@example.invalid`})),
    ltch_class_memberships: [...student.memberships.map(row => ({...row, uid: student.uid, status: 'active'})),
      ...otherStudent.memberships.map(row => ({...row, uid: otherStudent.uid, status: 'active'}))],
    ltch_parent_links: [],
    ltch_assignments: [],
    ltch_exams: [],
    ltch_attendance: [],
    ltch_messages: [],
    ltch_submissions: [],
    ltch_practice_attempts: []
  };
  const db = {
    from(table) {
      let filters = [], action = 'select', values;
      const missingTableError = missingReadsTable && table === 'ltch_notice_reads'
        ? {code: '42P01', message: 'relation "public.ltch_notice_reads" does not exist'}
        : null;
      const filtered = () => (tables[table] || []).filter(row => filters.every(fn => fn(row)));
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, vals) { filters.push(row => vals.includes(row[key])); return query; },
        contains(key, vals) {
          filters.push(row => Array.isArray(row[key]) && vals.every(v => row[key].includes(v)));
          return query;
        },
        or(expr) {
          const m = /^scope\.eq\.all,class_id\.eq\.(.+)$/.exec(expr);
          if (m) {
            filters.push(row => row.scope === 'all' || row.class_id === m[1]);
          }
          return query;
        },
        order() { return query; },
        limit() { return query; },
        maybeSingle() {
          if (missingTableError) return Promise.resolve({data: null, error: missingTableError});
          return Promise.resolve({data: filtered()[0] || null, error: null});
        },
        upsert(row, opts = {}) {
          if (missingTableError) return Promise.resolve({data: null, error: missingTableError});
          if (table === 'ltch_notice_reads') {
            const exists = tables.ltch_notice_reads.some(
              existing => existing.notice_id === row.notice_id && existing.uid === row.uid
            );
            if (!exists) {
              tables.ltch_notice_reads.push({...row});
            } else if (!opts.ignoreDuplicates) {
              const target = tables.ltch_notice_reads.find(
                existing => existing.notice_id === row.notice_id && existing.uid === row.uid
              );
              Object.assign(target, row);
            }
            return Promise.resolve({data: null, error: null});
          }
          const key = table === 'ltch_drive_folders' ? 'folder_key' : 'id';
          if (!tables[table].some(existing => existing[key] === row[key])) tables[table].push({...row});
          return Promise.resolve({data: null, error: null});
        },
        update(row) { action = 'update'; values = row; return query; },
        delete() { action = 'delete'; return query; },
        then(resolve, reject) {
          if (missingTableError) return Promise.resolve({data: null, error: missingTableError}).then(resolve, reject);
          let rows = filtered();
          if (action === 'update') rows.forEach(row => Object.assign(row, values));
          if (action === 'delete') tables[table] = tables[table].filter(row => !rows.includes(row));
          return Promise.resolve({data: rows, error: null}).then(resolve, reject);
        }
      };
      return query;
    },
    async rpc(name, args) {
      if (name === 'ltch_reserve_notice_file') {
        let file = tables.ltch_notice_files.find(row => row.notice_id === args.p_notice_id && row.request_id === args.p_request_id);
        if (!file) {
          file = {id: args.p_id, notice_id: args.p_notice_id, request_id: args.p_request_id, drive_file_id: args.p_drive_id,
            parent_folder_id: args.p_parent_id, name: args.p_name, content_type: args.p_content_type, file_size: args.p_file_size,
            sha256: args.p_sha256, created_by: args.p_actor_uid, status: 'pending'};
          tables.ltch_notice_files.push(file);
        }
        return {data: file, error: null};
      }
      if (name === 'ltch_finish_notice_file') {
        if (tables.failFinishOnce) {
          tables.failFinishOnce = false;
          return {data: null, error: {code: '50000', message: 'temporary'}};
        }
        const file = tables.ltch_notice_files.find(row => row.id === args.p_file_id && row.notice_id === args.p_notice_id);
        if (file) file.status = 'stored';
        return {data: Boolean(file), error: null};
      }
      if (name === 'ltch_publish_notice') {
        const notice = tables.ltch_notices.find(row => row.id === args.p_notice_id);
        notice.status = 'published';
        return {data: 1, error: null};
      }
      if (name === 'ltch_claim_expired_notice_draft') return {data: tables.cleanupId || null, error: null};
      if (name === 'ltch_finish_notice_draft_cleanup') return {data: true, error: null};
      throw Error(`Unexpected RPC ${name}`);
    }
  };
  let counter = 0;
  const metadata = new Map(), uploads = new Map(), trashed = [];
  const drive = {
    async rootId() {return 'root';},
    async reserveId() {return `drive_${++counter}`;},
    async isRootChild() {return true;},
    async createFolder({id, parentId, name}) {
      metadata.set(id, {id, name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId], trashed: false, shared: false, ownedByMe: true});
    },
    async metadata({id}) {
      if (!metadata.has(id)) throw Object.assign(Error('missing'), {code: 'not_found'});
      return metadata.get(id);
    },
    async startResumableUpload(input) {
      const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${input.id}`;
      uploads.set(url, {...input, offset: 0, done: false});
      return url;
    },
    async uploadResumableChunk({sessionUrl, bytes, offset}) {
      const upload = uploads.get(sessionUrl);
      assert.ok(upload);
      if (upload.done) return {state: 'uploaded', id: upload.id, offset: upload.total};
      if (!bytes) return {state: 'uploading', offset: upload.offset};
      assert.equal(offset, upload.offset);
      assert.equal(bytes.length, Math.min(8 * 1024 * 1024, upload.total - offset));
      upload.offset += bytes.length;
      if (upload.offset < upload.total) return {state: 'uploading', offset: upload.offset};
      upload.done = true;
      metadata.set(upload.id, {id: upload.id, name: upload.name, mimeType: upload.contentType, parents: [upload.parentId],
        size: String(upload.total), trashed: false, shared: false, ownedByMe: true, appProperties: {ltchSha256: upload.sha256}});
      return {state: 'uploaded', id: upload.id, offset: upload.total};
    },
    async download({range}) {
      const bytes = Buffer.from('0123456789');
      if (!range) return new Response(bytes, {headers: {'content-length': String(bytes.length)}});
      const start = Number(/^bytes=(\d+)-/.exec(range)[1]);
      return new Response(bytes.subarray(start), {status: 206, headers: {'content-length': String(bytes.length - start), 'content-range': `bytes ${start}-9/10`}});
    },
    async trash({id}) {trashed.push(id); metadata.get(id).trashed = true;}
  };
  return {db, env, tables, drive, metadata, trashed, openDrive: async () => drive};
}

function post(path, body) {
  return new Request(`https://api.ltch.example.com${path}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
}

test('class notice uploads private Drive media, publishes and rechecks authorization for every view', async () => {
  const f = fixture(), args = {db: f.db, env, actor: teacher, openDrive: f.openDrive};
  const noticeId = 'notice_123456789012345';
  const draft = {id: noticeId, scope: 'class', classId: 'class-a', title: 'Thông báo lớp', body: 'Nội dung', expectedFiles: 1};
  assert.equal((await notices(post('/api/notices/drafts', draft), '/api/notices/drafts', args)).status, 201);
  await assert.rejects(notices(post('/api/notices/drafts', {...draft, id: 'notice_987654321012345', classId: 'class-b'}), '/api/notices/drafts', args), error => error.status === 403);
  const startPath = `/api/notices/${noticeId}/files`;
  const start = await notices(post(startPath, {requestId: 'request_123456789012345', name: 'anh.png', contentType: 'image/png', size: 10, sha256: 'a'.repeat(64)}), startPath, args);
  const upload = await start.json();
  assert.equal(start.status, 201);
  const stored = f.tables.ltch_notice_files[0];
  assert.equal(f.metadata.get(stored.parent_folder_id).name, 'Thông báo');
  const chunkPath = `${startPath}/${upload.id}/chunks`;
  const chunk = new Request(`https://api.ltch.example.com${chunkPath}?offset=0&uploadToken=${encodeURIComponent(upload.uploadToken)}`, {
    method: 'POST', headers: {'content-type': 'application/octet-stream'}, body: Buffer.from('0123456789')
  });
  assert.equal((await (await notices(chunk, chunkPath, args)).json()).state, 'uploaded');
  assert.equal(stored.status, 'stored');
  assert.equal(f.metadata.get(stored.drive_file_id).shared, false);
  const publishPath = `/api/notices/${noticeId}/publish`;
  assert.equal((await (await notices(post(publishPath, {}), publishPath, args)).json()).notificationStatus, 'queued');
  const ticketPath = `${startPath}/${upload.id}/ticket`;
  const ticketResponse = await notices(new Request(`https://api.ltch.example.com${ticketPath}`), ticketPath, {...args, actor: student});
  const ticketUrl = (await ticketResponse.json()).url;
  const response = await noticeMedia(new Request(ticketUrl, {headers: {range: 'bytes=2-'}}), f);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 2-9/10');
  assert.equal(await response.text(), '23456789');
  const suffix = await noticeMedia(new Request(ticketUrl, {headers: {range: 'bytes=-3'}}), f);
  assert.equal(suffix.headers.get('content-range'), 'bytes 7-9/10');
  assert.equal(await suffix.text(), '789');
  const head = await noticeMedia(new Request(ticketUrl, {method: 'HEAD'}), f);
  assert.equal(head.headers.get('content-length'), '10');
  await assert.rejects(noticeMedia(new Request(ticketUrl, {headers: {range: 'bytes=7-2'}}), f), error => error.status === 416);
  await assert.rejects(notices(new Request(`https://api.ltch.example.com${ticketPath}`), ticketPath, {...args, actor: otherStudent}), error => error.status === 403);
  const forbidden = createNoticeMediaTicket(env, {uid: otherStudent.uid, noticeId, fileId: upload.id});
  await assert.rejects(noticeMedia(new Request(`https://api.ltch.example.com/api/notice-media?ticket=${forbidden}`), f), error => error.status === 403);
  f.tables.ltch_class_memberships = f.tables.ltch_class_memberships.filter(row => row.uid !== student.uid);
  await assert.rejects(noticeMedia(new Request(ticketUrl), f), error => error.status === 403);
});

test('a multi-chunk upload can recover when the final database confirmation is interrupted', async () => {
  const f = fixture(), args = {db: f.db, env, actor: teacher, openDrive: f.openDrive};
  const noticeId = 'notice_retry_1234567890';
  await notices(post('/api/notices/drafts', {id: noticeId, scope: 'class', classId: 'class-a', title: 'Video', body: 'Nội dung', expectedFiles: 1}), '/api/notices/drafts', args);
  const path = `/api/notices/${noticeId}/files`, size = 8 * 1024 * 1024 + 1;
  const upload = await (await notices(post(path, {requestId: 'request_retry_12345678', name: 'video.mp4', contentType: 'video/mp4', size, sha256: 'c'.repeat(64)}), path, args)).json();
  const chunkPath = `${path}/${upload.id}/chunks`, token = encodeURIComponent(upload.uploadToken);
  const first = new Request(`https://api.ltch.example.com${chunkPath}?offset=0&uploadToken=${token}`, {method: 'POST', body: new Uint8Array(8 * 1024 * 1024)});
  assert.equal((await (await notices(first, chunkPath, args)).json()).offset, 8 * 1024 * 1024);
  f.tables.failFinishOnce = true;
  const last = new Request(`https://api.ltch.example.com${chunkPath}?offset=${size - 1}&uploadToken=${token}`, {method: 'POST', body: new Uint8Array(1)});
  await assert.rejects(notices(last, chunkPath, args), error => error.status === 503);
  const status = new Request(`https://api.ltch.example.com${chunkPath}?status=1&uploadToken=${token}`, {method: 'POST'});
  assert.equal((await (await notices(status, chunkPath, args)).json()).state, 'uploaded');
  assert.equal(f.tables.ltch_notice_files[0].status, 'stored');
});

test('global announcements use the shared folder, reject unauthorized staff and clean up stale drafts', async () => {
  const f = fixture(), args = {db: f.db, env, actor: admin, openDrive: f.openDrive};
  const draft = {id: 'notice_global_123456789', scope: 'all', title: 'Thông báo chung', body: 'Nội dung', expectedFiles: 1};
  await assert.rejects(notices(post('/api/notices/drafts', draft), '/api/notices/drafts', {...args, actor: student}), error => error.status === 403);
  const assistant = {uid: 'assistant', status: 'active', roles: ['assistant'], memberships: [{class_id: 'class-a', member_role: 'assistant', permissions: []}]};
  await assert.rejects(notices(post('/api/notices/drafts', draft), '/api/notices/drafts', {...args, actor: assistant}), error => error.status === 403);
  const authorizedAssistant = {...assistant, memberships: [{class_id: 'class-a', member_role: 'assistant', permissions: ['notices.write']}]};
  const assistantDraft = {...draft, id: 'notice_assistant_1234567', expectedFiles: 0};
  assert.equal((await notices(post('/api/notices/drafts', assistantDraft), '/api/notices/drafts', {...args, actor: authorizedAssistant})).status, 201);
  await notices(post('/api/notices/drafts', draft), '/api/notices/drafts', args);
  const path = `/api/notices/${draft.id}/files`;
  const result = await notices(post(path, {requestId: 'request_123456789012345', name: 'video.mp4', contentType: 'video/mp4', size: 10, sha256: 'b'.repeat(64)}), path, args);
  const upload = await result.json(), file = f.tables.ltch_notice_files[0];
  assert.equal(f.metadata.get(file.parent_folder_id).name, 'Thông báo chung');
  const chunkPath = `${path}/${upload.id}/chunks`;
  await notices(new Request(`https://api.ltch.example.com${chunkPath}?offset=0&uploadToken=${upload.uploadToken}`, {method: 'POST', body: Buffer.from('0123456789')}), chunkPath, args);
  f.tables.cleanupId = draft.id;
  assert.equal(await cleanupExpiredNoticeDraft(f), true);
  assert.deepEqual(f.trashed, [file.drive_file_id]);
  assert.equal(f.tables.ltch_notice_files.length, 0);
});

test('published global media is available to active students in other classes', async () => {
  const f = fixture(), args = {db: f.db, env, actor: admin, openDrive: f.openDrive};
  const noticeId = 'notice_global_read_12345';
  await notices(post('/api/notices/drafts', {id: noticeId, scope: 'all', title: 'Chung', body: 'Nội dung', expectedFiles: 1}), '/api/notices/drafts', args);
  const path = `/api/notices/${noticeId}/files`;
  const upload = await (await notices(post(path, {requestId: 'request_global_read_12345', name: 'video.mp4', contentType: 'video/mp4', size: 10, sha256: 'd'.repeat(64)}), path, args)).json();
  const chunkPath = `${path}/${upload.id}/chunks`;
  await notices(new Request(`https://api.ltch.example.com${chunkPath}?offset=0&uploadToken=${upload.uploadToken}`, {method: 'POST', body: Buffer.from('0123456789')}), chunkPath, args);
  const publish = `/api/notices/${noticeId}/publish`;
  await notices(post(publish, {}), publish, args);
  const ticketPath = `${path}/${upload.id}/ticket`;
  const ticket = await (await notices(new Request(`https://api.ltch.example.com${ticketPath}`), ticketPath, {...args, actor: otherStudent})).json();
  const media = await noticeMedia(new Request(ticket.url), f);
  assert.equal(media.headers.get('content-type'), 'video/mp4');
  assert.equal(await media.text(), '0123456789');
});

test('POST /read and GET /reads track student, parent, and staff confirmations cleanly', async () => {
  const f = fixture();
  const student2 = {uid: 'stu2', status: 'active', roles: ['student'], memberships: [{class_id: 'class-a', member_role: 'student'}], childMemberships: []};
  const parent = {uid: 'parent1', status: 'active', roles: ['parent'], memberships: [], childMemberships: [{class_id: 'class-a', uid: student.uid}]};
  const assistant = {uid: 'asst1', status: 'active', roles: ['assistant'], memberships: [{class_id: 'class-a', member_role: 'assistant', permissions: []}], childMemberships: []};

  f.tables.ltch_accounts.push(
    {uid: admin.uid, display_name: 'Cô Hạnh', status: 'active', roles: ['admin']},
    {uid: teacher.uid, display_name: 'Thầy Nam', status: 'active', roles: ['teacher']},
    {uid: student2.uid, display_name: 'An Nguyễn', status: 'active', roles: ['student'], student_code: '2026001'},
    {uid: parent.uid, display_name: 'Phụ huynh Minh', status: 'active', roles: ['parent']},
    {uid: assistant.uid, display_name: 'Trợ giảng Lan', status: 'active', roles: ['assistant']}
  );
  f.tables.ltch_accounts.find(a => a.uid === student.uid).display_name = 'Bình Trần';
  f.tables.ltch_accounts.find(a => a.uid === student.uid).student_code = '2026002';
  f.tables.ltch_class_memberships.push(
    {class_id: 'class-a', uid: student2.uid, member_role: 'student', status: 'active'},
    {class_id: 'class-a', uid: teacher.uid, member_role: 'teacher', status: 'active'},
    {class_id: 'class-a', uid: assistant.uid, member_role: 'assistant', status: 'active'}
  );
  f.tables.ltch_parent_links.push({parent_uid: parent.uid, student_uid: student.uid, status: 'active'});

  const noticeId = 'notice_read_class_1';
  f.tables.ltch_notices.push(
    {id: noticeId, scope: 'class', class_id: 'class-a', status: 'published', title: 'Lịch học tuần', body: '[[ltch-notice:cat=schedule|pin=1]]\nHọc lúc 18h', created_by: teacher.uid, created_at: 1000},
    {id: 'notice_read_draft_1', scope: 'class', class_id: 'class-a', status: 'draft', title: 'Nháp', body: 'Nháp', created_by: teacher.uid, created_at: 1000},
    {id: 'notice_read_global_1', scope: 'all', class_id: null, status: 'published', title: 'Chung', body: 'Thông báo chung', created_by: admin.uid, created_at: 2000}
  );

  // Student marks class notice read (idempotent)
  const res1 = await notices(post(`/api/notices/${noticeId}/read`, {}), `/api/notices/${noticeId}/read`, {db: f.db, env, actor: student});
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.ok, true);
  assert.equal(body1.seen, true);
  assert.ok(Number.isSafeInteger(body1.seenAt) && body1.seenAt > 0);

  const resRepeat = await notices(post(`/api/notices/${noticeId}/read`, {}), `/api/notices/${noticeId}/read`, {db: f.db, env, actor: student});
  const bodyRepeat = await resRepeat.json();
  assert.equal(bodyRepeat.seenAt, body1.seenAt);

  // Linked parent marks read; other class student gets 403; draft gets 404
  assert.equal((await notices(post(`/api/notices/${noticeId}/read`, {}), `/api/notices/${noticeId}/read`, {db: f.db, env, actor: parent})).status, 200);
  await assert.rejects(
    notices(post(`/api/notices/${noticeId}/read`, {}), `/api/notices/${noticeId}/read`, {db: f.db, env, actor: otherStudent}),
    err => err.status === 403
  );
  await assert.rejects(
    notices(post('/api/notices/notice_read_draft_1/read', {}), '/api/notices/notice_read_draft_1/read', {db: f.db, env, actor: student}),
    err => err.status === 404
  );

  // Global notice is readable by student in another class
  assert.equal(
    (await notices(post('/api/notices/notice_read_global_1/read', {}), '/api/notices/notice_read_global_1/read', {db: f.db, env, actor: otherStudent})).status,
    200
  );

  // Student and parent cannot inspect read receipts
  await assert.rejects(
    notices(new Request(`https://api.ltch.example.com/api/notices/${noticeId}/reads`), `/api/notices/${noticeId}/reads`, {db: f.db, env, actor: student}),
    err => err.status === 403
  );
  await assert.rejects(
    notices(new Request(`https://api.ltch.example.com/api/notices/${noticeId}/reads`), `/api/notices/${noticeId}/reads`, {db: f.db, env, actor: parent}),
    err => err.status === 403
  );

  // Teacher, Admin, and Assistant can inspect read receipts
  for (const staffActor of [teacher, admin, assistant]) {
    const readsRes = await notices(
      new Request(`https://api.ltch.example.com/api/notices/${noticeId}/reads?classId=class-a`),
      `/api/notices/${noticeId}/reads`,
      {db: f.db, env, actor: staffActor}
    );
    assert.equal(readsRes.status, 200);
    const report = await readsRes.json();
    assert.deepEqual(report.summary, {
      total_seen: 2,
      student_seen: 1,
      total_students: 2,
      parent_seen: 1,
      other_seen: 0
    });
    assert.equal(report.seen.length, 2);
    const parentEntry = report.seen.find(r => r.uid === parent.uid);
    assert.equal(parentEntry.role, 'parent');
    assert.deepEqual(parentEntry.childNames, ['Bình Trần']);
    const stuEntry = report.seen.find(r => r.uid === student.uid);
    assert.equal(stuEntry.studentCode, '2026002');
    assert.deepEqual(report.unseenStudents.map(u => u.uid), [student2.uid]);
  }

  // Workspace API populates viewer_seen_at for everyone and read_summary ONLY for staff
  const stuWorkspace = await (await business(new Request('https://api.ltch.example.com/api/classes/class-a/workspace'), '/api/classes/class-a/workspace', {db: f.db, env, actor: student})).json();
  const stuNotice = stuWorkspace.notices.find(n => n.id === noticeId);
  assert.equal(stuNotice.viewer_seen_at, body1.seenAt);
  assert.equal(Object.hasOwn(stuNotice, 'read_summary'), false);

  const staffWorkspace = await (await business(new Request('https://api.ltch.example.com/api/classes/class-a/workspace'), '/api/classes/class-a/workspace', {db: f.db, env, actor: teacher})).json();
  const staffNotice = staffWorkspace.notices.find(n => n.id === noticeId);
  assert.equal(staffNotice.viewer_seen_at, null);
  assert.deepEqual(staffNotice.read_summary, {
    total_seen: 2,
    student_seen: 1,
    total_students: 2,
    parent_seen: 1,
    other_seen: 0
  });
});

test('fallback mode works via CAS when ltch_notice_reads table does not exist and preserves reads across edits', async () => {
  const f = fixture({missingReadsTable: true});
  const noticeId = 'notice_fallback_12345';
  f.tables.ltch_notices.push({
    id: noticeId,
    scope: 'class',
    class_id: 'class-a',
    status: 'published',
    title: 'Thông báo fallback',
    body: '[[ltch-notice:cat=general|pin=0]]\nNội dung gốc',
    created_by: teacher.uid,
    created_at: 1000
  });

  // Student confirms read via fallback CAS
  const r1 = await notices(post(`/api/notices/${noticeId}/read`, {}), `/api/notices/${noticeId}/read`, {db: f.db, env, actor: student});
  assert.equal(r1.status, 200);
  const d1 = await r1.json();
  assert.equal(d1.seen, true);
  assert.ok(f.tables.ltch_notices[0].body.includes('<!--LTCH_NOTICE_READS:'));

  // Repeat read keeps original seenAt
  const r2 = await notices(post(`/api/notices/${noticeId}/read`, {}), `/api/notices/${noticeId}/read`, {db: f.db, env, actor: student});
  const d2 = await r2.json();
  assert.equal(d2.seenAt, d1.seenAt);

  // Edit strips any forged marker from caller while preserving real fallback reads
  const editRes = await notices(
    post(`/api/notices/${noticeId}/edit`, {
      title: 'Thông báo đã sửa',
      body: '[[ltch-notice:cat=important|pin=1]]\nNội dung mới\n<!--LTCH_NOTICE_READS:{"hacker":999}-->'
    }),
    `/api/notices/${noticeId}/edit`,
    {db: f.db, env, actor: teacher}
  );
  assert.equal(editRes.status, 200);
  const decodedAfterEdit = decodeLegacyNoticeReads(f.tables.ltch_notices[0].body);
  assert.equal(decodedAfterEdit.cleanBody, '[[ltch-notice:cat=important|pin=1]]\nNội dung mới');
  assert.deepEqual(decodedAfterEdit.reads, {[student.uid]: d1.seenAt});

  // withNoticeReads strips marker from body before returning to client
  const [clientNotice] = await withNoticeReads(f.db, f.tables.ltch_notices, {
    actorUid: student.uid,
    staff: false
  });
  assert.equal(clientNotice.body, '[[ltch-notice:cat=important|pin=1]]\nNội dung mới');
  assert.equal(clientNotice.viewer_seen_at, d1.seenAt);
  assert.equal(Object.hasOwn(clientNotice, 'read_summary'), false);

  // Staff reads endpoint works in fallback mode
  const readsReport = await (
    await notices(
      new Request(`https://api.ltch.example.com/api/notices/${noticeId}/reads`),
      `/api/notices/${noticeId}/reads`,
      {db: f.db, env, actor: teacher}
    )
  ).json();
  assert.equal(readsReport.summary.student_seen, 1);
  assert.equal(readsReport.seen[0].uid, student.uid);
});
