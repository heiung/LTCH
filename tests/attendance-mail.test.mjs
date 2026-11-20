import assert from 'node:assert/strict';
import test from 'node:test';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {queueAttendanceMail,resolveAttendanceMail,verifyAttendanceMailRequest} from '../worker/attendance-mail.mjs';
import templates from '../server/domain/notification-templates.cjs';

const secret='test-secret-for-apps-script-attendance', now=Date.now();
const job={classId:'class_9a',studentUid:'student',date:'2026-11-16',status:'late',revision:now};
const endpoint='https://script.google.com/macros/s/mock/exec';
const secretKey='LTCH_MAIL_SECRET';

test('the Apps Script queue replaces corrections, retries Gmail, and resolves currently linked recipients', async()=>{
  const records={
    ltch_attendance:[{class_id:job.classId,student_uid:job.studentUid,lesson_date:job.date,status:job.status,updated_at:now}],
    ltch_classes:[{id:job.classId,name:'Lớp 9A',archived:false}],
    ltch_class_memberships:[{class_id:job.classId,uid:'student',member_role:'student',status:'active'}],
    ltch_parent_links:['parent','shared','blocked','revoked'].map(parent_uid=>({parent_uid,student_uid:'student',status:'active'})),
    ltch_accounts:[
      {uid:'student',display_name:'Minh <QA>',email:'STUDENT@example.invalid',roles:['student'],status:'active'},
      {uid:'parent',email:'parent@example.invalid',roles:['parent'],status:'active'},
      {uid:'shared',email:'student@EXAMPLE.invalid',roles:['parent'],status:'active'},
      {uid:'blocked',email:'blocked@example.invalid',roles:['parent'],status:'disabled'},
      {uid:'revoked',email:'revoked@example.invalid',roles:['parent'],status:'active'},
      {uid:'other_parent',email:'other@example.invalid',roles:['parent'],status:'active'}
    ]
  };
  const db={from(table){
    let rows=records[table];
    return {
      select(){return this;},
      eq(key,value){rows=rows.filter(row=>row[key]===value);return this;},
      in(key,values){rows=rows.filter(row=>values.includes(row[key]));return this;},
      maybeSingle(){return {data:rows[0]};},
      then(resolve){resolve({data:rows});}
    };
  }};
  const values=new Map([[secretKey,secret]]);
  const properties={
    getProperty:key=>values.get(key),setProperty:(key,value)=>values.set(key,value),
    getProperties:()=>Object.fromEntries(values),deleteProperty:key=>values.delete(key)
  };
  const mail=[],lookups=[];
  let transientFailure=true;
  const gas=runInNewContext((await readFile('integrations/apps-script-otp/Attendance.gs','utf8'))+
    '\n({enqueueAttendanceMail_,processAttendanceMail_})',{
    Utilities:{Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(message,key)=>[...createHmac('sha256',key).update(message).digest()]},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    MailApp:{getRemainingDailyQuota:()=>50,sendEmail(message){
      if(message.to==='parent@example.invalid'&&transientFailure){transientFailure=false;throw Error('Temporary Gmail failure');}
      mail.push(message);
    }},
    console:{warn(){}},
    UrlFetchApp:{fetch(url,options){
      const result=lookups.shift();
      assert.equal(url,'https://api.ltch.example.com/api/internal/attendance-mail');
      assert.deepEqual(JSON.parse(options.payload),result.request);
      return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({items:result.items})};
    }},
    Date:class extends Date{static now(){return clock;}}
  });
  let clock=now;
  const env={MAIL_ENDPOINT:endpoint,MAIL_SECRET:secret};
  const request=body=>new Request('https://api.ltch.example.com/api/internal/attendance-mail',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
  });
  const enqueue=async candidate=>queueAttendanceMail(env,candidate,async(url,options)=>{
    assert.equal(url,endpoint);
    const envelope=JSON.parse(options.body);
    const rejected=gas.enqueueAttendanceMail_({...envelope,signature:'0'.repeat(64)},secret,properties,reply=>reply);
    assert.equal(rejected.ok,false);
    return Response.json(gas.enqueueAttendanceMail_(envelope,secret,properties,reply=>reply));
  });
  assert.equal(await enqueue(job),'queued');
  assert.equal(await enqueue({...job,status:'present',revision:now+1}),'queued');
  assert.equal(await enqueue(job),'queued');
  const queueKey=[...values.keys()].find(key=>key.startsWith('attendance_queue_'));
  const queued=JSON.parse(values.get(queueKey));
  assert.equal(queued.job.status,'present');
  assert.doesNotMatch(values.get(queueKey),/@|Minh/);
  Object.assign(records.ltch_attendance[0],{status:'present',updated_at:now+1});
  records.ltch_parent_links.find(link=>link.parent_uid==='revoked').status='inactive';
  async function process(){
    const payload=JSON.stringify([queued.job]);
    const signed={timestamp:clock,payload,signature:createHmac('sha256',secret).update(['ltch:attendance-mail:v1','resolve',clock,payload].join('\n')).digest('hex')};
    const [resolved]=await verifyAttendanceMailRequest(request(signed),secret,clock);
    await assert.rejects(verifyAttendanceMailRequest(request({...signed,timestamp:clock-120001}),secret,clock));
    lookups.push({request:signed,items:[{key:resolved.key,messages:await resolveAttendanceMail(db,resolved)}]});
    gas.processAttendanceMail_(properties,secret);
  }
  await process();
  assert.deepEqual(mail.map(item=>item.to),['student@example.invalid']);
  assert.ok(values.get(queueKey));
  clock+=61000;
  await process();
  assert.deepEqual(mail.map(item=>item.to),['student@example.invalid','parent@example.invalid']);
  assert.ok(mail.every(item=>item.htmlBody.includes('Có mặt')));
  assert.ok(mail.every(item=>item.body.includes('https://ltch.example.com/class/class_9a/attendance')&&item.htmlBody.includes('https://ltch.example.com/class/class_9a/attendance')));
  assert.equal(values.has(queueKey),false);
  assert.deepEqual(await resolveAttendanceMail(db,{...queued.job,status:'late'}),[]);
});

test('attendance email shows the class, date, result and timing note in plain text and HTML',()=>{
  for(const [status,label] of Object.entries({present:'Có mặt',absent:'Vắng mặt',late:'Đi muộn',excused:'Nghỉ có phép'})){
    const mail=templates.renderNotification('attendance_saved',{
      student_name:'Minh <QA>',class_name:'Lớp 9A',class_id:'class-9a',lesson_date:'16/11/2026',attendance_status:status
    });
    assert.match(mail.subject,/^\[Lớp Toán cô Hạnh\] Kết quả điểm danh Lớp 9A ngày 16\/11\/2026$/);
    for(const part of [mail.body,mail.htmlBody]){
      assert.ok(part.includes(label));
      assert.ok(part.includes('https://ltch.example.com/class/class-9a/attendance'));
      assert.ok(part.includes('Email được gửi sau khi hoàn tất điểm danh và lưu kết quả. Thời điểm nhận email không đồng nghĩa với việc học sinh đến lớp muộn vào thời điểm đó.'));
    }
    assert.match(mail.htmlBody,/Minh &lt;QA&gt;/);
  }
});
