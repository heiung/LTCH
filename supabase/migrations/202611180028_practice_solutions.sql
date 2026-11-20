begin;

-- Dedicated schema for "Chữa đề luyện" (strictly separated from ltch_lessons / ltch_lesson_files).
create table public.ltch_practice_solutions (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  class_id text not null references public.ltch_classes(id),
  item_number integer not null check (item_number between 1 and 200),
  title text not null check (length(title) between 1 and 250),
  solution_name text not null default '' check (length(solution_name) <= 200),
  topic text not null default '' check (length(topic) <= 200),
  exam_tag text not null default '' check (exam_tag in ('', 'thptqg', 'hsa', 'tsa')),
  solution_date text not null default '' check (solution_date = '' or solution_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  created_by text not null references public.ltch_accounts(uid),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0),
  unique (class_id, item_number),
  unique (id, class_id)
);

create index ltch_practice_solutions_class_item
  on public.ltch_practice_solutions(class_id, item_number);

create table public.ltch_practice_solution_files (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  solution_id text not null,
  class_id text not null,
  file_kind text not null check (file_kind in ('video', 'document', 'cover')),
  name text not null check (length(name) between 1 and 250),
  drive_file_id text not null unique check (drive_file_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  parent_folder_id text not null check (parent_folder_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  content_type text not null check (length(content_type) between 1 and 127),
  file_size bigint not null check (file_size between 1 and 5368709120),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  status text not null check (status in ('pending', 'stored', 'failed')),
  created_by text not null references public.ltch_accounts(uid),
  created_at bigint not null check (created_at >= 0),
  foreign key (solution_id, class_id)
    references public.ltch_practice_solutions(id, class_id)
    on delete cascade,
  unique (solution_id, created_by, request_id)
);

create index ltch_practice_solution_files_lookup
  on public.ltch_practice_solution_files(class_id, solution_id, status, file_kind, created_at, id);

alter table public.ltch_practice_solutions enable row level security;
alter table public.ltch_practice_solution_files enable row level security;

revoke all on public.ltch_practice_solutions, public.ltch_practice_solution_files
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.ltch_practice_solutions, public.ltch_practice_solution_files
  to service_role;

-- Extend archived-class cleanup to remove dedicated practice-solutions metadata & files.
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

  delete from public.ltch_practice_solution_files where class_id = p_class_id;
  delete from public.ltch_practice_solutions where class_id = p_class_id;

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
