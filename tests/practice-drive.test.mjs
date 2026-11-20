import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createGoogleDrive } from '../worker/google-drive.mjs';
import { createWorker } from '../worker/index.mjs';
import { clearPracticeDriveCaches } from '../worker/practice-drive.mjs';
import { practiceRooms } from '../worker/practice-rooms.mjs';
import { groupBulkExamSourceFiles, parseWordExamFiles } from '../shared/word-exam-parser.mjs';

const TEST_ROOT = process.env.LTCH_EXAM_SUITE_DIR || '';
const ORIGIN = 'https://ltch.example.com';
const ENV = {
  ALLOWED_ORIGIN: ORIGIN,
  API_ORIGIN: 'https://api.ltch.example.com',
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_SECRET: 'sb_secret_test_only',
  MAIL_SECRET: 'test-only-mail-secret-key-at-least-32-chars!!',
  MAIL_ENDPOINT: 'https://script.google.com/macros/s/test/exec',
  FIREBASE_API_KEY: 'test-firebase-api-key',
  GOOGLE_DRIVE_CLIENT_ID: 'client-id',
  GOOGLE_DRIVE_CLIENT_SECRET: 'client-secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh-token'
};

function createInMemoryPracticeDriveDb(seed = {}) {
  const tables = {
    ltch_classes: [...(seed.classes || [{ id: 'c12', name: 'Lớp 12', grade: 12, school_year_id: 'year-2026-2027', archived: false }])],
    ltch_school_years: [
      { id: 'year-2026-2027', name: '2026 - 2027', starts_on: '2026-08-01', ends_on: '2027-06-30' }
    ],
    ltch_accounts: [...(seed.accounts || [])],
    ltch_class_memberships: [...(seed.memberships || [])],
    ltch_student_grade_history: [],
    ltch_exams: [...(seed.exams || [])],
    ltch_exam_year_shares: [],
    ltch_practice_attempts: [],
    ltch_question_bank: [],
    ltch_question_versions: [],
    ltch_question_reports: [],
    ltch_exam_questions: [],
    ltch_legacy_question_codes: [],
    ltch_question_imports: [],
    ltch_drive_folders: []
  };
  let seq = 1000;

  function makeBuilder(tableName) {
    const state = { op: 'select', filters: [], payload: null, single: false };
    const builder = {
      select(columns) { state.columns = columns; return builder; },
      eq(col, val) { state.filters.push((row) => row[col] === val); return builder; },
      in(col, vals) { const set = new Set(vals); state.filters.push((row) => set.has(row[col])); return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() { state.single = true; return builder; },
      single() { state.single = true; return builder; },
      insert(payload) { state.op = 'insert'; state.payload = payload; return builder; },
      upsert(payload, opts = {}) {
        state.op = 'upsert'; state.payload = payload; state.onConflict = opts.onConflict || 'id'; state.ignoreDuplicates = Boolean(opts.ignoreDuplicates); return builder;
      },
      update(payload) { state.op = 'update'; state.payload = payload; return builder; },
      delete() { state.op = 'delete'; return builder; },
      then(resolve, reject) {
        try {
          const rows = tables[tableName] || (tables[tableName] = []);
          const match = (r) => state.filters.every((fn) => fn(r));
          if (state.op === 'select') {
            let matched = rows.filter(match);
            if (tableName === 'ltch_practice_attempts' && state.columns?.includes('legacy_attemptNo:')) {
              matched = matched.map((row) => Object.fromEntries(state.columns.split(',').map((column) => {
                const [alias, jsonPath] = column.split(':');
                const value = jsonPath ? jsonPath.split('->').reduce((node, key) => node?.[key], row) : row[column];
                return [alias, value ?? null];
              })));
            }
            return Promise.resolve({ data: state.single ? matched[0] || null : matched, error: null }).then(resolve, reject);
          }
          if (state.op === 'insert') {
            const list = Array.isArray(state.payload) ? state.payload : [state.payload];
            rows.push(...list);
            return Promise.resolve({ data: list, error: null }).then(resolve, reject);
          }
          if (state.op === 'upsert') {
            const list = Array.isArray(state.payload) ? state.payload : [state.payload];
            const keys = String(state.onConflict || 'id').split(',').map((k) => k.trim());
            for (const item of list) {
              const idx = rows.findIndex((r) => keys.every((k) => r[k] === item[k]));
              if (idx >= 0) {
                if (!state.ignoreDuplicates) rows[idx] = { ...rows[idx], ...item };
              } else {
                rows.push({ ...item });
              }
            }
            return Promise.resolve({ data: list, error: null }).then(resolve, reject);
          }
          if (state.op === 'update') {
            const updated = [];
            for (let i = 0; i < rows.length; i++) {
              if (match(rows[i])) {
                rows[i] = { ...rows[i], ...state.payload };
                updated.push(rows[i]);
              }
            }
            return Promise.resolve({ data: updated, error: null }).then(resolve, reject);
          }
          if (state.op === 'delete') {
            const removed = rows.filter(match);
            tables[tableName] = rows.filter((r) => !match(r));
            return Promise.resolve({ data: state.columns ? removed : [], error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      }
    };
    return builder;
  }

  return {
    tables,
    from(name) { return makeBuilder(name); },
    async rpc(fnName, args) {
      if (fnName === 'ltch_reserve_question_codes') {
        return { data: Array.from({ length: args.p_count }, () => `LTCH-${++seq}`), error: null };
      }
      if (fnName === 'ltch_save_room_exam') {
        const save = (table, row, keys) => {
          const idx = table.findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (idx < 0) table.push(row);
          else table[idx] = { ...table[idx], ...row };
        };
        const existingExam = tables.ltch_exams.find((r) => r.id === args.p_exam.id);
        if (args.p_expected_updated === null && existingExam) return { data: null, error: { message: 'LTCH_EXAM_CONFLICT' } };
        if (args.p_expected_updated !== null && (!existingExam || existingExam.updated_at !== args.p_expected_updated)) {
          return { data: null, error: { message: 'LTCH_EXAM_CONFLICT' } };
        }
        for (const row of args.p_bank) {
          const pkConflict = tables.ltch_question_bank.find(
            (r) => r.id === row.id && r.question_code !== row.question_code
          );
          if (pkConflict) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint "ltch_question_bank_pkey"' }
            };
          }
          const existingBank = tables.ltch_question_bank.find((r) => r.question_code === row.question_code);
          if (existingBank && row.version < existingBank.version) {
            return { data: null, error: { message: 'question version cannot move backwards' } };
          }
        }
        for (const v of args.p_versions) {
          const old = tables.ltch_question_versions.find((r) => r.question_code === v.question_code && r.version === v.version);
          if (old && JSON.stringify(old.question) !== JSON.stringify(v.question)) {
            return { data: null, error: { message: 'question version already exists with different content' } };
          }
        }
        save(tables.ltch_exams, args.p_exam, ['id']);
        for (const row of args.p_bank) {
          const idx = tables.ltch_question_bank.findIndex((r) => r.question_code === row.question_code);
          if (idx < 0) tables.ltch_question_bank.push(row);
          else tables.ltch_question_bank[idx] = { ...tables.ltch_question_bank[idx], version: row.version, question: row.question };
        }
        for (const row of args.p_versions) save(tables.ltch_question_versions, row, ['question_code', 'version']);
        return { data: null, error: null };
      }
      if (fnName === 'ltch_practice_stats') {
        const out = [];
        for (const examId of args.p_exam_ids) {
          const attempts = tables.ltch_practice_attempts.filter((a) => a.exam_id === examId && a.status === 'submitted' && !a.is_preview);
          const row = { exam_id: examId, total: attempts.length, b0: 0, b1: 0, b2: 0, b3: 0, b4: 0 };
          for (const a of attempts) {
            const ratio = a.max_score > 0 ? a.score / a.max_score : 0;
            const idx = ratio < 0.2 ? 0 : ratio < 0.4 ? 1 : ratio < 0.6 ? 2 : ratio < 0.8 ? 3 : 4;
            row[`b${idx}`]++;
          }
          out.push(row);
        }
        return { data: out, error: null };
      }
      if (fnName === 'ltch_list_room_exams') {
        const list = tables.ltch_exams
          .filter((e) => !args.p_published_only || e.status === 'published')
          .filter((e) => ['thptqg', 'hsa', 'tsa'].includes(e.exam_type))
          .map((e) => {
            const qs = Array.isArray(e.questions) ? e.questions : [];
            return {
              id: e.id,
              class_id: e.class_id,
              title: e.title,
              status: e.status,
              opens_at: e.opens_at,
              closes_at: e.closes_at,
              results_at: e.results_at,
              solutions_at: e.solutions_at,
              created_by: e.created_by,
              exam_type: e.exam_type,
              exam_code: e.exam_code,
              duration_minutes: e.duration_minutes,
              sections: e.sections,
              target_grade: e.target_grade,
              school_year_id: e.school_year_id,
              updated_at: e.updated_at,
              exam_meta: qs[0]?._examMeta || {},
              total_questions: qs.length,
              part_1_count: qs.filter((q) => (q.section || 'part_1') === 'part_1').length,
              part_2_count: qs.filter((q) => q.section === 'part_2').length,
              part_3_count: qs.filter((q) => q.section === 'part_3').length
            };
          });
        return { data: list, error: null };
      }
      return { data: null, error: { code: 'PGRST202', message: 'missing function' } };
    }
  };
}

function createMockDrive() {
  const objects = new Map();
  let counter = 0;
  let downloads = 0;
  let uploads = 0;

  const drive = {
    async rootId() { return 'root'; },
    async reserveIds(count) {
      assert.ok(count >= 1 && count <= 100);
      return Array.from({ length: count }, () => `drv_${++counter}`);
    },
    async reserveId() {
      return (await this.reserveIds(1))[0];
    },
    async isRootChild({ id, name }) {
      const o = objects.get(id);
      return Boolean(o && !o.trashed && o.name === name && o.parents?.[0] === 'root');
    },
    async metadata({ id }) {
      const o = objects.get(id);
      if (!o) {
        const e = new Error('not found');
        e.code = 'not_found';
        throw e;
      }
      return o;
    },
    async createFolder({ id, parentId, name }) {
      if (objects.has(id)) {
        const e = new Error('conflict');
        e.code = 'conflict';
        throw e;
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
    async permissions({ id }) {
      const o = objects.get(id);
      return [{ type: 'user', role: 'owner' }, ...(o?.shared ? [{ type: 'anyone', role: 'reader', allowFileDiscovery: false }] : [])];
    },
    async upload({ id, parentId, name, contentType, bytes, sha256 }) {
      if (objects.has(id)) {
        const e = new Error('conflict');
        e.code = 'conflict';
        throw e;
      }
      uploads++;
      objects.set(id, {
        id,
        name,
        mimeType: contentType,
        parents: [parentId],
        size: String(bytes.byteLength),
        appProperties: sha256 ? { ltchSha256: sha256 } : {},
        shared: false,
        ownedByMe: true,
        trashed: false,
        bytes: new Uint8Array(bytes)
      });
      return id;
    },
    async download({ id }) {
      const o = objects.get(id);
      if (!o || !o.bytes) {
        const e = new Error('not found');
        e.code = 'not_found';
        throw e;
      }
      downloads++;
      return new Response(o.bytes);
    },
    async trash({ id }) {
      const o = objects.get(id);
      if (!o) {
        const e = new Error('not found');
        e.code = 'not_found';
        throw e;
      }
      o.trashed = true;
      // Cascade view for folder descendants in assertions
      for (const item of objects.values()) {
        if (item.parents?.includes(id)) item.trashed = true;
      }
    }
  };

  return {
    drive,
    objects,
    stats() { return { uploads, downloads }; },
    resetCounters() { uploads = 0; downloads = 0; }
  };
}

async function readLocalUploadFile(filePath) {
  const buf = await readFile(filePath);
  const name = filePath.split('/').pop();
  return { name, buf, bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}

test('Google Drive verifyOwner enforces admin@example.com and reserveIds reserves batches', async () => {
  const wrongDrive = createGoogleDrive({
    accessToken: 'test-token',
    fetchImpl: async () => new Response(JSON.stringify({ user: { emailAddress: 'other@gmail.com' } }), { status: 200 })
  });
  await assert.rejects(wrongDrive.verifyOwner(), (err) => err.code === 'wrong_account');

  const okDrive = createGoogleDrive({
    accessToken: 'test-token',
    fetchImpl: async (url) => {
      if (url.includes('/about')) return new Response(JSON.stringify({ user: { emailAddress: 'admin@example.com' } }), { status: 200 });
      if (url.includes('/generateIds?count=3')) return new Response(JSON.stringify({ ids: ['id_1', 'id_2', 'id_3'] }), { status: 200 });
      return new Response('{}', { status: 404 });
    }
  });
  await okDrive.verifyOwner();
  assert.deepEqual(await okDrive.reserveIds(3), ['id_1', 'id_2', 'id_3']);
});

test(
  'Bộ đề TEST (THPTQG, HSA, TSA) stores heavy packs, sources and deduplicated media on Drive with 0 inline Base64 in Supabase',
  { skip: !TEST_ROOT || !existsSync(TEST_ROOT) },
  async () => {
  clearPracticeDriveCaches();
  const db = createInMemoryPracticeDriveDb();
  const mock = createMockDrive();
  const openDrive = async () => mock.drive;
  const adminActor = { uid: 'admin-1', status: 'active', roles: ['admin'], memberships: [], childMemberships: [] };
  const studentActor = {
    uid: 'student-12',
    status: 'active',
    roles: ['student'],
    display_name: 'Học sinh 12',
    memberships: [{ class_id: 'c12', member_role: 'student', status: 'active' }],
    childMemberships: []
  };

  const specs = [
    {
      examType: 'thptqg',
      docxPath: `${TEST_ROOT}/THPTQG/De_thi_THPTQG_2026_Upload_LTCH.docx`,
      pdfPaths: [`${TEST_ROOT}/THPTQG/Đề thi THPTQG 2026.pdf`],
      expectedTitle: '[LTCH] Đề thi THPTQG 2026 – Môn Toán (Mã đề 0101)',
      expectedUniqueImages: 5
    },
    {
      examType: 'hsa',
      docxPath: `${TEST_ROOT}/HSA/De_tham_khao_HSA_2025_Upload_LTCH.docx`,
      pdfPaths: [`${TEST_ROOT}/HSA/Đề tham khảo HSA 2025.pdf`],
      expectedTitle: '[LTCH] Đề tham khảo Kỳ thi Đánh giá năng lực HSA – ĐHQGHN',
      expectedUniqueImages: 31
    },
    {
      examType: 'tsa',
      docxPath: `${TEST_ROOT}/TSA/De_01_TSA_2026_Full_3_Phan_Upload_LTCH.docx`,
      pdfPaths: [
        `${TEST_ROOT}/TSA/ĐỀ 01 PHẦN TƯ DUY TOÁN HỌC (GV).pdf`,
        `${TEST_ROOT}/TSA/ĐỀ 01 PHẦN TƯ DUY ĐỌC HIỂU-GV.pdf`,
        `${TEST_ROOT}/TSA/ĐỀ 01 VẬT LÝ TSA 2026 (GV).pdf`,
        `${TEST_ROOT}/TSA/ĐỀ 01 HÓA HỌC TSA 2026 (GV).pdf`,
        `${TEST_ROOT}/TSA/ĐỀ 01 SINH HỌC TSA 2026 (GV).pdf`
      ],
      expectedTitle: '[LTCH] Đề 01 Đánh giá tư duy Bách Khoa TSA 2026',
      expectedUniqueImages: 27
    }
  ];

  const publishedExams = [];
  for (const spec of specs) {
    const docxFile = await readLocalUploadFile(spec.docxPath);
    const parsed = await parseWordExamFiles(
      [{ name: docxFile.name, arrayBuffer: async () => docxFile.bytes.buffer.slice(docxFile.bytes.byteOffset, docxFile.bytes.byteOffset + docxFile.bytes.byteLength) }],
      { expectedExamType: spec.examType }
    );
    assert.deepEqual(parsed.errors, []);

    const examId = `exam_${spec.examType}_test_${spec.examType}`;
    const sourceFiles = [docxFile];
    for (const p of spec.pdfPaths) sourceFiles.push(await readLocalUploadFile(p));

    const pendingAssets = sourceFiles.map((sf, idx) => ({
      key: `source_${idx}`,
      kind: 'source',
      name: sf.name,
      mimeType: sf.name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      dataBase64: Buffer.from(sf.bytes).toString('base64')
    }));

    const uniqueImgs = new Map();
    for (const q of parsed.questions) {
      for (const m of [...(q.media || []), ...(q.passageMedia || [])]) {
        if (m.dataUrl && !uniqueImgs.has(m.dataUrl)) {
          uniqueImgs.set(m.dataUrl, {
            key: `img_${uniqueImgs.size}`,
            kind: 'image',
            id: m.id,
            name: `${m.id}.png`,
            dataUrl: m.dataUrl
          });
        }
      }
    }
    assert.equal(uniqueImgs.size, spec.expectedUniqueImages);
    for (const img of uniqueImgs.values()) pendingAssets.push(img);

    const stagedMap = new Map();
    for (let i = 0; i < pendingAssets.length; i += 8) {
      const batch = pendingAssets.slice(i, i + 8);
      const res = await practiceRooms(
        new Request(`${ORIGIN}/api/admin/practice/exams`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'stage_drive_assets',
            examId,
            examType: spec.examType,
            targetGrade: 12,
            title: spec.expectedTitle,
            assets: batch
          })
        }),
        '/api/admin/practice/exams',
        { db, actor: adminActor, env: ENV, openDrive }
      );
      assert.equal(res.status, 200);
      const data = await res.json();
      for (const a of data.assets) stagedMap.set(a.key, a);
    }

    const stagedSources = sourceFiles.map((_, idx) => {
      const d = stagedMap.get(`source_${idx}`);
      return { name: d.name, driveFileId: d.driveFileId, mimeType: d.mimeType, size: d.size, sha256: d.sha256 };
    });

    const imgByDataUrl = new Map();
    for (const [dataUrl, item] of uniqueImgs.entries()) {
      imgByDataUrl.set(dataUrl, stagedMap.get(item.key));
    }

    const questionsWithoutBase64 = parsed.questions.map((q) => {
      const mapMedia = (arr) => (arr || []).map((m) => {
        const d = imgByDataUrl.get(m.dataUrl);
        return { id: m.id, driveFileId: d.driveFileId, mimeType: d.mimeType, size: d.size, sha256: d.sha256, width: m.width, height: m.height, ...(m.inSolution ? { inSolution: true } : {}) };
      });
      return {
        ...q,
        ...(q.media?.length ? { media: mapMedia(q.media) } : {}),
        ...(q.passageMedia?.length ? { passageMedia: mapMedia(q.passageMedia) } : {})
      };
    });

    const pubRes = await practiceRooms(
      new Request(`${ORIGIN}/api/admin/practice/exams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'publish',
          examId,
          isNewExam: true,
          examType: spec.examType,
          examMode: 'full',
          targetGrade: 12,
          examCode: parsed.meta.examCode || '01',
          title: spec.expectedTitle,
          durationMinutes: spec.examType === 'thptqg' ? 90 : spec.examType === 'hsa' ? 195 : 150,
          sourceFiles: stagedSources,
          questions: questionsWithoutBase64
        })
      }),
      '/api/admin/practice/exams',
      { db, actor: adminActor, env: ENV, openDrive }
    );
    assert.equal(pubRes.status, 201);
    const pubData = await pubRes.json();
    assert.equal(pubData.status, 'published');
    assert.equal(pubData.questionCount, parsed.questions.length);
    publishedExams.push({ spec, examId, pubData });
  }

  // Diagnostics verify 0 inline Base64 and lightweight Supabase rows
  const diagRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'storage_diagnostics' })
    }),
    '/api/admin/practice/exams',
    { db, actor: adminActor, env: ENV, openDrive }
  );
  const diag = await diagRes.json();
  assert.equal(diag.examsCount, 3);
  assert.equal(diag.inlineDataUrlCount, 0);
  assert.equal(diag.tables.ltch_question_bank.count, 22 + 235 + 100);
  assert.equal(diag.tables.ltch_question_versions.count, 22 + 235 + 100);
  assert.ok(diag.totalDbJsonBytes < 350_000, `Expected compact DB JSON < 350KB, got ${diag.totalDbJsonBytes}`);
  for (const ex of db.tables.ltch_exams) {
    assert.equal(ex.questions[0]._examMeta.storage, 'drive');
    assert.ok(ex.questions[0]._examMeta.drivePackFileId);
    assert.ok(!('prompt' in ex.questions[0]));
    assert.ok(!('passageContent' in ex.questions[0]));
  }

  // Verify Drive folder structure
  const folders = [...mock.objects.values()].filter((o) => o.mimeType === 'application/vnd.google-apps.folder');
  assert.ok(folders.some((f) => f.name === 'Lớp Toán cô Hạnh'));
  assert.ok(folders.some((f) => f.name === 'Phòng luyện'));
  for (const label of ['THPTQG', 'HSA', 'TSA']) {
    assert.ok(folders.some((f) => f.name === label));
  }
  const driveFiles = [...mock.objects.values()].filter((o) => o.mimeType !== 'application/vnd.google-apps.folder');
  // 3 packs + (2 + 2 + 6) sources + (5 + 31 + 27) unique images = 76 files
  assert.equal(driveFiles.length, 3 + 10 + 63);

  // Lobby check makes 0 Drive downloads
  mock.resetCounters();
  const lobbyRes = await practiceRooms(
    new Request(`${ORIGIN}/api/practice/rooms`),
    '/api/practice/rooms',
    { db, actor: studentActor, env: ENV, openDrive }
  );
  assert.equal(lobbyRes.status, 200);
  assert.equal(mock.stats().downloads, 0);
  const lobby = await lobbyRes.json();
  assert.equal(lobby.exams.length, 3);

  // Cold start from Drive (clear RAM cache first to prove Drive download + SHA-256 verification works)
  clearPracticeDriveCaches();
  const thptId = publishedExams[0].examId;
  const startThpt = await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${thptId}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ practiceMode: 'full' })
    }),
    `/api/exams/${thptId}/start`,
    { db, actor: studentActor, env: ENV, openDrive }
  );
  assert.equal(startThpt.status, 201);
  assert.equal(mock.stats().downloads, 1);
  const thptStarted = await startThpt.json();
  assert.equal(thptStarted.visibleQuestions.length, 22);
  const firstSignedImg = thptStarted.visibleQuestions.flatMap((q) => q.media || []).find((m) => m.url);
  assert.ok(firstSignedImg && firstSignedImg.url.startsWith('https://api.ltch.example.com/api/practice-media?ticket='));
  assert.ok(!thptStarted.visibleQuestions.some((q) => 'answer' in q || 'solution' in q));

  // Verify /api/practice-media serves exact image bytes and rejects tampered tickets
  const worker = createWorker({
    db,
    verify: async () => ({ uid: studentActor.uid, email: 's@example.test' }),
    openDrive
  });
  const mediaUrl = new URL(firstSignedImg.url);
  const mediaResp = await worker.fetch(new Request(`https://api.ltch.example.com${mediaUrl.pathname}${mediaUrl.search}`), ENV);
  assert.equal(mediaResp.status, 200);
  assert.equal(mediaResp.headers.get('cache-control'), 'private, max-age=14400, immutable');
  assert.equal(mediaResp.headers.get('cross-origin-resource-policy'), 'cross-origin');
  const imgBytes = new Uint8Array(await mediaResp.arrayBuffer());
  assert.equal(createHash('sha256').update(imgBytes).digest('hex'), firstSignedImg.sha256);

  const badMediaResp = await worker.fetch(new Request(`https://api.ltch.example.com${mediaUrl.pathname}?ticket=tampered.ticket`), ENV);
  assert.equal(badMediaResp.status, 403);

  // Verify draft makes 0 Drive calls & omits attemptQuestions from _attemptMeta
  mock.resetCounters();
  const draftRes = await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${thptId}/draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: thptStarted.attemptId,
        activeDeviceToken: thptStarted.activeDeviceToken,
        responses: { [thptStarted.visibleQuestions[0].id]: 'A' }
      })
    }),
    `/api/exams/${thptId}/draft`,
    { db, actor: studentActor, env: ENV, openDrive }
  );
  assert.equal(draftRes.status, 200);
  assert.equal(mock.stats().downloads, 0);
  const storedAttempt = db.tables.ltch_practice_attempts.find((a) => a.id === thptStarted.attemptId);
  assert.equal(storedAttempt.responses._attemptMeta.attemptQuestions, undefined);
  assert.ok(!('prompt' in storedAttempt.attempt_questions[0]));

  // Submit THPTQG exam & verify full solutions + signed media returned
  const submitThpt = await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${thptId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: thptStarted.attemptId,
        activeDeviceToken: thptStarted.activeDeviceToken,
        responses: { [thptStarted.visibleQuestions[0].id]: 'A' }
      })
    }),
    `/api/exams/${thptId}/submit`,
    { db, actor: studentActor, env: ENV, openDrive }
  );
  assert.equal(submitThpt.status, 200);
  const submittedData = await submitThpt.json();
  assert.equal(submittedData.status, 'submitted');
  assert.equal(submittedData.questions.length, 22);
  assert.ok(submittedData.questions.every((q) => typeof q.prompt === 'string' && q.prompt.length > 0));

  // HSA full workflow: waiting -> start_section part_1 -> submit_section -> waiting part_2 -> part_3 Q01
  const hsaId = publishedExams[1].examId;
  const hsaStart = await (await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${hsaId}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ practiceMode: 'full' })
    }),
    `/api/exams/${hsaId}/start`,
    { db, actor: studentActor, env: ENV, openDrive }
  )).json();
  assert.equal(hsaStart.sectionStates.part_1.status, 'waiting');
  assert.equal(hsaStart.visibleQuestions.length, 0);

  const hsaPart1 = await (await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${hsaId}/section`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: hsaStart.attemptId,
        activeDeviceToken: hsaStart.activeDeviceToken,
        action: 'start_section',
        sectionKey: 'part_1'
      })
    }),
    `/api/exams/${hsaId}/section`,
    { db, actor: studentActor, env: ENV, openDrive }
  )).json();
  assert.equal(hsaPart1.visibleQuestions.length, 50);

  // Advance to Part 3 and select Q01
  const hsaToP2 = await (await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${hsaId}/section`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attemptId: hsaStart.attemptId, activeDeviceToken: hsaStart.activeDeviceToken, action: 'submit_section', responses: {} })
    }),
    `/api/exams/${hsaId}/section`,
    { db, actor: studentActor, env: ENV, openDrive }
  )).json();
  assert.equal(hsaToP2.currentSection, 'part_2');
  await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${hsaId}/section`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attemptId: hsaStart.attemptId, activeDeviceToken: hsaStart.activeDeviceToken, action: 'start_section', sectionKey: 'part_2' })
    }),
    `/api/exams/${hsaId}/section`,
    { db, actor: studentActor, env: ENV, openDrive }
  );
  const hsaToP3 = await (await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${hsaId}/section`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attemptId: hsaStart.attemptId, activeDeviceToken: hsaStart.activeDeviceToken, action: 'submit_section', responses: {} })
    }),
    `/api/exams/${hsaId}/section`,
    { db, actor: studentActor, env: ENV, openDrive }
  )).json();
  assert.equal(hsaToP3.currentSection, 'part_3');

  const hsaPart3 = await (await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${hsaId}/section`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: hsaStart.attemptId,
        activeDeviceToken: hsaStart.activeDeviceToken,
        action: 'start_section',
        sectionKey: 'part_3',
        selectedCombination: 'Q01'
      })
    }),
    `/api/exams/${hsaId}/section`,
    { db, actor: studentActor, env: ENV, openDrive }
  )).json();
  assert.equal(hsaPart3.visibleQuestions.length, 50);
  assert.equal(hsaPart3.selectedCombination, 'Q01');

  // TSA full workflow: start & check drag_drop / fill_blank / passageMedia signed URLs
  const tsaId = publishedExams[2].examId;
  const tsaStart = await (await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${tsaId}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ practiceMode: 'full' })
    }),
    `/api/exams/${tsaId}/start`,
    { db, actor: studentActor, env: ENV, openDrive }
  )).json();
  assert.equal(tsaStart.totalQuestionCount, 100);
  assert.equal(tsaStart.visibleQuestions.length, 40);

  // Edit single question v1 -> v2 and regrade affected submitted THPTQG attempt
  const firstQ = publishedExams[0].pubData.questions[0];
  const oldPackId = db.tables.ltch_exams.find((e) => e.id === thptId).questions[0]._examMeta.drivePackFileId;
  const editRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/questions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        examId: thptId,
        questionId: firstQ.id,
        question: { ...firstQ, answer: 'A' },
        changeNote: 'Sửa đáp án sang A',
        regradeAffectedAttempts: true
      })
    }),
    '/api/admin/practice/questions',
    { db, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(editRes.status, 200);
  const editBody = await editRes.json();
  assert.equal(editBody.version, 2);
  assert.equal(editBody.regradedCount, 1);
  assert.equal(mock.objects.get(oldPackId).trashed, true);

  // Delete single exam trashes Drive folder and clears bank/versions
  const delSingle = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete_exam', examId: thptId })
    }),
    '/api/admin/practice/exams',
    { db, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(delSingle.status, 200);
  assert.equal(db.tables.ltch_exams.some((e) => e.id === thptId), false);

  // Preserve a non-room class exam during purge_all_room_exams
  db.tables.ltch_exams.push({ id: 'class_exam_keep', class_id: 'c12', title: 'Class Exam', status: 'published', exam_type: 'class', questions: [{ id: 'cq1', prompt: '1+1', type: 'short', accepted: ['2'], points: 1 }], created_by: 'admin-1' });
  const purgeRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'purge_all_room_exams' })
    }),
    '/api/admin/practice/exams',
    { db, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(purgeRes.status, 200);
  const purgeData = await purgeRes.json();
  assert.equal(purgeData.purgedExams, 2);
  assert.equal(db.tables.ltch_exams.length, 1);
  assert.equal(db.tables.ltch_exams[0].id, 'class_exam_keep');
  assert.equal(db.tables.ltch_question_bank.length, 0);
  assert.equal(db.tables.ltch_question_versions.length, 0);
  assert.equal(db.tables.ltch_practice_attempts.length, 0);
});

test('inSolution images do not leak before submission, restore_media works on Drive, and admin-only actions fail closed', async () => {
  clearPracticeDriveCaches();
  const db = createInMemoryPracticeDriveDb();
  const mock = createMockDrive();
  const openDrive = async () => mock.drive;
  const adminActor = { uid: 'admin-1', status: 'active', roles: ['admin'], memberships: [], childMemberships: [] };
  const teacherActor = { uid: 'teacher-1', status: 'active', roles: ['teacher'], memberships: [{ class_id: 'c12', member_role: 'teacher', status: 'active' }], childMemberships: [] };
  const studentActor = { uid: 'student-12', status: 'active', roles: ['student'], memberships: [{ class_id: 'c12', member_role: 'student', status: 'active' }], childMemberships: [] };

  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

  // Non-admin rejected on admin-only purge/diagnostics
  for (const act of ['purge_all_room_exams', 'storage_diagnostics']) {
    await assert.rejects(
      practiceRooms(
        new Request(`${ORIGIN}/api/admin/practice/exams`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: act })
        }),
        '/api/admin/practice/exams',
        { db, actor: teacherActor, env: ENV, openDrive }
      ),
      (err) => err.status === 403
    );
  }

  // Publish short exam with both prompt image and inSolution image (and one missing image for restore_media)
  const pubRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'publish',
        allowPartialStructure: true,
        examType: 'tsa',
        targetGrade: 12,
        title: 'TSA Media Guard Test',
        questions: [
          {
            id: 'q1',
            section: 'part_1',
            type: 'short',
            prompt: 'Câu hỏi [[img:qimg]]',
            solution: 'Lời giải [[img:simg]] [[img:missing_img]]',
            accepted: ['5'],
            points: 1,
            media: [
              { id: 'qimg', dataUrl: png1x1 },
              { id: 'simg', dataUrl: png1x1, inSolution: true }
            ]
          }
        ]
      })
    }),
    '/api/admin/practice/exams',
    { db, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(pubRes.status, 201);
  const { examId } = await pubRes.json();

  // Restore missing_img onto Drive
  const restRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'restore_media',
        examId,
        images: [{ id: 'missing_img', dataUrl: png1x1 }]
      })
    }),
    '/api/admin/practice/exams',
    { db, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(restRes.status, 200);
  const restData = await restRes.json();
  assert.equal(restData.restored, 1);
  assert.equal(restData.questions[0].media.length, 3);

  // Student starts: only qimg is visible and signed; simg & missing_img are NOT in visibleQuestions
  const startData = await (await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${examId}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ practiceMode: 'full' })
    }),
    `/api/exams/${examId}/start`,
    { db, actor: studentActor, env: ENV, openDrive }
  )).json();
  assert.equal(startData.visibleQuestions[0].media.length, 1);
  assert.equal(startData.visibleQuestions[0].media[0].id, 'qimg');
  assert.ok(startData.visibleQuestions[0].media[0].url.includes('/api/practice-media?ticket='));

  // Student submits: all 3 images (including simg & missing_img) receive signed URLs
  const subData = await (await practiceRooms(
    new Request(`${ORIGIN}/api/exams/${examId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attemptId: startData.attemptId, activeDeviceToken: startData.activeDeviceToken, responses: { q1: '5' } })
    }),
    `/api/exams/${examId}/submit`,
    { db, actor: studentActor, env: ENV, openDrive }
  )).json();
  assert.equal(subData.score, 1);
  assert.equal(subData.questions[0].media.length, 3);
  assert.ok(subData.questions[0].media.every((m) => m.url && m.url.includes('/api/practice-media?ticket=')));

  // Review endpoint also returns signed URLs
  const revData = await (await practiceRooms(
    new Request(`${ORIGIN}/api/practice/exams/${examId}/attempts/${startData.attemptId}`),
    `/api/practice/exams/${examId}/attempts/${startData.attemptId}`,
    { db, actor: studentActor, env: ENV, openDrive }
  )).json();
  assert.equal(revData.questions[0].media.length, 3);
  assert.ok(revData.questions[0].media.every((m) => m.url && m.url.includes('/api/practice-media?ticket=')));
});

