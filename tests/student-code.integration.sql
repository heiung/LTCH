-- Temporary fixtures only: run after migration 015 in a transaction, then rollback.
insert into public.ltch_school_years(id,name,starts_on,ends_on) values
 ('__code_2026','Kiểm tra 2026','2026-09-01','2027-08-31'),
 ('__code_2027','Kiểm tra 2027','2027-09-01','2028-08-31');
insert into public.ltch_classes(id,school_year_id,name) values
 ('__code_6','__code_2026','Lớp 6'),('__code_9','__code_2026','Lớp 9A'),
 ('__code_12','__code_2026','Lớp 12'),('__code_10','__code_2027','Lớp 10A'),
 ('__code_special','__code_2026','Lớp chuyên đề');
insert into public.ltch_accounts(uid,display_name,status,roles,student_code) values
 ('__code_reserved','Kiểm tra','active',array['student'],'2026034'),
 ('__code_s6','Kiểm tra','active',array['student'],null),
 ('__code_s9','Kiểm tra','active',array['student'],null),
 ('__code_s12','Kiểm tra','active',array['student'],null),
 ('__code_s6b','Kiểm tra','active',array['student'],null),
 ('__code_special_student','Kiểm tra','active',array['student'],null),
 ('__code_staff','Kiểm tra','active',array['teacher'],null);
insert into public.ltch_class_memberships(class_id,uid,member_role,status) values
 ('__code_6','__code_s6','student','active'),('__code_9','__code_s9','student','active'),
 ('__code_12','__code_s12','student','active'),('__code_6','__code_s6b','student','active'),
 ('__code_6','__code_staff','teacher','active');
do $$
declare before_code text;
begin
 if not exists(select 1 from public.ltch_accounts where uid='__code_s6' and student_code ~ '^2026[0-9]{3}$' and student_code<>'2026034') then raise exception 'grade 6 code incorrect'; end if;
 if not exists(select 1 from public.ltch_accounts where uid='__code_s9' and student_code ~ '^2023[0-9]{3}$') then raise exception 'grade 9 code incorrect'; end if;
 if not exists(select 1 from public.ltch_accounts where uid='__code_s12' and student_code ~ '^2020[0-9]{3}$') then raise exception 'grade 12 code incorrect'; end if;
 if (select count(distinct student_code) from public.ltch_accounts where uid in ('__code_reserved','__code_s6','__code_s6b'))<>3 then raise exception 'duplicate code'; end if;
 if exists(select 1 from public.ltch_accounts where uid='__code_staff' and student_code is not null) then raise exception 'staff received student code'; end if;
 select student_code into before_code from public.ltch_accounts where uid='__code_s9';
 insert into public.ltch_class_memberships(class_id,uid,member_role,status) values('__code_10','__code_s9','student','active');
 if (select student_code from public.ltch_accounts where uid='__code_s9')<>before_code then raise exception 'code changed after promotion'; end if;
 begin
  insert into public.ltch_class_memberships(class_id,uid,member_role,status) values('__code_special','__code_special_student','student','active');
  raise exception 'expected grade rejection';
 exception when others then if sqlerrm<>'LTCH_STUDENT_CODE_GRADE' then raise; end if; end;
 if exists(select 1 from public.ltch_accounts where uid='__code_special_student' and student_code is not null) then raise exception 'invalid grade received code'; end if;
end;$$;
