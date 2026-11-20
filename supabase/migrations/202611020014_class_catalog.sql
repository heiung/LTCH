begin;

-- Keep unused classes for recovery; abort if the live roster changed or a
-- class to be archived gained any related records or timetable information.
lock table public.ltch_classes in share row exclusive mode;
lock table public.ltch_promotion_plans in share row exclusive mode;
do $$
declare old_ids text[] := array['class-6b','class-7b','class-11a2','class-12a2'];
begin
 if (select count(*) from public.ltch_classes where school_year_id='year-2026-2027') <> 14 then
  raise exception 'class catalog changed';
 end if;
 if exists (
  select 1 from (values
   ('class-6a','Lớp 6A'),('class-6b','Lớp 6B'),('class-7a','Lớp 7A'),('class-7b','Lớp 7B'),
   ('class-8a','Lớp 8A'),('class-8b','Lớp 8B'),('class-9a','Lớp 9A (Ôn thi vào 10)'),('class-9b','Lớp 9B (Ôn thi vào 10)'),
   ('class-10a1','Lớp 10A'),('class-10a2','Lớp 10B'),('class-11a1','Lớp 11A'),('class-11a2','Lớp 11B'),
   ('class-12a1','Lớp 12A (Luyện thi THPTQG & Chuyên sâu)'),('class-12a2','Lớp 12B (Luyện thi THPTQG)')
  ) as expected(id,name)
  left join public.ltch_classes c on c.id=expected.id and c.school_year_id='year-2026-2027'
  where c.id is null or c.name<>expected.name or not c.enrollment_open
 ) then raise exception 'class catalog changed'; end if;
 perform 1 from public.ltch_classes where id=any(old_ids) for update;
 if exists(select 1 from public.ltch_classes where id=any(old_ids) and (schedule<>'' or jsonb_array_length(schedule_slots)>0))
 or exists(select 1 from public.ltch_class_memberships where class_id=any(old_ids))
 or exists(select 1 from public.ltch_enrollment_requests where class_id=any(old_ids))
 or exists(select 1 from public.ltch_assignments where class_id=any(old_ids))
 or exists(select 1 from public.ltch_attendance where class_id=any(old_ids))
 or exists(select 1 from public.ltch_exams where class_id=any(old_ids))
 or exists(select 1 from public.ltch_forum_posts where class_id=any(old_ids))
 or exists(select 1 from public.ltch_mail_outbox where reminder_class_id=any(old_ids))
 or exists(select 1 from public.ltch_materials where class_id=any(old_ids))
 or exists(select 1 from public.ltch_messages where class_id=any(old_ids))
 or exists(select 1 from public.ltch_notices where class_id=any(old_ids))
 or exists(select 1 from public.ltch_question_bank where class_id=any(old_ids))
 or exists(select 1 from public.ltch_promotion_plans where expires_at>(extract(epoch from now())*1000)::bigint)
 then raise exception 'class data or promotion plan changed'; end if;
end $$;

alter table public.ltch_classes add column archived boolean not null default false;
update public.ltch_classes set archived=true,enrollment_open=false where id in ('class-6b','class-7b','class-11a2','class-12a2');
update public.ltch_classes c set name=v.name from (values
 ('class-6a','Lớp 6'),('class-7a','Lớp 7'),('class-8a','Lớp 8A'),('class-8b','Lớp 8B'),
 ('class-9a','Lớp 9A'),('class-9b','Lớp 9B'),('class-10a1','Lớp 10A'),('class-10a2','Lớp 10B'),
 ('class-11a1','Lớp 11'),('class-12a1','Lớp 12')
) as v(id,name) where c.id=v.id;

commit;
