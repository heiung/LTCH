import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseOtpStore,createSupabaseRateLimiter} from '../worker/supabase-stores.mjs';
test('OTP updates retry concurrent changes and never ignore database errors',async()=>{
 let row={version:1,payload:{attempts:0}}, conflict=true;
 const db = { from() { return {
   select() { return { eq() { return { maybeSingle: async()=>({data:row,error:null}) }; } }; },
   update(value) { return { eq() { return { eq() { return { select: async()=>{
     if(conflict){conflict=false;row={version:2,payload:{attempts:1}};return {data:[],error:null};}
     row=value;return {data:[{version:value.version}],error:null};
   } }; } }; } }; }
 }; } };
 const store=createSupabaseOtpStore(db);
 assert.equal(await store.update('uid',prev=>({next:{attempts:prev.attempts+1},value:prev.attempts+1})),2);
 assert.equal(row.payload.attempts,2);
 const bad={from(){return {select(){return {eq(){return {maybeSingle:async()=>({error:{code:'offline'}})};}};}};}};
 await assert.rejects(createSupabaseOtpStore(bad).update('uid',()=>({next:null,value:false})),/Database request failed/);
});
test('rate limiting fails closed without trusted IP and calls an atomic database function',async()=>{
 let called=0;const db={rpc:async(name,args)=>{called++;assert.equal(name,'ltch_consume_rate');assert.match(args.p_id,/^[a-f0-9]{64}$/);return {data:true,error:null};}};
 const limit=createSupabaseRateLimiter(db,()=>1800000000000);
 assert.equal(await limit(new Request('https://example.test'),'begin'),false);assert.equal(called,0);
 assert.equal(await limit(new Request('https://example.test',{headers:{'CF-Connecting-IP':'192.0.2.1'}}),'begin'),true);assert.equal(called,1);
});
test('every rate policy fits the database function limit, including forum posts',async()=>{
 const db={rpc:async(_name,{p_max})=>p_max>=1 && p_max<=100?{data:true}:{error:{message:'invalid rate limit'}}};
 const limit=createSupabaseRateLimiter(db,()=>1800000000000);
 const request=new Request('https://example.test',{headers:{'CF-Connecting-IP':'192.0.2.1'}});
 for(const action of ['begin','complete','enrollment','urgent','staffRequest','forum']) assert.equal(await limit(request,action),true,action);
});
