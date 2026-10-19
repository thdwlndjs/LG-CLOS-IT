import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildLocalLifePack,localLifeId,LOCAL_LIFE_PROFILE_IDS,localLifeFingerprint,readBundledLocalLifePack} from '../src/lifeData/localPack';
import {garmentLifeSummary,lifeEventDate} from '../src/lifeHistory';
import {lifeHistoryReadOptions} from '../src/lifeSnapshot';
import {calendarEntries} from '../src/mirrorPanelData';

const id=localLifeId;
test('browser local adapter connects the full pack with explicit local IDs and no invented media or LED positions',()=>{
 const {state,report}=buildLocalLifePack();
 assert.deepEqual(report.counts,{profiles:2,garments:32,outfits:18,events:70,externalItems:4,careEvidence:8,preferences:9,contexts:4,deferred:0});
 assert.deepEqual(state.profiles,[{id:LOCAL_LIFE_PROFILE_IDS.PSU,name:'김수진'},{id:LOCAL_LIFE_PROFILE_IDS.PHW,name:'최휘재'}]);
 for(const row of [...state.profiles,...state.garments,...state.outfits,...state.events,...state.externalItems!,...state.careEvidence!])assert.match(row.id,/^local:scprep-20261009-v1:/);
 assert(state.garments.every(g=>g.asset===null&&g.location===''&&g.provenance.location==='unconfirmed'));
 assert(state.externalItems!.every(g=>g.asset===null));assert(state.careEvidence!.every(e=>e.asset===null&&e.kind==='official_guidance'));
 assert.equal(state.garments.find(g=>g.id===id('garment','S14'))!.category,'dress');
 assert.equal(state.outfits.find(o=>o.id===id('outfit','LS07'))!.items.dress,id('garment','S14'));
 assert.equal(state.events.filter(e=>e.garmentIds?.includes(id('garment','S14'))).length,2);
});
test('same product in two profiles stays two owned garments; all outfit and event references stay inside their owner',()=>{
 const {state}=buildLocalLifePack(),owned=new Map(state.garments.map(g=>[g.id,g])),external=new Map(state.externalItems!.map(e=>[e.id,e])),outfits=new Map(state.outfits.map(o=>[o.id,o]));
 const su=owned.get(id('garment','S02'))!,hw=owned.get(id('garment','H01'))!;
 assert.equal(su.name,hw.name);assert.notEqual(su.ownerId,hw.ownerId);assert.notEqual(su.id,hw.id);
 for(const o of state.outfits){for(const ref of Object.values(o.items))assert.equal(owned.get(ref)!.ownerId,o.ownerId);for(const ref of Object.values(o.externalItems??{})){assert.equal(external.get(ref.externalItemId)!.ownerId,o.ownerId);assert(!owned.has(ref.externalItemId));}}
 for(const e of state.events){for(const ref of e.garmentIds??[])assert.equal(owned.get(ref)!.ownerId,e.ownerId);if(e.outfitId)assert.equal(outfits.get(e.outfitId)!.ownerId,e.ownerId);}
});
test('S01 and H02 summaries derive from the mapped source events using each fixed profile context',()=>{
 const {state}=buildLocalLifePack();
 for(const [ref,owner,count,days,date] of [['S01',LOCAL_LIFE_PROFILE_IDS.PSU,3,3,'2026-10-04'],['H02',LOCAL_LIFE_PROFILE_IDS.PHW,2,1,'2026-10-07']] as const){
  const summary=garmentLifeSummary(id('garment',ref),owner,state.outfits,state.events,lifeHistoryReadOptions(state,owner));
  assert.equal(summary.wearsAfterLastWash,count);assert.equal(summary.wearDaysAfterLastWash,days);assert.equal(summary.lastWashDate,date);assert.deepEqual(summary.sourceKinds,['scenario_fixture']);
 }
 assert.equal(lifeHistoryReadOptions(state,LOCAL_LIFE_PROFILE_IDS.PSU).asOf,'2026-10-10T14:00:00+09:00');
 assert.equal(lifeHistoryReadOptions(state,LOCAL_LIFE_PROFILE_IDS.PHW).asOf,'2026-10-09T07:40:00+09:00');
});
test('calendar reads the same immutable event snapshots and keeps planned date separate from recorded date',()=>{
 const {state}=buildLocalLifePack(),owner=LOCAL_LIFE_PROFILE_IDS.PHW;
 const plan=state.events.find(e=>e.sourceRef==='HW-PLAN-09')!;
 assert.equal(plan.occurredAt,'2026-10-08T22:00:00+09:00');assert.equal(lifeEventDate(plan),'2026-10-09');
 assert(calendarEntries(owner,'2026-10-09',state.events,state.outfits).some(e=>e.event.id===plan.id));
 assert(!calendarEntries(owner,'2026-10-08',state.events,state.outfits).some(e=>e.event.id===plan.id));
 const wash=state.events.find(e=>e.sourceRef==='SU-W04-W')!;
 assert.equal(wash.garmentIds!.length,6);assert.equal(wash.outfitId,undefined);
 const entry=calendarEntries(LOCAL_LIFE_PROFILE_IDS.PSU,'2026-10-04',state.events,state.outfits).find(e=>e.event.id===wash.id)!;
 assert.equal(entry.event.kind,'care');assert.equal(entry.outfit,undefined);
});
test('official evidence preserves product/source identity, structured unknowns and physical-match limits',()=>{
 const {state}=buildLocalLifePack();
 for(const evidence of state.careEvidence!){const source=JSON.parse(evidence.originalText);assert.equal(source.physical_label_verified,false);assert.equal(source.physical_item_match_verified,false);assert.equal(source.demo_product_binding_verified,true);assert.equal(source.display_source_label,'공식 상품 관리 안내');assert.match(evidence.sourceRef!,/^https:\/\//);assert(source._life_data.product_ref);assert(source._life_data.official_source_ref);}
 const h02=JSON.parse(state.careEvidence!.find(e=>e.garmentId===id('garment','H02'))!.originalText);
 assert.equal(h02.structured_care.wash.temperature_word,'cool');assert.equal(h02.structured_care.wash.temperature_c,null);
 const h03=JSON.parse(state.careEvidence!.find(e=>e.garmentId===id('garment','H03'))!.originalText);assert.deepEqual(h03.structured_care,{});
 const s01=JSON.parse(state.careEvidence!.find(e=>e.garmentId===id('garment','S01'))!.originalText);assert.equal(s01.retrieval_level,'official_search_snapshot');
});
test('rebuilding produces stable source IDs and a content checksum without mutating prior caller edits or the bundle',()=>{
 const first=buildLocalLifePack(),second=buildLocalLifePack();assert.deepEqual(first,second);
 first.state.garments[0].name='편집 보존 대상';first.state.events.push({...first.state.events[0],id:'local:user:extra',sourceEventKey:'user:extra'});
 assert.equal(second.state.garments[0].name,'베이지 포플린 셔츠');assert.equal(second.state.events.length,70);
 const source=readBundledLocalLifePack(),before=JSON.stringify(source);buildLocalLifePack(source);assert.equal(JSON.stringify(source),before);
 source.garments[0].name='새 버전의 변경';assert.notEqual(buildLocalLifePack(source).report.sourceFingerprint,second.report.sourceFingerprint);assert.equal(readBundledLocalLifePack().garments[0].name,'베이지 포플린 셔츠');
 assert.equal(localLifeFingerprint({a:1,b:{c:2}}),localLifeFingerprint({b:{c:2},a:1}));
});
test('a conflicting source is isolated with its original data and cannot bind an outfit to the other profile',()=>{
 const pack=readBundledLocalLifePack();pack.outfits.find(o=>o.ref==='LH01')!.items[0].ref='S01';
 const {state,report}=buildLocalLifePack(pack);
 assert(!state.outfits.some(o=>o.id===id('outfit','LH01')));assert(report.deferred.some(d=>d.entity==='outfit'&&d.ref==='LH01'&&d.reason.includes('reference')));
 assert(report.deferred.some(d=>d.entity==='event'));assert(report.deferred.some(d=>d.entity==='preference'));
 const original=report.deferred.find(d=>d.entity==='outfit')!.source as {items:{ref:string}[]};assert.equal(original.items[0].ref,'S01');
 assert.equal(state.garments.length,32);assert(state.outfits.some(o=>o.id===id('outfit','LH02')));
});
test('duplicate refs and duplicate event source keys are quarantined rather than selecting an arbitrary copy',()=>{
 const pack=readBundledLocalLifePack();pack.garments.push(structuredClone(pack.garments[0]));pack.activity_events[1].source_event_key=pack.activity_events[0].source_event_key;
 const {state,report}=buildLocalLifePack(pack);
 assert(!state.garments.some(g=>g.id===id('garment','S01')));assert.equal(report.deferred.filter(d=>d.entity==='garment'&&d.reason==='duplicate_source_ref').length,2);
 assert(!state.events.some(e=>e.sourceRef===pack.activity_events[0].ref||e.sourceRef===pack.activity_events[1].ref));
 assert(state.garments.some(g=>g.id===id('garment','H02')));
});
test('the browser adapter has no server, test-fixture, remote planner, credentials or Node runtime imports',()=>{
 const source=readFileSync(new URL('../src/lifeData/localPack.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/from\s+['\"](?:node:|.*server\/|.*tests\/|.*importPlan|.*readPack)/);
 assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|createClient|process\.env)\s*\(/);
});
test('malformed individual preferences and contexts do not suppress the other usable profile records',()=>{
 const pack=readBundledLocalLifePack();pack.preferences[0].value=[];pack.contexts.find(c=>c.ref==='CTX-HW-DRY')!.as_of='bad';
 const {state,report}=buildLocalLifePack(pack),data=state.lifeData![LOCAL_LIFE_PROFILE_IDS.PHW];
 assert.equal(report.deferred.filter(d=>d.entity==='preference').length,1);assert.equal(report.deferred.filter(d=>d.entity==='context').length,1);
 assert.equal(data.preferences.length,4);assert.equal(data.contexts.length,2);assert.equal(data.activeContextId,id('context','CTX-HW-RAIN'));
 assert.equal(state.garments.length,32);assert.equal(state.events.length,70);
});
