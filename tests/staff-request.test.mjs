import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {enrollment} from '../worker/enrollment-handler.mjs';
import {notifyStaffRequest} from '../worker/staff-request-mail.mjs';

const env={MAIL_SECRET:'x'.repeat(40),MAIL_ENDPOINT:'https://script.google.com/macros/s/test/exec'};
const request=role=>new Request('https://test/api/enrollment/staff-request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role})});

test('staff notification is signed in UTF-8, addressed to the official admin and deduplicated',async()=>{
 const account={uid:'some-uid',display_name:'Giáo viên thử',email:'test@example.com'},messages=[];
 const send=async(_url,options)=>{const envelope=JSON.parse(options.body);const expected=createHmac('sha256',env.MAIL_SECRET).update([envelope.timestamp,envelope.nonce,envelope.payload].join('\n')).digest('hex');assert.equal(envelope.signature,expected);messages.push(JSON.parse(envelope.payload));return new Response(JSON.stringify({ok:true}),{status:200});};
 assert.equal(await notifyStaffRequest(env,account,'teacher',send),true);
 assert.equal(await notifyStaffRequest(env,account,'teacher',send),true);
 assert.equal(messages[0].email,'admin@example.com');
 assert.match(messages[0].body,/Giáo viên thử/);assert.match(messages[0].htmlBody,/Giáo viên thử/);assert.equal(messages[0].eventId,messages[1].eventId);
 assert.ok(messages[0].body.includes('https://ltch.example.com/admin/staff'));
 assert.ok(messages[0].htmlBody.includes('https://ltch.example.com/admin/staff'));
 assert.ok(messages[0].htmlBody.includes('https://ltch.example.com/overview'));
 assert.doesNotMatch(messages[0].body,/\/app\b/);
 assert.doesNotMatch(messages[0].htmlBody,/\/app\b/);
 assert.equal(await notifyStaffRequest(env,account,'assistant',async()=>{throw Error('offline')}),false);
});

test('teacher and assistant requests stay pending; repeats are safe and existing enrollment is protected',async()=>{
 for(const role of ['teacher','assistant']){
  const account={uid:'pending-user',display_name:'Người thử',email:'test@example.com',status:'pending',roles:[]};let enrollmentRow=null;
  const db={from(table){const q={filters:[],select(){return this},eq(k,v){this.filters.push([k,v]);return this},update(change){this.change=change;return this},async maybeSingle(){return {data:table==='ltch_accounts'?{...account,roles:[...account.roles]}:enrollmentRow}},then(resolve){if(this.change){assert.equal(table,'ltch_accounts');if(account.status==='pending'&&account.roles.length===0){account.roles=this.change.roles;return Promise.resolve({data:[{uid:account.uid}]}).then(resolve)}return Promise.resolve({data:[]}).then(resolve)}return Promise.resolve({data:[]}).then(resolve)}};return q}};
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({ok:true}),{status:200});
  try{
   const actor=()=>({uid:account.uid,status:account.status,roles:[...account.roles],memberships:[],childMemberships:[]});
   const send=r=>enrollment(request(r),'/api/enrollment/staff-request',{db,actor:actor(),env,limit:async()=>true});
   const res=await send(role);assert.deepEqual(await res.json(),{ok:true,notificationStatus:'sent'});assert.equal(account.status,'pending');assert.deepEqual(account.roles,[role]);
   assert.equal((await send(role)).status,200);
   await assert.rejects(send(role==='teacher'?'assistant':'teacher'),e=>e.status===409);
   enrollmentRow={id:'existing'};await assert.rejects(send(role),e=>e.status===409);
  }finally{globalThis.fetch=originalFetch;}
 }
});

test('invalid staff roles and active accounts cannot submit staff requests',async()=>{
 const db={from(){throw Error('must not read account')}};
 for(const actor of [{uid:'u',status:'pending',roles:[]},{uid:'u',status:'active',roles:['student']}]){
  await assert.rejects(enrollment(request(actor.status==='active'?'teacher':'admin'),'/api/enrollment/staff-request',{db,actor,env,limit:async()=>true}),e=>e.status===(actor.status==='active'?403:400));
 }
});
