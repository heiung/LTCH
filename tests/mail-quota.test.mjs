import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverNotification} from '../worker/mail-queue.mjs';
import {createWorker} from '../worker/index.mjs';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHmac} from 'node:crypto';
const env={ALLOWED_ORIGIN:'https://ltch.example.com',SUPABASE_URL:'https://your-project.supabase.co',SUPABASE_SECRET:'test-only',MAIL_SECRET:'x'.repeat(32),MAIL_ENDPOINT:'https://script.google.com/macros/s/test/exec',FIREBASE_API_KEY:'test-public'};
const response=ok=>new Response(JSON.stringify({ok}),{headers:{'content-type':'application/json'}});

function outboxFixture(){
 const rows=new Map();
 const db={
  async rpc(name,{p_id,p_token}){const row=rows.get(p_id);assert.equal(name,row?.template==='class_notice'?'ltch_claim_notice_mail':'ltch_claim_mail');if(!row||row.status==='sent')return {data:false};row.lease_token=p_token;return {data:true};},
  from(name){assert.equal(name,'ltch_mail_outbox');let id,token,patch;return {
   select(){return this;},update(value){patch=value;return this;},eq(key,value){if(key==='id')id=value;if(key==='lease_token')token=value;return this;},
   async maybeSingle(){return {data:rows.get(id)||null};},
   then(resolve){const row=rows.get(id);if(row&&row.lease_token===token)Object.assign(row,patch);resolve({data:null});}
  };}
 };
 const add=id=>rows.set(id,{id,status:'pending',recipient:'student@example.com',template:'approval_notice',payload:{full_name:'Test'},lease_until:0,attempt_count:0,next_attempt_at:0});
 return {db,rows,add};
}

test('Vietnamese notification survives the Apps Script transport and uses explicit UTF-8 signatures',async t=>{
 const {db,rows,add}=outboxFixture();add('unicode-approval');rows.get('unicode-approval').payload={full_name:'QA Học sinh Nguyễn',class_name:'Lớp 6A'};
 const values={LTCH_MAIL_SECRET:env.MAIL_SECRET},sent=[];
 const props={getProperty:k=>values[k],setProperty:(k,v)=>values[k]=v,getProperties:()=>({...values}),deleteProperty:k=>delete values[k]};
 const context={PropertiesService:{getScriptProperties:()=>props},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(m,s,encoding)=>{assert.equal(encoding,'utf8');return [...createHmac('sha256',s).update(m,encoding).digest()];}},MailApp:{sendEmail:mail=>sent.push(mail)},ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({setMimeType:()=>value})},console,Date,JSON,Number,Object};
 vm.createContext(context);vm.runInContext(fs.readFileSync('integrations/apps-script-otp/Code.gs','utf8'),context);
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.match(options.headers['content-type'],/charset=utf-8/);assert.match(options.body,/^[\x00-\x7f]*$/);
  const contents=Buffer.from(options.body,'utf8').toString('latin1');
  return new Response(context.doPost({postData:{contents}}),{headers:{'content-type':'application/json'}});
 });
 assert.equal(await deliverNotification(db,env,'unicode-approval'),'sent');
 assert.deepEqual(rows.get('unicode-approval').payload,{});
 assert.equal(sent.length,1);assert.match(sent[0].body,/QA Học sinh Nguyễn/);assert.match(sent[0].subject,/Lớp Toán cô Hạnh/);
 assert.equal(sent[0].name,'Lớp Toán cô Hạnh');assert.match(sent[0].htmlBody,/QA Học sinh Nguyễn/);assert.match(sent[0].htmlBody,/<!DOCTYPE html>/i);
 assert.equal(await deliverNotification(db,env,'unicode-approval'),'sent');assert.equal(sent.length,1);
});

