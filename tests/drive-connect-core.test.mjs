import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorization,exchangeCode,validState,validateClient,driveScope,redirectUri,officialEmail} from '../scripts/drive-connect-core.mjs';
const clientId='100000000000-example123.apps.googleusercontent.com',clientSecret='fake-secret';
test('Drive setup requests the narrow per-file scope with state, PKCE and the official account hint',()=>{
 const flow=createAuthorization({clientId}),url=new URL(flow.url);
 assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('scope'),driveScope);
 assert.equal(url.searchParams.get('redirect_uri'),redirectUri);assert.equal(url.searchParams.get('login_hint'),officialEmail);
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(validState(flow.state,flow.state));assert.equal(validState(flow.state,'x'.repeat(43)),false);
 assert.deepEqual(validateClient({client_id:clientId,client_secret:clientSecret,redirect_uris:[redirectUri]}),{clientId,clientSecret});
 assert.throws(()=>validateClient({client_id:clientId,client_secret:clientSecret,redirect_uris:['https://evil.example']}));
 assert.throws(()=>validateClient({client_id:'999999-example123.apps.googleusercontent.com',client_secret:clientSecret,redirect_uris:[redirectUri]},{projectNumber:'100000000000'}));
});
test('Drive setup exchanges a code only with Google and rejects a broader scope or missing refresh token',async()=>{
 let call;const opts={clientId,clientSecret,code:'fake-code',verifier:'fake-verifier'};
 const fetchImpl=async(url,init)=>{call={url,init};return Response.json({access_token:'fake-access',refresh_token:'fake-refresh',token_type:'Bearer',scope:driveScope});};
 assert.deepEqual(await exchangeCode({...opts,fetchImpl}),{accessToken:'fake-access',refreshToken:'fake-refresh'});
 assert.equal(call.url,'https://oauth2.googleapis.com/token');assert.equal(call.init.redirect,'error');
 for(const token of [{access_token:'a',token_type:'Bearer',scope:driveScope},{access_token:'a',refresh_token:'r',token_type:'Bearer',scope:`${driveScope} https://www.googleapis.com/auth/drive`}])await assert.rejects(exchangeCode({...opts,fetchImpl:async()=>Response.json(token)}),e=>e.name==='ConnectError'&&!e.message.includes('fake'));
});
