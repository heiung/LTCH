import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { normalizeAttemptRow, saveAttemptRowToDb } from '../worker/practice-rooms.mjs';

// PostgreSQL in memory: exercises the migrations and real column/constraint checks.
test('migrations, attempt concurrency, question codes and mail retry match PostgreSQL', async () => {
 const pg = new PGlite();
 try {
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  for (const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
   await pg.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  }
  const exposed=(await pg.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'ltch_%' and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'INSERT'))")).rows;
  assert.deepEqual(exposed,[]);
  await pg.exec(`
   insert into public.ltch_accounts(uid,display_name,email,status,roles)
     values('qa_student','Test','qa@example.invalid','active',array['student']);
   insert into public.ltch_exams(id,title,status,questions,created_by,exam_type,target_grade)
     values('exam_qa','Test','published','[]','qa_student','thptqg',12);
  `);
  const asParam = v => v && typeof v === 'object' ? JSON.stringify(v) : v;
  const db = { from(table) {
   assert.equal(table, 'ltch_practice_attempts');
   return {
    async insert(row) {
     const keys=Object.keys(row), names=keys.map(k=>`"${k}"`).join(','), values=keys.map((_,i)=>`$${i+1}`).join(',');
     try { const r=await pg.query(`insert into public.ltch_practice_attempts (${names}) values (${values}) returning id`,keys.map(k=>asParam(row[k]))); return {data:r.rows,error:null}; }
     catch(error) { return {data:null,error}; }
    },
    update(row) {
     const filters=[];
     const query={eq(k,v){filters.push([k,v]);return query;},async select(){
      const keys=Object.keys(row), values=keys.map(k=>asParam(row[k]));
      const set=keys.map((k,i)=>`"${k}"=$${i+1}`).join(',');
      const where=filters.map(([k,v])=>{values.push(v);return `"${k}"=$${values.length}`;}).join(' and ');
      try { const r=await pg.query(`update public.ltch_practice_attempts set ${set} where ${where} returning id`,values);return {data:r.rows,error:null}; }
      catch(error){return {data:null,error};}
     }};
     return query;
    }
   };
  }};
  const attempt={id:'att_1234567890123456',exam_id:'exam_qa',uid:'qa_student',status:'in_progress',is_preview:true,practice_mode:'section',section_key:'part_1',started_at:1000,expires_at:9999999999999,attempt_questions:[{id:'q1'}],responses:{q1:'A'},revision:1};
  await saveAttemptRowToDb(db,attempt,{isInsert:true});
  let row=(await pg.query('select * from public.ltch_practice_attempts where id=$1',[attempt.id])).rows[0];
  let normalized=normalizeAttemptRow(row);
  assert.equal(normalized.status,'in_progress');assert.equal(normalized.is_preview,true);assert.equal(normalized.section_key,'part_1');
  await saveAttemptRowToDb(db,{...normalized,responses:{q1:'B'}});
  await assert.rejects(saveAttemptRowToDb(db,{...normalized,responses:{q1:'C'}}),e=>e.status===409);
  row=(await pg.query('select * from public.ltch_practice_attempts where id=$1',[attempt.id])).rows[0];
  assert.equal(normalizeAttemptRow(row).responses.q1,'B');
  await pg.exec("insert into public.ltch_practice_attempts(id,exam_id,uid,submitted_at,responses,score,max_score,results) select 'bulk_attempt_'||lpad(n::text,8,'0'),'exam_qa','qa_student',1000,'{}',8,10,'[]' from generate_series(1,501) n");
  const stats=(await pg.query("select * from public.ltch_practice_stats(array['exam_qa'])")).rows[0];
  assert.equal(Number(stats.total),501);assert.equal(Number(stats.b4),501);
  const a=(await pg.query('select public.ltch_reserve_question_codes(3) as codes')).rows[0].codes;
  const b=(await pg.query('select public.ltch_reserve_question_codes(2) as codes')).rows[0].codes;
  assert.equal(new Set([...a,...b]).size,5);
  assert.equal((await pg.query("select has_function_privilege('anon','public.ltch_reserve_question_codes(integer)','execute') as allowed")).rows[0].allowed,false);
  const question={id:'q1',questionCode:a[0],version:1,prompt:'1+1?',type:'single',answer:'B'};
  const exam={id:'exam_atomic',class_id:null,title:'Trước',status:'published',opens_at:1000,closes_at:9999999999999,results_at:1000,solutions_at:1000,questions:[question],created_by:'qa_student',exam_type:'thptqg',exam_code:'01',duration_minutes:90,sections:[],target_grade:12,school_year_id:null,updated_at:1000};
  const bank=[{id:'qa_bank',class_id:null,question_code:a[0],exam_type:'thptqg',target_grade:12,school_year_id:null,version:1,topic:'',question,status:'active',created_by:'qa_student',created_at:1000}];
  const versions=[{question_code:a[0],version:1,question,edit_reason:'test',created_by:'qa_student',created_at:1000}];
  const save=(ex,bs,vs,expected=null)=>pg.query('select public.ltch_save_room_exam($1::jsonb,$2::jsonb,$3::jsonb,$4)',[JSON.stringify(ex),JSON.stringify(bs),JSON.stringify(vs),expected]);
  await save(exam,bank,versions);
  assert.equal((await pg.query('select count(*)::int as n from public.ltch_question_versions where question_code=$1',[a[0]])).rows[0].n,1);
  const altered={...question,answer:'A'};
  await assert.rejects(save({...exam,title:'Không được lưu'},[{...bank[0],question:altered}],[{...versions[0],question:altered}],1000));
  assert.equal((await pg.query("select title from public.ltch_exams where id='exam_atomic'")).rows[0].title,'Trước');
  await save({...exam,title:'Bản mới',updated_at:1001},bank,versions,1000);
  await assert.rejects(save({...exam,title:'Bản cũ',updated_at:1002},bank,versions,1000));
  assert.equal((await pg.query("select title from public.ltch_exams where id='exam_atomic'")).rows[0].title,'Bản mới');
  await pg.exec(`
   insert into public.ltch_school_years(id,name,starts_on,ends_on) values ('qa_year','Test','2026-01-01','2027-01-01');
   insert into public.ltch_classes(id,school_year_id,name) values ('qa_class','qa_year','Lớp 6');
   insert into public.ltch_enrollment_requests(id,uid,applicant_role,school_year_id,class_id,full_name,date_of_birth,school_name,parent_name,parent_phone,parent_relation,photo_path,status)
     values('qa_request','qa_student','student','qa_year','qa_class','Test','2010-01-01','Test','Test','0900000000','guardian','','pending');
   insert into public.ltch_mail_outbox(id,request_id,template,recipient,payload) values ('qa_mail','qa_request','approval_notice','qa@example.invalid','{}');
  `);
  await pg.exec("update public.ltch_classes set enrollment_open=true where id='qa_class'; insert into public.ltch_accounts(uid,display_name,email,status,roles) values('qa_pending','Test','pending@example.invalid','pending',array[]::text[])");
  const application={uid:'qa_pending',applicant_role:'student',school_year_id:'qa_year',class_id:'qa_class',full_name:'Test',date_of_birth:'2010-01-01',school_name:'Test',student_phone:'',parent_name:'Parent',parent_phone:'0900000000',parent_relation:'mother',photo_path:'',status:'pending',admin_notes:'',updated_at:new Date().toISOString(),version:1};
  const submit=(previous,row)=>pg.query('select public.ltch_submit_enrollment($1,$2,$3,$4::jsonb,$5)',['qa_pending','qa_new_request',previous,JSON.stringify(row),'1.0']);
  await submit(0,application);
  assert.equal((await pg.query("select count(*)::int as n from public.ltch_enrollment_audit where request_id='qa_new_request'")).rows[0].n,1);
  await assert.rejects(submit(0,application));
  assert.equal((await pg.query("select count(*)::int as n from public.ltch_enrollment_audit where request_id='qa_new_request'")).rows[0].n,1);
  await pg.exec(`
   insert into public.ltch_accounts(uid,display_name,email,status,roles) values('qa_pending2','Test','pending2@example.invalid','pending',array[]::text[]);
   create function public.qa_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'simulated audit failure'; end $$;
   create trigger qa_reject_audit before insert on public.ltch_enrollment_audit for each row execute function public.qa_reject_audit();
  `);
  await assert.rejects(pg.query('select public.ltch_submit_enrollment($1,$2,$3,$4::jsonb,$5)',['qa_pending2','qa_rollback',0,JSON.stringify({...application,uid:'qa_pending2'}),'1.0']));
  assert.equal((await pg.query("select count(*)::int as n from public.ltch_enrollment_requests where id='qa_rollback'")).rows[0].n,0);
  await pg.exec('drop trigger qa_reject_audit on public.ltch_enrollment_audit; drop function public.qa_reject_audit();');
  assert.ok((await pg.query('select id from public.ltch_due_general_mail()')).rows.some(r=>r.id==='qa_mail'));
  await pg.exec("update public.ltch_mail_outbox set attempt_count=8 where id='qa_mail'");
  assert.ok(!(await pg.query('select id from public.ltch_due_general_mail()')).rows.some(r=>r.id==='qa_mail'));
  await pg.query('insert into public.ltch_sessions(id,uid,created_at,expires_at) values($1,$2,$3,$4),($5,$2,$3,$6)', ['a'.repeat(64),'qa_student',1,2,'b'.repeat(64),Date.now()+86400000]);
  await pg.query('insert into public.ltch_rate_limits(id,count,expires_at) values($1,1,2)',['c'.repeat(64)]);
  await pg.exec(`insert into public.ltch_otp_challenges(uid,version,payload) values ('old_otp',1,'{"expiresAt":2}'),('invalid_otp',1,'{"expiresAt":"invalid"}')`);
  assert.equal((await pg.query('select public.ltch_cleanup_expired_auth() as removed')).rows[0].removed,3);
  assert.equal((await pg.query('select count(*)::int as n from public.ltch_sessions')).rows[0].n,1);
  assert.equal((await pg.query('select count(*)::int as n from public.ltch_otp_challenges')).rows[0].n,1);
  await pg.exec("insert into public.ltch_accounts(uid,display_name,email,status,roles) values('qa_admin','Test','admin@example.invalid','active',array['admin'])");
  const active=(await pg.query("select id,name,school_year_id,case when id='qa_class' then 6 else null end as grade from public.ltch_classes where not archived")).rows;
  const year={id:'qa_next_year',name:'Next',starts_on:'2027-01-01',ends_on:'2028-01-01'};
  const createClass=id=>({id,name:'Lớp 6A',schedule:'',schedule_slots:[],reminders_enabled:true});
  const advance=(snapshot,created)=>pg.query('select public.ltch_advance_school_year($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7)', ['qa_admin',JSON.stringify(year),JSON.stringify(snapshot),'[]','[]',JSON.stringify([created]),Date.now()]);
  await assert.rejects(advance(active,createClass('qa_class')));
  assert.equal((await pg.query("select count(*)::int as n from public.ltch_school_years where id='qa_next_year'")).rows[0].n,0);
  await advance(active,createClass('qa_new_class'));
  assert.equal((await pg.query("select count(*)::int as n from public.ltch_classes where id='qa_new_class'")).rows[0].n,1);
  await assert.rejects(advance(active,createClass('qa_another_class')));
  const roomRows=(await pg.query('select * from public.ltch_list_room_exams(true)')).rows;
  assert.ok(roomRows.some(r=>r.id==='exam_atomic'&&Number(r.total_questions)===1&&Number(r.part_1_count)===1&&!('questions' in r)));
  assert.equal((await pg.query("select has_function_privilege('anon','public.ltch_list_room_exams(boolean)','execute') as allowed")).rows[0].allowed,false);
  assert.equal((await pg.query("select has_function_privilege('authenticated','public.ltch_delete_archived_class(text,text)','execute') as allowed")).rows[0].allowed,false);
  await pg.exec(`
   update public.ltch_exams set class_id='qa_class' where id='exam_qa';
   insert into public.ltch_lessons(id,class_id,title,created_by,created_at) values('qa_les','qa_class','Buổi 1','qa_admin',1000);
   insert into public.ltch_assignments(id,class_id,title,opens_at,closes_at,created_by) values('qa_asn','qa_class','BTVN 1',1000,9999999999999,'qa_admin');
   insert into public.ltch_submissions(id,assignment_id,uid,object_path,status,created_at,stored_at,file_size,content_type) values('qa_sub','qa_asn','qa_student','qa/sub.pdf','stored',1000,1001,123,'application/pdf');
   insert into public.ltch_attendance(id,class_id,student_uid,lesson_date,status,recorded_by,updated_at) values('qa_att','qa_class','qa_student','2026-10-01','present','qa_admin',1000);
   insert into public.ltch_notices(id,class_id,title,body,created_by,created_at) values('qa_not','qa_class','TB','Noi dung','qa_admin',1000);
   insert into public.ltch_forum_posts(id,class_id,author_uid,title,body,created_at) values('qa_fp','qa_class','qa_student','Hoi','De','1000');
   insert into public.ltch_forum_comments(id,post_id,author_uid,body,created_at) values('qa_fc','qa_fp','qa_admin','Giai',1001);
   insert into public.ltch_class_memberships(class_id,uid,member_role,status) values('qa_class','qa_student','student','active');
   update public.ltch_classes set archived=true where id='qa_class';
  `);
  await assert.rejects(pg.query("select public.ltch_delete_archived_class('qa_student','qa_class')"));
  await assert.rejects(pg.query("select public.ltch_delete_archived_class('qa_admin','qa_new_class')"), /LTCH_CLASS_NOT_ARCHIVED/);
  await assert.rejects(pg.query("select public.ltch_delete_archived_class('qa_admin','missing_cls')"), /LTCH_CLASS_NOT_FOUND/);
  await pg.query("select public.ltch_delete_archived_class('qa_admin','qa_class')");
  assert.equal((await pg.query("select count(*)::int as n from public.ltch_classes where id='qa_class'")).rows[0].n,0);
  assert.equal((await pg.query("select class_id from public.ltch_exams where id='exam_qa'")).rows[0].class_id,null);
  await pg.exec('create or replace function public.rls_auto_enable() returns event_trigger language plpgsql security definer as $$ begin end; $$;');
  await pg.exec(await readFile('supabase/migrations/202611180027_p2_revoke_rls_auto_enable_public_exec.sql','utf8'));
  assert.equal((await pg.query("select has_function_privilege('anon','public.rls_auto_enable()','execute') as allowed")).rows[0].allowed,false);
  assert.equal((await pg.query("select has_function_privilege('authenticated','public.rls_auto_enable()','execute') as allowed")).rows[0].allowed,false);
  assert.deepEqual((await pg.query("select proconfig from pg_proc where oid='public.rls_auto_enable()'::regprocedure")).rows[0].proconfig,['search_path=pg_catalog']);
 } finally { await pg.close(); }
});

