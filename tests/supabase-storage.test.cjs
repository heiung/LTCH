const test=require('node:test'); const assert=require('node:assert/strict');
const {createSupabaseStorage}=require('../server/integrations/supabase-storage.cjs');
test('private storage uses fixed origin, rejects unsafe paths and fails on upload errors',async()=>{
 const calls=[];let ok=true;const storage=createSupabaseStorage({projectUrl:'https://abcdefghijklmnopqrst.supabase.co',secretKey:'secret',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok};}});
 const result=await storage.upload({bucket:'ltch-submissions',path:'2026/class1/student1/file.pdf',bytes:new Uint8Array([37,80,68,70,45]),contentType:'application/pdf'});
 assert.equal(result.size,5); assert.match(calls[0].url,/\/storage\/v1\/object\/ltch-submissions\//); assert.equal(calls[0].options.headers['x-upsert'],'false');
 await assert.rejects(storage.upload({bucket:'ltch-submissions',path:'../file.pdf',bytes:new Uint8Array([37,80,68,70,45]),contentType:'application/pdf'}));
 await assert.rejects(storage.upload({bucket:'ltch-submissions',path:'file.exe',bytes:new Uint8Array([37,80,68,70,45]),contentType:'application/x-msdownload'}));
 ok=false;await assert.rejects(storage.upload({bucket:'ltch-submissions',path:'file.pdf',bytes:new Uint8Array([37,80,68,70,45]),contentType:'application/pdf'}),/failed/);
 assert.throws(()=>createSupabaseStorage({projectUrl:'https://evil.example',secretKey:'secret'}));
});

test('modern server keys stay in apikey while legacy JWT authorization is preserved',async()=>{
 for(const secretKey of ['sb_secret_test-only','legacy.jwt.test']){
  const calls=[];const storage=createSupabaseStorage({projectUrl:'https://abcdefghijklmnopqrst.supabase.co',secretKey,fetchImpl:async(url,options)=>{calls.push(options);return {ok:true};}});
  await storage.upload({bucket:'ltch-materials',path:'qa.png',bytes:new Uint8Array([137,80,78,71,13,10,26,10]),contentType:'image/png'});
  await storage.download({bucket:'ltch-materials',path:'qa.png'});
  for(const call of calls){assert.equal(call.headers.apikey,secretKey);assert.equal(call.headers.authorization,secretKey.startsWith('sb_secret_')?undefined:`Bearer ${secretKey}`);assert.equal(call.redirect,'manual');}
 }
});

test('storage rejects redirects without following them on the edge',async()=>{
 const calls=[];const storage=createSupabaseStorage({projectUrl:'https://abcdefghijklmnopqrst.supabase.co',secretKey:'sb_secret_test-only',fetchImpl:async(url,options)=>{calls.push(options);return new Response(null,{status:302,headers:{location:'https://other.example'}});}});
 await assert.rejects(storage.upload({bucket:'ltch-materials',path:'qa.pdf',bytes:new Uint8Array([37,80,68,70,45]),contentType:'application/pdf'}),/Storage upload failed/);
 await assert.rejects(storage.download({bucket:'ltch-materials',path:'qa.pdf'}),/Storage download failed/);
 assert.equal(calls.length,2);assert.ok(calls.every(call=>call.redirect==='manual'));
});

