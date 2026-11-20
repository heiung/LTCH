import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuestions} from '../worker/questions.mjs';
import {business} from '../worker/business.mjs';
test('question bank validates answer keys and strips unrelated fields',()=>{
 const q={id:'q1',type:'single',prompt:'2 + 2 = ?',points:1,options:['1','2','3','4'],answer:'D',secret:'should not persist'};
 assert.equal(validateQuestions([q])[0].secret,undefined);
 assert.throws(()=>validateQuestions([{...q,options:['one']}]),e=>e.status===400);
 assert.throws(()=>validateQuestions([{...q,answer:'E'}]));
 assert.throws(()=>validateQuestions([]),e=>e.status===400);
});
test('students, parents and assistants without practice permission cannot access bank keys',async()=>{
 const db={from(){throw Error('must not read bank');}};
 for(const role of ['student','parent','assistant']){
  const actor={uid:'x',status:'active',roles:[role],memberships:[{class_id:'c',member_role:role,permissions:[]}],childMemberships:[{class_id:'c',uid:'child'}]};
  await assert.rejects(business(new Request('https://test/api/classes/c/questions'),'/api/classes/c/questions',{db,actor,env:{}}),e=>e.status===403);
 }
});
