import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ORDER,itemKey,assertItems,replaceSlot,layout,snapshot,makeApiContext,captureRevision,validateProposal} from '../src/card-core.mjs';
import {LocalSession} from '../src/local-session.mjs';
const garment=(id,slot='top',extra={})=>({id,profileId:'p1',name:id,kind:'owned',slot,assetId:'a',assetVersion:1,...extra});
const assets={a:{width:1000,height:2000}};
const data={profiles:[{id:'p1'},{id:'p2'}],assets,items:[garment('shirt'),garment('other'),garment('trousers','bottom'),garment('shirt','shoes',{kind:'external'}),garment('no-photo','bag',{assetId:null}),garment('p2-shirt','top',{profileId:'p2'})]};
const draft={id:'draft',profileId:'p1',revision:2,title:'',variant:'natural',background:'sand'};
class MemoryStorage {value=null;fail=false;getItem(){return this.value;}setItem(_key,value){if(this.fail)throw new Error('quota');this.value=value;}}
const setup=()=>{const storage=new MemoryStorage();return {storage,session:new LocalSession({data,storage})};};
const key=id=>itemKey(data.items.find(i=>i.id===id));
test('owned/external same raw ID are distinct, delimiter-safe identities',()=>{
 assert.notEqual(itemKey(garment('same')),itemKey(garment('same','shoes',{kind:'external'})));
 assertItems([garment('same'),garment('same','shoes',{kind:'external'})],'p1');
 assert.notEqual(itemKey({kind:'owned',id:'a|b'}),itemKey({kind:'owned|a',id:'b'}));
});
test('replacement preserves other items and original input',()=>{
 const original=[garment('shirt'),garment('trousers','bottom')],before=JSON.stringify(original);
 const next=replaceSlot(original,garment('replacement'),'p1');assert.equal(next.find(i=>i.slot==='bottom').id,'trousers');assert.equal(JSON.stringify(original),before);
 assert.throws(()=>replaceSlot(original,garment('other','top',{profileId:'p2'}),'p1'),/PROFILE/);
});
test('dress conflict is explicit and replacement removes only conflicting clothes',()=>{
 assert.throws(()=>assertItems([garment('dress','dress'),garment('shirt')],'p1'),/DRESS/);
 const next=replaceSlot([garment('shirt'),garment('trousers','bottom'),garment('shoes','shoes')],garment('dress','dress'),'p1');assert.deepEqual(next.map(i=>i.slot),['shoes','dress']);
});
test('layout covers every legal subset of all eight slot types within canvas',()=>{
 for(let mask=1;mask<(1<<ORDER.length);mask++){
  const items=ORDER.filter((_s,n)=>mask&(1<<n)).map(s=>garment(s,s));
  if(items.some(i=>i.slot==='dress')&&items.some(i=>['top','bottom'].includes(i.slot)))continue;
  for(const variant of ['natural','ordered']){
   const output=layout(items,assets,variant);assert.equal(output.length,items.length);assert.deepEqual(output,layout([...items].reverse(),assets,variant));
   for(const p of output){const angle=p.rotation*Math.PI/180,w=p.width*1080,h=p.height*1350;const rw=Math.abs(w*Math.cos(angle))+Math.abs(h*Math.sin(angle)),rh=Math.abs(h*Math.cos(angle))+Math.abs(w*Math.sin(angle));assert.ok(p.x*1080-rw/2>=-1e-8);assert.ok(p.y*1350-rh/2>=-1e-8);assert.ok(p.x*1080+rw/2<=1080+1e-8);assert.ok(p.y*1350+rh/2<=1350+1e-8);}
  }
 }
});
test('significant alpha metadata controls aspect and source crop without mutating asset',()=>{
 const source={a:{width:1000,height:2000,alphaBounds:{x:300,y:100,width:300,height:1600}}},before=JSON.stringify(source);
 const p=layout([garment('a')],source,'ordered')[0];assert.deepEqual(p.sourceRect,source.a.alphaBounds);assert.ok(Math.abs((p.width*1080)/(p.height*1350)-300/1600)<1e-9);assert.equal(JSON.stringify(source),before);
 assert.throws(()=>layout([garment('a')],{a:{...source.a,alphaBounds:{x:900,y:0,width:300,height:10}}}),/INVALID_ALPHA/);
});
test('missing photo remains selected and does not become a different garment',()=>{
 const item=garment('missing','top',{assetId:null}),snap=snapshot(draft,[item],assets);
 assert.equal(snap.items[0].itemId,'missing');assert.equal(snap.layout[0].imageState,'missing');assert.equal(snap.layout[0].assetId,null);assert.equal(snap.layout[0].sourceRect,null);
});
test('snapshots are deeply immutable, stable by composition and source/version aware',()=>{
 const items=[garment('shirt'),garment('trousers','bottom')],snap=snapshot(draft,items,assets);
 assert.ok(Object.isFrozen(snap.items[0]));assert.throws(()=>snap.items.push({}),TypeError);items[0].id='changed';assert.equal(snap.items.find(i=>i.slot==='top').itemId,'shirt');
 assert.equal(snap.compositionKey,snapshot({...draft,id:'new',revision:9},[garment('trousers','bottom'),garment('shirt')],assets).compositionKey);
 assert.notEqual(snap.compositionKey,snapshot(draft,[garment('shirt','top',{assetVersion:2}),garment('trousers','bottom')],assets).compositionKey);
 assert.equal(snap.createsWearEvent,false);assert.equal(snap.createsPlanEvent,false);assert.equal(snap.provenance,undefined);
});
test('automatic title follows composition; explicit title and empty save semantics',()=>{
 assert.equal(snapshot(draft,[garment('white shirt')],assets).title,'white shirt 중심 코디');
 assert.equal(snapshot({...draft,title:' My title '},[garment('white shirt')],assets).title,'My title');
 assert.throws(()=>snapshot(draft,[],assets),/EMPTY/);
});
test('proposal checks profile candidate scope, locks, duplicates and revision',()=>{
 const items=[data.items[0],data.items[2]],context=makeApiContext(draft,items,data.items,{id:'p1'},{lockedSlots:['top'],generation:3}),token=captureRevision(draft,3);
 const proposal={profileId:'p1',draftId:'draft',revision:2,itemKeys:[key('shirt'),key('trousers')]};
 assert.equal(context.allowedCandidates.some(i=>i.id==='p2-shirt'),false);assert.equal(validateProposal(context,proposal,token).length,2);
 assert.throws(()=>validateProposal(context,{...proposal,itemKeys:[key('other'),key('trousers')]},token),/LOCK_CHANGED/);
 assert.throws(()=>validateProposal(context,{...proposal,itemKeys:[key('shirt'),key('shirt')]},token),/DUPLICATE/);
 assert.throws(()=>validateProposal(context,{...proposal,itemKeys:[key('shirt'),'invented']},token),/UNKNOWN/);
 assert.throws(()=>validateProposal(context,proposal,{...token,revision:3}),/STALE/);
 assert.throws(()=>validateProposal(context,proposal,{...token,generation:4}),/STALE/);
});
test('initial draft is empty and saving needs neither fitting nor title',()=>{
 const {session}=setup();assert.deepEqual(session.selected(),[]);assert.throws(()=>session.save(),/EMPTY/);
 session.choose(key('shirt'));const result=session.save();assert.equal(result.created,true);assert.equal(result.card.titleSource,'items');assert.equal(result.card.storageScope,'local_browser');
});
test('double click, retry and reload save one card',()=>{
 const {session,storage}=setup();session.choose(key('shirt'));const first=session.save();assert.equal(session.save().created,false);
 const reloaded=new LocalSession({data,storage});assert.equal(reloaded.save().created,false);assert.equal(reloaded.cards().length,1);assert.equal(reloaded.cards()[0].id,first.card.id);
});
test('reuse creates new draft, unchanged save reuses source, edits preserve original',()=>{
 const {session}=setup();session.choose(key('shirt'));session.choose(key('trousers'));const saved=session.save().card,before=JSON.stringify(saved),oldDraft=session.draft().id;
 session.reuse(saved.id);assert.notEqual(session.draft().id,oldDraft);assert.equal(session.draft().sourceCardId,saved.id);assert.equal(session.save().created,false);
 session.choose(key('other'));const updated=session.save();assert.equal(updated.created,true);assert.equal(updated.card.sourceCardId,saved.id);assert.equal(updated.card.items.find(i=>i.slot==='bottom').itemId,'trousers');assert.equal(JSON.stringify(session.cards()[0]),before);
});
test('profile roundtrip and storage reload preserve scoped draft/cards',()=>{
 const {session,storage}=setup();session.choose(key('shirt'));const original=session.save().card;session.switchProfile('p2');assert.equal(session.selected().length,0);assert.equal(session.cards().length,0);assert.throws(()=>session.choose(key('shirt')),/허용되지/);
 session.choose(key('p2-shirt'));session.save();session.switchProfile('p1');assert.equal(session.cards()[0].id,original.id);assert.equal(session.selected()[0].id,'shirt');
 const reloaded=new LocalSession({data,storage});assert.equal(reloaded.selected()[0].id,'shirt');reloaded.switchProfile('p2');assert.equal(reloaded.cards().length,1);assert.equal(reloaded.selected()[0].id,'p2-shirt');
});
test('external source remains external after save, reload and reuse',()=>{
 const {session,storage}=setup();const external=data.items.find(i=>i.kind==='external');session.choose(itemKey(external));const saved=session.save().card;
 const reloaded=new LocalSession({data,storage});reloaded.reuse(saved.id);assert.equal(reloaded.selected()[0].kind,'external');assert.equal(reloaded.cards()[0].items[0].kind,'external');assert.equal(reloaded.cards()[0].createsWearEvent,false);
});
test('quota failure rolls back both draft and card changes',()=>{
 const {session,storage}=setup();session.choose(key('shirt'));const before=JSON.stringify(session.getState()),raw=storage.value;storage.fail=true;
 assert.throws(()=>session.choose(key('other')),/변경 전 상태/);assert.equal(JSON.stringify(session.getState()),before);assert.equal(storage.value,raw);
 assert.throws(()=>session.save(),/변경 전 상태/);assert.equal(session.cards().length,0);storage.fail=false;assert.equal(session.save().created,true);
});
test('corrupt JSON is preserved and never silently reset',()=>{
 const storage=new MemoryStorage();storage.value='{damaged';assert.throws(()=>new LocalSession({data,storage}),/원문을 보존/);assert.equal(storage.value,'{damaged');
});
test('cross-tab stale mutation refuses to overwrite newer content',()=>{
 const {session,storage}=setup();session.choose(key('shirt'));const other=new LocalSession({data,storage});session.choose(key('other'));const newest=storage.value;assert.throws(()=>other.save(),/다른 탭/);assert.equal(storage.value,newest);
});
test('late results become stale after manual changes or profile roundtrip',()=>{
 const {session}=setup();session.choose(key('shirt'));let token=session.revisionToken();assert.ok(session.accepts(token));session.choose(key('other'));assert.equal(session.accepts(token),false);
 token=session.revisionToken();session.switchProfile('p2');session.switchProfile('p1');assert.equal(session.accepts(token),false);
});
test('changed asset version blocks reuse without losing source card',()=>{
 const {session,storage}=setup();session.choose(key('shirt'));const card=session.save().card;const modified=structuredClone(data);modified.items[0].assetVersion=2;
 const newer=new LocalSession({data:modified,storage});assert.throws(()=>newer.reuse(card.id),/자산 버전/);assert.equal(newer.cards()[0].items[0].assetVersion,1);
});
test('actual supplied catalog loads without fixed quantity or hidden preset',async()=>{
 const fixture=JSON.parse(await readFile(new URL('../reference/prototype/data/demo-pack.json',import.meta.url),'utf8'));const storage=new MemoryStorage();const session=new LocalSession({data:fixture,storage});assert.equal(session.selected().length,0);
 for(const p of fixture.profiles){session.switchProfile(p.id);for(const item of fixture.items.filter(i=>i.profileId===p.id))session.choose(itemKey(item));assert.ok(session.selected().length>0);session.save();}
 assert.equal(new LocalSession({data:fixture,storage}).cards().length,1);
});

