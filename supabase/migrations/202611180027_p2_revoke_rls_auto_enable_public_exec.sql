begin;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
    if exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'rls_auto_enable'
        and p.pronargs = 0
        and p.proconfig is null
    ) then
      alter function public.rls_auto_enable() set search_path = pg_catalog;
    end if;
  end if;
end;
$$;

commit;
