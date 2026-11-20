import test from 'node:test';
import assert from 'node:assert/strict';
import {lessons} from '../worker/lessons.mjs';
import {syncDriveWorkspace} from '../worker/lesson-storage.mjs';

function database(){
 const tables={ltch_classes:[{id:'c',name:'Lớp 6',school_year_id:'y'}],ltch_school_years:[{id:'y',name:'2026–2027'}],ltch_lessons:[{id:'l',title:'Bài 1',class_id:'c'}],ltch_drive_folders:[],ltch_lesson_files:[]};
 return {tables,from(table){
  let filters=[],change;
  const rows=()=>tables[table].filter(row=>filters.every(([k,v])=>row[k]===v));
  const q={select(){return this;},eq(k,v){filters.push([k,v]);return this;},
   maybeSingle(){return Promise.resolve({data:rows()[0]||null,error:null});},
   upsert(row,opts){const keys=opts.onConflict.split(',');if(!tables[table].some(r=>keys.every(k=>r[k]===row[k])))tables[table].push({...row});return Promise.resolve({data:null,error:null});},
   update(value){change=value;return this;},
   then(resolve,reject){if(change)for(const row of rows())Object.assign(row,change);return Promise.resolve({data:null,error:null}).then(resolve,reject);}
  };return q;
 }};
}
function driveFixture(){
 const objects=new Map();let counter=0,failAfterUpload=false,failBeforeUpload=false;
 const drive={
  rootId:async()=>'root',reserveId:async()=>`drive_${++counter}`,
  isRootChild:async({id,name})=>objects.get(id)?.name===name&&objects.get(id)?.parents[0]==='root',
  metadata:async({id})=>{if(!objects.has(id)){const e=Error();e.code='not_found';throw e;}return objects.get(id);},
  createFolder:async({id,parentId,name})=>{if(objects.has(id)){const e=Error();e.code='conflict';throw e;}objects.set(id,{id,name,mimeType:'application/vnd.google-apps.folder',parents:[parentId],shared:false,ownedByMe:true,trashed:false});},
  upload:async({id,parentId,name,contentType,bytes,sha256})=>{
   if(failBeforeUpload){failBeforeUpload=false;throw Error('network lost before upload');}
   if(objects.has(id)){const e=Error();e.code='conflict';throw e;}
   objects.set(id,{id,name,mimeType:contentType,parents:[parentId],size:String(bytes.length),appProperties:{ltchSha256:sha256},shared:false,ownedByMe:true,trashed:false,bytes});
   if(failAfterUpload){failAfterUpload=false;throw Error('network lost');}
  },
  startResumableUpload:async({id,parentId,name,contentType,total,sha256})=>{
   objects.set(`session:${id}`,{id,parentId,name,contentType,total,sha256,offset:0,chunks:[]});
   return `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=sess_${id}`;
  },
  uploadResumableChunk:async({sessionUrl,total,id,offset=0,bytes=null})=>{
   const sess=objects.get(`session:${id}`);
   assert.ok(sess&&sessionUrl.includes(`sess_${id}`));
   if(bytes===null)return sess.offset>=total?{state:'uploaded',id,offset:total}:{state:'uploading',offset:sess.offset};
   assert.equal(offset,sess.offset);
   sess.chunks.push(bytes);
   sess.offset+=bytes.byteLength;
   if(sess.offset<total)return {state:'uploading',offset:sess.offset};
   const merged=new Uint8Array(total);
   let pos=0;for(const c of sess.chunks){merged.set(c,pos);pos+=c.byteLength;}
   objects.set(id,{id,name:sess.name,mimeType:sess.contentType,parents:[sess.parentId],size:String(total),appProperties:{ltchSha256:sess.sha256,ltchSize:String(total)},shared:false,ownedByMe:true,trashed:false,bytes:merged});
   return {state:'uploaded',id,offset:total};
  },
  download:async({id})=>new Response(objects.get(id).bytes)
 };
 drive.permissions=async({id})=>[{type:'user',role:'owner'},...(objects.get(id)?.shared?[{type:'anyone',role:'reader',allowFileDiscovery:false}]:[])];
 drive.shareWithLink=async({id})=>{objects.get(id).shared=true;};
 return {drive,objects,failNext(){failAfterUpload=true;},failBefore(){failBeforeUpload=true;}};
}
const assistant={uid:'a',status:'active',roles:['assistant'],memberships:[{class_id:'c',member_role:'assistant',permissions:['materials.write']}],childMemberships:[]};
const parent={uid:'p',status:'active',roles:['parent'],memberships:[],childMemberships:[{class_id:'c',uid:'child'}]};
const student={uid:'s',status:'active',roles:['student'],memberships:[{class_id:'c',member_role:'student'}],childMemberships:[]};
const env={LTCH_LESSONS_ENABLED:'1',LTCH_LESSONS_AUDIENCE:'all',MAIL_SECRET:'test-only-key-material-not-used-in-production'};
const path='/api/classes/c/lessons/l/files';
function upload(name,text,requestId){const form=new FormData();form.set('file',new File([text],name,{type:name.endsWith('.pdf')?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));form.set('requestId',requestId);return new Request('https://example.test'+path,{method:'POST',body:form});}

test('authorized staff store multiple files in private Drive folders, and parents download through the server',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive;
 for(const [name,token] of [['Bài.pdf','request-id-first-123'],['Đề.docx','request-id-second-12']]){
  const response=await lessons(upload(name,'mock content',token),path,{db,actor:assistant,env,openDrive});assert.equal(response.status,201);
 }
 assert.equal(db.tables.ltch_drive_folders.length,4);assert.equal(db.tables.ltch_lesson_files.length,2);
 assert.ok(db.tables.ltch_lesson_files.every(row=>row.status==='stored'));
 const record=db.tables.ltch_lesson_files[1],filePath=`${path}/${record.id}`;
 const response=await lessons(new Request('https://example.test'+filePath),filePath,{db,actor:parent,env,openDrive});
 assert.equal(await response.text(),'mock content');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(response.headers.get('content-type'),'application/octet-stream');
 mock.objects.get(record.drive_file_id).size='10000001';
 await assert.rejects(lessons(new Request('https://example.test'+filePath),filePath,{db,actor:parent,env,openDrive}),e=>e.status===503);
 mock.objects.get(record.drive_file_id).size=String(record.file_size);
 mock.objects.get(record.drive_file_id).shared=true;
 await assert.rejects(lessons(new Request('https://example.test'+filePath),filePath,{db,actor:parent,env,openDrive}),e=>e.status===503);
 mock.objects.get('drive_1').parents=['moved'];
 await assert.rejects(lessons(upload('Khác.pdf','content','request-id-moved-123'),path,{db,actor:assistant,env,openDrive}),e=>e.status===503);
});

