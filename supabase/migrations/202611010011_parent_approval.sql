begin;
update public.ltch_accounts set roles=array_append(roles,'assistant') where 'admin'=any(roles) and not ('assistant'=any(roles));
alter table public.ltch_mail_outbox drop constraint ltch_mail_outbox_template_check;
alter table public.ltch_mail_outbox add constraint ltch_mail_outbox_template_check check(template in ('approval_notice','parent_approval_notice','revision_request','urgent_admin_alert','lesson_reminder'));
do $$
declare source text;replacement text;
begin
 source=pg_get_functiondef('public.ltch_review_enrollment(text,text,integer,text,text,text,text)'::regprocedure);
 replacement=replace(source,'case p_action when ''approve'' then ''approval_notice'' else ''revision_request'' end','case when p_action=''approve'' and r.applicant_role=''parent'' then ''parent_approval_notice'' when p_action=''approve'' then ''approval_notice'' else ''revision_request'' end');
 if replacement=source then raise exception 'Enrollment template expression not found; migration stopped';end if;
 execute replacement;
end;$$;
commit;
