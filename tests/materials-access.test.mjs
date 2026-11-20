import test from 'node:test';
import assert from 'node:assert/strict';
import {business} from '../worker/business.mjs';
import {lessons} from '../worker/lessons.mjs';

const parent = {uid:'parent',status:'active',roles:['parent'],memberships:[],childMemberships:[{class_id:'c',uid:'child'}]};
const student = {uid:'student',status:'active',roles:['student'],memberships:[{class_id:'c',member_role:'student'}],childMemberships:[]};
const assistant = {uid:'assistant',status:'active',roles:['assistant'],memberships:[{class_id:'c',member_role:'assistant',permissions:[]}],childMemberships:[]};
const driveEnv = {
  LTCH_LESSONS_ENABLED: '1',
  LTCH_LESSONS_AUDIENCE: 'all',
  GOOGLE_DRIVE_CLIENT_ID: 'id',
  GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'refresh'
};

function lessonFilesDb(rows) {
  return {
    from(table) {
      if (table === 'ltch_lessons') {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() { return Promise.resolve({data:{id:'l1',class_id:'c'},error:null}); }
        };
      }
      assert.equal(table, 'ltch_lesson_files');
      let selected = [...rows], cursor;
      return {
        select() { return this; },
        eq(key, value) { selected = selected.filter(row => row[key] === value); return this; },
        or(value) { cursor = value; return this; },
        order() { return this; },
        limit(n) {
          selected.sort((a, b) => b.created_at - a.created_at || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1));
          if (cursor) {
            const match = /^created_at\.lt\.(\d+),and\(created_at\.eq\.\1,id\.lt\.([A-Za-z0-9_-]+)\)$/.exec(cursor);
            assert.ok(match);
            selected = selected.filter(row => row.created_at < Number(match[1]) || (row.created_at === Number(match[1]) && row.id < match[2]));
          }
          return Promise.resolve({data:selected.slice(0, n),error:null});
        }
      };
    }
  };
}

test('parents page through their child’s stored Drive lesson files without skipping equal timestamps', async () => {
  const rows = Array.from({length:205}, (_, i) => ({
    id: `f${String(i).padStart(3, '0')}`,
    class_id: 'c',
    lesson_id: 'l1',
    name: `Tai-lieu-${i}.pdf`,
    content_type: 'application/pdf',
    file_size: 1024,
    status: 'stored',
    created_at: 1000
  }));
  rows.push(
    {id:'other',class_id:'other',lesson_id:'l1',status:'stored',created_at:900},
    {id:'pending',class_id:'c',lesson_id:'l1',status:'pending',created_at:900}
  );
  const db = lessonFilesDb(rows);
  const all = [];
  let cursor = {createdAt:1001,id:'z'}, more = true;
  while (more) {
    const params = new URLSearchParams({beforeCreatedAt:String(cursor.createdAt),beforeId:cursor.id});
    const path = '/api/classes/c/lessons/l1/files';
    const response = await lessons(new Request(`https://test${path}?${params}`), path, {db, actor:parent, env:driveEnv});
    const page = await response.json();
    all.push(...page.items);
    more = page.hasMore;
    if (page.items.length) {
      const last = page.items.at(-1);
      cursor = {createdAt:last.created_at,id:last.id};
    }
  }
  assert.equal(all.length, 205);
  assert.equal(new Set(all.map(row => row.id)).size, 205);
});

test('retired legacy /materials endpoints are rejected and Drive lessons reject unauthorized classes', async () => {
  const db = lessonFilesDb([{id:'f1',class_id:'other',lesson_id:'l1',status:'stored',created_at:1000}]);
  await assert.rejects(
    lessons(new Request('https://test/api/classes/other/lessons/l1/files'), '/api/classes/other/lessons/l1/files', {db, actor:parent, env:driveEnv}),
    e => e.status === 403
  );
  for (const legacyPath of ['/api/classes/c/materials', '/api/materials/m1/file', '/api/classes/c/materials/m1']) {
    await assert.rejects(
      business(new Request(`https://test${legacyPath}`), legacyPath, {db:{from(){throw Error('must not query legacy materials');}}, actor:parent, env:{}}),
      e => e.status === 404
    );
  }
});

test('parents, students and assistants without materials permission cannot create or upload Drive lesson files', async () => {
  const db = {from(){throw Error('Unauthorized writes must not query database');}};
  const path = '/api/classes/c/lessons';
  for (const actor of [parent, student, assistant]) {
    const request = new Request('https://test' + path, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({title: 'Attempted lesson'})
    });
    await assert.rejects(lessons(request, path, {db, actor, env:driveEnv}), e => e.status === 403);
  }
});
