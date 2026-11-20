import {data,demand,classCanRead} from './policy.mjs';
import {sortClasses} from '../shared/classroom.mjs';
import {encodeLegacySubmissionFeedback,isMissingSubmissionColumnError} from '../shared/submission-metadata.mjs';
const valid = uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(uid);
export function createSupabaseRepository(db,{adminEmail='admin@example.com'}={}){return {
 async ensureAccount(user){
  demand(valid(user.uid),400);const admin=user.email.toLowerCase()===String(adminEmail||'admin@example.com').trim().toLowerCase();
  data(await db.from('ltch_accounts').upsert({uid:user.uid,email:user.email,display_name:(user.name||user.email).slice(0,160),status:admin?'active':'pending',roles:admin?['admin','teacher','assistant','parent','student']:[]},{onConflict:'uid',ignoreDuplicates:true}));
 },
 async actor(uid){
  if(!valid(uid))return null;const a=data(await db.from('ltch_accounts').select('uid,display_name,email,status,roles,student_code').eq('uid',uid).maybeSingle());if(!a||a.status!=='active'||!Array.isArray(a.roles))return null;
  const [membershipResult,linkResult]=await Promise.all([
   db.from('ltch_class_memberships').select('class_id,member_role,permissions').eq('uid',uid).eq('status','active'),
   a.roles.includes('parent')?db.from('ltch_parent_links').select('student_uid').eq('parent_uid',uid).eq('status','active'):Promise.resolve({data:[],error:null})
  ]);
  const memberships=data(membershipResult),links=data(linkResult);
  const childIds=links.map(l=>l.student_uid);const childMemberships=childIds.length?data(await db.from('ltch_class_memberships').select('class_id,uid').in('uid',childIds).eq('member_role','student').eq('status','active')):[];
  return {uid,name:a.display_name,email:a.email,status:a.status,roles:a.roles,memberships,childMemberships,classIds:[...new Set(memberships.map(m=>m.class_id))],studentId:a.roles.includes('student')?uid:undefined,linkedStudentIds:childIds,permissions:[],...(a.student_code?{studentCode:a.student_code}:{})};
 },
 async classesFor(actor){
  if(!actor||actor.status!=='active'||!Array.isArray(actor.roles)||!Array.isArray(actor.memberships))return [];
  let q=db.from('ltch_classes').select('id,name,school_year_id,schedule,schedule_slots,schedule_revision,reminders_enabled').eq('archived',false).order('name').limit(200);
  if(!actor.roles.includes('admin')){const ids=[...new Set([...actor.memberships.filter(m=>actor.roles.includes(m.member_role)).map(m=>m.class_id),...(actor.childMemberships||[]).map(m=>m.class_id)])].filter(valid).slice(0,100);if(!ids.length)return [];q=q.in('id',ids);}
  return sortClasses(data(await q).map(c=>({id:c.id,name:c.name,schoolYearId:c.school_year_id,schedule:c.schedule,...(c.schedule_slots?{scheduleSlots:c.schedule_slots,scheduleRevision:c.schedule_revision,remindersEnabled:c.reminders_enabled}:{})})));
 },
 async getAssignment(id){if(!valid(id))return null;const a=data(await db.from('ltch_assignments').select('id,class_id,title,instructions,status,opens_at,closes_at').eq('id',id).maybeSingle());return a?{id:a.id,classId:a.class_id,title:a.title,instructions:a.instructions||'',status:a.status,opensAt:a.opens_at,closesAt:a.closes_at}:null;},
 async reserve(r){const result=await db.from('ltch_submissions').insert({id:r.id,assignment_id:r.assignmentId,uid:r.uid,object_path:r.path,status:'pending',created_at:r.createdAt});if(result.error?.code==='23505')return false;data(result);return true;},
 async markStored(submissionId,d){
  const storedFiles=Array.isArray(d.files)?d.files.map(f=>({name:f.name,contentType:f.contentType,size:f.size,objectPath:f.objectPath})):[];
  const basePatch={status:'stored',stored_at:d.storedAt,file_size:d.size,content_type:d.contentType,...(d.objectPath?{object_path:d.objectPath}:{})};
  let res=await db.from('ltch_submissions').update({...basePatch,student_note:d.note||'',files:storedFiles}).eq('id',submissionId).eq('status','pending').select('id');
  if(isMissingSubmissionColumnError(res.error)){
   const legacyFeedback=encodeLegacySubmissionFeedback({feedback:'',note:d.note||'',files:storedFiles});
   res=await db.from('ltch_submissions').update({...basePatch,...(legacyFeedback?{feedback:legacyFeedback}:{})}).eq('id',submissionId).eq('status','pending').select('id');
  }
  const rows=data(res);demand(rows.length===1,503,'Chưa xác nhận lưu bài.');
 },
 async markFailed(id){data(await db.from('ltch_submissions').update({status:'failed'}).eq('id',id).eq('status','pending'));}
};}
