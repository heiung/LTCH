import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshGoogleAccessToken} from '../worker/google-oauth.mjs';

const options={clientId:'example-client',clientSecret:'example-secret',refreshToken:'example-refresh'};
test('refresh uses the fixed Google endpoint, refuses redirects, and returns only the short-lived token',async()=>{
 let call;
 const result=await refreshGoogleAccessToken({...options,fetchImpl:async(url,init)=>{call={url,init};return Response.json({access_token:'short-lived',token_type:'Bearer',expires_in:3600,refresh_token:'ignored'});}});
 assert.deepEqual(result,{accessToken:'short-lived',expiresIn:3600});
 assert.equal(call.url,'https://oauth2.googleapis.com/token');assert.equal(call.init.redirect,'manual');
 assert.equal(call.init.body.get('grant_type'),'refresh_token');assert.equal(call.init.body.get('refresh_token'),'example-refresh');
});
test('refresh fails closed and never exposes Google errors or credentials',async()=>{
 for(const response of [new Response(null,{status:302,headers:{location:'https://attacker.invalid'}}),new Response('example-secret',{status:400}),new Response('example-refresh',{status:500}),Response.json({access_token:'x\nmalicious',expires_in:3600,token_type:'Bearer'}),Response.json({access_token:'x',expires_in:0,token_type:'Bearer'})]){
  await assert.rejects(refreshGoogleAccessToken({...options,fetchImpl:async()=>response}),e=>!e.message.includes('example')&&e.name==='GoogleAuthorizationError');
 }
 let calls=0;await assert.rejects(refreshGoogleAccessToken({...options,clientSecret:'',fetchImpl:async()=>{calls++;}}),e=>e.code==='not_configured');assert.equal(calls,0);
 await assert.rejects(refreshGoogleAccessToken({...options,fetchImpl:async()=>{throw Error('example-secret');}}),e=>e.code==='unavailable'&&!e.message.includes('example'));
});
