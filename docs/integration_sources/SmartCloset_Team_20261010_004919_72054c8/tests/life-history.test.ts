import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eventFrom} from '../server/domain';
import {effectiveLifeEvents,garmentLifeSummary,lifeDate,lifeTimestamp,lifeEventDate} from '../src/lifeHistory';
import {calendarEntries} from '../src/mirrorPanelData';
import {garmentWearSummary} from '../src/core/wearScenario';
import type {DemoEvent,Outfit} from '../src/core/types';
const root=new URL('../reference/life-data-ready-20261009/SmartCloset_DataReady_v0.1/data/',import.meta.url);
const pack=(name:string)=>JSON.parse(readFileSync(new URL(name+'.json',root),'utf8')) as Record<string,any>[];
const kinds:Record<string,DemoEvent['kind']>={wear_confirmed:'wear',outfit_planned:'plan',movement_confirmed:'movement'};
const events:DemoEvent[]=pack('activity_events').map(e=>eventFrom({id:e.ref,owner_id:e.owner_ref,kind:kinds[e.kind]??'care',occurred_at:e.occurred_at,outfit_id:e.outfit_ref,input_source:'demo',details_json:{...e.details,life_kind:e.kind,source_event_key:e.source_event_key,source_ref:e.ref,revision:1,voided:false,_life_data:{provenance:'synthetic_life_event'}}},e.garment_refs));
const outfits:Outfit[]=pack('outfits').map(o=>({id:o.ref,ownerId:o.owner_ref,name:o.title,revision:1,assetVersions:{},items:Object.fromEntries(o.items.filter((i:any)=>i.kind==='owned').map((i:any)=>[i.slot,i.ref]))}));
const asOf='2026-10-09T07:40:00+09:00';
const summary=(id:string,owner=id.startsWith('S')?'PSU':'PHW',input=events)=>garmentLifeSummary(id,owner,outfits,input,{asOf});

