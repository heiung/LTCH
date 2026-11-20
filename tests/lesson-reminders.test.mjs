import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {DRIVE_SYNC_INTERVAL_MS,resetReminderDriveSyncState,verifyReminderTick,runLessonReminders} from '../worker/lesson-reminders.mjs';
import {createWorker} from '../worker/index.mjs';
import {deliverNotification} from '../worker/mail-queue.mjs';
import templates from '../server/domain/notification-templates.cjs';

const secret='x'.repeat(32),now=1793534400000;
const signed=timestamp=>({timestamp,signature:createHmac('sha256',secret).update(`${timestamp}|ltch:lesson-reminders:v1`).digest('hex')});
const request=(body,headers={},method='POST')=>new Request('https://api.ltch.example.com/api/internal/lesson-reminders',{method,headers:{'content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
test('scheduler requires a fresh purpose-bound signature and cannot be called through a browser origin',async()=>{
 await verifyReminderTick(request(signed(now)),secret,now);
 for(const body of [signed(now-120001),signed(now+120001),{timestamp:now,signature:'0'.repeat(64)},{timestamp:now,signature:createHmac('sha256',secret).update(String(now)).digest('hex')},{}])await assert.rejects(verifyReminderTick(request(body),secret,now),e=>e.status===403);
 await assert.rejects(verifyReminderTick(request(signed(now),{origin:'https://ltch.example.com'}),secret,now),e=>e.status===403);
 await assert.rejects(verifyReminderTick(request({}, {},'GET'),secret,now),e=>e.status===405);
});

test('unauthorized scheduler requests never touch database or authenticate as a user',async()=>{
 const app=createWorker({db:{from(){throw Error('must not read');},rpc(){throw Error('must not write');}},verify(){throw Error('must not verify identity');}});
 const response=await app.fetch(request({timestamp:Date.now(),signature:'0'.repeat(64)}),{MAIL_SECRET:secret});assert.equal(response.status,403);
});

test('a valid scheduler tick queues due mail and returns counters without personal data',async()=>{
 let called=false;const db={async rpc(name){assert.ok(['ltch_queue_lesson_reminders','ltch_due_general_mail','ltch_cleanup_expired_auth'].includes(name));called=true;return {data:[]};}};
 assert.deepEqual(await runLessonReminders(db,{}),{processed:0,sent:0,pending:0,cancelled:0});assert.equal(called,true);
 const app=createWorker({db});const env={MAIL_SECRET:secret,SUPABASE_URL:'https://your-project.supabase.co',SUPABASE_SECRET:'fake',ALLOWED_ORIGIN:'https://ltch.example.com',MAIL_ENDPOINT:'https://script.google.com/fake'};
 const response=await app.fetch(request(signed(Date.now())),env);assert.equal(response.status,200);assert.equal((await response.json()).processed,0);
});

test('lesson mail is checked against current enrollment/schedule before any email is sent',async t=>{
 let fetched=false; t.mock.method(globalThis,'fetch',async()=>{fetched=true;throw Error('must not send');});
 const row={id:'lesson-test',template:'lesson_reminder',status:'pending',recipient:'student@example.test',payload:{}};
 const db={async rpc(name){assert.equal(name,'ltch_claim_lesson_mail');return {data:false};},from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:row};}};}};
 await deliverNotification(db,{MAIL_SECRET:secret},row.id);assert.equal(fetched,false);
});

test('general mail jobs can be processed if the lesson reminder queue is unavailable',async()=>{
 const calls=[];
 const db={async rpc(name){calls.push(name);return name==='ltch_queue_lesson_reminders'?{error:{message:'unavailable'}}:{data:[]};}};
 assert.deepEqual(await runLessonReminders(db,{}),{processed:0,sent:0,pending:0,cancelled:0,unavailable:['ltch_queue_lesson_reminders']});
 assert.ok(calls.includes('ltch_due_general_mail'));
});

