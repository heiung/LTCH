begin;
-- Firebase UID is the identity key. Client-side role claims are never trusted.
create table public.ltch_accounts (
 uid text primary key check (length(uid) between 1 and 128),
 display_name text not null check (length(display_name) between 1 and 160),
 status text not null default 'pending' check (status in ('pending','active','disabled')),
 roles text[] not null default '{}' check (roles <@ array['admin','teacher','assistant','student','parent']::text[]),
 created_at timestamptz not null default now()
);
create table public.ltch_school_years (
 id text primary key check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
 name text not null check (length(name) between 1 and 100),
 starts_on date not null, ends_on date not null check (ends_on > starts_on)
);
create table public.ltch_classes (
 id text primary key check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
 school_year_id text not null references public.ltch_school_years(id),
 name text not null check (length(name) between 1 and 120),
 schedule text not null default '' check (length(schedule) <= 2000)
);
create table public.ltch_class_memberships (
 class_id text not null references public.ltch_classes(id),
 uid text not null references public.ltch_accounts(uid),
 member_role text not null check (member_role in ('teacher','assistant','student')),
 status text not null default 'active' check (status in ('active','inactive')),
 primary key(class_id,uid,member_role)
);
create index ltch_memberships_uid on public.ltch_class_memberships(uid);
create table public.ltch_parent_links (
 parent_uid text not null references public.ltch_accounts(uid),
 student_uid text not null references public.ltch_accounts(uid),
 status text not null default 'active' check (status in ('active','inactive')),
 primary key(parent_uid,student_uid), check(parent_uid <> student_uid)
);
create table public.ltch_assignments (
 id text primary key check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
 class_id text not null references public.ltch_classes(id),
 title text not null check (length(title) between 1 and 250),
 instructions text not null default '' check (length(instructions) <= 20000),
 status text not null default 'draft' check (status in ('draft','published','archived')),
 opens_at bigint not null, closes_at bigint not null check (closes_at > opens_at),
 created_by text not null references public.ltch_accounts(uid)
);
create index ltch_assignments_class on public.ltch_assignments(class_id);
create table public.ltch_submissions (
 id text primary key check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
 assignment_id text not null references public.ltch_assignments(id),
 uid text not null references public.ltch_accounts(uid),
 object_path text not null unique check (length(object_path) between 1 and 400),
 status text not null check (status in ('pending','stored','failed')),
 created_at bigint not null, stored_at bigint, file_size integer, content_type text,
 check (status <> 'stored' or (stored_at is not null and file_size > 0 and content_type is not null))
);
create index ltch_submissions_assignment on public.ltch_submissions(assignment_id,uid);
alter table public.ltch_accounts enable row level security;
alter table public.ltch_school_years enable row level security;
alter table public.ltch_classes enable row level security;
alter table public.ltch_class_memberships enable row level security;
alter table public.ltch_parent_links enable row level security;
alter table public.ltch_assignments enable row level security;
alter table public.ltch_submissions enable row level security;
revoke all on public.ltch_accounts,public.ltch_school_years,public.ltch_classes,public.ltch_class_memberships,public.ltch_parent_links,public.ltch_assignments,public.ltch_submissions from public,anon,authenticated;
grant select,insert,update,delete on public.ltch_accounts,public.ltch_school_years,public.ltch_classes,public.ltch_class_memberships,public.ltch_parent_links,public.ltch_assignments,public.ltch_submissions to service_role;
commit;
