import {backupChunk,backupConfirmedOffset,backupMaxBytes} from './backup-drive-ranges.mjs';

// Unconnected protocol adapter: it does not encrypt, create backups, grant
// access or expose a website route. Only use after the full backup/restore flow
// independently verifies encrypted input and manages session URLs securely.
export class BackupDriveError extends Error {
 constructor(code){super('Backup Drive upload unavailable');this.name='BackupDriveError';this.code=code;}
}
const origin='https://www.googleapis.com';
const folderType='application/vnd.google-apps.folder';
const idOk=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
function validId(value){if(!idOk(value))throw new BackupDriveError('invalid_id');return value;}
function validSize(value){if(!Number.isSafeInteger(value)||value<1||value>backupMaxBytes)throw new BackupDriveError('invalid_size');}
function sessionUrl(value){
 let url;try{if(typeof value!=='string'||value.length>4096)throw Error();url=new URL(value);}catch{throw new BackupDriveError('invalid_session');}
 if(url.origin!==origin||url.username||url.password||url.hash||url.pathname!=='/upload/drive/v3/files'||url.searchParams.getAll('uploadType').length!==1||url.searchParams.get('uploadType')!=='resumable'||url.searchParams.getAll('upload_id').length!==1||!url.searchParams.get('upload_id'))throw new BackupDriveError('invalid_session');
 return url.href;
}
export function createBackupDriveUpload({accessToken,fetchImpl=fetch,ownerEmail='admin@example.com'}){
 if(typeof accessToken!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(accessToken))throw new BackupDriveError('invalid_token');
 async function send(url,options={}){
  try{return await fetchImpl(url,{...options,headers:{...options.headers,authorization:`Bearer ${accessToken}`},redirect:'manual'});}catch{throw new BackupDriveError('network');}
 }
 async function json(response){try{return await response.json();}catch{throw new BackupDriveError('invalid_response');}}
 async function verifyOwnerAndFolder(parentId){
  const owner=await send(`${origin}/drive/v3/about?fields=user%28emailAddress%29`);
  if(!owner.ok)throw new BackupDriveError('authorization');
  const account=await json(owner);
  if(account?.user?.emailAddress?.toLowerCase?.()!==String(ownerEmail||'admin@example.com').trim().toLowerCase())throw new BackupDriveError('wrong_account');
  const folder=await send(`${origin}/drive/v3/files/${parentId}?fields=id%2CmimeType%2Ctrashed%2Cshared%2CownedByMe`);
  if(!folder.ok)throw new BackupDriveError('folder_unavailable');
  const f=await json(folder);
  if(f?.id!==parentId||f.mimeType!==folderType||f.trashed!==false||f.shared!==false||f.ownedByMe!==true)throw new BackupDriveError('unsafe_folder');
 }
 async function complete(response,expectedId,total){
  const result=await json(response);
  if(result?.id!==expectedId)throw new BackupDriveError('invalid_response');
  return {state:'uploaded',id:result.id,total};
 }
 async function interpret(response,total,maxOffset,expectedId){
  if(response.status===308){
   let offset;try{offset=backupConfirmedOffset(total,response.headers.get('range'));}catch{throw new BackupDriveError('invalid_response');}
   if(offset>maxOffset)throw new BackupDriveError('invalid_response');
   return {state:'uploading',offset};
  }
  if(response.status===200||response.status===201){if(maxOffset!==total)throw new BackupDriveError('invalid_response');return complete(response,expectedId,total);}
  if(response.status>=400&&response.status<500)throw new BackupDriveError('expired_or_rejected');
  throw new BackupDriveError(response.status>=500?'retry_status':'upstream');
 }
 return {
  async start({id,parentId,name,total}){
   validId(id);validId(parentId);validSize(total);
   if(typeof name!=='string'||!name.trim()||name.length>250||/[\u0000-\u001f\u007f]/.test(name))throw new BackupDriveError('invalid_name');
   await verifyOwnerAndFolder(parentId);
   const response=await send(`${origin}/upload/drive/v3/files?uploadType=resumable&fields=id`,{method:'POST',headers:{'content-type':'application/json; charset=UTF-8','x-upload-content-type':'application/octet-stream','x-upload-content-length':String(total)},body:JSON.stringify({id,name:name.trim(),parents:[parentId]})});
   if(response.status!==200)throw new BackupDriveError('upstream');
   return sessionUrl(response.headers.get('location'));
  },
  async status({session,total,id}){
   validId(id);validSize(total);
   const response=await send(sessionUrl(session),{method:'PUT',headers:{'content-range':`bytes */${total}`,'content-length':'0'}});
   return interpret(response,total,total,id);
  },
  async sendChunk({session,total,id,offset,bytes}){
   validId(id);validSize(total);let chunk;
   try{chunk=backupChunk(total,offset);}catch{throw new BackupDriveError('invalid_offset');}
   if(!(bytes instanceof Uint8Array)||bytes.byteLength!==chunk.length)throw new BackupDriveError('invalid_size');
   const response=await send(sessionUrl(session),{method:'PUT',headers:{'content-type':'application/octet-stream','content-length':String(chunk.length),'content-range':chunk.contentRange},body:bytes});
   return interpret(response,total,offset+chunk.length,id);
  }
 };
}