test('legacy room exams retain attempts while duplicate codes are reconciled', async () => {
 const pg = new PGlite();
 try {
  await pg.exec('create role anon; create role authenticated; create role service_role;');
  const migrations=(await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
  for (const name of migrations.filter(n=>n<'202611080021')) await pg.exec(await readFile(`supabase/migrations/${name}`,'utf8'));
  await pg.exec(`
   insert into public.ltch_accounts(uid,display_name,email,status,roles) values('legacy_student','Test','legacy@example.invalid','active',array['student']);
   insert into public.ltch_school_years(id,name,starts_on,ends_on) values('legacy_year','Test','2026-01-01','2027-01-01');
   insert into public.ltch_classes(id,school_year_id,name) values('legacy_class','legacy_year','Lớp 12');
  `);
  const meta={examType:'thptqg',examCode:'01',targetGrade:12,durationMinutes:90,sectionConfig:[]};
  const question={id:'q1',type:'single',prompt:'Test?',questionCode:'LTCH-10001',version:1,answer:'B'};
  for(const examId of ['exam_a','exam_b']) {
   await pg.query('insert into public.ltch_exams(id,class_id,title,status,opens_at,closes_at,questions,created_by) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[examId,'legacy_class','Test','published',1,9999999999999,JSON.stringify([{...question,_examMeta:meta}]),'legacy_student']);
  }
  const response={q1:'A',_attemptMeta:{status:'in_progress',isPreview:false,practiceMode:'full',sectionKey:'all',startedAt:1000,expiresAt:9999999999999,activeDeviceToken:'device',sectionStates:{all:{status:'in_progress'}},attemptQuestions:[question],draftMeta:{}}};
  await pg.query('insert into public.ltch_practice_attempts(id,exam_id,uid,submitted_at,responses,score,max_score,results) values($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)',['att_legacy_123456789','exam_b','legacy_student',1000,JSON.stringify(response),0,1,JSON.stringify([{id:'q1',questionCode:'LTCH-10001'}])]);
  for (const name of migrations.filter(n=>n>='202611080021')) await pg.exec(await readFile(`supabase/migrations/${name}`,'utf8'));
  const map=(await pg.query('select exam_id,old_code,new_code from public.ltch_legacy_question_codes order by exam_id')).rows;
  assert.equal(map.length,2);assert.equal(map[0].old_code,map[1].old_code);assert.notEqual(map[0].new_code,map[1].new_code);
  const attempt=(await pg.query("select * from public.ltch_practice_attempts where id='att_legacy_123456789'")).rows[0];
  assert.equal(attempt.status,'in_progress');assert.equal(attempt.submitted_at,null);assert.equal(attempt.responses.q1,'A');
  assert.equal(attempt.attempt_questions[0].questionCode,map[1].new_code);assert.equal(attempt.results[0].questionCode,map[1].new_code);
  assert.equal((await pg.query('select count(*)::int as n from public.ltch_question_bank')).rows[0].n,2);
 } finally { await pg.close(); }
});
