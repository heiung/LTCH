import test from 'node:test';
import assert from 'node:assert/strict';
import {enrollment} from '../worker/enrollment-handler.mjs';

test('multipart registration uploads typed image bytes, logs consent evidence, and saves the selected applicant role',async t=>{
 const saved=[],audits=[],uploaded=[];
 const db={async rpc(name,args){assert.equal(name,'ltch_submit_enrollment');saved.push(args.p_row);audits.push({event:`consent_privacy:${args.p_policy}`,version:args.p_row.version});return {data:args.p_id};},from(table){return {select(){return this;},eq(){return this;},in(){return this;},async maybeSingle(){return {data:table==='ltch_classes'?{id:'class1'}:null};},insert(row){if(table==='ltch_enrollment_audit')audits.push(row);else saved.push(row);return this;},then(resolve){resolve({data:[{id:'request1'}]});}};}};
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.match(url,/\/storage\/v1\/object\/ltch-materials\/profiles\/test-user\//);assert.ok(options.body instanceof Uint8Array);uploaded.push(options.body);return {ok:true};});
 for(const role of ['student','parent']){
  const form=new FormData();for(const [key,value]of Object.entries({applicantRole:role,classId:'class1',schoolYearId:'year1',fullName:'QA Student',dateOfBirth:'2014-01-01',schoolName:'QA School',parentName:'QA Parent',parentPhone:'0900000000',parentRelation:'mother',consentPrivacy:'true',policyVersion:'1.0'}))form.set(key,value);
  form.set('photo',new File([new Uint8Array([137,80,78,71,13,10,26,10])],'qa.png',{type:'image/png'}));
  const response=await enrollment(new Request('https://test/api/enrollment/submit',{method:'POST',body:form}),'/api/enrollment/submit',{db,actor:{uid:'test-user',status:'pending',roles:[]},env:{SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_SECRET:'test-only'},limit:async()=>true});
  assert.equal(response.status,200);assert.equal((await response.json()).status,'pending');assert.equal(saved.at(-1).applicant_role,role);assert.match(saved.at(-1).photo_path,/^profiles\/test-user\/.*\.png$/);assert.equal(audits.at(-1).event,'consent_privacy:1.0');
 }
 assert.equal(uploaded.length,2);
 assert.equal(audits.length,2);
});

test('registration succeeds without an image and does not access file storage',async t=>{
 const saved=[],audits=[];
 const db={async rpc(name,args){assert.equal(name,'ltch_submit_enrollment');saved.push(args.p_row);audits.push({event:`consent_privacy:${args.p_policy}`,version:args.p_row.version});return {data:args.p_id};},from(table){return {select(){return this;},eq(){return this;},in(){return this;},async maybeSingle(){return {data:table==='ltch_classes'?{id:'class1'}:null};},insert(row){if(table==='ltch_enrollment_audit')audits.push(row);else saved.push(row);return this;},then(resolve){resolve({data:[{id:'request1'}]});}};}};
 t.mock.method(globalThis,'fetch',async()=>{throw Error('A registration without a photo must not contact file storage');});
 const form=new FormData();for(const [key,value] of Object.entries({applicantRole:'student',classId:'class1',schoolYearId:'year1',fullName:'QA Student',dateOfBirth:'2014-01-01',schoolName:'QA School',parentName:'QA Parent',parentPhone:'0900000000',parentRelation:'mother',consentPrivacy:'true'}))form.set(key,value);
 const response=await enrollment(new Request('https://test/api/enrollment/submit',{method:'POST',body:form}),'/api/enrollment/submit',{db,actor:{uid:'test-user',status:'pending',roles:[]},env:{},limit:async()=>true});
 assert.equal(response.status,200);assert.equal(saved[0].photo_path,'');assert.equal(audits[0].event,'consent_privacy:1.0');
});

test('revising a registration without a new upload preserves the existing image',async t=>{
 const saved=[],audits=[];
 const db={async rpc(name,args){assert.equal(name,'ltch_submit_enrollment');saved.push(args.p_row);audits.push({event:`consent_privacy:${args.p_policy}`,version:args.p_row.version});return {data:args.p_id};},from(table){return {select(){return this;},eq(){return this;},in(){return this;},async maybeSingle(){return {data:table==='ltch_classes'?{id:'class1'}:{id:'request1',version:1,status:'needs_revision',photo_path:'profiles/test-user/existing.png'}};},update(row){saved.push(row);return this;},insert(row){audits.push(row);return this;},then(resolve){resolve({data:[{id:'request1'}]});}};}};
 t.mock.method(globalThis,'fetch',async()=>{throw Error('An unchanged photo must not contact file storage');});
 const form=new FormData();for(const [key,value] of Object.entries({applicantRole:'student',classId:'class1',schoolYearId:'year1',fullName:'QA Student',dateOfBirth:'2014-01-01',schoolName:'QA School',parentName:'QA Parent',parentPhone:'0900000000',parentRelation:'mother',consentPrivacy:'true'}))form.set(key,value);
 const response=await enrollment(new Request('https://test/api/enrollment/submit',{method:'POST',body:form}),'/api/enrollment/submit',{db,actor:{uid:'test-user',status:'pending',roles:[]},env:{},limit:async()=>true});
 assert.equal(response.status,200);assert.equal(saved[0].photo_path,'profiles/test-user/existing.png');assert.equal(audits[0].version,2);
});

test('registration rejects submission when privacy policy consent is not checked',async ()=>{
 const db={from(table){return {select(){return this;},eq(){return this;},in(){return this;},async maybeSingle(){return {data:table==='ltch_classes'?{id:'class1'}:null};},insert(){throw Error('Must not insert without consent');}};}};
 const form=new FormData();for(const [key,value] of Object.entries({applicantRole:'student',classId:'class1',schoolYearId:'year1',fullName:'QA Student',dateOfBirth:'2014-01-01',schoolName:'QA School',parentName:'QA Parent',parentPhone:'0900000000',parentRelation:'mother'}))form.set(key,value);
 await assert.rejects(()=>enrollment(new Request('https://test/api/enrollment/submit',{method:'POST',body:form}),'/api/enrollment/submit',{db,actor:{uid:'test-user',status:'pending',roles:[]},env:{},limit:async()=>true}),err=>err?.status===400&&/Chính sách bảo vệ dữ liệu cá nhân/.test(err.message));
});
