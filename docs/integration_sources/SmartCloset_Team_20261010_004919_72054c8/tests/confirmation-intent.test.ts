import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationIntent} from '../src/confirmationIntent';
import {DemoApp} from '../src/core/app';
test('confirmation idempotency survives intervening actions, retries and a fresh client',async()=>{
 const target={ownerId:'owner',kind:'wear' as const,targetId:'look',date:'2026-10-09'};
 const initial=await confirmationIntent(target);assert.ok(initial.length<=160);
 const distinct=new Set([initial]);
 for(const change of [{ownerId:'other'},{kind:'plan' as const},{targetId:'other-look'},{date:'2026-10-10'}])distinct.add(await confirmationIntent({...target,...change}));
 assert.equal(distinct.size,5);assert.equal(await confirmationIntent(JSON.parse(JSON.stringify(target))),initial);
});
test('wear re-confirmation after a new app instance replays one record and plan remains distinct',async()=>{
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 const first=new DemoApp(storage),look=first.outfits()[0],target={ownerId:look.ownerId,kind:'wear' as const,targetId:look.id,date:'2026-10-09'};
 const result=await first.recordWear(look.id,target.date,await confirmationIntent(target),{delayMs:0});
 const reloaded=new DemoApp(storage);await reloaded.planOutfit(look.id,target.date,await confirmationIntent({...target,kind:'plan'}),{delayMs:0});
 const retry=await reloaded.recordWear(look.id,target.date,await confirmationIntent(target),{delayMs:0});
 assert.equal(retry.replayed,true);assert.equal(retry.entity.id,result.entity.id);
 assert.equal(reloaded.events().filter(e=>e.kind==='wear').length,1);assert.equal(reloaded.events().filter(e=>e.kind==='plan').length,1);
});
