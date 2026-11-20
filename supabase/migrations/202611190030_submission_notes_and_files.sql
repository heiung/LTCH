begin;

alter table public.ltch_submissions
 add column if not exists student_note text not null default '' check (length(student_note) <= 2000),
 add column if not exists files jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array');

commit;