test('queued class notices deliver complete text and attachment details through Apps Script', async t => {
 const {db, rows, add} = outboxFixture();
 add('notice-email');
 Object.assign(rows.get('notice-email'), {template:'class_notice', payload:{
  student_name:'Minh', class_name:'Lớp 6A', class_id:'class-6a', notice_title:'Thông báo kiểm thử',
  notice_body:'Nội dung tiếng Việt '.repeat(500), sender_name:'Cô Hạnh', posted_at:'20:00 16/11/2026',
  attachments:[{name:'Ảnh lớp.png',type:'image/png'},{name:'Video.mp4',type:'video/mp4'}]
 }});
 const values={LTCH_MAIL_SECRET:env.MAIL_SECRET},sent=[];
 const props={getProperty:k=>values[k],setProperty:(k,v)=>values[k]=v,getProperties:()=>({...values}),deleteProperty:k=>delete values[k]};
 const context={PropertiesService:{getScriptProperties:()=>props},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(m,s,encoding)=>[...createHmac('sha256',s).update(m,encoding).digest()]},MailApp:{sendEmail:mail=>sent.push(mail)},ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({setMimeType:()=>value})},console,Date,JSON,Number,Object};
 vm.createContext(context);vm.runInContext(fs.readFileSync('integrations/apps-script-otp/Code.gs','utf8'),context);
 t.mock.method(globalThis,'fetch',async(url,options)=>new Response(context.doPost({postData:{contents:options.body}}),{headers:{'content-type':'application/json'}}));
 assert.equal(await deliverNotification(db,env,'notice-email'),'sent');
 assert.equal(sent.length,1);
 assert.match(sent[0].body,/Ảnh lớp\.png/);
 assert.match(sent[0].htmlBody,/Video\.mp4/);
 assert.equal((sent[0].body.match(/Nội dung tiếng Việt/g)||[]).length,500);
 assert.match(sent[0].htmlBody,/class\/class-6a\/notifications/);
 assert.deepEqual(rows.get('notice-email').payload,{});
});

test('business mail can exceed both previous daily caps while Google accepts delivery',async t=>{
 const {db,rows,add}=outboxFixture();let sent=0;
 t.mock.method(globalThis,'fetch',async()=>{sent++;return response(true);});
 for(let i=1;i<=81;i++){const id=`test-mail-${i}`;add(id);assert.equal(await deliverNotification(db,env,id),'sent');}
 assert.equal(sent,81);assert.equal([...rows.values()].every(row=>row.status==='sent'),true);
});

test('a Google delivery refusal leaves mail pending and a later successful retry does not resend it again',async t=>{
 const {db,rows,add}=outboxFixture();add('retry-event');let googleAccepts=false,sent=0;
 t.mock.method(globalThis,'fetch',async()=>{sent++;return response(googleAccepts);});
 assert.equal(await deliverNotification(db,env,'retry-event'),'pending');assert.equal(rows.get('retry-event').status,'pending');
 assert.equal(rows.get('retry-event').attempt_count,1);assert.ok(rows.get('retry-event').next_attempt_at>Date.now());
 googleAccepts=true;
 assert.equal(await deliverNotification(db,env,'retry-event'),'sent');assert.equal(rows.get('retry-event').status,'sent');
 assert.equal(await deliverNotification(db,env,'retry-event'),'sent');assert.equal(sent,2);
});

test('older mail tables use their existing lease to delay another automatic attempt',async t=>{
 const {db,rows,add}=outboxFixture();add('legacy-event');
 const row=rows.get('legacy-event');
 delete row.attempt_count;
 delete row.next_attempt_at;
 t.mock.method(globalThis,'fetch',async()=>response(false));
 assert.equal(await deliverNotification(db,env,row.id),'pending');
 assert.equal(row.status,'pending');
 assert.ok(row.lease_until>Date.now());
 assert.equal(Object.hasOwn(row,'attempt_count'),false);
 assert.equal(Object.hasOwn(row,'next_attempt_at'),false);
});

