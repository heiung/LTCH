import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  buildAppRoutePath,
  parseAppRoutePath,
  parsePracticeSubPage
} from '../shared/classroom.mjs';
import { business } from '../worker/business.mjs';
import { clearPracticeDriveCaches, stagePracticeDriveAssets } from '../worker/practice-drive.mjs';
import { practiceSolutions } from '../worker/practice-solutions.mjs';

const TEST_ENV = {
  LTCH_LESSONS_ENABLED: '1',
  LTCH_LESSONS_AUDIENCE: 'all',
  LTCH_DRIVE_LINK_PREVIEW: '1',
  GOOGLE_DRIVE_CLIENT_ID: 'test-only-drive-client-id',
  GOOGLE_DRIVE_CLIENT_SECRET: 'test-only-drive-client-secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'test-only-drive-refresh-token',
  MAIL_SECRET: 'practice-solutions-test-secret-key-32-chars-minimum',
  ALLOWED_ORIGIN: 'https://ltch.example.com'
};

function createDb(seed = {}) {
  const tables = {
    ltch_school_years: seed.years || [
      { id: 'year-2026-2027', name: 'Năm học 2026 - 2027', starts_on: '2026-08-01', ends_on: '2027-06-30' }
    ],
    ltch_classes: seed.classes || [
      { id: 'class-12a1', name: 'Lớp 12', grade: 12, school_year_id: 'year-2026-2027', archived: false, schedule_slots: [] },
      { id: 'class-10a1', name: 'Lớp 10', grade: 10, school_year_id: 'year-2026-2027', archived: false, schedule_slots: [] }
    ],
    ltch_lessons: seed.lessons || [],
    ltch_lesson_files: seed.lessonFiles || [],
    ltch_practice_solutions: seed.practiceSolutions || [],
    ltch_practice_solution_files: seed.practiceSolutionFiles || [],
    ltch_drive_folders: seed.driveFolders || [],
    ltch_exams: seed.exams || [],
    ltch_exam_year_shares: seed.examYearShares || [],
    ltch_student_grade_history: seed.gradeHistory || [],
    ltch_practice_attempts: [],
    ltch_question_bank: [],
    ltch_question_versions: [],
    ltch_exam_questions: [],
    ltch_question_reports: [],
    ltch_question_imports: [],
    ltch_legacy_question_codes: [],
    ltch_class_memberships: [],
    ltch_accounts: [],
    ltch_materials: [],
    ltch_assignments: [],
    ltch_attendance: [],
    ltch_messages: [],
    ltch_notices: [],
    ltch_submissions: [],
    ltch_parent_links: []
  };

  const likeToRegex = (pattern) => {
    const escaped = String(pattern || '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
    return new RegExp(`^${escaped}$`);
  };

  return {
    tables,
    async rpc() {
      return { data: null, error: { code: 'PGRST202', message: 'not implemented in mock' } };
    },
    from(table) {
      const filters = [];
      let op = 'select';
      let payload = null;
      let opts = {};
      const orderCfgList = [];
      let limitCount = null;
      let columns = null;
      let single = false;

      const applyFilters = () => (tables[table] || []).filter((row) => filters.every((fn) => fn(row)));

      const q = {
        select(cols) {
          columns = cols;
          return q;
        },
        eq(col, val) {
          filters.push((row) => row[col] === val);
          return q;
        },
        in(col, vals) {
          const set = new Set(vals || []);
          filters.push((row) => set.has(row[col]));
          return q;
        },
        not(col, operator, val) {
          if (operator === 'like') {
            const re = likeToRegex(val);
            filters.push((row) => !re.test(String(row[col] ?? '')));
          } else {
            filters.push((row) => row[col] !== val);
          }
          return q;
        },
        order(col, cfg = {}) {
          orderCfgList.push({ col, ascending: cfg.ascending !== false });
          return q;
        },
        limit(n) {
          limitCount = n;
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        insert(rows) {
          op = 'insert';
          payload = rows;
          return q;
        },
        upsert(rows, o = {}) {
          op = 'upsert';
          payload = rows;
          opts = o;
          return q;
        },
        update(values) {
          op = 'update';
          payload = values;
          return q;
        },
        delete() {
          op = 'delete';
          return q;
        },
        then(resolve, reject) {
          try {
            const rows = tables[table] || (tables[table] = []);
            if (op === 'select') {
              let result = applyFilters();
              if (orderCfgList.length) {
                result = [...result].sort((a, b) => {
                  for (const { col, ascending } of orderCfgList) {
                    const av = a[col] ?? 0;
                    const bv = b[col] ?? 0;
                    if (av === bv) continue;
                    return ascending ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
                  }
                  return 0;
                });
              }
              if (Number.isInteger(limitCount)) result = result.slice(0, limitCount);
              if (single) return Promise.resolve({ data: result[0] || null, error: null }).then(resolve, reject);
              return Promise.resolve({ data: result.map((r) => ({ ...r })), error: null }).then(resolve, reject);
            }
            if (op === 'insert') {
              const list = Array.isArray(payload) ? payload : [payload];
              rows.push(...list.map((r) => ({ ...r })));
              return Promise.resolve({ data: list, error: null }).then(resolve, reject);
            }
            if (op === 'upsert') {
              const list = Array.isArray(payload) ? payload : [payload];
              const keys = String(opts.onConflict || 'id').split(',').map((k) => k.trim());
              for (const item of list) {
                const idx = rows.findIndex((r) => keys.every((k) => r[k] === item[k]));
                if (idx >= 0) {
                  if (!opts.ignoreDuplicates) rows[idx] = { ...rows[idx], ...item };
                } else {
                  rows.push({ ...item });
                }
              }
              return Promise.resolve({ data: list, error: null }).then(resolve, reject);
            }
            if (op === 'update') {
              const updated = [];
              for (let i = 0; i < rows.length; i++) {
                if (filters.every((fn) => fn(rows[i]))) {
                  rows[i] = { ...rows[i], ...payload };
                  updated.push(rows[i]);
                }
              }
              return Promise.resolve({ data: updated, error: null }).then(resolve, reject);
            }
            if (op === 'delete') {
              const removed = rows.filter((r) => filters.every((fn) => fn(r)));
              tables[table] = rows.filter((r) => !filters.every((fn) => fn(r)));
              return Promise.resolve({ data: columns ? removed : [], error: null }).then(resolve, reject);
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          } catch (err) {
            return Promise.reject(err).then(resolve, reject);
          }
        }
      };
      return q;
    }
  };
}

function createDriveMock() {
  const objects = new Map();
  let seq = 0;
  let moves = 0;
  const drive = {
    rootId: async () => 'root',
    reserveIds: async (count) => Array.from({ length: count }, () => `drv_${++seq}`),
    reserveId: async () => `drv_${++seq}`,
    isRootChild: async ({ id, name }) => objects.get(id)?.name === name && objects.get(id)?.parents?.[0] === 'root',
    metadata: async ({ id }) => {
      if (!objects.has(id)) {
        const err = Error('not found');
        err.code = 'not_found';
        throw err;
      }
      return objects.get(id);
    },
    createFolder: async ({ id, parentId, name }) => {
      if (objects.has(id)) {
        const err = Error('conflict');
        err.code = 'conflict';
        throw err;
      }
      objects.set(id, {
        id,
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
        shared: false,
        ownedByMe: true,
        trashed: false
      });
      return id;
    },
    moveFile: async ({ id, addParentId, removeParentId }) => {
      const obj = objects.get(id);
      assert.ok(obj, `Expected file ${id} to exist`);
      const nextParents = (obj.parents || []).filter((p) => p !== removeParentId);
      if (!nextParents.includes(addParentId)) nextParents.push(addParentId);
      obj.parents = nextParents;
      moves += 1;
      return id;
    },
    listFolderChildren: async ({ parentId }) => {
      return [...objects.values()].filter(
        (obj) => obj && obj.trashed !== true && Array.isArray(obj.parents) && obj.parents.includes(parentId)
      );
    },
    upload: async ({ id, parentId, name, contentType, bytes, sha256 }) => {
      objects.set(id, {
        id,
        name,
        mimeType: contentType,
        parents: [parentId],
        size: String(bytes.byteLength),
        appProperties: { ltchSha256: sha256 },
        shared: false,
        ownedByMe: true,
        trashed: false,
        bytes
      });
      return id;
    },
    startResumableUpload: async ({ id, parentId, name, contentType, total, sha256 }) => {
      objects.set(`sess:${id}`, { id, parentId, name, contentType, total, sha256, offset: 0, chunks: [] });
      return `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock_${id}`;
    },
    uploadResumableChunk: async ({ sessionUrl, total, id, offset = 0, bytes = null }) => {
      const sess = objects.get(`sess:${id}`);
      assert.ok(sess && sessionUrl.includes(`mock_${id}`));
      if (!bytes) {
        return sess.offset >= total ? { state: 'uploaded', id, offset: total } : { state: 'uploading', offset: sess.offset };
      }
      assert.equal(offset, sess.offset);
      sess.chunks.push(bytes);
      sess.offset += bytes.byteLength;
      if (sess.offset < total) return { state: 'uploading', offset: sess.offset };
      const merged = new Uint8Array(total);
      let pos = 0;
      for (const c of sess.chunks) {
        merged.set(c, pos);
        pos += c.byteLength;
      }
      objects.set(id, {
        id,
        name: sess.name,
        mimeType: sess.contentType,
        parents: [sess.parentId],
        size: String(total),
        appProperties: { ltchSha256: sess.sha256, ltchSize: String(total) },
        shared: false,
        ownedByMe: true,
        trashed: false,
        bytes: merged
      });
      return { state: 'uploaded', id, offset: total };
    },
    download: async ({ id }) => new Response(objects.get(id).bytes),
    permissions: async ({ id }) => [
      { type: 'user', role: 'owner' },
      ...(objects.get(id)?.shared ? [{ type: 'anyone', role: 'reader', allowFileDiscovery: false }] : [])
    ],
    shareWithLink: async ({ id }) => {
      objects.get(id).shared = true;
    },
    trash: async ({ id }) => {
      if (objects.has(id)) objects.get(id).trashed = true;
    }
  };
  return { drive, objects, stats: () => ({ moves }) };
}

const adminActor = { uid: 'u-admin', status: 'active', roles: ['admin'], memberships: [], childMemberships: [] };
const teacherActor = { uid: 'u-teacher', status: 'active', roles: ['teacher'], memberships: [{ class_id: 'class-12a1', member_role: 'teacher', permissions: [] }], childMemberships: [] };
const assistantPracticeActor = { uid: 'u-asst-p', status: 'active', roles: ['assistant'], memberships: [{ class_id: 'class-12a1', member_role: 'assistant', permissions: ['practice.manage'] }], childMemberships: [] };
const assistantLimitedActor = { uid: 'u-asst-0', status: 'active', roles: ['assistant'], memberships: [{ class_id: 'class-12a1', member_role: 'assistant', permissions: ['attendance.write'] }], childMemberships: [] };
const student12Actor = { uid: 'u-stu12', status: 'active', roles: ['student'], memberships: [{ class_id: 'class-12a1', member_role: 'student', permissions: [] }], childMemberships: [] };
const student10Actor = { uid: 'u-stu10', status: 'active', roles: ['student'], memberships: [{ class_id: 'class-10a1', member_role: 'student', permissions: [] }], childMemberships: [] };
const parentActor = { uid: 'u-par', status: 'active', roles: ['parent'], memberships: [], childMemberships: [{ class_id: 'class-12a1', uid: 'u-stu12' }] };

test('Shared classroom helpers parse & build exam-linked practice solution URLs preserving examId case', () => {
  assert.deepEqual(parsePracticeSubPage('hsa'), { examType: 'hsa', examId: null, isSolutionPage: false });
  assert.deepEqual(parsePracticeSubPage('thptqg/exam_thptqg_AbC123'), {
    examType: 'thptqg',
    examId: 'exam_thptqg_AbC123',
    isSolutionPage: true
  });

  const standaloneRoute = parseAppRoutePath('/practice/thptqg/exam_thptqg_AbC123');
  assert.equal(standaloneRoute.page, 'practice');
  assert.equal(standaloneRoute.subPage, 'thptqg/exam_thptqg_AbC123');
  assert.equal(
    buildAppRoutePath({ nav: 'practice', subPage: standaloneRoute.subPage }),
    '/practice/thptqg/exam_thptqg_AbC123'
  );

  const class12 = { id: 'class-12a1', name: 'Lớp 12', school_year_id: 'year-2026-2027' };
  const classRoute = parseAppRoutePath('/class/2020/practice/tsa/exam_tsa_MixedCase_9');
  assert.equal(classRoute.page, 'classes');
  assert.equal(classRoute.classSlug, '2020');
  assert.equal(classRoute.classTab, 'practice');
  assert.equal(classRoute.subPage, 'tsa/exam_tsa_MixedCase_9');
  assert.equal(
    buildAppRoutePath({ nav: 'classes', klass: class12, allClasses: [class12], classTab: 'practice', subPage: classRoute.subPage }),
    '/class/2020/practice/tsa/exam_tsa_MixedCase_9'
  );
});

test('Unified per-exam Drive folder stores File đề, Video chữa, File tài liệu, preserves 64-bit video sizes & relocates legacy source files', async () => {
  clearPracticeDriveCaches();
  const mock = createDriveMock();
  const openDrive = async () => mock.drive;
  const examId = 'exam_thptqg_AbC123';

  // Seed legacy source .docx directly inside examFolderId as earlier versions did
  const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  const docxSha = createHash('sha256').update(docxBytes).digest('hex');

  const db = createDb({
    exams: [
      {
        id: examId,
        class_id: null,
        title: '[LTCH] Đề thi thử THPTQG số 01',
        status: 'published',
        exam_type: 'thptqg',
        exam_code: '01',
        target_grade: 12,
        school_year_id: 'year-2026-2027',
        duration_minutes: 90,
        questions: [
          {
            id: 'q1',
            section: 'part_1',
            type: 'single',
            answer: 'A',
            points: 0.25,
            _examMeta: {
              examType: 'thptqg',
              examCode: '01',
              targetGrade: 12,
              schoolYearId: 'year-2026-2027',
              storage: 'drive',
              sourceFiles: [
                {
                  name: 'De-thi-thu-01.docx',
                  driveFileId: 'drv_legacy_src_1',
                  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  size: docxBytes.byteLength,
                  sha256: docxSha
                }
              ]
            }
          }
        ],
        created_by: teacherActor.uid,
        opens_at: 1000,
        updated_at: 2000
      }
    ]
  });

  // Stage a new PDF source via stagePracticeDriveAssets -> must go directly into File đề subfolder
  const pdfSrcBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  const staged = await stagePracticeDriveAssets({
    db,
    env: TEST_ENV,
    openDrive,
    examId,
    examType: 'thptqg',
    title: '[LTCH] Đề thi thử THPTQG số 01',
    assets: [
      {
        key: 'src_new',
        kind: 'source',
        name: 'De-thi-thu-01-ban-in.pdf',
        mimeType: 'application/pdf',
        dataBase64: Buffer.from(pdfSrcBytes).toString('base64')
      }
    ]
  });
  const stagedSrcMeta = mock.objects.get(staged.assets[0].driveFileId);
  assert.equal(stagedSrcMeta.parents[0], staged.sourceFolderId);

  const examFolderId = db.tables.ltch_drive_folders.find((f) => f.folder_key === `practice:exam:${examId}`)?.drive_folder_id;
  const sourceFolderId = db.tables.ltch_drive_folders.find((f) => f.folder_key === `practice:source:${examId}`)?.drive_folder_id;
  assert.ok(examFolderId && sourceFolderId);

  // Place the legacy .docx inside examFolderId before solution upload triggers relocation
  await mock.drive.upload({
    id: 'drv_legacy_src_1',
    parentId: examFolderId,
    name: 'De-thi-thu-01.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: docxBytes,
    sha256: docxSha
  });

  const endpoint = `/api/practice/exams/${examId}/solutions`;
  const filesPath = `${endpoint}/files`;

  // Legacy lessons upload rejected for psol-*
  await assert.rejects(
    () =>
      business(
        new Request('https://ltch.test/api/classes/class-12a1/lessons/psol-class-12a1-01/files', { method: 'POST' }),
        '/api/classes/class-12a1/lessons/psol-class-12a1-01/files',
        { db, actor: adminActor, env: TEST_ENV, openDrive }
      ),
    (err) => err?.status === 400
  );

  // RBAC: grade 10 student cannot access grade 12 THPTQG exam; parent cannot access practice rooms; limited assistant cannot write
  await assert.rejects(
    () => business(new Request(`https://ltch.test${endpoint}`), endpoint, { db, actor: student10Actor, env: TEST_ENV, openDrive }),
    (err) => err?.status === 403
  );
  await assert.rejects(
    () => business(new Request(`https://ltch.test${endpoint}`), endpoint, { db, actor: parentActor, env: TEST_ENV, openDrive }),
    (err) => err?.status === 403
  );
  await assert.rejects(
    () =>
      business(
        new Request(`https://ltch.test${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'update_meta', topic: 'Blocked' }) }),
        endpoint,
        { db, actor: student12Actor, env: TEST_ENV, openDrive }
      ),
    (err) => err?.status === 403
  );
  await assert.rejects(
    () =>
      business(
        new Request(`https://ltch.test${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'update_meta', topic: 'Blocked' }) }),
        endpoint,
        { db, actor: assistantLimitedActor, env: TEST_ENV, openDrive }
      ),
    (err) => err?.status === 403
  );

  // Student 12 reads initial payload cleanly
  const stu12Read = await business(new Request(`https://ltch.test${endpoint}`), endpoint, { db, actor: student12Actor, env: TEST_ENV, openDrive });
  assert.equal(stu12Read.status, 200);
  const readJson = await stu12Read.json();
  assert.equal(readJson.exam.canManage, false);
  assert.equal(readJson.solution.examFiles.length, 1);

  // Legacy source download succeeds cleanly via /solutions/source/:driveFileId
  const srcDlRes = await business(
    new Request(`https://ltch.test${endpoint}/source/drv_legacy_src_1`),
    `${endpoint}/source/drv_legacy_src_1`,
    { db, actor: student12Actor, env: TEST_ENV, openDrive }
  );
  assert.equal(srcDlRes.status, 200);
  assert.deepEqual(new Uint8Array(await srcDlRes.arrayBuffer()), docxBytes);

  // Multipart upload of "Phao LTTDTT.pdf" -> stored in "File tài liệu" AND triggers relocation of legacy .docx into "File đề"
  const pdfBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  const fd = new FormData();
  fd.set('requestId', 'req-pdf-exam-solution-01');
  fd.set('fileKind', 'document');
  fd.set('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'Phao LTTDTT.pdf');

  const upPdfRes = await business(
    new Request(`https://ltch.test${filesPath}`, { method: 'POST', body: fd }),
    filesPath,
    { db, actor: assistantPracticeActor, env: TEST_ENV, openDrive }
  );
  assert.equal(upPdfRes.status, 201);
  const upPdfJson = await upPdfRes.json();
  assert.equal(upPdfJson.fileKind, 'document');
  assert.ok(mock.stats().moves >= 1, 'Legacy .docx must be relocated into File đề subfolder');
  assert.deepEqual(mock.objects.get('drv_legacy_src_1').parents, [sourceFolderId]);

  // Direct-to-Drive large video (691 MB = 724774184 bytes) -> stored in "Video chữa" + ?status=1 finalization after closed session
  const largeSize = 724_774_184;
  const sha256 = 'a'.repeat(64);
  const startVidRes = await practiceSolutions(
    new Request(`https://ltch.test${filesPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://ltch.example.com' },
      body: JSON.stringify({
        mode: 'resumable',
        fileKind: 'video',
        name: 'Test bài chữa.mp4',
        contentType: 'video/mp4',
        size: largeSize,
        sha256,
        requestId: 'req-video-exam-solution-724mb'
      })
    }),
    filesPath,
    { db, actor: teacherActor, env: TEST_ENV, openDrive }
  );
  assert.equal(startVidRes.status, 201);
  const startVidJson = await startVidRes.json();
  const vidDbRecord = db.tables.ltch_practice_solution_files.find((f) => f.id === startVidJson.id);
  assert.equal(Number(vidDbRecord.file_size), largeSize);
  assert.equal(vidDbRecord.file_kind, 'video');

  const videoFolderId = db.tables.ltch_drive_folders.find((f) => f.folder_key === `practice:sol-video:${examId}`)?.drive_folder_id;
  const docFolderId = db.tables.ltch_drive_folders.find((f) => f.folder_key === `practice:sol-doc:${examId}`)?.drive_folder_id;
  const mediaFolderId = db.tables.ltch_drive_folders.find((f) => f.folder_key === `practice:media:${examId}`)?.drive_folder_id;
  assert.ok(videoFolderId && docFolderId && mediaFolderId);

  // Simulate Drive closing upload session upon final direct browser PUT
  mock.objects.set(vidDbRecord.drive_file_id, {
    id: vidDbRecord.drive_file_id,
    name: 'Test bài chữa.mp4',
    mimeType: 'video/mp4',
    parents: [videoFolderId],
    size: String(largeSize),
    appProperties: { ltchSha256: sha256, ltchSize: String(largeSize) },
    shared: false,
    ownedByMe: true,
    trashed: false
  });
  mock.objects.delete(`sess:${vidDbRecord.drive_file_id}`);

  const finRes = await practiceSolutions(
    new Request(`https://ltch.test${filesPath}/${vidDbRecord.id}/chunks?status=1&uploadToken=${encodeURIComponent(startVidJson.uploadToken)}`, {
      method: 'POST'
    }),
    `${filesPath}/${vidDbRecord.id}/chunks`,
    { db, actor: teacherActor, env: TEST_ENV, openDrive }
  );
  assert.equal(finRes.status, 200);
  assert.equal((await finRes.json()).state, 'uploaded');

  // Verify unified Drive folder hierarchy under shared examFolderId
  const solDocRow = db.tables.ltch_practice_solution_files.find((f) => f.id === upPdfJson.id);
  assert.equal(solDocRow.parent_folder_id, docFolderId);
  assert.equal(vidDbRecord.parent_folder_id, videoFolderId);
  assert.equal(mock.objects.get(sourceFolderId).parents[0], examFolderId);
  assert.equal(mock.objects.get(sourceFolderId).name, 'File đề');
  assert.equal(mock.objects.get(videoFolderId).parents[0], examFolderId);
  assert.equal(mock.objects.get(videoFolderId).name, 'Video chữa');
  assert.equal(mock.objects.get(docFolderId).parents[0], examFolderId);
  assert.equal(mock.objects.get(docFolderId).name, 'File tài liệu');
  assert.equal(mock.objects.get(mediaFolderId).parents[0], examFolderId);
  assert.equal(mock.objects.get(mediaFolderId).name, 'Hình minh họa');

  // Verify 0 rows leaked into lessons tables
  assert.equal(db.tables.ltch_lessons.length, 0);
  assert.equal(db.tables.ltch_lesson_files.length, 0);

  // Verify /api/practice/rooms exposes solutionVideoCount, solutionDocCount & hasSolution
  const roomsRes = await business(
    new Request('https://ltch.test/api/practice/rooms'),
    '/api/practice/rooms',
    { db, actor: student12Actor, env: TEST_ENV, openDrive }
  );
  assert.equal(roomsRes.status, 200);
  const roomsJson = await roomsRes.json();
  assert.equal(roomsJson.exams[0].solutionVideoCount, 1);
  assert.equal(roomsJson.exams[0].solutionDocCount, 1);
  assert.equal(roomsJson.exams[0].hasSolution, true);

  // Download PDF & preview Video + delete_file
  const pdfDl = await business(new Request(`https://ltch.test${filesPath}/${upPdfJson.id}`), `${filesPath}/${upPdfJson.id}`, { db, actor: student12Actor, env: TEST_ENV, openDrive });
  assert.equal(pdfDl.status, 200);
  assert.deepEqual(new Uint8Array(await pdfDl.arrayBuffer()), pdfBytes);

  const vidPreview = await business(new Request(`https://ltch.test${filesPath}/${vidDbRecord.id}/preview`), `${filesPath}/${vidDbRecord.id}/preview`, { db, actor: student12Actor, env: TEST_ENV, openDrive });
  assert.equal(vidPreview.status, 200);
  assert.match((await vidPreview.json()).url, /^https:\/\/drive\.google\.com\/file\/d\/drv_\d+\/preview$/);

  const delRes = await business(
    new Request(`https://ltch.test${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete_file', fileId: vidDbRecord.id }) }),
    endpoint,
    { db, actor: adminActor, env: TEST_ENV, openDrive }
  );
  assert.equal(delRes.status, 200);
  assert.equal((await delRes.json()).solution.videos.length, 0);
  assert.equal(mock.objects.get(vidDbRecord.drive_file_id).trashed, true);
});

test('PostgreSQL migration 202611180029 enforces exam FK cascade, 64-bit video size, RLS & archived class safety', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create role anon; create role authenticated; create role service_role;');
    for (const name of (await readdir('supabase/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
      await pg.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
    }

    const rlsCheck = (await pg.query(
      "select relname, relrowsecurity, has_table_privilege('anon', oid, 'SELECT') as anon_sel from pg_class where relnamespace='public'::regnamespace and relname in ('ltch_practice_solutions','ltch_practice_solution_files') order by relname"
    )).rows;
    assert.deepEqual(
      rlsCheck,
      [
        { relname: 'ltch_practice_solution_files', relrowsecurity: true, anon_sel: false },
        { relname: 'ltch_practice_solutions', relrowsecurity: true, anon_sel: false }
      ]
    );

    await pg.exec(`
      insert into public.ltch_school_years(id, name, starts_on, ends_on) values ('y1', '2026-2027', '2026-08-01', '2027-06-30');
      insert into public.ltch_classes(id, school_year_id, name, archived) values ('c_arch', 'y1', 'Lớp 12', true);
      insert into public.ltch_accounts(uid, display_name, email, status, roles) values ('u_adm', 'Admin', 'admin@example.com', 'active', array['admin']);
      insert into public.ltch_exams(id, class_id, title, status, opens_at, closes_at, questions, created_by, exam_type)
        values ('exam_thptqg_keep', 'c_arch', 'THPTQG 01', 'published', 1000, 2000, '[]'::jsonb, 'u_adm', 'thptqg'),
               ('exam_class_only', 'c_arch', 'Class Exam', 'published', 1000, 2000, '[{"id":"q1","type":"single","prompt":"1+1","options":["A","B"],"answer":"A"}]'::jsonb, 'u_adm', 'class');
      insert into public.ltch_practice_solutions(exam_id, topic, solution_date, updated_by, created_at, updated_at)
        values ('exam_thptqg_keep', 'Hàm số', '2026-10-20', 'u_adm', 1000, 1000),
               ('exam_class_only', 'Class topic', '', 'u_adm', 1000, 1000);
      insert into public.ltch_practice_solution_files(id, exam_id, file_kind, name, drive_file_id, parent_folder_id, content_type, file_size, sha256, request_id, status, created_by, created_at)
        values ('f_big_vid', 'exam_thptqg_keep', 'video', 'Test bài chữa.mp4', 'drv_big_1', 'drv_folder_v', 'video/mp4', 724774184, '${'a'.repeat(64)}', 'req-pg-bigint-test-001', 'stored', 'u_adm', 1001),
               ('f_cls_doc', 'exam_class_only', 'document', 'Cls.pdf', 'drv_cls_1', 'drv_folder_d', 'application/pdf', 2048, '${'c'.repeat(64)}', 'req-pg-cls-doc-test-001', 'stored', 'u_adm', 1002);
    `);

    const storedSize = (await pg.query("select file_size::text from public.ltch_practice_solution_files where id='f_big_vid'")).rows[0].file_size;
    assert.equal(storedSize, '724774184');

    await assert.rejects(
      pg.exec(`insert into public.ltch_practice_solution_files(id, exam_id, file_kind, name, drive_file_id, parent_folder_id, content_type, file_size, sha256, request_id, status, created_by, created_at)
        values ('f_bad', 'exam_thptqg_keep', 'homework', 'x.pdf', 'drv_bad', 'drv_folder_d', 'application/pdf', 100, '${'b'.repeat(64)}', 'req-pg-bad-kind-0001', 'stored', 'u_adm', 1003)`)
    );

    await pg.query("select public.ltch_delete_archived_class('u_adm', 'c_arch')");
    assert.deepEqual(
      (await pg.query('select exam_id from public.ltch_practice_solutions')).rows.map((r) => r.exam_id),
      ['exam_thptqg_keep']
    );
    assert.deepEqual(
      (await pg.query('select id from public.ltch_practice_solution_files')).rows.map((r) => r.id),
      ['f_big_vid']
    );
  } finally {
    await pg.close();
  }
});

test('Frontend source & bundle integrate Làm đề / Xem chữa đề and exclude standalone 50-item solution routes', async () => {
  const [clientAppSrc, practiceRoomsSrc, bundleJs, noticesWsSrc, appCss] = await Promise.all([
    readFile('client/app.js', 'utf8'),
    readFile('client/practice-rooms.mjs', 'utf8'),
    readFile('public/app.js', 'utf8'),
    readFile('client/notices-workspace.mjs', 'utf8'),
    readFile('public/app.css', 'utf8')
  ]);

  assert.equal(clientAppSrc.includes('Đề kiểm tra riêng của lớp'), false);
  assert.equal(clientAppSrc.includes('Tạo đề lớp'), false);
  assert.equal(clientAppSrc.includes('practiceSolutionFilesBasePath'), false);
  assert.ok(clientAppSrc.includes('examSolutionFilesBasePath'));
  assert.ok(clientAppSrc.includes('renderExamSolutionPage'));
  assert.ok(clientAppSrc.includes('putChunkDirectToDrive'));
  assert.ok(practiceRoomsSrc.includes('openExamActionChoiceModal'));
  assert.ok(practiceRoomsSrc.includes('Xem chữa đề'));
  assert.ok(bundleJs.includes('/api/practice/exams/'));
  assert.equal(bundleJs.includes('/practice-solutions/'), false);
  assert.ok(noticesWsSrc.includes('Phòng luyện & Chữa đề'));
  assert.ok(appCss.includes('.ltch-exam-choice-modal'));
});

test('Legacy Drive exam lazily creates File đề / Video chữa / File tài liệu, relocates loose sources & serves downloads once', async () => {
  clearPracticeDriveCaches();
  const mock = createDriveMock();
  const openDrive = async () => mock.drive;
  const examId = 'exam_thptqg_legacy_99';
  const examFolderId = 'drv_legacy_exam_dir';

  // Build parent folder chain up to examFolderId without File đề / Video chữa / File tài liệu subfolders
  mock.objects.set('drv_root', { id: 'drv_root', name: 'Lớp Toán cô Hạnh', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], shared: false, ownedByMe: true, trashed: false });
  mock.objects.set('drv_pr_root', { id: 'drv_pr_root', name: 'Phòng luyện', mimeType: 'application/vnd.google-apps.folder', parents: ['drv_root'], shared: false, ownedByMe: true, trashed: false });
  mock.objects.set('drv_thptqg', { id: 'drv_thptqg', name: 'THPTQG', mimeType: 'application/vnd.google-apps.folder', parents: ['drv_pr_root'], shared: false, ownedByMe: true, trashed: false });
  mock.objects.set(examFolderId, { id: examFolderId, name: `[LTCH] Đề thi cũ [${examId}]`, mimeType: 'application/vnd.google-apps.folder', parents: ['drv_thptqg'], shared: false, ownedByMe: true, trashed: false });
  mock.objects.set('drv_media_old', { id: 'drv_media_old', name: 'Hình minh họa', mimeType: 'application/vnd.google-apps.folder', parents: [examFolderId], shared: false, ownedByMe: true, trashed: false });

  const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 8, 7]);
  const docxSha = createHash('sha256').update(docxBytes).digest('hex');
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  const jsonBytes = new Uint8Array([0x7b, 0x7d]);

  await mock.drive.upload({
    id: 'drv_loose_docx',
    parentId: examFolderId,
    name: 'De_thi_THPTQG_2026_Upload_LTCH.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: docxBytes,
    sha256: docxSha
  });
  // Legacy PDF without appProperties.ltchSha256
  mock.objects.set('drv_loose_pdf', {
    id: 'drv_loose_pdf',
    name: 'Đề thi THPTQG 2026.pdf',
    mimeType: 'application/pdf',
    parents: [examFolderId],
    size: String(pdfBytes.byteLength),
    shared: false,
    ownedByMe: true,
    trashed: false,
    bytes: pdfBytes
  });
  mock.objects.set('drv_pack_json', {
    id: 'drv_pack_json',
    name: 'de-luyen-v1794939610409.json',
    mimeType: 'application/json',
    parents: [examFolderId],
    size: String(jsonBytes.byteLength),
    shared: false,
    ownedByMe: true,
    trashed: false,
    bytes: jsonBytes
  });

  const db = createDb({
    driveFolders: [
      { folder_key: 'ltch-root', drive_folder_id: 'drv_root', parent_folder_id: 'root', folder_name: 'Lớp Toán cô Hạnh' },
      { folder_key: 'practice:root', drive_folder_id: 'drv_pr_root', parent_folder_id: 'drv_root', folder_name: 'Phòng luyện' },
      { folder_key: 'practice:pool:thptqg', drive_folder_id: 'drv_thptqg', parent_folder_id: 'drv_pr_root', folder_name: 'THPTQG' },
      { folder_key: `practice:exam:${examId}`, drive_folder_id: examFolderId, parent_folder_id: 'drv_thptqg', folder_name: `[LTCH] Đề thi cũ [${examId}]` },
      { folder_key: `practice:media:${examId}`, drive_folder_id: 'drv_media_old', parent_folder_id: examFolderId, folder_name: 'Hình minh họa' }
    ],
    exams: [
      {
        id: examId,
        class_id: null,
        title: '[LTCH] Đề thi cũ',
        status: 'published',
        exam_type: 'thptqg',
        exam_code: '0101',
        target_grade: 12,
        school_year_id: 'year-2026-2027',
        duration_minutes: 90,
        questions: [
          {
            id: 'q1',
            section: 'part_1',
            type: 'single',
            answer: 'A',
            points: 0.25,
            _examMeta: {
              examType: 'thptqg',
              examCode: '0101',
              targetGrade: 12,
              schoolYearId: 'year-2026-2027',
              storage: 'drive',
              driveFolderId: examFolderId,
              drivePackFileId: 'drv_pack_json',
              sourceFiles: []
            }
          }
        ],
        created_by: adminActor.uid,
        opens_at: 1000,
        updated_at: 5000
      }
    ]
  });

  let listCalls = 0;
  const origList = mock.drive.listFolderChildren;
  mock.drive.listFolderChildren = async (args) => {
    listCalls += 1;
    return origList(args);
  };

  const endpoint = `/api/practice/exams/${examId}/solutions`;
  const firstGet = await business(new Request(`https://ltch.test${endpoint}`), endpoint, { db, actor: student12Actor, env: TEST_ENV, openDrive });
  assert.equal(firstGet.status, 200);
  const firstBody = await firstGet.json();
  assert.equal(firstBody.solution.examFiles.length, 2);
  assert.deepEqual(
    firstBody.solution.examFiles.map((f) => f.name).sort(),
    ['De_thi_THPTQG_2026_Upload_LTCH.docx', 'Đề thi THPTQG 2026.pdf']
  );

  const sourceFolderId = db.tables.ltch_drive_folders.find((f) => f.folder_key === `practice:source:${examId}`)?.drive_folder_id;
  const videoFolderId = db.tables.ltch_drive_folders.find((f) => f.folder_key === `practice:sol-video:${examId}`)?.drive_folder_id;
  const docFolderId = db.tables.ltch_drive_folders.find((f) => f.folder_key === `practice:sol-doc:${examId}`)?.drive_folder_id;
  assert.ok(sourceFolderId && videoFolderId && docFolderId);

  // Both legacy source files relocated into File đề; pack JSON & media folder untouched
  assert.deepEqual(mock.objects.get('drv_loose_docx').parents, [sourceFolderId]);
  assert.deepEqual(mock.objects.get('drv_loose_pdf').parents, [sourceFolderId]);
  assert.deepEqual(mock.objects.get('drv_pack_json').parents, [examFolderId]);
  assert.deepEqual(mock.objects.get('drv_media_old').parents, [examFolderId]);

  // DB exam meta persisted cleanly so second GET hits zero Drive list calls
  const savedExamMeta = db.tables.ltch_exams[0].questions[0]._examMeta;
  assert.equal(savedExamMeta.driveSourceFolderId, sourceFolderId);
  assert.equal(savedExamMeta.sourceFiles.length, 2);

  const prevListCalls = listCalls;
  const secondGet = await business(new Request(`https://ltch.test${endpoint}`), endpoint, { db, actor: student12Actor, env: TEST_ENV, openDrive });
  assert.equal(secondGet.status, 200);
  assert.equal(listCalls, prevListCalls);
  assert.equal((await secondGet.json()).solution.examFiles.length, 2);

  // Both relocated files download cleanly via /solutions/source/:driveFileId
  const dlDocx = await business(
    new Request(`https://ltch.test${endpoint}/source/drv_loose_docx`),
    `${endpoint}/source/drv_loose_docx`,
    { db, actor: student12Actor, env: TEST_ENV, openDrive }
  );
  assert.equal(dlDocx.status, 200);
  assert.deepEqual(new Uint8Array(await dlDocx.arrayBuffer()), docxBytes);

  const dlPdf = await business(
    new Request(`https://ltch.test${endpoint}/source/drv_loose_pdf`),
    `${endpoint}/source/drv_loose_pdf`,
    { db, actor: student12Actor, env: TEST_ENV, openDrive }
  );
  assert.equal(dlPdf.status, 200);
  assert.deepEqual(new Uint8Array(await dlPdf.arrayBuffer()), pdfBytes);
});
