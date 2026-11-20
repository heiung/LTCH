begin;

-- Keep an auditable per-exam mapping when older exams reused question codes.
create table if not exists public.ltch_legacy_question_codes (
  exam_id text not null references public.ltch_exams(id),
  question_id text not null,
  old_code text,
  new_code text not null unique,
  primary key(exam_id, question_id)
);
alter table public.ltch_legacy_question_codes enable row level security;
revoke all on public.ltch_legacy_question_codes from public, anon, authenticated;
grant select, insert, update, delete on public.ltch_legacy_question_codes to service_role;

do $$
declare max_code bigint;
begin
  if exists(select 1 from public.ltch_legacy_question_codes) then
    raise exception 'legacy reconciliation already performed; inspect before rerunning';
  end if;
  if exists (
    select 1 from public.ltch_exams e cross join lateral jsonb_array_elements(e.questions) q
    where e.questions->0 ? '_examMeta' and coalesce(q->>'id','')=''
  ) or exists (
    select 1 from public.ltch_exams e cross join lateral jsonb_array_elements(e.questions) q
    where e.questions->0 ? '_examMeta' group by e.id,q->>'id' having count(*)>1
  ) then raise exception 'legacy exam has missing or duplicate question IDs'; end if;
  if exists (
    select 1 from public.ltch_practice_attempts a
    cross join lateral jsonb_array_elements(coalesce(a.responses->'_attemptMeta'->'attemptQuestions','[]'::jsonb)) q
    where a.responses ? '_attemptMeta' and not exists (
      select 1 from public.ltch_exams e cross join lateral jsonb_array_elements(e.questions) eq
      where e.id=a.exam_id and eq->>'id'=q->>'id'
    )
  ) then raise exception 'legacy attempt contains questions not present in its exam'; end if;
  if exists(select 1 from public.ltch_practice_attempts where responses ? '_questionReports') then
    raise exception 'legacy question reports must be reconciled separately';
  end if;
  select greatest(1000,coalesce(max(n),0)) into max_code from (
    select substring(coalesce(q->>'questionCode',q->>'question_code') from '[0-9]{1,15}$')::bigint n
    from public.ltch_exams e cross join lateral jsonb_array_elements(e.questions) q
    where coalesce(q->>'questionCode',q->>'question_code','') ~ '[0-9]{1,15}$'
    union all
    select substring(question_code from '[0-9]{1,15}$')::bigint from public.ltch_question_bank where question_code ~ '[0-9]{1,15}$'
  ) codes;
  perform setval('public.ltch_question_code_seq',max_code,true);
end;$$;

with source as (
  select e.id exam_id,q.value->>'id' question_id,
    nullif(coalesce(q.value->>'questionCode',q.value->>'question_code'),'') old_code,
    row_number() over(partition by nullif(coalesce(q.value->>'questionCode',q.value->>'question_code'),'') order by e.id,q.ordinality) position
  from public.ltch_exams e cross join lateral jsonb_array_elements(e.questions) with ordinality q(value,ordinality)
  where e.questions->0 ? '_examMeta'
)
insert into public.ltch_legacy_question_codes(exam_id,question_id,old_code,new_code)
select s.exam_id,s.question_id,s.old_code,
  case when s.old_code is not null and s.position=1 and not exists(select 1 from public.ltch_question_bank b where b.question_code=s.old_code)
    then s.old_code else 'LTCH-'||nextval('public.ltch_question_code_seq')::text end
from source s;

update public.ltch_exams e set
 exam_type=e.questions->0->'_examMeta'->>'examType',
 exam_code=coalesce(nullif(e.questions->0->'_examMeta'->>'examCode',''),'01'),
 target_grade=coalesce(nullif(e.questions->0->'_examMeta'->>'targetGrade','')::smallint,12),
 school_year_id=nullif(e.questions->0->'_examMeta'->>'schoolYearId',''),
 duration_minutes=coalesce(nullif(e.questions->0->'_examMeta'->>'durationMinutes','')::integer,90),
 sections=coalesce(e.questions->0->'_examMeta'->'sectionConfig','[]'::jsonb),
 updated_at=coalesce(nullif(e.questions->0->'_examMeta'->>'updatedAt','')::bigint,e.opens_at),
 questions=(select jsonb_agg(jsonb_set(q.value,'{questionCode}',to_jsonb(m.new_code),true) order by q.ordinality)
   from jsonb_array_elements(e.questions) with ordinality q(value,ordinality)
   join public.ltch_legacy_question_codes m on m.exam_id=e.id and m.question_id=q.value->>'id')
where e.questions->0 ? '_examMeta';

insert into public.ltch_question_bank(id,class_id,question_code,version,exam_type,target_grade,school_year_id,question,status,created_by,created_at)
select 'legacy_'||md5(e.id||'|'||m.question_id),null,m.new_code,
  coalesce(nullif(q.value->>'version','')::integer,1),e.exam_type,e.target_grade,e.school_year_id,
  q.value-'_examMeta','active',e.created_by,e.updated_at
from public.ltch_exams e cross join lateral jsonb_array_elements(e.questions) q(value)
join public.ltch_legacy_question_codes m on m.exam_id=e.id and m.question_id=q.value->>'id';

insert into public.ltch_question_versions(question_code,version,question,edit_reason,created_by,created_at)
select question_code,version,question,'Chuyển đổi dữ liệu cũ',created_by,created_at
from public.ltch_question_bank where id like 'legacy_%';

update public.ltch_practice_attempts a set
 status=coalesce(a.responses->'_attemptMeta'->>'status','submitted'),
 is_preview=coalesce((a.responses->'_attemptMeta'->>'isPreview')::boolean,false),
 practice_mode=coalesce(a.responses->'_attemptMeta'->>'practiceMode','full'),
 selected_section=case when a.responses->'_attemptMeta'->>'sectionKey' in ('part_1','part_2','part_3') then a.responses->'_attemptMeta'->>'sectionKey' else null end,
 selected_combination=nullif(a.responses->'_attemptMeta'->>'selectedCombination',''),
 started_at=nullif(a.responses->'_attemptMeta'->>'startedAt','')::bigint,
 deadline_at=nullif(a.responses->'_attemptMeta'->>'expiresAt','')::bigint,
 submitted_at=case when a.responses->'_attemptMeta'->>'status'='in_progress' then null else a.submitted_at end,
 active_device_token=nullif(a.responses->'_attemptMeta'->>'activeDeviceToken',''),
 section_states=coalesce(a.responses->'_attemptMeta'->'sectionStates','{}'::jsonb),
 draft_meta=coalesce(a.responses->'_attemptMeta'->'draftMeta','{}'::jsonb),
 attempt_questions=coalesce((select jsonb_agg(jsonb_set(q.value,'{questionCode}',to_jsonb(m.new_code),true) order by q.ordinality)
   from jsonb_array_elements(coalesce(a.responses->'_attemptMeta'->'attemptQuestions','[]'::jsonb)) with ordinality q(value,ordinality)
   join public.ltch_legacy_question_codes m on m.exam_id=a.exam_id and m.question_id=q.value->>'id'),'[]'::jsonb),
 results=coalesce((select jsonb_agg(case when m.new_code is null then r.value else jsonb_set(r.value,'{questionCode}',to_jsonb(m.new_code),true) end order by r.ordinality)
   from jsonb_array_elements(coalesce(a.results,'[]'::jsonb)) with ordinality r(value,ordinality)
   left join public.ltch_legacy_question_codes m on m.exam_id=a.exam_id and m.question_id=r.value->>'id'),'[]'::jsonb)
where a.responses ? '_attemptMeta';

commit;
