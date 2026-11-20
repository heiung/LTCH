import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {data,demand} from './policy.mjs';
import {readJson} from './http.mjs';
import templates from '../server/domain/notification-templates.cjs';

const secretContext='ltch:attendance-mail:v1';
const statuses=['present','absent','late','excused'];
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const safeId=/^[A-Za-z0-9_-]{1,128}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hmac=(secret,purpose,timestamp,payload)=>createHmac('sha256',secret)
  .update([secretContext,purpose,timestamp,payload].join('\n')).digest('hex');
const eventKey=({classId,studentUid,date})=>hash([classId,studentUid,date]);

export async function queueAttendanceMail(env,job,fetchImpl=globalThis.fetch){
  const payload=JSON.stringify({...job,key:eventKey(job)});
  for(let attempt=0;attempt<2;attempt++){
    const timestamp=Date.now();
    try{
      const response=await fetchImpl(env.MAIL_ENDPOINT,{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({kind:'attendance_queue',timestamp,payload,signature:hmac(env.MAIL_SECRET,'enqueue',timestamp,payload)}),
        signal:AbortSignal.timeout(6000)
      });
      if(response.ok&&(await response.json()).ok===true)return 'queued';
    }catch{/* The same event key makes another attempt safe. */}
  }
  console.warn('LTCH_ATTENDANCE_MAIL_QUEUE_FAILED');
  return 'failed';
}

export async function verifyAttendanceMailRequest(request,secret,now=Date.now()){
  demand(request.method==='POST',405);
  demand(!request.headers.has('origin'));
  demand(typeof secret==='string'&&secret.length>=32,503);
  const {timestamp,payload,signature}=await readJson(request,12000);
  demand(Number.isSafeInteger(timestamp)&&Math.abs(now-timestamp)<=120000&&typeof payload==='string'&&typeof signature==='string'&&/^[a-f0-9]{64}$/.test(signature));
  demand(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(hmac(secret,'resolve',timestamp,payload),'hex')));
  const jobs=JSON.parse(payload);
  demand(Array.isArray(jobs)&&jobs.length<=12&&jobs.every(job=>job&&safeId.test(job.classId)&&safeId.test(job.studentUid)
    &&typeof job.classId==='string'&&typeof job.studentUid==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(job.date)
    &&statuses.includes(job.status)&&Number.isSafeInteger(job.revision)&&job.key===eventKey(job)),400);
  return jobs;
}

export async function resolveAttendanceMail(db,job){
  const [recordRes,classRes,memberRes]=await Promise.all([
    db.from('ltch_attendance').select('status,updated_at').eq('class_id',job.classId).eq('student_uid',job.studentUid).eq('lesson_date',job.date).maybeSingle(),
    db.from('ltch_classes').select('name,archived').eq('id',job.classId).maybeSingle(),
    db.from('ltch_class_memberships').select('uid').eq('class_id',job.classId).eq('uid',job.studentUid).eq('member_role','student').eq('status','active').maybeSingle()
  ]);
  const record=data(recordRes),klass=data(classRes);
  if(!data(memberRes)||!klass||klass.archived||record?.status!==job.status||record.updated_at<job.revision)return [];
  const links=data(await db.from('ltch_parent_links').select('parent_uid').eq('student_uid',job.studentUid).eq('status','active'));
  const accounts=data(await db.from('ltch_accounts').select('uid,email,roles,display_name').eq('status','active')
    .in('uid',[...new Set([job.studentUid,...links.map(link=>link.parent_uid)])]));
  const student=accounts.find(account=>account.uid===job.studentUid&&account.roles.includes('student'));
  if(!student)return [];
  const mail=templates.renderNotification('attendance_saved',{
    student_name:student.display_name,class_name:klass.name,class_id:job.classId,lesson_date:job.date.split('-').reverse().join('/'),attendance_status:job.status
  });
  const messages=new Map();
  for(const account of [student,...accounts.filter(account=>account.uid!==student.uid&&account.roles.includes('parent'))]){
    const email=account.email?.trim().toLowerCase();
    if(email?.length<=254&&emailPattern.test(email)&&!messages.has(email)){
      messages.set(email,{email,eventId:'attendance_'+hash([job.key,job.revision,email]),...mail});
    }
  }
  return [...messages.values()];
}
