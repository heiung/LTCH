begin;
create table public.ltch_promotion_plans(id text primary key,actor_uid text not null references public.ltch_accounts(uid),source_year text not null references public.ltch_school_years(id),target_year text not null references public.ltch_school_years(id),mapping jsonb not null check(jsonb_typeof(mapping)='array' and jsonb_array_length(mapping) between 1 and 500),expires_at bigint not null,applied_at bigint,check(source_year<>target_year));
alter table public.ltch_promotion_plans enable row level security;
revoke all on public.ltch_promotion_plans from public,anon,authenticated;
grant select,insert,update,delete on public.ltch_promotion_plans to service_role;
create function public.ltch_apply_promotion(p_id text,p_actor text) returns integer language plpgsql security invoker set search_path='' as $$
declare plan public.ltch_promotion_plans%rowtype; item jsonb; v_now bigint; v_count integer;
begin
 v_now=(extract(epoch from clock_timestamp())*1000)::bigint;
 if not exists(select 1 from public.ltch_accounts where uid=p_actor and status='active' and 'admin'=any(roles)) then raise exception 'not authorized';end if;
 select * into plan from public.ltch_promotion_plans where id=p_id and actor_uid=p_actor for update;
 if not found then raise exception 'plan missing';end if;
 v_count=jsonb_array_length(plan.mapping);
 if plan.applied_at is not null then return v_count;end if;
 if plan.expires_at<=v_now then raise exception 'plan expired';end if;
 if (select count(distinct value->>'studentId') from jsonb_array_elements(plan.mapping))<>v_count then raise exception 'duplicate students';end if;
 for item in select value from jsonb_array_elements(plan.mapping) order by value->>'studentId' loop
  perform pg_advisory_xact_lock(hashtextextended(item->>'studentId',0));
  if not exists(select 1 from public.ltch_class_memberships m join public.ltch_classes c on c.id=m.class_id where m.uid=item->>'studentId' and m.class_id=item->>'sourceClassId' and m.member_role='student' and m.status='active' and c.school_year_id=plan.source_year) then raise exception 'source membership changed';end if;
  if not exists(select 1 from public.ltch_classes where id=item->>'classId' and school_year_id=plan.target_year) then raise exception 'invalid destination';end if;
  if exists(select 1 from public.ltch_class_memberships m join public.ltch_classes c on c.id=m.class_id where m.uid=item->>'studentId' and m.member_role='student' and m.status='active' and c.school_year_id=plan.target_year) then raise exception 'already enrolled';end if;
  insert into public.ltch_class_memberships(class_id,uid,member_role,status) values(item->>'classId',item->>'studentId','student','active');
 end loop;
 update public.ltch_promotion_plans set applied_at=v_now where id=plan.id;
 return v_count;
end;$$;
revoke all on function public.ltch_apply_promotion(text,text) from public,anon,authenticated;
grant execute on function public.ltch_apply_promotion(text,text) to service_role;
commit;
