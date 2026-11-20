import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { createFirebaseVerifier } from '../worker/firebase-identity.mjs';
test('Firebase verifier checks signature, audience, account state and revocation', async () => {
 const { privateKey, publicKey } = await generateKeyPair('RS256');
 const now = Math.floor(Date.now()/1000);
 const token = await new SignJWT({email:'student@example.com',auth_time:now-10}).setProtectedHeader({alg:'RS256'}).setIssuer('https://securetoken.google.com/test-project').setAudience('test-project').setSubject('student').setIssuedAt(now-10).setExpirationTime(now+600).sign(privateKey);
 let user={localId:'student',email:'student@example.com',validSince:String(now-11)};
 const verify=createFirebaseVerifier({projectId:'test-project',apiKey:'public-config',keys:publicKey,fetchImpl:async()=>({ok:true,json:async()=>({users:[user]})})});
 assert.deepEqual(await verify(token),{uid:'student',email:'student@example.com',name:'student@example.com'});
 user={...user,disabled:true}; await assert.rejects(verify(token));
 user={...user,disabled:false,validSince:String(now)}; await assert.rejects(verify(token));
 const wrong=createFirebaseVerifier({projectId:'other-project',apiKey:'public-config',keys:publicKey,fetchImpl:async()=>({ok:true,json:async()=>({users:[user]})})}); await assert.rejects(wrong(token));
});

test('temporary Google failures are retryable and do not masquerade as a revoked identity', async () => {
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const now=Math.floor(Date.now()/1000);
 const token=await new SignJWT({email:'student@example.com',auth_time:now-10}).setProtectedHeader({alg:'RS256'}).setIssuer('https://securetoken.google.com/test-project').setAudience('test-project').setSubject('student').setIssuedAt(now-10).setExpirationTime(now+600).sign(privateKey);
 const unavailable=createFirebaseVerifier({projectId:'test-project',apiKey:'test',keys:publicKey,fetchImpl:async()=>{throw new TypeError('private network detail');}});
 await assert.rejects(unavailable(token),error=>error.status===503&&error.code==='IDENTITY_UNAVAILABLE'&&!error.message.includes('private'));
 const invalid=createFirebaseVerifier({projectId:'test-project',apiKey:'test',keys:publicKey,fetchImpl:async()=>({ok:false,json:async()=>({error:{message:'INVALID_ID_TOKEN'}})})});
 await assert.rejects(invalid(token),error=>error.status===401&&error.code==='IDENTITY_REQUIRED');
 await assert.rejects(invalid('malformed-token'),error=>error.status===401&&error.code==='IDENTITY_REQUIRED');
});

