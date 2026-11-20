begin;

-- An active teacher manages every non-archived class. Memberships keep the
-- existing per-class authorization and enrollment-review checks consistent.
create function public.ltch_sync_global_teacher() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='ltch_accounts' then
  if tg_op='INSERT' and not ('teacher'=any(new.roles)) then return new; end if;
  if tg_op='UPDATE' and not ('teacher'=any(old.roles) or 'teacher'=any(new.roles)) then return new; end if;
 elsif new.archived then return new;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('ltch.global_teachers',0));
 if tg_table_name='ltch_accounts' then
  if new.status='active' and 'teacher'=any(new.roles) and not ('admin'=any(new.roles)) then
   insert into public.ltch_class_memberships(class_id,uid,member_role,status)
    select c.id,new.uid,'teacher','active' from public.ltch_classes c where not c.archived
    on conflict(class_id,uid,member_role) do update set status='active'
    where public.ltch_class_memberships.status <> 'active';
  elsif not ('teacher'=any(new.roles)) or new.status<>'active' then
   update public.ltch_class_memberships set status='inactive'
    where uid=new.uid and member_role='teacher' and status='active';
  end if;
 elsif not new.archived then
  insert into public.ltch_class_memberships(class_id,uid,member_role,status)
   select new.id,a.uid,'teacher','active' from public.ltch_accounts a
    where a.status='active' and 'teacher'=any(a.roles) and not ('admin'=any(a.roles))
   on conflict(class_id,uid,member_role) do update set status='active'
   where public.ltch_class_memberships.status <> 'active';
 end if;
 return new;
end;$$;

create function public.ltch_guard_global_teacher() returns trigger
language plpgsql security invoker set search_path='' as $$
declare member_uid text; member_class text; member_role text;
begin
 if tg_op<>'DELETE' and new.member_role='teacher' and new.status<>'active' and exists (
  select 1 from public.ltch_accounts a join public.ltch_classes c on c.id=new.class_id
  where a.uid=new.uid and a.status='active' and 'teacher'=any(a.roles)
   and not ('admin'=any(a.roles)) and not c.archived
 ) then raise exception 'LTCH_GLOBAL_TEACHER_MEMBERSHIP'; end if;
 if tg_op='INSERT' then member_uid=new.uid;member_class=new.class_id;member_role=new.member_role;
 else member_uid=old.uid;member_class=old.class_id;member_role=old.member_role; end if;
 if member_role='teacher' and exists (
  select 1 from public.ltch_accounts a join public.ltch_classes c on c.id=member_class
  where a.uid=member_uid and a.status='active' and 'teacher'=any(a.roles)
   and not ('admin'=any(a.roles)) and not c.archived
 ) then
  if tg_op='DELETE' then raise exception 'LTCH_GLOBAL_TEACHER_MEMBERSHIP'; end if;
  if new.status<>'active' or new.uid<>member_uid or new.class_id<>member_class or new.member_role<>'teacher' then
   raise exception 'LTCH_GLOBAL_TEACHER_MEMBERSHIP';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;$$;

create trigger ltch_global_teacher_guard before insert or update or delete on public.ltch_class_memberships
 for each row execute function public.ltch_guard_global_teacher();
create trigger ltch_global_teacher_account after insert or update of status,roles on public.ltch_accounts
 for each row execute function public.ltch_sync_global_teacher();
create trigger ltch_global_teacher_class after insert or update of archived on public.ltch_classes
 for each row execute function public.ltch_sync_global_teacher();

-- Backfill existing non-admin teachers; administrators already manage all classes.
insert into public.ltch_class_memberships(class_id,uid,member_role,status)
 select c.id,a.uid,'teacher','active' from public.ltch_accounts a cross join public.ltch_classes c
 where a.status='active' and 'teacher'=any(a.roles) and not ('admin'=any(a.roles)) and not c.archived
 on conflict(class_id,uid,member_role) do update set status='active'
 where public.ltch_class_memberships.status <> 'active';

revoke all on function public.ltch_sync_global_teacher(),public.ltch_guard_global_teacher() from public,anon,authenticated;
grant execute on function public.ltch_sync_global_teacher(),public.ltch_guard_global_teacher() to service_role;
commit;
