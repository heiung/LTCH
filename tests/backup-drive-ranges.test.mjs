import test from 'node:test';
import assert from 'node:assert/strict';
import {backupChunk,backupChunkBytes,backupConfirmedOffset,backupMaxBytes} from '../worker/backup-drive-ranges.mjs';

test('Drive backup chunks cover a large synthetic file without allocating it',()=>{
 const total=5*1024*1024*1024+31;
 let offset=0,count=0;
 while(offset<total){const chunk=backupChunk(total,offset);assert.equal(chunk.offset,offset);assert.ok(chunk.length<=backupChunkBytes);assert.equal(chunk.contentRange,`bytes ${offset}-${offset+chunk.length-1}/${total}`);offset+=chunk.length;count++;}
 assert.equal(offset,total);assert.equal(count,641);
});

test('Drive-confirmed partial ranges can resume but malformed or impossible responses fail',()=>{
 const total=backupChunkBytes*2+3;
 assert.equal(backupConfirmedOffset(total,null),0);
 assert.equal(backupConfirmedOffset(total,'bytes=0-999'),1000);
 assert.equal(backupChunk(total,1000).offset,1000);
 for(const range of ['bytes=1-3','bytes=0--1',`bytes=0-${total-1}`,'bytes=0-9007199254740999',42])assert.throws(()=>backupConfirmedOffset(total,range),RangeError);
 assert.throws(()=>backupChunk(total,total),RangeError);
 assert.throws(()=>backupChunk(backupMaxBytes+1,0),RangeError);
});
