import test from 'node:test';import assert from 'node:assert/strict';import {createAccountHandler} from '../worker/account-handler.mjs';import {createSupabaseRepository} from '../worker/supabase-repository.mjs';
test('account endpoints require OTP session and active account',async()=>{
 let authenticated=false,active=true;const handler=createAccountHandler({auth:{authenticate:async()=>authenticated?{uid:'user'}:null},repository:{actor:async()=>active?{uid:'user',name:'Test',roles:['student']}:null,classesFor:async()=>[]}});
 let response=await handler(new Request('https://example.test/api/me'),'/api/me');assert.equal(response.status,401);
 authenticated=true;active=false;response=await handler(new Request('https://example.test/api/me'),'/api/me');assert.equal(response.status,403);
 active=true;response=await handler(new Request('https://example.test/api/me'),'/api/me');assert.equal(response.status,200);assert.deepEqual(await response.json(),{uid:'user',name:'Test',roles:['student'],memberships:[],childMemberships:[]});
});
test('class queries restrict mixed-role users to explicitly matched membership roles',async()=>{
 let filter;const query={eq(key,value){assert.equal(key,'archived');assert.equal(value,false);return this},order(){return this},limit(){return this},in(_,ids){filter=ids;return Promise.resolve({data:[],error:null})}};
 const db={from(){return {select(){return query}}}};const repo=createSupabaseRepository(db);
 await repo.classesFor({status:'active',roles:['student'],memberships:[{class_id:'allowed',member_role:'student'},{class_id:'denied',member_role:'teacher'}]});assert.deepEqual(filter,['allowed']);
});