test('reuse rejects changed source version, slot and unversioned name without touching saved state',()=>{
 for(const change of [{sourceVersion:2},{slot:'bottom'},{name:'renamed shirt'},{sourceVersion:2,slot:'bottom'}]){
  const original=structuredClone(data);original.items[0].sourceVersion=1;
  const storage=new MemoryStorage(),first=new LocalSession({data:original,storage});first.choose(key('shirt'));const card=first.save().card;
  const modified=structuredClone(original);Object.assign(modified.items[0],change);
  const current=new LocalSession({data:modified,storage}),before=JSON.stringify(current.getState()),raw=storage.value;
  assert.throws(()=>current.reuse(card.id),/의류 정보/);
  assert.equal(JSON.stringify(current.getState()),before);assert.equal(storage.value,raw);
  assert.deepEqual(current.cards()[0],card);
 }
});
test('catalog version fallback is a source version and cannot silently replace a saved item',()=>{
 const original=structuredClone(data);original.items[0].version=1;
 const storage=new MemoryStorage(),first=new LocalSession({data:original,storage});first.choose(key('shirt'));const card=first.save().card;
 const modified=structuredClone(original);modified.items[0].version=2;
 const current=new LocalSession({data:modified,storage});assert.throws(()=>current.reuse(card.id),/의류 정보/);
 assert.equal(current.cards()[0].items[0].sourceVersion,1);
});

