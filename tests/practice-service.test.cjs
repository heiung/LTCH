'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPracticeService } = require('../server/domain/practice.cjs');
test('practice keeps answer keys private, enforces window, ownership and publication times', async () => {
 let now = 100; const records = new Map();
 const exam = { status:'published', title:'Đề luyện', opensAt:50, closesAt:200, resultsAt:150, solutionsAt:180, questions:[{id:'q1', type:'single', prompt:'?', options:['a','b','c','d'], answer:'B', solution:'Lời giải', points:1}] };
 const repo = { getExam: async () => exam, saveAttemptOnce: async a => {if(records.has(a.attemptId))return false;records.set(a.attemptId,a);return true;}, getAttempt: async id => records.get(id) };
 const svc = createPracticeService({repository:repo, authorize: async a => a.uid === 'student', clock:()=>now}); const actor = {uid:'student'};
 const visible = await svc.read(actor,'exam'); assert.equal(visible.questions[0].answer, undefined); assert.equal(visible.questions[0].solution, undefined);
 await assert.rejects(svc.read({uid:'other'},'exam'));
 await svc.submit(actor,'exam','attempt_1234567890',{q1:'B'});
 await assert.rejects(svc.submit(actor,'exam','attempt_1234567890',{q1:'B'}));
 assert.deepEqual(await svc.result(actor,'exam','attempt_1234567890'),{status:'submitted',submittedAt:100});
 now=150; const graded=await svc.result(actor,'exam','attempt_1234567890'); assert.equal(graded.score,1); assert.equal(graded.solutions,undefined);
 now=180; assert.equal((await svc.result(actor,'exam','attempt_1234567890')).solutions[0].solution,'Lời giải');
 now=200; await assert.rejects(svc.submit(actor,'exam','another_1234567890',{q1:'B'}));
 exam.status='archived';assert.equal((await svc.result(actor,'exam','attempt_1234567890')).score,1);
 await assert.rejects(svc.read(actor,'exam'));
});
test('question projection rejects objects that could contain hidden answers', async () => {
 const exam={status:'published',title:'Test',opensAt:1,closesAt:200,questions:[{id:'q',type:'single',prompt:'?',points:1,answer:'A',options:[{text:'A',answer:true},'B','C','D']}]};
 const svc=createPracticeService({repository:{getExam:async()=>exam,saveAttemptOnce:async()=>true,getAttempt:async()=>null},authorize:async()=>true,clock:()=>100});
 await assert.rejects(svc.read({uid:'user'},'exam'),/Invalid choices/);
});