test('prepared S01 and H01 retain three wears across three days after washing; ironing does not reset',()=>{
 for(const id of ['S01','H01']){const s=summary(id);assert.equal(s.wearsAfterLastWash,3);assert.equal(s.wearDaysAfterLastWash,3);assert.equal(s.lastWornDate,'2026-10-08');assert.deepEqual(s.sourceKinds,['scenario_fixture']);}
 assert.equal(summary('S01').lastWashDate,'2026-10-04');assert.equal(summary('H01').lastWashDate,'2026-10-03');
});
test('two distinct H02 confirmations on one day are two wears/one day; planned/saved/fitting never increment',()=>{
 const s=summary('H02');assert.equal(s.wearCount,2);assert.equal(s.wearDays,1);assert.equal(s.wearsAfterLastWash,2);assert.equal(s.wearDaysAfterLastWash,1);
 const withoutPlans=events.filter(e=>e.kind!=='plan');assert.equal(summary('H02','PHW',withoutPlans).wearCount,s.wearCount);
 assert.equal(garmentWearSummary('H02','PHW',outfits,events).wearDays,1);
});
test('wash without dry does not confirm availability and explicit laundry observation remains separate',()=>{
 assert.equal(summary('H05').availability,'drying_unconfirmed');assert.equal(summary('H03').availability,'user_marked_laundry_pending');
 assert.equal(summary('H01').availability,'no_recorded_block_not_cleanliness_confirmation');
 for(const id of ['H01','H03','H05'])assert.equal(summary(id).cleanlinessConfirmed,false);
});
test('absent wash is unknown; no wear record never means never worn',()=>{
 const missing=summary('S13');assert.equal(missing.wearCount,0);assert.equal(missing.wearsAfterLastWash,null);assert.equal(missing.wearDaysAfterLastWash,null);assert.match(missing.display,/확인된 착용 기록이 없/);
 assert.equal(summary('S06').lastWashAt,null);assert.equal(summary('S06').wearsAfterLastWash,null);
});
test('same product across profiles remains two garment instances and histories',()=>{
 assert.equal(summary('S02','PHW').wearCount,0);assert.equal(summary('H01','PSU').wearCount,0);
 assert.notEqual(summary('S02').wearCount,summary('H01').wearCount);
});
test('planned scheduled_at date is distinct from recorded/created time',()=>{
 const plan=events.find(e=>e.id==='HW-PLAN-09')!;assert.equal(plan.date,'2026-10-09');assert.equal(plan.occurredAt,'2026-10-08T22:00:00+09:00');assert.equal(lifeEventDate(plan),'2026-10-09');
 assert(calendarEntries('PHW','2026-10-09',events,outfits).some(e=>e.event.id===plan.id));assert(!calendarEntries('PHW','2026-10-08',events,outfits).some(e=>e.event.id===plan.id));
});
test('UTC timestamps use explicit Asia/Seoul date, never machine timezone; naive/invalid time fails closed',()=>{
 assert.equal(lifeDate('2026-10-08T15:30:00Z'),'2026-10-09');assert.equal(lifeDate('2026-10-08T15:30:00Z','UTC'),'2026-10-08');
 for(const t of ['2026-10-08T15:30:00','2026-02-30T15:30:00Z','2026-10-08T24:00:00Z'])assert.equal(lifeTimestamp(t),null);
 const e=eventFrom({id:'utc',owner_id:'PHW',kind:'wear',occurred_at:'2026-10-08T15:30:00Z',details_json:{},garment_ids:['H02']});assert.equal(e.date,'2026-10-09');
});
test('duplicate imported source keys dedupe; changed same revision excludes conflict rather than choosing one',()=>{
 const e=events.find(e=>e.id==='HW-WEAR-BLUE-AM')!;
 assert.equal(summary('H02','PHW',[...events,{...e,id:'transport-duplicate'}]).wearCount,2);
 const conflict=summary('H02','PHW',[...events,{...e,id:'conflicting',occurredAt:'2026-10-08T11:00:00+09:00'}]);assert.equal(conflict.wearCount,1);assert(conflict.issues.some(i=>i.startsWith('conflicting_event:')));assert.equal(conflict.wearsAfterLastWash,null);
});
test('correction and void revisions recompute counts and change revision without changing original records',()=>{
 const original=events.find(e=>e.id==='HW-WEAR-BLUE-AM')!,baseline=summary('H02');
 const corrected={...original,revision:2,occurredAt:'2026-10-07T20:00:00+09:00'};
 const s=summary('H02','PHW',[...events,corrected]);assert.equal(s.wearCount,2);assert.equal(s.wearDays,2);assert.notEqual(s.revisionKey,baseline.revisionKey);
 const revoked=summary('H02','PHW',[...events,{...original,revision:2,voided:true}]);assert.equal(revoked.wearCount,1);assert.notEqual(revoked.revisionKey,baseline.revisionKey);assert.equal(original.voided,false);
 assert.equal(calendarEntries('PHW','2026-10-08',[...events,{...original,revision:2,voided:true}],outfits).filter(e=>e.event.id===original.id).length,0);
});
test('future observations excluded at fixed fixture asOf while future plans already recorded remain visible',()=>{
 const original=events.find(e=>e.id==='HW-WEAR-BLUE-AM')!;
 const future={...original,id:'future',sourceEventKey:'future',occurredAt:'2026-10-10T11:00:00+09:00'};
 assert.equal(summary('H02','PHW',[...events,future]).wearCount,2);
 const effective=effectiveLifeEvents('PSU',events,{asOf});assert(effective.events.some(e=>e.id==='SU-PLAN-10'));
 assert.throws(()=>effectiveLifeEvents('PSU',events,{asOf:'2026-10-09T07:40:00'}),/timezone/);
});
test('dry, air, iron and professional clean never reset last wash; unknown same-day order remains unknown',()=>{
 const wash:DemoEvent={id:'wash',ownerId:'o',kind:'care',garmentId:'g',date:'2026-10-08',value:'세탁 완료'};
 const wear:DemoEvent={id:'wear',ownerId:'o',kind:'wear',garmentIds:['g'],date:'2026-10-08',value:'입었음'};
 const s=garmentLifeSummary('g','o',[],[wash,wear]);assert.equal(s.wearsAfterLastWash,null);assert(s.issues.includes('wash_wear_order_unknown'));
 for(const kind of ['dry_completed','air_completed','iron_completed','professional_clean_completed','professional_cleaning_completed']){
  const event:DemoEvent={id:kind,ownerId:'o',kind:'care',garmentId:'g',date:'2026-10-09',occurredAt:'2026-10-09T12:00:00+09:00',value:kind,lifeKind:kind};
  assert.equal(garmentLifeSummary('g','o',[],[wash,event]).lastWashDate,'2026-10-08');
 }
});
test('retained event garment IDs survive edited outfit, multi-garment care is retained; explicit empty list never falls back',()=>{
 const wash=events.find(e=>e.id==='SU-W04-W')!;assert.equal(wash.garmentIds?.length,6);for(const id of wash.garmentIds!)assert.equal(summary(id).lastWashDate,'2026-10-04');
 const current=outfits.map(o=>o.id==='LH02'?{...o,items:{top:'another'}}:o);assert.equal(garmentLifeSummary('H02','PHW',current,events,{asOf}).wearCount,2);
 const e=events.find(e=>e.id==='HW-WEAR-BLUE-AM')!;assert.equal(garmentLifeSummary('H02','PHW',outfits,[{...e,garmentIds:[]}]).wearCount,0);
});
test('invalid life-kind family never turns a plan into confirmed wear',()=>{
 const plan=events.find(e=>e.kind==='plan')!;assert.equal(garmentLifeSummary('H02','PHW',outfits,[{...plan,lifeKind:'wear_confirmed'}]).wearCount,0);
});

