import test from 'node:test';
import assert from 'node:assert/strict';
import {sortClasses,groupClasses,className,classGrade,validateSchedule,scheduleText} from '../shared/classroom.mjs';
import {business} from '../worker/business.mjs';

test('classes sort by numeric grade from THCS to THPT and A before B without changing IDs',()=>{
 const input=['Lớp 12A2 (Luyện thi THPTQG)','Lớp 10A2','Lớp 9B','Lớp 6B','Lớp 12A1','Lớp 6A','Lớp 11A2','Lớp 10A1','Chuyên đề khác'].map((name,i)=>({id:String(i),name}));
 const sorted=sortClasses(input);
 assert.deepEqual(sorted.map(c=>c.name),['Lớp 6A','Lớp 6B','Lớp 9B','Lớp 10A','Lớp 10B','Lớp 11B','Lớp 12A','Lớp 12B (Luyện thi THPTQG)','Chuyên đề khác']);
 assert.equal(sorted.find(c=>c.name==='Lớp 10B').id,'1');assert.equal(input[1].name,'Lớp 10A2');
 assert.equal(className('Lớp 10B'),'Lớp 10B');assert.equal(classGrade('Lớp 16A'),99);assert.equal(classGrade('Lớp 9A (Ôn thi vào 10)'),9);
});

test('current class names sort correctly, including grades without a letter',()=>{
 const names=['Lớp 12','Lớp 9B','Lớp 7','Lớp 10B','Lớp 6','Lớp 8B','Lớp 11','Lớp 9A','Lớp 10A','Lớp 8A'];
 const classes=names.map((name,i)=>({id:String(i),name}));
 assert.deepEqual(sortClasses(classes).map(c=>c.name),['Lớp 6','Lớp 7','Lớp 8A','Lớp 8B','Lớp 9A','Lớp 9B','Lớp 10A','Lớp 10B','Lớp 11','Lớp 12']);
 assert.deepEqual(groupClasses(classes).map(g=>g.optgroup),['Khối 6 · THCS','Khối 7 · THCS','Khối 8 · THCS','Khối 9 · THCS','Khối 10 · THPT','Khối 11 · THPT','Khối 12 · THPT']);
});

test('schedule validates real times, weekdays, duration, overlaps and a bounded weekly size',()=>{
 for(const input of [null,{},[{day:0,start:'18:00',end:'20:00'}],[{day:2,start:'25:00',end:'26:00'}],[{day:1,start:'20:00',end:'18:00'}],[{day:1,start:'18:00',end:'18:00'}],[{day:1,start:'18:00',end:'20:00'},{day:1,start:'19:00',end:'21:00'}],Array(15).fill({day:1,start:'18:00',end:'20:00'})])assert.throws(()=>validateSchedule(input));
 assert.deepEqual(validateSchedule([{day:5,start:'19:00',end:'20:00',extra:'ignored'},{day:1,start:'18:00',end:'20:00'},{day:1,start:'20:00',end:'21:00'}]),[{day:1,start:'18:00',end:'20:00'},{day:1,start:'20:00',end:'21:00'},{day:5,start:'19:00',end:'20:00'}]);
 assert.equal(scheduleText([{day:7,start:'00:05',end:'01:05'}]),'Chủ nhật · 00:05–01:05');assert.equal(scheduleText([]),'');
});

test('enrollment groups never mistake entrance-exam text for a second grade',()=>{
 const groups=groupClasses([{id:'9a',name:'Lớp 9A (Ôn thi vào 10)'},{id:'10b',name:'Lớp 10B'},{id:'6a',name:'Lớp 6A'}]);
 assert.deepEqual(groups.map(g=>g.optgroup),['Khối 6 · THCS','Khối 9 · THCS','Khối 10 · THPT']);
 assert.deepEqual(groups.flatMap(g=>g.options.map(o=>o.value)),['6a','9a','10b']);
});

test('only assigned teachers/admins can save a schedule; stale edits cannot overwrite a newer timetable',async()=>{
 const post=body=>new Request('https://test/api/classes/c/schedule',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const body={version:2,remindersEnabled:true,scheduleSlots:[{day:2,start:'18:00',end:'20:00'}]};
 const base={uid:'u',status:'active',memberships:[{class_id:'c',member_role:'assistant',permissions:['attendance.write']}],childMemberships:[]};
 for(const roles of [['assistant'],['student'],['parent']])await assert.rejects(business(post(body),'/api/classes/c/schedule',{actor:{...base,roles},db:{from(){throw Error('must not query');}},env:{}}),e=>e.status===403);
 let patch,filters=[];const db={from(){return {update(value){patch=value;return this;},eq(key,value){filters.push([key,value]);return this;},async select(){return {data:[]};}};}};
 await assert.rejects(business(post(body),'/api/classes/c/schedule',{actor:{...base,roles:['teacher'],memberships:[{class_id:'c',member_role:'teacher'}]},db,env:{}}),e=>e.status===409);
 assert.deepEqual(filters,[['id','c'],['schedule_revision',2]]);assert.equal(patch.schedule_revision,3);assert.equal(patch.schedule,'Thứ Ba · 18:00–20:00');
});
