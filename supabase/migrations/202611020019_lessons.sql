begin;
-- Additive: existing ltch_materials and private bucket are untouched.
create table public.ltch_lessons (
 id text primary key check(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 class_id text not null references public.ltch_classes(id),
 title text not null check(length(title) between 1 and 250),
 topic text not null default '' check(length(topic)<=200),
 created_by text not null references public.ltch_accounts(uid),
 created_at bigint not null check(created_at>=0),
 unique(id,class_id)
);
create index ltch_lessons_class_order on public.ltch_lessons(class_id,created_at desc,id desc);
create table public.ltch_drive_folders (
 folder_key text primary key check(length(folder_key) between 1 and 200),
 drive_folder_id text not null unique check(drive_folder_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 parent_folder_id text not null check(parent_folder_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 folder_name text not null check(length(folder_name) between 1 and 250)
);
create table public.ltch_lesson_files (
 id text primary key check(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 lesson_id text not null,
 class_id text not null,
 name text not null check(length(name) between 1 and 250),
 drive_file_id text not null unique check(drive_file_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 content_type text not null check(length(content_type) between 1 and 127),
 file_size integer not null check(file_size between 1 and 10000000),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 request_id text not null check(request_id ~ '^[A-Za-z0-9_-]{16,128}$'),
 status text not null check(status in ('pending','stored','failed')),
 created_by text not null references public.ltch_accounts(uid),
 created_at bigint not null check(created_at>=0),
 foreign key(lesson_id,class_id) references public.ltch_lessons(id,class_id),
 unique(lesson_id,created_by,request_id)
);
create index ltch_lesson_files_lesson on public.ltch_lesson_files(class_id,lesson_id,created_at,id);
alter table public.ltch_lessons enable row level security;
alter table public.ltch_lesson_files enable row level security;
alter table public.ltch_drive_folders enable row level security;
revoke all on public.ltch_lessons,public.ltch_lesson_files,public.ltch_drive_folders from public,anon,authenticated;
grant select,insert,update,delete on public.ltch_lessons,public.ltch_lesson_files,public.ltch_drive_folders to service_role;
commit;
