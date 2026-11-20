begin;

-- Compare-and-swap protects a saved draft from concurrent tabs and submissions.
alter table public.ltch_practice_attempts
  add column if not exists revision bigint not null default 1;
alter table public.ltch_practice_attempts
  drop constraint if exists ltch_practice_attempts_revision_check;
alter table public.ltch_practice_attempts
  add constraint ltch_practice_attempts_revision_check check (revision > 0);

create or replace function public.ltch_reserve_question_codes(p_count integer)
returns text[] language plpgsql security invoker set search_path = '' as $$
declare result text[];
begin
  if p_count < 1 or p_count > 300 then raise exception 'invalid question count'; end if;
  select array_agg('LTCH-' || nextval('public.ltch_question_code_seq')::text order by n)
    into result from generate_series(1, p_count) as g(n);
  return result;
end;
$$;
revoke all on function public.ltch_reserve_question_codes(integer) from public, anon, authenticated;
grant execute on function public.ltch_reserve_question_codes(integer) to service_role;

-- Exam, bank and immutable question versions are saved in one transaction.
create or replace function public.ltch_save_room_exam(p_exam jsonb, p_bank jsonb, p_versions jsonb, p_expected_updated bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_exam) <> 'object' or jsonb_typeof(p_bank) <> 'array'
     or jsonb_typeof(p_versions) <> 'array' or jsonb_array_length(p_bank) > 300
     or jsonb_array_length(p_versions) <> jsonb_array_length(p_bank) then
    raise exception 'invalid exam payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ltch.room.exam:'||coalesce(p_exam->>'id',''),0));
  if (p_expected_updated is null and exists(select 1 from public.ltch_exams where id=p_exam->>'id'))
     or (p_expected_updated is not null and not exists(select 1 from public.ltch_exams where id=p_exam->>'id' and updated_at=p_expected_updated)) then
    raise exception 'LTCH_EXAM_CONFLICT';
  end if;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.ltch_question_versions, p_versions) incoming
    join public.ltch_question_versions old on old.question_code=incoming.question_code and old.version=incoming.version
    where old.question is distinct from incoming.question
  ) then raise exception 'question version already exists with different content'; end if;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.ltch_question_bank,p_bank) incoming
    join public.ltch_question_bank old on old.question_code=incoming.question_code
    where incoming.version<old.version
  ) then raise exception 'question version cannot move backwards'; end if;
  insert into public.ltch_exams(id,class_id,title,status,opens_at,closes_at,results_at,solutions_at,questions,created_by,exam_type,exam_code,duration_minutes,sections,target_grade,school_year_id,updated_at)
  select id,class_id,title,status,opens_at,closes_at,results_at,solutions_at,questions,created_by,exam_type,exam_code,duration_minutes,sections,target_grade,school_year_id,updated_at
  from jsonb_populate_record(null::public.ltch_exams,p_exam)
  on conflict(id) do update set class_id=excluded.class_id,title=excluded.title,status=excluded.status,opens_at=excluded.opens_at,closes_at=excluded.closes_at,results_at=excluded.results_at,solutions_at=excluded.solutions_at,questions=excluded.questions,exam_type=excluded.exam_type,exam_code=excluded.exam_code,duration_minutes=excluded.duration_minutes,sections=excluded.sections,target_grade=excluded.target_grade,school_year_id=excluded.school_year_id,updated_at=excluded.updated_at;
  insert into public.ltch_question_bank(id,class_id,question_code,exam_type,target_grade,school_year_id,version,topic,question,status,created_by,created_at)
  select id,class_id,question_code,exam_type,target_grade,school_year_id,version,topic,question,status,created_by,created_at
  from jsonb_populate_recordset(null::public.ltch_question_bank,p_bank)
  on conflict(question_code) do update set version=excluded.version,question=excluded.question;
  insert into public.ltch_question_versions(question_code,version,question,edit_reason,created_by,created_at)
  select question_code,version,question,edit_reason,created_by,created_at
  from jsonb_populate_recordset(null::public.ltch_question_versions,p_versions)
  on conflict(question_code,version) do nothing;
