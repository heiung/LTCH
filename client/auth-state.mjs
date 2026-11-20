// A restored session is revalidated by the API against the Firebase identity.
const key = 'ltch.auth.v1';
export function createAuthState({storage = () => globalThis.localStorage, legacyStorage = () => globalThis.sessionStorage, clock = Date.now} = {}) {
  let memory = null;
  const valid = (state, uid) => {
    if (!state || state.uid !== uid || typeof uid !== 'string' || !uid) return null;
    const now = clock();
    const session = state.session;
    if (session && /^[A-Za-z0-9_-]{43}$/.test(session.token) && Number.isSafeInteger(session.expiresAt) && session.expiresAt > now && session.expiresAt <= now + 86400000) {
      return {uid, session: {token: session.token, expiresAt: session.expiresAt}, challenge: null};
    }
    const challenge = state.challenge;
    if (challenge && /^[a-f0-9]{32}$/.test(challenge.challengeId) && Number.isSafeInteger(challenge.expiresAt) && challenge.expiresAt > now && challenge.expiresAt <= now + 300000 && Number.isSafeInteger(challenge.resendAt) && challenge.resendAt <= challenge.expiresAt) {
      return {uid, session: null, challenge: {...challenge}};
    }
    return null;
  };
  return {
    read(uid) {
      let state = memory;
      try {const saved = storage().getItem(key); state = saved ? JSON.parse(saved) : null;} catch { /* Storage can be disabled. The active page still works. */ }
      const result = valid(state, uid);
      if (result) {memory = result; return result;}
      // Do not delete another tab's session if Firebase is changing accounts.
      if (state && state.uid === uid) try {storage().removeItem(key);} catch {}
      try {
        const saved = legacyStorage().getItem(key);
        const previous = saved ? valid(JSON.parse(saved), uid) : null;
        if (previous) {this.save(uid, previous); return previous;}
      } catch { /* A broken or unavailable legacy store is ignored. */ }
      memory = null;
      return null;
    },
    save(uid, {session = null, challenge = null}) {
      memory = valid({uid, session, challenge}, uid);
      let persisted = false;
      try {if (memory) storage().setItem(key, JSON.stringify(memory)); else storage().removeItem(key); persisted = true;} catch {}
      try {
        if (!persisted && memory) legacyStorage().setItem(key, JSON.stringify(memory));
        else legacyStorage().removeItem(key);
      } catch { /* Keep the active page working when storage is unavailable. */ }
    },
    clear() {memory = null; try {storage().removeItem(key);} catch {} try {legacyStorage().removeItem(key);} catch {}},
    redirectPending() {try {return legacyStorage().getItem(key + '.redirect') === 'google';} catch {return false;}},
    setRedirectPending(pending) {
      try {if (pending) legacyStorage().setItem(key + '.redirect', 'google'); else legacyStorage().removeItem(key + '.redirect');} catch { /* Redirect marker unavailable. */ }
    }
  };
}
