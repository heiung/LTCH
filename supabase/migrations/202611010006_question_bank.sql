begin;
create table public.ltch_question_bank (
 id text primary key, class_id text not null references public.ltch_classes(id),
 topic text not null default '' check(length(topic)<=200),
 question jsonb not null check(jsonb_typeof(question)='object'),
 created_by text not null references public.ltch_accounts(uid), created_at bigint not null,
 status text not null default 'active' check(status in ('active','archived'))
);
create index ltch_question_bank_class on public.ltch_question_bank(class_id,status);
alter table public.ltch_question_bank enable row level security;
revoke all on public.ltch_question_bank from public,anon,authenticated;
grant select,insert,update,delete on public.ltch_question_bank to service_role;
alter table public.ltch_accounts add column contact_phone text not null default '' check(length(contact_phone)<=30);
commit;
