-- Server-only authentication state. Client Firebase tokens alone must never
-- access these tables. No RLS policies are created for browser roles.
begin;
create table if not exists public.ltch_otp_challenges (
  uid text primary key check (length(uid) between 1 and 128),
  version bigint not null check (version > 0),
  payload jsonb not null
);
create table if not exists public.ltch_sessions (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  uid text not null check (length(uid) between 1 and 128),
  created_at bigint not null,
  expires_at bigint not null check (expires_at > created_at)
);
create index if not exists ltch_sessions_expiry on public.ltch_sessions(expires_at);
create table if not exists public.ltch_rate_limits (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  count integer not null check (count > 0),
  expires_at bigint not null
);
create index if not exists ltch_rate_limits_expiry on public.ltch_rate_limits(expires_at);
alter table public.ltch_otp_challenges enable row level security;
alter table public.ltch_sessions enable row level security;
alter table public.ltch_rate_limits enable row level security;
revoke all on public.ltch_otp_challenges, public.ltch_sessions, public.ltch_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.ltch_otp_challenges, public.ltch_sessions, public.ltch_rate_limits to service_role;
create or replace function public.ltch_consume_rate(p_id text, p_expiry bigint, p_max integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  if p_id !~ '^[a-f0-9]{64}$' or p_max < 1 or p_max > 100 or p_expiry <= 0 then raise exception 'invalid rate limit'; end if;
  insert into public.ltch_rate_limits as limits (id,count,expires_at) values (p_id,1,p_expiry)
  on conflict (id) do update set count=limits.count+1 where limits.count < p_max
  returning count into v_count;
  return v_count is not null;
end;
$$;
revoke all on function public.ltch_consume_rate(text,bigint,integer) from public, anon, authenticated;
grant execute on function public.ltch_consume_rate(text,bigint,integer) to service_role;
commit;
