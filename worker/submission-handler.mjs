import { applicationSession, readFormData } from './http.mjs';
import submissionsModule from '../server/domain/submissions.cjs';
import storageModule from '../server/integrations/supabase-storage.cjs';
import {
  SUBMISSION_ALLOWED_TYPES,
  SUBMISSION_MAX_FILES,
  SUBMISSION_MAX_FILE_BYTES,
  SUBMISSION_MAX_TOTAL_BYTES,
  SUBMISSION_MAX_NOTE_LENGTH,
  normalizeSubmissionMimeType,
  sanitizeSubmissionFileName
} from '../shared/submission-metadata.mjs';
const {createSubmissionService}=submissionsModule, {createSupabaseStorage}=storageModule;
const json=(v,status)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
class SubmissionValidationError extends Error { constructor(status, message){ super(message); this.status=status; } }
async function readLimited(stream,max) {
 if (!stream) throw new TypeError('Missing file');
 const reader=stream.getReader();let size=0;const chunks=[];
 try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new RangeError('File too large');}chunks.push(value);} }
 finally {reader.releaseLock();}
 const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out;
}
export function createSubmissionHandler({auth,repository,storage,clock}) {
 const service=createSubmissionService({repository,storage,clock,authorize:async(actor,assignment)=>actor.roles.includes('student') && actor.memberships.some(m=>m.class_id===assignment.classId && m.member_role==='student')});
 return async function handle(request,assignmentId) {
  try {
   const token=applicationSession(request);
   const session=await auth.authenticate(token);if(!session)return json({error:'Vui lòng đăng nhập.'},401);
   const actor=await repository.actor(session.uid);if(!actor)return json({error:'Không có quyền truy cập.'},403);
   const assignment=await repository.getAssignment(assignmentId);
   if(!assignment || assignment.status!=='published' || !actor.roles.includes('student') || !actor.memberships.some(m=>m.class_id===assignment.classId && m.member_role==='student')) return json({error:'Không có quyền truy cập.'},403);
   const contentType=String(request.headers.get('content-type')||'').trim();
   if(contentType.toLowerCase().startsWith('multipart/form-data')) {
    const length=Number(request.headers.get('content-length')||0);
    if(!Number.isFinite(length)||length>SUBMISSION_MAX_TOTAL_BYTES+512_000)return json({error:'Tổng dung lượng bài nộp quá lớn (tối đa 25 MB).'},413);
    const form=await readFormData(request,SUBMISSION_MAX_TOTAL_BYTES+512_000);
    const rawEntries=[...form.getAll('files'),...form.getAll('file')].filter(entry=>entry&&typeof entry.arrayBuffer==='function'&&entry.size>0);
    if(!rawEntries.length)throw new SubmissionValidationError(400,'Vui lòng chọn ít nhất 1 tệp bài làm (ảnh JPG, PNG, WebP hoặc PDF).');
    if(rawEntries.length>SUBMISSION_MAX_FILES)throw new SubmissionValidationError(400,`Chỉ được đính kèm tối đa ${SUBMISSION_MAX_FILES} tệp trong mỗi lần nộp.`);
    const rawNote=form.get('note');
    const note=typeof rawNote==='string'?rawNote.trim():'';
    if(note.length>SUBMISSION_MAX_NOTE_LENGTH)throw new SubmissionValidationError(400,`Ghi chú nộp bài tối đa ${SUBMISSION_MAX_NOTE_LENGTH} ký tự.`);
    const parsedFiles=[];
    let totalSize=0;
    for(let i=0;i<rawEntries.length;i++) {
     const entry=rawEntries[i];
     if(entry.size>SUBMISSION_MAX_FILE_BYTES)throw new SubmissionValidationError(413,'Mỗi tệp tải lên tối đa 10 MB.');
     const mime=normalizeSubmissionMimeType(entry.type,entry.name);
     if(!mime)throw new SubmissionValidationError(400,'Chỉ hỗ trợ tệp định dạng ảnh (JPG, PNG, WebP) hoặc PDF.');
     const bytes=new Uint8Array(await entry.arrayBuffer());
     if(!bytes.byteLength||bytes.byteLength>SUBMISSION_MAX_FILE_BYTES)throw new SubmissionValidationError(413,'Mỗi tệp tải lên tối đa 10 MB.');
     totalSize+=bytes.byteLength;
     if(totalSize>SUBMISSION_MAX_TOTAL_BYTES)throw new SubmissionValidationError(413,'Tổng dung lượng các tệp tối đa 25 MB.');
     parsedFiles.push({
      bytes,
      contentType:mime,
      name:sanitizeSubmissionFileName(entry.name,SUBMISSION_ALLOWED_TYPES[mime],i)
     });
    }
    const result=await service.submit({actor,assignmentId,files:parsedFiles,note});
    return json(result,201);
   }
   const length=Number(request.headers.get('content-length')||0);if(!Number.isFinite(length)||length>10_000_000)return json({error:'Tệp quá lớn.'},413);
   const bytes=await readLimited(request.body,10_000_000);
   const result=await service.submit({actor,assignmentId,bytes,contentType});
   return json(result,201);
  } catch(err) {
   if(err instanceof SubmissionValidationError)return json({error:err.message},err.status);
   if(err instanceof RangeError)return json({error:'Tổng dung lượng bài nộp quá lớn.'},413);
   return json({error:'Không thể nộp bài. Vui lòng kiểm tra tệp và thử lại.'},400);
  }
 };
}
export function configuredStorage(env){return createSupabaseStorage({projectUrl:env.SUPABASE_URL,secretKey:env.SUPABASE_SECRET});}


