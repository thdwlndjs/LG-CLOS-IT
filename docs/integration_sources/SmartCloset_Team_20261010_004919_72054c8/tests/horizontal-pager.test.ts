import test from 'node:test';import assert from 'node:assert/strict';
import {clampPagerIndex,pagerAxis,pagerDragOffset,pagerVelocity,releasedPagerIndex} from '../src/horizontalPagerMotion';
test('8px threshold and 1.2 axis dominance keep taps and diagonals unclaimed',()=>{
 assert.equal(pagerAxis(8,0),'pending');assert.equal(pagerAxis(9,0),'horizontal');
 assert.equal(pagerAxis(10,9),'pending');assert.equal(pagerAxis(13,9),'horizontal');
 assert.equal(pagerAxis(2,20),'vertical');
});
test('drag follows 1:1 inside bounds with limited 18% edge resistance',()=>{
 assert.equal(pagerDragOffset(-47,1,3,200),-47);assert.equal(pagerDragOffset(47,1,3,200),47);
 assert.equal(pagerDragOffset(100,0,3,200),18);assert.equal(pagerDragOffset(1000,0,3,200),36);
 assert.equal(pagerDragOffset(-100,2,3,200),-18);
});
test('a slow release changes one page at 22% of card width',()=>{
 const base={index:1,count:4,velocity:0,cardWidth:200};
 assert.equal(releasedPagerIndex({...base,dx:-43}),1);assert.equal(releasedPagerIndex({...base,dx:-44}),2);
 assert.equal(releasedPagerIndex({...base,dx:44}),0);assert.equal(releasedPagerIndex({...base,dx:-2000}),2);
});
test('fast flick needs more than 0.5px/ms and at least 12px travel',()=>{
 const base={index:0,count:3,cardWidth:200};
 assert.equal(releasedPagerIndex({...base,dx:-11,velocity:-3}),0);
 assert.equal(releasedPagerIndex({...base,dx:-12,velocity:-.5}),0);
 assert.equal(releasedPagerIndex({...base,dx:-12,velocity:-.51}),1);
});
test('release direction, boundaries and empty data stay deterministic',()=>{
 const base={count:3,cardWidth:200,velocity:2};
 assert.equal(releasedPagerIndex({...base,index:0,dx:100}),0);
 assert.equal(releasedPagerIndex({...base,index:2,dx:-100}),2);
 assert.equal(releasedPagerIndex({...base,index:1,dx:100}),0);
 assert.equal(releasedPagerIndex({...base,index:1,dx:0}),1);
 assert.equal(releasedPagerIndex({...base,index:1,count:0,dx:-100}),0);
});
test('recent samples allow velocity, a held release loses flick velocity',()=>{
 const samples=[{x:100,time:0},{x:90,time:160},{x:70,time:180},{x:60,time:200}];
 assert.equal(pagerVelocity(samples,210),-.75);assert.equal(pagerVelocity(samples,321),0);
 assert.equal(pagerVelocity([{x:10,time:20}],20),0);
});
test('invalid or obsolete indices and measurements never escape bounds',()=>{
 assert.equal(clampPagerIndex(-1,3),0);assert.equal(clampPagerIndex(90,3),2);assert.equal(clampPagerIndex(NaN,3),0);
 assert.equal(releasedPagerIndex({index:4,count:2,dx:-100,velocity:0,cardWidth:0}),1);
 assert.equal(releasedPagerIndex({index:0,count:2,dx:NaN,velocity:0,cardWidth:100}),0);
});
