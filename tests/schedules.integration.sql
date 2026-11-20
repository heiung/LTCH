-- Execute as a single transaction in the official project. All fixtures roll back.
begin;
do $$
declare v_ids text[];v_count integer;v_id text;
begin
 assert public.ltch_schedule_valid('[{"day":7,"start":"10:30","end":"12:00"}]');
 assert not public.ltch_schedule_valid('[{"day":7,"start":"10:30","end":"10:00"}]');
 assert not public.ltch_schedule_valid('[{"day":7,"start":"10:30","end":"12:00"},{"day":7,"start":"11:00","end":"13:00"}]');
 assert not has_function_privilege('anon','public.ltch_queue_lesson_reminders(timestamptz)','EXECUTE');
 assert not has_function_privilege('authenticated','public.ltch_claim_lesson_mail(text,text)','EXECUTE');
 insert into public.ltch_school_years(id,name,starts_on,ends_on) values('schedule-tx-year','Test','2026-09-01','2027-06-30');
 insert into public.ltch_accounts(uid,display_name,email,status,roles) values('schedule-tx-student','Test','schedule-test@example.invalid','active',array['student']);
 insert into public.ltch_classes(id,school_year_id,name,schedule_slots) values('schedule-tx-class','schedule-tx-year','Lớp 6A','[{"day":7,"start":"10:30","end":"12:00"}]');
 insert into public.ltch_class_memberships(class_id,uid,member_role) values('schedule-tx-class','schedule-tx-student','student');
 select count(*) into v_count from public.ltch_queue_lesson_reminders('2026-11-01 09:59:00+07');assert v_count=0,'must not notify earlier than 30 minutes';
 select array_agg(id) into v_ids from public.ltch_queue_lesson_reminders('2026-11-01 10:00:00+07');assert cardinality(v_ids)=1,'30-minute boundary must enqueue exactly once';v_id=v_ids[1];
 perform public.ltch_queue_lesson_reminders('2026-11-01 10:01:00+07');select count(*) into v_count from public.ltch_mail_outbox where id=v_id;assert v_count=1,'repeated ticks must not duplicate mail';
 update public.ltch_classes set schedule_revision=1 where id='schedule-tx-class';assert not public.ltch_lesson_mail_valid(v_id,'2026-11-01 10:00:00+07'),'old schedule must be invalid';
 perform public.ltch_queue_lesson_reminders('2026-11-01 10:00:00+07');assert public.ltch_lesson_mail_valid(v_id,'2026-11-01 10:00:00+07'),'updated occurrence can be queued again if unsent';
 update public.ltch_class_memberships set status='inactive' where class_id='schedule-tx-class';assert not public.ltch_lesson_mail_valid(v_id,'2026-11-01 10:00:00+07'),'removed student cannot be notified';
 update public.ltch_class_memberships set status='active' where class_id='schedule-tx-class';update public.ltch_classes set reminders_enabled=false where id='schedule-tx-class';
 assert not public.ltch_lesson_mail_valid(v_id,'2026-11-01 10:00:00+07'),'disabled reminders cannot be sent';
 update public.ltch_classes set reminders_enabled=true where id='schedule-tx-class';update public.ltch_mail_outbox set status='sent' where id=v_id;
 select count(*) into v_count from public.ltch_queue_lesson_reminders('2026-11-01 10:00:00+07');assert v_count=0,'already sent mail must stay sent';
 update public.ltch_classes set schedule_slots='[{"day":1,"start":"00:05","end":"01:05"}]',schedule_revision=2 where id='schedule-tx-class';
 select count(*) into v_count from public.ltch_queue_lesson_reminders('2026-11-01 23:35:00+07');assert v_count=1,'local midnight rollover must work';
 select count(*) into v_count from public.ltch_queue_lesson_reminders('2026-11-02 00:05:00+07');assert v_count=0,'must not send after the lesson starts';
end;$$;
rollback;
select 'schedule/reminder transaction checks passed' as result;
