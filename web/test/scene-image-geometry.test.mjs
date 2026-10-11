import test from 'node:test';
import assert from 'node:assert/strict';
import {maskViewBox} from '../src/mirror/source/sceneImageGeometry.js';
test('scene crops only external photo padding, retaining foreground aspect ratio',()=>{
 assert.equal(maskViewBox({width:384,height:384,path:'M90 40h120v1h-120zM80 41h140v1h-140z'}),'80 40 140 2');
});
test('unknown and out-of-bounds masks preserve full source viewport',()=>{
 assert.equal(maskViewBox({width:384,height:384,path:'M0 0h400v1h-400z'}),'0 0 384 384');
 assert.equal(maskViewBox({width:384,height:384,path:'M0 0h100v1h-10z'}),'0 0 384 384');
 assert.equal(maskViewBox({width:384,height:384,path:'M0 0L10 10Z'}),'0 0 384 384');
});
test('generated atlas uses a bounded cell crop without stretching other sprites',()=>{
 assert.equal(maskViewBox({width:1536,height:1024,path:'',crop:[198,40,200,630]}),'198 40 200 630');
 assert.equal(maskViewBox({width:1536,height:1024,path:'',crop:[1500,40,200,630]}),'0 0 1536 1024');
});
