begin;

alter table public.ltch_accounts add column student_code text
 check (student_code is null or student_code ~ '^[0-9]{7}$');
alter table public.ltch_accounts add constraint ltch_accounts_student_code_key unique(student_code);

-- Only a service-role operation can allocate codes; a per-cohort transaction
-- lock and the unique constraint protect concurrent enrollments.
create function public.ltch_assign_student_code(p_uid text,p_class text) returns void
language plpgsql security invoker set search_path='' as $$
declare current_code text; class_name text; starts date; parts text[]; cohort integer; chosen text;
begin
 select student_code into current_code from public.ltch_accounts where uid=p_uid for update;
 if not found then raise exception 'LTCH_STUDENT_CODE_ACCOUNT'; end if;
 if current_code is not null then return; end if;
 select c.name,y.starts_on into class_name,starts from public.ltch_classes c
 join public.ltch_school_years y on y.id=c.school_year_id where c.id=p_class;
 if not found then raise exception 'LTCH_STUDENT_CODE_CLASS'; end if;
 parts := regexp_match(class_name,'^[[:space:]]*(Lớp[[:space:]]*)?(1[012]|[6-9])([[:space:]]|[A-Za-z]|$)','i');
 if parts is null then raise exception 'LTCH_STUDENT_CODE_GRADE'; end if;
 cohort := extract(year from starts)::integer - (parts[2]::integer - 6);
 if cohort < 1000 or cohort > 9999 then raise exception 'LTCH_STUDENT_CODE_YEAR'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ltch.student_code.'||cohort::text,0));
 select cohort::text||lpad(n::text,3,'0') into chosen from generate_series(0,999) n
 where not exists(select 1 from public.ltch_accounts a where a.student_code=cohort::text||lpad(n::text,3,'0'))
 order by random() limit 1;
 if chosen is null then raise exception 'LTCH_STUDENT_CODE_EXHAUSTED'; end if;
 update public.ltch_accounts set student_code=chosen where uid=p_uid;
end;$$;

create function public.ltch_student_code_on_membership() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.member_role='student' and new.status='active' then
  perform public.ltch_assign_student_code(new.uid,new.class_id);
 end if;
 return new;
end;$$;

create trigger ltch_student_code_on_membership
after insert or update of status,class_id,member_role on public.ltch_class_memberships
for each row execute function public.ltch_student_code_on_membership();

-- Ambiguous or non-grade historical classes must be reviewed rather than
-- silently inventing a cohort for an existing student.
do $$
declare r record;
begin
 if exists (
  select m.uid from public.ltch_class_memberships m
  join public.ltch_classes c on c.id=m.class_id
  join public.ltch_school_years y on y.id=c.school_year_id
  cross join lateral (select regexp_match(c.name,'^[[:space:]]*(Lớp[[:space:]]*)?(1[012]|[6-9])([[:space:]]|[A-Za-z]|$)','i') as parts) p
  where m.member_role='student'
  group by m.uid
  having bool_or(p.parts is null) or count(distinct (extract(year from y.starts_on)::integer-(p.parts[2]::integer-6)))<>1
 ) then raise exception 'LTCH_STUDENT_CODE_AMBIGUOUS'; end if;
 for r in select distinct on(m.uid) m.uid,m.class_id from public.ltch_class_memberships m
  join public.ltch_classes c on c.id=m.class_id join public.ltch_school_years y on y.id=c.school_year_id
  where m.member_role='student' order by m.uid,y.starts_on,c.id
 loop perform public.ltch_assign_student_code(r.uid,r.class_id); end loop;
end;$$;

revoke all on function public.ltch_assign_student_code(text,text),public.ltch_student_code_on_membership() from public,anon,authenticated;
grant execute on function public.ltch_assign_student_code(text,text),public.ltch_student_code_on_membership() to service_role;
commit;
