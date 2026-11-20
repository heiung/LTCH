begin;

alter table public.ltch_notices alter column class_id drop not null;
alter table public.ltch_notices
 add column scope text not null default 'class' check (scope in ('class', 'all')),
 add column status text not null default 'published' check (status in ('draft', 'published', 'discarding')),
 add column expected_files integer not null default 0 check (expected_files between 0 and 8),
 add column published_at bigint,
 add column cleanup_lease_until bigint not null default 0,
 add constraint ltch_notice_scope check ((scope = 'class' and class_id is not null) or (scope = 'all' and class_id is null));
update public.ltch_notices set published_at = created_at where status = 'published';
create index ltch_notices_global on public.ltch_notices(created_at desc) where scope = 'all' and status = 'published';

create table public.ltch_notice_files (
 id text primary key check (id ~ '^[A-Za-z0-9_-]{1,128}$'),
 notice_id text not null references public.ltch_notices(id),
 name text not null check (length(name) between 1 and 250),
 drive_file_id text not null unique check (drive_file_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 parent_folder_id text not null check (parent_folder_id ~ '^[A-Za-z0-9_-]{1,200}$'),
 content_type text not null check (length(content_type) between 1 and 127),
 file_size bigint not null check (file_size between 1 and 5368709120),
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{16,128}$'),
 status text not null check (status in ('pending', 'stored')),
 created_by text not null references public.ltch_accounts(uid),
 created_at bigint not null check (created_at >= 0),
 unique (notice_id, created_by, request_id)
);
create index ltch_notice_files_notice on public.ltch_notice_files(notice_id, created_at, id);
alter table public.ltch_notice_files enable row level security;
revoke all on public.ltch_notice_files from public, anon, authenticated;
grant select, insert, update, delete on public.ltch_notice_files to service_role;

create function public.ltch_reserve_notice_file(
 p_id text, p_notice_id text, p_request_id text, p_drive_id text, p_parent_id text, p_name text,
 p_content_type text, p_file_size bigint, p_sha256 text, p_actor_uid text, p_now bigint
) returns public.ltch_notice_files language plpgsql security invoker set search_path = '' as $$
declare n public.ltch_notices%rowtype; f public.ltch_notice_files%rowtype;
begin
 select * into n from public.ltch_notices where id = p_notice_id for update;
 if not found or n.created_by <> p_actor_uid or n.status <> 'draft' or p_now < n.created_at or p_now - n.created_at > 86400000 then raise exception 'notice unavailable'; end if;
 select * into f from public.ltch_notice_files where notice_id = n.id and created_by = p_actor_uid and request_id = p_request_id;
 if found then
  if f.parent_folder_id <> p_parent_id or f.name <> p_name or f.content_type <> p_content_type or f.file_size <> p_file_size or f.sha256 <> p_sha256 then
   raise exception 'upload request conflict';
  end if;
  return f;
 end if;
 if (select count(*) from public.ltch_notice_files where notice_id = n.id) >= n.expected_files then
  raise exception 'too many files';
 end if;
 insert into public.ltch_notice_files(id, notice_id, request_id, drive_file_id, parent_folder_id, name, content_type, file_size, sha256, status, created_by, created_at)
 values(p_id, n.id, p_request_id, p_drive_id, p_parent_id, p_name, p_content_type, p_file_size, p_sha256, 'pending', p_actor_uid, p_now)
 returning * into f;
 return f;
end;
$$;
revoke all on function public.ltch_reserve_notice_file(text,text,text,text,text,text,text,bigint,text,text,bigint) from public, anon, authenticated;
grant execute on function public.ltch_reserve_notice_file(text,text,text,text,text,text,text,bigint,text,text,bigint) to service_role;

create function public.ltch_finish_notice_file(p_file_id text, p_notice_id text, p_actor_uid text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n public.ltch_notices%rowtype;
begin
 select * into n from public.ltch_notices where id = p_notice_id for update;
 if not found or n.created_by <> p_actor_uid or n.status <> 'draft' then raise exception 'notice unavailable'; end if;
 update public.ltch_notice_files set status = 'stored'
 where id = p_file_id and notice_id = p_notice_id and created_by = p_actor_uid;
 return found;
end;
$$;
revoke all on function public.ltch_finish_notice_file(text,text,text) from public, anon, authenticated;
grant execute on function public.ltch_finish_notice_file(text,text,text) to service_role;

alter table public.ltch_mail_outbox
 add column notice_id text references public.ltch_notices(id),
 add column if not exists attempt_count integer not null default 0,
 add column if not exists next_attempt_at bigint not null default 0;
create index if not exists ltch_general_mail_retry_idx on public.ltch_mail_outbox(next_attempt_at, created_at)
 where template <> 'lesson_reminder' and status in ('pending', 'sending');
alter table public.ltch_mail_outbox drop constraint ltch_mail_outbox_template_check;
alter table public.ltch_mail_outbox add constraint ltch_mail_outbox_template_check
 check (template in ('approval_notice', 'parent_approval_notice', 'revision_request', 'urgent_admin_alert', 'lesson_reminder', 'class_notice'));
alter table public.ltch_mail_outbox drop constraint ltch_mail_context;
alter table public.ltch_mail_outbox add constraint ltch_mail_context check (
 (template = 'lesson_reminder' and request_id is null and reminder_class_id is not null and recipient_uid is not null and reminder_starts_at is not null and notice_id is null)
 or (template = 'class_notice' and request_id is null and notice_id is not null and recipient_uid is not null)
 or (template not in ('lesson_reminder', 'class_notice') and request_id is not null and notice_id is null)
);

-- Publication and the recipient snapshot are committed together. Repeating a
-- request after a lost response returns the existing jobs without duplicating them.
create function public.ltch_publish_notice(p_notice_id text, p_actor_uid text, p_now bigint)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
 n public.ltch_notices%rowtype;
 v_sender text;
 v_class_name text;
 v_attachments jsonb;
 v_count integer;
begin
 select * into n from public.ltch_notices where id = p_notice_id for update;
 if not found or n.created_by <> p_actor_uid then raise exception 'notice unavailable'; end if;
 if n.status = 'published' then
  select count(*) into v_count from public.ltch_mail_outbox where notice_id = n.id;
  return v_count;
 end if;
 if n.status <> 'draft' or p_now < n.created_at or p_now - n.created_at > 86400000 then raise exception 'notice draft expired'; end if;
 if (select count(*) from public.ltch_notice_files where notice_id = n.id and status = 'stored') <> n.expected_files
    or exists (select 1 from public.ltch_notice_files where notice_id = n.id and status <> 'stored') then
  raise exception 'notice files incomplete';
 end if;
 select coalesce(nullif(trim(display_name), ''), 'Ban Quản trị Lớp Toán cô Hạnh') into v_sender
 from public.ltch_accounts where uid = p_actor_uid and status = 'active';
 if v_sender is null then raise exception 'author unavailable'; end if;
 if not exists (
  select 1 from public.ltch_accounts a where a.uid = p_actor_uid and a.status = 'active' and
   ('admin' = any(a.roles) or exists (
    select 1 from public.ltch_class_memberships m
    join public.ltch_classes c on c.id = m.class_id and c.archived = false
    where m.uid = a.uid and m.status = 'active' and m.member_role = any(a.roles)
      and (m.member_role = 'teacher' or (m.member_role = 'assistant' and 'notices.write' = any(m.permissions)))
      and (n.scope = 'all' or m.class_id = n.class_id)
   ))
 ) then raise exception 'notice authorization changed'; end if;
 if n.scope = 'class' then
  select name into v_class_name from public.ltch_classes where id = n.class_id and archived = false;
  if v_class_name is null then raise exception 'class unavailable'; end if;
 else
  v_class_name := 'Toàn bộ lớp học';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('name', f.name, 'type', f.content_type) order by f.created_at, f.id), '[]'::jsonb)
 into v_attachments from public.ltch_notice_files f where f.notice_id = n.id and f.status = 'stored';

 insert into public.ltch_mail_outbox(id, template, recipient, recipient_uid, notice_id, payload)
 select 'notice_' || n.id || '_' || md5(lower(recipients.email)), 'class_notice', recipients.email, recipients.uid, n.id,
  jsonb_build_object('student_name', recipients.display_name, 'class_name', v_class_name,
   'notice_title', n.title, 'notice_body', n.body, 'sender_name', v_sender,
   'posted_at', to_char(to_timestamp(p_now / 1000.0) at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY'),
   'notice_scope', n.scope, 'class_id', n.class_id, 'attachments', v_attachments)
 from (
  select distinct on (lower(a.email)) a.uid, a.email, a.display_name
  from public.ltch_accounts a
  join public.ltch_class_memberships m on m.uid = a.uid and m.member_role = 'student' and m.status = 'active'
  join public.ltch_classes c on c.id = m.class_id and c.archived = false
  where a.status = 'active' and 'student' = any(a.roles)
    and a.email is not null and length(a.email) <= 254
    and a.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and (n.scope = 'all' or m.class_id = n.class_id)
  order by lower(a.email), a.uid
 ) recipients
 on conflict (id) do nothing;
 get diagnostics v_count = row_count;
 update public.ltch_notices set status = 'published', published_at = p_now, created_at = p_now where id = n.id;
 return v_count;
end;
$$;
revoke all on function public.ltch_publish_notice(text, text, bigint) from public, anon, authenticated;
grant execute on function public.ltch_publish_notice(text, text, bigint) to service_role;

-- A queued email may be retried long after publication. Recheck access before
-- each attempt so a removed or disabled student no longer receives class data.
create function public.ltch_claim_notice_mail(p_id text, p_token text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.ltch_mail_outbox%rowtype;
begin
 select * into job from public.ltch_mail_outbox where id = p_id and template = 'class_notice' for update;
 if not found or job.status in ('sent', 'cancelled') then return false; end if;
 if not exists (
  select 1 from public.ltch_notices n
  join public.ltch_accounts a on a.uid = job.recipient_uid and a.status = 'active'
    and 'student' = any(a.roles) and lower(a.email) = lower(job.recipient)
  join public.ltch_class_memberships m on m.uid = a.uid and m.member_role = 'student' and m.status = 'active'
  join public.ltch_classes c on c.id = m.class_id and c.archived = false
  where n.id = job.notice_id and n.status = 'published' and (n.scope = 'all' or m.class_id = n.class_id)
 ) then
  update public.ltch_mail_outbox set status = 'cancelled', payload = '{}'::jsonb, lease_until = 0 where id = p_id;
  return false;
 end if;
 return public.ltch_claim_mail(p_id, p_token);
end;
$$;
revoke all on function public.ltch_claim_notice_mail(text,text) from public, anon, authenticated;
grant execute on function public.ltch_claim_notice_mail(text,text) to service_role;

create function public.ltch_claim_expired_notice_draft(p_now bigint)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_id text;
begin
 select id into v_id from public.ltch_notices
 where (status = 'discarding' and cleanup_lease_until < p_now) or (status = 'draft' and created_at < p_now - 172800000)
 order by created_at, id for update skip locked limit 1;
 if v_id is null then return null; end if;
 update public.ltch_notices set status = 'discarding', cleanup_lease_until = p_now + 600000 where id = v_id;
 return v_id;
end;
$$;
revoke all on function public.ltch_claim_expired_notice_draft(bigint) from public, anon, authenticated;
grant execute on function public.ltch_claim_expired_notice_draft(bigint) to service_role;

create function public.ltch_finish_notice_draft_cleanup(p_notice_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
 delete from public.ltch_notices n where n.id = p_notice_id and n.status = 'discarding'
  and not exists (select 1 from public.ltch_notice_files f where f.notice_id = n.id);
 return found;
end;
$$;
revoke all on function public.ltch_finish_notice_draft_cleanup(text) from public, anon, authenticated;
grant execute on function public.ltch_finish_notice_draft_cleanup(text) to service_role;

create or replace function public.ltch_due_general_mail()
returns table(id text) language sql stable security invoker set search_path = '' as $$
 select o.id from public.ltch_mail_outbox o
 where o.template <> 'lesson_reminder' and (o.template = 'class_notice' or o.attempt_count < 8)
   and o.next_attempt_at <= (extract(epoch from now()) * 1000)::bigint
   and (o.status = 'pending' or (o.status = 'sending' and o.lease_until < (extract(epoch from now()) * 1000)::bigint))
 order by o.next_attempt_at, o.created_at limit 50;
$$;
revoke all on function public.ltch_due_general_mail() from public, anon, authenticated;
grant execute on function public.ltch_due_general_mail() to service_role;

-- The production scheduler invokes this maintenance function. Some deployed
-- databases predate its introduction in migration 202611090023.
create or replace function public.ltch_cleanup_expired_auth()
returns integer language plpgsql security invoker set search_path = '' as $$
declare cutoff bigint = (extract(epoch from now()) * 1000)::bigint - 86400000; total integer = 0; removed integer;
begin
 delete from public.ltch_sessions where ctid in (select ctid from public.ltch_sessions where expires_at < cutoff limit 1000);
 get diagnostics removed = row_count; total = total + removed;
 delete from public.ltch_rate_limits where ctid in (select ctid from public.ltch_rate_limits where expires_at < cutoff limit 1000);
 get diagnostics removed = row_count; total = total + removed;
 delete from public.ltch_otp_challenges where ctid in (
  select ctid from public.ltch_otp_challenges
  where case when payload->>'expiresAt' ~ '^[0-9]{1,15}$' then (payload->>'expiresAt')::bigint < cutoff else false end limit 1000
 );
 get diagnostics removed = row_count; total = total + removed;
 return total;
end;
$$;
revoke all on function public.ltch_cleanup_expired_auth() from public, anon, authenticated;
grant execute on function public.ltch_cleanup_expired_auth() to service_role;

commit;
