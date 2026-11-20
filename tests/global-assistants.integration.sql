-- Insert the pre-migration fixtures, then run migration 017 without BEGIN/COMMIT,
-- then run the post-migration assertions, all in one transaction and ROLLBACK.
-- PRE-MIGRATION
insert into public.ltch_school_years(id,name,starts_on,ends_on)
 values ('__global_assistant_year','Kiểm thử','2026-09-01','2027-08-31');
insert into public.ltch_classes(id,school_year_id,name,enrollment_open) values
 ('__global_assistant_c1','__global_assistant_year','Lớp 6',true),
 ('__global_assistant_c2','__global_assistant_year','Lớp 7',true);
insert into public.ltch_accounts(uid,display_name,email,status,roles) values
 ('__global_assistant','Kiểm thử','assistant-test@example.invalid','active',array['assistant']),
 ('__global_pending','Kiểm thử','pending-test@example.invalid','pending',array['assistant']);
insert into public.ltch_class_memberships(class_id,uid,member_role,status,permissions) values
 ('__global_assistant_c1','__global_assistant','assistant','active',array['messages.write']),
 ('__global_assistant_c2','__global_assistant','assistant','inactive',array['attendance.write']);

-- POST-MIGRATION
do $$ begin
 if not exists(select 1 from public.ltch_class_memberships where uid='__global_assistant' and class_id='__global_assistant_c1' and status='active' and permissions=array['messages.write']) then raise exception 'existing grant changed'; end if;
 if not exists(select 1 from public.ltch_class_memberships where uid='__global_assistant' and class_id='__global_assistant_c2' and status='active' and permissions=array['attendance.write']) then raise exception 'inactive grant lost'; end if;
 if exists(select 1 from public.ltch_class_memberships where uid='__global_pending') then raise exception 'pending assistant auto-assigned'; end if;
end;$$;
insert into public.ltch_classes(id,school_year_id,name,enrollment_open)
 values ('__global_assistant_c3','__global_assistant_year','Lớp 8A',true);
do $$ begin
 if not exists(select 1 from public.ltch_class_memberships where uid='__global_assistant' and class_id='__global_assistant_c3' and status='active' and cardinality(permissions)=0) then raise exception 'new class grant not empty'; end if;
 begin
  update public.ltch_class_memberships set status='inactive' where uid='__global_assistant' and class_id='__global_assistant_c1' and member_role='assistant';
  raise exception 'assistant membership removal accepted';
 exception when others then if sqlerrm<>'LTCH_GLOBAL_ASSISTANT_MEMBERSHIP' then raise; end if; end;
end;$$;
update public.ltch_accounts set status='disabled' where uid='__global_assistant';
do $$ begin
 if exists(select 1 from public.ltch_class_memberships where uid='__global_assistant' and member_role='assistant' and status='active') then raise exception 'disabled assistant remains assigned'; end if;
end;$$;
update public.ltch_accounts set status='active' where uid='__global_assistant';
do $$ begin
 if not exists(select 1 from public.ltch_class_memberships where uid='__global_assistant' and class_id='__global_assistant_c2' and status='active' and permissions=array['attendance.write']) then raise exception 'reactivation lost grant'; end if;
end;$$;
update public.ltch_accounts set roles=array['student'] where uid='__global_assistant';
do $$ begin
 if exists(select 1 from public.ltch_class_memberships where uid='__global_assistant' and member_role='assistant' and (status='active' or cardinality(permissions)>0)) then raise exception 'removed role retained grants'; end if;
end;$$;
