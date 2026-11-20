import test from 'node:test';
import assert from 'node:assert/strict';
import {business} from '../worker/business.mjs';
test('Admin saves every supported class grant for an assistant and rejects unknown privileges',async()=>{
 const saved=[];
 const db={from(table){assert.ok(['ltch_accounts','ltch_classes'].includes(table));return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:table==='ltch_accounts'?{roles:['assistant'],status:'active'}:{id:'qa-class'}};}};}};
 const realFrom=db.from;db.from=table=>table==='ltch_class_memberships'?{async upsert(row){saved.push(row);return {data:null};}}:realFrom(table);
 const actor={uid:'owner',status:'active',roles:['admin'],memberships:[]};
 const send=permissions=>business(new Request('https://test/api/admin/memberships',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uid:'qa-assistant',classId:'qa-class',role:'assistant',status:'active',permissions})}),'/api/admin/memberships',{db,actor,env:{}});
 const grants=['attendance.write','materials.write','assignments.write','practice.manage','notices.write','messages.write','schedule.manage'];
 assert.equal((await send(grants)).status,200);assert.deepEqual(saved[0].permissions,grants);assert.equal(saved[0].class_id,'qa-class');assert.equal(saved[0].uid,'qa-assistant');
 await assert.rejects(send(['admin.accounts.write']),e=>e.status===400);assert.equal(saved.length,1);
 assert.equal((await send([])).status,200);assert.deepEqual(saved[1].permissions,[]);
});

test('reassigning an assistant without a permissions field preserves explicit revocations',async()=>{
 let saved={class_id:'qa-class',uid:'qa-assistant',member_role:'assistant',status:'active',permissions:[]};
 const defaults=['schedule.manage','attendance.write','materials.write','assignments.write','practice.manage','notices.write','messages.write'];
 const db={from(table){
  if(table==='ltch_accounts'||table==='ltch_classes')return {select(){return this},eq(){return this},async maybeSingle(){return {data:table==='ltch_accounts'?{roles:['assistant'],status:'active'}:{id:'qa-class'}}}};
  assert.equal(table,'ltch_class_memberships');
  return {
   async upsert(row,opts){if(!saved||!opts?.ignoreDuplicates)saved={...row};return {data:null}},
   update(change){return {eq(){return this},async select(){saved={...saved,...change};return {data:[{uid:saved.uid}]}}}}
  };
 }};
 const actor={uid:'owner',status:'active',roles:['admin'],memberships:[]};
 const send=body=>business(new Request('https://test/api/admin/memberships',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uid:'qa-assistant',classId:'qa-class',role:'assistant',status:'active',...body})}),'/api/admin/memberships',{db,actor,env:{}});
 assert.equal((await send({})).status,200);assert.deepEqual(saved.permissions,[]);
 saved=null;assert.equal((await send({})).status,200);assert.deepEqual(saved.permissions,defaults);
 assert.equal((await send({permissions:[]})).status,200);assert.deepEqual(saved.permissions,[]);
});

test('batch classIds updates multiple active classes in one request for permissions and status',async()=>{
 let upserted=[];
 const updated=[];
 const db={from(table){
  if(table==='ltch_accounts')return {select(){return this},eq(){return this},async maybeSingle(){return {data:{roles:['assistant'],status:'active'}}}};
  if(table==='ltch_classes')return {select(){return this},in(){return this},async eq(){return {data:[{id:'c1'},{id:'c2'}]}}};
  assert.equal(table,'ltch_class_memberships');
  return {
   async upsert(rows,opts){upserted.push({rows,opts});return {data:null}},
   update(change){return {in(){return this},eq(){return this},async select(){updated.push(change);return {data:[{uid:'qa-assistant'},{uid:'qa-assistant'}]}}}}
  };
 }};
 const actor={uid:'owner',status:'active',roles:['admin'],memberships:[]};
 const sendBatch=body=>business(new Request('https://test/api/admin/memberships',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uid:'qa-assistant',classIds:['c1','c2'],classId:'c1',role:'assistant',status:'active',...body})}),'/api/admin/memberships',{db,actor,env:{}});
 assert.equal((await sendBatch({permissions:['attendance.write','notices.write']})).status,200);
 assert.equal(upserted.length,1);
 assert.deepEqual(upserted[0].rows.map(r=>r.class_id),['c1','c2']);
 assert.deepEqual(upserted[0].rows[1].permissions,['attendance.write','notices.write']);

 upserted=[];
 assert.equal((await sendBatch({})).status,200);
 assert.equal(upserted[0].opts?.ignoreDuplicates,true);
 assert.equal(updated.length,1);
});
