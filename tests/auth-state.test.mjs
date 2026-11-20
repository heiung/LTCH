import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthState} from '../client/auth-state.mjs';

function fixture() {
  const entries = new Map();
  const legacyEntries = new Map();
  const makeStorage = map => () => ({getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key)});
  const storage = makeStorage(entries), legacyStorage = makeStorage(legacyEntries);
  let now = 1800000000000;
  return {storage, legacyStorage, entries, legacyEntries, clock: () => now, advance: ms => {now += ms;}};
}

test('a new tab restores the verified session for the same Firebase UID until expiry', () => {
  const f = fixture();
  const session = {token: 'a'.repeat(43), expiresAt: f.clock() + 60000};
  createAuthState(f).save('student', {session});
  assert.deepEqual(createAuthState(f).read('student').session, session);
  assert.equal(createAuthState(f).read('other-user'), null);
  assert.equal(f.entries.size, 1); // A different tab must not erase the active account.
  createAuthState(f).save('student', {session});
  f.advance(60000);
  assert.equal(createAuthState(f).read('student'), null);
});

test('an existing tab session migrates to persistent storage without extending expiry', () => {
  const f = fixture(), session = {token: 'a'.repeat(43), expiresAt: f.clock() + 60000};
  f.legacyEntries.set('ltch.auth.v1', JSON.stringify({uid: 'student', session}));
  assert.deepEqual(createAuthState(f).read('student').session, session);
  assert.equal(f.legacyEntries.size, 0);
  assert.deepEqual(createAuthState(f).read('student').session, session);
});

test('pending OTP survives reload with its original cooldown and logout removes it', () => {
  const f = fixture();
  const challenge = {challengeId: 'b'.repeat(32), expiresAt: f.clock() + 300000, resendAt: f.clock() + 60000};
  createAuthState(f).save('student', {challenge});
  f.advance(20000);
  const restored = createAuthState(f);
  assert.deepEqual(restored.read('student').challenge, challenge);
  restored.clear();
  assert.equal(createAuthState(f).read('student'), null);
});

test('corrupt, overlong and unauthenticated saved states never restore credentials', () => {
  const f = fixture();
  for (const value of ['invalid json', JSON.stringify({uid: 'student', session: {token: 'a'.repeat(43), expiresAt: f.clock() + 86400001}})]) {
    f.entries.set('ltch.auth.v1', value);
    assert.equal(createAuthState(f).read('student'), null);
  }
  createAuthState(f).save('student', {session: {token: 'a'.repeat(43), expiresAt: f.clock() + 60000}});
  assert.equal(createAuthState(f).read(undefined), null);
});

test('blocked persistent storage falls back to the current tab and still supports logout', () => {
  const f = fixture();
  const options = {...f, storage: () => {throw Error('SecurityError');}};
  const state = createAuthState(options);
  const session = {token: 'c'.repeat(43), expiresAt: f.clock() + 60000};
  state.save('student', {session});
  assert.deepEqual(state.read('student').session, session);
  assert.deepEqual(createAuthState(options).read('student').session, session);
  state.clear();
  assert.equal(state.read('student'), null);
});