test('lost upload responses are reconciled with the reserved Drive ID, and reused request IDs cannot change bytes',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive,token='request-id-lost-1234';mock.failNext();
 await assert.rejects(lessons(upload('Bài.pdf','original',token),path,{db,actor:assistant,env,openDrive}),e=>e.status===503);
 const record=db.tables.ltch_lesson_files[0];assert.equal(record.status,'pending');
 const retried=await lessons(upload('Bài.pdf','original',token),path,{db,actor:assistant,env,openDrive});assert.equal(retried.status,201);
 assert.equal(db.tables.ltch_lesson_files.length,1);assert.equal(record.status,'stored');assert.equal(mock.objects.size,5);
 await assert.rejects(lessons(upload('Bài.pdf','different',token),path,{db,actor:assistant,env,openDrive}),e=>e.status===409);
});

test('students, parents and unassigned assistants cannot cause Drive writes',async()=>{
 const db=database();let called=0;const openDrive=async()=>{called++;throw Error('must not connect');};
 const limited={...assistant,memberships:[{class_id:'c',member_role:'assistant',permissions:[]}]};
 for(const actor of [student,parent,limited])await assert.rejects(lessons(upload('Bài.pdf','data','request-id-auth-1234'),path,{db,actor,env,openDrive}),e=>e.status===403);
 assert.equal(called,0);
});

test('student and parent cannot read another class even with a known lesson and file ID',async()=>{
 const db=database();let called=0;const openDrive=async()=>{called++;throw Error('must not connect');};
 const outside='/api/classes/other/lessons/l/files/f';
 for(const actor of [student,parent])await assert.rejects(lessons(new Request('https://example.test'+outside),outside,{db,actor,env,openDrive}),e=>e.status===403);
 assert.equal(called,0);
});

