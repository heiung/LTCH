import {randomUUID} from 'node:crypto';
import {ApiError,demand,id,string,data,classCanRead,staffCan,isAdmin} from './policy.mjs';
import {json,readJson} from './http.mjs';
import {uploadLessonFile,uploadLessonFileChunk,downloadLessonFile,previewLessonFile,streamLessonVideo,syncDriveWorkspace} from './lesson-storage.mjs';
import {isPracticeSolutionLesson} from '../shared/classroom.mjs';

function canWriteLessonTarget(actor,classId){
 return staffCan(actor,classId,'materials.write')||staffCan(actor,classId,'assignments.write');
}

// A narrow pilot permits real role checks without enabling the feature for everyone.
export function lessonsAvailable(env,actor) {
 if(env.LTCH_LESSONS_ENABLED==='0')return false;
 const driveConfigured=Boolean(env.GOOGLE_DRIVE_CLIENT_ID&&env.GOOGLE_DRIVE_CLIENT_SECRET&&env.GOOGLE_DRIVE_REFRESH_TOKEN);
 if(env.LTCH_LESSONS_ENABLED!=='1'&&!driveConfigured)return false;
 if(env.LTCH_LESSONS_AUDIENCE==='all'||isAdmin(actor))return true;
 if(typeof env.LTCH_LESSONS_PILOT_UIDS==='string'){
  const pilot=env.LTCH_LESSONS_PILOT_UIDS.split(',').map(value=>value.trim()).filter(Boolean);
  return typeof actor.uid==='string'&&pilot.includes(actor.uid);
 }
 return env.LTCH_LESSONS_AUDIENCE!=='pilot';
}

// Disabled unless the migration and the complete storage integration are ready.
export async function lessons(request,path,{db,actor,env,openDrive}) {
 const match=/^\/api\/classes\/([A-Za-z0-9_-]{1,128})\/lessons(?:\/([A-Za-z0-9_-]{1,128})\/files(?:\/([A-Za-z0-9_-]{1,128})(?:\/(preview|chunks|stream))?)?)?$/.exec(path);
 if(!match)return null;
 if(!lessonsAvailable(env,actor))throw new ApiError(404,'Chức năng chưa sẵn sàng.');
 const classId=id(match[1]);demand(classCanRead(actor,classId));
 if(match[4]==='chunks'){
  demand(request.method==='POST',405);
  demand(!isPracticeSolutionLesson(match[2]),400,'Tệp Chữa đề luyện phải tải qua mục Chữa đề luyện riêng.');
  demand(canWriteLessonTarget(actor,classId));
  return uploadLessonFileChunk(request,{db,actor,env,classId,lessonId:id(match[2]),fileId:match[3],openDrive});
 }
 if(match[4]==='stream'){
  demand(request.method==='GET',405);
  return streamLessonVideo({request,db,actor,env,classId,lessonId:id(match[2]),fileId:match[3],openDrive});
 }
 if(match[4]==='preview'){
  demand(request.method==='GET'||request.method==='POST',405);
  if(request.method==='POST')demand(isAdmin(actor));
  return previewLessonFile({db,env,classId,lessonId:id(match[2]),fileId:match[3],enable:request.method==='POST',openDrive});
 }
 if(request.method==='POST'&&!match[2]){
  demand(staffCan(actor,classId,'materials.write')||staffCan(actor,classId,'assignments.write'));
  const body=await readJson(request,4096),lessonId=randomUUID();
  data(await db.from('ltch_lessons').insert({id:lessonId,class_id:classId,title:string(body.title,250),topic:string(body.topic||'',200,true),created_by:actor.uid,created_at:Date.now()}));
  return json({id:lessonId},201);
 }
 if(match[2]&&request.method==='POST'){
  demand(!match[3],405);
  demand(!isPracticeSolutionLesson(match[2]),400,'Tệp Chữa đề luyện phải tải qua mục Chữa đề luyện riêng.');
  demand(canWriteLessonTarget(actor,classId));
  const targetLessonId=id(match[2]);
  let lesson=data(await db.from('ltch_lessons').select('id,title,topic').eq('class_id',classId).eq('id',targetLessonId).maybeSingle());
  if(!lesson){
   const sesMatch=/^ses-([A-Za-z0-9_-]+)-(\d{2,3})$/i.exec(targetLessonId);
   if(sesMatch&&sesMatch[1]===classId){
    const num=Number(sesMatch[2]);
    if(num>=1&&num<=200){
     const title=`Buổi ${num}`;
     const topic=`||s:${num}|d:|t:|c:0|x:1`;
     data(await db.from('ltch_lessons').upsert({id:targetLessonId,class_id:classId,title,topic,created_by:actor.uid,created_at:Date.now()},{onConflict:'id'}));
     lesson={id:targetLessonId,title,topic};
    }
   }
  }
  demand(lesson,404,'Không tìm thấy bài giảng.');
  return uploadLessonFile(request,{db,actor,env,classId,lesson,openDrive});
 }
 demand(request.method==='GET',405);
 if(match[3])return downloadLessonFile({db,env,classId,lessonId:id(match[2]),fileId:match[3],openDrive});
 const params=new URL(request.url).searchParams,createdAt=params.get('beforeCreatedAt'),recordId=params.get('beforeId');
 demand((createdAt===null)===(recordId===null),400,'Mốc bài giảng không hợp lệ.');
 if(match[2]){
  const lessonId=id(match[2]);
  const lesson=data(await db.from('ltch_lessons').select('id').eq('class_id',classId).eq('id',lessonId).maybeSingle());
  if(!lesson&&/^ses-[A-Za-z0-9_-]+-\d{2,3}$/i.test(lessonId)){
   return json({items:[],hasMore:false});
  }
  demand(lesson,404,'Không tìm thấy bài giảng.');
  let files=db.from('ltch_lesson_files').select('id,name,content_type,file_size,created_at').eq('class_id',classId).eq('lesson_id',lessonId).eq('status','stored');
  if(createdAt!==null){
   demand(/^\d{1,16}$/.test(createdAt)&&Number.isSafeInteger(Number(createdAt))&&Number(createdAt)<=8640000000000000,400,'Mốc tài liệu không hợp lệ.');
   files=files.or(`created_at.lt.${Number(createdAt)},and(created_at.eq.${Number(createdAt)},id.lt.${id(recordId)})`);
  }
  const rows=data(await files.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(101));
  return json({items:rows.slice(0,100),hasMore:rows.length>100});
 }
 let query=db.from('ltch_lessons').select('id,title,topic,created_at').eq('class_id',classId);
 if(typeof query.not==='function')query=query.not('id','like','psol-%');
 if(createdAt!==null){
  demand(/^\d{1,16}$/.test(createdAt)&&Number.isSafeInteger(Number(createdAt))&&Number(createdAt)<=8640000000000000,400,'Mốc bài giảng không hợp lệ.');
  query=query.or(`created_at.lt.${Number(createdAt)},and(created_at.eq.${Number(createdAt)},id.lt.${id(recordId)})`);
 }
 const rows=data(await query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(51)).filter(row=>!isPracticeSolutionLesson(row));
 return json({items:rows.slice(0,50),hasMore:rows.length>50});
}
