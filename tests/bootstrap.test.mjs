import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/index.mjs';

const origin = 'https://ltch.example.com';
const env = {ALLOWED_ORIGIN: origin, API_ORIGIN: 'https://api.ltch.example.com', SUPABASE_URL: 'https://your-project.supabase.co', SUPABASE_SECRET: 'test-only', MAIL_SECRET: 'x'.repeat(32), MAIL_ENDPOINT: 'https://script.google.com/macros/s/test/exec', FIREBASE_API_KEY: 'test-only'};
function fixture({status = 'active', sessionValid = true, databaseError = false, identityError} = {}) {
  const calls = [];
  let verified = 0;
  const rows = {
    ltch_sessions: sessionValid ? {uid: 'owner', created_at: Date.now() - 1000, expires_at: Date.now() + 60000} : null,
    ltch_accounts: {uid: 'owner', status, roles: ['admin', 'teacher', 'parent', 'student'], display_name: 'Test'},
    ltch_class_memberships: [], ltch_parent_links: [],
    ltch_classes: [{id: 'class1', name: 'Class 1', school_year_id: 'year1', schedule: ''}],
    ltch_assignments: [], ltch_notices: [], ltch_otp_challenges: null
  };
  const db = {
    async rpc(name) {calls.push(name); return {data: true, error: null};},
    from(table) {
      const query = new Proxy({}, {get(_, key) {
        if (key === 'then') return resolve => {calls.push(table); resolve({data: rows[table], error: databaseError ? {message: 'private internal database detail'} : null});};
        return () => query;
      }});
      return query;
    }
  };
  const app = createWorker({db, verify: async () => {verified++; if (identityError) throw identityError; return {uid: 'owner', email: 'admin@example.com'};}});
  const request = (path = '/api/bootstrap', body) => app.fetch(new Request('https://api.ltch.example.com' + path, {
    method: body ? 'POST' : 'GET', headers: {origin, authorization: body ? 'Bearer firebase' : 'Session ' + 'a'.repeat(43), 'x-firebase-token': 'firebase', 'content-type': 'application/json', 'CF-Connecting-IP': '127.0.0.1'},
    ...(body ? {body: JSON.stringify(body)} : {})
  }), env);
  return {request, calls, rows, verified: () => verified};
}

test('bootstrap loads the authorized dashboard with one identity check and no repeated session/account reads', async () => {
  const f = fixture();
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {accountStatus: 'active', me: {uid: 'owner', name: 'Test', roles: ['admin', 'teacher', 'parent', 'student'], memberships: [], childMemberships: []}, classes: [{id: 'class1', name: 'Class 1', schoolYearId: 'year1', schedule: ''}], overview: {assignments: [], notices: []}});
  assert.equal(f.calls.length, 7);
  for (const table of ['ltch_sessions', 'ltch_accounts', 'ltch_class_memberships', 'ltch_parent_links']) assert.equal(f.calls.filter(t => t === table).length, 1);
  assert.equal(f.verified(), 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('pending, disabled and missing sessions are distinguished without returning dashboard data', async () => {
  const pending = await fixture({status: 'pending'}).request();
  assert.deepEqual(await pending.json(), {accountStatus: 'pending'});
  const disabled = await fixture({status: 'disabled'}).request();
  assert.equal(disabled.status, 403);
  assert.equal((await disabled.json()).code, 'ACCOUNT_DISABLED');
  const f = fixture({sessionValid: false});
  assert.equal((await f.request()).status, 401);
  assert.equal(f.verified(), 0);
  assert.deepEqual(f.calls, ['ltch_sessions']);
});

test('bootstrap and me include only the signed-in account role context without extra database queries', async () => {
  const f = fixture();
  f.rows.ltch_class_memberships = [{class_id: 'class1', member_role: 'assistant', permissions: ['attendance.write']}];
  const bootstrap = await (await f.request()).json();
  assert.deepEqual(bootstrap.me.memberships, f.rows.ltch_class_memberships);
  assert.deepEqual(bootstrap.me.childMemberships, []);
  assert.equal(Object.hasOwn(bootstrap.me, 'email'), false);
  assert.equal(f.calls.length, 7);
  const profile = await (await f.request('/api/me')).json();
  assert.deepEqual(profile, bootstrap.me);
});

test('database outages stay errors and cannot be mistaken for pending enrollment', async () => {
  const f = fixture();
  f.rows.ltch_accounts = null;
  assert.equal((await f.request()).status, 403);
  const outage = fixture({databaseError: true});
  const response = await outage.request();
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /private internal/);
});

test('incorrect OTP returns a stable actionable error with browser-visible CORS', async () => {
  const response = await fixture().request('/api/auth/complete', {challengeId: 'b'.repeat(32), code: '000000'});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {code: 'INVALID_OTP', error: 'Invalid or expired code'});
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
});
