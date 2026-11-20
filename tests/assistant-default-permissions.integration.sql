-- Prepare fixtures and migration 018 in one transaction, run these assertions,
-- then ROLLBACK. Existing per-class grants in the fixture are intentional.
-- PRE-MIGRATION
insert into public.ltch_school_years(id,name,starts_on,ends_on)
 values ('__assistant_default_year','Kiểm thử','2026-09-01','2027-08-31');
insert into public.ltch_classes(id,school_year_id,name,enrollment_open) values
 ('__assistant_default_c1','__assistant_default_year','Lớp 6',true),
 ('__assistant_default_c2','__assistant_default_year','Lớp 7',true);
insert into public.ltch_accounts(uid,display_name,email,status,roles)
 values ('__assistant_default','Kiểm thử','default-test@example.invalid','active',array['assistant']);
update public.ltch_class_memberships set permissions=array['messages.write']
 where uid='__assistant_default' and class_id='__assistant_default_c1' and member_role='assistant';

-- POST-MIGRATION
do $$ begin
 if not exists(select 1 from public.ltch_class_memberships where uid='__assistant_default' and class_id='__assistant_default_c1' and permissions=array['messages.write']) then raise exception 'custom grant overwritten'; end if;
 if not exists(select 1 from public.ltch_class_memberships where uid='__assistant_default' and class_id='__assistant_default_c2' and cardinality(permissions)=7) then raise exception 'default grants missing'; end if;
end;$$;
insert into public.ltch_classes(id,school_year_id,name,enrollment_open)
 values ('__assistant_default_c3','__assistant_default_year','Lớp 8A',true);
do $$ begin
 if not exists(select 1 from public.ltch_class_memberships where uid='__assistant_default' and class_id='__assistant_default_c3' and cardinality(permissions)=7) then raise exception 'new class lacks defaults'; end if;
end;$$;
update public.ltch_class_memberships set permissions=array_remove(permissions,'messages.write')
 where uid='__assistant_default' and class_id='__assistant_default_c2' and member_role='assistant';
update public.ltch_accounts set status='disabled' where uid='__assistant_default';
update public.ltch_accounts set status='active' where uid='__assistant_default';
do $$ begin
 if not exists(select 1 from public.ltch_class_memberships where uid='__assistant_default' and class_id='__assistant_default_c2' and status='active' and not ('messages.write'=any(permissions)) and cardinality(permissions)=6) then raise exception 'disabled permission was restored'; end if;
end;$$;
update public.ltch_accounts set roles=array['student'] where uid='__assistant_default';
update public.ltch_accounts set status='pending' where uid='__assistant_default';
update public.ltch_accounts set roles=array['assistant'] where uid='__assistant_default';
update public.ltch_accounts set status='active' where uid='__assistant_default';
do $$ begin
 if not exists(select 1 from public.ltch_class_memberships where uid='__assistant_default' and class_id='__assistant_default_c2' and status='active' and cardinality(permissions)=7) then raise exception 'new role assignment lacks defaults'; end if;
end;$$;
