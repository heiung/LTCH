begin;

-- 1. Mở rộng ltch_classes với cột grade (6..12)
alter table public.ltch_classes
  add column if not exists grade smallint check (grade is null or (grade between 6 and 12));

update public.ltch_classes
set grade = (regexp_match(name, '^[[:space:]]*(?:Lớp[[:space:]]*)?(1[012]|[6-9])(?=[[:space:]]|[A-Za-z]|$)', 'i'))[1]::smallint
where grade is null
  and regexp_match(name, '^[[:space:]]*(?:Lớp[[:space:]]*)?(1[012]|[6-9])(?=[[:space:]]|[A-Za-z]|$)', 'i') is not null;

create index if not exists ltch_classes_grade_idx on public.ltch_classes(grade);

-- 2. Bảng lịch sử khối học theo niên khóa (phục vụ "Kho đã học" khi lên lớp)
create table if not exists public.ltch_student_grade_history (
  uid text not null references public.ltch_accounts(uid) on delete cascade,
  school_year_id text not null references public.ltch_school_years(id),
  grade smallint not null check (grade between 6 and 12),
  class_id text not null references public.ltch_classes(id),
  recorded_at bigint not null,
  primary key (uid, school_year_id, grade)
);
create index if not exists ltch_student_grade_history_uid_idx on public.ltch_student_grade_history(uid);

-- 3. Bảng ngữ liệu dùng chung cho câu hỏi chùm (HSA / TSA) & lịch sử phiên bản ngữ liệu
create table if not exists public.ltch_passages (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
  version integer not null default 1 check (version >= 1),
  content text not null check (length(content) between 1 and 50000),
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  created_by text not null references public.ltch_accounts(uid),
  updated_at bigint not null
);

create table if not exists public.ltch_passage_versions (
  passage_id text not null references public.ltch_passages(id) on delete cascade,
  version integer not null check (version >= 1),
  content text not null check (length(content) between 1 and 50000),
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  created_by text not null references public.ltch_accounts(uid),
  created_at bigint not null,
  primary key (passage_id, version)
);

-- 4. Mở rộng bảng ngân hàng câu hỏi ltch_question_bank & cấp mã bất biến #LTCH-xxxx
create sequence if not exists public.ltch_question_code_seq start 1001;

alter table public.ltch_question_bank
  alter column class_id drop not null;

alter table public.ltch_question_bank
  add column if not exists question_code text,
  add column if not exists version integer not null default 1 check (version >= 1),
  add column if not exists passage_id text references public.ltch_passages(id),
  add column if not exists exam_type text not null default 'class' check (exam_type in ('class', 'thptqg', 'hsa', 'tsa')),
  add column if not exists target_grade smallint check (target_grade is null or (target_grade between 6 and 12)),
  add column if not exists school_year_id text references public.ltch_school_years(id),
  add column if not exists hidden_reason text not null default '' check (length(hidden_reason) <= 1000),
  add column if not exists duplicate_of_code text,
  add column if not exists media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array'),
  add column if not exists source_ref jsonb;

update public.ltch_question_bank
set question_code = '#LTCH-' || nextval('public.ltch_question_code_seq')::text
where question_code is null;

alter table public.ltch_question_bank
  alter column question_code set not null,
  alter column question_code set default ('#LTCH-' || nextval('public.ltch_question_code_seq')::text);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ltch_question_bank_question_code_key'
  ) then
    alter table public.ltch_question_bank
      add constraint ltch_question_bank_question_code_key unique (question_code);
  end if;
end $$;

alter table public.ltch_question_bank
  drop constraint if exists ltch_question_bank_status_check;
alter table public.ltch_question_bank
  add constraint ltch_question_bank_status_check check (status in ('active', 'archived', 'hidden'));

create index if not exists ltch_question_bank_pool_idx
  on public.ltch_question_bank(exam_type, target_grade, status, created_at desc);

