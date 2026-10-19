import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DemoApp,DemoError,createSeed,DEMO_PROFILE,REGISTRATION_ASSET,STORAGE_KEY,type StorageLike} from '../src/core';
import type {LocalDemoProfileBundle} from '../src/core/app';
import type {RemoteBackend} from '../src/integrations/backendClient';
import {buildFittingSnapshot,selectFittingPresentation,type FittingSnapshot} from '../src/mirrorScene';
import {PACK_PROFILE_ID,PACK_PERSON,PACK_ASSETS,PACK_METADATA,PACK_READ_ONLY_ITEMS,PACK_REGISTRATION_EXAMPLE,
  createWardrobePackBundle,matchPackRegistration,matchPreparedPackResult,packAssetUrl} from '../src/wardrobePack';

class MemoryStorage implements StorageLike{
  values=new Map<string,string>();writes=0;fail=false;
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){if(this.fail)throw new Error('Quota exceeded');this.values.set(key,value);this.writes++;}
  removeItem(key:string){this.values.delete(key);}
}
const setup=()=>{const storage=new MemoryStorage();return{storage,app:new DemoApp(storage)};};
const fast={delayMs:0};
function snapshot(app:DemoApp,requestVersion=1){
  const result=buildFittingSnapshot({ownerId:PACK_PROFILE_ID,person:PACK_PERSON,outfit:app.outfitDraft()!,garments:app.garments(),requestVersion});
  assert.deepEqual(result.issues,[]);return result.snapshot!;
}

test('pack adapter keeps raw unbound owners/locations, unknown facts, stable IDs and explicit category mappings',()=>{
  const bundle=createWardrobePackBundle();
  assert.equal(bundle.garments.length,47);assert.equal(PACK_READ_ONLY_ITEMS.length,1);assert.equal(PACK_READ_ONLY_ITEMS[0].garment_id,'D01');
  assert.equal(PACK_READ_ONLY_ITEMS[0].category,'dress');assert.equal(PACK_READ_ONLY_ITEMS[0].asset.url,'/assets/wardrobe-pack/catalog/D01.png');
  for(const garment of bundle.garments){assert.equal(garment.ownerId,PACK_PROFILE_ID);assert.equal(garment.location,'');assert.equal(garment.material,'');assert.equal(garment.size,'');assert.equal(garment.careNotes,'');assert.deepEqual(garment.provenance,{location:'unconfirmed',size:'unconfirmed',care:'unconfirmed'});}
  for(const id of ['A01','A02','A05'])assert.equal(bundle.garments.find(g=>g.id===id)!.category,'bag');
  for(const id of ['A03','A04','A06'])assert.equal(bundle.garments.find(g=>g.id===id)!.category,'accessory');
  assert.equal(bundle.garments.find(g=>g.id==='S06')!.asset!.version,2);
  assert.ok(PACK_METADATA.garments.every(g=>g.owner_id===null&&g.location_json===null&&g.attributes_json.location_ref===null));
  assert.ok(PACK_METADATA.assets.every(a=>a.owner_id===null&&a.storage_key===null));
  assert.ok(Object.isFrozen(PACK_METADATA.garments[0].attributes_json));
  bundle.garments[0].name='edited derived copy';assert.notEqual(createWardrobePackBundle().garments[0].name,'edited derived copy');
});

test('first local installation is one durable append preserving prior drafts, IDs, receipts and saved history',async()=>{
  const{app,storage}=setup();app.beginRegistration();app.replaceRegistrationPhoto(REGISTRATION_ASSET);app.editRegistration({name:'이전 사용자 저장',location:'직접 확인한 선반'});
  const saved=await app.saveGarment('prior-garment',fast);await app.recordActualCare(saved.entity.id,'직접 케어함','prior-care',fast);
  const before=structuredClone(app.getState()),writes=storage.writes;
  assert.deepEqual(app.installLocalDemoProfile(createWardrobePackBundle()),{profileId:PACK_PROFILE_ID,installed:true});
  assert.equal(storage.writes,writes+1);const after=app.getState();
  assert.equal(after.activeProfileId,PACK_PROFILE_ID);assert.equal(after.profiles.length,before.profiles.length+1);
  assert.deepEqual(after.garments.slice(0,before.garments.length),before.garments);assert.deepEqual(after.outfits.slice(0,before.outfits.length),before.outfits);
  assert.deepEqual(after.receipts,before.receipts);assert.deepEqual(after.events,before.events);assert.deepEqual(after.intents,before.intents);
  assert.deepEqual(after.registrationDrafts[DEMO_PROFILE],before.registrationDrafts[DEMO_PROFILE]);assert.deepEqual(after.outfitDrafts[DEMO_PROFILE],before.outfitDrafts[DEMO_PROFILE]);
  assert.deepEqual(app.outfitDraft()!.items,{top:'T05',bottom:'B03',shoes:'S04'});assert.equal(app.outfitDraft()!.sourceOutfitId,'LOOK02');
  assert.equal(app.receipts().length,0);assert.equal(app.events().length,0);
  const restored=new DemoApp(storage);assert.equal(restored.persistence.status,'ready');assert.equal(restored.getState().activeProfileId,PACK_PROFILE_ID);assert.equal(restored.garments().length,47);
  restored.setActiveProfile(DEMO_PROFILE);assert.equal(restored.garment(saved.entity.id).name,'이전 사용자 저장');assert.equal(restored.events().length,1);
});

