begin;

-- Return Practice Room exam metadata and per-section counts without fetching full questions/Base64 images.
create or replace function public.ltch_list_room_exams(p_published_only boolean default true)
returns table(
  id text,
  class_id text,
  title text,
  status text,
  opens_at bigint,
  closes_at bigint,
  results_at bigint,
  solutions_at bigint,
  created_by text,
  exam_type text,
  exam_code text,
  duration_minutes integer,
  sections jsonb,
  target_grade smallint,
  school_year_id text,
  updated_at bigint,
  exam_meta jsonb,
  total_questions integer,
  part_1_count integer,
  part_2_count integer,
  part_3_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.class_id,
    e.title,
    e.status,
    e.opens_at,
    e.closes_at,
    e.results_at,
    e.solutions_at,
    e.created_by,
    e.exam_type,
    e.exam_code,
    e.duration_minutes,
    e.sections,
    e.target_grade,
    e.school_year_id,
    e.updated_at,
    case
      when jsonb_typeof(e.questions) = 'array' and jsonb_typeof(e.questions->0->'_examMeta') = 'object'
        then e.questions->0->'_examMeta'
      else '{}'::jsonb
    end as exam_meta,
    qcounts.total_questions,
    qcounts.part_1_count,
    qcounts.part_2_count,
    qcounts.part_3_count
  from public.ltch_exams e
  cross join lateral (
    select
      count(*)::integer as total_questions,
      count(*) filter (where coalesce(nullif(q->>'section', ''), 'part_1') = 'part_1')::integer as part_1_count,
      count(*) filter (where q->>'section' = 'part_2')::integer as part_2_count,
      count(*) filter (where q->>'section' = 'part_3')::integer as part_3_count
    from jsonb_array_elements(
      case when jsonb_typeof(e.questions) = 'array' then e.questions else '[]'::jsonb end
    ) as q
  ) qcounts
  where (not coalesce(p_published_only, true) or e.status = 'published')
    and (
      e.exam_type in ('thptqg', 'hsa', 'tsa')
      or (
        jsonb_typeof(e.questions) = 'array'
        and jsonb_array_length(e.questions) > 0
        and lower(coalesce(e.questions->0->'_examMeta'->>'examType', '')) in ('thptqg', 'hsa', 'tsa')
      )
      or e.id ~* '^exam_(thptqg|hsa|tsa)_'
    )
  order by e.opens_at desc nulls last, e.id asc
  limit 300;
$$;
revoke all on function public.ltch_list_room_exams(boolean) from public, anon, authenticated;
grant execute on function public.ltch_list_room_exams(boolean) to service_role;

-- Atomically delete an archived class and all class-scoped dependent records while preserving shared room pools.
create or replace function public.ltch_delete_archived_class(p_actor text, p_class_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_archived boolean;
  v_class_exam_ids text[];
begin
  if not exists (
    select 1 from public.ltch_accounts a
    where a.uid = p_actor and a.status = 'active' and 'admin' = any(a.roles)
  ) then
    raise exception 'not authorized';
  end if;

  select c.archived into v_archived
  from public.ltch_classes c
  where c.id = p_class_id
  for update;

  if not found then
    raise exception 'LTCH_CLASS_NOT_FOUND';
  end if;
  if not v_archived then
    raise exception 'LTCH_CLASS_NOT_ARCHIVED';
  end if;

  -- Preserve grade/school-wide practice rooms whose legacy fallback class_id pointed to this class.
  update public.ltch_exams e
  set class_id = null
  where e.class_id = p_class_id
    and (
      e.exam_type <> 'class'
      or e.id ~* '^exam_(thptqg|hsa|tsa)_'
      or (
        jsonb_typeof(e.questions) = 'array'
        and jsonb_array_length(e.questions) > 0
        and lower(coalesce(e.questions->0->'_examMeta'->>'examType', '')) in ('thptqg', 'hsa', 'tsa')
      )
    );

  select coalesce(array_agg(e.id), array[]::text[]) into v_class_exam_ids
  from public.ltch_exams e
  where e.class_id = p_class_id;

  if cardinality(v_class_exam_ids) > 0 then
    delete from public.ltch_question_reports where exam_id = any(v_class_exam_ids);
    delete from public.ltch_exam_questions where exam_id = any(v_class_exam_ids);
    delete from public.ltch_exam_year_shares where exam_id = any(v_class_exam_ids);
    update public.ltch_question_imports set exam_id = null where exam_id = any(v_class_exam_ids);
    delete from public.ltch_legacy_question_codes where exam_id = any(v_class_exam_ids);
    delete from public.ltch_practice_attempts where exam_id = any(v_class_exam_ids);
    delete from public.ltch_exams where id = any(v_class_exam_ids);
  end if;

  update public.ltch_question_bank b
  set class_id = null
  where b.class_id = p_class_id
    and (
      b.exam_type <> 'class'
      or exists (select 1 from public.ltch_exam_questions eq where eq.question_code = b.question_code)
      or exists (select 1 from public.ltch_question_reports qr where qr.question_code = b.question_code)
    );

  delete from public.ltch_question_bank where class_id = p_class_id;

  delete from public.ltch_submissions
  where assignment_id in (select id from public.ltch_assignments where class_id = p_class_id);
  delete from public.ltch_assignments where class_id = p_class_id;

  delete from public.ltch_lesson_files where class_id = p_class_id;
  delete from public.ltch_lessons where class_id = p_class_id;
  delete from public.ltch_materials where class_id = p_class_id;

  delete from public.ltch_mail_outbox
  where reminder_class_id = p_class_id
    or notice_id in (select id from public.ltch_notices where class_id = p_class_id)
    or request_id in (select id from public.ltch_enrollment_requests where class_id = p_class_id);
  delete from public.ltch_notice_files
  where notice_id in (select id from public.ltch_notices where class_id = p_class_id);
  delete from public.ltch_notices where class_id = p_class_id;

  delete from public.ltch_forum_comments
  where post_id in (select id from public.ltch_forum_posts where class_id = p_class_id);
  delete from public.ltch_forum_posts where class_id = p_class_id;
  delete from public.ltch_messages where class_id = p_class_id;
  delete from public.ltch_attendance where class_id = p_class_id;

  delete from public.ltch_enrollment_audit
  where request_id in (select id from public.ltch_enrollment_requests where class_id = p_class_id);
  delete from public.ltch_enrollment_requests where class_id = p_class_id;

  delete from public.ltch_student_grade_history where class_id = p_class_id;
  delete from public.ltch_class_memberships where class_id = p_class_id;

  delete from public.ltch_classes where id = p_class_id and archived = true;
end;
$$;
revoke all on function public.ltch_delete_archived_class(text, text) from public, anon, authenticated;
grant execute on function public.ltch_delete_archived_class(text, text) to service_role;

commit;