test('corrupt persisted layout geometry blocks reopening and preserves exact raw content',()=>{
 const {session,storage}=setup();session.choose(key('shirt'));session.save();const valid=storage.value;
 const corruptions=[
  l=>{l.width=-1;}, l=>{l.height=0;}, l=>{l.x=1.1;}, l=>{l.y=-0.1;}, l=>{l.rotation=null;},
  l=>{l.rotation='4';}, l=>{l.z=-1;}, l=>{l.z=0.5;}, l=>{l.sourceRect.width=0;},
  l=>{l.sourceRect.x=-5;}, l=>{l.sourceRect.height=999999;}, l=>{l.sourceRect.width=null;},
  l=>{l.width=1;l.x=0;}, l=>{l.kind='external';},l=>{l.assetId='different';},l=>{l.sourceRect=null;}
 ];
 for(const corrupt of corruptions){const changed=JSON.parse(valid);corrupt(changed.cards[0].layout[0]);storage.value=JSON.stringify(changed);const raw=storage.value;assert.throws(()=>new LocalSession({data,storage}),/원문을 보존/);assert.equal(storage.value,raw);}
});
test('persisted duplicate layer depth cannot pass structural validation',()=>{
 const {session,storage}=setup();session.choose(key('shirt'));session.choose(key('trousers'));session.save();const changed=JSON.parse(storage.value);changed.cards[0].layout[1].z=changed.cards[0].layout[0].z;storage.value=JSON.stringify(changed);assert.throws(()=>new LocalSession({data,storage}),/원문을 보존/);
});

