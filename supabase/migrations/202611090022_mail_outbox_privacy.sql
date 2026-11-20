begin;

create or replace function public.ltch_enrollment_urgent(p_id text,p_actor text) returns text language plpgsql security invoker set search_path='' as $$
declare r public.ltch_enrollment_requests%rowtype;v_now bigint=(extract(epoch from clock_timestamp())*1000)::bigint;v_event text;v_payload jsonb;
begin
 select * into r from public.ltch_enrollment_requests where id=p_id and uid=p_actor for update;
 if not found or r.status<>'pending' then raise exception 'request unavailable';end if;
 if r.urgent_notified_at is not null and r.urgent_notified_at>v_now-1800000 then raise exception 'wait 30 minutes';end if;
 v_event=r.id||'-urgent-'||(v_now/1800000)::text;
 select jsonb_build_object('full_name',r.full_name,'class_name',c.name,'school_year_name',y.name,'request_time',to_char(now() at time zone 'Asia/Ho_Chi_Minh','DD/MM/YYYY HH24:MI')) into v_payload from public.ltch_classes c join public.ltch_school_years y on y.id=c.school_year_id where c.id=r.class_id;
 insert into public.ltch_mail_outbox(id,request_id,template,recipient,payload) values(v_event,r.id,'urgent_admin_alert',coalesce((select email from public.ltch_accounts where status='active' and 'admin'=any(roles) order by uid limit 1),'admin@example.com'),v_payload);
 update public.ltch_enrollment_requests set urgent_notified_at=v_now where id=r.id;return v_event;
end;$$;

update public.ltch_mail_outbox
set payload = case
 when template = 'lesson_reminder' and payload ? 'schedule_revision' then jsonb_build_object('schedule_revision', payload->'schedule_revision')
 else '{}'::jsonb
end
where status in ('sent', 'cancelled');

commit;
