import {createHmac,timingSafeEqual} from 'node:crypto';
import {data,demand} from './policy.mjs';
import {readJson} from './http.mjs';
import {deliverNotification,listDueGeneralMail} from './mail-queue.mjs';
import {syncDriveWorkspace} from './lesson-storage.mjs';
import {cleanupExpiredNoticeDraft} from './notices.mjs';

export const DRIVE_SYNC_INTERVAL_MS=30*60*1000;
let nextDriveSyncAt=0,driveSyncBacklog=false;

export function resetReminderDriveSyncState() {
  nextDriveSyncAt=0;
  driveSyncBacklog=false;
}

export async function verifyReminderTick(request,secret,now=Date.now()) {
  demand(request.method==='POST',405);
  demand(!request.headers.has('origin'),403);
  demand(typeof secret==='string'&&secret.length>=32,503,'Dịch vụ nhắc học chưa được cấu hình.');
  const b=await readJson(request,512);
  demand(Number.isSafeInteger(b.timestamp)&&Math.abs(now-b.timestamp)<=120000&&typeof b.signature==='string'&&/^[a-f0-9]{64}$/.test(b.signature),403);
  demand(b.syncDrive===undefined||typeof b.syncDrive==='boolean',400);
  const expected=createHmac('sha256',secret).update(`${b.timestamp}|ltch:lesson-reminders:v1`).digest();
  demand(timingSafeEqual(expected,Buffer.from(b.signature,'hex')),403);
  return {timestamp:b.timestamp,syncDrive:b.syncDrive};
}

export async function runLessonReminders(db,env,options={}) {
  const now=Number.isSafeInteger(options?.now)?options.now:Date.now();
  const shouldSyncDrive=options?.syncDrive===true?true:options?.syncDrive===false?driveSyncBacklog:(driveSyncBacklog||now>=nextDriveSyncAt);
  let hasDriveBacklog=driveSyncBacklog;
  if(shouldSyncDrive){
    try{
      const syncRes=await syncDriveWorkspace({db,env,...(options?.openDrive?{openDrive:options.openDrive}:{})});
      hasDriveBacklog=Boolean((syncRes?.remainingFolders||0)>0||(syncRes?.remainingMaterials||0)>0);
      driveSyncBacklog=hasDriveBacklog;
      nextDriveSyncAt=now+DRIVE_SYNC_INTERVAL_MS;
    }catch{console.warn('LTCH_DRIVE_SYNC_FAILED');}
  }
  await Promise.allSettled([
    (async()=>{try{data(await db.from('ltch_mail_outbox').update({payload:{}}).neq('template','lesson_reminder').in('status',['sent','cancelled']).neq('payload','{}'));}catch{console.warn('LTCH_MAIL_SCRUB_FAILED');}})(),
    (async()=>{try{data(await db.rpc('ltch_cleanup_expired_auth',{}));}catch{console.warn('LTCH_AUTH_CLEANUP_FAILED');}})()
  ]);
  const queues=['ltch_queue_lesson_reminders','ltch_due_general_mail'];
  const batches=await Promise.allSettled([
    (async()=>data(await db.rpc('ltch_queue_lesson_reminders',{})))(),
    listDueGeneralMail(db)
  ]);
  if(batches.every(batch=>batch.status==='rejected'))throw batches[0].reason;
  const unavailable=queues.filter((_,index)=>batches[index].status==='rejected');
  if(unavailable.length)console.warn('LTCH_MAIL_QUEUE_UNAVAILABLE',{queues:unavailable});
  const jobs=batches.flatMap(batch=>batch.status==='fulfilled'?batch.value:[]);
  const counts={processed:jobs.length,sent:0,pending:0,cancelled:0};
  let failed=0;
  for(let i=0;i<jobs.length;i+=6){
    const results=await Promise.allSettled(jobs.slice(i,i+6).map(job=>deliverNotification(db,env,job.id)));
    for(const result of results){
     if(result.status==='rejected')failed++;
     else if(Object.hasOwn(counts,result.value))counts[result.value]++;
    }
  }
  if(failed)console.warn('LTCH_MAIL_JOB_FAILED',{failed});
  try{await cleanupExpiredNoticeDraft({db,env});}catch{console.warn('LTCH_NOTICE_DRAFT_CLEANUP_FAILED');}
  console.info('LTCH_MAIL_TICK',{...counts,failed,unavailable,shouldSyncDrive,hasDriveBacklog});
  return {...counts,...(failed?{failed}:{}),...(unavailable.length?{unavailable}:{}),...(hasDriveBacklog?{driveBacklog:true}:{})};
}