test('concurrent uploads keep a single folder hierarchy and preserve separate file contents',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive;
 const inputs=Array.from({length:5},(_,i)=>({name:`Tệp-${i}.pdf`,content:`nội dung ${i}`,token:`request-concurrent-${i}-123`}));
 const responses=await Promise.all(inputs.map(item=>lessons(upload(item.name,item.content,item.token),path,{db,actor:assistant,env,openDrive})));
 assert.ok(responses.every(response=>response.status===201));
 assert.equal(db.tables.ltch_drive_folders.length,4);assert.equal(db.tables.ltch_lesson_files.length,inputs.length);
 for(const item of inputs){
  const record=db.tables.ltch_lesson_files.find(row=>row.request_id===item.token);
  assert.equal(record.status,'stored');
  const filePath=`${path}/${record.id}`;
  assert.equal(await (await lessons(new Request('https://example.test'+filePath),filePath,{db,actor:parent,env,openDrive})).text(),item.content);
 }
});

test('retry after losing the connection before upload reuses the pending record',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive,token='request-before-upload-123';mock.failBefore();
 await assert.rejects(lessons(upload('Bài.pdf','original',token),path,{db,actor:assistant,env,openDrive}),e=>e.status===503);
 const record=db.tables.ltch_lesson_files[0];assert.equal(record.status,'pending');assert.equal(mock.objects.has(record.drive_file_id),false);
 assert.equal((await lessons(upload('Bài.pdf','original',token),path,{db,actor:assistant,env,openDrive})).status,201);
 assert.equal(db.tables.ltch_lesson_files.length,1);assert.equal(record.status,'stored');
});

test('the 10 MB file limit permits its boundary and rejects empty or larger files',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive;
 const makeUpload=(size,token)=>{
  const form=new FormData();form.set('file',new File([new Uint8Array(size)],'boundary.bin',{type:'application/octet-stream'}));form.set('requestId',token);
  return new Request('https://example.test'+path,{method:'POST',body:form});
 };
 assert.equal((await lessons(makeUpload(10_000_000,'request-limit-valid-123'),path,{db,actor:assistant,env,openDrive})).status,201);
 for(const [size,token] of [[0,'request-limit-empty-123'],[10_000_001,'request-limit-large-123']]){
  await assert.rejects(lessons(makeUpload(size,token),path,{db,actor:assistant,env,openDrive}),e=>e.status===400);
 }
 assert.equal(db.tables.ltch_lesson_files.length,1);
});

test('common file types round-trip as safe attachments without changing their bytes',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive;
 const formats=[['de.pdf','application/pdf'],['bai.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['bang.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],['anh.png','image/png'],['ghi-chu.txt','text/plain'],['trang.html','text/html']];
 for(const [index,[name,type]] of formats.entries()){
  const bytes=new Uint8Array([0,1,2,13,10,128,255,index]),form=new FormData();
  form.set('file',new File([bytes],name,{type}));form.set('requestId',`request-file-format-${index}-123`);
  const result=await lessons(new Request('https://example.test'+path,{method:'POST',body:form}),path,{db,actor:assistant,env,openDrive});
  const fileId=(await result.json()).id,filePath=`${path}/${fileId}`;
  const stored=db.tables.ltch_lesson_files.find(row=>row.id===fileId);assert.equal(stored.content_type,type);
  const response=await lessons(new Request('https://example.test'+filePath),filePath,{db,actor:parent,env,openDrive});
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.match(response.headers.get('content-disposition'),/^attachment;/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
});

test('link previews are gated, require class access and only admins can share existing files',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive;
 const created=await lessons(upload('Bài.pdf','content','request-preview-file-123'),path,{db,actor:assistant,env,openDrive});
 const fileId=(await created.json()).id,preview=`${path}/${fileId}/preview`,admin={uid:'owner',status:'active',roles:['admin'],memberships:[],childMemberships:[]};
 const request=(method='GET')=>new Request('https://example.test'+preview,{method});
 await assert.rejects(lessons(request(),preview,{db,actor:parent,env,openDrive}),e=>e.status===404);
 const enabled={...env,LTCH_DRIVE_LINK_PREVIEW:'1'};
 await assert.rejects(lessons(request(),preview,{db,actor:parent,env:enabled,openDrive}),e=>e.status===409);
 await assert.rejects(lessons(request('POST'),preview,{db,actor:assistant,env:enabled,openDrive}),e=>e.status===403);
 const shared=await (await lessons(request('POST'),preview,{db,actor:admin,env:enabled,openDrive})).json();
 assert.match(shared.url,/^https:\/\/drive\.google\.com\/file\/d\/drive_\d+\/preview$/);
 assert.equal((await (await lessons(request(),preview,{db,actor:parent,env:enabled,openDrive})).json()).url,shared.url);
 const outside=`/api/classes/other/lessons/l/files/${fileId}/preview`;
 await assert.rejects(lessons(new Request('https://example.test'+outside),outside,{db,actor:parent,env:enabled,openDrive}),e=>e.status===403);
 const filePath=`${path}/${fileId}`;
 assert.equal(await (await lessons(new Request('https://example.test'+filePath),filePath,{db,actor:parent,env:enabled,openDrive})).text(),'content');
 await assert.rejects(lessons(new Request('https://example.test'+filePath),filePath,{db,actor:parent,env,openDrive}),e=>e.status===503);
});

