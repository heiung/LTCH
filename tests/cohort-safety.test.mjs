import test from 'node:test';
import assert from 'node:assert/strict';
import { business } from '../worker/business.mjs';

test('viewing cohorts performs no writes and only admins can mutate classes or cohorts',async()=>{
 let writes=0;
 const tables={ltch_school_years:[],ltch_classes:[{id:'class-6b',name:'Lớp 6B',school_year_id:'year1',archived:true}]};
 const db={from(name){const q={select(){return q},eq(){return q},maybeSingle(){return q},order(){return q},limit(){return q},insert(){writes++;return q},delete(){writes++;return q},update(){writes++;return q},upsert(){writes++;return q},then(resolve){return Promise.resolve({data:tables[name]||[],error:null}).then(resolve)}};return q;},rpc(){writes++;throw Error('unexpected write');}};
 const path='/api/classes/cohorts';
 const assistant={uid:'assistant',status:'active',roles:['assistant'],memberships:[],childMemberships:[]};
 const teacher={uid:'teacher',status:'active',roles:['teacher'],memberships:[{class_id:'class-6b',member_role:'teacher',status:'active',permissions:[]}],childMemberships:[]};
 const response=await business(new Request(`https://example.test${path}`),path,{db,actor:assistant,env:{}});
 assert.equal(response.status,200);assert.equal((await response.json()).archivedClasses.length,1);assert.equal(writes,0);
 for (const actor of [assistant, teacher]) {
  for (const body of [
   {action:'advance_school_year'},
   {action:'create_class',name:'Lớp 6C',schoolYearId:'year1'},
   {action:'archive_class',classId:'class-6b'},
   {action:'restore_class',classId:'class-6b'},
   {action:'delete_archived_class',classId:'class-6b'}
  ]) {
   const request=new Request(`https://example.test${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   await assert.rejects(business(request,path,{db,actor,env:{}}),error=>error.status===403);
  }
 }
 assert.equal(writes,0);
});
