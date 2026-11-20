export class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
export const demand=(ok,status=403,message='Không có quyền truy cập.')=>{if(!ok)throw new ApiError(status,message);};
export const isAdmin=a=>a?.status==='active' && a.roles.includes('admin');
export const accountProfile=a=>({uid:a.uid,name:a.name,roles:a.roles,memberships:a.memberships||[],childMemberships:a.childMemberships||[],...(a.studentCode?{studentCode:a.studentCode}:{})});
export function staffCan(a,classId,action){return isAdmin(a)||a?.status==='active' && a.memberships.some(m=>m.class_id===classId && a.roles.includes(m.member_role) && (m.member_role==='teacher'||m.member_role==='assistant' && (!action || m.permissions?.includes(action))));}
export function classCanRead(a,classId){return isAdmin(a)||a?.status==='active'&&(a.memberships.some(m=>m.class_id===classId && a.roles.includes(m.member_role))||a.roles.includes('parent')&&a.childMemberships?.some(m=>m.class_id===classId));}
export function studentScope(a,classId){if(staffCan(a,classId))return null;const own=a.roles.includes('student')&&a.memberships.some(m=>m.class_id===classId&&m.member_role==='student')?[a.uid]:[];const children=a.roles.includes('parent')?(a.childMemberships||[]).filter(m=>m.class_id===classId).map(m=>m.uid):[];return [...new Set([...own,...children])];}
export const id=value=>{demand(typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value),400,'Mã không hợp lệ.');return value;};
export const string=(value,max,empty=false)=>{demand(typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0),400,'Nội dung không hợp lệ.');return value.trim();};
export const timestamp=value=>{demand(Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000,400,'Thời gian không hợp lệ.');return value;};
export const data=r=>{
 if(r.error){
  const message=String(r.error.message||'');
  if(message.includes('LTCH_ENROLLMENT_CONFLICT'))throw new ApiError(409,'Hồ sơ hoặc lớp vừa thay đổi. Hãy tải lại.');
  if(message.includes('LTCH_EXAM_CONFLICT'))throw new ApiError(409,'Đề thi vừa thay đổi. Hãy tải lại.');
  if(message.includes('LTCH_CLASS_NOT_FOUND'))throw new ApiError(404,'Không tìm thấy lớp học.');
  if(message.includes('LTCH_CLASS_NOT_ARCHIVED'))throw new ApiError(400,'Chỉ được xóa lớp đã nằm trong kho lưu trữ.');
  if(message.includes('LTCH_STUDENT_CODE_GRADE'))throw new ApiError(400,'Không xác định được khối lớp để cấp mã học sinh. Hãy kiểm tra tên lớp.');
  if(message.includes('LTCH_STUDENT_CODE_EXHAUSTED'))throw new ApiError(409,'Đã hết mã học sinh cho khóa này. Vui lòng liên hệ quản trị viên.');
  if(message.includes('LTCH_GLOBAL_TEACHER_MEMBERSHIP'))throw new ApiError(409,'Giáo viên đang hoạt động được phân công tự động vào tất cả lớp đang mở.');
  if(message.includes('LTCH_GLOBAL_ASSISTANT_MEMBERSHIP'))throw new ApiError(409,'Trợ giảng đang hoạt động được phân công tự động vào tất cả lớp đang mở.');
  console.error('LTCH_DB_ERROR',{code:String(r.error.code||''),reason:message.replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+|(?:Bearer|Session)\s+\S+|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[^\s@]+@[^\s@]+\.[^\s@]+/g,'[redacted]').slice(0,180)});
  throw new ApiError(503,'Không thể lưu hoặc đọc dữ liệu. Vui lòng thử lại.');
 }
 return r.data;
};
