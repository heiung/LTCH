import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { comparePracticeExamSequence } from '../client/practice-rooms.mjs';
import {
  canManagePracticePool,
  hydrateAttemptQuestionsMediaFromExam,
  matchesPracticeGradePool,
  practiceRooms,
  saveAttemptRowToDb,
  selectAndShuffleSectionQuestions,
  shuffleUnitsPreservingClusters
} from '../worker/practice-rooms.mjs';
import { compactQuestionStub } from '../worker/practice-drive.mjs';
import { buildAppRoutePath, parseAppRoutePath } from '../shared/classroom.mjs';

test('HSA reference exam comes first and numbered HSA and TSA sets use numeric order', () => {
  const hsa = [
    { examType: 'hsa', examCode: '10', title: '[LTCH] Đề thi tham khảo HSA 10' },
    { examType: 'hsa', examCode: '02', title: '[LTCH] Đề thi tham khảo HSA 02' },
    { examType: 'hsa', examCode: '308', title: '[LTCH] Đề tham khảo Kỳ thi Đánh giá năng lực HSA – ĐHQGHN' },
    { examType: 'hsa', examCode: '01', title: '[LTCH] Đề thi tham khảo HSA 01' }
  ];
  assert.deepEqual(hsa.sort(comparePracticeExamSequence).map(exam => exam.examCode), ['308', '01', '02', '10']);

  const tsa = ['25', 'TSA-01', '10', '2', '01'].map(examCode => ({ examType: 'tsa', examCode }));
  assert.deepEqual(tsa.sort(comparePracticeExamSequence).map(exam => exam.examCode), ['01', '2', '10', '25', 'TSA-01']);
});

