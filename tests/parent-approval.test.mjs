import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollment} from '../worker/enrollment-handler.mjs';
import templates from '../server/domain/notification-templates.cjs';

const request=()=>new Request('https://test/api/admin/enrollments/students?classId=c');
test('parent approval student picker is limited to administrators and the class teacher',async()=>{
 for(const roles of [['student'],['parent'],['assistant'],['teacher']])await assert.rejects(enrollment(request(),'/api/admin/enrollments/students',{actor:{uid:'u',status:'active',roles,memberships:[]},db:{from(){throw Error('must not read');}},env:{}}),e=>e.status===403);
});
test('parent approval lists active students without exposing account email or other roles',async()=>{
 const db={from(table){return {select(){return this;},eq(){return this;},in(){return this;},then(resolve){resolve({data:table==='ltch_class_memberships'?[{uid:'s'},{uid:'t'}]:[{uid:'s',display_name:'Học sinh',student_code:'2023034',roles:['student'],email:'private'},{uid:'t',display_name:'Giáo viên',roles:['teacher'],email:'private'}]});}};}};
 const response=await enrollment(request(),'/api/admin/enrollments/students',{actor:{uid:'teacher',status:'active',roles:['teacher'],memberships:[{class_id:'c',member_role:'teacher'}]},db,env:{}});
 assert.deepEqual(await response.json(),{items:[{uid:'s',name:'Học sinh',studentCode:'2023034'}]});
});
test('parent approval email describes linked-student access instead of student submission rights',()=>{
 const mail=templates.renderNotification('parent_approval_notice',{full_name:'Học sinh A <script>',class_name:'Lớp 6A'});
 assert.match(mail.subject,/phụ huynh/);assert.match(mail.body,/học sinh được liên kết/);assert.doesNotMatch(mail.body,/làm bài thi|nộp bài tập|{{/);
 assert.match(mail.htmlBody,/<!DOCTYPE html>/i);
 assert.match(mail.htmlBody,/Học sinh A &lt;script&gt;/);
 assert.doesNotMatch(mail.htmlBody,/<script>/i);
});
