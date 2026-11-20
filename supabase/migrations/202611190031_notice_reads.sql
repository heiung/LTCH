begin;

create table if not exists public.ltch_notice_reads (
  notice_id text not null references public.ltch_notices(id) on delete cascade,
  uid text not null references public.ltch_accounts(uid) on delete cascade,
  seen_at bigint not null check (seen_at >= 0),
  primary key (notice_id, uid)
);

create index if not exists ltch_notice_reads_uid_idx
  on public.ltch_notice_reads (uid, seen_at desc);

alter table public.ltch_notice_reads enable row level security;
revoke all on public.ltch_notice_reads from public, anon, authenticated;
grant select, insert, update, delete on public.ltch_notice_reads to service_role;

commit;