function createInMemoryPracticeDb(seed = {}) {
  const tables = {
    ltch_classes: [...(seed.classes || [])],
    ltch_school_years: [
      ...(seed.schoolYears || [
        { id: 'year-2026-2027', name: '2026 - 2027', starts_on: '2026-08-01', ends_on: '2027-06-30' },
        { id: 'year-2025-2026', name: '2025 - 2026', starts_on: '2025-08-01', ends_on: '2026-06-30' }
      ])
    ],
    ltch_accounts: [...(seed.accounts || [])],
    ltch_student_grade_history: [...(seed.gradeHistory || [])],
    ltch_exams: [...(seed.exams || [])],
    ltch_exam_year_shares: [...(seed.shares || [])],
    ltch_practice_attempts: [...(seed.attempts || [])],
    ltch_question_bank: [],
    ltch_question_versions: [],
    ltch_question_reports: []
  };
  let seq = 1000;

  function makeBuilder(tableName) {
    const state = {
      op: 'select',
      filters: [],
      payload: null,
      single: false
    };
    const builder = {
      select(columns) {
        state.columns = columns;
        return builder;
      },
      eq(col, val) {
        state.filters.push((row) => row[col] === val);
        return builder;
      },
      in(col, vals) {
        const set = new Set(vals);
        state.filters.push((row) => set.has(row[col]));
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        state.single = true;
        return builder;
      },
      single() {
        state.single = true;
        return builder;
      },
      insert(payload) {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      upsert(payload, opts = {}) {
        state.op = 'upsert';
        state.payload = payload;
        state.onConflict = opts.onConflict || 'id';
        return builder;
      },
      update(payload) {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      delete() {
        state.op = 'delete';
        return builder;
      },
      then(resolve, reject) {
        try {
          const rows = tables[tableName] || (tables[tableName] = []);
          const match = (r) => state.filters.every((fn) => fn(r));
          if (state.op === 'select') {
            let matched = rows.filter(match);
            if (tableName === 'ltch_practice_attempts' && state.columns?.includes('legacy_attemptNo:')) {
              matched = matched.map(row => Object.fromEntries(state.columns.split(',').map(column => {
                const [alias, jsonPath] = column.split(':');
                const value = jsonPath
                  ? jsonPath.split('->').reduce((node, key) => node?.[key], row)
                  : row[column];
                return [alias, value ?? null];
              })));
            }
            return Promise.resolve({
              data: state.single ? matched[0] || null : matched,
              error: null
            }).then(resolve, reject);
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
              if (idx >= 0) rows[idx] = { ...rows[idx], ...item };
              else rows.push(item);
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
            const removed = rows.filter((r) => match(r));
            const kept = rows.filter((r) => !match(r));
            tables[tableName] = kept;
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
    from(name) {
      return makeBuilder(name);
    },
    async rpc(fnName, args) {
      if (fnName === 'ltch_reserve_question_codes') {
        return { data: Array.from({ length: args.p_count }, () => `LTCH-${++seq}`), error: null };
      }
      if (fnName === 'ltch_save_room_exam') {
        const save=(table,row,keys)=>{const idx=table.findIndex(r=>keys.every(k=>r[k]===row[k]));if(idx<0)table.push(row);else table[idx]={...table[idx],...row};};
        save(tables.ltch_exams,args.p_exam,['id']);
        for(const row of args.p_bank)save(tables.ltch_question_bank,row,['question_code']);
        for(const row of args.p_versions)save(tables.ltch_question_versions,row,['question_code','version']);
        return {data:null,error:null};
      }
      if(fnName==='ltch_practice_stats'){
        const rows=[];
        for(const examId of args.p_exam_ids){const attempts=tables.ltch_practice_attempts.filter(a=>a.exam_id===examId&&a.status==='submitted'&&!a.is_preview);if(!attempts.length)continue;const row={exam_id:examId,total:attempts.length,b0:0,b1:0,b2:0,b3:0,b4:0};for(const a of attempts)if(a.max_score>0)row[`b${Math.min(4,Math.max(0,Math.floor(a.score/a.max_score*5)))}`]++;rows.push(row);}
        return {data:rows,error:null};
      }
      return { data: null, error: null };
    }
  };
}

test('canManagePracticePool enforces grade-scoped assistant permissions', () => {
  const classes = [
    { id: 'c10', name: 'Lớp 10A', archived: false },
    { id: 'c11', name: 'Lớp 11A', archived: false },
    { id: 'c12', name: 'Lớp 12A', archived: false }
  ];

  const teacher = { uid: 't1', status: 'active', roles: ['teacher'], memberships: [] };
  assert.equal(canManagePracticePool(teacher, classes, 'thptqg', 10), true);
  assert.equal(canManagePracticePool(teacher, classes, 'hsa', 12), true);
  assert.equal(canManagePracticePool(teacher, classes, 'tsa', 12), true);

  const assistant10 = {
    uid: 'a10',
    status: 'active',
    roles: ['assistant'],
    memberships: [{ class_id: 'c10', member_role: 'assistant', status: 'active', permissions: ['practice.manage'] }]
  };
  assert.equal(canManagePracticePool(assistant10, classes, 'thptqg', 10), true);
  assert.equal(canManagePracticePool(assistant10, classes, 'thptqg', 12), false);
  assert.equal(canManagePracticePool(assistant10, classes, 'hsa', 12), false);
  assert.equal(canManagePracticePool(assistant10, classes, 'tsa', 12), false);

  const assistant11 = {
    uid: 'a11',
    status: 'active',
    roles: ['assistant'],
    memberships: [{ class_id: 'c11', member_role: 'assistant', status: 'active', permissions: ['practice.manage'] }]
  };
  assert.equal(canManagePracticePool(assistant11, classes, 'thptqg', 11), true);
  assert.equal(canManagePracticePool(assistant11, classes, 'tsa', 12), true);
  assert.equal(canManagePracticePool(assistant11, classes, 'hsa', 12), false);
});

test('shuffleUnitsPreservingClusters keeps passage clusters contiguous and HSA Part 3 drops 51 to 50', () => {
  const sample = [
    { id: 's1', order: 1 },
    { id: 'c1_a', clusterId: 'cluster_1', order: 2 },
    { id: 'c1_b', clusterId: 'cluster_1', order: 3 },
    { id: 'c1_c', clusterId: 'cluster_1', order: 4 },
    { id: 's2', order: 5 }
  ];
  for (let i = 0; i < 15; i++) {
    const out = shuffleUnitsPreservingClusters(sample);
    const idxA = out.findIndex((q) => q.id === 'c1_a');
    const idxB = out.findIndex((q) => q.id === 'c1_b');
    const idxC = out.findIndex((q) => q.id === 'c1_c');
    assert.equal(idxB, idxA + 1);
    assert.equal(idxC, idxA + 2);
  }

  // Build 17 questions each for physics, chemistry, biology (total 51)
  const hsaPart3Pool = [];
  for (const subj of ['physics', 'chemistry', 'biology']) {
    for (let i = 1; i <= 14; i++) {
      hsaPart3Pool.push({
        id: `${subj}_${i}`,
        order: i,
        section: 'part_3',
        subject: subj,
        type: 'single',
        prompt: 'Q',
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        points: 1
      });
    }
    // 3 clustered questions (15, 16, 17)
    for (let i = 15; i <= 17; i++) {
      hsaPart3Pool.push({
        id: `${subj}_${i}`,
        order: i,
        section: 'part_3',
        subject: subj,
        clusterId: `cl_${subj}`,
        passageId: `p_${subj}`,
        type: 'single',
        prompt: 'Cluster Q',
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        points: 1
      });
    }
  }

  const selected = selectAndShuffleSectionQuestions('hsa', hsaPart3Pool, 'part_3', {
    practiceMode: 'section',
    selectedCombination: 'Q01'
  });
  assert.equal(selected.length, 50, 'Should drop 1 standalone question from 51 to 50');
  const clusterRemaining = selected.filter((q) => q.clusterId);
  assert.equal(clusterRemaining.length, 9, 'Never drops a clustered question');
});

test('practiceRooms end-to-end: upload draft, start attempt, draft save, submit, report error, and regrade v2', async () => {
  const db = createInMemoryPracticeDb({
    classes: [
      { id: 'class-12a', name: 'Lớp 12A', grade: 12, school_year_id: 'year-2026-2027', archived: false },
      { id: 'class-11a-old', name: 'Lớp 11A', grade: 11, school_year_id: 'year-2025-2026', archived: true }
    ],
    accounts: [
      { uid: 'teacher-1', display_name: 'Cô Hạnh', status: 'active', roles: ['teacher'] },
      { uid: 'student-1', display_name: 'Nguyễn Văn An', student_code: 'HS001', status: 'active', roles: ['student'] },
      { uid: 'alumni-1', display_name: 'Trần Cựu HS', student_code: 'HS000', status: 'active', roles: ['student'] }
    ],
    gradeHistory: [
      { id: 'h1', uid: 'student-1', school_year_id: 'year-2025-2026', grade: 11, class_id: 'class-11a-old' }
    ]
  });

  const teacherActor = {
    uid: 'teacher-1',
    status: 'active',
    roles: ['teacher'],
    memberships: [{ class_id: 'class-12a', member_role: 'teacher', status: 'active' }]
  };

  const studentActor = {
    uid: 'student-1',
    status: 'active',
    roles: ['student'],
    memberships: [{ class_id: 'class-12a', member_role: 'student', status: 'active' }]
  };

  // 1. Giáo viên tạo đề THPTQG (cho phép publish mẫu với allowPartialStructure)
  const createReq = new Request('https://ltch.example.com/api/admin/practice/exams', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'publish',
      allowPartialStructure: true,
      examType: 'thptqg',
      targetGrade: 12,
      examCode: '01',
      title: '[LTCH] Đề thi thử THPTQG 2027 - Mã đề 01',
      questions: [
        {
          id: 'q1',
          section: 'part_1',
          type: 'single',
          prompt: 'Đạo hàm của $y=x^2$ là',
          options: ['$2x$', '$x$', '$2$', '$x^2$'],
          answer: 'A',
          points: 0.25,
          solution: '$y\'=2x$'
        },
        {
          id: 'q2',
          section: 'part_3',
          type: 'short',
          prompt: 'Tính $3+4$',
          accepted: ['7'],
          points: 0.5,
          solution: '$3+4=7$'
        }
      ]
    })
  });
  const createRes = await practiceRooms(createReq, '/api/admin/practice/exams', { db, actor: teacherActor });
  assert.equal(createRes.status, 201);
  const createdBody = await createRes.json();
  assert.equal(createdBody.status, 'published');
  assert.equal(createdBody.questions[0].questionCode, 'LTCH-1001');
  const examId = createdBody.examId;

  // 2. Học sinh lớp 12 vào sảnh Phòng luyện
  const lobbyReq = new Request('https://ltch.example.com/api/practice/rooms', { method: 'GET' });
  const lobbyRes = await practiceRooms(lobbyReq, '/api/practice/rooms', { db, actor: studentActor });
  const lobbyData = await lobbyRes.json();
  assert.deepEqual(lobbyData.access.allowedRooms.sort(), ['hsa', 'thptqg', 'tsa']);
  assert.equal(lobbyData.access.pastGradePools.length, 1);
  assert.equal(lobbyData.access.pastGradePools[0].grade, 11);
  assert.equal(lobbyData.exams.length, 1);

  // 3. Học sinh bắt đầu làm bài
  const startReq = new Request(`https://ltch.example.com/api/exams/${examId}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ practiceMode: 'full' })
  });
  const startRes = await practiceRooms(startReq, `/api/exams/${examId}/start`, { db, actor: studentActor });
  assert.equal(startRes.status, 201);
  const startData = await startRes.json();
  assert.ok(startData.attemptId);
  assert.ok(startData.activeDeviceToken);
  assert.equal(startData.visibleQuestions.length, 2);
  assert.equal(startData.visibleQuestions[0].answer, undefined, 'Must strip answer from visibleQuestions');

  const activeLobby = await practiceRooms(lobbyReq, '/api/practice/rooms', { db, actor: studentActor });
  const { attemptsByExam } = await activeLobby.json();
  assert.equal(attemptsByExam[examId].inProgressAttempt.attemptId, startData.attemptId);
  assert.equal(attemptsByExam[examId].inProgressAttempt.attemptNo, 1);

  // Calling the result API directly must not reveal the answer during an attempt.
  const resultPath = `/api/practice/exams/${examId}/attempts/${startData.attemptId}`;
  await assert.rejects(
    practiceRooms(new Request(`https://ltch.example.com${resultPath}`), resultPath, { db, actor: studentActor }),
    e => e.status === 409
  );

  const noTokenDraft = await practiceRooms(new Request(`https://ltch.example.com/api/exams/${examId}/draft`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ attemptId: startData.attemptId, responses: { q1: 'A' } })
  }), `/api/exams/${examId}/draft`, { db, actor: studentActor });
  assert.equal(noTokenDraft.status, 409);

  // 4. Lưu nháp (Draft) và kiểm tra khóa đa thiết bị (DEVICE_SUPERSEDED)
  const badDraftReq = new Request(`https://ltch.example.com/api/exams/${examId}/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      attemptId: startData.attemptId,
      activeDeviceToken: 'wrong-token',
      responses: { q1: 'A' }
    })
  });
  const badDraftRes = await practiceRooms(badDraftReq, `/api/exams/${examId}/draft`, { db, actor: studentActor });
  assert.equal(badDraftRes.status, 409);

  const okDraftReq = new Request(`https://ltch.example.com/api/exams/${examId}/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      attemptId: startData.attemptId,
      activeDeviceToken: startData.activeDeviceToken,
      responses: { q1: 'A', q2: '8' }
    })
  });
  const okDraftRes = await practiceRooms(okDraftReq, `/api/exams/${examId}/draft`, { db, actor: studentActor });
  assert.equal(okDraftRes.status, 200);

  // 5. Nộp bài
  const submitReq = new Request(`https://ltch.example.com/api/exams/${examId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      attemptId: startData.attemptId,
      activeDeviceToken: startData.activeDeviceToken,
      responses: { q1: 'A', q2: '8' }
    })
  });
  const submitRes = await practiceRooms(submitReq, `/api/exams/${examId}/submit`, { db, actor: studentActor });
  assert.equal(submitRes.status, 200);
  const submitData = await submitRes.json();
  assert.equal(submitData.score, 0.25);
  assert.equal(submitData.max, 0.75);
  db.tables.ltch_class_memberships=[{uid:studentActor.uid,class_id:'class-12a',member_role:'student',status:'active'}];
  const otherStaff={uid:'other',status:'active',roles:['assistant'],memberships:[{class_id:'other-class',member_role:'assistant',permissions:['practice.manage']}],childMemberships:[]};
  await assert.rejects(practiceRooms(new Request(`https://ltch.example.com${resultPath}`), resultPath, {db,actor:otherStaff}),e=>e.status===403);
  assert.equal((await practiceRooms(new Request(`https://ltch.example.com${resultPath}`),resultPath,{db,actor:teacherActor})).status,200);

  // 6. Học sinh báo lỗi câu q2 (#LTCH-1002)
  const reportReq = new Request('https://ltch.example.com/api/practice/report-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      attemptId: startData.attemptId,
      examId,
      questionId: 'q2',
      note: 'Em nghĩ đáp án 8 cũng được chấp nhận ạ.'
    })
  });
  const reportRes = await practiceRooms(reportReq, '/api/practice/report-error', { db, actor: studentActor });
  assert.equal(reportRes.status, 201);

  // 7. Giáo viên cập nhật câu hỏi q2 sang v2 và bật chấm lại (regradeAffectedAttempts = true)
  const editQReq = new Request('https://ltch.example.com/api/admin/practice/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      examId,
      questionId: 'q2',
      question: {
        id: 'q2',
        section: 'part_3',
        type: 'short',
        prompt: 'Tính $3+4$ (hoặc $8$)',
        accepted: ['7', '8'],
        points: 0.5,
        solution: 'Chấp nhận cả 7 và 8.'
      },
      regradeAffectedAttempts: true
    })
  });
  const editQRes = await practiceRooms(editQReq, '/api/admin/practice/questions', { db, actor: teacherActor });
  assert.equal(editQRes.status, 200);
  const editQData = await editQRes.json();
  assert.equal(editQData.version, 2);
  assert.equal(editQData.regradedCount, 1);

  // 8. Học sinh xem lại kết quả đã được cập nhật điểm lên 0.75 / 0.75
  const reviewReq = new Request(
    `https://ltch.example.com/api/practice/exams/${examId}/attempts/${startData.attemptId}`,
    { method: 'GET' }
  );
  const reviewRes = await practiceRooms(
    reviewReq,
    `/api/practice/exams/${examId}/attempts/${startData.attemptId}`,
    { db, actor: studentActor }
  );
  assert.equal(reviewRes.status, 200);
  const reviewData = await reviewRes.json();
  assert.equal(reviewData.score, 0.75);
});

