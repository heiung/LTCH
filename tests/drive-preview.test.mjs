import test from 'node:test';
import assert from 'node:assert/strict';
import {requireAllowedSharing,enableLinkSharing,drivePreviewUrl} from '../worker/drive-preview.mjs';
import {createGoogleDrive} from '../worker/google-drive.mjs';

const record={drive_file_id:'abc_123',name:'Bài.pdf',content_type:'application/pdf',file_size:10,sha256:'a'.repeat(64)};
const metadata=()=>({id:record.drive_file_id,name:record.name,mimeType:record.content_type,size:'10',appProperties:{ltchSha256:record.sha256},trashed:false,ownedByMe:true,shared:false,parents:['lesson']});
const owner={type:'user',role:'owner'},link={type:'anyone',role:'reader',allowFileDiscovery:false};

test('preview refuses a private file and the URL cannot redirect to another origin',async()=>{
 await assert.rejects(requireAllowedSharing({},metadata(),record,{allowLink:true,requireLink:true}),e=>e.status===409);
 assert.equal(drivePreviewUrl('abc_123'),'https://drive.google.com/file/d/abc_123/preview');
 assert.throws(()=>drivePreviewUrl('../evil'),e=>e.status===503);
});
test('explicit enable grants only link-reader and verifies the final permission',async()=>{
 let shared=false,grants=0;const drive={permissions:async()=>shared?[owner,link]:[owner],shareWithLink:async()=>{grants++;shared=true;},metadata:async()=>({...metadata(),shared})};
 await enableLinkSharing(drive,metadata(),record,{parentId:'lesson'});assert.equal(grants,1);
 await enableLinkSharing(drive,{...metadata(),shared:true},record,{parentId:'lesson'});assert.equal(grants,1);
});
test('unexpected public, edit, other-user and mismatched file access fail closed',async()=>{
 for(const permission of [{type:'anyone',role:'writer'}, {type:'anyone',role:'reader',allowFileDiscovery:true}, {type:'user',role:'reader'}]){
  await assert.rejects(requireAllowedSharing({permissions:async()=>[owner,permission]},{...metadata(),shared:true},record,{allowLink:true,requireLink:true}),e=>e.status===503);
 }
 await assert.rejects(enableLinkSharing({permissions:async()=>[owner],shareWithLink:async()=>{},metadata:async()=>metadata()},metadata(),record),e=>e.status===409);
 await assert.rejects(requireAllowedSharing({}, {...metadata(),size:'11'},record),e=>e.status===503);
});
test('Drive sharing uses a fixed Google endpoint and non-discoverable reader permission',async()=>{
 const calls=[];const drive=createGoogleDrive({accessToken:'token',fetchImpl:async(url,options)=>{
  calls.push({url,options});if(url.includes('/about?'))return Response.json({user:{emailAddress:'admin@example.com'}});
  if(options.method==='POST')return Response.json({id:'anyoneWithLink',type:'anyone',role:'reader',allowFileDiscovery:false});
  return Response.json({permissions:[owner,link]});
 }});
 await drive.verifyOwner();await drive.shareWithLink({id:'abc_123'});assert.equal((await drive.permissions({id:'abc_123'})).length,2);
 assert.deepEqual(JSON.parse(calls[1].options.body),{type:'anyone',role:'reader',allowFileDiscovery:false});
 assert.ok(calls.every(call=>new URL(call.url).origin==='https://www.googleapis.com'&&call.options.redirect==='manual'));
});
