import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleDrive, DriveError} from '../worker/google-drive.mjs';

test('Drive adapter reserves IDs and creates a folder under a specific parent', async () => {
  const calls=[];
  const drive=createGoogleDrive({accessToken:'test-token',fetchImpl:async(url,options)=>{
    calls.push({url,options});
    return new Response(JSON.stringify(url.includes('/about?')?{user:{emailAddress:'admin@example.com'}}:url.includes('generateIds')?{ids:['generated_1']}:{id:'folder_1'}),{status:200});
  }});
  await drive.verifyOwner();
  assert.equal(await drive.reserveId(),'generated_1');
  assert.equal(await drive.createFolder({id:'folder_1',parentId:'root',name:'Năm học 2026–2027'}),'folder_1');
  assert.equal(calls[0].options.redirect,'manual');
  assert.equal(calls[0].options.headers.authorization,'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[2].options.body),{id:'folder_1',name:'Năm học 2026–2027',mimeType:'application/vnd.google-apps.folder',parents:['root']});
  assert.ok(calls.every(call=>new URL(call.url).origin==='https://www.googleapis.com'));
});

test('Drive multipart upload contains the reserved ID, parent and exact bytes', async () => {
  let sent;
  const drive=createGoogleDrive({accessToken:'token',fetchImpl:async(url,options)=>{if(url.includes('/about?'))return new Response('{"user":{"emailAddress":"admin@example.com"}}');sent={url,options};return new Response('{"id":"file_1"}');}});
  await drive.verifyOwner();
  const bytes=new Uint8Array([0,1,2,255]);
  assert.equal(await drive.upload({id:'file_1',parentId:'lesson_1',name:'Bài 1.pdf',contentType:'application/pdf',bytes}),'file_1');
  assert.match(sent.url,/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=multipart/);
  assert.match(sent.options.headers['content-type'],/^multipart\/related; boundary=ltch_[a-f0-9]+$/);
  const data=new Uint8Array(await sent.options.body.arrayBuffer());
  assert.ok(Buffer.from(data).includes(Buffer.from(bytes)));
  assert.match(new TextDecoder().decode(data),/"id":"file_1","name":"Bài 1.pdf","parents":\["lesson_1"\]/);
});

test('Drive rejects unsafe IDs, types, oversized files and redirects before exposing data',async()=>{
 let calls=0;
 const drive=createGoogleDrive({accessToken:'token',fetchImpl:async(url)=>{if(url.includes('/about?'))return new Response('{"user":{"emailAddress":"admin@example.com"}}');calls++;throw Error('redirect to attacker or network failure');}});
 await drive.verifyOwner();
 await assert.rejects(drive.download({id:'../evil'}),e=>e.code==='invalid_id');
 await assert.rejects(drive.upload({id:'x',parentId:'p',name:'x',contentType:'text/html\r\nX: evil',bytes:new Uint8Array([1])}),e=>e.code==='invalid_type');
 await assert.rejects(drive.upload({id:'x',parentId:'p',name:'x',contentType:'application/pdf',bytes:new Uint8Array(10_000_001)}),e=>e.code==='invalid_size');
 assert.equal(calls,0);
 await assert.rejects(drive.download({id:'valid'}),e=>e instanceof DriveError&&e.code==='network'&&!e.message.includes('attacker'));
 const redirected=createGoogleDrive({accessToken:'token',fetchImpl:async(url,options)=>url.includes('/about?')?new Response('{"user":{"emailAddress":"admin@example.com"}}'):new Response(null,{status:302,headers:{location:'https://attacker.invalid'}})});
 await redirected.verifyOwner();await assert.rejects(redirected.download({id:'valid'}),e=>e.code==='upstream');
});

test('conflict remains an error and mismatched IDs never count as a successful upload',async()=>{
 const args={id:'expected',parentId:'parent',name:'file',contentType:'application/pdf',bytes:new Uint8Array([1])};
 const conflict=createGoogleDrive({accessToken:'token',fetchImpl:async(url)=>url.includes('/about?')?new Response('{"user":{"emailAddress":"admin@example.com"}}'):new Response('',{status:409})});
 await conflict.verifyOwner();
 await assert.rejects(conflict.upload(args),e=>e.code==='conflict');
 const mismatch=createGoogleDrive({accessToken:'token',fetchImpl:async(url)=>url.includes('/about?')?new Response('{"user":{"emailAddress":"admin@example.com"}}'):new Response('{"id":"wrong"}')});
 await mismatch.verifyOwner();
 await assert.rejects(mismatch.upload(args),e=>e.code==='invalid_response');
});

test('Drive operations fail closed for an unverified or different Google account',async()=>{
 let calls=0;
 const drive=createGoogleDrive({accessToken:'token',fetchImpl:async()=>{calls++;return new Response('{"user":{"emailAddress":"someone@example.com"}}');}});
 await assert.rejects(drive.reserveId(),e=>e.code==='owner_unverified');
 await assert.rejects(drive.verifyOwner(),e=>e.code==='wrong_account');
 await assert.rejects(drive.reserveId(),e=>e.code==='owner_unverified');
 assert.equal(calls,1);
});

test('root placement is checked through app-visible children, including pagination',async()=>{
 const queries=[];
 const drive=createGoogleDrive({accessToken:'token',fetchImpl:async(url)=>{
  if(url.includes('/about?'))return Response.json({user:{emailAddress:'admin@example.com'}});
  const params=new URL(url).searchParams;queries.push(params);
  return Response.json(params.get('pageToken')?{files:[{id:'folder_1'}]}:{files:[],nextPageToken:'next'});
 }});
 await drive.verifyOwner();assert.equal(await drive.rootId(),'root');
 assert.equal(await drive.isRootChild({id:'folder_1',name:"Lớp O'Hanh"}),true);
 assert.match(queries[0].get('q'),/'root' in parents/);
 assert.ok(queries[0].get('q').includes("O\\'Hanh"));assert.equal(queries[1].get('pageToken'),'next');
});