-- 5. Bảng lịch sử phiên bản câu hỏi ltch_question_versions
create table if not exists public.ltch_question_versions (
  question_code text not null references public.ltch_question_bank(question_code) on delete cascade,
  version integer not null check (version >= 1),
  question jsonb not null check (jsonb_typeof(question) = 'object'),
  passage_id text references public.ltch_passages(id),
  passage_version integer,
  edit_reason text not null default '' check (length(edit_reason) <= 1000),
  created_by text not null references public.ltch_accounts(uid),
  created_at bigint not null,
  primary key (question_code, version)
);

-- 6. Mở rộng bảng đề thi ltch_exams cho 3 phòng luyện (THPTQG, HSA, TSA)
alter table public.ltch_exams
  alter column class_id drop not null,
  alter column opens_at drop not null,
  alter column closes_at drop not null;

alter table public.ltch_exams
  drop constraint if exists ltch_exams_check,
  drop constraint if exists ltch_exams_closes_at_check,
  drop constraint if exists ltch_exams_questions_check;

alter table public.ltch_exams
  add column if not exists exam_type text not null default 'class' check (exam_type in ('class', 'thptqg', 'hsa', 'tsa')),
  add column if not exists exam_code text not null default '' check (length(exam_code) <= 64),
  add column if not exists duration_minutes integer not null default 90 check (duration_minutes between 1 and 600),
  add column if not exists sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  add column if not exists target_grade smallint check (target_grade is null or (target_grade between 6 and 12)),
  add column if not exists school_year_id text references public.ltch_school_years(id),
  add column if not exists is_cumulative boolean not null default false,
  add column if not exists created_at bigint not null default ((extract(epoch from now()) * 1000)::bigint),
  add column if not exists updated_at bigint not null default ((extract(epoch from now()) * 1000)::bigint);

alter table public.ltch_exams
  add constraint ltch_exams_class_window_check check (
    exam_type <> 'class' or (class_id is not null and opens_at is not null and closes_at is not null and closes_at > opens_at)
  ),
  add constraint ltch_exams_questions_check check (
    jsonb_typeof(questions) = 'array' and (
      (exam_type = 'class' and jsonb_array_length(questions) between 1 and 300) or
      (exam_type <> 'class' and jsonb_array_length(questions) between 0 and 300)
    )
  );

create index if not exists ltch_exams_room_idx
  on public.ltch_exams(exam_type, target_grade, school_year_id, status);

-- 7. Bảng liên kết đề thi - câu hỏi (ltch_exam_questions)
create table if not exists public.ltch_exam_questions (
  exam_id text not null references public.ltch_exams(id) on delete cascade,
  section_code text not null check (length(section_code) between 1 and 32),
  subject_code text not null default '' check (length(subject_code) <= 32),
  question_order integer not null check (question_order >= 1),
  question_code text not null references public.ltch_question_bank(question_code),
  cluster_id text check (cluster_id is null or length(cluster_id) <= 64),
  primary key (exam_id, section_code, subject_code, question_order)
);
create index if not exists ltch_exam_questions_code_idx on public.ltch_exam_questions(question_code);

-- 8. Bảng chia sẻ đề THPTQG năm cũ sang khóa mới (ltch_exam_year_shares)
create table if not exists public.ltch_exam_year_shares (
  exam_id text not null references public.ltch_exams(id) on delete cascade,
  school_year_id text not null references public.ltch_school_years(id),
  target_grade smallint not null check (target_grade between 10 and 12),
  enabled_by text not null references public.ltch_accounts(uid),
  enabled_at bigint not null,
  primary key (exam_id, school_year_id, target_grade)
);

-- 9. Mở rộng bảng lượt làm bài ltch_practice_attempts
alter table public.ltch_practice_attempts
  alter column submitted_at drop not null,
  alter column score drop not null,
  alter column max_score drop not null,
  alter column results drop not null,
  alter column responses set default '{}'::jsonb;

alter table public.ltch_practice_attempts
  drop constraint if exists ltch_practice_attempts_max_score_check,
  drop constraint if exists ltch_practice_attempts_results_check;