test('reopening preserves changed pack location, current draft, extra saved items and receipt; never reseeds',async()=>{
  const{app,storage}=setup();app.installLocalDemoProfile(createWardrobePackBundle());
  await app.recordMovementConfirmed('T04','사용자가 확인한 보관 위치','pack-movement',fast);
  app.toggleTopLock();app.setOutfitItem('bottom','B01');await app.saveOutfit('pack-edited-outfit',fast);
  app.beginRegistration();app.replaceRegistrationPhoto(REGISTRATION_ASSET);app.editRegistration({name:'시연 사용자가 추가한 옷',location:'직접 입력'});await app.saveGarment('pack-extra',fast);
  const before=structuredClone(app.getState());app.setActiveProfile(DEMO_PROFILE);
  assert.deepEqual(app.installLocalDemoProfile(createWardrobePackBundle()),{profileId:PACK_PROFILE_ID,installed:false});
  assert.deepEqual(app.getState().garments,before.garments);assert.deepEqual(app.getState().outfits,before.outfits);assert.deepEqual(app.getState().receipts,before.receipts);
  assert.deepEqual(app.outfitDraft(),before.outfitDrafts[PACK_PROFILE_ID]);assert.equal(app.garments().length,48);assert.equal(app.garment('T04').location,'사용자가 확인한 보관 위치');
  const restored=new DemoApp(storage);assert.equal(restored.persistence.status,'ready');assert.equal(restored.installLocalDemoProfile(createWardrobePackBundle()).installed,false);assert.deepEqual(restored.getState().garments,before.garments);
});

test('ID collisions, malformed references and unsupported categories fail without partial changes or writes',()=>{
  const{app,storage}=setup();app.repository.commit(state=>state.garments.push({...state.garments[0],id:'T01'}));
  const before=structuredClone(app.getState()),writes=storage.writes;
  assert.throws(()=>app.installLocalDemoProfile(createWardrobePackBundle()),(e:unknown)=>e instanceof DemoError&&e.code==='CONFLICT');
  assert.deepEqual(app.getState(),before);assert.equal(storage.writes,writes);
  const mutations:((bundle:LocalDemoProfileBundle)=>void)[]=[
    b=>{b.garments[0].ownerId='foreign';},b=>{b.garments[0].category='dress' as any;},b=>{b.garments[0].asset!.source='storage';},
    b=>{b.outfitDraft.items.top='missing';},b=>{b.outfits[0].assetVersions.T07=90;},b=>{b.profile.id='constructor';},b=>{b.garments[0]=null as any;},
    b=>{b.garments[0].asset!.url=42 as any;},b=>{b.garments[0].asset!.id={} as any;},
  ];
  for(const mutate of mutations){const clean=setup(),bundle=createWardrobePackBundle(),state=structuredClone(clean.app.getState());mutate(bundle);assert.throws(()=>clean.app.installLocalDemoProfile(bundle),(e:unknown)=>e instanceof DemoError&&e.code==='VALIDATION');assert.deepEqual(clean.app.getState(),state);assert.equal(clean.storage.writes,0);}
});

test('quota failure leaves all prior data and profile selection intact; successful retry is once only',()=>{
  const{app,storage}=setup(),before=structuredClone(app.getState());storage.fail=true;
  assert.throws(()=>app.installLocalDemoProfile(createWardrobePackBundle()),(e:unknown)=>e instanceof DemoError&&e.code==='STORAGE');
  assert.deepEqual(app.getState(),before);assert.equal(storage.getItem(STORAGE_KEY),null);
  storage.fail=false;assert.equal(app.installLocalDemoProfile(createWardrobePackBundle()).installed,true);assert.equal(app.getState().profiles.length,2);
});

test('DB mode rejects local pack installation before any remote write or source mutation',async()=>{
  const{app,storage}=setup();let reads=0;
  // In-process transport fixture only; no auth, DB or provider is called.
  const remote={mode:'mock',state:async()=>{reads++;return createSeed();}} as RemoteBackend;
  await app.configureRemote(remote);const before=structuredClone(app.getState()),writes=storage.writes;
  assert.throws(()=>app.installLocalDemoProfile(createWardrobePackBundle()),(e:unknown)=>e instanceof DemoError&&e.code==='CONFLICT');
  assert.equal(reads,1);assert.deepEqual(app.getState(),before);assert.equal(storage.writes,writes);
  await app.configureRemote();assert.equal(app.installLocalDemoProfile(createWardrobePackBundle()).installed,true);
});

