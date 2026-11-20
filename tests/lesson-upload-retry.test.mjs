import test from 'node:test';
import assert from 'node:assert/strict';
import {createLessonUploadRetry} from '../client/lesson-upload-retry.mjs';

function memoryStorage() {
 const values=new Map();
 return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
const file=(bytes,name='test.pdf')=>new File([bytes],name,{type:'application/pdf'});
const args={uid:'teacher',classId:'class-a',lessonId:'lesson-a'};

test('a reselected file in the same tab keeps its request ID after reload until confirmed',async()=>{
 const storage=memoryStorage(), options={storage:()=>storage,clock:()=>1000};
 const first=await createLessonUploadRetry(options).prepare({...args,file:file('test data')});
 assert.equal(first.persisted,true);
 assert.doesNotMatch([...storage.values.values()].join(' '),/test data|test\.pdf|teacher/);
 const reloaded=createLessonUploadRetry(options),retry=await reloaded.prepare({...args,file:file('test data')});
 assert.equal(retry.requestId,first.requestId);
 reloaded.complete(retry.key);
 assert.notEqual((await reloaded.prepare({...args,file:file('test data')})).requestId,first.requestId);
});

test('changed bytes, names, lessons and accounts do not reuse the request ID',async()=>{
 const storage=memoryStorage(), retry=createLessonUploadRetry({storage:()=>storage});
 const original=await retry.prepare({...args,file:file('first')});
 for(const changed of [
  {...args,file:file('second')}, {...args,file:file('first','other.pdf')},
  {...args,uid:'other',file:file('first')}, {...args,lessonId:'other',file:file('first')}
 ]) assert.notEqual((await retry.prepare(changed)).requestId,original.requestId);
});

test('expired IDs are replaced; unavailable storage still permits retry on the current page',async()=>{
 const storage=memoryStorage();let time=1000;
 const retry=createLessonUploadRetry({storage:()=>storage,clock:()=>time}),first=await retry.prepare({...args,file:file('x')});
 time+=24*60*60*1000+1;
 assert.notEqual((await retry.prepare({...args,file:file('x')})).requestId,first.requestId);
 const unavailable=createLessonUploadRetry({storage:()=>{throw Error('storage unavailable');}});
 const a=await unavailable.prepare({...args,file:file('x')}),b=await unavailable.prepare({...args,file:file('x')});
 assert.equal(a.persisted,false);assert.equal(a.requestId,b.requestId);
});