test('scheduler finds due legacy mail when the RPC and retry columns are missing',async()=>{
 const rows=[
  {id:'ready',template:'approval_notice',status:'pending',lease_until:0},
  {id:'stale-lease',template:'revision_request',status:'sending',lease_until:0},
  {id:'wait',template:'approval_notice',status:'pending',lease_until:Number.MAX_SAFE_INTEGER},
  {id:'lesson',template:'lesson_reminder',status:'pending',lease_until:0},
  {id:'sent',template:'approval_notice',status:'sent',lease_until:0},
  {id:'cancelled',template:'revision_request',status:'cancelled',lease_until:0}
 ];
 const attempted=[];
 const db={
  async rpc(name,{p_id}){
   if(name==='ltch_due_general_mail')return {error:{code:'PGRST202'}};
   if(name==='ltch_claim_mail'){attempted.push(p_id);return {data:false};}
   return {data:[]};
  },
  from(){
   let selected=rows,missingColumn=false;
   const chain={
    select(){return this;},
    neq(key,value){selected=selected.filter(row=>row[key]!==value);return this;},
    lt(key){assert.equal(key,'attempt_count');missingColumn=true;return this;},
    lte(key,value){selected=selected.filter(row=>row[key]<=value);return this;},
    in(key,values){selected=selected.filter(row=>values.includes(row[key]));return this;},
    or(){return this;},order(){return this;},
    limit(){return missingColumn?{error:{code:'42703'}}:{data:selected};},
    eq(key,value){selected=selected.filter(row=>row[key]===value);return this;},
    maybeSingle(){return {data:selected[0]};}
   };
   return chain;
  }
 };
 assert.deepEqual(await runLessonReminders(db,{}),{processed:2,sent:0,pending:2,cancelled:0});
 assert.deepEqual(attempted,['ready','stale-lease']);
});

