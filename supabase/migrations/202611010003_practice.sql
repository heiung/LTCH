begin;
create table public.ltch_exams (
 id text primary key check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
 class_id text not null references public.ltch_classes(id),
 title text not null check (length(title) between 1 and 250),
 status text not null default 'draft' check (status in ('draft','published','archived')),
 opens_at bigint not null, closes_at bigint not null check (closes_at > opens_at),
 results_at bigint, solutions_at bigint,
 questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 300),
 created_by text not null references public.ltch_accounts(uid)
);
create index ltch_exams_class on public.ltch_exams(class_id);
create table public.ltch_practice_attempts (
 id text primary key check (id ~ '^[A-Za-z0-9_-]{16,100}$'),
 exam_id text not null references public.ltch_exams(id),
 uid text not null references public.ltch_accounts(uid),
 submitted_at bigint not null,
 responses jsonb not null check (jsonb_typeof(responses)='object'),
 score double precision not null, max_score double precision not null check (max_score > 0),
 results jsonb not null check (jsonb_typeof(results)='array')
);
create index ltch_practice_attempts_owner on public.ltch_practice_attempts(uid,exam_id);
alter table public.ltch_exams enable row level security;
alter table public.ltch_practice_attempts enable row level security;
revoke all on public.ltch_exams,public.ltch_practice_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.ltch_exams,public.ltch_practice_attempts to service_role;
commit;
