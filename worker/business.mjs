import {promotion} from './promotion-handler.mjs';
import {practiceRooms} from './practice-rooms.mjs';
import {validateQuestions} from './questions.mjs';
import {deliverNotification} from './mail-queue.mjs';
import {queueAttendanceMail} from './attendance-mail.mjs';
import {notifyClassStudentsOfNotice} from './notice-mail.mjs';
import { randomUUID } from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createSupabaseRepository} from './supabase-repository.mjs';
import {ApiError,demand,id,string,timestamp,data,isAdmin,staffCan,classCanRead,studentScope} from './policy.mjs';
import {readJson,readFormData,json} from './http.mjs';
import {configuredStorage} from './submission-handler.mjs';
import {readOverviewDashboard} from './overview.mjs';
import {forum} from './forum.mjs';
import {lessons,lessonsAvailable} from './lessons.mjs';
import {practiceSolutions} from './practice-solutions.mjs';
import {configuredDrive,syncDriveWorkspace,ensureSessionDriveFolder,ensureAssignmentDriveFolder,downloadSubmissionFromDrive,trashDriveTargetsSafe} from './lesson-storage.mjs';
import {notices as noticeHandler} from './notices.mjs';
import {withNoticeFiles,withNoticeReads} from './notice-queries.mjs';
import {stripLegacyNoticeReads} from '../shared/notice-reads.mjs';
import {className, classGrade, sortClasses, classCohortSlug, planSchoolYearCohortTransition, validateSchedule, scheduleText, DEFAULT_COURSE_SESSIONS_COUNT, parseIsoDateParts, addIsoDays, generateScheduleDates, lessonSessionId, formatSessionLessonTitle, encodeSessionTopicMeta, decodeSessionTopicMeta, rescheduleCourseSessions, buildClassSessionsCatalog, decodeAssignmentSessionInstructions, parseSessionLessonTitle} from '../shared/classroom.mjs';
import {decodeSubmissionRecord, encodeLegacySubmissionFeedback, isMissingSubmissionColumnError, toPublicSubmission, SUBMISSION_ALLOWED_TYPES} from '../shared/submission-metadata.mjs';

const roles=['admin','teacher','assistant','student','parent'];
const assistantDefaultPermissions=['schedule.manage','attendance.write','materials.write','assignments.write','practice.manage','notices.write','messages.write'];

const isStaffRoles = rs => Array.isArray(rs) && rs.some(r => r === 'admin' || r === 'teacher' || r === 'assistant');
const isStaffActor = actor => Boolean(actor?.status === 'active' && isStaffRoles(actor.roles));

async function assignActiveStaffToClass(db, classId) {
  try {
    const accounts = data(await db.from('ltch_accounts').select('uid,roles').eq('status', 'active'));
    for (const acc of accounts || []) {
      const accRoles = Array.isArray(acc.roles) ? acc.roles : [];
      if (accRoles.includes('teacher')) {
        data(await db.from('ltch_class_memberships').upsert(
          { class_id: classId, uid: acc.uid, member_role: 'teacher', status: 'active', permissions: [] },
          { onConflict: 'class_id,uid,member_role', ignoreDuplicates: true }
        ));
      }
      if (accRoles.includes('assistant') || accRoles.includes('admin')) {
        data(await db.from('ltch_class_memberships').upsert(
          { class_id: classId, uid: acc.uid, member_role: 'assistant', status: 'active', permissions: assistantDefaultPermissions },
          { onConflict: 'class_id,uid,member_role', ignoreDuplicates: true }
        ));
      }
    }
  } catch {console.warn('LTCH_STAFF_ASSIGNMENT_FAILED');}
}

function scheduleChange(b) {
 try {
  demand(typeof b.remindersEnabled==='boolean',400,'Chọn cài đặt nhắc học.');
  const slots=validateSchedule(b.scheduleSlots);
  return {schedule_slots:slots,schedule:scheduleText(slots),reminders_enabled:b.remindersEnabled};
 } catch(e) {throw new ApiError(400,e.message);}
}

