import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed, DemoApp, DemoError, DEMO_CONDITIONS, DEMO_DATE, DEMO_PROFILE, emptyUI, PreparedMockRunner, REGISTRATION_ASSET, STORAGE_KEY, type DemoState, type StorageLike, type TryOnInput } from '../src/core/index';

class MemoryStorage implements StorageLike {
  values = new Map<string,string>(); writes: string[] = []; fail = false;
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){if(this.fail){const error=new Error('Quota exceeded');error.name='QuotaExceededError';throw error;}this.values.set(key,value);this.writes.push(value);}
  removeItem(key:string){this.values.delete(key);}
}
const fast={delayMs:0};
function setup(seed?:()=>DemoState){const storage=new MemoryStorage();return{app:new DemoApp(storage,seed),storage};}
function ready(app:DemoApp){app.beginRegistration();app.replaceRegistrationPhoto(REGISTRATION_ASSET);app.editRegistration({name:'직접 입력한 니트',category:'top',location:'선반 C'});}
function secondProfileSeed(){const state=createSeed();state.profiles.push({id:'test-second-profile',name:'테스트 전용 두 번째 프로필'});state.ui['test-second-profile']=emptyUI();state.garments.push({...state.garments[0],id:'other-trench',ownerId:'test-second-profile'});return state;}

