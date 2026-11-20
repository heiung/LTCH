import {data,demand} from './policy.mjs';

// DB unique key arbitrates concurrent requests. IDs are committed before Drive
// is modified so a retry always addresses the same folder.
export async function ensureDriveFolder({db,drive,key,parentId,name}) {
 const load=async()=>data(await db.from('ltch_drive_folders').select('*').eq('folder_key',key).maybeSingle());
 let record=await load(),isNew=false;
 if(!record){
  const driveId=await drive.reserveId();
  data(await db.from('ltch_drive_folders').upsert({folder_key:key,drive_folder_id:driveId,parent_folder_id:parentId,folder_name:name},{onConflict:'folder_key',ignoreDuplicates:true}));
  record=await load();
  isNew=true;
 }
 demand(record,503,'Không thể xác định thư mục lưu tài liệu.');
 let metadata=null;
 if(record.parent_folder_id===parentId&&record.folder_name===name){
  if(isNew){
   try {await drive.createFolder({id:record.drive_folder_id,parentId,name:record.folder_name});}
   catch(createError){if(createError.code!=='conflict')throw createError;}
  }
  try {metadata=await drive.metadata({id:record.drive_folder_id});}
  catch(error) {
   if(error.code!=='not_found')throw error;
   try {await drive.createFolder({id:record.drive_folder_id,parentId,name:record.folder_name});}
   catch(createError){if(createError.code!=='conflict')throw createError;}
   metadata=await drive.metadata({id:record.drive_folder_id});
  }
 }
 if(record.parent_folder_id===parentId&&record.folder_name!==name&&typeof drive.rename==='function'){
  let existingMeta=null;
  try {existingMeta=await drive.metadata({id:record.drive_folder_id});}
  catch(error){if(error.code!=='not_found')throw error;}
  const canRenameInPlace=Boolean(
   existingMeta&&
   existingMeta.id===record.drive_folder_id&&
   existingMeta.mimeType==='application/vnd.google-apps.folder'&&
   existingMeta.trashed===false&&
   existingMeta.shared===false&&
   existingMeta.ownedByMe===true&&
   Array.isArray(existingMeta.parents)&&
   existingMeta.parents.length===1&&
   (parentId==='root'?await drive.isRootChild({id:record.drive_folder_id,name:existingMeta.name}):existingMeta.parents[0]===parentId)
  );
  if(canRenameInPlace){
   await drive.rename({id:record.drive_folder_id,name});
   data(await db.from('ltch_drive_folders').update({folder_name:name}).eq('folder_key',key));
   record={...record,folder_name:name};
   metadata=await drive.metadata({id:record.drive_folder_id});
  }
 }
 if(record.parent_folder_id!==parentId||record.folder_name!==name||(metadata?.trashed===true&&metadata.ownedByMe===true&&metadata.mimeType==='application/vnd.google-apps.folder')){
  const freshId=await drive.reserveId();
  try {await drive.createFolder({id:freshId,parentId,name});}
  catch(createError){if(createError.code!=='conflict')throw createError;}
  data(await db.from('ltch_drive_folders').update({drive_folder_id:freshId,parent_folder_id:parentId,folder_name:name}).eq('folder_key',key));
  record={...record,drive_folder_id:freshId,parent_folder_id:parentId,folder_name:name};
  metadata=await drive.metadata({id:freshId});
 }
 // The root alias cannot be compared to the concrete parent ID in metadata.
 // Query the root's app-visible children to verify root placement instead.
 const parentMatches=parentId==='root'?await drive.isRootChild({id:record.drive_folder_id,name:record.folder_name}):metadata?.parents?.[0]===parentId;
 demand(metadata?.id===record.drive_folder_id&&metadata.mimeType==='application/vnd.google-apps.folder'&&metadata.name===record.folder_name&&metadata.trashed===false&&metadata.shared===false&&metadata.ownedByMe===true&&Array.isArray(metadata.parents)&&metadata.parents.length===1&&parentMatches,503,'Thư mục Drive không còn riêng tư hoặc không đúng cấu trúc.');
 return record.drive_folder_id;
}