test('attempt writes reject stale revisions and database failures', async () => {
  const db = createInMemoryPracticeDb();
  const attempt = { id: 'att_1234567890123456', exam_id: 'exam_1', uid: 'student-1', status: 'in_progress', started_at: Date.now(), responses: {}, attempt_questions: [], revision: 1 };
  await saveAttemptRowToDb(db, attempt, { isInsert: true });
  await saveAttemptRowToDb(db, { ...attempt, responses: { q1: 'A' } });
  await assert.rejects(saveAttemptRowToDb(db, { ...attempt, responses: { q1: 'B' } }), e => e.status === 409);
  assert.equal(db.tables.ltch_practice_attempts[0].responses.q1, 'A');
  const failing = { from() { return { insert: async () => ({ error: { message: 'database unavailable' } }) }; } };
  await assert.rejects(saveAttemptRowToDb(failing, attempt, { isInsert: true }), e => e.status === 503);
});

test('expired drafts and early HSA section starts are rejected by the server',async()=>{
 const now=Date.now(), actor={uid:'student-1',status:'active',roles:['student'],memberships:[],childMemberships:[]};
 const exam={id:'exam_hsa',exam_type:'hsa',status:'published',questions:[]};
 const attempt={id:'att_time_1234567890',exam_id:exam.id,uid:actor.uid,status:'in_progress',started_at:now-10000,expires_at:now+300000,active_device_token:'device',section_states:{part_1:{status:'waiting',waitExpiresAt:now+120000},part_2:{status:'locked'}},attempt_questions:[],responses:{},revision:1};
 const db=createInMemoryPracticeDb({exams:[exam],attempts:[attempt]});
 const sectionPath=`/api/exams/${exam.id}/section`;
 const request=body=>new Request(`https://example.test${sectionPath}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 await assert.rejects(practiceRooms(request({attemptId:attempt.id,activeDeviceToken:'device',action:'start_section',sectionKey:'part_2'}),sectionPath,{db,actor}),e=>e.status===400||e.status===409);
 attempt.expires_at=now-20000;
 const draftPath=`/api/exams/${exam.id}/draft`;
 await assert.rejects(practiceRooms(new Request(`https://example.test${draftPath}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({attemptId:attempt.id,activeDeviceToken:'device'})}),draftPath,{db,actor}),e=>e.status===409);
});

test('HSA Part 3 honors a new combination while waiting and keeps it fixed after start', async () => {
  const now = Date.now();
  const actor = { uid: 'student-1', status: 'active', roles: ['student'], memberships: [], childMemberships: [] };
  const subjects = ['physics', 'chemistry', 'biology', 'geography'];
  const questions = subjects.flatMap(subject => Array.from({ length: 17 }, (_, i) => ({
    id: `${subject}-${i}`, section: 'part_3', subject, type: 'short',
    prompt: `Câu ${subject} ${i}`, accepted: ['1'], points: 1
  })));
  const exam = { id: 'exam_hsa', exam_type: 'hsa', status: 'published', questions };
  const attempt = {
    id: 'att_hsa_combo_test', exam_id: exam.id, uid: actor.uid, status: 'in_progress',
    practice_mode: 'section', started_at: now, expires_at: now + 300000, active_device_token: 'device',
    selected_combination: 'Q01',
    section_states: { part_3: { status: 'waiting', durationMinutes: 60 } },
    attempt_questions: questions.filter(q => q.subject !== 'geography').slice(0, 50),
    responses: {}, revision: 1
  };
  const db = createInMemoryPracticeDb({ exams: [exam], attempts: [attempt] });
  const route = `/api/exams/${exam.id}/section`;
  const start = selectedCombination => practiceRooms(new Request(`https://example.test${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ attemptId: attempt.id, activeDeviceToken: 'device', action: 'start_section', sectionKey: 'part_3', selectedCombination })
  }), route, { db, actor });

  const result = await (await start('Q03')).json();
  assert.equal(result.selectedCombination, 'Q03');
  const stored = db.tables.ltch_practice_attempts[0].attempt_questions;
  assert.equal(stored.length, 50);
  assert.deepEqual([...new Set(stored.map(q => q.subject))], ['physics', 'chemistry', 'geography']);
  await assert.rejects(start('Q01'), error => error.status === 409);
  await start('Q03');
  assert.deepEqual(db.tables.ltch_practice_attempts[0].attempt_questions.map(q => q.id), stored.map(q => q.id));
});

test('restoring Word images preserves published exam content and fills exact image references', async () => {
  const actor = { uid: 'admin-1', status: 'active', roles: ['admin'], memberships: [], childMemberships: [] };
  const question = {
    id: 'q1', section: 'part_1', type: 'short', prompt: 'Đề [[img:stem]]',
    passageContent: 'Ngữ liệu [[img:passage]]', solution: 'Giải [[img:answer]]',
    accepted: ['1'], points: 1, questionCode: 'LTCH-1', version: 2,
    media: [{ id: 'stem', path: 'word/media/image1.png' }]
  };
  const exam = {
    id: 'exam_tsa_media', exam_type: 'tsa', title: 'TSA', status: 'published', questions: [question],
    opens_at: 1, closes_at: 2, results_at: 1, solutions_at: 1, updated_at: 1, created_by: actor.uid
  };
  const db = createInMemoryPracticeDb({ exams: [exam] });
  const route = '/api/admin/practice/exams';
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const restore = images => practiceRooms(new Request(`https://example.test${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'restore_media', examId: exam.id, images })
  }), route, { db, actor });

  await assert.rejects(restore([{ id: 'stem', dataUrl: 'data:text/html;base64,Zg==' }]), err => err.status === 400);
  const response = await (await restore(['stem', 'passage', 'answer'].map(id => ({ id, dataUrl: image })))).json();
  assert.equal(response.restored, 3);
  const saved = db.tables.ltch_exams[0];
  assert.equal(saved.status, 'published');
  assert.equal(saved.opens_at, exam.opens_at);
  assert.equal(saved.questions[0].version, 2);
  assert.deepEqual(saved.questions[0].accepted, ['1']);
  assert.deepEqual(saved.questions[0].passageMedia, [{ id: 'passage', dataUrl: image }]);
  assert.deepEqual(saved.questions[0].media, [{ id: 'stem', dataUrl: image }, { id: 'answer', dataUrl: image, inSolution: true }]);
  await assert.rejects(restore([{ id: 'stem', dataUrl: image }]), err => err.status === 409);
});

