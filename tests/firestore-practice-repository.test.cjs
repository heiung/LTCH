'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createFirestorePracticeRepository}=require('../server/integrations/firestore-practice-repository.cjs');
test('practice persistence uses create-only writes and does not hide storage failures', async()=>{
 const docs=new Map();const db={collection:name=>({doc:id=>({get:async()=>({exists:docs.has(name+id),data:()=>docs.get(name+id)}),create:async data=>{const key=name+id;if(docs.has(key)){const e=new Error('exists');e.code=6;throw e;}docs.set(key,data);}})})};
 const repo=createFirestorePracticeRepository(db), attempt={attemptId:'attempt1',examId:'exam1',uid:'user1'};
 assert.equal(await repo.saveAttemptOnce(attempt),true);assert.equal(await repo.saveAttemptOnce(attempt),false);
 assert.equal((await repo.getAttempt('attempt1')).uid,'user1');assert.equal(await repo.getAttempt('../bad'),null);
 const broken=createFirestorePracticeRepository({collection:()=>({doc:()=>({create:async()=>{throw new Error('offline');}})})});
 await assert.rejects(broken.saveAttemptOnce(attempt),/offline/);
});
