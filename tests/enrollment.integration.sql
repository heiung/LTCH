-- Temporary test data only; the whole transaction is rolled back.
begin;
insert into public.ltch_accounts(uid,display_name,email,status,roles) values
 ('__check_admin','Kiểm tra','qa-admin@example.test','active',array['admin']),
 ('__check_student','Kiểm tra','qa-student@example.test','pending',array[]::text[]);
insert into public.ltch_school_years(id,name,starts_on,ends_on) values ('__check_year','Kiểm tra','2026-01-01','2026-12-31');
insert into public.ltch_classes(id,school_year_id,name,enrollment_open) values ('__check_class','__check_year','Lớp 6',true);
insert into public.ltch_enrollment_requests(id,uid,applicant_role,school_year_id,class_id,full_name,date_of_birth,school_name,parent_name,parent_phone,parent_relation,photo_path,status) values
 ('__check_request','__check_student','student','__check_year','__check_class','Kiểm tra','2010-01-01','Kiểm tra','Kiểm tra','0900000000','guardian','profiles/__check_student/x.jpg','pending');
do $$ declare job text; begin
 job:=public.ltch_enrollment_urgent('__check_request','__check_student');
 if not exists(select 1 from public.ltch_mail_outbox where id=job and template='urgent_admin_alert') then raise exception 'urgent outbox missing';end if;
 begin
  perform public.ltch_enrollment_urgent('__check_request','__check_student'); raise exception 'rate limit failed';
 exception when others then if sqlerrm <> 'wait 30 minutes' then raise; end if; end;
 job:=public.ltch_review_enrollment('__check_request','__check_admin',1,'approve','__check_class','','');
 if not exists(select 1 from public.ltch_accounts where uid='__check_student' and status='active' and 'student'=any(roles)) then raise exception 'account not activated';end if;
 if not exists(select 1 from public.ltch_class_memberships where uid='__check_student' and class_id='__check_class' and status='active') then raise exception 'membership missing';end if;
 if not exists(select 1 from public.ltch_mail_outbox where id=job and template='approval_notice') then raise exception 'approval outbox missing';end if;
end $$;
rollback;
select not exists(select 1 from public.ltch_accounts where uid='__check_admin') as no_test_accounts,
 not has_table_privilege('anon','public.ltch_enrollment_requests','SELECT') as private_enrollments,
 not has_function_privilege('authenticated','public.ltch_review_enrollment(text,text,integer,text,text,text,text)','EXECUTE') as private_review;
