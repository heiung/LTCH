// Server-only refresh; neither the refresh token nor provider error bodies are
// returned to callers. The caller must verify the account before using Drive.
export class GoogleAuthorizationError extends Error {
  constructor(code) { super('Google authorization unavailable'); this.name='GoogleAuthorizationError'; this.code=code; }
}

export async function refreshGoogleAccessToken({clientId,clientSecret,refreshToken,fetchImpl=fetch}) {
  for (const value of [clientId,clientSecret,refreshToken]) {
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) throw new GoogleAuthorizationError('not_configured');
  }
  const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'});
  let response;
  try {
    response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,redirect:'manual'});
  } catch {throw new GoogleAuthorizationError('unavailable');}
  if (!response.ok) throw new GoogleAuthorizationError(response.status===400||response.status===401?'reauthorization_required':'unavailable');
  let result;
  try {result=await response.json();} catch {throw new GoogleAuthorizationError('invalid_response');}
  if (typeof result?.token_type!=='string' || result.token_type.toLowerCase()!=='bearer' || typeof result.access_token!=='string' || !/^[\x21-\x7e]{1,4096}$/.test(result.access_token) || !Number.isSafeInteger(result.expires_in) || result.expires_in<1 || result.expires_in>86400) throw new GoogleAuthorizationError('invalid_response');
  return {accessToken:result.access_token,expiresIn:result.expires_in};
}
