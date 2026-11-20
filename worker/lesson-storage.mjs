import {randomUUID} from 'node:crypto';
import {ApiError,demand,data,id,string,isAdmin} from './policy.mjs';
import {readBytes,readFormData,readJson,json} from './http.mjs';
import {createGoogleDrive,DriveError,validateDriveResumableSessionUrl} from './google-drive.mjs';
import {refreshGoogleAccessToken,GoogleAuthorizationError} from './google-oauth.mjs';
import {ensureDriveFolder} from './drive-folders.mjs';
import {matchesDriveFile,requireAllowedSharing,enableLinkSharing,drivePreviewUrl} from './drive-preview.mjs';
import {sealVideoStreamTicket,buildVideoStreamUrl} from './video-stream.mjs';
import {resolveDriveOwnerEmail,resolveSiteOrigin} from './config.mjs';
import {configuredStorage} from './submission-handler.mjs';
import {sortClasses,decodeSessionTopicMeta,encodeSessionTopicMeta,DEFAULT_COURSE_SESSIONS_COUNT,generateScheduleDates,lessonSessionId,formatSessionLessonTitle,isPracticeSolutionLesson,isExplicitOrPopulatedSession,decodeAssignmentSessionInstructions} from '../shared/classroom.mjs';

const maxDocumentUploadBytes=100*1024*1024;
const maxVideoUploadBytes=5*1024*1024*1024;
async function readChunkStream(request,max){
 return readBytes(request,max);
}
const textEncoder=new TextEncoder(),textDecoder=new TextDecoder();
function b64urlEncode(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function b64urlDecode(value){
 demand(typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value)&&value.length<=24000,400,'Phiên tải tệp không hợp lệ.');
 try{const s=atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4));return Uint8Array.from(s,c=>c.charCodeAt(0));}
 catch{throw new ApiError(400,'Phiên tải tệp không hợp lệ.');}
}
async function driveUploadKey(env){
 const raw=env?.MAIL_SECRET;
 demand(typeof raw==='string'&&raw.length>=32,503,'Dịch vụ tải tệp chưa được cấu hình an toàn.');
 const digest=await crypto.subtle.digest('SHA-256',textEncoder.encode(`ltch:drive-resumable:v1:${raw}`));
 return crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
}
export async function sealDriveUploadToken(env,{classId,lessonId,fileId,actorId,payload,purpose='ltch-drive-video-v1'}){
 const key=await driveUploadKey(env),iv=crypto.getRandomValues(new Uint8Array(12));
 const aad=textEncoder.encode(JSON.stringify([purpose,classId,lessonId,fileId,actorId]));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,textEncoder.encode(JSON.stringify(payload)));
 return `v1.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(cipher))}`;
}
export async function openDriveUploadToken(env,{token,classId,lessonId,fileId,actorId,purpose='ltch-drive-video-v1'}){
 demand(typeof token==='string',400,'Phiên tải tệp không hợp lệ.');
 const parts=token.split('.');demand(parts.length===3&&parts[0]==='v1',400,'Phiên tải tệp không hợp lệ.');
 const iv=b64urlDecode(parts[1]);demand(iv.length===12,400,'Phiên tải tệp không hợp lệ.');
 const aad=textEncoder.encode(JSON.stringify([purpose,classId,lessonId,fileId,actorId]));
 try{
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},await driveUploadKey(env),b64urlDecode(parts[2]));
  const parsed=JSON.parse(textDecoder.decode(plain));
  parsed.sessionUrl=validateDriveResumableSessionUrl(parsed.sessionUrl);
  return parsed;
 }catch{throw new ApiError(400,'Phiên tải tệp không hợp lệ hoặc đã hết hạn.');}
}