alter table public.ltch_practice_attempts
  add column if not exists status text not null default 'submitted' check (status in ('in_progress', 'submitted')),
  add column if not exists is_preview boolean not null default false,
  add column if not exists practice_mode text not null default 'full' check (practice_mode in ('full', 'section')),
  add column if not exists selected_section text check (selected_section is null or selected_section in ('part_1', 'part_2', 'part_3')),
  add column if not exists selected_combination text check (selected_combination is null or length(selected_combination) <= 32),
  add column if not exists started_at bigint,
  add column if not exists deadline_at bigint,
  add column if not exists attempt_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(attempt_questions) = 'array'),
  add column if not exists draft_meta jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_meta) = 'object'),
  add column if not exists active_device_token text,
  add column if not exists current_section integer not null default 1,
  add column if not exists section_states jsonb not null default '{}'::jsonb check (jsonb_typeof(section_states) = 'object');

alter table public.ltch_practice_attempts
  add constraint ltch_practice_attempts_submitted_fields_check check (
    status = 'in_progress' or (
      submitted_at is not null and
      score is not null and
      max_score is not null and max_score > 0 and
      results is not null and jsonb_typeof(results) = 'array'
    )
  );

create unique index if not exists ltch_practice_attempts_one_in_progress_idx
  on public.ltch_practice_attempts(exam_id, uid)
  where status = 'in_progress' and is_preview = false;

-- 10. Bảng báo lỗi câu hỏi ltch_question_reports
create table if not exists public.ltch_question_reports (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{8,100}$'),
  question_code text not null references public.ltch_question_bank(question_code),
  question_version integer not null default 1 check (question_version >= 1),
  question_order integer,
  attempt_id text not null references public.ltch_practice_attempts(id) on delete cascade,
  exam_id text not null references public.ltch_exams(id) on delete cascade,
  category text not null check (category in ('wrong_answer', 'solution_error', 'content_error', 'media_error', 'duplicate_question', 'other')),
  description text not null check (length(description) between 5 and 2000),
  status text not null default 'new' check (status in ('new', 'in_progress', 'fixed', 'hidden', 'rejected')),
  reported_by text not null references public.ltch_accounts(uid),
  resolved_by text references public.ltch_accounts(uid),
  resolution_note text not null default '' check (length(resolution_note) <= 2000),
  created_at bigint not null,
  resolved_at bigint,
  unique (attempt_id, question_code)
);
create index if not exists ltch_question_reports_status_idx on public.ltch_question_reports(status, created_at desc);

-- 11. Bảng lưu vết đăng tải file Word ltch_question_imports
create table if not exists public.ltch_question_imports (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{8,100}$'),
  exam_id text references public.ltch_exams(id) on delete set null,
  exam_type text not null check (exam_type in ('thptqg', 'hsa', 'tsa', 'class')),
  uploaded_by text not null references public.ltch_accounts(uid),
  file_path text not null check (length(file_path) <= 400),
  file_sha256 text not null check (length(file_sha256) <= 128),
  status text not null default 'parsed' check (status in ('parsed', 'saved', 'discarded')),
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object'),
  created_at bigint not null
);

-- RLS & phân quyền chỉ cho service_role
alter table public.ltch_student_grade_history enable row level security;
alter table public.ltch_passages enable row level security;
alter table public.ltch_passage_versions enable row level security;
alter table public.ltch_question_versions enable row level security;
alter table public.ltch_exam_questions enable row level security;
alter table public.ltch_exam_year_shares enable row level security;
alter table public.ltch_question_reports enable row level security;
alter table public.ltch_question_imports enable row level security;

revoke all on
  public.ltch_student_grade_history,
  public.ltch_passages,
  public.ltch_passage_versions,
  public.ltch_question_versions,
  public.ltch_exam_questions,
  public.ltch_exam_year_shares,
  public.ltch_question_reports,
  public.ltch_question_imports
from public, anon, authenticated;

grant select, insert, update, delete on
  public.ltch_student_grade_history,
  public.ltch_passages,
  public.ltch_passage_versions,
  public.ltch_question_versions,
  public.ltch_exam_questions,
  public.ltch_exam_year_shares,
  public.ltch_question_reports,
  public.ltch_question_imports
to service_role;

grant usage, select on sequence public.ltch_question_code_seq to service_role;

commit;
