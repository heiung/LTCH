import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createNoticeMediaTicket, verifyNoticeMediaTicket} from '../worker/notices.mjs';

test('notice publication atomically validates files, snapshots recipients and survives a retry', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create role anon; create role authenticated; create role service_role;');
    for (const name of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) {
      await pg.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
    }
    await pg.exec(`
      insert into public.ltch_accounts(uid, display_name, email, status, roles) values
       ('notice_admin', 'Cô Hạnh', 'admin@example.invalid', 'active', array['admin']),
       ('notice_a', 'Học sinh A', 'a@example.invalid', 'active', array['student']),
       ('notice_b', 'Học sinh B', 'b@example.invalid', 'active', array['student']),
       ('notice_duplicate', 'Học sinh trùng', 'A@example.invalid', 'active', array['student']),
       ('notice_disabled', 'Học sinh nghỉ', 'disabled@example.invalid', 'disabled', array['student']);
      insert into public.ltch_class_memberships(class_id, uid, member_role, status) values
       ('class-6a', 'notice_a', 'student', 'active'),
       ('class-7a', 'notice_b', 'student', 'active'),
       ('class-7a', 'notice_duplicate', 'student', 'active'),
       ('class-6a', 'notice_disabled', 'student', 'active');
      insert into public.ltch_notices(id, class_id, scope, status, expected_files, title, body, created_by, created_at)
      values ('notice_draft_global', null, 'all', 'draft', 1, 'Thông báo chung', 'Nội dung đầy đủ', 'notice_admin', 1000);
    `);
    await assert.rejects(pg.query("select public.ltch_publish_notice('notice_draft_global','notice_admin',2000)"), /files incomplete/);
    assert.equal((await pg.query("select status from public.ltch_notices where id='notice_draft_global'")).rows[0].status, 'draft');
    const reserve = "select (public.ltch_reserve_notice_file('file_a','notice_draft_global','request_1234567890','drive_a','folder_a','anh.png','image/png',100,$1,'notice_admin',1000)).*";
    const hash = 'a'.repeat(64);
    assert.equal((await pg.query(reserve, [hash])).rows[0].status, 'pending');
    assert.equal((await pg.query(reserve, [hash])).rows[0].id, 'file_a');
    await assert.rejects(pg.query(reserve, ['b'.repeat(64)]), /request conflict/);
    await pg.query("select public.ltch_finish_notice_file('file_a','notice_draft_global','notice_admin')");
    const publish = "select public.ltch_publish_notice('notice_draft_global','notice_admin',2000) as count";
    assert.equal((await pg.query(publish)).rows[0].count, 2);
    assert.equal((await pg.query(publish)).rows[0].count, 2);
    const jobs = (await pg.query("select recipient, payload from public.ltch_mail_outbox where notice_id='notice_draft_global' order by lower(recipient)")).rows;
    assert.deepEqual(jobs.map(job => job.recipient.toLowerCase()), ['a@example.invalid', 'b@example.invalid']);
    assert.equal(jobs[0].payload.notice_body, 'Nội dung đầy đủ');
    assert.deepEqual(jobs[0].payload.attachments, [{name: 'anh.png', type: 'image/png'}]);
    await assert.rejects(pg.query(reserve, [hash]), /notice unavailable/);

    await pg.exec("insert into public.ltch_notices(id, class_id, scope, status, title, body, created_by, created_at) values ('notice_draft_class','class-6a','class','draft','Tin lớp','Lời nhắn','notice_admin',1000)");
    assert.equal((await pg.query("select public.ltch_publish_notice('notice_draft_class','notice_admin',3000) as count")).rows[0].count, 1);
    assert.equal((await pg.query("select recipient from public.ltch_mail_outbox where notice_id='notice_draft_class'")).rows[0].recipient, 'a@example.invalid');
    const classJob = (await pg.query("select id from public.ltch_mail_outbox where notice_id='notice_draft_class'")).rows[0].id;
    const globalJob = (await pg.query("select id from public.ltch_mail_outbox where notice_id='notice_draft_global' and lower(recipient)='b@example.invalid'")).rows[0].id;
    assert.equal((await pg.query("select public.ltch_claim_notice_mail($1, 'lease') as claimed", [globalJob])).rows[0].claimed, true);
    await pg.exec("delete from public.ltch_class_memberships where uid='notice_a' and class_id='class-6a'");
    assert.equal((await pg.query("select public.ltch_claim_notice_mail($1, 'lease') as claimed", [classJob])).rows[0].claimed, false);
    const cancelled = (await pg.query('select status, payload from public.ltch_mail_outbox where id=$1', [classJob])).rows[0];
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(cancelled.payload, {});
    await pg.exec("insert into public.ltch_notices(id, class_id, scope, status, title, body, created_by, created_at) values ('notice_expired_draft','class-6a','class','draft','Nháp','Chưa đăng','notice_admin',1000)");
    assert.equal((await pg.query('select public.ltch_claim_expired_notice_draft(2000) as id')).rows[0].id, null);
    assert.equal((await pg.query('select public.ltch_claim_expired_notice_draft(172801001) as id')).rows[0].id, 'notice_expired_draft');
    assert.equal((await pg.query('select public.ltch_claim_expired_notice_draft(172801002) as id')).rows[0].id, null);
    assert.equal((await pg.query("select public.ltch_finish_notice_draft_cleanup('notice_expired_draft') as done")).rows[0].done, true);
  } finally {
    await pg.close();
  }
});

