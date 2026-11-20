import {randomUUID} from 'node:crypto';
import {demand,data,id,string,isAdmin} from './policy.mjs';
import {readJson,readFormData,json} from './http.mjs';
import {configuredStorage} from './submission-handler.mjs';
import {deliverNotification} from './mail-queue.mjs';
import {sortClasses} from '../shared/classroom.mjs';
import {notifyStaffRequest} from './staff-request-mail.mjs';
export const canReviewEnrollment=(actor,classId)=>isAdmin(actor)||actor?.status==='active'&&actor.roles.includes('teacher')&&actor.memberships.some(m=>m.class_id===classId&&m.member_role==='teacher');
const map=r=>({id:r.id,uid:r.uid,version:r.version,applicantRole:r.applicant_role,status:r.status,schoolYearId:r.school_year_id,classId:r.class_id,fullName:r.full_name,dateOfBirth:r.date_of_birth,schoolName:r.school_name,studentPhone:r.student_phone,parentName:r.parent_name,parentPhone:r.parent_phone,parentRelation:r.parent_relation,adminNotes:r.admin_notes,createdAt:r.created_at,hasPhoto:!!r.photo_path,photoUrl:r.photo_path?`/api/enrollment/photo/${r.id}`:null});
export async function enrollment(request,path,{db,actor,env,limit}){
 demand(actor&&['active','pending'].includes(actor.status));const method=request.method;
 const own=()=>db.from('ltch_enrollment_requests').select('*').eq('uid',actor.uid).maybeSingle();
 if(path==='/api/admin/enrollments/students'){
  demand(method==='GET',405);const classId=id(new URL(request.url).searchParams.get('classId'));demand(canReviewEnrollment(actor,classId));
  const members=data(await db.from('ltch_class_memberships').select('uid').eq('class_id',classId).eq('member_role','student').eq('status','active'));
  const ids=[...new Set(members.map(m=>m.uid))];
  const accounts=ids.length?data(await db.from('ltch_accounts').select('uid,display_name,roles,student_code').in('uid',ids).eq('status','active')):[];
  return json({items:accounts.filter(a=>a.roles.includes('student')&&!a.roles.some(r=>r==='admin'||r==='teacher'||r==='assistant')).map(a=>({uid:a.uid,name:a.display_name,studentCode:a.student_code||null}))});
 }
 if(path==='/api/enrollment/catalog'){
  demand(method==='GET',405);return json({classes:sortClasses(data(await db.from('ltch_classes').select('id,name,school_year_id,schedule').eq('archived',false).eq('enrollment_open',true).order('name').limit(200))),years:data(await db.from('ltch_school_years').select('*').order('starts_on',{ascending:false}).limit(50))});
 }
 if(path==='/api/enrollment/my-status'){
  demand(method==='GET',405);const row=data(await own());if(row)return json({hasRequest:true,status:row.status,request:map(row)});
  const staffRole=actor.status==='pending'?actor.roles.find(role=>['teacher','assistant'].includes(role)):null;
  return json(staffRole?{hasRequest:false,status:'staff_pending',staffRole}:{hasRequest:false,status:'none'});
 }
 if(path==='/api/enrollment/staff-request'){
  demand(method==='POST',405);demand(actor.status==='pending',403);demand(await limit(request,'staffRequest'),429,'Bạn đã gửi nhiều yêu cầu. Vui lòng thử lại sau.');
  const b=await readJson(request,1024);demand(['teacher','assistant'].includes(b.role),400,'Chọn giáo viên hoặc trợ giảng.');
  demand(!await own().then(data),409,'Tài khoản đã có hồ sơ đăng ký. Vui lòng liên hệ quản trị viên.');
  const account=data(await db.from('ltch_accounts').select('uid,display_name,email,status,roles').eq('uid',actor.uid).maybeSingle());
  demand(account?.status==='pending'&&Array.isArray(account.roles),409,'Trạng thái tài khoản đã thay đổi. Hãy tải lại trang.');
  if(account.roles.length===0){
   const rows=data(await db.from('ltch_accounts').update({roles:[b.role]}).eq('uid',actor.uid).eq('status','pending').eq('roles','{}').select('uid'));
   demand(rows.length===1,409,'Yêu cầu vừa thay đổi. Hãy tải lại trang.');
  }else demand(account.roles.length===1&&account.roles[0]===b.role,409,'Tài khoản đã có yêu cầu khác. Vui lòng liên hệ quản trị viên.');
  const notified=await notifyStaffRequest(env,account,b.role);
  return json({ok:true,notificationStatus:notified?'sent':'not_sent'});
 }
 if(path==='/api/enrollment/submit'){
  demand(method==='POST',405);demand(actor.status==='pending',403,'Tài khoản đang hoạt động: liên hệ quản trị viên để đổi hoặc liên kết thêm lớp.');demand(!actor.roles.some(role=>['teacher','assistant'].includes(role)),409,'Tài khoản đã gửi yêu cầu nhân sự. Vui lòng liên hệ quản trị viên.');demand(await limit(request,'enrollment'),429,'Bạn đã gửi quá nhiều hồ sơ. Hãy thử lại sau.');
  const previous=data(await own());demand(!previous||['pending','needs_revision'].includes(previous.status),409,'Hồ sơ đã được xử lý.');
  const form=await readFormData(request,5_500_000);const get=n=>form.get(n),classId=id(get('classId')),yearId=id(get('schoolYearId'));
  const klass=data(await db.from('ltch_classes').select('id').eq('id',classId).eq('school_year_id',yearId).eq('archived',false).eq('enrollment_open',true).maybeSingle());demand(klass,400,'Lớp chưa mở đăng ký hoặc không thuộc năm học đã chọn.');
  const role=get('applicantRole')||'student';demand(['student','parent'].includes(role),400);const dob=get('dateOfBirth');demand(typeof dob==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(dob)&&new Date(dob).toISOString().slice(0,10)===dob&&dob>='1900-01-01'&&dob<=new Date().toISOString().slice(0,10),400,'Ngày sinh không hợp lệ.');
  const phone=string(get('parentPhone'),30);demand(/^[0-9+() -]{8,30}$/.test(phone),400,'Số điện thoại phụ huynh không hợp lệ.');demand(['father','mother','guardian'].includes(get('parentRelation')),400);demand(get('consentPrivacy')==='true',400,'Vui lòng đồng ý với Chính sách bảo vệ dữ liệu cá nhân trước khi gửi hồ sơ.');
  const policyVersion=string(get('policyVersion')||'1.0',20);
  const row={uid:actor.uid,applicant_role:role,school_year_id:yearId,class_id:classId,full_name:string(get('fullName'),160),date_of_birth:dob,school_name:string(get('schoolName'),200),student_phone:string(get('studentPhone')||'',30,true),parent_name:string(get('parentName'),160),parent_phone:phone,parent_relation:get('parentRelation'),status:'pending',admin_notes:'',updated_at:new Date().toISOString(),version:(previous?.version||0)+1};
  const photo=get('photo');row.photo_path=previous?.photo_path||'';
  if(photo&&typeof photo.arrayBuffer==='function'&&photo.size){demand(photo.size<=5_000_000&&['image/jpeg','image/png'].includes(photo.type),400,'Chọn ảnh JPG hoặc PNG tối đa 5 MB.');const ext=photo.type==='image/png'?'png':'jpg';row.photo_path=`profiles/${actor.uid}/${randomUUID()}.${ext}`;await configuredStorage(env).upload({bucket:'ltch-materials',path:row.photo_path,bytes:new Uint8Array(await photo.arrayBuffer()),contentType:photo.type});}
  data(await db.rpc('ltch_submit_enrollment',{p_uid:actor.uid,p_id:previous?.id||randomUUID(),p_previous_version:previous?.version||0,p_row:row,p_policy:policyVersion}));
  return json({ok:true,status:'pending'});
 }
 const photo=/^\/api\/enrollment\/photo\/([A-Za-z0-9_-]+)$/.exec(path);
 if(photo){demand(method==='GET',405);const row=data(await db.from('ltch_enrollment_requests').select('uid,class_id,photo_path').eq('id',id(photo[1])).maybeSingle());demand(row&&(row.uid===actor.uid||canReviewEnrollment(actor,row.class_id)));demand(row.photo_path,404,'Hồ sơ chưa có ảnh.');const res=await configuredStorage(env).download({bucket:'ltch-materials',path:row.photo_path});return new Response(res.body,{headers:{'content-type':row.photo_path.endsWith('.png')?'image/png':'image/jpeg','cache-control':'no-store','x-content-type-options':'nosniff'}});}
 if(path==='/api/enrollment/urgent-notify'){
  demand(method==='POST',405);demand(await limit(request,'urgent'),429,'Đã đạt giới hạn yêu cầu ưu tiên hôm nay.');const row=data(await own());demand(row?.status==='pending',409,'Hồ sơ không ở trạng thái chờ duyệt.');demand(!row.urgent_notified_at||Date.now()-row.urgent_notified_at>=1800000,429,'Vui lòng đợi 30 phút giữa các lần yêu cầu.');const event=data(await db.rpc('ltch_enrollment_urgent',{p_id:row.id,p_actor:actor.uid}));return json({ok:true,notificationStatus:await deliverNotification(db,env,event)});
 }
 if(path==='/api/admin/enrollments'){
  demand(method==='GET',405);const classIds=actor.memberships.filter(m=>m.member_role==='teacher').map(m=>m.class_id);demand(isAdmin(actor)||actor.status==='active'&&actor.roles.includes('teacher')&&classIds.length);
  let q=db.from('ltch_enrollment_requests').select('*').in('status',['pending','needs_revision']).order('created_at').limit(200);if(!isAdmin(actor))q=q.in('class_id',classIds);const rows=data(await q),classes=data(await db.from('ltch_classes').select('id,name'));return json({items:rows.map(r=>({...map(r),className:classes.find(c=>c.id===r.class_id)?.name}))});
 }
 if(path==='/api/admin/enrollments/review'||path==='/api/admin/enrollments/notify'){
  demand(method==='POST',405);const b=await readJson(request);const row=data(await db.from('ltch_enrollment_requests').select('*').eq('id',id(b.requestId)).maybeSingle());demand(row&&canReviewEnrollment(actor,row.class_id));
  if(path.endsWith('/notify')){const jobs=data(await db.from('ltch_mail_outbox').select('id').eq('request_id',row.id).neq('status','sent').limit(5));const statuses=[];for(const j of jobs)statuses.push(await deliverNotification(db,env,j.id));return json({ok:true,notificationStatus:statuses.every(s=>s==='sent')?'sent':'pending'});}
  demand(Number.isInteger(b.version)&&b.version===row.version,409,'Hồ sơ đã được cập nhật. Hãy tải lại danh sách.');demand(['approve','request_revision','reject'].includes(b.action),400);
  if(b.action==='approve'){const destination=data(await db.from('ltch_classes').select('id').eq('id',id(b.classId||row.class_id)).eq('archived',false).maybeSingle());demand(destination,400,'Lớp đã lưu trữ hoặc không tồn tại.');}
  const event=data(await db.rpc('ltch_review_enrollment',{p_id:row.id,p_actor:actor.uid,p_version:b.version,p_action:b.action,p_class:b.classId||row.class_id,p_child:b.childUid||'',p_notes:string(b.adminNotes||'',2000,b.action!=='request_revision')}));
  return json({ok:true,notificationStatus:b.action==='reject'?'none':await deliverNotification(db,env,event)});
 }
 demand(false,404,'Không tìm thấy chức năng.');
}