test('storage_diagnostics degrades gracefully on legacy exam read timeout and purge_all_room_exams still clears it while preserving class exams', async () => {
  clearPracticeDriveCaches();
  const baseDb = createInMemoryPracticeDriveDb({
    exams: [
      {
        id: 'exam_hsa_legacy_blob',
        class_id: 'c12',
        title: 'HSA Legacy Blob',
        status: 'published',
        exam_type: 'hsa',
        questions: [
          {
            id: 'lq1',
            questionCode: 'LTCH-9001',
            version: 1,
            prompt: 'Legacy [[img:old1]]',
            media: [{ id: 'old1', dataUrl: 'data:image/png;base64,AAA=' }]
          }
        ],
        created_by: 'admin-1',
        updated_at: 1000
      },
      {
        id: 'class_exam_keep',
        class_id: 'c12',
        title: 'Class Exam Keep',
        status: 'published',
        exam_type: 'class',
        questions: [{ id: 'cq1', prompt: '1+1', type: 'short', accepted: ['2'], points: 1 }],
        created_by: 'admin-1',
        updated_at: 1000
      }
    ]
  });
  baseDb.tables.ltch_question_bank.push({
    id: 'qb_exam_hsa_legacy_blob_lq1',
    class_id: null,
    question_code: 'LTCH-9001',
    exam_type: 'hsa',
    version: 1,
    question: { id: 'lq1', questionCode: 'LTCH-9001' },
    status: 'active',
    created_by: 'admin-1',
    created_at: 1000
  });
  baseDb.tables.ltch_question_versions.push({
    question_code: 'LTCH-9001',
    version: 1,
    question: { id: 'lq1', questionCode: 'LTCH-9001' },
    edit_reason: 'legacy',
    created_by: 'admin-1',
    created_at: 1000
  });

  // Simulate PostgREST statement timeout when reading full JSONB from ltch_exams for the bloated legacy exam
  const wrappedDb = {
    tables: baseDb.tables,
    rpc: baseDb.rpc,
    from(tableName) {
      const builder = baseDb.from(tableName);
      if (tableName !== 'ltch_exams') return builder;
      let isEqLegacy = false;
      let isSelectStarOrQuestions = false;
      const origSelect = builder.select.bind(builder);
      const origEq = builder.eq.bind(builder);
      const origThen = builder.then.bind(builder);
      builder.select = (cols) => {
        if (!cols || cols === '*' || cols.includes('questions')) isSelectStarOrQuestions = true;
        return origSelect(cols);
      };
      builder.eq = (col, val) => {
        if (col === 'id' && val === 'exam_hsa_legacy_blob') isEqLegacy = true;
        return origEq(col, val);
      };
      builder.then = (resolve, reject) => {
        if (isEqLegacy && isSelectStarOrQuestions) {
          return Promise.resolve({
            data: null,
            error: { code: '57014', message: 'canceling statement due to statement timeout' }
          }).then(resolve, reject);
        }
        return origThen(resolve, reject);
      };
      return builder;
    }
  };

  const mock = createMockDrive();
  const openDrive = async () => mock.drive;
  const adminActor = { uid: 'admin-1', status: 'active', roles: ['admin'], memberships: [], childMemberships: [] };

  const diagRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'storage_diagnostics' })
    }),
    '/api/admin/practice/exams',
    { db: wrappedDb, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(diagRes.status, 200);
  const diag = await diagRes.json();
  assert.equal(diag.ok, true);
  assert.equal(diag.approximate, true);
  assert.equal(diag.examsCount, 1);
  assert.equal(diag.exams[0].id, 'exam_hsa_legacy_blob');
  assert.equal(diag.exams[0].approximate, true);

  const purgeRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'purge_all_room_exams' })
    }),
    '/api/admin/practice/exams',
    { db: wrappedDb, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(purgeRes.status, 200);
  const purge = await purgeRes.json();
  assert.equal(purge.purgedExams, 1);
  assert.equal(baseDb.tables.ltch_exams.length, 1);
  assert.equal(baseDb.tables.ltch_exams[0].id, 'class_exam_keep');
  assert.equal(baseDb.tables.ltch_question_bank.length, 0);
  assert.equal(baseDb.tables.ltch_question_versions.length, 0);
});