test('legacy noon storage is date precision: morning reads retain today records without inventing wash/wear order',()=>{
 const base={owner_id:'o',occurred_at:'2026-10-09T03:00:00Z',input_source:'user_confirmed',garment_ids:['g']};
 const wash=eventFrom({...base,id:'wash',kind:'care',details_json:{value:'세탁 완료',garmentId:'g'}}),wear=eventFrom({...base,id:'wear',kind:'wear',details_json:{value:'실제 착용 확인'}});
 assert.equal(wash.occurredAt,'2026-10-09T03:00:00Z');assert.equal(wash.timePrecision,'date');
 const s=garmentLifeSummary('g','o',[],[wash,wear],{asOf:'2026-10-09T08:00:00+09:00'});
 assert.equal(s.wearCount,1);assert.equal(s.lastWashDate,'2026-10-09');assert.equal(s.lastWashAt,null);assert.equal(s.wearsAfterLastWash,null);assert(s.issues.includes('wash_wear_order_unknown'));
 const future=eventFrom({...base,id:'future',kind:'wear',occurred_at:'2026-10-10T03:00:00Z',details_json:{value:'실제 착용 확인'}});
 assert.equal(garmentLifeSummary('g','o',[],[future],{asOf:'2026-10-09T08:00:00+09:00'}).wearCount,0);
});
test('explicit imported instants retain strict time ordering and scheduled dates remain separate',()=>{
 const e=events.find(e=>e.id==='HW-WEAR-BLUE-AM')!;assert.equal(e.timePrecision,'instant');
 assert.equal(garmentLifeSummary('H02','PHW',outfits,[e],{asOf:'2026-10-08T10:00:00+09:00'}).wearCount,0);
 const exact=eventFrom({id:'exact',owner_id:'o',kind:'care',occurred_at:'2026-10-09T01:00:00Z',details_json:{value:'세탁 완료',time_precision:'instant'},garment_ids:['g']});assert.equal(exact.timePrecision,'instant');
 assert.equal(garmentLifeSummary('g','o',[],[exact],{asOf:'2026-10-09T09:00:00+09:00'}).lastWashDate,null);
});
