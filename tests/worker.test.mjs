import test from 'node:test';import assert from 'node:assert/strict';import worker,{createWorker} from '../worker/index.mjs';import {createHash} from 'node:crypto';
const origin='https://ltch.example.com';
const env={ALLOWED_ORIGIN:origin,SUPABASE_URL:'https://your-project.supabase.co',SUPABASE_SECRET:'test-only',OTP_SECRET:'x'.repeat(32),MAIL_SECRET:'x'.repeat(32),MAIL_ENDPOINT:'https://script.google.com/macros/s/test/exec',FIREBASE_API_KEY:'public-config'};
test('unconfigured Worker and cross-origin requests fail closed',async()=>{
 const r=await worker.fetch(new Request('https://example.test/api/auth/begin',{method:'POST',headers:{origin}}),{ALLOWED_ORIGIN:origin});assert.equal(r.status,503);
 const health=await worker.fetch(new Request('https://example.test/api/health?sync=1'),{});assert.equal(health.status,200);assert.equal((await health.json()).sync,undefined);
 const badSupabase=await worker.fetch(new Request('https://example.test/api/health'),{...env,SUPABASE_URL:'https://evil.example.com'});assert.equal(badSupabase.status,200);assert.equal((await badSupabase.json()).configured,false);
 const badSupabaseApi=await worker.fetch(new Request('https://example.test/api/me',{headers:{origin}}),{...env,SUPABASE_URL:'https://evil.example.com'});assert.equal(badSupabaseApi.status,503);
 const bad=await worker.fetch(new Request('https://example.test/api/me',{headers:{origin:'https://evil.test'}}),env);assert.equal(bad.status,403);assert.equal(bad.headers.get('access-control-allow-origin'),null);
 const options=await worker.fetch(new Request('https://example.test/api/me',{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET','access-control-request-headers':'Authorization, X-Firebase-Token'}}),env);assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),origin);assert.equal(options.headers.get('access-control-allow-credentials'),null);
});

test('health distinguishes configuration from database connectivity',async()=>{
 let reads=0,failed=false;
 const db={from(){return {select(){return this;},async limit(){reads++;return failed?{error:{message:'offline'}}:{data:[],error:null};}};}};
 const app=createWorker({db});const req=()=>new Request('https://example.test/api/health');
 const first=await (await app.fetch(req(),env)).json();assert.equal(first.configured,true);assert.equal(first.ready,true);assert.equal(first.checks.database,'ok');assert.equal(first.checks.mail,'not_checked');
 await app.fetch(req(),env);assert.equal(reads,1);
 failed=true;const offline=createWorker({db});const result=await (await offline.fetch(req(),env)).json();assert.equal(result.configured,true);assert.equal(result.ready,false);assert.equal(result.checks.database,'unavailable');
});
test('CORS preflights enforce the exact website, method and header allowlist without touching the database',async()=>{
 const app=createWorker({db:{from(){throw Error('Preflight must not query data');}}});
 const headers={origin,'access-control-request-method':'POST','access-control-request-headers':'authorization, content-type, x-firebase-token'};
 const preflight=(changes={},config=env,path='/api/enrollment/submit')=>app.fetch(new Request('https://example.test'+path,{method:'OPTIONS',headers:{...headers,...changes}}),config);
 const good=await preflight();assert.equal(good.status,204);assert.equal(good.headers.get('access-control-max-age'),'600');assert.match(good.headers.get('vary'),/Access-Control-Request-Headers/);assert.match(good.headers.get('vary'),/Origin/);
 for(const changes of [{origin:'null'},{origin:'https://ltch.example.com.evil.test'},{'access-control-request-method':'DELETE'},{'access-control-request-headers':'authorization,x-unapproved'}])assert.equal((await preflight(changes)).status,403);
 assert.equal((await preflight({},env,'/other')).status,403);
 for(const allowed of ['*','https://evil.test',undefined]){const bad=await preflight({}, {...env,ALLOWED_ORIGIN:allowed});assert.equal(bad.status,403);assert.equal(bad.headers.get('access-control-allow-origin'),null);}
});
test('browser-visible authorization errors have CORS and no-store headers; absent origins gain no access',async()=>{
 const unauthorized=await worker.fetch(new Request('https://example.test/api/me',{headers:{origin,authorization:'ConnectionCheck','x-firebase-token':'connection-check'}}),env);
 assert.equal(unauthorized.status,401);assert.equal(unauthorized.headers.get('access-control-allow-origin'),origin);assert.equal(unauthorized.headers.get('cache-control'),'no-store');
 const absent=await worker.fetch(new Request('https://example.test/api/me'),env);assert.equal(absent.status,403);assert.equal(absent.headers.get('access-control-allow-origin'),null);assert.match(absent.headers.get('vary'),/Origin/);
});
test('Firebase ID token cannot replace an OTP session; session must belong to the current Firebase identity',async()=>{
 const token='a'.repeat(43),hash=createHash('sha256').update(token).digest('hex');
 const db={from(name){assert.equal(name,'ltch_sessions');return {select(){return {eq(_,value){return {maybeSingle:async()=>({data:value===hash?{uid:'owner',created_at:Date.now()-1000,expires_at:Date.now()+60000}:null,error:null})}}}}}}};
 const app=createWorker({db,verify:async()=>({uid:'different-user'})});
 for(const authorization of ['Bearer firebase-token',`Session ${token}`]){const r=await app.fetch(new Request('https://example.test/api/me',{headers:{origin,authorization,'x-firebase-token':'firebase'}}),env);assert.equal(r.status,401);}
});
test('concurrent lesson uploads are bounded per worker and the slot is released after failure',async()=>{
 const token='a'.repeat(43),hash=createHash('sha256').update(token).digest('hex');
 const db={rpc:async()=>({data:true,error:null}),from(name){let value;const q={select(){return q},eq(_,v){value=v;return q},maybeSingle:async()=>({data:name==='ltch_sessions'&&value===hash?{uid:'owner',created_at:Date.now()-1000,expires_at:Date.now()+60000}:name==='ltch_accounts'?{uid:'owner',display_name:'Owner',email:'test@example.test',status:'active',roles:['admin']}:null,error:null}),then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)}};return q}};
 let release,started;const entered=new Promise(resolve=>{started=resolve});let calls=0;
 const app=createWorker({db,verify:async()=>({uid:'owner'}),business:async()=>{calls++;if(calls===1){started();await new Promise(resolve=>{release=resolve});throw Error('synthetic failure');}return new Response('{}',{status:200});}});
 const send=()=>app.fetch(new Request('https://example.test/api/classes/c/lessons/l/files',{method:'POST',headers:{origin,authorization:`Session ${token}`,'x-firebase-token':'test','CF-Connecting-IP':'127.0.0.1'}}),env);
 const first=send();await entered;assert.equal((await send()).status,429);release();assert.equal((await first).status,500);assert.equal((await send()).status,200);assert.equal(calls,2);
});