test('enabled link previews share newly uploaded files and do not expose Drive IDs in the catalog',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive,enabled={...env,LTCH_DRIVE_LINK_PREVIEW:'1'};
 const response=await lessons(upload('Bài.pdf','content','request-new-preview-123'),path,{db,actor:assistant,env:enabled,openDrive});
 const fileId=(await response.json()).id,record=db.tables.ltch_lesson_files.find(row=>row.id===fileId);
 assert.equal(mock.objects.get(record.drive_file_id).shared,true);
 const preview=`${path}/${fileId}/preview`;
 assert.match((await (await lessons(new Request('https://example.test'+preview),preview,{db,actor:parent,env:enabled,openDrive})).json()).url,/^https:\/\/drive\.google\.com\//);
});

test('trashed Drive folders are automatically recreated along with their children',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive;
 assert.equal((await lessons(upload('Bài-1.pdf','content-1','request-trash-heal-1-123'),path,{db,actor:assistant,env,openDrive})).status,201);
 const oldClassFolder=db.tables.ltch_drive_folders.find(row=>row.folder_key==='class:c').drive_folder_id;
 const oldLessonFolder=db.tables.ltch_drive_folders.find(row=>row.folder_key==='lesson:l').drive_folder_id;
 mock.objects.get(oldClassFolder).trashed=true;
 assert.equal((await lessons(upload('Bài-2.pdf','content-2','request-trash-heal-2-123'),path,{db,actor:assistant,env,openDrive})).status,201);
 const newClassFolder=db.tables.ltch_drive_folders.find(row=>row.folder_key==='class:c').drive_folder_id;
 const newLessonFolder=db.tables.ltch_drive_folders.find(row=>row.folder_key==='lesson:l').drive_folder_id;
 assert.notEqual(newClassFolder,oldClassFolder);
 assert.notEqual(newLessonFolder,oldLessonFolder);
 assert.equal(mock.objects.get(newClassFolder).trashed,false);
 assert.equal(mock.objects.get(newLessonFolder).parents[0],newClassFolder);
});

test('syncDriveWorkspace provisions all active class folders and migrates legacy Supabase materials to Drive',async()=>{
 const db=database();
 db.tables.ltch_classes=[
  {id:'class-6a',name:'Lớp 6',school_year_id:'y',archived:false},
  {id:'class-9a',name:'Lớp 9A',school_year_id:'y',archived:false},
  {id:'class-6b',name:'Lớp 6B',school_year_id:'y',archived:true}
 ];
 db.tables.ltch_lessons=[];
 db.tables.ltch_materials=[
  {id:'mat-abc-1234',class_id:'class-9a',title:'ABC.pdf',topic:'Giải tích',object_path:'class-9a/mat-abc-1234.pdf',content_type:'application/pdf',file_size:12,status:'stored',created_by:'a',created_at:1000}
 ];
 const baseFrom=db.from.bind(db);
 db.from=table=>{
  const q=baseFrom(table);
  let filters=[],change,deleting=false;
  const rows=()=>(db.tables[table]||[]).filter(row=>filters.every(([k,v])=>row[k]===v));
  return {
   ...q,
   select(){return this;},
   eq(k,v){filters.push([k,v]);q.eq(k,v);return this;},
   order(){return this;},
   limit(){return Promise.resolve({data:rows(),error:null});},
   insert(row){(db.tables[table]??=[]).push({...row});return Promise.resolve({data:null,error:null});},
   delete(){deleting=true;return this;},
   update(val){change=val;q.update(val);return this;},
   then(resolve,reject){
    if(deleting){db.tables[table]=(db.tables[table]||[]).filter(row=>!filters.every(([k,v])=>row[k]===v));}
    if(change)for(const row of rows())Object.assign(row,change);
    return Promise.resolve({data:rows(),error:null}).then(resolve,reject);
   }
  };
 };
 const mock=driveFixture();
 const removedPaths=[];
 const openStorage=()=>({
  download:async({bucket,path:objPath})=>{
   assert.equal(bucket,'ltch-materials');
   assert.equal(objPath,'class-9a/mat-abc-1234.pdf');
   return new Response('%PDF-1.4 abc');
  },
  remove:async({bucket,path:objPath})=>{removedPaths.push(`${bucket}:${objPath}`);}
 });
 const result=await syncDriveWorkspace({
  db,
  env:{...env,LTCH_DRIVE_LINK_PREVIEW:'1'},
  openDrive:async()=>mock.drive,
  openStorage
 });
 assert.equal(result.synced,true);
 assert.equal(result.materialsMigrated,1);
 assert.equal(db.tables.ltch_materials.length,0);
 assert.deepEqual(removedPaths,['ltch-materials:class-9a/mat-abc-1234.pdf']);
 const folderKeys=new Set(db.tables.ltch_drive_folders.map(f=>f.folder_key));
 assert.equal(folderKeys.has('ltch-root'),true);
 assert.equal(folderKeys.has('year:y'),true);
 assert.equal(folderKeys.has('class:class-6a'),true);
 assert.equal(folderKeys.has('class:class-9a'),true);
 assert.equal(folderKeys.has('class:class-6b'),false);
 assert.equal(folderKeys.has('lesson:mat-abc-1234'),true);
 assert.equal(db.tables.ltch_lessons.length,1);
 assert.equal(db.tables.ltch_lesson_files.length,1);
 assert.equal(db.tables.ltch_lesson_files[0].name,'ABC.pdf');
 assert.equal(db.tables.ltch_lesson_files[0].status,'stored');
});