test('OTP can exceed the former shared daily budget while keeping account cooldown and IP limits',async t=>{
 const rows=new Map(),rates=new Map();let delivered=0;
 const db={
  async rpc(name,args){assert.equal(name,'ltch_consume_rate');const count=(rates.get(args.p_id)||0)+1;rates.set(args.p_id,count);return {data:count<=args.p_max};},
  from(name){assert.equal(name,'ltch_otp_challenges');let uid,version,patch;return {
   eq(key,value){if(key==='uid')uid=value;if(key==='version')version=value;return this;},
   async maybeSingle(){return {data:rows.get(uid)||null};},
   async insert(row){rows.set(row.uid,row);return {data:null};},
   update(value){patch=value;return this;},
   select(){if(patch){const row=rows.get(uid);if(row.version!==version)return Promise.resolve({data:[]});rows.set(uid,{...row,...patch});return Promise.resolve({data:[{version:patch.version}]});}return this;}
  };}
 };
 t.mock.method(globalThis,'fetch',async()=>{delivered++;return response(true);});
 const app=createWorker({db,verify:async token=>({uid:token,email:`${token}@example.com`})});
 const begin=(uid,ip)=>app.fetch(new Request('https://api.ltch.example.com/api/auth/begin',{method:'POST',headers:{origin:env.ALLOWED_ORIGIN,authorization:`Bearer ${uid}`,'CF-Connecting-IP':ip}}),env);
 for(let i=1;i<=81;i++)assert.equal((await begin(`user-${i}`,`192.0.2.${i}`)).status,200);
 assert.equal(delivered,81);
 assert.notEqual((await begin('user-1','192.0.2.1')).status,200);assert.equal(delivered,81);
 for(let i=0;i<9;i++)await begin('user-1','192.0.2.1');
 assert.equal((await begin('another-user','192.0.2.1')).status,429);assert.equal(delivered,81);
});

test('deliverNotification resolves class_id for approval and lesson reminder mail links',async t=>{
 const rows=new Map([
  ['app-1',{id:'app-1',request_id:'req-1',status:'pending',recipient:'hs@example.invalid',template:'approval_notice',payload:{full_name:'Minh',class_name:'Lớp 12A'},lease_until:0,attempt_count:0,next_attempt_at:0}],
  ['rem-1',{id:'rem-1',reminder_class_id:'class-6a',status:'pending',recipient:'hs@example.invalid',template:'lesson_reminder',payload:{full_name:'Minh',class_name:'Lớp 6A',lesson_date:'18/11/2026',starts_at:'18:00',ends_at:'20:00'},lease_until:0,attempt_count:0,next_attempt_at:0}]
 ]);
 const db={
  async rpc(name,{p_id,p_token}){const row=rows.get(p_id);if(!row||row.status==='sent')return {data:false};row.lease_token=p_token;return {data:true};},
  from(table){
   let id,token,patch;
   return {
    select(){return this;},update(value){patch=value;return this;},
    eq(key,value){if(key==='id')id=value;if(key==='lease_token')token=value;return this;},
    async maybeSingle(){
     if(table==='ltch_enrollment_requests'&&id==='req-1')return {data:{class_id:'class-12a1'}};
     return {data:rows.get(id)||null};
    },
    then(resolve){const row=rows.get(id);if(table==='ltch_mail_outbox'&&row&&row.lease_token===token)Object.assign(row,patch);resolve({data:null});}
   };
  }
 };
 const sent=[];
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  sent.push(JSON.parse(JSON.parse(options.body).payload));
  return response(true);
 });
 assert.equal(await deliverNotification(db,env,'app-1'),'sent');
 assert.equal(await deliverNotification(db,env,'rem-1'),'sent');
 assert.ok(sent[0].htmlBody.includes('https://ltch.example.com/class/class-12a1'));
 assert.ok(sent[1].htmlBody.includes('https://ltch.example.com/class/class-6a/materials'));
});
