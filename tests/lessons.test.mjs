import test from 'node:test';
import assert from 'node:assert/strict';
import {lessons} from '../worker/lessons.mjs';

const student={uid:'s',status:'active',roles:['student'],memberships:[{class_id:'c',member_role:'student'}],childMemberships:[]};
const parent={uid:'p',status:'active',roles:['parent'],memberships:[],childMemberships:[{class_id:'c',uid:'s'}]};
const assistant={uid:'a',status:'active',roles:['assistant'],memberships:[{class_id:'c',member_role:'assistant',permissions:['materials.write']}],childMemberships:[]};
const enabled={LTCH_LESSONS_ENABLED:'1',LTCH_LESSONS_AUDIENCE:'all'};
function fakeDb(tables){
 return {from(table){
  let rows=[...(tables[table]||[])],columns;
  const q={
   select(c){columns=c.split(',');return this;},
   eq(k,v){rows=rows.filter(r=>r[k]===v);return this;},
   or(s){const m=/^created_at\.lt\.(\d+),and\(created_at\.eq\.\1,id\.lt\.([A-Za-z0-9_-]+)\)$/.exec(s);assert.ok(m);rows=rows.filter(r=>r.created_at<Number(m[1])||r.created_at===Number(m[1])&&r.id<m[2]);return this;},
   order(){return this;},
   insert(row){(tables[table]??=[]).push(row);return Promise.resolve({data:null,error:null});},
   maybeSingle(){return Promise.resolve({data:rows[0]||null,error:null});},
   limit(n){rows.sort((a,b)=>b.created_at-a.created_at||(a.id<b.id?1:-1));return Promise.resolve({data:rows.slice(0,n).map(row=>Object.fromEntries(columns.map(c=>[c,row[c]]))),error:null});}
  };return q;
 }};
}
const req=(path,body)=>new Request(`https://example.test${path}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);

test('lesson creation requires materials permission in the actual class and a feature flag',async()=>{
 const tables={},db=fakeDb(tables),path='/api/classes/c/lessons';
 const limited={...assistant,memberships:[{...assistant.memberships[0],permissions:[]}]};
 for(const actor of [student,parent,limited])await assert.rejects(lessons(req(path,{title:'A'}),path,{db,actor,env:enabled}),e=>e.status===403);
 await assert.rejects(lessons(req(path,{title:'A'}),path,{db,actor:assistant,env:{}}),e=>e.status===404);
 const response=await lessons(req(path,{title:' Bài 1 ',topic:'Đại số'}),path,{db,actor:assistant,env:enabled});
 assert.equal(response.status,201);assert.equal(tables.ltch_lessons[0].title,'Bài 1');assert.equal(tables.ltch_lessons[0].class_id,'c');
 await assert.rejects(lessons(req('/api/classes/other/lessons',{title:'A'}),'/api/classes/other/lessons',{db,actor:assistant,env:enabled}),e=>e.status===403);
});
test('lessons are open to all authorized class members when enabled, unless restricted to pilot',async()=>{
 const path='/api/classes/c/lessons',db=fakeDb({ltch_lessons:[]}),env={LTCH_LESSONS_ENABLED:'1'};
 for(const actor of [student,parent,assistant])assert.equal((await lessons(req(path),path,{db,actor,env})).status,200);
 const pilotEnv={LTCH_LESSONS_ENABLED:'1',LTCH_LESSONS_AUDIENCE:'pilot'};
 for(const actor of [student,parent,assistant])await assert.rejects(lessons(req(path),path,{db,actor,env:pilotEnv}),e=>e.status===404);
 const admin={uid:'owner',status:'active',roles:['admin'],memberships:[],childMemberships:[]};
 assert.equal((await lessons(req(path),path,{db,actor:admin,env:pilotEnv})).status,200);
 assert.equal((await lessons(req(path),path,{db,actor:student,env:enabled})).status,200);
});

test('pilot allowlist enables only selected users and still enforces class permissions',async()=>{
 const db=fakeDb({ltch_lessons:[]}),path='/api/classes/c/lessons';
 const env={LTCH_LESSONS_ENABLED:'1',LTCH_LESSONS_PILOT_UIDS:' a, p '};
 assert.equal((await lessons(req(path),path,{db,actor:assistant,env})).status,200);
 assert.equal((await lessons(req(path),path,{db,actor:parent,env})).status,200);
 await assert.rejects(lessons(req(path),path,{db,actor:student,env}),e=>e.status===404);
 await assert.rejects(lessons(req('/api/classes/other/lessons'),'/api/classes/other/lessons',{db,actor:assistant,env}),e=>e.status===403);
 await assert.rejects(lessons(req(path),path,{db,actor:assistant,env:{...env,LTCH_LESSONS_ENABLED:'0'}}),e=>e.status===404);
});

test('parents and students see only stored files for an authorized lesson; Drive IDs stay server-side',async()=>{
 const db=fakeDb({ltch_lessons:[{id:'l',class_id:'c',created_at:5}],ltch_lesson_files:[
  {id:'f1',class_id:'c',lesson_id:'l',status:'stored',name:'Đề.pdf',content_type:'application/pdf',file_size:123,created_at:4,drive_file_id:'secret-id'},
  {id:'f2',class_id:'c',lesson_id:'l',status:'pending',name:'pending',created_at:3},
  {id:'f3',class_id:'other',lesson_id:'l',status:'stored',name:'wrong-class',created_at:2}
 ]}),path='/api/classes/c/lessons/l/files';
 for(const actor of [parent,student]){
  const result=await (await lessons(req(path),path,{db,actor,env:enabled})).json();
  assert.deepEqual(result.items.map(x=>x.name),['Đề.pdf']);assert.equal('drive_file_id' in result.items[0],false);
 }
 await assert.rejects(lessons(req('/api/classes/other/lessons/l/files'),'/api/classes/other/lessons/l/files',{db,actor:parent,env:enabled}),e=>e.status===403);
 await assert.rejects(lessons(req('/api/classes/c/lessons/other/files'),'/api/classes/c/lessons/other/files',{db,actor:parent,env:enabled}),e=>e.status===404);
});

test('lesson pagination preserves records with the same timestamp and rejects malformed cursors',async()=>{
 const rows=Array.from({length:120},(_,i)=>({id:`l${String(i).padStart(3,'0')}`,title:'Bài',topic:'',class_id:'c',created_at:5}));
 const db=fakeDb({ltch_lessons:rows}),path='/api/classes/c/lessons',all=[];let query='';
 do{
  const page=await (await lessons(req(path+query),path,{db,actor:student,env:enabled})).json();all.push(...page.items);
  const last=page.items.at(-1);query=page.hasMore?`?beforeCreatedAt=${last.created_at}&beforeId=${last.id}`:'';
 }while(query);
 assert.equal(all.length,120);assert.equal(new Set(all.map(x=>x.id)).size,120);
 for(const query of ['?beforeCreatedAt=1','?beforeCreatedAt=-1&beforeId=x','?beforeCreatedAt=1&beforeId=x%2Cy'])await assert.rejects(lessons(req(path+query),path,{db,actor:student,env:enabled}),e=>e.status===400);
});