test('purge_all_room_exams incremental mode clears attempts, multiple exams, >60 bank/versions, and Drive folders across bounded steps while preserving class exams', async () => {
  clearPracticeDriveCaches();
  const db = createInMemoryPracticeDriveDb({
    exams: [
      { id: 'exam_hsa_1', class_id: null, title: 'HSA 1', status: 'published', exam_type: 'hsa', questions: [], created_by: 'admin-1', updated_at: 1000 },
      { id: 'exam_tsa_1', class_id: null, title: 'TSA 1', status: 'published', exam_type: 'tsa', questions: [], created_by: 'admin-1', updated_at: 1000 },
      { id: 'class_exam_keep', class_id: 'c12', title: 'Class Exam Keep', status: 'published', exam_type: 'class', questions: [{ id: 'cq1', prompt: '1+1', type: 'short', accepted: ['2'], points: 1 }], created_by: 'admin-1', updated_at: 1000 }
    ]
  });
  for (let i = 1; i <= 5; i++) {
    db.tables.ltch_practice_attempts.push({ id: `att_${i}`, exam_id: i <= 3 ? 'exam_hsa_1' : 'exam_tsa_1', uid: 'student-1', status: 'submitted', submitted_at: 2000, score: 1, max_score: 10, results: [] });
  }
  for (let i = 1; i <= 75; i++) {
    const code = `LTCH-${5000 + i}`;
    db.tables.ltch_question_bank.push({ id: `qb_exam_hsa_1_q${i}`, class_id: null, question_code: code, exam_type: 'hsa', version: 1, question: { id: `q${i}`, questionCode: code }, status: 'active', created_by: 'admin-1', created_at: 1000 });
    db.tables.ltch_question_versions.push({ question_code: code, version: 1, question: { id: `q${i}`, questionCode: code }, edit_reason: 'seed', created_by: 'admin-1', created_at: 1000 });
  }
  db.tables.ltch_question_bank.push({ id: 'qb_class_exam_keep_cq1', class_id: 'c12', question_code: 'LTCH-CLASS-1', exam_type: 'class', version: 1, question: { id: 'cq1' }, status: 'active', created_by: 'admin-1', created_at: 1000 });

  const mock = createMockDrive();
  const openDrive = async () => mock.drive;
  const folderId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: folderId, parentId: await mock.drive.rootId(), name: 'Old HSA Folder' });
  db.tables.ltch_drive_folders.push({ folder_key: 'practice:exam:exam_hsa_1', drive_folder_id: folderId, folder_name: 'Old HSA Folder', parent_folder_id: await mock.drive.rootId() });

  const adminActor = { uid: 'admin-1', status: 'active', roles: ['admin'], memberships: [], childMemberships: [] };
  const phases = [];
  let finalRes = null;
  for (let step = 0; step < 20; step++) {
    const res = await practiceRooms(
      new Request(`${ORIGIN}/api/admin/practice/exams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'purge_all_room_exams', incremental: true })
      }),
      '/api/admin/practice/exams',
      { db, actor: adminActor, env: ENV, openDrive }
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    phases.push(body.phase);
    if (body.done) {
      finalRes = body;
      break;
    }
  }

  assert.ok(phases.includes('attempts'));
  assert.ok(phases.includes('exams'));
  assert.ok(phases.includes('bank'));
  assert.equal(finalRes?.done, true);
  assert.equal(db.tables.ltch_practice_attempts.length, 0);
  assert.equal(db.tables.ltch_exams.length, 1);
  assert.equal(db.tables.ltch_exams[0].id, 'class_exam_keep');
  assert.equal(db.tables.ltch_question_bank.length, 1);
  assert.equal(db.tables.ltch_question_bank[0].id, 'qb_class_exam_keep_cq1');
  assert.equal(db.tables.ltch_question_versions.length, 0);
  assert.equal(db.tables.ltch_drive_folders.length, 0);
  assert.equal(mock.objects.get(folderId).trashed, true);
});

test('groupBulkExamSourceFiles accepts only Word (.docx) files across Đề HSA 01..10 and ignores temporary PDFs in both flat and folder modes', async () => {
  const flatFiles = [];
  const dirFiles = [];
  for (let i = 1; i <= 10; i++) {
    const num = String(i).padStart(2, '0');
    const folder = `Đề ${num}`;
    const pdfCount = i <= 8 ? 4 : 3;
    const names = [`Đề ${num}.docx`, ...Array.from({ length: pdfCount }, (_, k) => `Tài liệu ${num}-${k + 1}.pdf`)];
    for (const f of names) {
      const nfcName = f.normalize('NFC');
      flatFiles.push({ name: nfcName });
      dirFiles.push({ name: nfcName, webkitRelativePath: `Đề HSA/${folder.normalize('NFC')}/${nfcName}` });
    }
  }
  assert.equal(flatFiles.length, 48);

  const flatGrouped = groupBulkExamSourceFiles(flatFiles);
  assert.equal(flatGrouped.groups.length, 10);
  assert.equal(flatGrouped.unmatchedPdfs.length, 0);
  assert.equal(flatGrouped.ignoredCount, 38);
  assert.deepEqual(flatGrouped.groups.map((g) => g.orderNum), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(flatGrouped.groups.map((g) => g.docxFiles.length), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(flatGrouped.groups.map((g) => g.pdfFiles.length), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const dirGrouped = groupBulkExamSourceFiles(dirFiles);
  assert.equal(dirGrouped.groups.length, 10);
  assert.equal(dirGrouped.unmatchedPdfs.length, 0);
  assert.equal(dirGrouped.ignoredCount, 38);
  assert.deepEqual(dirGrouped.groups.map((g) => g.orderNum), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(dirGrouped.groups.map((g) => g.docxFiles.length), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(dirGrouped.groups.map((g) => g.pdfFiles.length), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const sameFolderGrouped = groupBulkExamSourceFiles([
    { name: 'Đề 01.docx', webkitRelativePath: 'HSA 2026/Đợt 1/Đề 01.docx' },
    { name: 'Đề 02.docx', webkitRelativePath: 'HSA 2026/Đợt 1/Đề 02.docx' },
    { name: 'Đề 03.docx', webkitRelativePath: 'HSA 2026/Đợt 2/Đề 03.docx' }
  ]);
  assert.equal(sameFolderGrouped.groups.length, 3);
  assert.deepEqual(sameFolderGrouped.groups.map((g) => g.docxFiles.length), [1, 1, 1]);
  assert.deepEqual(sameFolderGrouped.groups.map((g) => g.orderNum), [1, 2, 3]);

  const tsaBuf = await readFile(path.resolve('public/mau-dang-tai/Mau_dang_tai_TSA.docx'));
  const tsaParsedAsHsa = await parseWordExamFiles(
    [{ name: 'Mau_dang_tai_TSA.docx', arrayBuffer: async () => tsaBuf }],
    { expectedExamType: 'hsa' }
  );
  assert.equal(tsaParsedAsHsa.hasExamTypeCommand, true);
  assert.equal(tsaParsedAsHsa.meta.examType, 'tsa');
});

test('cold stage_drive_assets stays within <=26 DB+Drive calls while creating all 5 folders and cold Batch 1 verifies all 5 in parallel', async () => {
  clearPracticeDriveCaches();
  const baseDb = createInMemoryPracticeDriveDb();
  const mock = createMockDrive();

  const rootFolderId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: rootFolderId, parentId: 'root', name: 'Lớp Toán cô Hạnh' });
  const practiceRootId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: practiceRootId, parentId: rootFolderId, name: 'Phòng luyện' });
  const poolHsaId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: poolHsaId, parentId: practiceRootId, name: 'HSA' });
  baseDb.tables.ltch_drive_folders.push(
    { folder_key: 'ltch-root', drive_folder_id: rootFolderId, parent_folder_id: 'root', folder_name: 'Lớp Toán cô Hạnh' },
    { folder_key: 'practice:root', drive_folder_id: practiceRootId, parent_folder_id: rootFolderId, folder_name: 'Phòng luyện' },
    { folder_key: 'practice:pool:hsa', drive_folder_id: poolHsaId, parent_folder_id: practiceRootId, folder_name: 'HSA' }
  );

  let dbCalls = 0;
  let driveHttpCalls = 0;
  const countedDb = {
    tables: baseDb.tables,
    rpc(fn, args) {
      dbCalls++;
      return baseDb.rpc(fn, args);
    },
    from(tableName) {
      const builder = baseDb.from(tableName);
      const origThen = builder.then.bind(builder);
      builder.then = (resolve, reject) => {
        dbCalls++;
        return origThen(resolve, reject);
      };
      return builder;
    }
  };
  const countedDrive = new Proxy(mock.drive, {
    get(target, prop) {
      const val = target[prop];
      if (typeof val !== 'function' || prop === 'rootId') return val;
      return (...args) => {
        driveHttpCalls++;
        return val.apply(target, args);
      };
    }
  });

  const adminActor = { uid: 'admin-1', status: 'active', roles: ['admin'], memberships: [], childMemberships: [] };
  const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64');
  const pdfB64 = Buffer.from('%PDF-1.4\n%test\n').toString('base64');
  const docxB64 = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).toString('base64');

  const res0 = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'stage_drive_assets',
        examType: 'hsa',
        title: '[LTCH] Đề thi tham khảo HSA 01',
        assets: [
          { key: 'img1', kind: 'image', name: 'q1.png', mimeType: 'image/png', dataBase64: pngB64 },
          { key: 'src1', kind: 'source', name: 'de.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataBase64: docxB64 }
        ]
      })
    }),
    '/api/admin/practice/exams',
    { db: countedDb, actor: adminActor, env: ENV, openDrive: async () => countedDrive }
  );
  assert.equal(res0.status, 200);
  const body0 = await res0.json();
  assert.equal(body0.assets.length, 2);
  const batch0Calls = dbCalls + driveHttpCalls;
  // 4 access DB calls + <=23 stagePracticeDriveAssets (DB+Drive) calls = <=27 (was 43 before batching)
  assert.ok(batch0Calls <= 28, `Expected <=28 DB+Drive calls on cold Batch 0, got ${batch0Calls} (db=${dbCalls}, drive=${driveHttpCalls})`);

  const examId = body0.examId;
  const expectedNames = {
    [`practice:source:${examId}`]: 'File đề',
    [`practice:sol-video:${examId}`]: 'Video chữa',
    [`practice:sol-doc:${examId}`]: 'File tài liệu',
    [`practice:media:${examId}`]: 'Hình minh họa'
  };
  const examRow = baseDb.tables.ltch_drive_folders.find((r) => r.folder_key === `practice:exam:${examId}`);
  assert.ok(examRow?.drive_folder_id);
  for (const [k, folderTitle] of Object.entries(expectedNames)) {
    const row = baseDb.tables.ltch_drive_folders.find((r) => r.folder_key === k);
    assert.ok(row?.drive_folder_id, `Missing folder key ${k}`);
    const obj = mock.objects.get(row.drive_folder_id);
    assert.equal(obj?.name, folderTitle);
    assert.equal(obj?.parents?.[0], examRow.drive_folder_id);
    assert.equal(obj?.shared, false);
    assert.equal(obj?.trashed, false);
  }

  // Cold Batch 1 (simulating isolate eviction between batches)
  clearPracticeDriveCaches();
  dbCalls = 0;
  driveHttpCalls = 0;
  const res1 = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'stage_drive_assets',
        examId,
        examType: 'hsa',
        title: '[LTCH] Đề thi tham khảo HSA 01',
        assets: [
          { key: 'src2', kind: 'source', name: 'part1.pdf', mimeType: 'application/pdf', dataBase64: pdfB64 },
          { key: 'img2', kind: 'image', name: 'q2.png', mimeType: 'image/png', dataBase64: pngB64 }
        ]
      })
    }),
    '/api/admin/practice/exams',
    { db: countedDb, actor: adminActor, env: ENV, openDrive: async () => countedDrive }
  );
  assert.equal(res1.status, 200);
  const batch1Calls = dbCalls + driveHttpCalls;
  assert.ok(batch1Calls <= 20, `Expected <=20 DB+Drive calls on cold Batch 1, got ${batch1Calls} (db=${dbCalls}, drive=${driveHttpCalls})`);
});

test('clean_orphan_drive_folders trashes only orphaned practice folders and preserves active exams and pool hierarchy', async () => {
  clearPracticeDriveCaches();
  const db = createInMemoryPracticeDriveDb({
    exams: [
      { id: 'exam_hsa_active', class_id: null, title: 'Active HSA', status: 'published', exam_type: 'hsa', questions: [], created_by: 'admin-1', updated_at: 1000 }
    ]
  });
  const mock = createMockDrive();
  const openDrive = async () => mock.drive;

  const rootId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: rootId, parentId: 'root', name: 'Lớp Toán cô Hạnh' });
  const practiceRootId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: practiceRootId, parentId: rootId, name: 'Phòng luyện' });
  const poolHsaId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: poolHsaId, parentId: practiceRootId, name: 'HSA' });
  db.tables.ltch_drive_folders.push(
    { folder_key: 'ltch-root', drive_folder_id: rootId, parent_folder_id: 'root', folder_name: 'Lớp Toán cô Hạnh' },
    { folder_key: 'practice:root', drive_folder_id: practiceRootId, parent_folder_id: rootId, folder_name: 'Phòng luyện' },
    { folder_key: 'practice:pool:hsa', drive_folder_id: poolHsaId, parent_folder_id: practiceRootId, folder_name: 'HSA' }
  );

  const seedExamFolders = async (examId, name) => {
    const eid = await mock.drive.reserveId();
    await mock.drive.createFolder({ id: eid, parentId: poolHsaId, name });
    const childSpecs = [
      [`practice:source:${examId}`, 'File đề'],
      [`practice:sol-video:${examId}`, 'Video chữa'],
      [`practice:sol-doc:${examId}`, 'File tài liệu'],
      [`practice:media:${examId}`, 'Hình minh họa']
    ];
    db.tables.ltch_drive_folders.push({ folder_key: `practice:exam:${examId}`, drive_folder_id: eid, parent_folder_id: poolHsaId, folder_name: name });
    for (const [k, cname] of childSpecs) {
      const cid = await mock.drive.reserveId();
      await mock.drive.createFolder({ id: cid, parentId: eid, name: cname });
      db.tables.ltch_drive_folders.push({ folder_key: k, drive_folder_id: cid, parent_folder_id: eid, folder_name: cname });
    }
    return eid;
  };

  const activeFolderId = await seedExamFolders('exam_hsa_active', 'Active Folder');
  const orphan1FolderId = await seedExamFolders('exam_hsa_orphan_1', 'Orphan 1');
  const orphan2FolderId = await seedExamFolders('exam_hsa_orphan_2', 'Orphan 2');

  const teacherActor = { uid: 'teacher-1', status: 'active', roles: ['teacher'], memberships: [], childMemberships: [] };
  await assert.rejects(
    () => practiceRooms(
      new Request(`${ORIGIN}/api/admin/practice/exams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clean_orphan_drive_folders' })
      }),
      '/api/admin/practice/exams',
      { db, actor: teacherActor, env: ENV, openDrive }
    ),
    { status: 403 }
  );

  const adminActor = { uid: 'admin-1', status: 'active', roles: ['admin'], memberships: [], childMemberships: [] };
  const cleanRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'clean_orphan_drive_folders' })
    }),
    '/api/admin/practice/exams',
    { db, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(cleanRes.status, 200);
  const cleanBody = await cleanRes.json();
  assert.equal(cleanBody.ok, true);
  assert.equal(cleanBody.cleanedExamFolders, 2);
  assert.equal(cleanBody.cleanedFolderKeys, 10);
  assert.equal(cleanBody.remainingOrphanExams, 0);

  assert.equal(mock.objects.get(orphan1FolderId).trashed, true);
  assert.equal(mock.objects.get(orphan2FolderId).trashed, true);
  assert.equal(mock.objects.get(activeFolderId).trashed, false);
  assert.equal(mock.objects.get(poolHsaId).trashed, false);
  assert.equal(db.tables.ltch_drive_folders.length, 8);
});

