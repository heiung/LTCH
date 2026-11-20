import test from 'node:test';
import assert from 'node:assert/strict';
import {business} from '../worker/business.mjs';

test('workspace includes admin as assistant and preserves other assistants for every class', async () => {
 const people=[{uid:'owner',display_name:'Admin'},{uid:'helper1',display_name:'Trợ giảng 1'},{uid:'helper2',display_name:'Trợ giảng 2'},{uid:'student',display_name:'Học sinh',student_code:'2023034'}];
 const members=[{uid:'helper1',member_role:'assistant',status:'active'},{uid:'helper2',member_role:'assistant',status:'active'},{uid:'student',member_role:'student',status:'active'}];
 const db={from(table){const q={table,mode:'',filters:[],select(s){this.mode=s;return this},eq(k,v){this.filters.push([k,v]);return this},contains(k,v){this.filters.push([k,v]);return this},in(k,v){this.filters.push([k,v]);return this},or(){return this},order(){return this},limit(){return this},async maybeSingle(){return {data:{id:'c',name:'Lớp 6A'}}},then(resolve){let data=[];if(table==='ltch_class_memberships')data=structuredClone(members);if(table==='ltch_accounts'){const ids=this.filters.find(([k,v])=>k==='uid'&&Array.isArray(v))?.[1];data=this.filters.some(([k])=>k==='roles')?[{uid:'owner'}]:people.filter(p=>!ids||ids.includes(p.uid));}return Promise.resolve({data}).then(resolve)}};return q;}};
 const student={uid:'student',status:'active',roles:['student'],memberships:[{class_id:'c',member_role:'student'}],childMemberships:[]};
 const result=await business(new Request('https://test/api/classes/c/workspace'),'/api/classes/c/workspace',{db,actor:student,env:{}});
 const view=await result.json();assert.equal(result.status,200);
 assert.deepEqual(view.contacts.map(x=>x.uid).sort(),['helper1','helper2','owner']);
 assert.deepEqual(view.members,[],'students must not see staff roster');
 assert.equal(JSON.stringify(view).includes('2023034'),false,'student codes must not leak through student workspace');
 const staff={uid:'helper1',status:'active',roles:['assistant'],memberships:[{class_id:'c',member_role:'assistant',permissions:[]}],childMemberships:[]};
 const staffView=await (await business(new Request('https://test/api/classes/c/workspace'),'/api/classes/c/workspace',{db,actor:staff,env:{}})).json();
 assert.equal(staffView.members.find(m=>m.uid==='student').student_code,'2023034');
});

test('saving an admin account retains assistant role without adding it to other roles',async()=>{
 const saved=[];const db={from(table){assert.equal(table,'ltch_accounts');return {update(row){saved.push(row);return this},eq(){return this},async select(){return {data:[{uid:'target'}]}}}}};
 const actor={uid:'owner',status:'active',roles:['admin'],memberships:[]};
 const send=roles=>business(new Request('https://test/api/admin/accounts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uid:'target',status:'active',roles})}),'/api/admin/accounts',{db,actor,env:{}});
 assert.equal((await send(['admin'])).status,200);assert.deepEqual(saved[0].roles,['admin','assistant']);
 assert.equal((await send(['assistant'])).status,200);assert.deepEqual(saved[1].roles,['assistant']);
});

