import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoApp,STORAGE_KEY,type StorageLike} from '../src/core';
class MemoryStorage implements StorageLike { data=new Map<string,string>();getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);} }
test('home recommendation replaces visible target and preserves original draft and receipt across reload',async()=>{
 const storage=new MemoryStorage();const app=new DemoApp(storage);app.setOutfitItem('bottom','g-jeans');app.toggleTopLock();
 const saved=await app.saveOutfit('prior-outfit',{delayMs:0});const previous=structuredClone(app.outfitDraft());
 app.loadOutfitDraft('outfit-prepared');assert.deepEqual(app.outfitDraft()?.items,app.outfit('outfit-prepared').items);assert.deepEqual(app.previousOutfitDraft(),previous);
 app.loadOutfitDraft('outfit-prepared');assert.deepEqual(app.previousOutfitDraft(),previous);
 const restored=new DemoApp(storage);assert.equal(restored.persistence.status,'ready');restored.resumePreviousDraft();assert.deepEqual(restored.outfitDraft(),previous);
 const replay=await restored.saveOutfit('prior-outfit',{delayMs:0,fail:true});assert.deepEqual(replay.receipt,saved.receipt);assert.equal(restored.outfits().length,2);
});
test('corrupt or foreign-owner archived drafts are rejected without overwriting stored bytes',()=>{
 const storage=new MemoryStorage();const app=new DemoApp(storage);app.loadOutfitDraft('outfit-prepared');const data=JSON.parse(storage.getItem(STORAGE_KEY)!);data.previousOutfitDrafts[data.activeProfileId][0].ownerId='foreign';const raw=JSON.stringify(data);storage.setItem(STORAGE_KEY,raw);
 const restored=new DemoApp(storage);assert.equal(restored.persistence.reason,'corrupt');assert.equal(storage.getItem(STORAGE_KEY),raw);
});
test('hat and accessory manual registrations retain categories through save and reload',async()=>{
 const storage=new MemoryStorage();const app=new DemoApp(storage);
 for(const category of ['hat','accessory'] as const){app.beginRegistration();app.editRegistration({name:category,category});await app.saveGarment(category,{delayMs:0});app.discardRegistration();}
 const restored=new DemoApp(storage);assert.equal(restored.persistence.status,'ready');assert.deepEqual(restored.garments().slice(-2).map(g=>g.category),['hat','accessory']);
});