test('notice media tickets are scoped, signed and expire', () => {
  const env = {MAIL_SECRET: 'x'.repeat(32)};
  const ticket = createNoticeMediaTicket(env, {uid: 'student_a', noticeId: 'notice_a', fileId: 'file_a'}, 1000);
  assert.equal(verifyNoticeMediaTicket(env, ticket, 1001).fileId, 'file_a');
  assert.throws(() => verifyNoticeMediaTicket(env, `${ticket.slice(0, -1)}!`, 1001));
  assert.throws(() => verifyNoticeMediaTicket(env, ticket, 1000 + 2 * 60 * 60 * 1000));
  assert.throws(() => verifyNoticeMediaTicket({MAIL_SECRET: 'y'.repeat(32)}, ticket, 1001));
});

test('notice migration works on the older production mail schema without retry columns', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create role anon; create role authenticated; create role service_role;');
    const names = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
    for (const name of names) {
      if (['202611090022_mail_outbox_privacy.sql', '202611090023_practice_attempt_revision.sql', '202611090024_practice_legacy_reconcile.sql'].includes(name)) continue;
      await pg.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
    }
    const columns = (await pg.query("select column_name from information_schema.columns where table_schema='public' and table_name='ltch_mail_outbox' and column_name in ('attempt_count','next_attempt_at','notice_id') order by column_name")).rows.map(row => row.column_name);
    assert.deepEqual(columns, ['attempt_count', 'next_attempt_at', 'notice_id']);
    await pg.query('select * from public.ltch_due_general_mail()');
    await pg.query('select public.ltch_cleanup_expired_auth()');
  } finally {
    await pg.close();
  }
});

test('ltch_notice_reads enforces primary key, RLS privileges, and cascades on notice/class deletion', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create role anon; create role authenticated; create role service_role;');
    for (const name of (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort()) {
      await pg.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
    }
    const privs = (await pg.query(`
      select
        c.relrowsecurity as rls_enabled,
        has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
        has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert,
        has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as svc_all
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'ltch_notice_reads'
    `)).rows[0];
    assert.equal(privs.rls_enabled, true);
    assert.equal(privs.anon_select, false);
    assert.equal(privs.auth_insert, false);
    assert.equal(privs.svc_all, true);

    await pg.exec(`
      insert into public.ltch_accounts(uid, display_name, email, status, roles) values
        ('nr_admin', 'Admin', 'nr_admin@example.invalid', 'active', array['admin']),
        ('nr_student', 'Học sinh', 'nr_student@example.invalid', 'active', array['student']);
      insert into public.ltch_school_years(id, name, starts_on, ends_on)
      values ('nr_year', '2026-2027', '2026-09-01', '2027-06-01');
      insert into public.ltch_classes(id, school_year_id, name, archived)
      values ('nr_class', 'nr_year', 'Lớp 12A', true);
      insert into public.ltch_notices(id, class_id, scope, status, title, body, created_by, created_at)
      values ('nr_notice', 'nr_class', 'class', 'published', 'Thông báo', 'Nội dung', 'nr_admin', 1000);
      insert into public.ltch_notice_reads(notice_id, uid, seen_at)
      values ('nr_notice', 'nr_student', 5000);
    `);

    await assert.rejects(
      pg.exec("insert into public.ltch_notice_reads(notice_id, uid, seen_at) values ('nr_notice', 'nr_student', 6000)")
    );
    await pg.exec(`
      insert into public.ltch_notice_reads(notice_id, uid, seen_at)
      values ('nr_notice', 'nr_student', 9000)
      on conflict (notice_id, uid) do nothing;
    `);
    const row = (await pg.query("select seen_at from public.ltch_notice_reads where notice_id='nr_notice' and uid='nr_student'")).rows[0];
    assert.equal(Number(row.seen_at), 5000);

    await pg.query("select public.ltch_delete_archived_class('nr_admin', 'nr_class')");
    const remaining = (await pg.query("select count(*)::int as n from public.ltch_notice_reads where notice_id='nr_notice'")).rows[0].n;
    assert.equal(remaining, 0);
  } finally {
    await pg.close();
  }
});
