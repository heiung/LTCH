import { createRemoteJWKSet, jwtVerify } from 'jose';
import authErrorModule from '../server/domain/auth-error.cjs';
const {AuthError}=authErrorModule;
const FIREBASE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const verifiedTokenCache = new Map();

// Firebase tokens identify a user; callers must additionally require an OTP session.
export function createFirebaseVerifier({ projectId, apiKey, keys = FIREBASE_KEYS, fetchImpl = fetch }) {
  if (!/^[a-z0-9-]{1,100}$/.test(projectId || '') || typeof apiKey !== 'string' || !apiKey) throw new TypeError('Firebase configuration missing');
  const useCache = fetchImpl === fetch && keys === FIREBASE_KEYS;
  return async token => {
    if (typeof token !== 'string' || !token || token.length > 16384) throw new AuthError('IDENTITY_REQUIRED','Authentication required');
    const cacheKey = useCache ? `${projectId}:${token}` : '';
    if (useCache) {
      const cached = verifiedTokenCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.identity;
      if (cached) verifiedTokenCache.delete(cacheKey);
    }
    let payload;
    try { ({payload}=await jwtVerify(token, keys, { issuer: `https://securetoken.google.com/${projectId}`, audience: projectId, algorithms: ['RS256'] })); }
    catch(error){
      if(['ERR_JWT_EXPIRED','ERR_JWT_CLAIM_VALIDATION_FAILED','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JWS_INVALID','ERR_JWT_INVALID','ERR_JOSE_ALG_NOT_ALLOWED','ERR_JOSE_NOT_SUPPORTED','ERR_JWKS_NO_MATCHING_KEY'].includes(error.code))throw new AuthError('IDENTITY_REQUIRED','Authentication required');
      throw new AuthError('IDENTITY_UNAVAILABLE','Dịch vụ xác thực đang gián đoạn. Vui lòng thử lại.',503);
    }
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 || typeof payload.email !== 'string' || !payload.email || !Number.isSafeInteger(payload.auth_time) || payload.auth_time > Math.floor(Date.now() / 1000) + 15) throw new AuthError('IDENTITY_REQUIRED','Authentication required');
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`;
    let response,data;
    try {
      response=await fetchImpl(url, { method:'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(10000) });
      data=await response.json();
    }catch {throw new AuthError('IDENTITY_UNAVAILABLE','Dịch vụ xác thực đang gián đoạn. Vui lòng thử lại.',503);}
    if (!response.ok) {
      if(['INVALID_ID_TOKEN','TOKEN_EXPIRED','USER_NOT_FOUND','USER_DISABLED'].includes(data?.error?.message))throw new AuthError('IDENTITY_REQUIRED','Authentication required');
      throw new AuthError('IDENTITY_UNAVAILABLE','Dịch vụ xác thực đang gián đoạn. Vui lòng thử lại.',503);
    }
    const user = data?.users?.[0];
    const validSince = user?.validSince === undefined ? 0 : Number(user.validSince);
    if (!user || user.localId !== payload.sub || user.email?.toLowerCase() !== payload.email?.toLowerCase() || user.disabled === true || !Number.isSafeInteger(validSince) || (validSince > 0 && payload.auth_time < validSince - 5)) throw new AuthError('IDENTITY_REQUIRED','Authentication required');
    const identity = { uid: user.localId, email: user.email.toLowerCase(), name: typeof user.displayName === 'string' && user.displayName ? user.displayName.slice(0,160) : user.email };
    if (useCache) {
      if (verifiedTokenCache.size >= 100) verifiedTokenCache.delete(verifiedTokenCache.keys().next().value);
      const jwtExpMs = Number.isSafeInteger(payload.exp) ? payload.exp * 1000 - 15000 : Date.now() + 180000;
      verifiedTokenCache.set(cacheKey, { identity, expiresAt: Math.min(jwtExpMs, Date.now() + 180000) });
    }
    return identity;
  };
}