test('registration → save → list/detail → reload preserves same garment ID and receipt',async()=>{
  const{app,storage}=setup();ready(app);const result=await app.saveGarment('register-one',fast);
  assert.equal(app.garment(result.entity.id).name,'직접 입력한 니트');assert.equal(result.receipt.entityId,result.entity.id);
  const restored=new DemoApp(storage);assert.equal(restored.garment(result.entity.id).id,result.entity.id);assert.equal(restored.receipts()[0].id,result.receipt.id);
  const persisted=JSON.parse(storage.writes.find(raw=>JSON.parse(raw).receipts.length===1)!);assert.ok(persisted.garments.some((g:{id:string})=>g.id===result.entity.id));
});
test('duplicate intent, concurrent saves, and same revision with a different key produce one result',async()=>{
  const{app}=setup();ready(app);
  const[a,b]=await Promise.all([app.saveGarment('same', {delayMs:15}),app.saveGarment('same',fast)]);
  const c=await app.saveGarment('revision-alias',fast);
  assert.equal(a.entity.id,b.entity.id);assert.equal(c.receipt.id,b.receipt.id);assert.equal(app.garments().length,8);assert.equal(app.receipts().length,1);
});
test('same key with different content is a no-change conflict, including a key previously aliased by revision',async()=>{
  const{app}=setup();ready(app);await app.saveGarment('original',fast);await app.saveGarment('alias',fast);app.editRegistration({name:'다른 내용'});
  await assert.rejects(app.saveGarment('original',fast),(e:unknown)=>e instanceof DemoError&&e.code==='CONFLICT');
  await assert.rejects(app.saveGarment('alias',fast),(e:unknown)=>e instanceof DemoError&&e.code==='CONFLICT');
  assert.equal(app.garments().length,8);assert.equal(app.receipts().length,1);
});
test('draft revisions, selections, filters and screen persist through navigation and reload',async()=>{
  const{app,storage}=setup();ready(app);app.selectGarment('g-jacket');app.setSearchFilters({query:'재킷',category:'outer'});app.setScreen('closet');app.setScreen('home');app.setScreen('closet');
  const restored=new DemoApp(storage);assert.equal(restored.registrationDraft()?.name,'직접 입력한 니트');assert.equal(restored.ui().query,'재킷');assert.equal(restored.ui().category,'outer');assert.equal(restored.ui().selectedGarmentId,'g-jacket');assert.equal(restored.ui().screen,'closet');
});
test('late analysis cannot overwrite a manual edit',async()=>{
  const{app}=setup();ready(app);const analysis=app.analyzeRegistration({delayMs:20});app.editRegistration({name:'직접 바꾼 이름'});
  assert.equal((await analysis).status,'stale');assert.equal(app.registrationDraft()?.name,'직접 바꾼 이름');
});
test('photo replacement invalidates older analysis; canceled or invalid replacement keeps previous photo and manual values',async()=>{
  const{app}=setup();ready(app);const revision=app.registrationDraft()!.revision;
  app.replaceRegistrationPhoto(null);assert.equal(app.registrationDraft()!.revision,revision);
  assert.throws(()=>app.replaceRegistrationPhoto({...REGISTRATION_ASSET,url:'https://example.com/image.png'}));assert.equal(app.registrationDraft()!.asset!.id,REGISTRATION_ASSET.id);
  const analysis=app.analyzeRegistration({delayMs:20});app.replaceRegistrationPhoto({id:'user-photo',version:1,source:'upload',url:'blob:local-photo'});
  assert.equal((await analysis).status,'stale');assert.equal(app.registrationDraft()!.name,'직접 입력한 니트');
});
test('analysis matches exact registered asset/version and never fabricates a result for arbitrary uploads',async()=>{
  const{app}=setup();app.beginRegistration();app.replaceRegistrationPhoto(REGISTRATION_ASSET);assert.equal((await app.analyzeRegistration(fast)).status,'success');assert.equal(app.registrationDraft()!.name,'버건디 니트');
  app.replaceRegistrationPhoto({...REGISTRATION_ASSET,version:2});assert.equal((await app.analyzeRegistration(fast)).status,'no-result');
  app.replaceRegistrationPhoto({id:'arbitrary',version:1,source:'upload',url:'blob:user'});app.editRegistration({name:'내 사진 이름'});assert.equal((await app.analyzeRegistration(fast)).status,'no-result');assert.equal(app.registrationDraft()!.name,'내 사진 이름');
});
test('uploaded image bytes/URLs are not stored; reload explicitly requires reselection and same revision save dedupes',async()=>{
  const{app,storage}=setup();ready(app);app.replaceRegistrationPhoto({id:'upload-one',version:1,source:'upload',url:'blob:one'});const saved=await app.saveGarment('upload-save',fast);
  assert.ok(!storage.getItem(STORAGE_KEY)!.includes('blob:one'));
  const restored=new DemoApp(storage);assert.equal(restored.garment(saved.entity.id).asset!.url,null);assert.equal(restored.garment(saved.entity.id).asset!.needsReselection,true);
  assert.equal((await restored.saveGarment('upload-retry',fast)).receipt.id,saved.receipt.id);
});
test('q1 delayed result never replaces q2; changing category also invalidates pending search',async()=>{
  const{app}=setup();const first=app.searchGarments('트렌치',{delayMs:25});const second=app.searchGarments('재킷',fast);
  assert.equal((await second).status,'success');assert.equal((await first).status,'stale');assert.deepEqual(app.ui().searchResultIds,['g-jacket']);
  const pending=app.searchGarments('니트',{delayMs:15});app.setSearchFilters({category:'bottom'});assert.equal((await pending).status,'stale');
});
test('top lock and bottom replacement keep all other slots and do not auto-save, wear, recommend or fit',async()=>{
  const{app}=setup();app.toggleTopLock();const before=structuredClone(app.outfitDraft()!.items);app.setOutfitItem('bottom','g-jeans');
  assert.deepEqual(app.outfitDraft()!.items,{...before,bottom:'g-jeans'});assert.equal(app.outfitDraft()!.topLocked,true);assert.equal(app.outfits().length,1);assert.equal(app.events().length,0);assert.equal(app.ui().operations.tryOn.status,'idle');
  const otherTop={...app.garment('g-knit'),id:'new-top'};app.repository.commit(s=>s.garments.push(otherTop));assert.throws(()=>app.setOutfitItem('top','new-top'),/고정/);
  assert.throws(()=>app.setOutfitItem('bottom','g-jacket'),/종류/);
});
test('outfit save and duplicate revision preserve exact selected IDs with no automatic actual wear',async()=>{
  const{app,storage}=setup();app.toggleTopLock();app.replaceOutfitItem('bottom','g-jeans');const first=await app.saveOutfit('outfit-one',fast);const retry=await app.saveOutfit('outfit-retry',fast);
  assert.equal(first.receipt.id,retry.receipt.id);assert.equal(first.entity.items.bottom,'g-jeans');assert.equal(first.entity.items.top,'g-knit');assert.equal(app.events().length,0);
  const restored=new DemoApp(storage);assert.equal(restored.outfit(first.entity.id).items.bottom,'g-jeans');
});
test('prepared recommendations require matching weather, owned selections and versions',async()=>{
  const{app}=setup();assert.equal((await app.generateOutfits(DEMO_CONDITIONS,fast)).status,'success');
  const snapshot=structuredClone(app.outfitDraft());assert.equal((await app.generateOutfits({...DEMO_CONDITIONS,weather:'rain'},fast)).status,'no-result');assert.deepEqual(app.outfitDraft(),snapshot);
  app.repository.commit(s=>{s.garments.find(g=>g.id==='g-knit')!.asset!.version=2;});assert.equal((await app.generateOutfits(DEMO_CONDITIONS,fast)).status,'no-result');
});
test('late recommendation cannot overwrite bottom selection, top lock or profile changes',async()=>{
  const{app}=setup(secondProfileSeed);const pending=app.generateOutfits(DEMO_CONDITIONS,{delayMs:20});app.setOutfitItem('bottom','g-jeans');assert.equal((await pending).status,'stale');assert.equal(app.outfitDraft()!.items.bottom,'g-jeans');
  const profilePending=app.generateOutfits(DEMO_CONDITIONS,{delayMs:20});app.setActiveProfile('test-second-profile');assert.equal((await profilePending).status,'stale');
});
test('late save records original snapshot without switching a different current draft or profile',async()=>{
  const{app}=setup(secondProfileSeed);ready(app);const pending=app.saveGarment('late',{delayMs:20});app.editRegistration({name:'새 편집 내용'});app.setActiveProfile('test-second-profile');const result=await pending;
  assert.equal(result.entity.ownerId,DEMO_PROFILE);assert.equal(result.entity.name,'직접 입력한 니트');assert.equal(app.getState().activeProfileId,'test-second-profile');assert.ok(!app.garments().some(g=>g.id===result.entity.id));app.setActiveProfile(DEMO_PROFILE);assert.equal(app.registrationDraft()!.name,'새 편집 내용');assert.equal(app.registrationDraft()!.savedGarmentId,undefined);
});
test('care guide and movement suggestion have no effect; only explicit confirmation records actual action/location',async()=>{
  const{app}=setup();const before=app.garment('g-trench').location;
  const guide=await app.requestCareGuide('g-trench',fast);assert.equal(guide.status,'success');app.proposeMovement('g-trench','보관함 A');assert.equal(app.garment('g-trench').location,before);assert.equal(app.events().length,0);
  const care=await app.recordActualCare('g-trench','보관 완료','care-one',fast);assert.equal(care.entity.kind,'care');assert.equal(app.garment('g-trench').location,before);
  const movement=await app.recordMovementConfirmed('g-trench','보관함 A','move-one',fast);assert.equal(movement.entity.kind,'movement');assert.equal(app.garment('g-trench').location,'보관함 A');assert.equal(app.garment('g-trench').provenance.location,'user');
});
test('unknown care source remains explicitly unconfirmed',async()=>{
  const{app}=setup();const result=await app.requestCareGuide('g-jacket',fast);assert.equal(result.status,'success');if(result.status==='success'){assert.equal(result.data.source,'unconfirmed');assert.equal(result.data.actualCareRecorded,false);}assert.equal(app.events().length,0);
});
test('plan, save and actual wear remain different records; repeated record intent is idempotent',async()=>{
  const{app}=setup();const saved=await app.saveOutfit('save-outfit',fast);await app.planOutfit(saved.entity.id,DEMO_DATE,'plan-one',fast);assert.deepEqual(app.events().map(e=>e.kind),['plan']);
  const wear=await app.recordWear(saved.entity.id,DEMO_DATE,'wear-one',fast);const duplicate=await app.recordWear(saved.entity.id,DEMO_DATE,'wear-one',fast);assert.equal(wear.entity.id,duplicate.entity.id);assert.deepEqual(app.events().map(e=>e.kind),['plan','wear']);
  await assert.rejects(app.planOutfit(saved.entity.id,'2026-02-31','bad-date',fast),/날짜/);
});
test('all read/actions stay profile scoped; fixtures do not claim real authentication',async()=>{
  const{app}=setup(secondProfileSeed);assert.ok(!app.garments().some(g=>g.id==='other-trench'));assert.throws(()=>app.garment('other-trench'),/현재 프로필/);await assert.rejects(app.requestCareGuide('other-trench',fast),/현재 프로필/);
  const pending=app.searchGarments('트렌치',{delayMs:20});app.setActiveProfile('test-second-profile');assert.equal((await pending).status,'stale');assert.deepEqual(app.garments().map(g=>g.id),['other-trench']);assert.equal(app.outfits().length,0);assert.equal(app.events().length,0);assert.throws(()=>app.selectOutfit('outfit-prepared'),/현재 프로필/);
});
test('quota/storage failures cannot leave entity without receipt or claim durable save success',async()=>{
  const{app,storage}=setup();ready(app);storage.fail=true;app.editRegistration({name:'메모리 편집'});assert.equal(app.persistence.status,'memory-only');assert.equal(app.registrationDraft()!.name,'메모리 편집');
  await assert.rejects(app.saveGarment('quota',fast),(e:unknown)=>e instanceof DemoError&&e.code==='STORAGE');assert.equal(app.garments().length,7);assert.equal(app.receipts().length,0);assert.equal(app.persistence.reason,'quota');
  storage.fail=false;const saved=await app.saveGarment('quota',fast);assert.equal(app.persistence.status,'ready');assert.equal(app.garment(saved.entity.id).name,'메모리 편집');
});
test('unavailable storage retains draft in memory and reports explicit save failure',async()=>{
  const app=new DemoApp();ready(app);await assert.rejects(app.saveGarment('no-storage',fast),/메모리|저장/);assert.equal(app.persistence.status,'memory-only');assert.equal(app.registrationDraft()!.name,'직접 입력한 니트');assert.equal(app.garments().length,7);
});
test('malformed/wrong-version storage is preserved until explicit project-only reset',async()=>{
  for(const raw of ['{bad json',JSON.stringify({schemaVersion:99}),JSON.stringify({...createSeed(),ui:{}})]){
    const storage=new MemoryStorage();storage.setItem(STORAGE_KEY,raw);storage.setItem('other-project','keep');const app=new DemoApp(storage);assert.equal(app.persistence.reason,'corrupt');ready(app);await assert.rejects(app.saveGarment('corrupt',fast));assert.equal(storage.getItem(STORAGE_KEY),raw);
    app.resetDemo();assert.equal(app.persistence.status,'ready');assert.equal(storage.getItem('other-project'),'keep');assert.equal(app.garments().length,7);
  }
});
test('mismatched fitting produces no media; stop cleans every registered resource and invalidates late completion',async()=>{
  const{app,storage}=setup();const result=await app.startTryOn('outfit-prepared',fast);assert.equal(result.status,'unavailable');assert.equal(app.ui().operations.tryOn.status,'unavailable');
  let stopped=0;app.registerTryOnCleanup(()=>{stopped++;});app.registerTryOnCleanup(()=>{stopped++;throw Error('cleanup');});app.registerTryOnCleanup(()=>{stopped++;});app.stopTryOn();assert.equal(stopped,3);
  const pending=app.startTryOn('outfit-prepared',{delayMs:20});app.stopTryOn();assert.equal((await pending).status,'stale');assert.equal(app.ui().operations.tryOn.status,'idle');assert.equal(new DemoApp(storage).ui().operations.tryOn.status,'idle');
});
test('mock errors retain edits and permit retry without unintended records',async()=>{
  const{app}=setup();ready(app);await assert.rejects(app.analyzeRegistration({...fast,fail:true}),(e:unknown)=>e instanceof DemoError&&e.code==='MOCK_FAILURE');assert.equal(app.ui().operations.analysis.status,'error');assert.equal(app.registrationDraft()!.name,'직접 입력한 니트');
  await assert.rejects(app.saveGarment('failure',{...fast,fail:true}));assert.equal(app.garments().length,7);await app.saveGarment('failure',fast);assert.equal(app.garments().length,8);
});
test('explicit reset invalidates old async saves and leaves seed intact',async()=>{
  const{app}=setup();ready(app);const pending=app.saveGarment('before-reset',{delayMs:20});app.resetDemo();await assert.rejects(pending,/초기화/);assert.equal(app.garments().length,7);assert.equal(app.receipts().length,0);assert.equal(app.registrationDraft(),undefined);
});
test('runtime contracts reject remote/data image URLs instead of storing image bytes',()=>{
  const{app}=setup();ready(app);for(const url of ['data:image/png;base64,AAAA','https://example.com/photo.png','/assets/../../secret'])assert.throws(()=>app.replaceRegistrationPhoto({...REGISTRATION_ASSET,url}),/프로젝트 자산/);
});
test('manual fields set before a fresh analysis, including empty fields, survive fixture analysis and photo replacement',async()=>{
  const{app,storage}=setup();ready(app);app.editRegistration({color:'내가 확인한 색',material:'',features:['수동 특징']});app.replaceRegistrationPhoto(REGISTRATION_ASSET);
  assert.equal((await app.analyzeRegistration(fast)).status,'success');assert.equal(app.registrationDraft()!.name,'직접 입력한 니트');assert.equal(app.registrationDraft()!.color,'내가 확인한 색');assert.equal(app.registrationDraft()!.material,'');assert.deepEqual(app.registrationDraft()!.features,['수동 특징']);
  const restored=new DemoApp(storage);await restored.analyzeRegistration(fast);assert.equal(restored.registrationDraft()!.name,'직접 입력한 니트');assert.equal(restored.registrationDraft()!.manualFields.name,true);
});
test('idempotent replay returns immutable original save result after live garment location changes, also after reload',async()=>{
  const{app,storage}=setup();ready(app);const first=await app.saveGarment('immutable',fast);await app.recordMovementConfirmed(first.entity.id,'새 보관함','confirmed-movement',fast);
  const replay=await app.saveGarment('immutable',fast);assert.deepEqual(replay.entity,first.entity);assert.deepEqual(replay.receipt,first.receipt);assert.equal(app.garment(first.entity.id).location,'새 보관함');
  const restored=new DemoApp(storage);const retry=await restored.saveGarment('immutable',fast);assert.deepEqual(retry.entity,first.entity);assert.deepEqual(retry.receipt,first.receipt);
});
test('malformed persisted UI fields, nested assets, snapshots and cross-profile references are rejected without overwriting',async()=>{
  const{app,storage}=setup();ready(app);await app.saveGarment('fixture',fast);const valid=storage.getItem(STORAGE_KEY)!;
  const mutations:((s:any)=>void)[]=[s=>{s.garments[0].location=42;},s=>{s.events.push({id:'broken',ownerId:DEMO_PROFILE,kind:'care',garmentId:'g-trench',value:'broken',date:42});},s=>{s.ui[DEMO_PROFILE].operations.search.message={bad:true};},s=>{s.garments[0].asset.url='https://invalid.example/photo.png';},s=>{s.outfits[0].assetVersions['g-knit']='1';},s=>{s.outfitDrafts[DEMO_PROFILE].topLocked='yes';},s=>{s.registrationDrafts[DEMO_PROFILE].manualFields={name:42};},s=>{s.receipts[0].result.location=42;},s=>{s.outfits[0].items={top:'unknown-id'};},s=>{s.events.push({id:'broken',ownerId:DEMO_PROFILE,kind:'wear',outfitId:'outfit-prepared',value:'broken',date:'2026-02-31'});}];
  for(const mutation of mutations){const changed=JSON.parse(valid);mutation(changed);const raw=JSON.stringify(changed);storage.setItem(STORAGE_KEY,raw);const restored=new DemoApp(storage);assert.equal(restored.persistence.reason,'corrupt');assert.equal(storage.getItem(STORAGE_KEY),raw);}
});
test('try-on adapter gets immutable person/full outfit/asset versions/revision snapshot and never displays unmatched media',async()=>{
  const storage=new MemoryStorage();let received:TryOnInput|undefined;
  class CaptureRunner extends PreparedMockRunner {override async tryOn(input:TryOnInput){received=input;return super.tryOn(input,fast);}}
  const app=new DemoApp(storage,undefined,new CaptureRunner());const revision=app.outfitDraft()!.revision;const result=await app.startTryOn(undefined,fast);assert.equal(result.status,'unavailable');assert.equal(received!.personAsset,null);assert.equal(received!.outfit.revision,revision);assert.deepEqual(received!.outfit.items,app.outfitDraft()!.items);assert.deepEqual(received!.outfit.garmentAssets['g-knit'],{id:'asset-gray-sweatshirt',version:1});
  app.setOutfitItem('bottom','g-jeans');assert.equal(received!.outfit.items.bottom,'g-slacks');
});
test('saving a garment refreshes the active matching query/category in the same entity/receipt commit',async()=>{
  const{app,storage}=setup();app.setSearchFilters({category:'top'});await app.searchGarments('버건디',fast);assert.deepEqual(app.ui().searchResultIds,[]);
  app.beginRegistration();app.replaceRegistrationPhoto(REGISTRATION_ASSET);await app.analyzeRegistration(fast);const saved=await app.saveGarment('matching-search',fast);
  assert.deepEqual(app.ui().searchResultIds,[saved.entity.id]);assert.equal(app.ui().query,'버건디');assert.equal(app.ui().category,'top');assert.equal(app.ui().operations.search.status,'success');
  const firstReceiptWrite=storage.writes.map(raw=>JSON.parse(raw)).find(s=>s.receipts.some((r:{id:string})=>r.id===saved.receipt.id));
  assert.deepEqual(firstReceiptWrite.ui[DEMO_PROFILE].searchResultIds,[saved.entity.id]);
  const restored=new DemoApp(storage);assert.deepEqual(restored.ui().searchResultIds,[saved.entity.id]);
  app.discardRegistration();app.beginRegistration();app.editRegistration({name:'버건디 팬츠',category:'bottom'});await app.saveGarment('nonmatching-category',fast);assert.deepEqual(app.ui().searchResultIds,[saved.entity.id]);
});
test('confirmed movement refreshes location search atomically and does not alter other profiles',async()=>{
  const{app,storage}=setup(secondProfileSeed);await app.searchGarments('행거 B',fast);assert.deepEqual(app.ui().searchResultIds,['g-trench','g-jacket']);
  const movement=await app.recordMovementConfirmed('g-trench','보관함 Z','moving-out',fast);assert.deepEqual(app.ui().searchResultIds,['g-jacket']);
  const firstReceiptWrite=storage.writes.map(raw=>JSON.parse(raw)).find(s=>s.receipts.some((r:{id:string})=>r.id===movement.receipt.id));assert.deepEqual(firstReceiptWrite.ui[DEMO_PROFILE].searchResultIds,['g-jacket']);assert.equal(firstReceiptWrite.garments.find((g:{id:string})=>g.id==='g-trench').location,'보관함 Z');
  await app.searchGarments('보관함 Z',fast);assert.deepEqual(app.ui().searchResultIds,['g-trench']);
  app.setActiveProfile('test-second-profile');assert.deepEqual(app.ui().searchResultIds,[]);assert.equal(app.garment('other-trench').location,'행거 B · 오른쪽 1번째');
});
test('registration refresh does not allow an older pending query to replace the current query results',async()=>{
  const{app}=setup();const old=app.searchGarments('재킷',{delayMs:40});await app.searchGarments('버건디',fast);
  app.beginRegistration();app.replaceRegistrationPhoto(REGISTRATION_ASSET);await app.analyzeRegistration(fast);const saved=await app.saveGarment('during-query',fast);
  assert.equal((await old).status,'stale');assert.equal(app.ui().query,'버건디');assert.deepEqual(app.ui().searchResultIds,[saved.entity.id]);
});
test('changed photo identity/version clears prior automatic analysis but keeps every manually edited field',async()=>{
  const{app}=setup();app.beginRegistration();app.replaceRegistrationPhoto(REGISTRATION_ASSET);await app.analyzeRegistration(fast);
  app.editRegistration({location:'내 선반',size:'M',material:'직접 확인한 소재'});app.replaceRegistrationPhoto({...REGISTRATION_ASSET});assert.equal(app.registrationDraft()!.name,'버건디 니트');
  app.replaceRegistrationPhoto({...REGISTRATION_ASSET,version:2});assert.equal(app.registrationDraft()!.name,'');assert.equal(app.registrationDraft()!.color,'');assert.deepEqual(app.registrationDraft()!.features,[]);assert.equal(app.registrationDraft()!.location,'내 선반');assert.equal(app.registrationDraft()!.size,'M');assert.equal(app.registrationDraft()!.material,'직접 확인한 소재');
  assert.equal((await app.analyzeRegistration(fast)).status,'no-result');assert.equal(app.registrationDraft()!.name,'');
  app.replaceRegistrationPhoto(REGISTRATION_ASSET);await app.analyzeRegistration(fast);app.editRegistration({name:'수동 이름',color:'수동 색',features:['수동 특징'],careNotes:'수동 라벨'});
  app.replaceRegistrationPhoto({id:'new-user-file',version:1,source:'upload',url:'blob:replacement'});assert.equal(app.registrationDraft()!.name,'수동 이름');assert.equal(app.registrationDraft()!.color,'수동 색');assert.deepEqual(app.registrationDraft()!.features,['수동 특징']);assert.equal(app.registrationDraft()!.careNotes,'수동 라벨');
});
test('canceled or invalid photo replacement does not clear already completed analysis or bump its revision',async()=>{
  const{app}=setup();app.beginRegistration();app.replaceRegistrationPhoto(REGISTRATION_ASSET);await app.analyzeRegistration(fast);const before=structuredClone(app.registrationDraft());
  app.replaceRegistrationPhoto(null);assert.deepEqual(app.registrationDraft(),before);
  assert.throws(()=>app.replaceRegistrationPhoto({...REGISTRATION_ASSET,id:'bad',version:0}));assert.deepEqual(app.registrationDraft(),before);
  assert.throws(()=>app.replaceRegistrationPhoto({...REGISTRATION_ASSET,id:'bad',url:'https://invalid.example/image.png'}));assert.deepEqual(app.registrationDraft(),before);
});
test('committed garment/outfit/event retries and known conflicts bypass the mock executor even in error mode',async()=>{
  const storage=new MemoryStorage();let simulations=0;
  class CountRunner extends PreparedMockRunner {override async simulate(...args:Parameters<PreparedMockRunner['simulate']>){simulations++;return super.simulate(...args);}}
  const app=new DemoApp(storage,undefined,new CountRunner());ready(app);const saved=await app.saveGarment('saved-garment',fast);assert.equal(simulations,1);
  const replay=await app.saveGarment('saved-garment',{...fast,fail:true});const alias=await app.saveGarment('new-alias',{...fast,fail:true});assert.deepEqual(replay.entity,saved.entity);assert.deepEqual(alias.receipt,saved.receipt);assert.equal(simulations,1);
  app.editRegistration({name:'다른 초안 내용'});await assert.rejects(app.saveGarment('saved-garment',{...fast,fail:true}),(e:unknown)=>e instanceof DemoError&&e.code==='CONFLICT');await assert.rejects(app.saveGarment('new-alias',{...fast,fail:true}),(e:unknown)=>e instanceof DemoError&&e.code==='CONFLICT');assert.equal(simulations,1);
  const outfit=await app.saveOutfit('saved-outfit',fast);const outfitReplay=await app.saveOutfit('saved-outfit',{...fast,fail:true});assert.deepEqual(outfitReplay.receipt,outfit.receipt);assert.equal(simulations,2);
  const event=await app.recordWear(outfit.entity.id,DEMO_DATE,'saved-wear',fast);const eventReplay=await app.recordWear(outfit.entity.id,DEMO_DATE,'saved-wear',{...fast,fail:true});assert.deepEqual(eventReplay,event.replayed?event:{...event,replayed:true});assert.equal(simulations,3);
  await assert.rejects(app.recordWear(outfit.entity.id,'2026-10-14','saved-wear',{...fast,fail:true}),(e:unknown)=>e instanceof DemoError&&e.code==='CONFLICT');assert.equal(simulations,3);
  assert.equal(app.garments().length,8);assert.equal(app.outfits().length,2);assert.equal(app.events().length,1);
});
test('calendar selection persists per profile without recording an event or changing event date semantics',async()=>{
  const{app,storage}=setup(secondProfileSeed);assert.equal(app.ui().calendarDate,DEMO_DATE);app.setCalendarDate('2026-11-05');app.setScreen('calendar');app.setScreen('home');assert.equal(app.ui().calendarDate,'2026-11-05');
  app.setActiveProfile('test-second-profile');assert.equal(app.ui().calendarDate,DEMO_DATE);app.setCalendarDate('2027-02-03');app.setActiveProfile(DEMO_PROFILE);assert.equal(app.ui().calendarDate,'2026-11-05');assert.equal(app.events().length,0);
  const restored=new DemoApp(storage);assert.equal(restored.ui().calendarDate,'2026-11-05');await restored.recordActualCare('g-trench','시연 관리','calendar-independent-care',fast);assert.equal(restored.events()[0].date,new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));assert.equal(restored.ui().calendarDate,'2026-11-05');
  for(const date of ['2026-02-31','2026-2-03','','not-a-date'])assert.throws(()=>restored.setCalendarDate(date),/날짜/);assert.equal(restored.ui().calendarDate,'2026-11-05');
});
test('legacy v1 calendar omission stays readable while an invalid present date is preserved as corruption',()=>{
  const storage=new MemoryStorage();const legacy=createSeed();delete legacy.ui[DEMO_PROFILE].calendarDate;const raw=JSON.stringify(legacy);storage.setItem(STORAGE_KEY,raw);
  const restored=new DemoApp(storage);assert.equal(restored.persistence.status,'ready');assert.equal(restored.ui().calendarDate,undefined);assert.equal(storage.getItem(STORAGE_KEY),raw);restored.setCalendarDate('2028-02-29');assert.equal(new DemoApp(storage).ui().calendarDate,'2028-02-29');
  for(const invalid of ['2027-02-29','2026-11-31',42,null]){const state=JSON.parse(raw);state.ui[DEMO_PROFILE].calendarDate=invalid;const broken=JSON.stringify(state);storage.setItem(STORAGE_KEY,broken);assert.equal(new DemoApp(storage).persistence.reason,'corrupt');assert.equal(storage.getItem(STORAGE_KEY),broken);}
});


test('new care and movement use the app Seoul date across UTC year boundary',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-12-31T15:30:00Z')});
 const {app}=setup();
 const care=await app.recordActualCare('g-trench','세탁 완료','kst-care',fast);
 const move=await app.recordMovementConfirmed('g-trench','확인한 새 위치','kst-move',fast);
 assert.equal(care.entity.date,'2027-01-01');assert.equal(move.entity.date,'2027-01-01');
});
