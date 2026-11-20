-- Run only as database owner; all fixture writes roll back in this transaction.
begin;
insert into public.ltch_accounts(uid,display_name,status,roles) values
('__ltch_verify_admin','Temporary integration check','active',array['admin']),
('__ltch_verify_s1','Temporary integration check','active',array['student']),
('__ltch_verify_s2','Temporary integration check','active',array['student']);
insert into public.ltch_school_years(id,name,starts_on,ends_on) values
('__ltch_verify_y1','Temporary source','2025-09-01','2026-08-31'),
('__ltch_verify_y2','Temporary target','2026-09-01','2027-08-31');
insert into public.ltch_classes(id,school_year_id,name) values
('__ltch_verify_c1','__ltch_verify_y1','Lớp 6'),
('__ltch_verify_c2','__ltch_verify_y2','Lớp 7');
insert into public.ltch_class_memberships(class_id,uid,member_role) values
('__ltch_verify_c1','__ltch_verify_s1','student'),('__ltch_verify_c1','__ltch_verify_s2','student');
insert into public.ltch_promotion_plans(id,actor_uid,source_year,target_year,mapping,expires_at) values
('__ltch_verify_bad','__ltch_verify_admin','__ltch_verify_y1','__ltch_verify_y2','[{"studentId":"__ltch_verify_s1","sourceClassId":"__ltch_verify_c1","classId":"__ltch_verify_c2"},{"studentId":"__ltch_verify_s2","sourceClassId":"__ltch_verify_c1","classId":"missing"}]',(extract(epoch from now())*1000)::bigint+60000),
('__ltch_verify_good','__ltch_verify_admin','__ltch_verify_y1','__ltch_verify_y2','[{"studentId":"__ltch_verify_s1","sourceClassId":"__ltch_verify_c1","classId":"__ltch_verify_c2"},{"studentId":"__ltch_verify_s2","sourceClassId":"__ltch_verify_c1","classId":"__ltch_verify_c2"}]',(extract(epoch from now())*1000)::bigint+60000);
do $$ begin
 begin
  perform public.ltch_apply_promotion('__ltch_verify_bad','__ltch_verify_admin');
  raise exception 'expected rejection';
 exception when others then if sqlerrm<>'invalid destination' then raise;end if;end;
 if exists(select 1 from public.ltch_class_memberships where class_id='__ltch_verify_c2') then raise exception 'partial write';end if;
 if public.ltch_apply_promotion('__ltch_verify_good','__ltch_verify_admin')<>2 then raise exception 'wrong count';end if;
 if public.ltch_apply_promotion('__ltch_verify_good','__ltch_verify_admin')<>2 then raise exception 'not idempotent';end if;
 if (select count(*) from public.ltch_class_memberships where class_id='__ltch_verify_c2')<>2 then raise exception 'duplicate write';end if;
 if (select count(*) from public.ltch_class_memberships where class_id='__ltch_verify_c1' and status='active')<>2 then raise exception 'history changed';end if;
end;$$;
rollback;
select not exists(select 1 from public.ltch_accounts where uid='__ltch_verify_admin') as no_fixtures_left,
 (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'ltch_%' and c.relkind='r') as table_count,
 (select bool_and(c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT') and not has_table_privilege('authenticated',c.oid,'INSERT') and has_table_privilege('service_role',c.oid,'SELECT')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'ltch_%' and c.relkind='r') as all_tables_protected;