test('lesson reminder includes class/date/local time, class materials deep link and preserves the mail gateway subject contract',()=>{
 const fallback=templates.renderNotification('lesson_reminder',{full_name:'Minh',class_name:'Lớp 6A',lesson_date:'01/11/2026',starts_at:'18:00',ends_at:'20:00'});
 assert.match(fallback.subject,/^\[Lớp Toán cô Hạnh\]/);
 for(const value of ['Minh','Lớp 6A','01/11/2026','18:00','20:00','giờ Việt Nam','https://ltch.example.com/class']){assert.ok(fallback.body.includes(value));assert.ok(fallback.htmlBody.includes(value));}
 assert.ok(fallback.htmlBody.includes('https://ltch.example.com/overview'));
 assert.doesNotMatch(fallback.body,/{{|undefined|\/app\b/);assert.doesNotMatch(fallback.htmlBody,/{{|undefined|\/app\b/);
 const direct=templates.renderNotification('lesson_reminder',{full_name:'Minh',class_name:'Lớp 6A',class_id:'class-6a',lesson_date:'01/11/2026',starts_at:'18:00',ends_at:'20:00'});
 assert.ok(direct.body.includes('https://ltch.example.com/class/class-6a/materials'));
 assert.ok(direct.htmlBody.includes('https://ltch.example.com/class/class-6a/materials'));
});

test('all email templates and OTP link directly to their target portal pages instead of /app',()=>{
 const otp=templates.renderOtpEmail('123456');
 assert.ok(otp.body.includes('https://ltch.example.com/login'));
 assert.ok(otp.htmlBody.includes('https://ltch.example.com/overview'));
 assert.doesNotMatch(otp.body,/\/app\b/);assert.doesNotMatch(otp.htmlBody,/\/app\b/);
 const cases=[
  ['staff_request',{role_label:'Trợ giảng',full_name:'Trần Minh Đức',user_email:'dat@example.invalid'},'https://ltch.example.com/admin/staff'],
  ['urgent_admin_alert',{full_name:'Minh',class_name:'Lớp 6A',school_year_name:'2026 - 2027',request_time:'22:00'},'https://ltch.example.com/enrollments'],
  ['revision_request',{full_name:'Minh',class_name:'Lớp 6A',admin_notes:'Cập nhật số điện thoại'},'https://ltch.example.com/onboarding'],
  ['approval_notice',{full_name:'Minh',class_name:'Lớp 12A',class_id:'class-12a1',school_year_name:'2026 - 2027'},'https://ltch.example.com/class/class-12a1'],
  ['parent_approval_notice',{full_name:'Minh',class_name:'Lớp 6A',class_id:'class-6a',school_year_name:'2026 - 2027'},'https://ltch.example.com/class/class-6a']
 ];
 for(const [type,fields,expectedUrl] of cases){
  const mail=templates.renderNotification(type,fields);
  assert.ok(mail.body.includes(expectedUrl),`${type} body missing ${expectedUrl}`);
  assert.ok(mail.htmlBody.includes(expectedUrl),`${type} htmlBody missing ${expectedUrl}`);
  assert.ok(mail.htmlBody.includes('https://ltch.example.com/overview'),`${type} footer missing /overview`);
  assert.doesNotMatch(mail.body,/{{|undefined|\/app\b/,`${type} body contains forbidden token`);
  assert.doesNotMatch(mail.htmlBody,/{{|undefined|\/app\b/,`${type} htmlBody contains forbidden token`);
 }
});

test('runLessonReminders throttles Drive scans via syncDrive, resumes on driveBacklog, and trims idle lesson file projection',async t=>{
 resetReminderDriveSyncState();
 t.after(resetReminderDriveSyncState);

 const tick=await verifyReminderTick(request({...signed(now),syncDrive:false}),secret,now);
 assert.deepEqual(tick,{timestamp:now,syncDrive:false});
 await assert.rejects(verifyReminderTick(request({...signed(now),syncDrive:'yes'}),secret,now),e=>e.status===400);

 const lessons=Array.from({length:8},(_,i)=>({id:`ses-cls1-0${i+1}`,title:`Buổi ${i+1}`,topic:`||s:${i+1}|d:2026-11-01||`,class_id:'cls1'}));
 const tables={
  ltch_school_years:[{id:'y1',name:'2026–2027',starts_on:'2026-09-01'}],
  ltch_classes:[{id:'cls1',name:'Lớp 9A',school_year_id:'y1',schedule_slots:[],archived:false}],
  ltch_drive_folders:[],
  ltch_materials:[],
  ltch_lessons:lessons,
  ltch_lesson_files:[]
 };
 let driveScans=0,folderCounter=0;
 const selectedCols=new Map();
 const db={
  async rpc(){return {data:[]};},
  from(table){
   if(table==='ltch_school_years')driveScans++;
   let eqFilters=[];
   const rows=()=>tables[table].filter(row=>eqFilters.every(([k,v])=>row[k]===v));
   return {
    select(cols){selectedCols.set(table,cols);return this;},
    eq(k,v){eqFilters.push([k,v]);return this;},
    neq(){return this;},
    in(){return this;},
    order(){return this;},
    limit(){return Promise.resolve({data:rows(),error:null});},
    maybeSingle(){return Promise.resolve({data:rows()[0]||null,error:null});},
    upsert(row){tables[table].push({...row});return Promise.resolve({data:null,error:null});},
    update(){return this;},
    then(resolve){return Promise.resolve({data:rows(),error:null}).then(resolve);}
   };
  }
 };
 const objects=new Map();
 const openDrive=async()=>({
  rootId:async()=>'root',
  reserveId:async()=>`drv_${++folderCounter}`,
  isRootChild:async({id,name})=>objects.get(id)?.name===name&&objects.get(id)?.parents[0]==='root',
  createFolder:async({id,parentId,name})=>objects.set(id,{id,mimeType:'application/vnd.google-apps.folder',parents:[parentId],name,trashed:false,shared:false,ownedByMe:true}),
  metadata:async({id})=>objects.get(id)
 });
 const env={GOOGLE_DRIVE_CLIENT_ID:'cid',GOOGLE_DRIVE_CLIENT_SECRET:'csec',GOOGLE_DRIVE_REFRESH_TOKEN:'rtok'};

 // Tick 1: hits batch cap of 6 folders -> sets driveBacklog=true and narrows ltch_lesson_files projection to 'id,lesson_id'.
 const first=await runLessonReminders(db,env,{syncDrive:true,now:1_000_000,openDrive});
 assert.equal(driveScans,1);
 assert.equal(selectedCols.get('ltch_lesson_files'),'id,lesson_id');
 assert.equal(first.driveBacklog,true);

 // Tick 2: even with syncDrive=false, unfinished driveBacklog forces continuation and clears backlog once caught up.
 const second=await runLessonReminders(db,env,{syncDrive:false,now:1_060_000,openDrive});
 assert.equal(driveScans,2);
 assert.equal('driveBacklog' in second,false);

 // Tick 3: syncDrive=false with empty backlog skips all 6 Drive DB table queries.
 const third=await runLessonReminders(db,env,{syncDrive:false,now:1_120_000,openDrive});
 assert.equal(driveScans,2);
 assert.equal('driveBacklog' in third,false);

 // Tick 4: fallback interval triggers Drive sync again once 30 minutes elapse without explicit syncDrive flag.
 await runLessonReminders(db,env,{now:1_060_000+DRIVE_SYNC_INTERVAL_MS,openDrive});
 assert.equal(driveScans,3);
});

test('Reminders.gs coordinates lease without holding ScriptLock across fetch, manages 30-min syncDrive, and handles transient failures',async()=>{
 const source=await readFile('integrations/apps-script-otp/Reminders.gs','utf8');
 const values=new Map([['LTCH_MAIL_SECRET',secret]]);
 const properties={
  getProperty:key=>values.has(key)?values.get(key):null,
  setProperty:(key,val)=>{values.set(key,String(val));},
  deleteProperty:key=>{values.delete(key);},
  getProperties:()=>Object.fromEntries(values)
 };
 let clock=1_794_900_000_000;
 let scriptLockHeld=false,attendanceCalls=0;
 const sleeps=[],warns=[],logs=[],fetchCalls=[],responses=[];
 const gas=runInNewContext(`${source}\n({sendLessonReminders})`,{
  Utilities:{
   sleep:ms=>sleeps.push(ms),
   computeHmacSha256Signature:(msg,key)=>[...createHmac('sha256',key).update(msg).digest()]
  },
  LockService:{
   getScriptLock:()=>({
    tryLock:()=>{if(scriptLockHeld)return false;scriptLockHeld=true;return true;},
    releaseLock:()=>{scriptLockHeld=false;}
   })
  },
  PropertiesService:{getScriptProperties:()=>properties},
  processAttendanceMail_:()=>{
   assert.equal(scriptLockHeld,false,'must not hold ScriptLock while resolving attendance mail');
   attendanceCalls++;
  },
  UrlFetchApp:{
   fetch:(url,opts)=>{
    assert.equal(scriptLockHeld,false,'must not hold ScriptLock across network calls');
    assert.equal(url,'https://api.ltch.example.com/api/internal/lesson-reminders');
    fetchCalls.push(JSON.parse(opts.payload));
    const next=responses.shift();
    if(next instanceof Error)throw next;
    return {getResponseCode:()=>next.code,getContentText:()=>JSON.stringify(next.body||{})};
   }
  },
  Date:class extends Date{static now(){return clock;}},
  console:{log:m=>logs.push(String(m)),warn:m=>warns.push(String(m)),error:m=>warns.push(String(m))},
  Math,JSON,Object,Number,String,Error,Array
 });

 // Initial tick runs Drive sync and records timestamp; lease is released cleanly afterwards.
 responses.push({code:200,body:{processed:1,sent:1,pending:0,cancelled:0,driveBacklog:false}});
 gas.sendLessonReminders();
 assert.equal(attendanceCalls,1);
 assert.equal(fetchCalls.length,1);
 assert.equal(fetchCalls[0].syncDrive,true);
 assert.equal(values.has('LTCH_REMINDER_LEASE_OWNER'),false);
 assert.equal(values.has('LTCH_DRIVE_SYNC_BACKLOG'),false);

 // Overlapping execution while an active lease exists is skipped cleanly.
 values.set('LTCH_REMINDER_LEASE_UNTIL',String(clock+50000));
 values.set('LTCH_REMINDER_LEASE_OWNER','other-run');
 gas.sendLessonReminders();
 assert.equal(fetchCalls.length,1);
 values.delete('LTCH_REMINDER_LEASE_UNTIL');
 values.delete('LTCH_REMINDER_LEASE_OWNER');

 // Within 30 minutes, syncDrive is false unless server signals driveBacklog.
 clock+=60_000;
 responses.push({code:200,body:{processed:0,sent:0,pending:0,cancelled:0,driveBacklog:true}});
 gas.sendLessonReminders();
 assert.equal(fetchCalls[1].syncDrive,false);
 assert.equal(values.get('LTCH_DRIVE_SYNC_BACKLOG'),'1');

 clock+=60_000;
 responses.push({code:503,body:{}},{code:200,body:{processed:0,sent:0,pending:0,cancelled:0}});
 gas.sendLessonReminders();
 assert.equal(sleeps.pop(),1500);
 assert.equal(fetchCalls[2].syncDrive,true);
 assert.equal(fetchCalls[3].syncDrive,true);
 assert.equal(values.has('LTCH_DRIVE_SYNC_BACKLOG'),false);

 // 4 consecutive 503 pairs warn gracefully without failing trigger; 5th throws; 403 throws immediately.
 for(let i=1;i<=4;i++){
  clock+=60_000;
  responses.push({code:503,body:{}},{code:503,body:{}});
  gas.sendLessonReminders();
  assert.equal(values.get('LTCH_REMINDER_TRANSIENT_FAILURES'),String(i));
 }
 clock+=60_000;
 responses.push({code:503,body:{}},{code:503,body:{}});
 assert.throws(()=>gas.sendLessonReminders(),/5 lần thử: HTTP 503/);

 responses.push({code:403,body:{}});
 assert.throws(()=>gas.sendLessonReminders(),/HTTP 403/);
});