let cachedDriveAuth=null;
export function clearCachedDriveAuth(){cachedDriveAuth=null;}
export async function configuredDrive(env){
 const cacheKey=`${env.GOOGLE_DRIVE_CLIENT_ID||''}:${(env.GOOGLE_DRIVE_REFRESH_TOKEN||'').slice(-16)}`;
 const now=Date.now();
 if(cachedDriveAuth&&cachedDriveAuth.key===cacheKey&&cachedDriveAuth.expiresAt>now){
  return cachedDriveAuth.drive;
 }
 const token=await refreshGoogleAccessToken({clientId:env.GOOGLE_DRIVE_CLIENT_ID,clientSecret:env.GOOGLE_DRIVE_CLIENT_SECRET,refreshToken:env.GOOGLE_DRIVE_REFRESH_TOKEN});
 const drive=createGoogleDrive({accessToken:token.accessToken,ownerEmail:resolveDriveOwnerEmail(env)});await drive.verifyOwner();
 cachedDriveAuth={key:cacheKey,drive,expiresAt:now+Math.max(60_000,(Number(token.expiresIn||3600)-300)*1000)};
 return drive;
}
export const folderName=(label,identifier)=>`${String(label).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,100)} [${identifier}]`;
export function lessonFolderName(lesson){
 const sesMatch=/^ses-[A-Za-z0-9_-]+-(\d{2,3})$/i.exec(String(lesson?.id||''));
 if(sesMatch){
  const parsed=decodeSessionTopicMeta(lesson?.topic||'',lesson?.title||'');
  const num=Number(sesMatch[1]);
  const label=parsed.lessonName?`Buổi ${num} - ${parsed.lessonName}`:`Buổi ${num}`;
  return folderName(label,lesson.id);
 }
 return folderName(lesson.title,lesson.id);
}
function contentType(value){return typeof value==='string'&&/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value)&&value.length<=127&&!value.toLowerCase().startsWith('application/vnd.google-apps.')?value:'application/octet-stream';}
async function classFolder(db,drive,classId){
 const klass=data(await db.from('ltch_classes').select('id,name,school_year_id').eq('id',classId).maybeSingle());demand(klass,404,'Không tìm thấy lớp.');
 const year=data(await db.from('ltch_school_years').select('id,name').eq('id',klass.school_year_id).maybeSingle());demand(year,503,'Không tìm thấy năm học.');
 const ensure=(key,parentId,name)=>ensureDriveFolder({db,drive,key,parentId,name});
 let parent=await ensure('ltch-root',await drive.rootId(),'Lớp Toán cô Hạnh');
 parent=await ensure(`year:${id(year.id)}`,parent,folderName(year.name,year.id));
 return ensure(`class:${id(classId)}`,parent,folderName(klass.name,classId));
}
async function folders(db,drive,classId,lesson){
 const parent=await classFolder(db,drive,classId);
 return ensureDriveFolder({db,drive,key:`lesson:${id(lesson.id)}`,parentId:parent,name:lessonFolderName(lesson)});
}
export async function ensureAssignmentDriveFolder({db,drive,classId,assignment}){
 let parent=await classFolder(db,drive,classId);
 const decoded=decodeAssignmentSessionInstructions(assignment?.instructions||'');
 const targetLessonId=decoded.lessonId||(decoded.sessionNumber?lessonSessionId(classId,decoded.sessionNumber):null);
 if(targetLessonId){
  const lesson=data(await db.from('ltch_lessons').select('id,title,topic').eq('id',id(targetLessonId)).eq('class_id',classId).maybeSingle());
  if(lesson){
   parent=await ensureDriveFolder({db,drive,key:`lesson:${id(lesson.id)}`,parentId:parent,name:lessonFolderName(lesson)});
  }
 }
 return ensureDriveFolder({db,drive,key:`assignment:${id(assignment.id)}`,parentId:parent,name:folderName(assignment.title||'Bài tập',assignment.id)});
}
async function resolveLessonUploadParent({db,drive,classId,lesson,assignmentId}){
 if(!assignmentId)return folders(db,drive,classId,lesson);
 const assignment=data(await db.from('ltch_assignments').select('id,class_id,title,instructions').eq('id',id(assignmentId)).eq('class_id',classId).maybeSingle());
 demand(assignment,404,'Không tìm thấy bài tập.');
 return ensureAssignmentDriveFolder({db,drive,classId,assignment});
}
export async function uploadStudentSubmissionToDrive({db,env,actor,assignment,submissionId,bytes,contentType:mimeType,fileName='',fileIndex=0,fileCount=1,openDrive=configuredDrive}){
 const drive=await openDrive(env);
 const assignFolderId=await ensureAssignmentDriveFolder({db,drive,classId:assignment.classId,assignment});
 const studentFolderId=await ensureDriveFolder({db,drive,key:`sub:${id(assignment.id)}:${id(actor.uid)}`,parentId:assignFolderId,name:folderName(actor.name||actor.uid,actor.uid)});
 const ext={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mimeType]||'bin';
 const safeActor=String(actor.name||'Hoc sinh').replace(/[\u0000-\u001f\u007f/\\]/g,' ').trim().slice(0,80)||'Hoc sinh';
 const rawBase=String(fileName||'').replace(/\.[^.]{1,10}$/,'').replace(/[\u0000-\u001f\u007f/\\"']/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
 const shortId=String(submissionId||'').slice(0,8);
 const resolvedName=(fileCount>1||rawBase)
  ? `${safeActor}_${shortId}_${String(Number(fileIndex)+1).padStart(2,'0')}${rawBase?`_${rawBase}`:''}.${ext}`
  : `${safeActor}_${submissionId}.${ext}`;
 const cleanDriveName=safeName(resolvedName);
 const driveId=await drive.reserveId();
 const sha256=await fingerprint(bytes);
 await drive.upload({id:driveId,parentId:studentFolderId,name:cleanDriveName,contentType:mimeType,bytes,sha256});
 return {size:bytes.byteLength,objectPath:`drive:${driveId}`};
}
export async function downloadSubmissionFromDrive({env,driveFileId,openDrive=configuredDrive}){
 const drive=await openDrive(env);
 return drive.download({id:driveFileId});
}
function safeName(value){const name=string(value,250);demand(!/[\u0000-\u001f\u007f/\\]/.test(name),400,'Tên tệp không hợp lệ.');return name;}
function fingerprint(bytes){return crypto.subtle.digest('SHA-256',bytes).then(d=>[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join(''));}

// The caller authorizes the actor and the lesson before entering either method.
export async function uploadLessonFile(request,{db,actor,env,classId,lesson,openDrive=configuredDrive}){
 if(request.headers.get('content-type')?.startsWith('application/json')){
  return startResumableLessonFile(request,{db,actor,env,classId,lesson,openDrive});
 }
 const form=await readFormData(request,10_050_000),file=form.get('file'),requestId=id(form.get('requestId'));
 demand(requestId.length>=16,400,'Mã tải tệp không hợp lệ.');
 demand(file&&typeof file.arrayBuffer==='function'&&file.size>0&&file.size<=10_000_000,400,'Chọn tệp tối đa 10 MB.');
 const name=safeName(file.name),type=contentType(file.type),bytes=new Uint8Array(await file.arrayBuffer()),sha256=await fingerprint(bytes);
 const reqUrl=new URL(request.url);
 const assignmentId=String(reqUrl.searchParams.get('assignmentId')||form.get('assignmentId')||'').trim();
 let stage='authorization';
 try{
  const drive=await openDrive(env);stage='folders';const parent=await resolveLessonUploadParent({db,drive,classId,lesson,assignmentId});stage='record';
  const read=async()=>data(await db.from('ltch_lesson_files').select('*').eq('lesson_id',lesson.id).eq('created_by',actor.uid).eq('request_id',requestId).maybeSingle());
  let record=await read();
  if(!record){
   const driveId=await drive.reserveId();
   data(await db.from('ltch_lesson_files').upsert({id:randomUUID(),lesson_id:lesson.id,class_id:classId,name,drive_file_id:driveId,content_type:type,file_size:bytes.byteLength,sha256,request_id:requestId,status:'pending',created_by:actor.uid,created_at:Date.now()},{onConflict:'lesson_id,created_by,request_id',ignoreDuplicates:true}));
   record=await read();
  }
  demand(record&&record.class_id===classId&&record.name===name&&record.content_type===type&&record.file_size===bytes.byteLength&&record.sha256===sha256,409,'Mã tải tệp đã được dùng cho nội dung khác.');
  const alreadyStored=record.status==='stored';
  if(!alreadyStored){
   stage='upload';try{await drive.upload({id:record.drive_file_id,parentId:parent,name,contentType:type,bytes,sha256});}
   catch(error){if(error.code!=='conflict')throw error;}
  }
  stage='verify';const metadata=await drive.metadata({id:record.drive_file_id});
  const isVideo=/^video\//i.test(type);
  if(env.LTCH_DRIVE_LINK_PREVIEW==='1'||isVideo)await enableLinkSharing(drive,metadata,record,{parentId:parent});
  else await requireAllowedSharing(drive,metadata,record,{parentId:parent});
  if(!alreadyStored)data(await db.from('ltch_lesson_files').update({status:'stored'}).eq('id',record.id).eq('class_id',classId));
  return json({id:record.id},alreadyStored?200:201);
 }catch(error){
  if(error instanceof ApiError)throw error;
  // Only bounded internal categories are exposed to the admin during pilot;
  // provider responses, IDs and credentials are never included.
  const code=error instanceof GoogleAuthorizationError||error instanceof DriveError?error.code:'unexpected';
  const safeCode=/^[a-z_]{1,50}$/.test(code)?code:'unexpected';
  console.error('LTCH_DRIVE_UPLOAD_FAILED',{stage,code:safeCode});
  const detail=env.LTCH_LESSONS_AUDIENCE!=='all'&&isAdmin(actor)?` (kiểm thử: ${stage}/${safeCode})`:'';
  throw new ApiError(503,`Không thể lưu tệp vào Drive${detail}. Hãy thử lại với cùng mã tải tệp.`);
 }
}

export async function startResumableLessonFile(request,{db,actor,env,classId,lesson,openDrive=configuredDrive}){
 const body=await readJson(request,8192);
 const requestId=id(body.requestId);
 demand(requestId.length>=16,400,'Mã tải tệp không hợp lệ.');
 const name=safeName(body.name);
 const isVideoLecture=Boolean(body.isVideoLecture);
 const type=contentType(body.contentType||(isVideoLecture?'video/mp4':'application/octet-stream'));
 const isVideoMime=/^video\/[a-z0-9!#$&^_.+-]+$/i.test(type);
 if(isVideoLecture)demand(isVideoMime,400,'Chọn tệp video hợp lệ (tối đa 5 GB).');
 const maxAllowedBytes=isVideoMime?maxVideoUploadBytes:maxDocumentUploadBytes;
 const total=Number(body.size);
 demand(Number.isSafeInteger(total)&&total>=1&&total<=maxAllowedBytes,400,isVideoMime?'Chọn tệp video hợp lệ (tối đa 5 GB).':'Chọn tệp tài liệu hợp lệ (tối đa 100 MB).');
 const sha256=String(body.sha256||'').trim().toLowerCase();
 demand(/^[a-f0-9]{64}$/.test(sha256),400,'Mã kiểm tra tệp không hợp lệ.');
 const dbFileSize=Math.min(total,10_000_000);
 const reqUrl=new URL(request.url);
 const assignmentId=String(body.assignmentId||reqUrl.searchParams.get('assignmentId')||'').trim();
 let stage='authorization';
 try{
  const drive=await openDrive(env);stage='folders';const parent=await resolveLessonUploadParent({db,drive,classId,lesson,assignmentId});stage='record';
  const read=async()=>data(await db.from('ltch_lesson_files').select('*').eq('lesson_id',lesson.id).eq('created_by',actor.uid).eq('request_id',requestId).maybeSingle());
  let record=await read();
  if(!record){
   const driveId=await drive.reserveId();
   data(await db.from('ltch_lesson_files').upsert({id:randomUUID(),lesson_id:lesson.id,class_id:classId,name,drive_file_id:driveId,content_type:type,file_size:dbFileSize,sha256,request_id:requestId,status:'pending',created_by:actor.uid,created_at:Date.now()},{onConflict:'lesson_id,created_by,request_id',ignoreDuplicates:true}));
   record=await read();
  }else if(record.status!=='stored'&&record.class_id===classId&&record.name===name){
   const freshDriveId=await drive.reserveId();
   data(await db.from('ltch_lesson_files').update({drive_file_id:freshDriveId,content_type:type,file_size:dbFileSize,sha256,status:'pending'}).eq('id',record.id).eq('class_id',classId));
   record={...record,drive_file_id:freshDriveId,content_type:type,file_size:dbFileSize,sha256,status:'pending'};
  }
  demand(record&&record.class_id===classId&&record.name===name&&record.content_type===type&&record.file_size===dbFileSize&&record.sha256===sha256,409,'Mã tải tệp đã được dùng cho nội dung khác.');
  if(record.status==='stored'){
   return json({id:record.id,state:'uploaded',totalSize:total,chunkSize:8*1024*1024},200);
  }
  stage='session';
  const reqOrigin=request.headers.get('origin')||resolveSiteOrigin(env);
  const sessionUrl=await drive.startResumableUpload({id:record.drive_file_id,parentId:parent,name,contentType:type,total,sha256,origin:reqOrigin});
  const uploadToken=await sealDriveUploadToken(env,{
   classId,
   lessonId:lesson.id,
   fileId:record.id,
   actorId:actor.uid,
   payload:{sessionUrl,driveFileId:record.drive_file_id,parentId:parent,total,contentType:type,sha256,isVideoLecture}
  });
  return json({id:record.id,uploadToken,sessionUrl,chunkSize:8*1024*1024,totalSize:total},201);
 }catch(error){
  if(error instanceof ApiError)throw error;
  const code=error instanceof GoogleAuthorizationError||error instanceof DriveError?error.code:'unexpected';
  const safeCode=/^[a-z_]{1,50}$/.test(code)?code:'unexpected';
  console.error('LTCH_DRIVE_RESUMABLE_START_FAILED',{stage,code:safeCode});
  throw new ApiError(503,'Không thể khởi tạo phiên tải tệp lên Google Drive. Vui lòng thử lại.');
 }
}

export async function uploadLessonFileChunk(request,{db,actor,env,classId,lessonId,fileId,openDrive=configuredDrive}){
 let uploadTokenStr='',isStatusQuery=false,offset=0,bytes=null;
 const reqUrl=new URL(request.url);
 const reqType=(request.headers.get('content-type')||'').toLowerCase();
 if(reqUrl.searchParams.has('uploadToken')||reqType.startsWith('application/octet-stream')){
  uploadTokenStr=String(reqUrl.searchParams.get('uploadToken')||'');
  isStatusQuery=reqUrl.searchParams.get('status')==='1';
  if(!isStatusQuery){
   offset=Number(reqUrl.searchParams.get('offset'));
   bytes=await readChunkStream(request,8_600_000);
   demand(bytes&&bytes.byteLength>0,400,'Thiếu dữ liệu tải lên.');
  }
 }else if(reqType.startsWith('application/json')){
  const body=await readJson(request,8192);
  uploadTokenStr=String(body.uploadToken||'');
  isStatusQuery=body.status==='1'||body.status===true;
 }else{
  const form=await readFormData(request,8_600_000);
  uploadTokenStr=String(form.get('uploadToken')||'');
  isStatusQuery=form.get('status')==='1';
  if(!isStatusQuery){
   offset=Number(form.get('offset'));
   const chunkFile=form.get('chunk');
   demand(chunkFile&&typeof chunkFile.arrayBuffer==='function'&&chunkFile.size>0,400,'Thiếu dữ liệu tải lên.');
   bytes=new Uint8Array(await chunkFile.arrayBuffer());
  }
 }
 const payload=await openDriveUploadToken(env,{
  token:uploadTokenStr,
  classId,
  lessonId,
  fileId:id(fileId),
  actorId:actor.uid
 });
 const record=data(await db.from('ltch_lesson_files').select('*').eq('id',id(fileId)).eq('lesson_id',lessonId).eq('class_id',classId).maybeSingle());
 demand(record,404,'Không tìm thấy phiên tải tệp.');
 if(record.status==='stored'){
  return json({state:'uploaded',id:record.id,offset:payload.total});
 }
 try{
  const drive=await openDrive(env);
  let metadata=null;
  if(isStatusQuery){
   try{metadata=await drive.metadata({id:payload.driveFileId});}catch(err){if(err?.code!=='not_found')throw err;}
   if(!metadata||!matchesDriveFile(metadata,record,payload.parentId)){
    const result=await drive.uploadResumableChunk({sessionUrl:payload.sessionUrl,total:payload.total,id:payload.driveFileId,offset:0,bytes:null,contentType:payload.contentType});
    if(result.state==='uploading')return json(result);
    metadata=await drive.metadata({id:record.drive_file_id});
   }
  }else{
   demand(Number.isSafeInteger(offset)&&offset>=0&&offset<payload.total,400,'Vị trí đoạn dữ liệu không hợp lệ.');
   const result=await drive.uploadResumableChunk({sessionUrl:payload.sessionUrl,total:payload.total,id:payload.driveFileId,offset,bytes,contentType:payload.contentType});
   bytes=null;
   if(result.state==='uploading')return json(result);
   metadata=await drive.metadata({id:record.drive_file_id});
  }
  const isVideo=/^video\//i.test(record.content_type);
  if(env.LTCH_DRIVE_LINK_PREVIEW==='1'||isVideo)await enableLinkSharing(drive,metadata,record,{parentId:payload.parentId});
  else await requireAllowedSharing(drive,metadata,record,{parentId:payload.parentId});
  data(await db.from('ltch_lesson_files').update({status:'stored'}).eq('id',record.id).eq('class_id',classId));
  if(payload.isVideoLecture){
   const lessonRow=data(await db.from('ltch_lessons').select('id,title,topic').eq('id',lessonId).eq('class_id',classId).maybeSingle());
   if(lessonRow){
    const rawTopic=String(lessonRow.topic||'');
    let nextTopic;
    if(/(?:^|\s)\|\|s:\d{1,3}\|d:/.test(rawTopic)){
     const meta=decodeSessionTopicMeta(rawTopic,lessonRow.title||'');
     nextTopic=encodeSessionTopicMeta({...meta,driveVideoFileId:record.id});
    }else{
     const baseTopic=rawTopic.replace(/(?:^|[\s·|—–\-:;]+)drive-video:[A-Za-z0-9_-]+/gi,'').trim();
     nextTopic=(baseTopic?`${baseTopic} · drive-video:${record.id}`:`drive-video:${record.id}`).slice(0,200);
    }
    data(await db.from('ltch_lessons').update({topic:nextTopic}).eq('id',lessonId).eq('class_id',classId));
   }
  }
  return json({state:'uploaded',id:record.id,offset:payload.total});
 }catch(error){
  if(error instanceof ApiError)throw error;
  throw new ApiError(503,'Không thể gửi đoạn dữ liệu lên Google Drive. Vui lòng thử lại.');
 }
}

export async function downloadLessonFile({db,env,classId,lessonId,fileId,openDrive=configuredDrive}){
 const record=data(await db.from('ltch_lesson_files').select('*').eq('id',id(fileId)).eq('lesson_id',lessonId).eq('class_id',classId).maybeSingle());
 demand(record&&record.status==='stored',404,'Không tìm thấy tài liệu.');
 try{
  const drive=await openDrive(env),meta=await drive.metadata({id:record.drive_file_id});
  const isVideo=/^video\//i.test(String(record.content_type||''));
  await requireAllowedSharing(drive,meta,record,{allowLink:env.LTCH_DRIVE_LINK_PREVIEW==='1'||isVideo});
  const upstream=await drive.download({id:record.drive_file_id});
  const encoded=encodeURIComponent(record.name).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(upstream.body,{headers:{'content-type':'application/octet-stream','content-disposition':`attachment; filename="document"; filename*=UTF-8''${encoded}`,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
 }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(503,'Không thể tải tệp từ Drive.');}
}

// Caller checks class access, feature availability and administrator rights for writes.
export async function previewLessonFile({db,env,classId,lessonId,fileId,enable=false,openDrive=configuredDrive}){
 const record=data(await db.from('ltch_lesson_files').select('*').eq('id',id(fileId)).eq('lesson_id',lessonId).eq('class_id',classId).maybeSingle());
 const isVideo=Boolean(record&&/^video\//i.test(String(record.content_type||'')));
 demand(env.LTCH_DRIVE_LINK_PREVIEW==='1'||isVideo,404,'Chức năng chưa sẵn sàng.');
 demand(record&&record.status==='stored',404,'Không tìm thấy tài liệu.');
 try{
  const drive=await openDrive(env),meta=await drive.metadata({id:record.drive_file_id});
  if(enable||isVideo)await enableLinkSharing(drive,meta,record);
  else await requireAllowedSharing(drive,meta,record,{allowLink:true,requireLink:true});
  return json({url:drivePreviewUrl(record.drive_file_id)});
 }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(503,'Không thể xác minh quyền xem tài liệu trên Drive.');}
}

export async function streamLessonVideo({request,db,actor,env,classId,lessonId,fileId,openDrive=configuredDrive}){
 const record=data(await db.from('ltch_lesson_files').select('*').eq('id',id(fileId)).eq('lesson_id',lessonId).eq('class_id',classId).maybeSingle());
 demand(record&&record.status==='stored',404,'Không tìm thấy tài liệu.');
 try{
  const drive=await openDrive(env),meta=await drive.metadata({id:record.drive_file_id});
  const recordMime=String(record.content_type||'').trim().toLowerCase();
  const metaMime=String(meta?.mimeType||'').trim().toLowerCase();
  const mimeType=/^video\/[a-z0-9!#$&^_.+-]+$/i.test(recordMime)?recordMime:/^video\/[a-z0-9!#$&^_.+-]+$/i.test(metaMime)?metaMime:'';
  demand(mimeType,400,'Tệp này không phải video bài giảng.');
  await requireAllowedSharing(drive,meta,record,{allowLink:true});
  const actualSize=Number(meta?.size||record.file_size);
  demand(Number.isSafeInteger(actualSize)&&actualSize>0,503,'Không thể xác định dung lượng video trên Drive.');
  const ticket=await sealVideoStreamTicket(env,{uid:actor.uid,driveFileId:record.drive_file_id,mimeType,size:actualSize});
  return json({url:buildVideoStreamUrl(env,request?.url,ticket),mimeType,size:actualSize,name:record.name});
 }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(503,'Không thể khởi tạo luồng phát video từ Drive.');}
}

export function hasDriveConfig(env,openDrive=configuredDrive){
 return Boolean(openDrive!==configuredDrive||(env?.GOOGLE_DRIVE_CLIENT_ID&&env?.GOOGLE_DRIVE_CLIENT_SECRET&&env?.GOOGLE_DRIVE_REFRESH_TOKEN));
}

export async function ensureSessionDriveFolder({db,env,classId,lesson,openDrive=configuredDrive}){
 const name=lessonFolderName(lesson);
 if(env?.LTCH_LESSONS_ENABLED==='0'||!hasDriveConfig(env,openDrive)){
  return {synced:false,driveFolderId:null,folderName:name};
 }
 const drive=await openDrive(env);
 const driveFolderId=await folders(db,drive,classId,lesson);
 return {synced:true,driveFolderId,folderName:name};
}

export async function trashDriveTargetsSafe({env,driveIds=[],openDrive=configuredDrive}){
 const uniqueIds=[...new Set((driveIds||[]).filter(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v)))];
 if(!uniqueIds.length||!hasDriveConfig(env,openDrive))return {trashed:0};
 const drive=await openDrive(env);
 if(typeof drive.trash!=='function')return {trashed:0};
 let trashed=0;
 for(const targetId of uniqueIds){
  try{
   await drive.trash({id:targetId});
   trashed++;
  }catch(err){
   if(err?.code!=='not_found')throw err;
  }
 }
 return {trashed};
}

export async function syncDriveWorkspace({db,env,openDrive=configuredDrive,openStorage=configuredStorage,forceVerify=false,verifyOffset=0,seedSessions=false,batchSize=0}){
 if(env?.LTCH_LESSONS_ENABLED==='0')return {synced:false,reason:'disabled'};
 const hasDrive=hasDriveConfig(env,openDrive);
 if(!hasDrive)return {synced:false,reason:'unconfigured'};
 const fileCols=forceVerify?'id,lesson_id,class_id,name,drive_file_id,content_type,file_size,sha256,status':'id,lesson_id';
 const [yearsRes,classesRes,foldersRes,materialsRes,lessonsRes,filesRes]=await Promise.all([
  db.from('ltch_school_years').select('id,name,starts_on').order('starts_on',{ascending:false}).limit(50),
  db.from('ltch_classes').select('id,name,school_year_id,schedule_slots,archived').limit(200),
  db.from('ltch_drive_folders').select('folder_key,drive_folder_id,parent_folder_id,folder_name').limit(5000),
  db.from('ltch_materials').select('*').eq('status','stored').order('created_at',{ascending:true}).limit(50),
  db.from('ltch_lessons').select('id,title,topic,class_id').limit(5000),
  db.from('ltch_lesson_files').select(fileCols).limit(2000)
 ]);
 const years=data(yearsRes)||[];
 const yearMap=new Map(years.map(y=>[y.id,y]));
 const rawClasses=data(classesRes)||[];
 const activeClasses=sortClasses(rawClasses.filter(c=>c.archived!==true));
 const existingFolders=data(foldersRes)||[];
 const folderMap=new Map(existingFolders.map(row=>[row.folder_key,row]));
 const materials=data(materialsRes)||[];
 const existingLessons=data(lessonsRes)||[];
 const existingFiles=data(filesRes)||[];
 let sessionsSeeded=0;
 if(seedSessions&&activeClasses.length){
  const existingLessonIds=new Set(existingLessons.map(l=>l.id));
  const adminRows=data(await db.from('ltch_accounts').select('uid').contains('roles',['admin']).eq('status','active').limit(1))||[];
  const defaultCreator=adminRows[0]?.uid||'system';
  const rowsToSeed=[];
  const now=Date.now();
  for(const klass of activeClasses){
   const startDate=yearMap.get(klass.school_year_id)?.starts_on||'2026-09-01';
   const generated=generateScheduleDates({
    scheduleSlots:klass.schedule_slots||[],
    startDate,
    count:DEFAULT_COURSE_SESSIONS_COUNT
   });
   for(const slot of generated){
    const lid=lessonSessionId(klass.id,slot.sessionNumber);
    if(existingLessonIds.has(lid))continue;
    existingLessonIds.add(lid);
    const title=formatSessionLessonTitle(slot.sessionNumber,'');
    const topic=encodeSessionTopicMeta({
     cleanTopic:'',
     sessionNumber:slot.sessionNumber,
     date:slot.date,
     start:slot.start||'',
     end:slot.end||'',
     customDate:false
    });
    const row={id:lid,class_id:klass.id,title,topic,created_by:defaultCreator,created_at:now+slot.sessionNumber};
    rowsToSeed.push(row);
    existingLessons.push(row);
   }
  }
  for(let i=0;i<rowsToSeed.length;i+=200){
   const chunk=rowsToSeed.slice(i,i+200);
   data(await db.from('ltch_lessons').upsert(chunk,{onConflict:'id'}));
   sessionsSeeded+=chunk.length;
  }
 }
 const fileLessonIds=new Set(existingFiles.map(f=>f.lesson_id).filter(Boolean));
 const nonVideoLessons=existingLessons.filter(l=>{
  if(isPracticeSolutionLesson(l))return false;
  if(/^ses-[A-Za-z0-9_-]+-(\d{2,3})$/i.test(String(l?.id||''))){
   return isExplicitOrPopulatedSession({meta:decodeSessionTopicMeta(l.topic,l.title),fileCount:fileLessonIds.has(l.id)?1:0});
  }
  return true;
 });
 const activeYearIds=new Set(activeClasses.map(c=>c.school_year_id));
 const activeYears=years.filter(y=>activeYearIds.has(y.id));
 const yearsToEnsure=activeYears.length?activeYears:years;
 const folderValid=(key,parentId,name)=>{
  const row=folderMap.get(key);
  return Boolean(row&&row.parent_folder_id===parentId&&row.folder_name===name);
 };
 const rootCached=folderMap.get('ltch-root');
 const missingRoot=!folderValid('ltch-root','root','Lớp Toán cô Hạnh');
 const missingYears=yearsToEnsure.filter(y=>!rootCached||!folderValid(`year:${id(y.id)}`,rootCached.drive_folder_id,folderName(y.name,y.id)));
 const missingClasses=activeClasses.filter(c=>{
  const yRow=folderMap.get(`year:${id(c.school_year_id)}`);
  return !yRow||!folderValid(`class:${id(c.id)}`,yRow.drive_folder_id,folderName(c.name,c.id));
 });
 const missingLessons=nonVideoLessons.filter(l=>{
  if(!activeClasses.some(c=>c.id===l.class_id))return false;
  const cRow=folderMap.get(`class:${id(l.class_id)}`);
  return !cRow||!folderValid(`lesson:${id(l.id)}`,cRow.drive_folder_id,lessonFolderName(l));
 });
 const totalMissing=(missingRoot?1:0)+missingYears.length+missingClasses.length+missingLessons.length;
 if(!forceVerify&&totalMissing===0&&materials.length===0){
  return {synced:true,sessionsSeeded,foldersEnsured:0,materialsMigrated:0,remainingFolders:0,remainingMaterials:0,classesCount:activeClasses.length,lessonsCount:nonVideoLessons.length,filesCount:existingFiles.length};
 }
 const drive=await openDrive(env);
 let ops=0,seen=0;
 const maxOps=batchSize>0?Math.min(60,Number(batchSize)):(forceVerify?4:6);
 const offset=Math.max(0,Number(verifyOffset)||0);
 const ensureCached=async(key,parentId,name)=>{
  const idx=seen++;
  if(!forceVerify&&folderValid(key,parentId,name))return folderMap.get(key).drive_folder_id;
  if(forceVerify&&idx<offset)return folderMap.get(key)?.drive_folder_id||null;
  if(ops>=maxOps)return folderMap.get(key)?.drive_folder_id||null;
  ops++;
  const driveId=await ensureDriveFolder({db,drive,key,parentId,name});
  folderMap.set(key,{folder_key:key,drive_folder_id:driveId,parent_folder_id:parentId,folder_name:name});
  return driveId;
 };
 const rootFolderId=await ensureCached('ltch-root',await drive.rootId(),'Lớp Toán cô Hạnh');
 if(!rootFolderId)return {synced:false,reason:'batch_limit'};
 const yearFolderIds=new Map();
 let foldersEnsured=missingRoot?1:0;
 for(const year of yearsToEnsure){
  const key=`year:${id(year.id)}`,expectedName=folderName(year.name,year.id);
  const wasCached=folderValid(key,rootFolderId,expectedName);
  const yId=await ensureCached(key,rootFolderId,expectedName);
  if(yId){
   yearFolderIds.set(year.id,yId);
   if(!wasCached)foldersEnsured++;
  }
 }
 const classFolderIds=new Map();
 for(const klass of activeClasses){
  const yId=yearFolderIds.get(klass.school_year_id)||folderMap.get(`year:${id(klass.school_year_id)}`)?.drive_folder_id;
  if(!yId)continue;
  const key=`class:${id(klass.id)}`,expectedName=folderName(klass.name,klass.id);
  const wasCached=folderValid(key,yId,expectedName);
  const cId=await ensureCached(key,yId,expectedName);
  if(cId){
   classFolderIds.set(klass.id,cId);
   if(!wasCached)foldersEnsured++;
  }
 }
 for(const lesson of nonVideoLessons){
  const parentFolderId=classFolderIds.get(lesson.class_id)||folderMap.get(`class:${id(lesson.class_id)}`)?.drive_folder_id;
  if(!parentFolderId)continue;
  const key=`lesson:${id(lesson.id)}`,expectedName=lessonFolderName(lesson);
  const wasCached=folderValid(key,parentFolderId,expectedName);
  const lId=await ensureCached(key,parentFolderId,expectedName);
  if(lId&&!wasCached)foldersEnsured++;
 }
 let filesRelinked=0;
 if(forceVerify){
  for(const f of existingFiles.filter(x=>x.status==='stored')){
   const idx=seen++;
   if(idx<offset||ops>=maxOps)continue;
   const lId=folderMap.get(`lesson:${id(f.lesson_id)}`)?.drive_folder_id;
   if(!lId)continue;
   ops++;
   let meta=null;
   try{meta=await drive.metadata({id:f.drive_file_id});}catch(e){if(e.code!=='not_found')throw e;}
   if(meta&&(!Array.isArray(meta.parents)||meta.parents[0]!==lId||meta.trashed===true)){
    const dl=await drive.download({id:f.drive_file_id});
    const bytes=new Uint8Array(await dl.arrayBuffer());
    const newDriveId=await drive.reserveId();
    const type=contentType(f.content_type||'application/pdf');
    await drive.upload({id:newDriveId,parentId:lId,name:safeName(f.name||'Tai-lieu.pdf'),contentType:type,bytes,sha256:f.sha256});
    const freshMeta=await drive.metadata({id:newDriveId});
    const updatedRecord={...f,drive_file_id:newDriveId,content_type:type,file_size:bytes.byteLength};
    if(env.LTCH_DRIVE_LINK_PREVIEW==='1')await enableLinkSharing(drive,freshMeta,updatedRecord,{parentId:lId});
    else await requireAllowedSharing(drive,freshMeta,updatedRecord,{parentId:lId});
    data(await db.from('ltch_lesson_files').update({drive_file_id:newDriveId}).eq('id',f.id).eq('class_id',f.class_id));
    filesRelinked++;
   }
  }
 }
 let materialsMigrated=0;
 if(materials.length>0&&ops<maxOps){
  const storage=openStorage(env);
  for(const m of materials){
   if(ops>=maxOps)break;
   const cId=classFolderIds.get(m.class_id)||folderMap.get(`class:${id(m.class_id)}`)?.drive_folder_id;
   if(!cId)continue;
   ops++;
   const upstream=await storage.download({bucket:'ltch-materials',path:m.object_path});
   const bytes=new Uint8Array(await upstream.arrayBuffer());
   if(!bytes.byteLength||bytes.byteLength>10_000_000)continue;
   const sha256=await fingerprint(bytes);
   const type=contentType(m.content_type||'application/pdf');
   const ext={'application/pdf':'.pdf','image/jpeg':'.jpg','image/png':'.png'}[type]||'';
   const rawTitle=String(m.title||'Tài liệu').trim()||'Tài liệu';
   const sanitizedTitle=rawTitle.replace(/[\u0000-\u001f\u007f/\\]/g,'-').trim()||'Tài liệu';
   const fileName=ext&&!sanitizedTitle.toLowerCase().endsWith(ext)?safeName(`${sanitizedTitle}${ext}`):safeName(sanitizedTitle);
   let lesson=data(await db.from('ltch_lessons').select('id,title,class_id').eq('id',id(m.id)).maybeSingle());
   if(!lesson){
    data(await db.from('ltch_lessons').insert({
     id:m.id,
     class_id:m.class_id,
     title:rawTitle,
     topic:String(m.topic||'').trim(),
     created_by:m.created_by,
     created_at:m.created_at
    }));
    lesson={id:m.id,title:rawTitle,class_id:m.class_id};
   }
   const parentFolderId=await ensureDriveFolder({db,drive,key:`lesson:${id(lesson.id)}`,parentId:cId,name:folderName(lesson.title,lesson.id)});
   const reqId=`migrate_${m.id}`;
   const readFileRecord=async()=>data(await db.from('ltch_lesson_files').select('*').eq('lesson_id',lesson.id).eq('created_by',m.created_by).eq('request_id',reqId).maybeSingle());
   let record=await readFileRecord();
   if(!record){
    const driveId=await drive.reserveId();
    data(await db.from('ltch_lesson_files').upsert({
     id:m.id,
     lesson_id:lesson.id,
     class_id:m.class_id,
     name:fileName,
     drive_file_id:driveId,
     content_type:type,
     file_size:bytes.byteLength,
     sha256,
     request_id:reqId,
     status:'pending',
     created_by:m.created_by,
     created_at:m.created_at
    },{onConflict:'lesson_id,created_by,request_id',ignoreDuplicates:true}));
    record=await readFileRecord();
   }
   if(record&&record.status!=='stored'){
    try{await drive.upload({id:record.drive_file_id,parentId:parentFolderId,name:record.name,contentType:record.content_type,bytes,sha256});}
    catch(error){if(error.code!=='conflict')throw error;}
   }
   const metadata=await drive.metadata({id:record.drive_file_id});
   if(env.LTCH_DRIVE_LINK_PREVIEW==='1')await enableLinkSharing(drive,metadata,record,{parentId:parentFolderId});
   else await requireAllowedSharing(drive,metadata,record,{parentId:parentFolderId});
   if(record.status!=='stored'){
    data(await db.from('ltch_lesson_files').update({status:'stored'}).eq('id',record.id).eq('class_id',m.class_id));
   }
   try{
    demand(typeof storage?.remove==='function',503,'Không thể đối soát tài liệu cũ.');
    await storage.remove({bucket:'ltch-materials',path:m.object_path});
    data(await db.from('ltch_materials').delete().eq('id',m.id).eq('class_id',m.class_id));
   }catch{console.warn('LTCH_MATERIAL_CLEANUP_FAILED');continue;}
   materialsMigrated++;
  }
 }
 const remainingMaterials=Math.max(0,materials.length-materialsMigrated);
 const remainingFolders=Math.max(0,totalMissing-foldersEnsured);
 return {synced:true,sessionsSeeded,foldersEnsured,materialsMigrated,filesRelinked,remainingFolders,remainingMaterials,verifiedInBatch:ops,totalTargets:seen,classesCount:activeClasses.length,lessonsCount:nonVideoLessons.length,filesCount:existingFiles.length+materialsMigrated};
}