test('ordinary four-piece composition keeps prototype hierarchy and intermediate bag',()=>{
 const items=['top','bottom','shoes','bag'].map(slot=>garment(slot,slot,{assetId:slot}));
 const sampleAssets={top:{width:1000,height:1200},bottom:{width:500,height:2000},shoes:{width:1200,height:700},bag:{width:800,height:1000}};
 const positions=Object.fromEntries(layout(items,sampleAssets).map(p=>[p.slot,p]));
 assert.ok(positions.top.x<positions.bag.x&&positions.bag.x<positions.bottom.x);
 assert.ok(positions.top.y<positions.bag.y&&positions.bag.y<positions.shoes.y);
 assert.ok(positions.shoes.x<positions.bag.x);
 assert.ok(positions.bottom.height>positions.top.height);
 assert.ok(positions.bag.y<0.7,'bag stays between shirt and shoes, not the lower fallback band');
});
test('dense accessory fallback covers all seven pieces and avoids hat/accessory collision',()=>{
 const seven=ORDER.filter(slot=>slot!=='dress').map(slot=>garment(slot,slot));
 const positions=layout(seven,assets);assert.equal(positions.length,7);
 const hat=positions.find(p=>p.slot==='hat'),accessory=positions.find(p=>p.slot==='accessory');assert.ok(hat.x<accessory.x);assert.equal(hat.y,accessory.y);
 const small=layout([garment('top'),garment('hat','hat'),garment('accessory','accessory')],assets);assert.equal(small.length,3);assert.notEqual(small.find(p=>p.slot==='hat').x,small.find(p=>p.slot==='accessory').x);
});