test('resumable Drive video lecture upload stores video in class folder, updates lesson topic, and serves Drive player preview to class members',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive;
 db.tables.ltch_lessons[0].topic='Giải tích 12 · drive-video:pending';
 const totalBytes=12*1024*1024;
 const sha256='a'.repeat(64);
 const startReq=new Request('https://example.test'+path,{
  method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({
   mode:'resumable',
   isVideoLecture:true,
   name:'Bai-1-Khao-sat-ham-so.mp4',
   contentType:'video/mp4',
   size:totalBytes,
   sha256,
   requestId:'request-video-resumable-123'
  })
 });
 const startRes=await lessons(startReq,path,{db,actor:assistant,env,openDrive});
 assert.equal(startRes.status,201);
 const {id:fileId,uploadToken,chunkSize}=await startRes.json();
 assert.equal(chunkSize,8*1024*1024);
 const chunkPath=`${path}/${fileId}/chunks`;

 const chunk1=new FormData();
 chunk1.set('uploadToken',uploadToken);
 chunk1.set('offset','0');
 chunk1.set('chunk',new File([new Uint8Array(8*1024*1024)],'chunk1.bin'));
 const res1=await (await lessons(new Request('https://example.test'+chunkPath,{method:'POST',body:chunk1}),chunkPath,{db,actor:assistant,env,openDrive})).json();
 assert.equal(res1.state,'uploading');
 assert.equal(res1.offset,8*1024*1024);

 const chunk2=new FormData();
 chunk2.set('uploadToken',uploadToken);
 chunk2.set('offset',String(8*1024*1024));
 chunk2.set('chunk',new File([new Uint8Array(4*1024*1024)],'chunk2.bin'));
 const res2=await (await lessons(new Request('https://example.test'+chunkPath,{method:'POST',body:chunk2}),chunkPath,{db,actor:assistant,env,openDrive})).json();
 assert.equal(res2.state,'uploaded');
 assert.equal(res2.offset,totalBytes);

 assert.equal(db.tables.ltch_lessons[0].topic,`Giải tích 12 · drive-video:${fileId}`);
 const previewPath=`${path}/${fileId}/preview`;
 const studentPreview=await (await lessons(new Request('https://example.test'+previewPath),previewPath,{db,actor:student,env,openDrive})).json();
 assert.match(studentPreview.url,/^https:\/\/drive\.google\.com\/file\/d\/drive_\d+\/preview$/);
});

