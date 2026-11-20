begin;

create function public.ltch_schedule_valid(p_slots jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare s jsonb;t jsonb;
begin
 if p_slots is null or jsonb_typeof(p_slots)<>'array' or jsonb_array_length(p_slots)>14 then return false;end if;
 for s in select value from jsonb_array_elements(p_slots) loop
  if jsonb_typeof(s)<>'object' or not (s ?& array['day','start','end']) or jsonb_typeof(s->'day')<>'number' or jsonb_typeof(s->'start')<>'string' or jsonb_typeof(s->'end')<>'string' or
   (s->>'day')!~'^[1-7]$' or (s->>'start')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or
   (s->>'end')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (s->>'end')<=(s->>'start') then return false;end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_slots) with ordinality a(s,i),jsonb_array_elements(p_slots) with ordinality b(s,i)
  where a.i<b.i and a.s->>'day'=b.s->>'day' and a.s->>'start'<b.s->>'end' and b.s->>'start'<a.s->>'end') then return false;end if;
 return true;
exception when others then return false;
end;$$;
alter table public.ltch_classes add column schedule_slots jsonb not null default '[]' check(public.ltch_schedule_valid(schedule_slots));
alter table public.ltch_classes add column schedule_revision integer not null default 0 check(schedule_revision>=0);
alter table public.ltch_classes add column reminders_enabled boolean not null default true;

-- Rename display names only. IDs and every existing relationship stay intact.
update public.ltch_classes set name=regexp_replace(name,'^(Lớp )?(10|11|12)A1','\1\2A') where id in ('class-10a1','class-11a1','class-12a1') and name ~ '^(Lớp )?(10|11|12)A1';
update public.ltch_classes set name=regexp_replace(name,'^(Lớp )?(10|11|12)A2','\1\2B') where id in ('class-10a2','class-11a2','class-12a2') and name ~ '^(Lớp )?(10|11|12)A2';

alter table public.ltch_mail_outbox alter column request_id drop not null;
alter table public.ltch_mail_outbox drop constraint ltch_mail_outbox_template_check;
alter table public.ltch_mail_outbox add constraint ltch_mail_outbox_template_check check(template in ('approval_notice','revision_request','urgent_admin_alert','lesson_reminder'));
alter table public.ltch_mail_outbox drop constraint ltch_mail_outbox_status_check;
alter table public.ltch_mail_outbox add constraint ltch_mail_outbox_status_check check(status in ('pending','sending','sent','cancelled'));
alter table public.ltch_mail_outbox add column reminder_class_id text references public.ltch_classes(id);
alter table public.ltch_mail_outbox add column recipient_uid text references public.ltch_accounts(uid);
alter table public.ltch_mail_outbox add column reminder_starts_at timestamptz;
alter table public.ltch_mail_outbox add constraint ltch_mail_context check(
 (template='lesson_reminder' and request_id is null and reminder_class_id is not null and recipient_uid is not null and reminder_starts_at is not null)
 or (template<>'lesson_reminder' and request_id is not null));
create index ltch_lesson_mail_due on public.ltch_mail_outbox(reminder_starts_at) where template='lesson_reminder' and status in ('pending','sending');

create function public.ltch_lesson_mail_valid(p_id text,p_now timestamptz default now()) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.ltch_mail_outbox o
 join public.ltch_classes c on c.id=o.reminder_class_id
 join public.ltch_school_years y on y.id=c.school_year_id
 join public.ltch_class_memberships m on m.class_id=c.id and m.uid=o.recipient_uid and m.member_role='student' and m.status='active'
 join public.ltch_accounts a on a.uid=m.uid and a.status='active' and 'student'=any(a.roles)
 where o.id=p_id and o.template='lesson_reminder' and c.reminders_enabled and a.email=o.recipient
 and c.schedule_revision::text=o.payload->>'schedule_revision' and o.reminder_starts_at>p_now and o.reminder_starts_at<=p_now+interval '30 minutes'
 and (o.reminder_starts_at at time zone 'Asia/Ho_Chi_Minh')::date between y.starts_on and y.ends_on);
$$;

create function public.ltch_queue_lesson_reminders(p_now timestamptz default now()) returns table(id text) language plpgsql security invoker set search_path='' as $$
declare v_local date=(p_now at time zone 'Asia/Ho_Chi_Minh')::date;
begin
 if not pg_try_advisory_xact_lock(hashtext('ltch.lesson.reminders.v1')) then return;end if;
 update public.ltch_mail_outbox o set status='cancelled',lease_until=0
 where o.template='lesson_reminder' and o.status in ('pending','sending') and not public.ltch_lesson_mail_valid(o.id,p_now);
 insert into public.ltch_mail_outbox as existing(id,template,recipient,payload,reminder_class_id,recipient_uid,reminder_starts_at)
 select 'lesson-'||md5(c.id||'|'||a.uid||'|'||to_char(t.starts_at at time zone 'UTC','YYYY-MM-DD HH24:MI')),'lesson_reminder',a.email,
 jsonb_build_object('full_name',a.display_name,'class_name',c.name,'lesson_date',to_char(d.day,'DD/MM/YYYY'),'starts_at',s.slot->>'start','ends_at',s.slot->>'end','schedule_revision',c.schedule_revision),c.id,a.uid,t.starts_at
 from public.ltch_classes c join public.ltch_school_years y on y.id=c.school_year_id
 cross join lateral jsonb_array_elements(c.schedule_slots) s(slot)
 cross join lateral (values(v_local),(v_local+1)) d(day)
 cross join lateral (select (d.day+(s.slot->>'start')::time) at time zone 'Asia/Ho_Chi_Minh' as starts_at) t
 join public.ltch_class_memberships m on m.class_id=c.id and m.member_role='student' and m.status='active'
 join public.ltch_accounts a on a.uid=m.uid and a.status='active' and 'student'=any(a.roles)
 where c.reminders_enabled and d.day between y.starts_on and y.ends_on
 and extract(isodow from d.day)::integer=(s.slot->>'day')::integer
 and t.starts_at>p_now and t.starts_at<=p_now+interval '30 minutes' and a.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 on conflict on constraint ltch_mail_outbox_pkey do update set recipient=excluded.recipient,payload=excluded.payload,status='pending',lease_until=0
 where existing.status='cancelled';
 return query select o.id from public.ltch_mail_outbox o where o.template='lesson_reminder' and
 (o.status='pending' or o.status='sending' and o.lease_until<(extract(epoch from p_now)*1000)::bigint)
 and public.ltch_lesson_mail_valid(o.id,p_now) order by o.reminder_starts_at,o.created_at limit 100;
end;$$;

create function public.ltch_claim_lesson_mail(p_id text,p_token text) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.ltch_mail_outbox%rowtype;
begin
 select * into r from public.ltch_mail_outbox where id=p_id and template='lesson_reminder' for update;
 if not found or r.status in ('sent','cancelled') then return false;end if;
 if not public.ltch_lesson_mail_valid(p_id) then update public.ltch_mail_outbox set status='cancelled',lease_until=0 where id=p_id;return false;end if;
 return public.ltch_claim_mail(p_id,p_token);
end;$$;

revoke all on function public.ltch_schedule_valid(jsonb),public.ltch_lesson_mail_valid(text,timestamptz),public.ltch_queue_lesson_reminders(timestamptz),public.ltch_claim_lesson_mail(text,text) from public,anon,authenticated;
grant execute on function public.ltch_schedule_valid(jsonb),public.ltch_lesson_mail_valid(text,timestamptz),public.ltch_queue_lesson_reminders(timestamptz),public.ltch_claim_lesson_mail(text,text) to service_role;
commit;
