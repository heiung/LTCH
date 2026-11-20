begin;
alter table public.ltch_classes add column enrollment_open boolean not null default false;
create table public.ltch_enrollment_requests(
 id text primary key,uid text not null unique references public.ltch_accounts(uid),
 applicant_role text not null check(applicant_role in ('student','parent')),
 school_year_id text not null references public.ltch_school_years(id),class_id text not null references public.ltch_classes(id),
 full_name text not null check(length(full_name) between 1 and 160),date_of_birth date not null,
 school_name text not null check(length(school_name) between 1 and 200),student_phone text not null default '' check(length(student_phone)<=30),
 parent_name text not null check(length(parent_name) between 1 and 160),parent_phone text not null check(length(parent_phone) between 8 and 30),
 parent_relation text not null check(parent_relation in ('father','mother','guardian')),photo_path text not null,
 status text not null check(status in ('pending','needs_revision','approved','rejected')),admin_notes text not null default '' check(length(admin_notes)<=2000),
 version integer not null default 1,urgent_notified_at bigint,reviewed_by text references public.ltch_accounts(uid),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index ltch_enrollment_class on public.ltch_enrollment_requests(class_id,status);
create table public.ltch_mail_outbox(
 id text primary key,request_id text not null references public.ltch_enrollment_requests(id),template text not null check(template in ('approval_notice','revision_request','urgent_admin_alert')),
 recipient text not null,payload jsonb not null,status text not null default 'pending' check(status in ('pending','sending','sent')),
 lease_until bigint not null default 0,created_at timestamptz not null default now(),sent_at timestamptz
);
create table public.ltch_enrollment_audit(id bigint generated always as identity primary key,request_id text not null references public.ltch_enrollment_requests(id),actor_uid text not null,event text not null,version integer not null,created_at timestamptz not null default now());
alter table public.ltch_enrollment_requests enable row level security;
alter table public.ltch_mail_outbox enable row level security;
alter table public.ltch_enrollment_audit enable row level security;
revoke all on public.ltch_enrollment_requests,public.ltch_mail_outbox,public.ltch_enrollment_audit from public,anon,authenticated;
grant select,insert,update,delete on public.ltch_enrollment_requests,public.ltch_mail_outbox,public.ltch_enrollment_audit to service_role;
grant usage,select on sequence public.ltch_enrollment_audit_id_seq to service_role;
create function public.ltch_review_enrollment(p_id text,p_actor text,p_version integer,p_action text,p_class text,p_child text,p_notes text) returns text language plpgsql security invoker set search_path='' as $$
declare r public.ltch_enrollment_requests%rowtype;c public.ltch_classes%rowtype;v_admin boolean;v_event text;v_payload jsonb;v_email text;
begin
 select * into r from public.ltch_enrollment_requests where id=p_id for update;if not found then raise exception 'missing request';end if;
 if r.uid=p_actor then raise exception 'self review forbidden';end if;
 select exists(select 1 from public.ltch_accounts where uid=p_actor and status='active' and 'admin'=any(roles)) into v_admin;
 if not v_admin and not exists(select 1 from public.ltch_class_memberships m join public.ltch_accounts a on a.uid=m.uid where a.uid=p_actor and a.status='active' and 'teacher'=any(a.roles) and m.class_id=r.class_id and m.member_role='teacher' and m.status='active') then raise exception 'not authorized';end if;
 if r.version<>p_version then raise exception 'request changed';end if;
 if p_action not in ('approve','request_revision','reject') then raise exception 'invalid action';end if;
 v_event=r.id||'-'||r.version::text||'-'||p_action;
 if r.status in ('approved','rejected') then
  if (r.status='approved' and p_action='approve') or (r.status='rejected' and p_action='reject') then return v_event;end if;
  raise exception 'already reviewed';
 end if;
 if r.status='needs_revision' and p_action='request_revision' then return v_event;end if;
 if not exists(select 1 from public.ltch_accounts where uid=r.uid and status<>'disabled') then raise exception 'account unavailable';end if;
 select * into c from public.ltch_classes where id=coalesce(nullif(p_class,''),r.class_id);
 if not found or c.school_year_id<>r.school_year_id then raise exception 'invalid class';end if;
 if not v_admin and not exists(select 1 from public.ltch_class_memberships where uid=p_actor and class_id=c.id and member_role='teacher' and status='active') then raise exception 'destination not authorized';end if;
 if p_action='approve' then
  if r.applicant_role='parent' then
   if not exists(select 1 from public.ltch_class_memberships m join public.ltch_accounts a on a.uid=m.uid where a.uid=p_child and a.uid<>r.uid and a.status='active' and 'student'=any(a.roles) and m.class_id=c.id and m.member_role='student' and m.status='active') then raise exception 'select enrolled child';end if;
   insert into public.ltch_parent_links(parent_uid,student_uid,status) values(r.uid,p_child,'active') on conflict(parent_uid,student_uid) do update set status='active';
  else
   insert into public.ltch_class_memberships(class_id,uid,member_role,status) values(c.id,r.uid,'student','active') on conflict(class_id,uid,member_role) do update set status='active';
  end if;
  update public.ltch_accounts set status='active',roles=(select array_agg(distinct x) from unnest(roles||array[r.applicant_role]) x) where uid=r.uid;
 elsif p_action='request_revision' then
  if p_notes is null or length(trim(p_notes)) not between 1 and 2000 then raise exception 'notes required';end if;
 else
  update public.ltch_accounts set status='disabled' where uid=r.uid and status='pending';
 end if;
 update public.ltch_enrollment_requests set status=case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'needs_revision' end,class_id=c.id,admin_notes=coalesce(p_notes,''),reviewed_by=p_actor,updated_at=now() where id=r.id;
 insert into public.ltch_enrollment_audit(request_id,actor_uid,event,version) values(r.id,p_actor,p_action,r.version);
 if p_action<>'reject' then
  select email into v_email from public.ltch_accounts where uid=r.uid;
  v_payload=jsonb_build_object('full_name',r.full_name,'admin_notes',coalesce(p_notes,''),'class_name',c.name,'school_year_name',(select name from public.ltch_school_years where id=c.school_year_id),'schedule',c.schedule);
  insert into public.ltch_mail_outbox(id,request_id,template,recipient,payload) values(v_event,r.id,case p_action when 'approve' then 'approval_notice' else 'revision_request' end,v_email,v_payload) on conflict do nothing;
 end if;return v_event;
end;$$;
revoke all on function public.ltch_review_enrollment(text,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.ltch_review_enrollment(text,text,integer,text,text,text,text) to service_role;
commit;
