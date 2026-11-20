import test from 'node:test';
import assert from 'node:assert/strict';
import {cropRegion,drawAvatar} from '../client/avatar-crop.mjs';

test('crop uses a centered square, supports pan and zoom, and stays within image bounds',()=>{
 assert.deepEqual(cropRegion(800,400),{x:200,y:0,size:400});
 assert.deepEqual(cropRegion(400,800),{x:0,y:200,size:400});
 assert.deepEqual(cropRegion(800,400,2,0,100),{x:0,y:200,size:200});
 assert.deepEqual(cropRegion(800,400,8,-100,200),{x:0,y:400-400/3,size:400/3});
 assert.throws(()=>cropRegion(0,400),TypeError);
});

test('preview and exported image draw the identical selected region',()=>{
 const calls=[];const ctx={fillRect(...args){calls.push(['fill',...args])},drawImage(...args){calls.push(['draw',...args])}};
 const image={naturalWidth:800,naturalHeight:400};
 for(const size of [256,512])drawAvatar({width:size,height:size,getContext:()=>ctx},image,2,75,25);
 const draws=calls.filter(x=>x[0]==='draw');
 assert.deepEqual(draws[0].slice(2,6),[450,50,200,200]);
 assert.deepEqual(draws[1].slice(2,6),draws[0].slice(2,6));
 assert.deepEqual(draws[1].slice(-2),[512,512]);
});
