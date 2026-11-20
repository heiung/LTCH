import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiTransport} from '../client/api-transport.mjs';
const origin='https://api.ltch.example.com';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});

test('API transport confines session headers to the configured HTTPS API and refuses redirects/cookies',async()=>{
 let calls=0;
 const request=createApiTransport(origin,{fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,origin+'/api/me');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.mode,'cors');assert.equal(options.cache,'no-store');
  assert.equal(options.headers.authorization,'Session test');return json({uid:'test'});
 }});
 assert.deepEqual((await request('/api/me',{headers:{authorization:'Session test'}})).data,{uid:'test'});
 for(const path of ['https://evil.test/api/me','//evil.test/api/me','/api/../../other','/api/\\evil.test/api/me','/api/me#fragment'])await assert.rejects(request(path),/Invalid API path/);
 assert.equal(calls,1);
 assert.throws(()=>createApiTransport('http://api.ltch.example.com'),/Invalid API origin/);
});
test('a temporary read failure is retried once; authentication failures remain visible',async()=>{
 let calls=0;
 const request=createApiTransport(origin,{pause:async()=>{},fetchImpl:async()=>{if(++calls===1)throw new TypeError('network');return json({error:'Vui lòng đăng nhập.'},401);}});
 const result=await request('/api/me');assert.equal(calls,2);assert.equal(result.status,401);assert.equal(result.ok,false);
});
test('temporary gateway failures can retry reads but never duplicate a write',async()=>{
 let reads=0,writes=0;
 const request=createApiTransport(origin,{pause:async()=>{},fetchImpl:async(_,options)=>{
  if(options.method==='POST'){writes++;return json({error:'busy'},503);}
  return ++reads===1?new Response('gateway',{status:502}):json({ok:true});
 }});
 assert.equal((await request('/api/health')).data.ok,true);assert.equal(reads,2);
 assert.equal((await request('/api/enrollment/submit',{method:'POST',body:'payload'})).status,503);assert.equal(writes,1);
});
 test('lost write responses are not retried and advise checking the saved state',async()=>{
  let calls=0;
  const request=createApiTransport(origin,{fetchImpl:async()=>{calls++;throw new TypeError('network');}});
  await assert.rejects(request('/api/admin/enrollments/review',{method:'POST'}),/kiểm tra trạng thái/);assert.equal(calls,1);
 });
 test('idempotent POST writes retry up to 3 times on transient network or gateway errors and recover cleanly',async()=>{
  let netCalls=0;
  const netRecover=createApiTransport(origin,{pause:async()=>{},fetchImpl:async()=>{if(++netCalls<3)throw new TypeError('network');return json({ok:true});}});
  assert.equal((await netRecover('/api/admin/accounts',{method:'POST',idempotent:true,body:'{}'})).data.ok,true);
  assert.equal(netCalls,3);

  let gwCalls=0;
  const gwRecover=createApiTransport(origin,{pause:async()=>{},fetchImpl:async()=>{return ++gwCalls===1?new Response('bad gateway',{status:502}):json({ok:true});}});
  assert.equal((await gwRecover('/api/admin/accounts',{method:'POST',idempotent:true,body:'{}'})).data.ok,true);
  assert.equal(gwCalls,2);

  let exhaustedCalls=0;
  const exhausted=createApiTransport(origin,{pause:async()=>{},fetchImpl:async()=>{exhaustedCalls++;throw new TypeError('network');}});
  await assert.rejects(exhausted('/api/admin/accounts',{method:'POST',idempotent:true,body:'{}'}),err=>{
   assert.match(err.message,/bấm Lưu lại/);
   assert.doesNotMatch(err.message,/tránh thao tác trùng/);
   return true;
  });
  assert.equal(exhaustedCalls,3);
 });
test('timeouts release a stalled connection and leave writes at one attempt',async()=>{
 let calls=0;
 const request=createApiTransport(origin,{fetchImpl:async(_,options)=>{calls++;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));}});
 await assert.rejects(request('/api/auth/begin',{method:'POST',timeoutMs:5}),/kiểm tra trạng thái/);assert.equal(calls,1);
});

test('advisory availability checks can fail quickly without a retry',async()=>{
 let calls=0;
 const request=createApiTransport(origin,{fetchImpl:async()=>{calls++;return json({error:'busy'},503);}});
 assert.equal((await request('/api/health',{retry:false,timeoutMs:5000})).status,503);
 assert.equal(calls,1);
});
test('HTML from an incorrect route is rejected and multipart/file responses remain intact',async()=>{
 const wrong=createApiTransport(origin,{fetchImpl:async()=>new Response('<html>landing page</html>',{headers:{'content-type':'text/html'}})});
 await assert.rejects(wrong('/api/me'),/dữ liệu không hợp lệ/);
 const body=new FormData();body.append('photo',new Blob(['private photo'],{type:'image/png'}),'photo.png');
 const request=createApiTransport(origin,{fetchImpl:async(_,options)=>{assert.equal(options.body,body);assert.equal(new Headers(options.headers).has('content-type'),false);return new Response('protected bytes',{headers:{'content-type':'image/png'}});}});
 const result=await request('/api/enrollment/photo',{method:'POST',body,blob:true});assert.equal(await result.data.text(),'protected bytes');
});