test('resumable Drive video lecture supports binary stream chunks and refreshes pending records on retry',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive;
 db.tables.ltch_lessons[0].topic='||s:1|d:2026-09-01|t:18:00-20:00|c:0';
 const totalBytes=10*1024*1024;
 const makeStart=(sha)=>new Request('https://example.test'+path,{
  method:'POST',
  headers:{'content-type':'application/json',origin:'https://ltch.example.com'},
  body:JSON.stringify({
   mode:'resumable',
   isVideoLecture:true,
   name:'ANH VAN O DAY.mp4',
   contentType:'video/mp4',
   size:totalBytes,
   sha256:sha,
   requestId:'request-video-binary-retry-123'
  })
 });
 const firstStart=await lessons(makeStart('b'.repeat(64)),path,{db,actor:assistant,env,openDrive});
 assert.equal(firstStart.status,201);
 const secondStart=await lessons(makeStart('c'.repeat(64)),path,{db,actor:assistant,env,openDrive});
 assert.equal(secondStart.status,201);
 const {id:fileId,uploadToken,sessionUrl}=await secondStart.json();
 assert.match(sessionUrl,/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=resumable/);
 const chunkPath=`${path}/${fileId}/chunks`;

 const q1=`?offset=0&uploadToken=${encodeURIComponent(uploadToken)}`;
 const r1=await (await lessons(new Request('https://example.test'+chunkPath+q1,{
  method:'POST',
  headers:{'content-type':'application/octet-stream'},
  body:new Uint8Array(8*1024*1024)
 }),chunkPath,{db,actor:assistant,env,openDrive})).json();
 assert.equal(r1.state,'uploading');
 assert.equal(r1.offset,8*1024*1024);

 const q2=`?offset=${8*1024*1024}&uploadToken=${encodeURIComponent(uploadToken)}`;
 const r2=await (await lessons(new Request('https://example.test'+chunkPath+q2,{
  method:'POST',
  headers:{'content-type':'application/octet-stream'},
  body:new Uint8Array(2*1024*1024)
 }),chunkPath,{db,actor:assistant,env,openDrive})).json();
 assert.equal(r2.state,'uploaded');
 assert.equal(r2.offset,totalBytes);
 assert.match(db.tables.ltch_lessons[0].topic,new RegExp(`drive-video:${fileId}`));
});

test('simultaneous binary chunks do not overwrite each other',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive;
 const uploads=[];
 for(let i=0;i<2;i++){
  const response=await lessons(new Request('https://example.test'+path,{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({mode:'resumable',name:`parallel-${i}.pdf`,contentType:'application/pdf',size:32,sha256:String(i+1).repeat(64),requestId:`request-parallel-binary-${i}-123`})
  }),path,{db,actor:assistant,env,openDrive});
  uploads.push(await response.json());
 }
 let arrivals=0,release;
 const ready=new Promise(resolve=>{release=resolve;});
 const send=mock.drive.uploadResumableChunk;
 mock.drive.uploadResumableChunk=async args=>{if(++arrivals===2)release();await ready;return send(args);};
 await Promise.all(uploads.map((upload,i)=>{
  const chunkPath=`${path}/${upload.id}/chunks`;
  return lessons(new Request(`https://example.test${chunkPath}?offset=0&uploadToken=${encodeURIComponent(upload.uploadToken)}`,{
   method:'POST',headers:{'content-type':'application/octet-stream'},body:new Uint8Array(32).fill(i+65)
  }),chunkPath,{db,actor:assistant,env,openDrive});
 }));
 for(let i=0;i<uploads.length;i++){
  const record=db.tables.ltch_lesson_files.find(row=>row.id===uploads[i].id);
  assert.deepEqual(mock.objects.get(record.drive_file_id).bytes,new Uint8Array(32).fill(i+65));
 }
});

test('resumable upload allows document files up to 100 MB and rejects non-video files over 100 MB',async()=>{
 const db=database(),mock=driveFixture(),openDrive=async()=>mock.drive;
 const makeDocStart=(size)=>new Request('https://example.test'+path,{
  method:'POST',
  headers:{'content-type':'application/json',origin:'https://ltch.example.com'},
  body:JSON.stringify({
   mode:'resumable',
   isVideoLecture:false,
   name:'Tai-lieu-lon-20MB.pdf',
   contentType:'application/pdf',
   size,
   sha256:'d'.repeat(64),
   requestId:`req-doc-${size}-1234567890`
  })
 });
 const okStart=await lessons(makeDocStart(20*1024*1024),path,{db,actor:assistant,env,openDrive});
 assert.equal(okStart.status,201);
 const overLimit=await assert.rejects(()=>lessons(makeDocStart(101*1024*1024),path,{db,actor:assistant,env,openDrive}));
 assert.equal(overLimit,undefined);
});
