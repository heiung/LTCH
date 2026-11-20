import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollment,canReviewEnrollment} from '../worker/enrollment-handler.mjs';

test('enrollment reviewers are restricted to administrators or teachers assigned to the class',()=>{
 const teacher={uid:'teacher',status:'active',roles:['teacher'],memberships:[{class_id:'a',member_role:'teacher'}]};
 assert.equal(canReviewEnrollment(teacher,'a'),true);
 assert.equal(canReviewEnrollment(teacher,'b'),false);
 assert.equal(canReviewEnrollment({...teacher,status:'disabled'},'a'),false);
 assert.equal(canReviewEnrollment({uid:'s',status:'active',roles:['student'],memberships:[]},'a'),false);
});
test('disabled and unauthenticated users cannot read enrollment state',async()=>{
 const db={from(){throw Error('must not query');}};
 for(const actor of [null,{uid:'s',status:'disabled',roles:[],memberships:[]}]){
  await assert.rejects(enrollment(new Request('https://test/api/enrollment/my-status'),'/api/enrollment/my-status',{db,actor,env:{}}),e=>e.status===403);
 }
});