test('an assistant cannot overwrite an existing exam outside their assigned grade',async()=>{
 const classes=[{id:'c10',name:'Lớp 10A',school_year_id:'year-2026-2027',archived:false},{id:'c12',name:'Lớp 12A',school_year_id:'year-2026-2027',archived:false}];
 const existing={id:'exam_private',title:'Đề khối 12',exam_type:'thptqg',target_grade:12,status:'draft',school_year_id:'year-2026-2027',questions:[]};
 const db=createInMemoryPracticeDb({classes,exams:[existing]});let allocated=false;const rpc=db.rpc;db.rpc=async(...args)=>{allocated=true;return rpc(...args);};
 const actor={uid:'assistant',status:'active',roles:['assistant'],memberships:[{class_id:'c10',member_role:'assistant',permissions:['practice.manage']}],childMemberships:[]};
 const path='/api/admin/practice/exams';
 const request=new Request(`https://example.test${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({examId:existing.id,examType:'thptqg',targetGrade:10,title:'Ghi đè',questions:[]})});
 await assert.rejects(practiceRooms(request,path,{db,actor}),e=>e.status===403);
 assert.equal(existing.title,'Đề khối 12');assert.equal(allocated,false);
});

test('editing an unknown question cannot match a missing question code',async()=>{
 const exam={id:'exam_legacy',title:'Đề cũ',exam_type:'thptqg',target_grade:12,status:'draft',questions:[{id:'real_question',prompt:'Câu hỏi cũ'}]};
 const db=createInMemoryPracticeDb({exams:[exam]});
 let saved=false;const rpc=db.rpc;db.rpc=async(...args)=>{saved=true;return rpc(...args);};
 const actor={uid:'admin',status:'active',roles:['admin'],memberships:[],childMemberships:[]};
 const path='/api/admin/practice/questions';
 const request=new Request(`https://example.test${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({examId:exam.id,questionId:'missing_question',question:{prompt:'Thay đổi'}})});
 await assert.rejects(practiceRooms(request,path,{db,actor}),e=>e.status===404);
 assert.equal(saved,false);
 assert.equal(db.tables.ltch_exams[0].questions[0].prompt,'Câu hỏi cũ');
});

test('buildAppRoutePath and parseAppRoutePath support /practice and examType sub-routes', () => {
  assert.equal(buildAppRoutePath({ page: 'practice', subPage: 'thptqg' }), '/practice/thptqg');
  assert.equal(buildAppRoutePath({ page: 'practice', subPage: 'hsa' }), '/practice/hsa');
  assert.equal(buildAppRoutePath({ page: 'practice', subPage: 'tsa' }), '/practice/tsa');
  assert.equal(buildAppRoutePath({ page: 'practice' }), '/practice');

  assert.equal(parseAppRoutePath('/practice').page, 'practice');
  assert.equal(parseAppRoutePath('/practice').subPage, null);
  assert.equal(parseAppRoutePath('/practice/thptqg').page, 'practice');
  assert.equal(parseAppRoutePath('/practice/thptqg').subPage, 'thptqg');
  assert.equal(parseAppRoutePath('/practice/hsa').subPage, 'hsa');
  assert.equal(parseAppRoutePath('/practice/tsa').subPage, 'tsa');
});

test('HSA & TSA multi-section exam flow: waiting screen, start_section, finish_section, Q01 combination, fill_blank, and drag_drop grading', async () => {
  const db = createInMemoryPracticeDb({
    classes: [{ id: 'class-12a', name: 'Lớp 12A', grade: 12, school_year_id: 'year-2026-2027', archived: false }],
    accounts: [
      { uid: 'teacher-1', display_name: 'Cô Hạnh', status: 'active', roles: ['teacher'] },
      { uid: 'student-12', display_name: 'Nguyễn Văn An', student_code: 'HS1201', status: 'active', roles: ['student'] }
    ],
    memberships: [{ class_id: 'class-12a', uid: 'student-12', member_role: 'student', status: 'active' }]
  });

  const teacherActor = { uid: 'teacher-1', name: 'Cô Hạnh', status: 'active', roles: ['teacher'], memberships: [] };
  const studentActor = {
    uid: 'student-12',
    name: 'Nguyễn Văn An',
    student_code: 'HS1201',
    status: 'active',
    roles: ['student'],
    memberships: [{ class_id: 'class-12a', uid: 'student-12', member_role: 'student', status: 'active' }]
  };

  // Tạo đề TSA có cả fill_blank và drag_drop
  const createTsaRes = await practiceRooms(
    new Request('https://ltch.example.com/api/admin/practice/exams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '[LTCH] Đề thi thử TSA 2027 - Mã đề 101',
        examCode: '101',
        examType: 'tsa',
        examMode: 'full',
        targetGrade: 12,
        schoolYearId: 'year-2026-2027',
        durationMinutes: 150,
        action: 'publish',
        allowPartialStructure: true,
        status: 'published',
        questions: [
          {
            id: 'tsa_q1',
            section: 'part_1',
            type: 'fill_blank',
            prompt: 'Giá trị của $2^3$ là {{1}} và $3^2$ là {{2}}.',
            blanks: [
              { id: '1', accepted: ['8'] },
              { id: '2', accepted: ['9'] }
            ],
            points: 1
          },
          {
            id: 'tsa_q2',
            section: 'part_2',
            type: 'drag_drop',
            prompt: 'Kéo thả: đạo hàm của $x^2$ là {{1}}.',
            cards: ['2x', 'x', '2'],
            answer: ['T1'],
            points: 1
          }
        ]
      })
    }),
    '/api/admin/practice/exams',
    { db, actor: teacherActor }
  );
  assert.equal(createTsaRes.status, 201);
  const { examId: tsaExamId } = await createTsaRes.json();

  // Học sinh bắt đầu làm bài TSA
  const startTsaRes = await practiceRooms(
    new Request(`https://ltch.example.com/api/exams/${tsaExamId}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ practiceMode: 'full' })
    }),
    `/api/exams/${tsaExamId}/start`,
    { db, actor: studentActor }
  );
  assert.equal(startTsaRes.status, 201);
  const startTsa = await startTsaRes.json();

  // Nộp phần 1 TSA (fill_blank đúng cả 2 ô) để chuyển sang phần 2
  const secTsaRes = await practiceRooms(
    new Request(`https://ltch.example.com/api/exams/${tsaExamId}/section`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: startTsa.attemptId,
        activeDeviceToken: startTsa.activeDeviceToken,
        action: 'submit_section',
        sectionKey: 'part_1',
        responses: { tsa_q1: ['8', '9'] }
      })
    }),
    `/api/exams/${tsaExamId}/section`,
    { db, actor: studentActor }
  );
  assert.equal(secTsaRes.status, 200);

  // Nộp toàn bộ đề TSA với câu kéo thả đúng (T1)
  const subTsaRes = await practiceRooms(
    new Request(`https://ltch.example.com/api/exams/${tsaExamId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: startTsa.attemptId,
        activeDeviceToken: startTsa.activeDeviceToken,
        responses: { tsa_q2: ['T1'] }
      })
    }),
    `/api/exams/${tsaExamId}/submit`,
    { db, actor: studentActor }
  );
  assert.equal(subTsaRes.status, 200);
  const subTsa = await subTsaRes.json();
  assert.equal(subTsa.score, 2);
  assert.equal(subTsa.max, 2);
});

test('Frontend & config integrity: practice-rooms bundle, 100% CSS class coverage, 3 Word templates, and firebase.json rewrites', async () => {
  const [appJs, practiceRoomsSrc, appCss, firebaseJsonRaw] = await Promise.all([
    readFile('public/app.js', 'utf8'),
    readFile('client/practice-rooms.mjs', 'utf8'),
    readFile('public/app.css', 'utf8'),
    readFile('firebase.json', 'utf8')
  ]);

  // Kiểm tra bundle public/app.js có đầy đủ thành phần Phòng luyện & Upload Word
  assert.ok(appJs.includes('/api/practice/rooms'), 'Bundle must include /api/practice/rooms');
  assert.ok(appJs.includes('Mau_dang_tai_THPTQG.docx'), 'Bundle must link to Mau_dang_tai_THPTQG.docx');
  assert.ok(appJs.includes('Mau_dang_tai_HSA.docx'), 'Bundle must link to Mau_dang_tai_HSA.docx');
  assert.ok(appJs.includes('Mau_dang_tai_TSA.docx'), 'Bundle must link to Mau_dang_tai_TSA.docx');
  assert.ok(appJs.includes('ltch-drag-bank-box'), 'Bundle must include TSA drag-drop answer pool box');

  // Kiểm tra 100% các class ltch-* trong client/practice-rooms.mjs đều được định nghĩa trong public/app.css
  const jsClasses = [...new Set([...practiceRoomsSrc.matchAll(/ltch-[a-zA-Z0-9_-]+/g)].map((m) => m[0]))]
    .filter((c) => !c.endsWith('-'))
    .sort();
  const missingInCss = jsClasses.filter((c) => !appCss.includes(`.${c}`));
  assert.deepEqual(
    missingInCss,
    [],
    `All ${jsClasses.length} ltch-* classes in client/practice-rooms.mjs must be styled in public/app.css`
  );

  // Kiểm tra 3 file mẫu Word có mặt trong public/mau-dang-tai/
  for (const name of ['Mau_dang_tai_THPTQG.docx', 'Mau_dang_tai_HSA.docx', 'Mau_dang_tai_TSA.docx']) {
    const st = await stat(`public/mau-dang-tai/${name}`);
    assert.ok(st.size > 1000, `${name} must exist and be non-empty`);
  }

  // Kiểm tra 3 ảnh minh họa Phòng luyện có mặt trong public/practice-covers/
  for (const cover of ['thptqg.png', 'hsa.png', 'tsa.png']) {
    const st = await stat(`public/practice-covers/${cover}`);
    assert.ok(st.size > 10000, `public/practice-covers/${cover} must exist and be non-empty`);
  }

  // Kiểm tra firebase.json có rewrite cho /practice và /practice/**
  const firebaseCfg = JSON.parse(firebaseJsonRaw);
  const rewriteSources = (firebaseCfg.hosting?.rewrites || []).map((r) => r.source);
  assert.ok(rewriteSources.includes('/practice'), 'firebase.json must rewrite /practice');
  assert.ok(rewriteSources.includes('/practice/**'), 'firebase.json must rewrite /practice/**');
});

test('practiceRooms falls back cleanly when 0021-0024 tables/RPCs/columns are absent in base 0003 schema', async () => {
  const baseDb = createInMemoryPracticeDb({
    classes: [{ id: 'class-12a', name: 'Lớp 12A', grade: 12, school_year_id: 'year-2026-2027', archived: false }],
    accounts: [
      { uid: 'teacher-1', display_name: 'Cô Hạnh', status: 'active', roles: ['teacher'] },
      { uid: 'student-12', display_name: 'Nguyễn Văn An', student_code: 'HS1201', status: 'active', roles: ['student'] }
    ],
    memberships: [{ class_id: 'class-12a', uid: 'student-12', member_role: 'student', status: 'active' }]
  });
  const missingTables = new Set(['ltch_student_grade_history', 'ltch_exam_year_shares', 'ltch_question_reports', 'ltch_question_versions']);
  const origFrom = baseDb.from.bind(baseDb);
  baseDb.from = (table) => {
    if (missingTables.has(table)) {
      const errRes = { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => errRes,
        upsert: async () => errRes,
        insert: async () => errRes,
        update: () => chain,
        delete: () => chain,
        then: (resolve, reject) => Promise.resolve(errRes).then(resolve, reject)
      };
      return chain;
    }
    const q = origFrom(table);
    if (table === 'ltch_practice_attempts') {
      const origInsert = q.insert.bind(q);
      q.insert = async (payload) => {
        if ('revision' in payload || 'is_preview' in payload) {
          return { data: null, error: { code: 'PGRST204', message: "Could not find the 'revision' column of 'ltch_practice_attempts' in the schema cache" } };
        }
        return origInsert(payload);
      };
      const origUpdate = q.update.bind(q);
      q.update = (payload) => {
        if ('revision' in payload || 'is_preview' in payload) {
          const errRes = { data: null, error: { code: 'PGRST204', message: "Could not find the 'revision' column of 'ltch_practice_attempts' in the schema cache" } };
          const errChain = {
            eq: () => errChain,
            select: async () => errRes,
            then: (resolve, reject) => Promise.resolve(errRes).then(resolve, reject)
          };
          return errChain;
        }
        return origUpdate(payload);
      };
    }
    return q;
  };
  baseDb.rpc = async (fnName) => ({
    data: null,
    error: { code: 'PGRST202', message: `Could not find the function public.${fnName} in the schema cache` }
  });

  const teacherActor = { uid: 'teacher-1', name: 'Cô Hạnh', status: 'active', roles: ['teacher'], memberships: [] };
  const studentActor = {
    uid: 'student-12',
    name: 'Nguyễn Văn An',
    student_code: 'HS1201',
    status: 'active',
    roles: ['student'],
    memberships: [{ class_id: 'class-12a', uid: 'student-12', member_role: 'student', status: 'active' }]
  };

  const createRes = await practiceRooms(
    new Request('https://ltch.example.com/api/admin/practice/exams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Đề THPTQG 2027 - Base Schema',
        examCode: '01',
        examType: 'thptqg',
        examMode: 'full',
        targetGrade: 12,
        action: 'publish',
        allowPartialStructure: true,
        questions: [
          {
            id: 'q1',
            section: 'part_1',
            type: 'single',
            prompt: '1 + 1 = ?',
            options: ['1', '2', '3', '4'],
            answer: 'B',
            points: 0.25
          }
        ]
      })
    }),
    '/api/admin/practice/exams',
    { db: baseDb, actor: teacherActor }
  );
  assert.equal(createRes.status, 201);
  const { examId } = await createRes.json();

  const lobbyRes = await practiceRooms(
    new Request('https://ltch.example.com/api/practice/rooms', { method: 'GET' }),
    '/api/practice/rooms',
    { db: baseDb, actor: studentActor }
  );
  assert.equal(lobbyRes.status, 200);
  const lobby = await lobbyRes.json();
  assert.equal(lobby.exams.length, 1);
  assert.equal(lobby.exams[0].id, examId);

  const startRes = await practiceRooms(
    new Request(`https://ltch.example.com/api/exams/${examId}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ practiceMode: 'full' })
    }),
    `/api/exams/${examId}/start`,
    { db: baseDb, actor: studentActor }
  );
  assert.equal(startRes.status, 201);
  const started = await startRes.json();
  assert.ok(started.attemptId);

  const submitRes = await practiceRooms(
    new Request(`https://ltch.example.com/api/exams/${examId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attemptId: started.attemptId,
        activeDeviceToken: started.activeDeviceToken,
        responses: { q1: 'B' }
      })
    }),
    `/api/exams/${examId}/submit`,
    { db: baseDb, actor: studentActor }
  );
  assert.equal(submitRes.status, 200);
});

test('delete_exam removes published/draft exams and dependent rows while enforcing authorization', async () => {
  const db = createInMemoryPracticeDb({
    classes: [
      { id: 'class-12a', name: 'Lớp 12A', archived: false, school_year_id: 'year-2026-2027' },
      { id: 'class-10a', name: 'Lớp 10A', archived: false, school_year_id: 'year-2026-2027' }
    ],
    exams: [
      {
        id: 'exam_hsa_del_1',
        title: 'Đề HSA cần xóa',
        exam_type: 'hsa',
        exam_code: 'HSA-99',
        target_grade: 12,
        status: 'published',
        duration_minutes: 195,
        questions: [],
        updated_at: 1000
      },
      {
        id: 'exam_thptqg_del_2',
        title: 'Đề nháp THPTQG cần xóa',
        exam_type: 'thptqg',
        exam_code: 'THPT-99',
        target_grade: 12,
        status: 'draft',
        duration_minutes: 90,
        questions: [],
        updated_at: 2000
      }
    ],
    attempts: [
      { id: 'att_del_1', exam_id: 'exam_hsa_del_1', uid: 'student-12', status: 'submitted', score: 10, max_score: 50, submitted_at: 100 }
    ],
    shares: [
      { exam_id: 'exam_hsa_del_1', school_year_id: 'year-2026-2027', target_grade: 12 }
    ]
  });

  const studentActor = {
    uid: 'student-12',
    status: 'active',
    roles: ['student'],
    memberships: [{ class_id: 'class-12a', member_role: 'student', status: 'active' }]
  };
  const assistantGrade10 = {
    uid: 'assistant-10',
    status: 'active',
    roles: ['assistant'],
    memberships: [{ class_id: 'class-10a', member_role: 'assistant', status: 'active', permissions: ['practice.manage'] }]
  };
  const teacherActor = {
    uid: 'teacher-1',
    status: 'active',
    roles: ['teacher'],
    memberships: []
  };

  // Student forbidden
  await assert.rejects(
    () =>
      practiceRooms(
        new Request('https://ltch.example.com/api/admin/practice/exams', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'delete_exam', examId: 'exam_hsa_del_1' })
        }),
        '/api/admin/practice/exams',
        { db, actor: studentActor }
      ),
    (err) => err?.status === 403
  );

  // Assistant scoped only to grade 10 cannot delete grade 12 HSA exam
  await assert.rejects(
    () =>
      practiceRooms(
        new Request('https://ltch.example.com/api/admin/practice/exams', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'delete_exam', examId: 'exam_hsa_del_1' })
        }),
        '/api/admin/practice/exams',
        { db, actor: assistantGrade10 }
      ),
    (err) => err?.status === 403
  );

  // Teacher can delete published exam along with attempts & shares
  const deletePublished = await practiceRooms(
    new Request('https://ltch.example.com/api/admin/practice/exams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete_exam', examId: 'exam_hsa_del_1' })
    }),
    '/api/admin/practice/exams',
    { db, actor: teacherActor }
  );
  assert.equal(deletePublished.status, 200);
  const pubJson = await deletePublished.json();
  assert.equal(pubJson.ok, true);
  assert.equal(pubJson.deletedExamId, 'exam_hsa_del_1');
  assert.equal(db.tables.ltch_exams.some(e => e.id === 'exam_hsa_del_1'), false);
  assert.equal(db.tables.ltch_practice_attempts.length, 0);
  assert.equal(db.tables.ltch_exam_year_shares.length, 0);

  // Teacher can also delete draft exam via delete_exam
  const deleteDraft = await practiceRooms(
    new Request('https://ltch.example.com/api/admin/practice/exams', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete_exam', examId: 'exam_thptqg_del_2' })
    }),
    '/api/admin/practice/exams',
    { db, actor: teacherActor }
  );
  assert.equal(deleteDraft.status, 200);
  assert.equal(db.tables.ltch_exams.length, 0);
});

test('practice rooms lobby prefers ltch_list_room_exams summary RPC over full questions table scan', async () => {
  let scannedFullExams = false;
  const db = createInMemoryPracticeDb({
    classes: [{ id: 'c12', name: 'Lớp 12', school_year_id: 'year-2026-2027', archived: false }],
    exams: []
  });
  const baseFrom = db.from.bind(db);
  const baseRpc = db.rpc.bind(db);
  db.from = (table) => {
    if (table === 'ltch_exams') scannedFullExams = true;
    return baseFrom(table);
  };
  db.rpc = async (fnName, args) => {
    if (fnName === 'ltch_list_room_exams') {
      assert.equal(args.p_published_only, true);
      return {
        data: [
          {
            id: 'exam_hsa_summary_1',
            class_id: null,
            title: 'HSA Summary Test',
            status: 'published',
            opens_at: 1000,
            closes_at: 9999999999999,
            results_at: 1000,
            solutions_at: 1000,
            created_by: 't1',
            exam_type: 'hsa',
            exam_code: '01',
            duration_minutes: 195,
            sections: [],
            target_grade: 12,
            school_year_id: 'year-2026-2027',
            updated_at: 1000,
            exam_meta: { examType: 'hsa', examMode: 'full', durationMinutes: 195 },
            total_questions: 150,
            part_1_count: 50,
            part_2_count: 50,
            part_3_count: 50
          }
        ],
        error: null
      };
    }
    return baseRpc(fnName, args);
  };
  const studentActor = {
    uid: 's12',
    status: 'active',
    roles: ['student'],
    displayName: 'Student 12',
    memberships: [{ class_id: 'c12', member_role: 'student', status: 'active' }]
  };
  const res = await practiceRooms(new Request('https://ltch.example.com/api/practice/rooms'), '/api/practice/rooms', { db, actor: studentActor });
  assert.equal(res.status, 200);
  assert.equal(scannedFullExams, false);
  const body = await res.json();
  assert.equal(body.exams.length, 1);
  assert.equal(body.exams[0].questionCount, 150);
  assert.deepEqual(body.exams[0].sectionCounts, { part_1: 50, part_2: 50, part_3: 50 });
});

test('practice rooms strictly isolate grades 10, 11, 12 per subject except TSA shared across 11 and 12', async () => {
  const classes = [
    { id: 'c10', name: 'Lớp 10A', school_year_id: 'year-2026-2027', archived: false },
    { id: 'c11', name: 'Lớp 11A', school_year_id: 'year-2026-2027', archived: false },
    { id: 'c12', name: 'Lớp 12A', school_year_id: 'year-2026-2027', archived: false }
  ];
  const sampleQ = [
    {
      id: 'q_1',
      section: 'part_1',
      type: 'single',
      points: 1,
      prompt: 'Tính $1+1$',
      options: ['1', '2', '3', '4'],
      answer: 'B'
    }
  ];
  const db = createInMemoryPracticeDb({ classes });
  const adminActor = { uid: 'admin-1', status: 'active', roles: ['admin'], memberships: [] };
  const assistant10Actor = {
    uid: 'asst-10',
    status: 'active',
    roles: ['assistant'],
    memberships: [{ class_id: 'c10', member_role: 'assistant', status: 'active', permissions: ['practice.manage'] }]
  };
  const student10Actor = {
    uid: 'stu-10',
    status: 'active',
    roles: ['student'],
    memberships: [{ class_id: 'c10', member_role: 'student', status: 'active' }]
  };
  const student11Actor = {
    uid: 'stu-11',
    status: 'active',
    roles: ['student'],
    memberships: [{ class_id: 'c11', member_role: 'student', status: 'active' }]
  };
  const student12Actor = {
    uid: 'stu-12',
    status: 'active',
    roles: ['student'],
    memberships: [{ class_id: 'c12', member_role: 'student', status: 'active' }]
  };

  async function createPublishedExam(spec) {
    const res = await practiceRooms(
      new Request('https://ltch.example.com/api/admin/practice/exams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'publish',
          allowPartialStructure: true,
          isNewExam: true,
          examMode: 'full',
          questions: sampleQ,
          ...spec
        })
      }),
      '/api/admin/practice/exams',
      { db, actor: adminActor }
    );
    assert.equal(res.status, 201);
    return (await res.json()).examId;
  }

  const idThpt10 = await createPublishedExam({ examType: 'thptqg', targetGrade: 10, examCode: '101', title: 'Đề Toán 10' });
  const idThpt11 = await createPublishedExam({ examType: 'thptqg', targetGrade: 11, examCode: '111', title: 'Đề Toán 11' });
  const idThpt12 = await createPublishedExam({ examType: 'thptqg', targetGrade: 12, examCode: '121', title: 'Đề THPTQG 12' });
  const idHsa12 = await createPublishedExam({ examType: 'hsa', targetGrade: 12, examCode: '308', title: 'Đề HSA 12' });
  const idTsaShared = await createPublishedExam({ examType: 'tsa', targetGrade: 12, examCode: 'TSA01', title: 'Đề TSA Chung' });

  // Kiểm tra hàm matchesPracticeGradePool
  assert.equal(matchesPracticeGradePool({ examType: 'thptqg', targetGrade: 12 }, 10), false);
  assert.equal(matchesPracticeGradePool({ examType: 'thptqg', targetGrade: 10 }, 10), true);
  assert.equal(matchesPracticeGradePool({ examType: 'tsa', targetGrade: 12 }, 10), false);
  assert.equal(matchesPracticeGradePool({ examType: 'tsa', targetGrade: 12 }, 11), true);
  assert.equal(matchesPracticeGradePool({ examType: 'tsa', targetGrade: 12 }, 12), true);

  // 1. Khi mở Phòng luyện từ Lớp 10 (?grade=10), kể cả Admin cũng chỉ nhận đề Khối 10 và phòng thptqg
  const adminG10Res = await practiceRooms(
    new Request('https://ltch.example.com/api/practice/rooms?grade=10'),
    '/api/practice/rooms',
    { db, actor: adminActor }
  );
  const adminG10 = await adminG10Res.json();
  assert.deepEqual(adminG10.access.allowedRooms, ['thptqg']);
  assert.deepEqual(adminG10.exams.map((e) => e.id), [idThpt10]);

  // 2. Khi mở Phòng luyện từ Lớp 11 (?grade=11): chỉ nhận đề Toán 11 + đề TSA dùng chung
  const adminG11Res = await practiceRooms(
    new Request('https://ltch.example.com/api/practice/rooms?grade=11'),
    '/api/practice/rooms',
    { db, actor: adminActor }
  );
  const adminG11 = await adminG11Res.json();
  assert.deepEqual(adminG11.access.allowedRooms.sort(), ['thptqg', 'tsa']);
  assert.deepEqual(adminG11.exams.map((e) => e.id).sort(), [idThpt11, idTsaShared].sort());

  // 3. Khi mở Phòng luyện từ Lớp 12 (?grade=12): chỉ nhận đề THPTQG 12 + HSA 12 + TSA dùng chung (không lẫn Toán 10, 11)
  const adminG12Res = await practiceRooms(
    new Request('https://ltch.example.com/api/practice/rooms?grade=12'),
    '/api/practice/rooms',
    { db, actor: adminActor }
  );
  const adminG12 = await adminG12Res.json();
  assert.deepEqual(adminG12.access.allowedRooms.sort(), ['hsa', 'thptqg', 'tsa']);
  assert.deepEqual(adminG12.exams.map((e) => e.id).sort(), [idThpt12, idHsa12, idTsaShared].sort());

  // 4. Học sinh Lớp 10 và Trợ giảng Lớp 10 gọi /api/practice/rooms không tham số vẫn chỉ thấy đề Khối 10, bị chặn 403 khi mở đề Khối 12 / TSA
  for (const actor10 of [student10Actor, assistant10Actor]) {
    const res10 = await practiceRooms(
      new Request('https://ltch.example.com/api/practice/rooms'),
      '/api/practice/rooms',
      { db, actor: actor10 }
    );
    const body10 = await res10.json();
    assert.deepEqual(body10.access.allowedRooms, ['thptqg']);
    assert.deepEqual(body10.exams.map((e) => e.id), [idThpt10]);

    for (const forbiddenId of [idThpt11, idThpt12, idHsa12, idTsaShared]) {
      await assert.rejects(
        () =>
          practiceRooms(
            new Request(`https://ltch.example.com/api/exams/${forbiddenId}/start`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ practiceMode: 'full' })
            }),
            `/api/exams/${forbiddenId}/start`,
            { db, actor: actor10 }
          ),
        (err) => err.status === 403
      );
    }
  }

  // 5. Học sinh Lớp 11 và Lớp 12 dùng chung kho TSA nhưng kho THPTQG hoàn toàn riêng biệt
  const stu11Lobby = await (
    await practiceRooms(new Request('https://ltch.example.com/api/practice/rooms'), '/api/practice/rooms', {
      db,
      actor: student11Actor
    })
  ).json();
  assert.deepEqual(stu11Lobby.exams.map((e) => e.id).sort(), [idThpt11, idTsaShared].sort());

  const stu12Lobby = await (
    await practiceRooms(new Request('https://ltch.example.com/api/practice/rooms'), '/api/practice/rooms', {
      db,
      actor: student12Actor
    })
  ).json();
  assert.deepEqual(stu12Lobby.exams.map((e) => e.id).sort(), [idThpt12, idHsa12, idTsaShared].sort());

  for (const actorTsa of [student11Actor, student12Actor]) {
    const startTsa = await practiceRooms(
      new Request(`https://ltch.example.com/api/exams/${idTsaShared}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ practiceMode: 'section', sectionKey: 'part_1' })
      }),
      `/api/exams/${idTsaShared}/start`,
      { db, actor: actorTsa }
    );
    assert.equal(startTsa.status, 201);
  }
});

test('shuffling renumbers displayNumber sequentially, rewrites passage question ranges/lists, and survives Drive stub hydration', () => {
  const rawPart3Questions = [
    {
      id: 'q_61',
      order: 61,
      section: 'part_3',
      type: 'single',
      clusterId: 'cluster_1',
      passageId: 'passage_1',
      passageContent: '<strong>Dựa vào thông tin sau đây và trả lời các câu hỏi từ câu 1 - 2:</strong>\nNội dung ngữ liệu A.',
      prompt: 'Câu 61. Hỏi ý A1?',
      options: ['A', 'B', 'C', 'D'],
      answer: 'A'
    },
    {
      id: 'q_62',
      order: 62,
      section: 'part_3',
      type: 'single',
      clusterId: 'cluster_1',
      passageId: 'passage_1',
      passageContent: '<strong>Dựa vào thông tin sau đây và trả lời các câu hỏi từ câu 1 - 2:</strong>\nNội dung ngữ liệu A.',
      prompt: 'Hỏi ý A2?',
      options: ['A', 'B', 'C', 'D'],
      answer: 'B'
    },
    {
      id: 'q_74',
      order: 74,
      section: 'part_3',
      type: 'single',
      clusterId: 'cluster_2',
      passageId: 'passage_2',
      passageContent: '<strong>Trả lời cho các câu 74, 75, 76 dưới đây:</strong>\nNội dung ngữ liệu B.',
      prompt: 'Hỏi ý B1?',
      options: ['A', 'B', 'C', 'D'],
      answer: 'C'
    },
    {
      id: 'q_75',
      order: 75,
      section: 'part_3',
      type: 'single',
      clusterId: 'cluster_2',
      passageId: 'passage_2',
      passageContent: '<strong>Trả lời cho các câu 74, 75, 76 dưới đây:</strong>\nNội dung ngữ liệu B.',
      prompt: 'Hỏi ý B2?',
      options: ['A', 'B', 'C', 'D'],
      answer: 'D'
    },
    {
      id: 'q_76',
      order: 76,
      section: 'part_3',
      type: 'single',
      clusterId: 'cluster_2',
      passageId: 'passage_2',
      passageContent: '<strong>Trả lời cho các câu 74, 75, 76 dưới đây:</strong>\nNội dung ngữ liệu B.',
      prompt: 'Hỏi ý B3?',
      options: ['A', 'B', 'C', 'D'],
      answer: 'A'
    }
  ];

  // Deterministic rng that swaps unit 0 and unit 1
  const reverseRng = () => 0;
  const shuffled = selectAndShuffleSectionQuestions('tsa', rawPart3Questions, 'part_3', {
    practiceMode: 'full',
    rng: reverseRng
  });

  assert.deepEqual(
    shuffled.map((q) => q.displayNumber),
    [1, 2, 3, 4, 5],
    'displayNumber must always be strictly sequential 1..N after shuffle'
  );
  assert.deepEqual(
    shuffled.map((q) => q.id),
    ['q_74', 'q_75', 'q_76', 'q_61', 'q_62'],
    'Cluster 2 should move before Cluster 1 while preserving internal question order'
  );
  assert.ok(
    shuffled[0].passageContent.includes('Trả lời cho các câu 1, 2, 3 dưới đây:'),
    `Expected Cluster 2 passage range to update to 1, 2, 3, got: ${shuffled[0].passageContent}`
  );
  assert.ok(
    shuffled[3].passageContent.includes('trả lời các câu hỏi từ câu 4 - 5:'),
    `Expected Cluster 1 passage range to update to 4 - 5, got: ${shuffled[3].passageContent}`
  );
  assert.equal(shuffled[3].prompt, 'Hỏi ý A1?', 'Stale leading Câu 61. prefix must be stripped');

  // Verify Drive compactQuestionStub + hydrateAttemptQuestionsMediaFromExam preserves sequential displayNumber and rewritten passage ranges
  const stubs = shuffled.map(compactQuestionStub);
  assert.deepEqual(stubs.map((s) => s.displayNumber), [1, 2, 3, 4, 5]);

  const driveExam = {
    id: 'exam_drive_tsa',
    exam_type: 'tsa',
    _examMeta: { storage: 'drive' },
    questions: rawPart3Questions
  };
  const hydrated = hydrateAttemptQuestionsMediaFromExam(driveExam, stubs);
  assert.deepEqual(hydrated.map((q) => q.displayNumber), [1, 2, 3, 4, 5]);
  assert.ok(hydrated[0].passageContent.includes('Trả lời cho các câu 1, 2, 3 dưới đây:'));
  assert.ok(hydrated[3].passageContent.includes('trả lời các câu hỏi từ câu 4 - 5:'));
});




