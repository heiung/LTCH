import test from 'node:test';
import assert from 'node:assert/strict';
import {data} from '../worker/policy.mjs';

test('student-code allocation errors are actionable without exposing database details',()=>{
 assert.throws(()=>data({error:{message:'LTCH_STUDENT_CODE_GRADE'}}),e=>e.status===400 && /khối lớp/.test(e.message));
 assert.throws(()=>data({error:{message:'LTCH_STUDENT_CODE_EXHAUSTED'}}),e=>e.status===409 && /hết mã/.test(e.message));
 assert.throws(()=>data({error:{message:'internal detail'}}),e=>e.status===503 && !e.message.includes('internal detail'));
});