test('REGISTER01 exact asset/version resolves existing T04 without creating an item or care evidence',()=>{
  const{app}=setup();app.installLocalDemoProfile(createWardrobePackBundle());const before=structuredClone(app.getState());
  assert.deepEqual(matchPackRegistration(PACK_REGISTRATION_EXAMPLE.asset.id,1),{status:'existing-item',garmentId:'T04',exampleId:'REGISTER01'});
  assert.equal(matchPackRegistration(PACK_REGISTRATION_EXAMPLE.asset.id,2),null);assert.equal(matchPackRegistration('asset_T04_v1',1),null);
  assert.deepEqual(app.getState(),before);assert.equal(app.garments().filter(g=>g.id==='T04').length,1);assert.equal(PACK_REGISTRATION_EXAMPLE.care_label_provided,false);
});

test('LOOK02 top lock and B03 → B01 replacement matches prepared LOOK03, never provider completion',()=>{
  const{app}=setup();app.installLocalDemoProfile(createWardrobePackBundle());const original=snapshot(app);
  const first=matchPreparedPackResult(original);assert.equal(first?.resultId,'RESULT_LOOK02');assert.equal(first?.origin,'prepared-static');assert.equal(first?.operationId,undefined);
  assert.equal(original.person.assetId,'asset_LOOK01_v1');assert.equal(PACK_PERSON.id,'DEMO_PERSON01');
  app.toggleTopLock();app.setOutfitItem('bottom','B01');const next=snapshot(app,2),result=matchPreparedPackResult(next);
  assert.equal(app.outfitDraft()!.items.top,'T05');assert.equal(app.outfitDraft()!.items.shoes,'S04');assert.equal(result?.resultId,'RESULT_LOOK03');
  assert.equal(result?.media?.kind,'image');assert.match(selectFittingPresentation({current:next,request:{snapshot:next,status:'completed'},result}).label,/준비된 정적 착장 예시/);
  assert.equal(matchPreparedPackResult(original,next),null);assert.equal(selectFittingPresentation({current:next,request:null,result:first}).display,'original-person');
  assert.equal(app.events().length,0);assert.equal(app.receipts().length,0);
  result!.snapshot.outfit.items[0].assetVersion=100;assert.equal(next.outfit.items[0].assetVersion,1);
});

test('all three prepared examples match only exact full item identities and versions regardless of slot order',()=>{
  const{app}=setup();app.installLocalDemoProfile(createWardrobePackBundle());
  for(const id of ['LOOK01','LOOK02','LOOK03']){app.loadOutfit(id);const input=snapshot(app);input.outfit.items.reverse();assert.equal(matchPreparedPackResult(input)?.resultId,`RESULT_${id}`);}
  const valid=snapshot(app);
  const mutations:((s:FittingSnapshot)=>void)[]=[
    s=>{s.ownerId='demo-profile';},s=>{s.person.assetId='another-person';},s=>{s.person.assetVersion++;},s=>{s.outfit.items[0].assetId='different-asset';},
    s=>{s.outfit.items[0].assetVersion++;},s=>{s.outfit.items[0].garmentId='another-garment';},s=>{s.outfit.items.pop();},
    s=>{s.outfit.items.push({slot:'bag',garmentId:'A01',assetId:'asset_A01_v1',assetVersion:1});},s=>{s.outfit.items[0].slot=s.outfit.items[1].slot;},
    s=>{s.requestVersion=0;},s=>{s.outfit.revision=0;},s=>{s.outfit.draftId=null;s.outfit.outfitId=null;},
  ];
  for(const mutate of mutations){const input=structuredClone(valid);mutate(input);assert.equal(matchPreparedPackResult(input),null);}
  for(const change of ['requestVersion','revision','draftId'] as const){const current=structuredClone(valid);if(change==='requestVersion')current.requestVersion++;else if(change==='revision')current.outfit.revision++;else current.outfit.draftId='different-draft';assert.equal(matchPreparedPackResult(valid,current),null);}
});

test('all 52 packaged image bytes and sizes match source checksums; outfit full snapshots match the supplied signatures',async()=>{
  assert.equal(PACK_ASSETS.length,52);
  for(const asset of PACK_ASSETS){const bytes=await readFile(resolve('public',packAssetUrl(asset.image_ref).slice(1)));assert.equal(bytes.byteLength,asset.byte_size,asset.id);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.id);}
  const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,v])=>[key,canonical(v)])):value;
  for(const outfit of PACK_METADATA.outfits){const signature=createHash('sha256').update(JSON.stringify(canonical(outfit.snapshot_json.items))).digest('hex');assert.equal(signature,outfit.snapshot_json.outfit_signature,outfit.id);}
  assert.throws(()=>packAssetUrl('assets/catalog/../escape.png'));assert.throws(()=>packAssetUrl('https://example.test/image.png'));
});
