import test from 'node:test';import assert from 'node:assert/strict';import {createPracticeHandler} from '../worker/practice-handler.mjs';
test('practice endpoints keep keys server-side and require a class membership',async()=>{
 const exam={id:'e',classId:'c',status:'published',title:'Luyện',opensAt:1,closesAt:200,resultsAt:150,solutionsAt:180,questions:[{id:'q',type:'single',prompt:'?',options:['1','2','3','4'],points:1,answer:'B',solution:'secret'}]};
 let allowed=true;const records=new Map();
 const repo={getExam:async()=>exam,saveAttemptOnce:async a=>{records.set(a.attemptId,a);return true;},getAttempt:async id=>records.get(id)};
 const handler=createPracticeHandler({auth:{authenticate:async()=>({uid:'u'})},accounts:{actor:async()=>({uid:'u',roles:['student'],memberships:allowed?[{class_id:'c',member_role:'student'}]:[]})},repository:repo,clock:()=>100});
 let response=await handler(new Request('https://example.test'),{examId:'e',action:'read'});const body=await response.text();assert.equal(response.status,200);assert.ok(!body.includes('secret'));assert.ok(!body.includes('answer'));
 allowed=false;response=await handler(new Request('https://example.test'),{examId:'e',action:'read'});assert.equal(response.status,400);
});