test('prune_non_docx_exam_sources trashes only temporary PDFs from File đề and keeps docx, protected solution files, and pack.json intact', async () => {
  clearPracticeDriveCaches();
  const mock = createMockDrive();
  const openDrive = async () => mock.drive;

  const rootId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: rootId, parentId: 'root', name: 'Lớp Toán cô Hạnh' });
  const practiceRootId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: practiceRootId, parentId: rootId, name: 'Phòng luyện' });
  const poolHsaId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: poolHsaId, parentId: practiceRootId, name: 'HSA' });
  const examFolderId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: examFolderId, parentId: poolHsaId, name: 'HSA 01' });
  const sourceFolderId = await mock.drive.reserveId();
  await mock.drive.createFolder({ id: sourceFolderId, parentId: examFolderId, name: 'File đề' });

  const docxId = await mock.drive.reserveId();
  const pdfTemp1Id = await mock.drive.reserveId();
  const pdfTemp2Id = await mock.drive.reserveId();
  const pdfProtectedId = await mock.drive.reserveId();
  const packFileId = await mock.drive.reserveId();

  await mock.drive.upload({ id: docxId, parentId: sourceFolderId, name: 'de-01.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) });
  await mock.drive.upload({ id: pdfTemp1Id, parentId: sourceFolderId, name: 'toan.pdf', contentType: 'application/pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) });
  await mock.drive.upload({ id: pdfTemp2Id, parentId: sourceFolderId, name: 'ly.pdf', contentType: 'application/pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) });
  await mock.drive.upload({ id: pdfProtectedId, parentId: sourceFolderId, name: 'sol-protected.pdf', contentType: 'application/pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) });
  await mock.drive.upload({ id: packFileId, parentId: examFolderId, name: 'de-luyen-v1000.json', contentType: 'application/json', bytes: new TextEncoder().encode('{}') });

  const docxMeta = { name: 'de-01.docx', driveFileId: docxId, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 4 };
  const pdfTemp1Meta = { name: 'toan.pdf', driveFileId: pdfTemp1Id, mimeType: 'application/pdf', size: 5 };
  const pdfTemp2Meta = { name: 'ly.pdf', driveFileId: pdfTemp2Id, mimeType: 'application/pdf', size: 5 };
  const pdfProtectedMeta = { name: 'sol-protected.pdf', driveFileId: pdfProtectedId, mimeType: 'application/pdf', size: 5 };

  const db = createInMemoryPracticeDriveDb({
    exams: [
      {
        id: 'exam_hsa_1',
        class_id: null,
        title: 'HSA 1',
        status: 'published',
        exam_type: 'hsa',
        exam_code: '01',
        duration_minutes: 195,
        target_grade: 12,
        school_year_id: 'year-2026-2027',
        sections: [],
        questions: [
          {
            id: 'q1',
            questionCode: 'LTCH-1',
            _examMeta: {
              storage: 'drive',
              examType: 'hsa',
              examCode: '01',
              targetGrade: 12,
              schoolYearId: 'year-2026-2027',
              durationMinutes: 195,
              sectionConfig: [],
              updatedAt: 1000,
              driveFolderId: examFolderId,
              driveSourceFolderId: sourceFolderId,
              drivePackFileId: packFileId,
              drivePackSha256: 'a'.repeat(64),
              drivePackSize: 2,
              sourceFiles: [docxMeta, pdfTemp1Meta, pdfTemp2Meta, pdfProtectedMeta]
            }
          }
        ],
        created_by: 'admin-1',
        updated_at: 1000
      }
    ]
  });
  (db.tables.ltch_practice_solution_files ||= []).push({
    id: 'sol_keep_1',
    exam_id: 'exam_hsa_1',
    file_kind: 'exam_file',
    drive_file_id: pdfProtectedId
  });

  const teacherActor = { uid: 'teacher-1', status: 'active', roles: ['teacher'], memberships: [], childMemberships: [] };
  await assert.rejects(
    () => practiceRooms(
      new Request(`${ORIGIN}/api/admin/practice/exams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'prune_non_docx_exam_sources' })
      }),
      '/api/admin/practice/exams',
      { db, actor: teacherActor, env: ENV, openDrive }
    ),
    { status: 403 }
  );

  const adminActor = { uid: 'admin-1', status: 'active', roles: ['admin'], memberships: [], childMemberships: [] };
  const pruneRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prune_non_docx_exam_sources' })
    }),
    '/api/admin/practice/exams',
    { db, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(pruneRes.status, 200);
  const pruneBody = await pruneRes.json();
  assert.equal(pruneBody.ok, true);
  assert.equal(pruneBody.updatedExams, 1);
  assert.equal(pruneBody.trashedFiles, 2);
  assert.equal(pruneBody.remainingExams, 0);

  assert.equal(mock.objects.get(pdfTemp1Id).trashed, true);
  assert.equal(mock.objects.get(pdfTemp2Id).trashed, true);
  assert.equal(mock.objects.get(docxId).trashed, false);
  assert.equal(mock.objects.get(pdfProtectedId).trashed, false);
  assert.equal(mock.objects.get(packFileId).trashed, false);

  const savedSources = db.tables.ltch_exams[0].questions[0]._examMeta.sourceFiles;
  assert.deepEqual(savedSources.map((s) => s.driveFileId), [docxId, pdfProtectedId]);
  assert.equal(db.tables.ltch_exams[0].questions[0]._examMeta.drivePackFileId, packFileId);
});

test('re-importing Word into an existing Drive exam preserves question codes, bumps changed versions, and avoids PK conflicts', async () => {
  clearPracticeDriveCaches();
  const db = createInMemoryPracticeDriveDb({
    accounts: [{ uid: 'admin-1', display_name: 'Cô Hạnh', email: 'admin@example.com', status: 'active', roles: ['admin'] }]
  });
  const mock = createMockDrive();
  const openDrive = async () => mock.drive;
  const adminActor = { uid: 'admin-1', status: 'active', roles: ['admin'], memberships: [], childMemberships: [] };

  const tinyPng1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const tinyPng2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  // 1. Phát hành đề ban đầu 2 câu lên Google Drive
  const initialRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'publish',
        allowPartialStructure: true,
        isNewExam: true,
        examType: 'hsa',
        examMode: 'full',
        targetGrade: 12,
        examCode: '308',
        title: '[LTCH] Đề HSA 308',
        durationMinutes: 195,
        questions: [
          {
            id: 'q_1',
            section: 'part_1',
            type: 'single',
            points: 1,
            prompt: 'Câu 1 gốc',
            options: ['A', 'B', 'C', 'D'],
            answer: 'A'
          },
          {
            id: 'q_2',
            section: 'part_1',
            type: 'single',
            points: 1,
            prompt: 'Câu 2 gốc',
            media: [{ id: 'img_2', dataUrl: tinyPng1 }],
            options: ['1', '2', '3', '4'],
            answer: 'B'
          }
        ]
      })
    }),
    '/api/admin/practice/exams',
    { db, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(initialRes.status, 201);
  const initialBody = await initialRes.json();
  const examId = initialBody.examId;
  const code1 = initialBody.questions[0].questionCode;
  const code2 = initialBody.questions[1].questionCode;
  assert.ok(code1 && code2);

  // Mô phỏng đề cũ trên DB từng có updated_at = null và một hàng mồ côi chiếm sẵn slot qb_${examId}_q_3
  const storedExam = db.tables.ltch_exams.find((e) => e.id === examId);
  storedExam.updated_at = null;
  db.tables.ltch_question_bank.push({
    id: `qb_${examId}_q_3`,
    class_id: null,
    question_code: 'LTCH-ORPHAN-3',
    exam_type: 'hsa',
    version: 1,
    question: { id: 'q_3', questionCode: 'LTCH-ORPHAN-3', version: 1 },
    status: 'active',
    created_by: 'admin-1',
    created_at: 500
  });

  // 2. Sửa đề -> Nhập Word mới (không có questionCode gửi lên từ client, đổi ảnh câu 2 và thêm câu 3)
  const updateRes = await practiceRooms(
    new Request(`${ORIGIN}/api/admin/practice/exams`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'publish',
        allowPartialStructure: true,
        isNewExam: false,
        examId,
        examType: 'hsa',
        examMode: 'full',
        targetGrade: 12,
        examCode: '308',
        title: '[LTCH] Đề HSA 308 (Cập nhật)',
        durationMinutes: 195,
        questions: [
          {
            id: 'q_1',
            section: 'part_1',
            type: 'single',
            points: 1,
            prompt: 'Câu 1 gốc',
            options: ['A', 'B', 'C', 'D'],
            answer: 'A'
          },
          {
            id: 'q_2',
            section: 'part_1',
            type: 'single',
            points: 1,
            prompt: 'Câu 2 gốc',
            media: [{ id: 'img_2', dataUrl: tinyPng2 }],
            options: ['1', '2', '3', '4'],
            answer: 'B'
          },
          {
            id: 'q_3',
            section: 'part_1',
            type: 'single',
            points: 1,
            prompt: 'Câu 3 mới thêm',
            options: ['X', 'Y', 'Z', 'T'],
            answer: 'C'
          }
        ]
      })
    }),
    '/api/admin/practice/exams',
    { db, actor: adminActor, env: ENV, openDrive }
  );
  assert.equal(updateRes.status, 201);
  const updateBody = await updateRes.json();
  assert.equal(updateBody.questionCount, 3);
  assert.equal(updateBody.questions[0].questionCode, code1);
  assert.equal(updateBody.questions[0].version, 1);
  assert.equal(updateBody.questions[1].questionCode, code2);
  assert.equal(updateBody.questions[1].version, 2);
  assert.ok(updateBody.questions[2].questionCode && updateBody.questions[2].questionCode !== 'LTCH-ORPHAN-3');

  // Xác nhận phiên bản trong gói Drive khớp với stub lưu trong Supabase
  const updatedExamRow = db.tables.ltch_exams.find((e) => e.id === examId);
  assert.equal(updatedExamRow.questions[1].version, 2);
  const q3BankRow = db.tables.ltch_question_bank.find(
    (r) => r.question_code === updateBody.questions[2].questionCode
  );
  assert.equal(q3BankRow.id, `qb_${examId}_${updateBody.questions[2].questionCode}`);
});
