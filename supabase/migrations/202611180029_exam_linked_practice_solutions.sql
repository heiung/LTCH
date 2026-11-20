begin;

-- Migrate "Chữa đề luyện" from per-class numbered slots to exam-linked metadata & files.
drop table if exists public.ltch_practice_solution_files, public.ltch_practice_solutions cascade;

create table public.ltch_practice_solutions (
  exam_id text primary key references public.ltch_exams(id) on delete cascade,
  topic text not null default '' check (length(topic) <= 200),
  solution_note text not null default '' check (length(solution_note) <= 1000),
  solution_date text not null default '' check (solution_date = '' or solution_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  updated_by text not null references public.ltch_accounts(uid),
  created_at bigint not null check (created_at >= 0),
  updated_at bigint not null check (updated_at >= 0)
);

create table public.ltch_practice_solution_files (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  exam_id text not null references public.ltch_exams(id) on delete cascade,
  file_kind text not null check (file_kind in ('exam_file', 'video', 'document', 'cover')),
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
  unique (exam_id, created_by, request_id)
);

create index ltch_practice_solution_files_exam_idx
  on public.ltch_practice_solution_files(exam_id, status, file_kind, created_at, id);

alter table public.ltch_practice_solutions enable row level security;
alter table public.ltch_practice_solution_files enable row level security;

revoke all on public.ltch_practice_solutions, public.ltch_practice_solution_files
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.ltch_practice_solutions, public.ltch_practice_solution_files
  to service_role;

do $$
begin
  if to_regclass('public.ltch_drive_folders') is not null then
    delete from public.ltch_drive_folders where folder_key like 'psol:%';
  end if;
end $$;

-- Remove stale class_id deletes on ltch_practice_solution* tables (class-only exams cascade via ltch_exams).
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
    delete from public.ltch_practice_solution_files where exam_id = any(v_class_exam_ids);
    delete from public.ltch_practice_solutions where exam_id = any(v_class_exam_ids);
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
