import {createHmac,randomUUID,randomBytes} from 'node:crypto';
import {data} from './policy.mjs';
import templates from '../server/domain/notification-templates.cjs';
import {resolveAdminEmail,resolveSiteOrigin} from './config.mjs';

function readGeneralQueue(result){
 if(result.error){
  const code=result.error.code;
  console.warn('LTCH_GENERAL_MAIL_LOOKUP_FAILED',{code:/^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(code)?code:'unknown'});
 }
 return data(result);
}

export async function listDueGeneralMail(db,now=Date.now()){
 const result=await db.rpc('ltch_due_general_mail',{});
 if(!result.error||!['PGRST202','42883'].includes(result.error.code))return readGeneralQueue(result);

 const selectJobs=()=>db.from('ltch_mail_outbox').select('id').neq('template','lesson_reminder');
 const current=await selectJobs().lt('attempt_count',8).lte('next_attempt_at',now)
  .or(`status.eq.pending,and(status.eq.sending,lease_until.lt.${now})`)
  .order('next_attempt_at').order('created_at').limit(50);
 if(!current.error||!['42703','PGRST204'].includes(current.error.code)){
  const jobs=readGeneralQueue(current);
  console.info('LTCH_GENERAL_MAIL_COMPATIBILITY',{rpc:result.error.code,mode:'table_with_retry_columns'});
  return jobs;
 }

 const jobs=readGeneralQueue(await selectJobs().in('status',['pending','sending']).lte('lease_until',now)
  .order('lease_until').order('created_at').limit(50));
 console.info('LTCH_GENERAL_MAIL_COMPATIBILITY',{rpc:result.error.code,mode:'legacy_table'});
 return jobs;
}

export async function deliverNotification(db,env,id){
 const token=randomUUID();
 const row=data(await db.from('ltch_mail_outbox').select('*').eq('id',id).maybeSingle());if(!row)return 'none';
 if(row.status==='sent'||row.status==='cancelled')return row.status;
 const claimFunction=row.template==='lesson_reminder'?'ltch_claim_lesson_mail':row.template==='class_notice'?'ltch_claim_notice_mail':'ltch_claim_mail';
 const claimed=data(await db.rpc(claimFunction,{p_id:id,p_token:token}));
 if(!claimed){
  const latest=['lesson_reminder','class_notice'].includes(row.template)?data(await db.from('ltch_mail_outbox').select('status').eq('id',id).maybeSingle()):row;
  return latest?.status==='sent'?'sent':latest?.status==='cancelled'?'cancelled':'pending';
 }
 let stage='render',httpStatus=0,rejection='';
 try{
  // Send while Google permits it. A failed delivery stays pending for a later retry.
  let renderFields=row.payload&&typeof row.payload==='object'?{...row.payload}:{};
  if(row.reminder_class_id&&!renderFields.class_id)renderFields.class_id=row.reminder_class_id;
  if(['approval_notice','parent_approval_notice'].includes(row.template)&&!renderFields.class_id&&row.request_id){
   try{
    const reqRow=data(await db.from?.('ltch_enrollment_requests')?.select?.('class_id')?.eq?.('id',row.request_id)?.maybeSingle?.());
    if(reqRow?.class_id)renderFields.class_id=reqRow.class_id;
   }catch{}
  }
  const supportEmail=resolveAdminEmail(env);
  const recipient=row.template==='urgent_admin_alert'&&env?.ADMIN_EMAIL?supportEmail:row.recipient;
  const mail=templates.renderNotification(row.template,renderFields,{siteUrl:resolveSiteOrigin(env),supportEmail}),timestamp=Date.now(),nonce=randomBytes(16).toString('hex');
  const payload=JSON.stringify({email:recipient,eventId:row.id,...mail});
  const signature=createHmac('sha256',env.MAIL_SECRET).update([timestamp,nonce,payload].join('\n')).digest('hex');
  stage='transport';
  const response=await fetch(env.MAIL_ENDPOINT,{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body:JSON.stringify({kind:'notification',timestamp,nonce,payload,signature}).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')),signal:AbortSignal.timeout(25000)});
  httpStatus=response.status;stage='response';
  if(!response.ok)throw Error('delivery failed');
  const result=await response.json();stage='acceptance';
  if(result.ok!==true){rejection=['invalid_envelope','invalid_signature','invalid_notification','delivery_exception','busy'].includes(result.reason)?result.reason:'unspecified';throw Error('delivery failed');}
  stage='record';
  const scrubbedPayload=row.template==='lesson_reminder'&&row.payload?.schedule_revision!==undefined?{schedule_revision:row.payload.schedule_revision}:{};
  data(await db.from('ltch_mail_outbox').update({status:'sent',sent_at:new Date().toISOString(),lease_until:0,payload:scrubbedPayload}).eq('id',id).eq('lease_token',token));return 'sent';
 }catch(error){
  console.warn('LTCH_MAIL_PENDING',{template:row.template,stage,httpStatus,rejection,name:error?.name||'Error'});
  const update={status:'pending',lease_until:0};
  if(row.template!=='lesson_reminder'){
   if(Object.hasOwn(row,'attempt_count')&&Object.hasOwn(row,'next_attempt_at')){
    const attempts=row.attempt_count+1;
    update.attempt_count=attempts;
    update.next_attempt_at=Date.now()+Math.min(21600000,30000*2**Math.min(attempts-1,10));
    if(attempts>=8&&row.template!=='class_notice')console.error('LTCH_MAIL_RETRIES_EXHAUSTED',{template:row.template});
   }else{
    // The older schema has no retry columns. The queue waits for this lease deadline before retrying.
    update.lease_until=Date.now()+120000;
   }
  }
  data(await db.from('ltch_mail_outbox').update(update).eq('id',id).eq('lease_token',token));return 'pending';
 }
}
