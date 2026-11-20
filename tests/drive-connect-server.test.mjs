import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorization} from '../scripts/drive-connect-core.mjs';
import {createDriveConnectHandler} from '../scripts/drive-connect-server.mjs';

function fakeResponse(){return {writeHead(status,headers){this.status=status;this.headers=headers;},end(body=''){this.body=body;}};}
test('loopback OAuth rejects cross-site starts, wrong state and callback replays; codes never reach pages',async()=>{
 const flow=createAuthorization({clientId:'100000000000-example123.apps.googleusercontent.com'});let calls=0,finished=0;
 const handler=createDriveConnectHandler({flow,expires:200,clock:()=>100,run:async(code,verifier)=>{calls++;assert.equal(code,'fake-code');assert.equal(verifier,flow.verifier);},onFinished:error=>{assert.equal(error,undefined);finished++;}});
 const invoke=async(url,headers={})=>{const res=fakeResponse();await handler({method:'GET',url,headers:{host:'127.0.0.1:48421',...headers}},res);return res;};
 assert.equal((await invoke('/callback?code=fake-code&state='+flow.state)).status,400);
 assert.equal((await invoke('/start',{'sec-fetch-site':'cross-site'})).status,400);
 assert.equal((await invoke('/start',{'sec-fetch-site':'none'})).status,303);
 assert.equal((await invoke('/callback?code=fake-code&state='+'x'.repeat(43))).status,400);
 const accepted=await invoke('/callback?code=fake-code&state='+flow.state);
 assert.equal(accepted.status,303);assert.equal(accepted.headers.location,'/status');assert.ok(!accepted.body.includes('fake-code'));
 assert.equal(calls,1);assert.equal(finished,1);
 assert.equal((await invoke('/callback?code=fake-code&state='+flow.state)).status,400);
 const status=await invoke('/status');assert.equal(status.status,200);assert.ok(!status.body.includes('fake-code'));assert.equal(status.headers.refresh,'5; url=https://ltch.example.com/app');
 assert.equal((await invoke('/status',{host:'evil.example'})).status,400);
});
test('status waits for completion and never navigates to the website on failure',async()=>{
 const flow=createAuthorization({clientId:'100000000000-example123.apps.googleusercontent.com'});let finish;
 const handler=createDriveConnectHandler({flow,expires:200,clock:()=>100,run:()=>new Promise((_,reject)=>{finish=()=>reject(Error('test failure'));}),onFinished:()=>{}});
 const invoke=async(url)=>{const res=fakeResponse();await handler({method:'GET',url,headers:{host:'127.0.0.1:48421'}},res);return res;};
 await invoke('/start');const callback=invoke('/callback?code=fake-code&state='+flow.state);
 const waiting=await invoke('/status');assert.equal(waiting.headers.refresh,'2; url=/status');
 finish();await callback;const failed=await invoke('/status');assert.equal(failed.headers.refresh,undefined);assert.match(failed.body,/Chưa hoàn tất/);
});
test('expired OAuth flow does not invoke the token exchange',async()=>{
 const flow=createAuthorization({clientId:'100000000000-example123.apps.googleusercontent.com'});let calls=0;
 const handler=createDriveConnectHandler({flow,expires:100,clock:()=>101,run:async()=>calls++,onFinished:()=>{}});
 const res=fakeResponse();await handler({method:'GET',url:'/start',headers:{host:'127.0.0.1:48421'}},res);
 assert.equal(res.status,400);assert.equal(calls,0);
});
