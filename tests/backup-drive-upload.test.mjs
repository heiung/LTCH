import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackupDriveUpload} from '../worker/backup-drive-upload.mjs';

const session='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=synthetic';
const folder={id:'folder1',mimeType:'application/vnd.google-apps.folder',trashed:false,shared:false,ownedByMe:true};
const owner={user:{emailAddress:'admin@example.com'}};

test('start requires the official owner and a private folder before initiating a synthetic upload',async()=>{
 const calls=[];
 const upload=createBackupDriveUpload({accessToken:'test',fetchImpl:async(url,opts)=>{calls.push({url,opts});if(url.includes('/about?'))return Response.json(owner);if(url.includes('/drive/v3/files/folder1?'))return Response.json(folder);return new Response(null,{status:200,headers:{location:session}});}});
 assert.equal(await upload.start({id:'file1',parentId:'folder1',name:'test.bin',total:7}),session);
 assert.deepEqual(JSON.parse(calls[2].opts.body),{id:'file1',name:'test.bin',parents:['folder1']});
 assert.ok(calls.every(c=>c.opts.redirect==='manual'&&new URL(c.url).origin==='https://www.googleapis.com'));
});

test('unsafe folder and untrusted session never receive file bytes or a token',async()=>{
 const calls=[];
 const upload=createBackupDriveUpload({accessToken:'test',fetchImpl:async(url,opts)=>{calls.push(url);return Response.json(url.includes('/about?')?owner:{...folder,shared:true});}});
 await assert.rejects(upload.start({id:'file1',parentId:'folder1',name:'test.bin',total:2}),e=>e.code==='unsafe_folder');
 await assert.rejects(upload.sendChunk({session:'https://attacker.example/upload/drive/v3/files?uploadType=resumable&upload_id=x',total:2,id:'file1',offset:0,bytes:new Uint8Array([1,2])}),e=>e.code==='invalid_session');
 assert.equal(calls.length,2);
});

test('an incorrect Drive owner is rejected before inspecting a folder or starting upload',async()=>{
 let calls=0;
 const upload=createBackupDriveUpload({accessToken:'test',fetchImpl:async()=>{calls++;return Response.json({user:{emailAddress:'different@example.test'}});}});
 await assert.rejects(upload.start({id:'file1',parentId:'folder1',name:'test.bin',total:2}),e=>e.code==='wrong_account');
 assert.equal(calls,1);
});

test('interrupted uploads use Google-confirmed ranges and reject mismatched result IDs',async()=>{
 const headers=[];let response=0;
 const upload=createBackupDriveUpload({accessToken:'test',fetchImpl:async(_url,opts)=>{headers.push(opts.headers);response++;if(response===1)return new Response(null,{status:308,headers:{range:'bytes=0-1'}});if(response===2)return Response.json({id:'wrong'});return Response.json({id:'file1'});}});
 assert.deepEqual(await upload.status({session,total:4,id:'file1'}),{state:'uploading',offset:2});
 assert.equal(headers[0]['content-range'],'bytes */4');
 await assert.rejects(upload.sendChunk({session,total:4,id:'file1',offset:2,bytes:new Uint8Array([3,4])}),e=>e.code==='invalid_response');
 assert.equal(headers[1]['content-range'],'bytes 2-3/4');
 assert.deepEqual(await upload.sendChunk({session,total:4,id:'file1',offset:2,bytes:new Uint8Array([3,4])}),{state:'uploaded',id:'file1',total:4});
});

test('an attacker-supplied session returned by Drive is rejected without following it',async()=>{
 const upload=createBackupDriveUpload({accessToken:'test',fetchImpl:async(url)=>url.includes('/about?')?Response.json(owner):url.includes('/drive/v3/files/folder1?')?Response.json(folder):new Response(null,{status:200,headers:{location:'https://attacker.example/steal'}})});
 await assert.rejects(upload.start({id:'file1',parentId:'folder1',name:'test.bin',total:1}),e=>e.code==='invalid_session');
});

test('a success response before all bytes are sent is rejected',async()=>{
 const upload=createBackupDriveUpload({accessToken:'test',fetchImpl:async()=>Response.json({id:'file1'})});
 await assert.rejects(upload.sendChunk({session,total:8*1024*1024+1,id:'file1',offset:0,bytes:new Uint8Array(8*1024*1024)}),e=>e.code==='invalid_response');
});