end;
$$;
revoke all on function public.ltch_save_room_exam(jsonb,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.ltch_save_room_exam(jsonb,jsonb,jsonb,bigint) to service_role;

alter table public.ltch_mail_outbox
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at bigint not null default 0;
create index if not exists ltch_general_mail_retry_idx
  on public.ltch_mail_outbox(next_attempt_at, created_at)
  where template <> 'lesson_reminder' and status in ('pending', 'sending');
create or replace function public.ltch_due_general_mail()
returns table(id text) language sql stable security invoker set search_path = '' as $$
  select o.id from public.ltch_mail_outbox o
  where o.template <> 'lesson_reminder' and o.attempt_count < 8
    and o.next_attempt_at <= (extract(epoch from now()) * 1000)::bigint
    and (o.status = 'pending' or (o.status = 'sending' and o.lease_until < (extract(epoch from now()) * 1000)::bigint))
  order by o.next_attempt_at, o.created_at limit 50;
$$;
revoke all on function public.ltch_due_general_mail() from public, anon, authenticated;
grant execute on function public.ltch_due_general_mail() to service_role;

create or replace function public.ltch_cleanup_expired_auth()
returns integer language plpgsql security invoker set search_path = '' as $$
declare cutoff bigint=(extract(epoch from now())*1000)::bigint-86400000; total integer=0; removed integer;
begin
  delete from public.ltch_sessions where ctid in (select ctid from public.ltch_sessions where expires_at<cutoff limit 1000);
  get diagnostics removed=row_count; total=total+removed;
  delete from public.ltch_rate_limits where ctid in (select ctid from public.ltch_rate_limits where expires_at<cutoff limit 1000);
  get diagnostics removed=row_count; total=total+removed;
  delete from public.ltch_otp_challenges where ctid in (
    select ctid from public.ltch_otp_challenges
    where case when payload->>'expiresAt' ~ '^[0-9]{1,15}$' then (payload->>'expiresAt')::bigint<cutoff else false end limit 1000
  );
  get diagnostics removed=row_count; total=total+removed;
  return total;
end;
$$;
revoke all on function public.ltch_cleanup_expired_auth() from public, anon, authenticated;
grant execute on function public.ltch_cleanup_expired_auth() to service_role;

create or replace function public.ltch_advance_school_year(
  p_actor text,p_year jsonb,p_active jsonb,p_archive jsonb,p_promote jsonb,p_create jsonb,p_now bigint
) returns void language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if not exists(select 1 from public.ltch_accounts where uid=p_actor and status='active' and 'admin'=any(roles)) then raise exception 'not authorized'; end if;
  if jsonb_typeof(p_year)<>'object' or jsonb_typeof(p_active)<>'array' or jsonb_typeof(p_archive)<>'array' or jsonb_typeof(p_promote)<>'array' or jsonb_typeof(p_create)<>'array' then raise exception 'invalid transition'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ltch.advance_school_year',0));
  lock table public.ltch_classes in share row exclusive mode;
  if (select count(*) from public.ltch_classes where not archived) <> jsonb_array_length(p_active)
     or exists(select 1 from jsonb_to_recordset(p_active) x(id text,name text,school_year_id text,grade integer)
       left join public.ltch_classes c on c.id=x.id and not c.archived
       where c.id is null or c.name<>x.name or c.school_year_id<>x.school_year_id) then
    raise exception 'class data changed';
  end if;
  insert into public.ltch_student_grade_history(uid,school_year_id,grade,class_id,recorded_at)
  select m.uid,c.school_year_id,x.grade,c.id,p_now
  from jsonb_to_recordset(p_active) x(id text,name text,school_year_id text,grade integer)
  join public.ltch_classes c on c.id=x.id
  join public.ltch_class_memberships m on m.class_id=c.id and m.member_role='student' and m.status='active'
  where x.grade between 6 and 12
  on conflict(uid,school_year_id,grade) do update set class_id=excluded.class_id,recorded_at=excluded.recorded_at;
  insert into public.ltch_school_years(id,name,starts_on,ends_on)
  values(p_year->>'id',p_year->>'name',(p_year->>'starts_on')::date,(p_year->>'ends_on')::date)
  on conflict(id) do nothing;
  if not exists(select 1 from public.ltch_school_years where id=p_year->>'id' and name=p_year->>'name' and starts_on=(p_year->>'starts_on')::date and ends_on=(p_year->>'ends_on')::date) then raise exception 'school year already differs'; end if;
  update public.ltch_classes c set archived=true,enrollment_open=false
    from jsonb_to_recordset(p_archive) x(id text) where c.id=x.id and not c.archived;
  get diagnostics changed=row_count;
  if changed<>jsonb_array_length(p_archive) then raise exception 'archive conflict'; end if;
  update public.ltch_classes c set name=x."toName",school_year_id=p_year->>'id'
    from jsonb_to_recordset(p_promote) x(id text,"toName" text) where c.id=x.id and not c.archived;
  get diagnostics changed=row_count;
  if changed<>jsonb_array_length(p_promote) then raise exception 'promotion conflict'; end if;
  insert into public.ltch_classes(id,name,school_year_id,schedule,schedule_slots,reminders_enabled,archived,enrollment_open)
  select x.id,x.name,p_year->>'id',x.schedule,x.schedule_slots,x.reminders_enabled,false,true
    from jsonb_to_recordset(p_create) x(id text,name text,schedule text,schedule_slots jsonb,reminders_enabled boolean);
  insert into public.ltch_class_memberships(class_id,uid,member_role,status,permissions)
  select x.id,a.uid,'assistant','active',array['schedule.manage','attendance.write','materials.write','assignments.write','practice.manage','notices.write','messages.write']
  from jsonb_to_recordset(p_create) x(id text) cross join public.ltch_accounts a
  where a.status='active' and 'admin'=any(a.roles)
  on conflict(class_id,uid,member_role) do nothing;
end;
$$;
revoke all on function public.ltch_advance_school_year(text,jsonb,jsonb,jsonb,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.ltch_advance_school_year(text,jsonb,jsonb,jsonb,jsonb,jsonb,bigint) to service_role;

create or replace function public.ltch_submit_enrollment(p_uid text,p_id text,p_previous_version integer,p_row jsonb,p_policy text)
returns text language plpgsql security invoker set search_path = '' as $$
declare old_row public.ltch_enrollment_requests%rowtype; new_row public.ltch_enrollment_requests%rowtype;
begin
  if jsonb_typeof(p_row)<>'object' or p_policy is null or length(p_policy) not between 1 and 20 then raise exception 'invalid enrollment'; end if;
  perform 1 from public.ltch_accounts where uid=p_uid and status='pending' and not (roles && array['teacher','assistant']::text[]) for update;
  if not found then raise exception 'LTCH_ENROLLMENT_CONFLICT'; end if;
  new_row=jsonb_populate_record(null::public.ltch_enrollment_requests,p_row);
  if new_row.uid<>p_uid or new_row.version<>p_previous_version+1 or new_row.status<>'pending' then raise exception 'invalid enrollment'; end if;
  if not exists(select 1 from public.ltch_classes where id=new_row.class_id and school_year_id=new_row.school_year_id and not archived and enrollment_open) then raise exception 'LTCH_ENROLLMENT_CONFLICT'; end if;
  select * into old_row from public.ltch_enrollment_requests where uid=p_uid for update;
  if found then
    if old_row.id<>p_id or old_row.version<>p_previous_version or old_row.status not in ('pending','needs_revision') then raise exception 'LTCH_ENROLLMENT_CONFLICT'; end if;
    update public.ltch_enrollment_requests set applicant_role=new_row.applicant_role,school_year_id=new_row.school_year_id,class_id=new_row.class_id,full_name=new_row.full_name,date_of_birth=new_row.date_of_birth,school_name=new_row.school_name,student_phone=new_row.student_phone,parent_name=new_row.parent_name,parent_phone=new_row.parent_phone,parent_relation=new_row.parent_relation,photo_path=new_row.photo_path,status='pending',admin_notes='',updated_at=new_row.updated_at,version=new_row.version where id=p_id;
  else
    if p_previous_version<>0 then raise exception 'LTCH_ENROLLMENT_CONFLICT'; end if;
    insert into public.ltch_enrollment_requests(id,uid,applicant_role,school_year_id,class_id,full_name,date_of_birth,school_name,student_phone,parent_name,parent_phone,parent_relation,photo_path,status,admin_notes,updated_at,version)
    values(p_id,p_uid,new_row.applicant_role,new_row.school_year_id,new_row.class_id,new_row.full_name,new_row.date_of_birth,new_row.school_name,new_row.student_phone,new_row.parent_name,new_row.parent_phone,new_row.parent_relation,new_row.photo_path,'pending','',new_row.updated_at,new_row.version);
  end if;
  insert into public.ltch_enrollment_audit(request_id,actor_uid,event,version) values(p_id,p_uid,'consent_privacy:'||p_policy,new_row.version);
  return p_id;
end;
$$;
revoke all on function public.ltch_submit_enrollment(text,text,integer,jsonb,text) from public, anon, authenticated;
grant execute on function public.ltch_submit_enrollment(text,text,integer,jsonb,text) to service_role;

create or replace function public.ltch_practice_stats(p_exam_ids text[])
returns table(exam_id text,total bigint,b0 bigint,b1 bigint,b2 bigint,b3 bigint,b4 bigint)
language sql stable security invoker set search_path = '' as $$
  select a.exam_id,count(*),
    count(*) filter(where a.max_score>0 and a.score/a.max_score<0.2),
    count(*) filter(where a.max_score>0 and a.score/a.max_score>=0.2 and a.score/a.max_score<0.4),
    count(*) filter(where a.max_score>0 and a.score/a.max_score>=0.4 and a.score/a.max_score<0.6),
    count(*) filter(where a.max_score>0 and a.score/a.max_score>=0.6 and a.score/a.max_score<0.8),
    count(*) filter(where a.max_score>0 and a.score/a.max_score>=0.8)
  from public.ltch_practice_attempts a
  where cardinality(p_exam_ids)<=300 and a.exam_id=any(p_exam_ids) and a.status='submitted' and not a.is_preview
  group by a.exam_id;
$$;
revoke all on function public.ltch_practice_stats(text[]) from public, anon, authenticated;
grant execute on function public.ltch_practice_stats(text[]) to service_role;

commit;
