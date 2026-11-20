-- Run after creating migration 016's functions and triggers in the same
-- transaction; finish with ROLLBACK so these fixtures are never retained.
insert into public.ltch_school_years(id,name,starts_on,ends_on)
 values ('__global_teacher_year','Kiểm thử','2026-09-01','2027-08-31');
insert into public.ltch_classes(id,school_year_id,name,enrollment_open)
 values ('__global_teacher_c1','__global_teacher_year','Lớp 6',true);
insert into public.ltch_accounts(uid,display_name,email,status,roles) values
 ('__global_teacher','Kiểm thử','teacher-test@example.invalid','pending',array['teacher']),
 ('__global_helper','Kiểm thử','assistant-test@example.invalid','active',array['assistant']);
do $$ begin
 if exists(select 1 from public.ltch_class_memberships where uid='__global_teacher') then raise exception 'pending teacher has membership'; end if;
end;$$;
update public.ltch_accounts set status='active' where uid='__global_teacher';
insert into public.ltch_classes(id,school_year_id,name,enrollment_open)
 values ('__global_teacher_c2','__global_teacher_year','Lớp 7',true);
do $$ begin
 if (select count(*) from public.ltch_class_memberships where uid='__global_teacher' and member_role='teacher' and status='active' and class_id in ('__global_teacher_c1','__global_teacher_c2'))<>2 then raise exception 'missing teacher membership'; end if;
 if exists(select 1 from public.ltch_class_memberships where uid='__global_helper') then raise exception 'assistant auto-assigned'; end if;
 begin
  update public.ltch_class_memberships set status='inactive' where uid='__global_teacher' and class_id='__global_teacher_c1' and member_role='teacher';
  raise exception 'teacher membership removal accepted';
 exception when others then if sqlerrm<>'LTCH_GLOBAL_TEACHER_MEMBERSHIP' then raise; end if; end;
end;$$;
update public.ltch_accounts set status='disabled' where uid='__global_teacher';
do $$ begin
 if exists(select 1 from public.ltch_class_memberships where uid='__global_teacher' and member_role='teacher' and status='active') then raise exception 'disabled teacher still assigned'; end if;
end;$$;
update public.ltch_accounts set status='active' where uid='__global_teacher';
update public.ltch_accounts set roles=array['student'] where uid='__global_teacher';
do $$ begin
 if exists(select 1 from public.ltch_class_memberships where uid='__global_teacher' and member_role='teacher' and status='active') then raise exception 'removed role still assigned'; end if;
end;$$;
update public.ltch_accounts set roles=array['teacher'] where uid='__global_teacher';
update public.ltch_classes set archived=true where id='__global_teacher_c2';
update public.ltch_class_memberships set status='inactive' where uid='__global_teacher' and class_id='__global_teacher_c2' and member_role='teacher';
update public.ltch_classes set archived=false where id='__global_teacher_c2';
do $$ begin
 if not exists(select 1 from public.ltch_class_memberships where uid='__global_teacher' and class_id='__global_teacher_c2' and member_role='teacher' and status='active') then raise exception 'unarchive did not restore teacher'; end if;
end;$$;
insert into public.ltch_accounts(uid,display_name,email,status,roles) values ('__global_pupil','Kiểm thử','pupil-test@example.invalid','pending',array[]::text[]);
insert into public.ltch_enrollment_requests(id,uid,applicant_role,school_year_id,class_id,full_name,date_of_birth,school_name,parent_name,parent_phone,parent_relation,photo_path,status)
 values ('__global_request','__global_pupil','student','__global_teacher_year','__global_teacher_c1','Kiểm thử','2014-01-01','Kiểm thử','Kiểm thử','0900000000','guardian','profiles/__global_pupil/test.jpg','pending');
do $$ begin
 begin
  perform public.ltch_review_enrollment('__global_request','__global_helper',1,'approve','__global_teacher_c1','','');
  raise exception 'assistant approved without authority';
 exception when others then if sqlerrm<>'not authorized' then raise; end if; end;
 perform public.ltch_review_enrollment('__global_request','__global_teacher',1,'approve','__global_teacher_c1','','');
 if not exists(select 1 from public.ltch_accounts where uid='__global_pupil' and status='active' and student_code ~ '^2026[0-9]{3}$') then raise exception 'teacher approval failed'; end if;
end;$$;
