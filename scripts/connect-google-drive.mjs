// One-time, local-only Drive authorization helper. Never log authorization
// codes, token bodies, client secrets, or resumable upload URLs.
import http from 'node:http';
import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {createGoogleDrive,DriveError} from '../worker/google-drive.mjs';
import {createAuthorization,exchangeCode,validateClient,ConnectError} from './drive-connect-core.mjs';
import {createDriveConnectHandler} from './drive-connect-server.mjs';

const accountId=(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
const project=(process.env.CLOUDFLARE_PAGES_PROJECT||'your-ltch-api').trim();
const ownerEmail=(process.env.DRIVE_OWNER_EMAIL||process.env.ADMIN_EMAIL||'').trim().toLowerCase();
const siteUrl=(process.env.ALLOWED_ORIGIN||'https://ltch.example.com').trim();
const secretNames=['GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN'];
const root=path.resolve(import.meta.dirname,'..');
const npxPath=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npx-cli.js');

async function wrangler(args,input){
 await access(npxPath);
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[npxPath,'--no-install','wrangler',...args],{cwd:root,windowsHide:true,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:accountId},stdio:['pipe','pipe','pipe']});
  let output='',errorOutput='',overflow=false;
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>200000){overflow=true;child.kill();}});
  child.stderr.on('data',chunk=>{errorOutput+=chunk;if(errorOutput.length>200000){overflow=true;child.kill();}});
  child.on('error',()=>reject(new ConnectError('wrangler')));
  child.on('close',code=>code===0&&!overflow?resolve(output):reject(new ConnectError('wrangler')));
  child.stdin.on('error',()=>{});child.stdin.end(input===undefined?'':input);
 });
}
async function verifyDestination(){
 if(!accountId||!ownerEmail||!project)throw new ConnectError('missing_env');
 const who=await wrangler(['whoami']);
 if(!who.toLowerCase().includes(`associated with the email ${ownerEmail}.`)||!who.includes(accountId))throw new ConnectError('wrong_cloudflare_account');
 const listed=await wrangler(['pages','secret','list','--project-name',project]);
 if(secretNames.some(name=>new RegExp(`(?:^|\\s)${name}(?:\\s|:)`,'m').test(listed)))throw new ConnectError('secret_exists');
}
async function trashCreated(accessToken,id){
 const response=await fetch(`https://www.googleapis.com/drive/v3/files/${id}`,{method:'PATCH',redirect:'error',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json'},body:JSON.stringify({trashed:true})});
 if(!response.ok)throw new ConnectError('cleanup_failed');
}
async function verifyDrive(accessToken){
 let stage='verify_owner';
 try{
 const drive=createGoogleDrive({accessToken,ownerEmail});await drive.verifyOwner();
 const marker=`LTCH kiem thu ket noi ${randomBytes(8).toString('hex')}`;
 const rootId='root';
 stage='reserve_folder';const folderId=await drive.reserveId();
 stage='reserve_file';const fileId=await drive.reserveId();
 let folderCreated=false,fileCreated=false,cleanupFailed=false;
 try{
  stage='create_folder';await drive.createFolder({id:folderId,parentId:rootId,name:marker});folderCreated=true;
  stage='check_folder';
  const folder=await drive.metadata({id:folderId});
  if(folder.id!==folderId||folder.name!==marker||folder.ownedByMe!==true||folder.shared!==false||folder.trashed!==false||folder.mimeType!=='application/vnd.google-apps.folder'||folder.parents?.length!==1)throw new ConnectError('unsafe_folder');
  stage='check_root';if(!await drive.isRootChild({id:folderId,name:marker}))throw new ConnectError('unsafe_folder');
  const bytes=new TextEncoder().encode('Du lieu kiem thu ket noi Drive cua Lop Toan co Hanh.');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  stage='upload';await drive.upload({id:fileId,parentId:folderId,name:'kiem-thu.txt',contentType:'text/plain',bytes,sha256});fileCreated=true;
  stage='check_file';
  const file=await drive.metadata({id:fileId});
  if(file.id!==fileId||file.ownedByMe!==true||file.shared!==false||file.trashed!==false||file.parents?.length!==1||file.parents[0]!==folderId||file.appProperties?.ltchSha256!==sha256||Number(file.size)!==bytes.length)throw new ConnectError('unsafe_file');
  stage='download';const downloaded=await drive.download({id:fileId});const actual=new Uint8Array(await downloaded.arrayBuffer());
  if(actual.length!==bytes.length||!actual.every((value,index)=>value===bytes[index]))throw new ConnectError('content_mismatch');
 }finally{
  // These IDs were allocated and created by this invocation; never touch an
  // existing item. Move disposable test artifacts to trash, not permanent delete.
  if(fileCreated)try{await trashCreated(accessToken,fileId);}catch{cleanupFailed=true;}
  if(folderCreated)try{await trashCreated(accessToken,folderId);}catch{cleanupFailed=true;}
  if(cleanupFailed)throw new ConnectError('cleanup_failed');
 }
 }catch(error){
  if(error instanceof DriveError&&/^[a-z_]+$/.test(error.code))throw new ConnectError(`drive_${stage}_${error.code}`);
  throw error;
 }
}
async function main(){
 if(process.argv.length!==4||process.argv[2]!=='--client-file'){
  process.stdout.write('Cách dùng: node scripts/connect-google-drive.mjs --client-file <đường-dẫn-JSON-OAuth>\n');return;
 }
 let client;try{const file=JSON.parse(await readFile(process.argv[3],'utf8'));client=validateClient(file.web);}catch{throw new ConnectError('invalid_client');}
 await verifyDestination();
 const flow=createAuthorization({clientId:client.clientId,loginHint:ownerEmail}),expires=Date.now()+10*60_000;
 const server=http.createServer(createDriveConnectHandler({flow,expires,siteUrl,run:async(code,verifier)=>{
   const token=await exchangeCode({...client,code,verifier});
   await verifyDrive(token.accessToken);
   await verifyDestination();
   for(const [name,value] of [[secretNames[0],client.clientId],[secretNames[1],client.clientSecret],[secretNames[2],token.refreshToken]])await wrangler(['pages','secret','put',name,'--project-name',project],value);
  },onFinished:error=>{
   if(error){process.stderr.write(`Không hoàn tất kết nối (${error instanceof ConnectError?error.code:'drive_or_network'}). Kiểm tra trạng thái trước khi thử lại.\n`);process.exitCode=1;}
   else process.stdout.write('Đã kiểm tra Drive và lưu thông tin kết nối vào Cloudflare Pages.\n');
   const closeTimer=setTimeout(()=>server.close(),60_000);closeTimer.unref();
  }}));
 server.requestTimeout=30000;server.headersTimeout=10000;
 server.listen(48421,'127.0.0.1',()=>process.stdout.write('Mở trong trình duyệt: http://127.0.0.1:48421/start\n'));
 server.on('error',()=>{process.stderr.write('Không thể mở cổng nội bộ 48421.\n');process.exitCode=1;});
 const timeout=setTimeout(()=>{server.close();process.exitCode=1;process.stderr.write('Phiên kết nối đã hết hạn.\n');},10*60_000);timeout.unref();server.on('close',()=>clearTimeout(timeout));
}
main().catch(error=>{process.stderr.write(`Chưa thể chuẩn bị kết nối (${error instanceof ConnectError?error.code:'setup_failed'}).\n`);process.exitCode=1;});
