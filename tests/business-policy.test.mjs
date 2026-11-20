import test from 'node:test';import assert from 'node:assert/strict';import {staffCan,classCanRead,studentScope,data} from '../worker/policy.mjs';import {business} from '../worker/business.mjs';
const a=roles=>({uid:'u',status:'active',roles,memberships:[]});
test('per-class membership prevents mixed-role escalation and assistant writes require explicit grants',()=>{
 const actor={...a(['teacher','student','assistant']),memberships:[{class_id:'student-class',member_role:'student'},{class_id:'assistant-class',member_role:'assistant',permissions:['attendance.write']}]};
 assert.equal(staffCan(actor,'student-class','assignments.write'),false);assert.equal(staffCan(actor,'assistant-class','assignments.write'),false);assert.equal(staffCan(actor,'assistant-class','attendance.write'),true);
 const parent={...a(['parent']),childMemberships:[{class_id:'child-class',uid:'child'}]};assert.equal(classCanRead(parent,'child-class'),true);assert.equal(classCanRead(parent,'other'),false);assert.deepEqual(studentScope(parent,'child-class'),['child']);
});
test('administration and unrelated class requests are rejected before any database operation',async()=>{
 const db={from(){throw Error('must not reach database');}};
 for(const actor of [a(['student']),a(['parent']),{...a(['admin']),status:'disabled'}])await assert.rejects(business(new Request('https://test/api/admin/accounts'),'/api/admin/accounts',{db,actor,env:{}}),e=>e.status===403);
 await assert.rejects(business(new Request('https://test/api/classes/no/workspace'),'/api/classes/no/workspace',{db,actor:a(['teacher']),env:{}}),e=>e.status===403);
});
test('assistant message writes require an explicit grant before recipient data is read',async()=>{
 const actor={...a(['assistant']),memberships:[{class_id:'c',member_role:'assistant',permissions:[]}]};
 const req=new Request('https://test/api/classes/c/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({recipientUid:'r',body:'test'})});
 await assert.rejects(business(req,'/api/classes/c/messages',{db:{from(){throw Error('must not read recipient');}},actor,env:{}}),e=>e.status===403);
});
test('a protected global teacher assignment returns a clear conflict',()=>{
 assert.throws(()=>data({error:{message:'LTCH_GLOBAL_TEACHER_MEMBERSHIP'}}),e=>e.status===409 && /tất cả lớp/.test(e.message));
 assert.throws(()=>data({error:{message:'LTCH_GLOBAL_ASSISTANT_MEMBERSHIP'}}),e=>e.status===409 && /Trợ giảng/.test(e.message));
});
