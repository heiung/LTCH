import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseRepository} from '../worker/supabase-repository.mjs';
import {enrollment} from '../worker/enrollment-handler.mjs';
import {business} from '../worker/business.mjs';

function database() {
 const tables={
  ltch_classes:[{id:'class-6a',name:'Lớp 6',school_year_id:'year',archived:false,enrollment_open:true,schedule:''},{id:'class-6b',name:'Lớp 6B',school_year_id:'year',archived:true,enrollment_open:false,schedule:''}],
  ltch_school_years:[{id:'year',starts_on:'2026-01-01'}],
  ltch_accounts:[{uid:'student',status:'active',roles:['student']}],
  ltch_class_memberships:[]
 };
 return {tables,from(name){
  let rows=tables[name],filters=[];
  const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,values){filters.push(r=>values.includes(r[k]));return q},order(){return q},limit(){return q},maybeSingle(){return Promise.resolve({data:rows.filter(r=>filters.every(f=>f(r)))[0]||null,error:null})},upsert(row){rows.push(row);return Promise.resolve({data:null,error:null})},then(resolve,reject){return Promise.resolve({data:rows.filter(r=>filters.every(f=>f(r))),error:null}).then(resolve,reject)}};return q;
 }};
}

test('archived classes stay out of the class list and enrollment catalog',async()=>{
 const db=database(),repo=createSupabaseRepository(db);
 const admin={uid:'admin',status:'active',roles:['admin'],memberships:[],childMemberships:[]};
 assert.deepEqual((await repo.classesFor(admin)).map(c=>c.id),['class-6a']);
 const response=await enrollment(new Request('https://test/api/enrollment/catalog'),'/api/enrollment/catalog',{db,actor:{uid:'pending',status:'pending',roles:[]}});
 assert.deepEqual((await response.json()).classes.map(c=>c.id),['class-6a']);
});

test('an administrator cannot assign a member to an archived class',async()=>{
 const db=database(),actor={uid:'admin',status:'active',roles:['admin'],memberships:[]};
 const request=new Request('https://test/api/admin/memberships',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uid:'student',classId:'class-6b',role:'student'})});
 await assert.rejects(business(request,'/api/admin/memberships',{db,actor,env:{}}),e=>e.status===400);
 assert.equal(db.tables.ltch_class_memberships.length,0);
});
