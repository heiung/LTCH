import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1OtpStore } from '../worker/d1-stores.mjs';
test('OTP store retries a conflicting write instead of losing the update', async () => {
 let record = {version:1,payload:JSON.stringify({attempts:0})}; let conflict=true;
 const db={prepare(sql){return {bind(...args){return {first:async()=>({...record}),run:async()=>{if(conflict){conflict=false;record={version:2,payload:JSON.stringify({attempts:1})};return {meta:{changes:0}};}assert.equal(args[2],2);record={version:3,payload:args[0]};return {meta:{changes:1}};}}}}}};
 const value=await createD1OtpStore(db).update('user',prev=>({next:{attempts:prev.attempts+1},value:prev.attempts+1}));
 assert.equal(value,2);assert.equal(JSON.parse(record.payload).attempts,2);
});
