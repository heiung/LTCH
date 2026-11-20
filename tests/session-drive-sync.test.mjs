import test from 'node:test';
import assert from 'node:assert/strict';
import { business } from '../worker/business.mjs';
import { lessons } from '../worker/lessons.mjs';
import { encodeAssignmentSessionInstructions } from '../shared/classroom.mjs';

function createMockDb(initialTables = {}) {
  const tables = {
    ltch_classes: [],
    ltch_school_years: [],
    ltch_lessons: [],
    ltch_lesson_files: [],
    ltch_drive_folders: [],
    ltch_assignments: [],
    ...initialTables
  };

  return {
    tables,
    from(table) {
      tables[table] ??= [];
      const predicates = [];
      let pendingOp = 'select';
      let pendingPayload = null;
      let upsertOpts = null;
      let orderBy = null;
      let maxRows = null;

      const matches = row => predicates.every(fn => fn(row));

      const execute = () => {
        if (pendingOp === 'insert') {
          const items = Array.isArray(pendingPayload) ? pendingPayload : [pendingPayload];
          const inserted = items.map(item => ({ ...item }));
          tables[table].push(...inserted);
          return { data: inserted, error: null };
        }
        if (pendingOp === 'upsert') {
          const items = Array.isArray(pendingPayload) ? pendingPayload : [pendingPayload];
          const keys = String(upsertOpts?.onConflict || 'id')
            .split(',')
            .map(k => k.trim())
            .filter(Boolean);
          const upserted = [];
          for (const raw of items) {
            const existing = tables[table].find(r => keys.every(k => r[k] === raw[k]));
            if (existing) {
              Object.assign(existing, raw);
              upserted.push({ ...existing });
            } else {
              const copy = { ...raw };
              tables[table].push(copy);
              upserted.push({ ...copy });
            }
          }
          return { data: upserted, error: null };
        }
        if (pendingOp === 'update') {
          const updated = [];
          for (const row of tables[table]) {
            if (matches(row)) {
              Object.assign(row, pendingPayload);
              updated.push({ ...row });
            }
          }
          return { data: updated, error: null };
        }
        if (pendingOp === 'delete') {
          const removed = [];
          tables[table] = tables[table].filter(row => {
            if (matches(row)) {
              removed.push({ ...row });
              return false;
            }
            return true;
          });
          return { data: removed, error: null };
        }

        let rows = tables[table].filter(matches).map(r => ({ ...r }));
        if (orderBy) {
          const { column, ascending } = orderBy;
          rows.sort((a, b) => {
            if (a[column] === b[column]) return 0;
            const cmp = a[column] < b[column] ? -1 : 1;
            return ascending ? cmp : -cmp;
          });
        }
        if (typeof maxRows === 'number') {
          rows = rows.slice(0, maxRows);
        }
        return { data: rows, error: null };
      };

      const q = {
        select() {
          return this;
        },
        eq(k, v) {
          predicates.push(row => row[k] === v);
          return this;
        },
        neq(k, v) {
          predicates.push(row => row[k] !== v);
          return this;
        },
        in(k, values) {
          const set = new Set(Array.isArray(values) ? values : []);
          predicates.push(row => set.has(row[k]));
          return this;
        },
        like(k, pattern) {
          const re = new RegExp(`^${String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`);
          predicates.push(row => re.test(String(row[k] ?? '')));
          return this;
        },
        ilike(k, pattern) {
          const re = new RegExp(`^${String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i');
          predicates.push(row => re.test(String(row[k] ?? '')));
          return this;
        },
        order(column, opts = {}) {
          orderBy = { column, ascending: opts.ascending !== false };
          return this;
        },
        limit(n) {
          maxRows = Number(n);
          return this;
        },
        insert(value) {
          pendingOp = 'insert';
          pendingPayload = value;
          return this;
        },
        upsert(value, opts = {}) {
          pendingOp = 'upsert';
          pendingPayload = value;
          upsertOpts = opts;
          return this;
        },
        update(value) {
          pendingOp = 'update';
          pendingPayload = value;
          return this;
        },
        delete() {
          pendingOp = 'delete';
          return this;
        },
        maybeSingle() {
          const res = execute();
          const row = Array.isArray(res.data) ? res.data[0] || null : res.data || null;
          return Promise.resolve({ data: row, error: res.error });
        },
        single() {
          const res = execute();
          const row = Array.isArray(res.data) ? res.data[0] || null : res.data || null;
          return Promise.resolve({ data: row, error: row ? res.error : { message: 'Not found' } });
        },
        then(resolve, reject) {
          return Promise.resolve(execute()).then(resolve, reject);
        }
      };
      return q;
    }
  };
}

function createDriveFixture() {
  const objects = new Map();
  const renamed = [];
  const trashed = [];
  let counter = 0;

  const drive = {
    async rootId() {
      return 'root';
    },
    async reserveId() {
      return `drive_${++counter}`;
    },
    async isRootChild({ id, name }) {
      const obj = objects.get(id);
      return Boolean(obj && obj.name === name && obj.parents[0] === 'root' && !obj.trashed);
    },
    async metadata({ id }) {
      const obj = objects.get(id);
      if (!obj || obj.trashed) {
        const e = Error('Not found');
        e.code = 'not_found';
        throw e;
      }
      return obj;
    },
    async createFolder({ id, parentId, name }) {
      if (objects.has(id)) {
        const e = Error('Conflict');
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
    },
    async rename({ id, name }) {
      const obj = objects.get(id);
      assert.ok(obj && obj.ownedByMe, `Expected existing Drive folder ${id} for rename`);
      obj.name = name;
      renamed.push({ id, name });
      return { id, name };
    },
    async trash({ id }) {
      const obj = objects.get(id);
      if (obj) obj.trashed = true;
      trashed.push(id);
      return { id, trashed: true };
    },
    async upload({ id, parentId, name, contentType, bytes, sha256 }) {
      if (objects.has(id)) {
        const e = Error('Conflict');
        e.code = 'conflict';
        throw e;
      }
      objects.set(id, {
        id,
        name,
        mimeType: contentType,
        parents: [parentId],
        size: String(bytes.length),
        appProperties: { ltchSha256: sha256 },
        shared: false,
        ownedByMe: true,
        trashed: false,
        bytes
      });
    },
    async permissions() {
      return [{ type: 'user', role: 'owner' }];
    },
    async download({ id }) {
      return new Response(objects.get(id).bytes);
    }
  };

  return { drive, objects, renamed, trashed };
}

const adminActor = {
  uid: 'admin-1',
  status: 'active',
  roles: ['admin'],
  memberships: [],
  childMemberships: []
};

const env = {
  LTCH_LESSONS_ENABLED: '1',
  LTCH_LESSONS_AUDIENCE: 'all',
  MAIL_SECRET: 'test-only-key-material-not-used-in-production'
};

function jsonReq(path, body = null) {
  return new Request(`https://example.test${path}`, body ? {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  } : { method: 'GET' });
}

function fileUploadReq(path, name, text, requestId) {
  const form = new FormData();
  form.set('file', new File([text], name, { type: 'application/pdf' }));
  form.set('requestId', requestId);
  return new Request(`https://example.test${path}`, { method: 'POST', body: form });
}

test('full web-to-Drive lifecycle: hide unedited placeholders, add_session creates folder, uploads land inside it, rename updates in-place, delete trashes targets', async () => {
  const db = createMockDb({
    ltch_classes: [{
      id: 'c12',
      name: '12',
      school_year_id: 'y1',
      schedule: 'Thứ 4, 7: 18h00 - 20h00',
      schedule_slots: [{ dayOfWeek: 3, start: '18:00', end: '20:00' }]
    }],
    ltch_school_years: [{ id: 'y1', name: '2026-2027' }],
    // Legacy unedited placeholder rows without |x:1 or files must NOT surface or auto-seed 50 fake sessions
    ltch_lessons: [
      { id: 'ses-c12-01', class_id: 'c12', title: 'Buổi 1', topic: '||s:1|d:2026-09-02|t:|c:0', created_at: 100 },
      { id: 'ses-c12-02', class_id: 'c12', title: 'Buổi 2', topic: '||s:2|d:2026-09-05|t:|c:0', created_at: 101 }
    ]
  });
  const mock = createDriveFixture();
  const openDrive = async () => mock.drive;
  const sessionsPath = '/api/classes/c12/sessions';

  // 1. Placeholder rows without explicit flag/content return [] (no 50 fake sessions)
  const initialRes = await business(jsonReq(sessionsPath), sessionsPath, { db, actor: adminActor, env, openDrive });
  assert.equal(initialRes.status, 200);
  const initialJson = await initialRes.json();
  assert.deepEqual(initialJson.sessions, []);
  assert.equal(initialJson.driveAvailable, true);

  // 2. add_session creates Buổi 1 immediately AND provisions its Google Drive folder
  const addRes = await business(
    jsonReq(sessionsPath, {
      action: 'add_session',
      sessionNumber: 1,
      lessonName: 'Cực trị hàm số',
      cleanTopic: 'Giải tích 12',
      date: '2026-09-05',
      start: '18:00',
      end: '20:00'
    }),
    sessionsPath,
    { db, actor: adminActor, env, openDrive }
  );
  assert.equal(addRes.status, 201);
  const addJson = await addRes.json();
  assert.equal(addJson.ok, true);
  assert.equal(addJson.driveSynced, true);
  assert.equal(addJson.session.sessionNumber, 1);
  assert.equal(addJson.session.explicit, true);
  assert.equal(addJson.session.driveSynced, true);

  const folderRecord = db.tables.ltch_drive_folders.find(f => f.folder_key === 'lesson:ses-c12-01');
  assert.ok(folderRecord, 'Expected ltch_drive_folders row for lesson:ses-c12-01');
  const sessionFolderId = folderRecord.drive_folder_id;
  const driveFolderObj = mock.objects.get(sessionFolderId);
  assert.ok(driveFolderObj, 'Expected Google Drive folder to be created immediately');
  assert.match(driveFolderObj.name, /^Buổi 1 - Cực trị hàm số \[ses-c12-01\]$/);

  const afterAddRes = await business(jsonReq(sessionsPath), sessionsPath, { db, actor: adminActor, env, openDrive });
  const afterAddJson = await afterAddRes.json();
  assert.equal(afterAddJson.sessions.length, 1);
  assert.equal(afterAddJson.sessions[0].driveSynced, true);
  assert.equal(afterAddJson.sessions[0].lessonName, 'Cực trị hàm số');

  // 3. Upload both lecture document & homework worksheet into ses-c12-01 -> both land inside sessionFolderId
  const filesPath = '/api/classes/c12/lessons/ses-c12-01/files';
  const lecUploadRes = await lessons(
    fileUploadReq(filesPath, 'BaiGiang.pdf', 'lecture pdf content', 'request-id-lecture-1234'),
    filesPath,
    { db, actor: adminActor, env, openDrive }
  );
  assert.equal(lecUploadRes.status, 201);

  const hwUploadRes = await lessons(
    fileUploadReq(filesPath, '[BTVN] Phieu_1.pdf', 'homework pdf content', 'request-id-homework-1234'),
    filesPath,
    { db, actor: adminActor, env, openDrive }
  );
  assert.equal(hwUploadRes.status, 201);

  assert.equal(db.tables.ltch_lesson_files.length, 2);
  const lecFileRow = db.tables.ltch_lesson_files.find(f => f.name === 'BaiGiang.pdf');
  const hwFileRow = db.tables.ltch_lesson_files.find(f => f.name === '[BTVN] Phieu_1.pdf');
  assert.ok(lecFileRow && hwFileRow);
  assert.equal(mock.objects.get(lecFileRow.drive_file_id).parents[0], sessionFolderId);
  assert.equal(mock.objects.get(hwFileRow.drive_file_id).parents[0], sessionFolderId);

  // 4. Rename session on web -> calls drive.rename in-place preserving sessionFolderId & uploaded files inside
  const renameRes = await business(
    jsonReq(sessionsPath, {
      action: 'update_session',
      sessionNumber: 1,
      lessonName: 'Cực trị nâng cao',
      cleanTopic: 'Giải tích 12',
      date: '2026-09-05',
      start: '18:00',
      end: '20:00'
    }),
    sessionsPath,
    { db, actor: adminActor, env, openDrive }
  );
  assert.equal(renameRes.status, 200);
  assert.equal(mock.renamed.length, 1);
  assert.equal(mock.renamed[0].id, sessionFolderId);
  assert.equal(mock.renamed[0].name, 'Buổi 1 - Cực trị nâng cao [ses-c12-01]');
  assert.equal(folderRecord.drive_folder_id, sessionFolderId);
  assert.equal(mock.objects.get(lecFileRow.drive_file_id).parents[0], sessionFolderId);
  assert.equal(mock.objects.get(hwFileRow.drive_file_id).parents[0], sessionFolderId);

  // 5. delete_file trashes only the chosen file on Drive & deletes its DB record
  const delFileRes = await business(
    jsonReq(sessionsPath, { action: 'delete_file', fileId: lecFileRow.id }),
    sessionsPath,
    { db, actor: adminActor, env, openDrive }
  );
  assert.equal(delFileRes.status, 200);
  assert.equal(mock.objects.get(lecFileRow.drive_file_id).trashed, true);
  assert.equal(mock.objects.get(hwFileRow.drive_file_id).trashed, false);
  assert.equal(db.tables.ltch_lesson_files.length, 1);

  // 6. Add linked session assignment, then delete_session trashes remaining file + folder, deletes DB rows & archives assignment
  db.tables.ltch_assignments.push({
    id: 'assign-ses-1',
    class_id: 'c12',
    title: 'Buổi 1: BTVN Cực trị',
    instructions: encodeAssignmentSessionInstructions({
      sessionNumber: 1,
      lessonId: 'ses-c12-01',
      instructions: 'Làm hết phiếu BTVN'
    }),
    status: 'published',
    opens_at: 1000,
    closes_at: 9999999999999
  });

  const delSessionRes = await business(
    jsonReq(sessionsPath, { action: 'delete_session', sessionNumber: 1 }),
    sessionsPath,
    { db, actor: adminActor, env, openDrive }
  );
  assert.equal(delSessionRes.status, 200);
  const delSessionJson = await delSessionRes.json();
  assert.equal(delSessionJson.deletedSessionNumber, 1);
  assert.equal(mock.objects.get(hwFileRow.drive_file_id).trashed, true);
  assert.equal(mock.objects.get(sessionFolderId).trashed, true);
  assert.equal(db.tables.ltch_lesson_files.length, 0);
  assert.equal(db.tables.ltch_lessons.some(l => l.id === 'ses-c12-01'), false);
  assert.equal(db.tables.ltch_drive_folders.some(f => f.folder_key === 'lesson:ses-c12-01'), false);
  assert.equal(db.tables.ltch_assignments[0].status, 'archived');

  const finalRes = await business(jsonReq(sessionsPath), sessionsPath, { db, actor: adminActor, env, openDrive });
  const finalJson = await finalRes.json();
  assert.deepEqual(finalJson.sessions, []);
});