export async function business(request,path,{db,actor,env,openDrive}) {
 const method=request.method,now=Date.now(),repo=createSupabaseRepository(db);
 const noticeResponse=await noticeHandler(request,path,{db,actor,env,openDrive});if(noticeResponse)return noticeResponse;
 const psolResponse=await practiceSolutions(request,path,{db,actor,env,openDrive});if(psolResponse)return psolResponse;
 const practiceResponse=await practiceRooms(request,path,{db,actor,env,openDrive});if(practiceResponse)return practiceResponse;
 const lessonResponse=await lessons(request,path,{db,actor,env,openDrive});if(lessonResponse)return lessonResponse;
 const forumResponse=await forum(request,path,{db,actor,env});if(forumResponse)return forumResponse;
 const admin=()=>demand(isAdmin(actor));

 if(path==='/api/classes/cohorts'){
  demand(isStaffActor(actor),403,'Chỉ Quản trị viên, Giáo viên hoặc Trợ giảng mới có quyền quản lý niên khóa và kho lưu trữ.');
  if(method==='GET'){
   const [yearsRes,classesRes]=await Promise.all([
    db.from('ltch_school_years').select('*').order('starts_on',{ascending:false}).limit(50),
    db.from('ltch_classes').select('*').order('name').limit(300)
   ]);
   const years=data(yearsRes)||[];
   const rawRows=data(classesRes)||[];
   const allRows=rawRows;
   const yearMap=new Map(years.map(y=>[y.id,y.name]));
   const activeRaw=sortClasses(allRows.filter(c=>!c.archived));
   const archivedRaw=sortClasses(allRows.filter(c=>c.archived));
   const enrich=(c,list)=>{
    const item={
     id:c.id,
     name:className(c.name),
     schoolYearId:c.school_year_id,
     schoolYearName:yearMap.get(c.school_year_id)||'',
     schedule:c.schedule||'',
     archived:Boolean(c.archived),
     ...(c.schedule_slots?{scheduleSlots:c.schedule_slots,scheduleRevision:c.schedule_revision,remindersEnabled:c.reminders_enabled}:{})
    };
    const slug=classCohortSlug(item,list);
    return {...item,cohortSlug:slug,routePath:`/class/${slug}`};
   };
   return json({
    years,
    activeClasses:activeRaw.map(c=>enrich(c,activeRaw)),
    archivedClasses:archivedRaw.map(c=>enrich(c,archivedRaw))
   });
  }
  demand(method==='POST',405);
  demand(isAdmin(actor),403,'Chỉ quản trị viên mới được phép thay đổi niên khóa và lớp học.');
  const b=await readJson(request);
  if(b.action==='advance_school_year'){
   const allActive=data(await db.from('ltch_classes').select('*').eq('archived',false).order('name').limit(200))||[];
   const plan=planSchoolYearCohortTransition(
    allActive,
    Number.isInteger(b.sourceStartYear)?b.sourceStartYear:null,
    Array.isArray(b.newGrade6Classes)&&b.newGrade6Classes.length?b.newGrade6Classes:['Lớp 6']
   );
   const startsOn=typeof b.startsOn==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(b.startsOn)?b.startsOn:plan.startsOn;
   const endsOn=typeof b.endsOn==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(b.endsOn)&&b.endsOn>startsOn?b.endsOn:plan.endsOn;
   const schedule=b.scheduleSlots===undefined?{schedule:'',schedule_slots:[],reminders_enabled:true}:scheduleChange(b);
   const createdClasses=[];
   const createRows=[];
   for(let i=0;i<plan.toCreateGrade6.length;i++){
    const g6=plan.toCreateGrade6[i];
    const secSuffix=g6.cohortSlug.replace(/^\d+/,'').toLowerCase()||'a';
    const candidateId=`class-6${secSuffix}-${plan.nextStartYear}`;
    const newId=candidateId;
    createRows.push({
     id:newId,
     name:g6.name,
     ...schedule
    });
    createdClasses.push({id:newId,name:g6.name,schoolYearId:plan.nextSchoolYearId,cohortSlug:g6.cohortSlug,routePath:g6.routePath});
   }
   data(await db.rpc('ltch_advance_school_year',{
    p_actor:actor.uid,
    p_year:{id:plan.nextSchoolYearId,name:plan.nextSchoolYearName,starts_on:startsOn,ends_on:endsOn},
    p_active:allActive.map(c=>({id:c.id,name:c.name,school_year_id:c.school_year_id,grade:classGrade(c.name)||null})),
    p_archive:plan.toArchive,p_promote:plan.toPromote,p_create:createRows,p_now:now
   }));
   try{await syncDriveWorkspace({db,env});}catch{console.warn('LTCH_DRIVE_SYNC_FAILED');}
   return json({ok:true,plan,createdClasses},201);
  }
  if(b.action==='create_class'){
   const name=className(string(b.name,120));
   let schoolYearId=typeof b.schoolYearId==='string'&&b.schoolYearId.trim()?id(b.schoolYearId.trim()):null;
   if(!schoolYearId){
    const years=data(await db.from('ltch_school_years').select('id').order('starts_on',{ascending:false}).limit(1))||[];
    schoolYearId=years[0]?.id||'year-2026-2027';
   }
   const schedule=b.scheduleSlots===undefined?{schedule:'',schedule_slots:[],reminders_enabled:true}:scheduleChange(b);
   const newId=randomUUID();
   data(await db.from('ltch_classes').insert({
    id:newId,
    name,
    school_year_id:schoolYearId,
    ...schedule,
    archived:false,
    enrollment_open:true
   }));
   await assignActiveStaffToClass(db,newId);
   try{await syncDriveWorkspace({db,env});}catch{console.warn('LTCH_DRIVE_SYNC_FAILED');}
   const slug=classCohortSlug({id:newId,name,schoolYearId});
   return json({ok:true,item:{id:newId,name,schoolYearId,cohortSlug:slug,routePath:`/class/${slug}`}},201);
  }
  if(b.action==='archive_class'||b.action==='restore_class'){
   const targetId=id(b.classId);
   const archiveFlag=b.action==='archive_class';
   const rows=data(await db.from('ltch_classes').update({archived:archiveFlag,enrollment_open:!archiveFlag}).eq('id',targetId).select('id'));
   demand(rows?.length===1,404,'Không tìm thấy lớp học.');
   return json({ok:true});
  }
  if(b.action==='delete_archived_class'){
   const targetId=id(b.classId);
   const target=data(await db.from('ltch_classes').select('id,archived').eq('id',targetId).maybeSingle());
   demand(target,404,'Không tìm thấy lớp học.');
   demand(target.archived,400,'Chỉ được xóa lớp đã nằm trong kho lưu trữ.');
   const rpcRes=typeof db.rpc==='function'?await db.rpc('ltch_delete_archived_class',{p_actor:actor.uid,p_class_id:targetId}):{error:{code:'42883'}};
   if(rpcRes?.error&&['PGRST202','42883'].includes(rpcRes.error.code)){
    try{await db.from('ltch_class_memberships').delete().eq('class_id',targetId);}catch{}
    data(await db.from('ltch_classes').delete().eq('id',targetId).eq('archived',true));
   }else{
    data(rpcRes);
   }
   return json({ok:true});
  }
  throw new ApiError(400,'Thao tác niên khóa không hợp lệ.');
 }

 if(path==='/api/admin/mail/retry'){
  admin();demand(method==='POST',405);
  const jobs=data(await db.from('ltch_mail_outbox').select('id').eq('status','pending').order('created_at').limit(10));
  let sent=0;for(const job of jobs)if(await deliverNotification(db,env,job.id)==='sent')sent++;
  return json({sent,pending:jobs.length-sent});
 }
 if(path==='/api/admin/drive/sync'){
  admin();demand(method==='POST',405);
  const b=await readJson(request,1024).catch(()=>({}));
  return json(await syncDriveWorkspace({db,env,forceVerify:Boolean(b?.verify),verifyOffset:Number(b?.offset||0),seedSessions:Boolean(b?.seed),batchSize:Number(b?.batch||0)}));
 }
 if(path==='/api/overview'){
  demand(method==='GET',405);
  const requestedRole=new URL(request.url).searchParams.get('role')||'';
  return json(await readOverviewDashboard(db,actor,await repo.classesFor(actor),{viewRole:requestedRole,now}));
 }
 if(path==='/api/profile'){
  if(method==='GET'){
   let prof=null;
   try{
    prof=data(await db.from('ltch_accounts').select('display_name,contact_phone,student_code,email,status,roles,created_at').eq('uid',actor.uid).single());
   }catch{
    prof=data(await db.from('ltch_accounts').select('display_name,contact_phone,student_code').eq('uid',actor.uid).single());
   }
   const actorRoles=Array.isArray(actor.roles)?actor.roles:[];
   const staffActor=isStaffRoles(actorRoles);
   const ownStudentCode=!staffActor&&actorRoles.includes('student')?(prof?.student_code||null):null;
   if(prof&&!staffActor&&!prof.student_code&&actorRoles.includes('parent')&&Array.isArray(actor.linkedStudentIds)&&actor.linkedStudentIds.length){
    try{
     const kids=data(await db.from('ltch_accounts').select('student_code').in('uid',actor.linkedStudentIds).limit(5));
     const foundCode=(kids||[]).find(k=>k?.student_code)?.student_code;
     if(foundCode)prof.student_code=foundCode;
    }catch{}
   }
   let enrollment=null;
   if(!staffActor){
    try{
     const reqRow=data(await db.from('ltch_enrollment_requests').select('id,applicant_role,status,full_name,date_of_birth,school_name,student_phone,parent_name,parent_phone,parent_relation,photo_path,created_at,updated_at').eq('uid',actor.uid).maybeSingle());
     if(reqRow){
      enrollment={
       id:reqRow.id,
       applicantRole:reqRow.applicant_role,
       status:reqRow.status,
       fullName:reqRow.full_name,
       dateOfBirth:reqRow.date_of_birth,
       schoolName:reqRow.school_name,
       studentPhone:reqRow.student_phone||'',
       parentName:reqRow.parent_name,
       parentPhone:reqRow.parent_phone,
       parentRelation:reqRow.parent_relation,
       hasPhoto:Boolean(reqRow.photo_path),
       photoUrl:reqRow.photo_path?`/api/enrollment/photo/${reqRow.id}`:null,
       createdAt:reqRow.created_at||null,
       updatedAt:reqRow.updated_at||null
      };
     }
    }catch{}
   }
   let linkedStudents=[];
   if(!staffActor&&actorRoles.includes('parent')&&Array.isArray(actor.linkedStudentIds)&&actor.linkedStudentIds.length){
    try{
     const kids=data(await db.from('ltch_accounts').select('uid,display_name,student_code').in('uid',actor.linkedStudentIds).limit(20))||[];
     const childMembers=Array.isArray(actor.childMemberships)?actor.childMemberships:[];
     linkedStudents=kids.map(k=>({
      uid:k.uid,
      display_name:k.display_name,
      student_code:k.student_code||null,
      class_ids:[...new Set(childMembers.filter(m=>m.uid===k.uid).map(m=>m.class_id))]
     }));
    }catch{}
   }
   let linkedParents=[];
   if(!staffActor&&actorRoles.includes('student')){
    try{
     const links=data(await db.from('ltch_parent_links').select('parent_uid').eq('student_uid',actor.uid).eq('status','active').limit(10))||[];
     const parentUids=[...new Set(links.map(l=>l.parent_uid).filter(Boolean))];
     if(parentUids.length){
      const parents=data(await db.from('ltch_accounts').select('uid,display_name,contact_phone,email').in('uid',parentUids).limit(10))||[];
      linkedParents=parents.map(p=>({
       uid:p.uid,
       display_name:p.display_name,
       contact_phone:p.contact_phone||'',
       email:p.email||''
      }));
     }
    }catch{}
   }
   return json({
    ...prof,
    student_code:staffActor?null:(prof?.student_code||null),
    own_student_code:ownStudentCode,
    email:prof?.email||actor.email||'',
    status:prof?.status||actor.status||'active',
    roles:Array.isArray(prof?.roles)?prof.roles:actorRoles,
    created_at:prof?.created_at||null,
    enrollment,
    linked_students:linkedStudents,
    linked_parents:linkedParents
   });
  }
  demand(method==='POST',405);const b=await readJson(request,2048);
  const cleanName=string(b.name,160);
  const cleanPhone=string(b.phone||'',30,true);
  if(cleanPhone)demand(/^[0-9+() -]{8,30}$/.test(cleanPhone),400,'Số điện thoại liên hệ không hợp lệ (cần 8–30 ký tự gồm chữ số, khoảng trắng, dấu + hoặc -).');
  data(await db.from('ltch_accounts').update({display_name:cleanName,contact_phone:cleanPhone}).eq('uid',actor.uid));
  return json({ok:true,display_name:cleanName,contact_phone:cleanPhone});
 }
 if(['/api/admin/promotions/preview','/api/admin/promotions/apply'].includes(path))return promotion(request,path,{db,actor});
 if(path==='/api/admin/accounts'){
  admin();if(method==='GET')return json({items:data(await db.from('ltch_accounts').select('uid,display_name,email,status,roles,student_code').order('created_at').limit(500))});
  demand(method==='POST',405);const b=await readJson(request);id(b.uid);demand(b.uid!==actor.uid,400,'Hãy dùng quản trị viên khác để thay đổi quyền của bạn.');
  demand(Array.isArray(b.roles)&&b.roles.length<=5&&b.roles.every(r=>roles.includes(r)),400,'Vai trò không hợp lệ.');demand(['pending','active','disabled'].includes(b.status),400);
   const selectedRoles=[...new Set(b.roles)];if(selectedRoles.includes('admin')&&!selectedRoles.includes('assistant'))selectedRoles.push('assistant');
   const rows=data(await db.from('ltch_accounts').update({roles:selectedRoles,status:b.status}).eq('uid',b.uid).select('uid'));demand(rows.length===1,404,'Không tìm thấy tài khoản.');return json({ok:true});
 }
 if(path==='/api/admin/years'){
  admin();if(method==='GET')return json({items:data(await db.from('ltch_school_years').select('*').order('starts_on',{ascending:false}).limit(50))});
  demand(method==='POST',405);const b=await readJson(request);demand(/^\d{4}-\d{2}-\d{2}$/.test(b.startsOn)&&/^\d{4}-\d{2}-\d{2}$/.test(b.endsOn)&&b.endsOn>b.startsOn,400,'Ngày năm học không hợp lệ.');
  const yStart=b.startsOn.slice(0,4),yEnd=b.endsOn.slice(0,4);
  const yearId=`year-${yStart}-${yEnd}-${randomUUID().slice(0,6)}`;
  data(await db.from('ltch_school_years').insert({id:yearId,name:string(b.name,100),starts_on:b.startsOn,ends_on:b.endsOn}));return json({ok:true},201);
 }
 if(path==='/api/admin/classes'){
  admin();if(method==='GET')return json({items:await repo.classesFor(actor)});
  demand(method==='POST',405);const b=await readJson(request);
  if(b.id){const rows=data(await db.from('ltch_classes').update({name:className(string(b.name,120))}).eq('id',id(b.id)).eq('archived',false).select('id'));demand(rows.length===1,404);return json({ok:true});}
  const schedule=b.scheduleSlots===undefined?{schedule:'',schedule_slots:[],reminders_enabled:true}:scheduleChange(b);
  const newClassId=randomUUID();
  data(await db.from('ltch_classes').insert({id:newClassId,name:className(string(b.name,120)),school_year_id:id(b.schoolYearId),...schedule,enrollment_open:true}));
  await assignActiveStaffToClass(db,newClassId);
  try{await syncDriveWorkspace({db,env});}catch{console.warn('LTCH_DRIVE_SYNC_FAILED');}
  return json({ok:true},201);
 }
 if(path==='/api/admin/memberships'){
  admin();if(method==='GET')return json({items:data(await db.from('ltch_class_memberships').select('*').limit(1000))});
  demand(method==='POST',405);const b=await readJson(request);demand(['student','teacher','assistant'].includes(b.role),400);demand(['active','inactive'].includes(b.status||'active'),400);
  const account=data(await db.from('ltch_accounts').select('roles,status').eq('uid',id(b.uid)).maybeSingle());demand(account?.status==='active'&&account.roles.includes(b.role),400,'Tài khoản chưa có vai trò tương ứng.');
  const hasBatch=Array.isArray(b.classIds);
  const targetClassIds=hasBatch?[...new Set(b.classIds.map(id))]:[id(b.classId)];
  demand(targetClassIds.length>=1&&targetClassIds.length<=100,400,'Danh sách lớp không hợp lệ.');
  if(targetClassIds.length===1){
   const singleClassId=targetClassIds[0];
   const klass=data(await db.from('ltch_classes').select('id').eq('id',singleClassId).eq('archived',false).maybeSingle());demand(klass,400,'Lớp đã lưu trữ hoặc không tồn tại.');
   if(b.role==='assistant'&&b.permissions===undefined){
    const key={class_id:singleClassId,uid:b.uid,member_role:'assistant'},status=b.status||'active';
    data(await db.from('ltch_class_memberships').upsert({...key,status,permissions:assistantDefaultPermissions},{onConflict:'class_id,uid,member_role',ignoreDuplicates:true}));
    const rows=data(await db.from('ltch_class_memberships').update({status}).eq('class_id',key.class_id).eq('uid',key.uid).eq('member_role',key.member_role).select('uid'));
    demand(rows.length===1,409,'Không thể lưu phân công. Vui lòng thử lại.');return json({ok:true});
   }
   const permissions=Array.isArray(b.permissions)?b.permissions:[];demand(permissions.length<=7&&permissions.every(p=>['attendance.write','materials.write','assignments.write','practice.manage','notices.write','messages.write','schedule.manage'].includes(p)),400,'Quyền trợ giảng không hợp lệ.');
   data(await db.from('ltch_class_memberships').upsert({class_id:singleClassId,uid:b.uid,member_role:b.role,status:b.status||'active',permissions:b.role==='assistant'?permissions:[]}));return json({ok:true});
  }
  const klasses=data(await db.from('ltch_classes').select('id').in('id',targetClassIds).eq('archived',false));demand(Array.isArray(klasses)&&klasses.length===targetClassIds.length,400,'Lớp đã lưu trữ hoặc không tồn tại.');
  if(b.role==='assistant'&&b.permissions===undefined){
   const status=b.status||'active';
   data(await db.from('ltch_class_memberships').upsert(targetClassIds.map(classId=>({class_id:classId,uid:b.uid,member_role:'assistant',status,permissions:assistantDefaultPermissions})),{onConflict:'class_id,uid,member_role',ignoreDuplicates:true}));
   const rows=data(await db.from('ltch_class_memberships').update({status}).in('class_id',targetClassIds).eq('uid',b.uid).eq('member_role','assistant').select('uid'));
   demand(rows.length===targetClassIds.length,409,'Không thể lưu phân công. Vui lòng thử lại.');return json({ok:true});
  }
  const permissions=Array.isArray(b.permissions)?b.permissions:[];demand(permissions.length<=7&&permissions.every(p=>['attendance.write','materials.write','assignments.write','practice.manage','notices.write','messages.write','schedule.manage'].includes(p)),400,'Quyền trợ giảng không hợp lệ.');
  data(await db.from('ltch_class_memberships').upsert(targetClassIds.map(classId=>({class_id:classId,uid:b.uid,member_role:b.role,status:b.status||'active',permissions:b.role==='assistant'?permissions:[]}))));return json({ok:true});
 }
 if(path==='/api/admin/parent-links'){
  admin();if(method==='GET')return json({items:data(await db.from('ltch_parent_links').select('*').limit(1000))});
  demand(method==='POST',405);const b=await readJson(request);id(b.parentUid);id(b.studentUid);demand(b.parentUid!==b.studentUid,400);
  const nextStatus=b.status||'active';demand(['active','inactive'].includes(nextStatus),400);
  if(nextStatus==='active'){
   const accounts=data(await db.from('ltch_accounts').select('uid,roles,status').in('uid',[b.parentUid,b.studentUid]));
   const parentAcc=accounts.find(a=>a.uid===b.parentUid&&a.status==='active'&&Array.isArray(a.roles)&&!isStaffRoles(a.roles)&&a.roles.includes('parent'));
   const studentAcc=accounts.find(a=>a.uid===b.studentUid&&a.status==='active'&&Array.isArray(a.roles)&&!isStaffRoles(a.roles)&&a.roles.includes('student'));
   demand(parentAcc&&studentAcc,400,'Liên kết chỉ áp dụng giữa tài khoản Phụ huynh và Học sinh đang hoạt động.');
  }
  data(await db.from('ltch_parent_links').upsert({parent_uid:b.parentUid,student_uid:b.studentUid,status:nextStatus}));return json({ok:true});
 }
 const edit=/^\/api\/classes\/([A-Za-z0-9_-]+)\/(assignments|exams|notices)\/([A-Za-z0-9_-]+)$/.exec(path);
 if(edit){
  const [,classId,kind,recordId]=edit;demand(method==='POST',405);const permission={assignments:'assignments.write',exams:'practice.manage',notices:'notices.write'}[kind];demand(staffCan(actor,classId,permission));
  let recordQuery=db.from('ltch_'+kind).select('id').eq('id',id(recordId)).eq('class_id',classId);
  if(kind==='notices')recordQuery=recordQuery.eq('status','published').eq('scope','class');
  const record=data(await recordQuery.maybeSingle());demand(record,404);
  const b=await readJson(request);
  if(kind==='exams'&&b.action==='delete'){
   data(await db.from('ltch_practice_attempts').delete().eq('exam_id',recordId));
   data(await db.from('ltch_exams').delete().eq('id',recordId).eq('class_id',classId));
   return json({ok:true,deletedExamId:recordId});
  }
  const change={title:string(b.title,250)};
  if(kind==='assignments'||kind==='exams'){
   const opens=timestamp(b.opensAt),closes=timestamp(b.closesAt);demand(closes>opens,400,'Giờ đóng phải sau giờ mở.');demand(['published','archived'].includes(b.status),400);Object.assign(change,{opens_at:opens,closes_at:closes,status:b.status});
   if(kind==='assignments')change.instructions=string(b.instructions||'',20000,true);
   else{change.results_at=timestamp(b.resultsAt);change.solutions_at=timestamp(b.solutionsAt);demand(change.results_at>=opens&&change.solutions_at>=change.results_at,400,'Thời điểm công bố không hợp lệ.');}
  }
  if(kind==='notices')change.body=string(b.body,20000);
  data(await db.from('ltch_'+kind).update(change).eq('id',recordId).eq('class_id',classId));return json({ok:true});
 }
 const cls=/^\/api\/classes\/([A-Za-z0-9_-]+)\/(workspace|assignments|exams|attendance|notices|messages|questions|schedule|sessions)$/.exec(path);
 if(cls){
  const classId=id(cls[1]),kind=cls[2];demand(classCanRead(actor,classId));const scope=studentScope(actor,classId),staff=staffCan(actor,classId);
  if(kind==='sessions'){
   const klass=data(await db.from('ltch_classes').select('*').eq('id',classId).maybeSingle());demand(klass,404,'Không tìm thấy lớp.');
   const year=klass.school_year_id?data(await db.from('ltch_school_years').select('*').eq('id',klass.school_year_id).maybeSingle()):null;
   const defaultStartDate=year?.starts_on||'2026-09-01';
   const loadCurrentSessions=async()=>{
    const [lessonsRes,filesRes]=await Promise.all([
     db.from('ltch_lessons').select('id,title,topic,created_at,created_by').eq('class_id',classId).order('created_at',{ascending:true}).limit(500),
     db.from('ltch_lesson_files').select('id,lesson_id,name,content_type,file_size,created_at').eq('class_id',classId).eq('status','stored').order('created_at',{ascending:true}).limit(2000)
    ]);
    const lessonRows=data(lessonsRes)||[];
    const fileRows=data(filesRes)||[];
    let assignRows=[];
    try{
     assignRows=data(await db.from('ltch_assignments').select('id,title,instructions,status').eq('class_id',classId).limit(300))||[];
    }catch{assignRows=[];}
    const linkedSessionNumbers=new Set();
    for(const a of assignRows){
     if(a?.status==='archived')continue;
     const dec=decodeAssignmentSessionInstructions(a?.instructions||'');
     const parsed=parseSessionLessonTitle(a?.title||'');
     const num=dec.sessionNumber||parsed.sessionNumber;
     if(num>=1&&num<=200)linkedSessionNumbers.add(num);
    }
    let folderRows=[];
    try{
     const candidateKeys=lessonRows.filter(l=>l?.id).map(l=>`lesson:${l.id}`);
     if(candidateKeys.length){
      const fq=db.from('ltch_drive_folders').select('folder_key,drive_folder_id,folder_name');
      const fRes=typeof fq.in==='function'?await fq.in('folder_key',candidateKeys):await fq.limit(500);
      folderRows=data(fRes)||[];
     }
    }catch{folderRows=[];}
    const driveFolderKeys=new Set(folderRows.map(r=>r.folder_key).filter(Boolean));
    return {
     lessonRows,
     fileRows,
     sessions:buildClassSessionsCatalog({
      classId,
      scheduleSlots:klass.schedule_slots||[],
      startDate:defaultStartDate,
      lessons:lessonRows,
      lessonFiles:fileRows,
      onlyExplicit:true,
      linkedSessionNumbers,
      driveFolderKeys
     })
    };
   };
   const persistSessionItems=async(items)=>{
    const rowsToUpsert=items.map((s,idx)=>{
     const lid=s.lessonId||lessonSessionId(classId,s.sessionNumber);
     const title=formatSessionLessonTitle(s.sessionNumber,s.lessonName||'');
     const topic=encodeSessionTopicMeta({
      cleanTopic:s.cleanTopic||'',
      sessionNumber:s.sessionNumber,
      date:s.date||'',
      start:s.start||'',
      end:s.end||'',
      customDate:Boolean(s.customDate),
      explicit:true,
      driveVideoFileId:s.driveVideoFileId||''
     });
     return {
      id:lid,
      class_id:classId,
      title,
      topic,
      created_by:actor.uid,
      created_at:s.createdAt||(now+idx)
     };
    });
    if(rowsToUpsert.length){
     data(await db.from('ltch_lessons').upsert(rowsToUpsert,{onConflict:'id'}));
    }
   };
   const buildLessonObjForDrive=(s)=>({
    id:s.lessonId||lessonSessionId(classId,s.sessionNumber),
    title:formatSessionLessonTitle(s.sessionNumber,s.lessonName||''),
    topic:encodeSessionTopicMeta({
     cleanTopic:s.cleanTopic||'',
     sessionNumber:s.sessionNumber,
     date:s.date||'',
     start:s.start||'',
     end:s.end||'',
     customDate:Boolean(s.customDate),
     explicit:true,
     driveVideoFileId:s.driveVideoFileId||''
    })
   });
   if(method==='GET'){
    const {sessions}=await loadCurrentSessions();
    return json({
     sessions,
     driveAvailable:lessonsAvailable(env,actor),
     startDate:sessions[0]?.date||defaultStartDate,
     schoolYearStartsOn:defaultStartDate,
     scheduleSlots:klass.schedule_slots||[],
     scheduleText:klass.schedule||''
    });
   }
   demand(method==='POST',405);
   demand(staffCan(actor,classId,'materials.write')||staffCan(actor,classId,'assignments.write')||staffCan(actor,classId,'schedule.manage'),403,'Bạn không có quyền chỉnh sửa buổi học của lớp này.');
   const b=await readJson(request);
   if(b.action==='add_session'||b.action==='create_session'){
    const {sessions}=await loadCurrentSessions();
    let nextNum=sessions.length?Math.max(...sessions.map(s=>s.sessionNumber))+1:1;
    if(b.sessionNumber!==undefined&&b.sessionNumber!==null&&String(b.sessionNumber).trim()!==''){
     nextNum=Number(b.sessionNumber);
     demand(Number.isInteger(nextNum)&&nextNum>=1&&nextNum<=200,400,'Số thứ tự buổi học không hợp lệ.');
     demand(!sessions.some(s=>s.sessionNumber===nextNum),409,`Buổi ${nextNum} đã tồn tại trong lớp.`);
    }
    demand(nextNum<=200,400,'Số lượng buổi học trong năm đã đạt giới hạn tối đa (200 buổi).');
    const todayIso=new Date().toLocaleDateString('en-CA');
    const lastDate=sessions.at(-1)?.date;
    const anchorDate=lastDate?addIsoDays(lastDate,1):(todayIso>defaultStartDate?todayIso:defaultStartDate);
    const nextSlot=generateScheduleDates({
     scheduleSlots:klass.schedule_slots||[],
     startDate:anchorDate,
     count:1
    })[0];
    const parsedInputDate=parseIsoDateParts(b.date)?.iso||'';
    const startVal=typeof b.start==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(b.start.trim())?b.start.trim():(nextSlot?.start||'');
    const endVal=typeof b.end==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(b.end.trim())?b.end.trim():(nextSlot?.end||'');
    const newSession={
     sessionNumber:nextNum,
     lessonId:lessonSessionId(classId,nextNum),
     lessonName:typeof b.lessonName==='string'?b.lessonName.trim().slice(0,180):'',
     cleanTopic:typeof b.cleanTopic==='string'?b.cleanTopic.trim().slice(0,120):'',
     date:parsedInputDate||nextSlot.date,
     start:startVal,
     end:endVal,
     customDate:Boolean(parsedInputDate)
    };
    const driveRes=await ensureSessionDriveFolder({db,env,classId,lesson:buildLessonObjForDrive(newSession),openDrive});
    await persistSessionItems([newSession]);
    const reloaded=await loadCurrentSessions();
    return json({ok:true,driveSynced:driveRes.synced,driveFolderName:driveRes.folderName,session:reloaded.sessions.find(s=>s.sessionNumber===nextNum),sessions:reloaded.sessions},201);
   }
   if(b.action==='ensure_session'){
    const sessionNumber=Number(b.sessionNumber);
    demand(Number.isInteger(sessionNumber)&&sessionNumber>=1&&sessionNumber<=200,400,'Số thứ tự buổi học không hợp lệ.');
    const {sessions}=await loadCurrentSessions();
    let target=sessions.find(s=>s.sessionNumber===sessionNumber);
    if(!target){
     const todayIso=new Date().toLocaleDateString('en-CA');
     const prevSorted=[...sessions].filter(s=>s.sessionNumber<sessionNumber).sort((a,b)=>a.sessionNumber-b.sessionNumber);
     const anchorDate=prevSorted.at(-1)?.date?addIsoDays(prevSorted.at(-1).date,1):(todayIso>defaultStartDate?todayIso:defaultStartDate);
     const nextSlot=generateScheduleDates({
      scheduleSlots:klass.schedule_slots||[],
      startDate:anchorDate,
      count:1
     })[0];
     target={
      sessionNumber,
      lessonId:lessonSessionId(classId,sessionNumber),
      lessonName:'',
      cleanTopic:'',
      date:parseIsoDateParts(b.date)?.iso||nextSlot.date,
      start:nextSlot?.start||'',
      end:nextSlot?.end||'',
      customDate:Boolean(b.date)
     };
    }
    if(typeof b.lessonName==='string'&&b.lessonName.trim()){
     target.lessonName=b.lessonName.trim().slice(0,180);
     target.title=formatSessionLessonTitle(target.sessionNumber,target.lessonName);
    }
    if(typeof b.cleanTopic==='string'&&b.cleanTopic.trim()){
     target.cleanTopic=b.cleanTopic.trim().slice(0,120);
    }
    const driveRes=await ensureSessionDriveFolder({db,env,classId,lesson:buildLessonObjForDrive(target),openDrive});
    await persistSessionItems([target]);
    const reloaded=await loadCurrentSessions();
    return json({ok:true,driveSynced:driveRes.synced,driveFolderName:driveRes.folderName,session:reloaded.sessions.find(s=>s.sessionNumber===sessionNumber),sessions:reloaded.sessions});
   }
   if(b.action==='update_session'){
    const sessionNumber=Number(b.sessionNumber);
    demand(Number.isInteger(sessionNumber)&&sessionNumber>=1&&sessionNumber<=200,400,'Số thứ tự buổi học không hợp lệ.');
    const {sessions}=await loadCurrentSessions();
    const current=sessions.find(s=>s.sessionNumber===sessionNumber);
    demand(current,404,'Không tìm thấy buổi học.');
    const targetDate=b.date?parseIsoDateParts(b.date)?.iso:current.date;
    demand(targetDate,400,'Ngày học không hợp lệ.');
    const result=rescheduleCourseSessions(sessions,sessionNumber,targetDate,{
     scheduleSlots:klass.schedule_slots||[],
     newStart:typeof b.start==='string'?b.start.trim():undefined,
     newEnd:typeof b.end==='string'?b.end.trim():undefined,
     newLessonName:typeof b.lessonName==='string'?b.lessonName.trim().slice(0,180):undefined,
     newTopic:typeof b.cleanTopic==='string'?b.cleanTopic.trim().slice(0,120):undefined,
     cascade:typeof b.cascade==='boolean'?b.cascade:null
    });
    const updatedOne=result.sessions.find(s=>s.sessionNumber===sessionNumber)||current;
    const driveRes=await ensureSessionDriveFolder({db,env,classId,lesson:buildLessonObjForDrive(updatedOne),openDrive});
    if(result.cascaded){
     await persistSessionItems(result.sessions);
    }else{
     await persistSessionItems([updatedOne]);
    }
    const reloaded=await loadCurrentSessions();
    return json({
     ok:true,
     driveSynced:driveRes.synced,
     driveFolderName:driveRes.folderName,
     cascaded:result.cascaded,
     shiftedCount:result.shiftedCount,
     deltaDays:result.deltaDays,
     oldDate:result.oldDate,
     newDate:result.newDate,
     sessions:reloaded.sessions
    });
   }
   if(b.action==='sync_from_schedule'){
    const {sessions}=await loadCurrentSessions();
    if(!sessions.length)return json({ok:true,sessions:[]});
    const totalCount=sessions.length;
    const fromNum=Math.max(1,Number(b.fromSessionNumber)||sessions[0].sessionNumber);
    const toSync=sessions.filter(s=>s.sessionNumber>=fromNum);
    const startAnchor=parseIsoDateParts(b.startDate)?.iso||(toSync[0]?.date||defaultStartDate);
    const generated=generateScheduleDates({
     scheduleSlots:klass.schedule_slots||[],
     startDate:startAnchor,
     count:toSync.length
    });
    const toSave=toSync.map((existing,i)=>({
     ...existing,
     date:generated[i].date,
     day:generated[i].day,
     dayLabel:generated[i].dayLabel,
     start:generated[i].start||existing.start||'',
     end:generated[i].end||existing.end||'',
     customDate:false
    }));
    await persistSessionItems(toSave);
    const reloaded=await loadCurrentSessions();
    return json({ok:true,sessions:reloaded.sessions});
   }
   if(b.action==='delete_file'){
    demand(staffCan(actor,classId,'materials.write')||staffCan(actor,classId,'assignments.write'),403,'Bạn không có quyền xóa tệp của lớp học này.');
    const fileId=id(b.fileId);
    const fileRow=data(await db.from('ltch_lesson_files').select('id,lesson_id,class_id,drive_file_id').eq('id',fileId).eq('class_id',classId).maybeSingle());
    demand(fileRow,404,'Không tìm thấy tệp cần xóa.');
    if(fileRow.drive_file_id){
     await trashDriveTargetsSafe({env,driveIds:[fileRow.drive_file_id],openDrive});
    }
    data(await db.from('ltch_lesson_files').delete().eq('id',fileId).eq('class_id',classId));
    const parentLesson=data(await db.from('ltch_lessons').select('id,title,topic').eq('id',fileRow.lesson_id).eq('class_id',classId).maybeSingle());
    if(parentLesson){
     const meta=decodeSessionTopicMeta(parentLesson.topic||'',parentLesson.title||'');
     if(meta.driveVideoFileId===fileId){
      const nextTopic=encodeSessionTopicMeta({...meta,driveVideoFileId:'',explicit:true});
      data(await db.from('ltch_lessons').update({topic:nextTopic}).eq('id',parentLesson.id).eq('class_id',classId));
     }
    }
    const reloaded=await loadCurrentSessions();
    return json({ok:true,deletedFileId:fileId,sessions:reloaded.sessions});
   }
   if(b.action==='delete_session'){
    demand(staffCan(actor,classId,'materials.write')||staffCan(actor,classId,'schedule.manage'),403,'Bạn không có quyền xóa buổi học của lớp này.');
    const sessionNumber=Number(b.sessionNumber);
    demand(Number.isInteger(sessionNumber)&&sessionNumber>=1&&sessionNumber<=200,400,'Số thứ tự buổi học không hợp lệ.');
    const {sessions}=await loadCurrentSessions();
    const target=sessions.find(s=>s.sessionNumber===sessionNumber);
    demand(target,404,'Không tìm thấy buổi học.');
    const targetLessonId=target.lessonId||lessonSessionId(classId,sessionNumber);
    const fileRows=data(await db.from('ltch_lesson_files').select('id,drive_file_id').eq('class_id',classId).eq('lesson_id',targetLessonId))||[];
    let folderRow=null;
    try{
     folderRow=data(await db.from('ltch_drive_folders').select('folder_key,drive_folder_id').eq('folder_key',`lesson:${targetLessonId}`).maybeSingle());
    }catch{folderRow=null;}
    const trashIds=[...fileRows.map(f=>f.drive_file_id),folderRow?.drive_folder_id].filter(Boolean);
    await trashDriveTargetsSafe({env,driveIds:trashIds,openDrive});
    data(await db.from('ltch_lesson_files').delete().eq('lesson_id',targetLessonId).eq('class_id',classId));
    try{
     data(await db.from('ltch_drive_folders').delete().eq('folder_key',`lesson:${targetLessonId}`));
    }catch{}
    data(await db.from('ltch_lessons').delete().eq('id',targetLessonId).eq('class_id',classId));
    try{
     const assignRows=data(await db.from('ltch_assignments').select('id,title,instructions,status').eq('class_id',classId).limit(300))||[];
     const matchingAssignIds=assignRows
      .filter(a=>{
       const dec=decodeAssignmentSessionInstructions(a?.instructions||'');
       const parsed=parseSessionLessonTitle(a?.title||'');
       return (dec.sessionNumber||parsed.sessionNumber)===sessionNumber;
      })
      .map(a=>a.id);
     for(const assignId of matchingAssignIds){
      data(await db.from('ltch_assignments').update({status:'archived'}).eq('id',assignId).eq('class_id',classId));
     }
    }catch{}
    const reloaded=await loadCurrentSessions();
    return json({ok:true,deletedSessionNumber:sessionNumber,sessions:reloaded.sessions});
   }
   throw new ApiError(400,'Thao tác buổi học không hợp lệ.');
  }
  if(kind==='schedule'){
   demand(method==='POST',405);demand(staffCan(actor,classId,'schedule.manage'));
   const b=await readJson(request);demand(Number.isSafeInteger(b.version)&&b.version>=0,400,'Lịch học chưa có phiên bản hợp lệ. Hãy tải lại lớp.');
   const change=scheduleChange(b);
   const rows=data(await db.from('ltch_classes').update({...change,schedule_revision:b.version+1}).eq('id',classId).eq('schedule_revision',b.version).select('id'));
   demand(rows.length===1,409,'Lịch học vừa được thay đổi. Hãy tải lại lớp trước khi lưu.');return json({ok:true});
  }
  if(kind==='questions'){
   demand(staffCan(actor,classId,'practice.manage'));
   if(method==='GET')return json({items:data(await db.from('ltch_question_bank').select('*').eq('class_id',classId).eq('status','active').order('created_at',{ascending:false}).limit(300))});
   demand(method==='POST',405);const b=await readJson(request);
   if(b.archiveId){data(await db.from('ltch_question_bank').update({status:'archived'}).eq('id',id(b.archiveId)).eq('class_id',classId));return json({ok:true});}
   const question=validateQuestions([b.question])[0];data(await db.from('ltch_question_bank').insert({id:randomUUID(),class_id:classId,topic:string(b.topic||'',200,true),question,created_by:actor.uid,created_at:now}));return json({ok:true},201);
  }
  if(kind==='workspace'&&method==='GET'){
   const klass=data(await db.from('ltch_classes').select('*').eq('id',classId).maybeSingle());demand(klass,404,'Không tìm thấy lớp.');
   let assignments=db.from('ltch_assignments').select('*').eq('class_id',classId).order('closes_at',{ascending:false}).limit(100);if(!staff)assignments=assignments.in('status',['published','archived']);
   let exams=db.from('ltch_exams').select('id,title,status,opens_at,closes_at,results_at,solutions_at').eq('class_id',classId).order('opens_at',{ascending:false}).limit(100);if(!staff)exams=exams.in('status',['published','archived']);
   let attendance=db.from('ltch_attendance').select('*').eq('class_id',classId).order('lesson_date',{ascending:false}).limit(1000);if(scope)attendance=attendance.in('student_uid',scope.length?scope:['__none__']);
   const [assignmentRes,examRes,messagesRes,classMembersRes,adminAssistantsRes,attendanceRes,noticesRes]=await Promise.all([
    assignments,
    exams,
    db.from('ltch_messages').select('*').eq('class_id',classId).or(`sender_uid.eq.${actor.uid},recipient_uid.eq.${actor.uid}`).order('created_at',{ascending:false}).limit(100),
    db.from('ltch_class_memberships').select('uid,member_role,status').eq('class_id',classId).eq('status','active'),
    db.from('ltch_accounts').select('uid').contains('roles',['admin']).eq('status','active'),
    attendance,
    db.from('ltch_notices').select('id,class_id,scope,title,body,created_by,created_at').eq('status','published').or(`scope.eq.all,class_id.eq.${classId}`).order('created_at',{ascending:false}).limit(100)
   ]);
   const assignmentRows=data(assignmentRes),examRows=data(examRes).filter(e=>!/^exam_(thptqg|hsa|tsa)_/i.test(String(e?.id||''))),messages=data(messagesRes),classMembers=data(classMembersRes),adminAssistants=data(adminAssistantsRes);
   const noticeRowsWithFiles=await withNoticeFiles(db,data(noticesRes),{stripReads:false});
   // Active administrators are also assistants in every class, including new classes.
   // Keep existing teachers and other assistants intact and avoid duplicate entries.
   for(const account of adminAssistants)if(!classMembers.some(m=>m.uid===account.uid&&m.member_role==='assistant'))classMembers.push({uid:account.uid,member_role:'assistant',status:'active'});
   const staffIds=classMembers.filter(m=>['teacher','assistant'].includes(m.member_role)).map(m=>m.uid);
   const studentIds=staff?classMembers.filter(m=>m.member_role==='student').map(m=>m.uid):[];
   const loadSubmissions=async()=>{
    if(!assignmentRows.length)return {data:[],error:null};
    const ids=assignmentRows.map(a=>a.id);
    const run=(cols)=>{let q=db.from('ltch_submissions').select(cols).in('assignment_id',ids).order('created_at',{ascending:false}).limit(300);if(scope)q=q.in('uid',scope.length?scope:['__none__']);return q;};
    const modern=await run('id,assignment_id,uid,status,created_at,stored_at,file_size,content_type,feedback,object_path,student_note,files');
    if(!modern.error||!isMissingSubmissionColumnError(modern.error))return modern;
    return run('id,assignment_id,uid,status,created_at,stored_at,file_size,content_type,feedback,object_path');
   };
   const [submissionsRes,attemptsRes,parentsRes]=await Promise.all([
    loadSubmissions(),
    examRows.length?(()=>{let q=db.from('ltch_practice_attempts').select('id,exam_id,uid,submitted_at').in('exam_id',examRows.map(e=>e.id)).order('submitted_at',{ascending:false}).limit(300);if(scope)q=q.in('uid',scope.length?scope:['__none__']);return q;})():Promise.resolve({data:[],error:null}),
    staff&&studentIds.length?db.from('ltch_parent_links').select('parent_uid,student_uid').in('student_uid',studentIds).eq('status','active'):Promise.resolve({data:[],error:null})
   ]);
   const submissions=data(submissionsRes).map(toPublicSubmission),attempts=data(attemptsRes),parents=data(parentsRes);
   const noticeRows=await withNoticeReads(db,noticeRowsWithFiles,{
    actorUid:actor.uid,
    staff,
    studentUids:studentIds,
    parentLinks:parents,
    staffUids:staffIds
   });
   let contactIds=staff?[...classMembers.map(m=>m.uid),...parents.map(p=>p.parent_uid)]:staffIds;
   contactIds=[...new Set(contactIds)].filter(uid=>uid!==actor.uid);
   const visibleIds=[...new Set([actor.uid,...contactIds,...(scope||classMembers.map(m=>m.uid)),...noticeRows.map(n=>n.created_by)])];
   const memberUids=classMembers.length&&staff?[...new Set(classMembers.map(m=>m.uid))]:[];
   const [contactsRes,peopleRes,namesRes]=await Promise.all([
    contactIds.length?db.from('ltch_accounts').select('uid,display_name').in('uid',contactIds).eq('status','active'):Promise.resolve({data:[],error:null}),
    visibleIds.length?db.from('ltch_accounts').select('uid,display_name').in('uid',visibleIds):Promise.resolve({data:[],error:null}),
    memberUids.length?db.from('ltch_accounts').select('uid,display_name,student_code').in('uid',memberUids):Promise.resolve({data:[],error:null})
   ]);
   const contacts=data(contactsRes).map(({uid,display_name})=>({uid,display_name}));
   const people=data(peopleRes).map(({uid,display_name})=>({uid,display_name}));
   const names=data(namesRes);
   const members=staff?classMembers.map(m=>({...m,name:names.find(n=>n.uid===m.uid)?.display_name||m.uid,...(m.member_role==='student'?{student_code:names.find(n=>n.uid===m.uid)?.student_code||null}:{})})):[];
   return json({viewerContext:{uid:actor.uid,roles:actor.roles,memberships:actor.memberships,childMemberships:actor.childMemberships||[]},class:klass,assignments:assignmentRows,exams:examRows,attendance:data(attendanceRes),submissions,notices:noticeRows,materials:[],materialsHasMore:false,lessonsEnabled:lessonsAvailable(env,actor)&&Boolean(env.GOOGLE_DRIVE_CLIENT_ID&&env.GOOGLE_DRIVE_CLIENT_SECRET&&env.GOOGLE_DRIVE_REFRESH_TOKEN),lessonsLinkPreview:env.LTCH_DRIVE_LINK_PREVIEW==='1',messages,members,contacts,people,attempts,permissions:{schedule:staffCan(actor,classId,'schedule.manage'),messages:!staff||staffCan(actor,classId,'messages.write'),assignments:staffCan(actor,classId,'assignments.write'),practice:staffCan(actor,classId,'practice.manage'),attendance:staffCan(actor,classId,'attendance.write'),materials:staffCan(actor,classId,'materials.write'),notices:staffCan(actor,classId,'notices.write'),student:actor.roles.includes('student')&&actor.memberships.some(m=>m.class_id===classId&&m.member_role==='student')}});
  }
  demand(method==='POST',405);const b=await readJson(request);
  if(kind==='assignments'){
   demand(staffCan(actor,classId,'assignments.write'));
   const opensAt=timestamp(b.opensAt),closesAt=timestamp(b.closesAt);demand(closesAt>opensAt,400,'Hạn nộp phải sau giờ mở.');
   const assignmentId=randomUUID(),title=string(b.title,250),instructions=string(b.instructions||'',20000,true);
   data(await db.from('ltch_assignments').insert({id:assignmentId,class_id:classId,title,instructions,opens_at:opensAt,closes_at:closesAt,status:'published',created_by:actor.uid}));
   let driveSynced=false;
   if(env.GOOGLE_DRIVE_CLIENT_ID&&env.GOOGLE_DRIVE_CLIENT_SECRET&&env.GOOGLE_DRIVE_REFRESH_TOKEN){
    try{
     const drive=openDrive?await openDrive(env):await configuredDrive(env);
     await ensureAssignmentDriveFolder({db,drive,classId,assignment:{id:assignmentId,title,instructions}});
     driveSynced=true;
    }catch(err){console.error('LTCH_ASSIGNMENT_FOLDER_INIT_FAILED',{assignmentId,message:err?.message||'error'});}
   }
   return json({ok:true,id:assignmentId,driveSynced},201);
  }
  if(kind==='exams'){
   demand(staffCan(actor,classId,'practice.manage'));const opensAt=timestamp(b.opensAt),closesAt=timestamp(b.closesAt);demand(closesAt>opensAt,400);const questions=validateQuestions(b.questions),resultsAt=timestamp(b.resultsAt),solutionsAt=timestamp(b.solutionsAt);demand(resultsAt>=opensAt&&solutionsAt>=resultsAt,400,'Lời giải phải công bố sau kết quả.');
   data(await db.from('ltch_exams').insert({id:randomUUID(),class_id:classId,title:string(b.title,250),status:'published',opens_at:opensAt,closes_at:closesAt,results_at:resultsAt,solutions_at:solutionsAt,questions,created_by:actor.uid}));return json({ok:true},201);
  }
  if(kind==='attendance'){
   demand(staffCan(actor,classId,'attendance.write'));demand(/^\d{4}-\d{2}-\d{2}$/.test(b.date)&&['present','absent','late','excused'].includes(b.status),400);id(b.studentUid);
   const klass=data(await db.from('ltch_classes').select('id,archived').eq('id',classId).maybeSingle());demand(klass&&!klass.archived,400,'Không thể ghi điểm danh cho lớp đã lưu trữ.');
   const member=data(await db.from('ltch_class_memberships').select('uid').eq('uid',b.studentUid).eq('class_id',classId).eq('member_role','student').eq('status','active').maybeSingle());demand(member,400,'Học sinh không thuộc lớp.');
   const note=string(b.note||'',1000,true);
   const selection=()=>db.from('ltch_attendance').select('id,status,note,updated_at').eq('class_id',classId).eq('student_uid',b.studentUid).eq('lesson_date',b.date).maybeSingle();
   for(let attempt=0;attempt<3;attempt++){
    const previous=data(await selection());
    if(previous?.status===b.status&&previous.note===note)return json({ok:true,notificationStatus:'unchanged'});
    const updatedAt=Math.max(now,(previous?.updated_at||0)+1);
    const change={status:b.status,note,recorded_by:actor.uid,updated_at:updatedAt};
    const write=previous
      ? db.from('ltch_attendance').update(change).eq('id',previous.id).eq('updated_at',previous.updated_at)
      : db.from('ltch_attendance').upsert({id:`${classId}_${b.studentUid}_${b.date}`,class_id:classId,student_uid:b.studentUid,lesson_date:b.date,...change},{onConflict:'class_id,student_uid,lesson_date',ignoreDuplicates:true});
    if(!data(await write.select('id').maybeSingle()))continue;
    const notificationStatus=previous?.status===b.status?'unchanged':await queueAttendanceMail(env,{classId,studentUid:b.studentUid,date:b.date,status:b.status,revision:updatedAt});
    return json({ok:true,notificationStatus});
   }
   throw new ApiError(409,'Kết quả điểm danh vừa thay đổi. Vui lòng thử lưu lại.');
  }
  if(kind==='notices'){
   demand(staffCan(actor,classId,'notices.write'));
   const noticeId=randomUUID(),cleanTitle=string(b.title,250),cleanBody=stripLegacyNoticeReads(string(b.body,20000));
   demand(cleanBody.trim().length>0,400,'Nội dung không hợp lệ.');
   data(await db.from('ltch_notices').insert({id:noticeId,class_id:classId,title:cleanTitle,body:cleanBody,created_by:actor.uid,created_at:now}));
   const mailResult=await notifyClassStudentsOfNotice({db,env,classId,noticeId,title:cleanTitle,body:cleanBody,actor,createdAt:now});
   return json({ok:true,id:noticeId,notificationStatus:mailResult.status,notifiedCount:mailResult.sent},201);
  }
  if(kind==='messages'){
   demand(!staff||staffCan(actor,classId,'messages.write'));
   id(b.recipientUid);demand(b.recipientUid!==actor.uid,400);const recipient=await repo.actor(b.recipientUid);demand(recipient&&classCanRead(recipient,classId));demand(staff||staffCan(recipient,classId),403,'Trao đổi phải có giáo viên hoặc trợ giảng của lớp tham gia.');data(await db.from('ltch_messages').insert({id:randomUUID(),class_id:classId,sender_uid:actor.uid,recipient_uid:b.recipientUid,body:string(b.body,10000),created_at:now}));return json({ok:true},201);
  }
 }
 const file=/^\/api\/submissions\/([A-Za-z0-9_-]+)\/(file|feedback)$/.exec(path);
 if(file){
  const record=data(await db.from('ltch_submissions').select('*').eq('id',id(file[1])).maybeSingle());demand(record,404,'Không tìm thấy.');const assignment=await repo.getAssignment(record.assignment_id);demand(assignment,404);const classId=assignment.classId;
  demand(classCanRead(actor,classId));const scope=studentScope(actor,classId);if(scope)demand(scope.includes(record.uid));
  const decoded=decodeSubmissionRecord(record);
  if(file[2]==='feedback'){
   demand(method==='POST'&&staffCan(actor,classId,'assignments.write'));const b=await readJson(request);
   const cleanFeedback=string(b.feedback,decoded.hasLegacyMeta?6000:10000,true);
   const legacyOnly=decoded.hasLegacyMeta&&!Object.prototype.hasOwnProperty.call(record,'student_note')&&!Object.prototype.hasOwnProperty.call(record,'files');
   const nextFeedback=legacyOnly?encodeLegacySubmissionFeedback({feedback:cleanFeedback,note:decoded.note,files:decoded.files}):cleanFeedback;
   data(await db.from('ltch_submissions').update({feedback:nextFeedback}).eq('id',record.id));return json({ok:true});
  }
  demand(method==='GET'&&record.status==='stored',404,'Tệp chưa sẵn sàng.');
  const reqUrl=new URL(request.url);
  const rawIndex=reqUrl.searchParams.get('index');
  let fileIdx=0;
  if(rawIndex!==null){
   demand(/^\d+$/.test(rawIndex),404,'Không tìm thấy tệp bài nộp.');
   fileIdx=Number(rawIndex);
  }
  const target=decoded.files[fileIdx];
  demand(target&&target.objectPath,404,'Không tìm thấy tệp bài nộp.');
  const inline=reqUrl.searchParams.get('inline')==='1';
  const targetMime=target.contentType||'application/octet-stream';
  const ext=SUBMISSION_ALLOWED_TYPES[targetMime]||'bin';
  const asciiName=String(target.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').replace(/[^A-Za-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80)||`${record.id}-${fileIdx+1}.${ext}`;
  const dispositionName=asciiName.includes('.')?asciiName:`${asciiName}.${ext}`;
  const upstream=typeof target.objectPath==='string'&&target.objectPath.startsWith('drive:')
   ? await downloadSubmissionFromDrive({env,driveFileId:target.objectPath.slice('drive:'.length),...(openDrive?{openDrive}:{})})
   : await configuredStorage(env).download({bucket:'ltch-submissions',path:target.objectPath});
  return new Response(upstream.body,{headers:{'content-type':targetMime,'content-disposition':`${inline?'inline':'attachment'}; filename="${dispositionName}"`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
 }
 throw new ApiError(404,'Không tìm thấy chức năng.');
}
