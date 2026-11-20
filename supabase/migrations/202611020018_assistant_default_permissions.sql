begin;

-- New assistant memberships start with the standard role permissions. Existing
-- per-class changes survive reactivation and class changes.
create or replace function public.ltch_sync_global_assistant() returns trigger
language plpgsql security invoker set search_path='' as $$
declare default_grants constant text[] := array['schedule.manage','attendance.write','materials.write','assignments.write','practice.manage','notices.write','messages.write'];
begin
 if tg_table_name='ltch_accounts' then
  if tg_op='INSERT' and not ('assistant'=any(new.roles)) then return new; end if;
  if tg_op='UPDATE' and not ('assistant'=any(old.roles) or 'assistant'=any(new.roles)) then return new; end if;
 elsif new.archived then return new;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('ltch.global_teachers',0));
 if tg_table_name='ltch_accounts' then
  -- Removing the role clears grants in migration 017; adding it again starts
  -- a new role assignment with the standard defaults, even while pending.
  if tg_op='UPDATE' and not ('assistant'=any(old.roles)) and 'assistant'=any(new.roles) then
   update public.ltch_class_memberships m set permissions=default_grants,
    status=case when new.status='active' and not c.archived then 'active' else m.status end
    from public.ltch_classes c where c.id=m.class_id and m.uid=new.uid and m.member_role='assistant';
  end if;
  if new.status='active' and 'assistant'=any(new.roles) and not ('admin'=any(new.roles)) then
   insert into public.ltch_class_memberships(class_id,uid,member_role,status,permissions)
    select c.id,new.uid,'assistant','active',default_grants from public.ltch_classes c where not c.archived
    on conflict(class_id,uid,member_role) do update set status='active'
    where public.ltch_class_memberships.status <> 'active';
  elsif not ('assistant'=any(new.roles)) then
   update public.ltch_class_memberships set status='inactive',permissions=array[]::text[]
    where uid=new.uid and member_role='assistant' and (status='active' or cardinality(permissions)>0);
  elsif new.status<>'active' then
   update public.ltch_class_memberships set status='inactive'
    where uid=new.uid and member_role='assistant' and status='active';
  end if;
 elsif not new.archived then
  insert into public.ltch_class_memberships(class_id,uid,member_role,status,permissions)
   select new.id,a.uid,'assistant','active',default_grants from public.ltch_accounts a
    where a.status='active' and 'assistant'=any(a.roles) and not ('admin'=any(a.roles))
   on conflict(class_id,uid,member_role) do update set status='active'
   where public.ltch_class_memberships.status <> 'active';
 end if;
 return new;
end;$$;

-- The existing empty lists came from migration 017's read-only default. Lists
-- with specific grants are retained because an administrator may have edited them.
update public.ltch_class_memberships m
 set permissions=array['schedule.manage','attendance.write','materials.write','assignments.write','practice.manage','notices.write','messages.write']::text[]
 from public.ltch_accounts a,public.ltch_classes c
 where a.uid=m.uid and c.id=m.class_id and a.status='active' and 'assistant'=any(a.roles)
  and not ('admin'=any(a.roles)) and not c.archived and m.member_role='assistant'
  and m.status='active' and cardinality(m.permissions)=0;

revoke all on function public.ltch_sync_global_assistant() from public,anon,authenticated;
grant execute on function public.ltch_sync_global_assistant() to service_role;
commit;
