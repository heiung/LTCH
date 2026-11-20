begin;
create table public.ltch_forum_posts (
 id text primary key, class_id text not null references public.ltch_classes(id),
 author_uid text not null references public.ltch_accounts(uid), title text not null check(length(title) between 1 and 250),
 body text not null check(length(body) between 1 and 20000), created_at bigint not null,
 file_path text, file_name text, content_type text, file_size integer,
 check ((file_path is null and file_name is null and content_type is null and file_size is null) or
 (file_path is not null and file_name is not null and content_type is not null and file_size is not null and content_type in ('application/pdf','image/jpeg','image/png') and file_size between 1 and 10000000))
);
create index ltch_forum_posts_class_date on public.ltch_forum_posts(class_id,created_at desc);
create table public.ltch_forum_comments (
 id text primary key, post_id text not null references public.ltch_forum_posts(id),
 author_uid text not null references public.ltch_accounts(uid), body text not null check(length(body) between 1 and 20000), created_at bigint not null,
 file_path text, file_name text, content_type text, file_size integer,
 check ((file_path is null and file_name is null and content_type is null and file_size is null) or
 (file_path is not null and file_name is not null and content_type is not null and file_size is not null and content_type in ('application/pdf','image/jpeg','image/png') and file_size between 1 and 10000000))
);
create index ltch_forum_comments_post_date on public.ltch_forum_comments(post_id,created_at);
alter table public.ltch_forum_posts enable row level security;
alter table public.ltch_forum_comments enable row level security;
revoke all on public.ltch_forum_posts, public.ltch_forum_comments from public, anon, authenticated;
grant select, insert, update, delete on public.ltch_forum_posts, public.ltch_forum_comments to service_role;
commit;
